#!/usr/bin/env python3
"""One-command importer for historic race results.

Turns a small JSON manifest into published races + series + boats in the
SailScore database — the same layout the web UI publishes, so standings are
computed automatically by the scoring engine (no manual calculation).

Example:
    docker exec regatta-backend python /app/import_results.py /path/to/manifest.json

The manifest describes one club/class/year and any number of series. A boat
absent from a race scores DNC (series entries + 1). The importer honours the
RRS A5.3 / 'finishers' convention so DNF/RET score that race's participants
+ 1, matching a typical Sailwave "Appendix A" export.

Schema (all keys under ``series[i].races`` map a sail number to a result —
a finishing position ``1,2,3,...``, a code ``"DNF"``/``"RET"``/``"DNS"``/
``"OCS"``/``"UFD"``/etc., ``["code", points]`` for an explicit committee
score (``["ZFP", 0]``, ``["RDG", 11]``), or ``["FINISHED", position,
points]`` for a finishing place with explicit points; every sail number in
``boats`` that isn't listed that day scores DNC):

    {
      "club": "Medway Yacht Club",
      "class": "Sonata",
      "year": 2025,
      "a5_convention": "a5_3",            // "a5_3" | "finishers" | "a5_2"
      "default_start_time": "13:50",      // optional; falls back to class default
      "boats": {
        "8420": {"name": "Watersong", "helm": "Luke Hopper"},
        "8087": {"name": "Red Dwarf 2", "helm": "Rob Hill"}
      },
      "series": [
        {
          "name": "Early Spring",
          "discards": 1,
          "included_in_overall": true,
          "order": 1,
          // Either form of "races" is accepted:
          //   dict  {date: placings}                    — race numbers 1..n in order
          //   list  [{date, number?, placings}, ...]    — explicit numbers (multi-race days)
          "races": {
            "2025-04-26": {"8087": 1, "8420": "DNF"},
            "2025-05-03": {"8087": 3, "8420": 1}
          }
        }
      ]
    }

Idempotency / safety:
  - Boats are upserted by (class, year, sail_no) — never deleted.
  - Each named series is recreated (replaced) for that class/year.
  - Races belonging to the named series are removed and re-inserted, so
    re-running the same manifest is a clean re-import.
  - Nothing outside the named series is touched. This importer NEVER drops a
    collection, never deletes other data, and never touches MongoDB volumes.
"""

import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def resolve_club(db, name: str):
    club = db.clubs.find_one({"name": name}, {"_id": 0})
    if club:
        return club
    print(f"  creating missing club '{name}'")
    slug = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")
    club_doc = {"id": new_id(), "name": name, "slug": slug or "club",
                "color": "#0A369D", "created_at": now_iso()}
    db.clubs.insert_one(club_doc)
    return club_doc


def resolve_class(db, club_id: str, name: str):
    cls = db.classes.find_one({"club_id": club_id, "name": name}, {"_id": 0})
    if cls:
        return cls
    print(f"  creating missing class '{name}'")
    cls_doc = {"id": new_id(), "club_id": club_id, "name": name,
               "default_start_time": "13:50", "scoring_mode": "one_design",
               "created_at": now_iso(), "version": 1}
    db.classes.insert_one(cls_doc)
    return cls_doc


def _fleet_key(name, sail_no):
    """The boat-registry identity key: sail number + name, alphanumerics only.

    Mirrors fleet_key() in the app so an imported boat automatically shares a
    fleet identity with the same physical boat already recorded at another
    club or in another year (e.g. a Medway club boat that also raced at the
    Nationals)."""
    clean = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())
    return f"{clean(sail_no)}|{clean(name)}"


def upsert_boats(db, class_id, year, boats, home_club):
    """Upsert boats by (class, year, sail_no). Returns sail_no -> boat_id."""
    boat_by_prefix = {}
    for prefix, info in boats.items():
        name = info.get("name") or f"Boat {prefix}"
        helm = info.get("helm") or ""
        sail = info.get("sail_no") or f"GBR {prefix}".strip()
        key = _fleet_key(name, sail)
        existing = db.boats.find_one({"class_id": class_id, "year": year, "sail_no": sail},
                                     {"_id": 0})
        skip_id = existing["id"] if existing else ""
        # Link to an existing fleet identity (same physical boat at another
        # club/year) so the shared boat registry groups them together.
        fleet_id, key = _find_fleet_link(db, class_id, key, name, sail, skip_id)
        if existing:
            db.boats.update_one({"id": existing["id"]},
                                {"$set": {"name": name, "helm": helm,
                                          "home_club": home_club, "active": True,
                                          "fleet_key": key,
                                          "fleet_id": fleet_id,
                                          "boat_type": info.get("boat_type") or existing.get("boat_type"),
                                          "class_id": class_id, "year": year}})
            boat_by_prefix[prefix] = existing["id"]
        else:
            bid = new_id()
            db.boats.insert_one({
                "id": bid, "name": name, "sail_no": sail, "class_id": class_id,
                "helm": helm, "year": year, "active": True, "tcc": None, "py": None,
                "fleet_key": key, "fleet_id": fleet_id,
                "boat_type": info.get("boat_type") or "Keelboat",
                "home_club": home_club, "created_at": now_iso(), "version": 1,
            })
            boat_by_prefix[prefix] = bid
    return boat_by_prefix


def _find_fleet_link(db, class_id, key, name, sail, skip_id):
    """Resolve a shared fleet identity for an imported boat.

    Returns ``(fleet_id, client_key)`` where ``client_key`` is the fleet_key the
    imported boat should take. Preference order:

    1. An existing boat with the exact same normalized fleet_key (same sail and
       name) elsewhere → share that identity.
    2. An existing boat in the same class whose sail number matches but whose
       recorded name is spelled differently (e.g. ``KNEBTFAT`` in one year and
       ``Knebfat`` in another) → share that identity using the *canonical*
       fleet_key already registered, so the shared boat registry still groups
       them as one boat.

    Returns ``(None, key)`` (i.e. keep the freshly computed key) when no link
    is found."""
    link = db.boats.find_one({"fleet_key": key, "id": {"$ne": skip_id}},
                             {"_id": 0, "fleet_id": 1, "id": 1})
    if link:
        return (link.get("fleet_id") or link["id"]), key
    sail_clean = re.sub(r"[^a-z0-9]", "", (sail or "").lower())
    if sail_clean and class_id:
        for c in db.boats.find({"class_id": class_id, "id": {"$ne": skip_id}},
                                {"_id": 0, "fleet_id": 1, "id": 1, "fleet_key": 1,
                                 "sail_no": 1}):
            if re.sub(r"[^a-z0-9]", "", (c.get("sail_no") or "").lower()) == sail_clean:
                return (c.get("fleet_id") or c["id"]), (c.get("fleet_key") or key)
    return None, key


def a5_flags(convention):
    convention = (convention or "a5_3").lower()
    return {
        "use_a5_3": convention == "a5_3",
        "use_finishers": convention == "finishers",
    }


def build_race(class_id, sid, year, date, race_num, placings, boat_by_prefix,
               entries_count, default_start):
    """One published race. Every fleet boat appears; absent runners are DNC.

    Each placing is one of:
      - an int                 : a finishing position (code FINISHED)
      - a code string          : "DNF", "RET", "DNS", "OCS", "UFD", "DNC", ...
      - [code, points]         : the code with an explicit committee score
                                 (e.g. ["ZFP", 0] or ["RDG", 11]) — stored as
                                 penalty_points so the engine honours it
      - ["FINISHED", pos, pts]: a finishing position with explicit points
                                 (a published place-plus-penalty score)
    """
    results = []
    for prefix, bid in boat_by_prefix.items():
        v = placings.get(prefix)
        if v is None:
            results.append({"boat_id": bid, "code": "DNC", "finish_time": None,
                            "position": None, "penalty_points": 0})
        elif isinstance(v, int):
            results.append({"boat_id": bid, "code": "FINISHED",
                            "finish_time": f"{date}T{10 + v // 60:02d}:{30 + v:02d}:00+00:00",
                            "position": v, "penalty_points": 0})
        elif isinstance(v, (list, tuple)) and v and v[0] == "FINISHED":
            # A finishing position with explicit points (a published
            # place-plus-penalty score): the engine scores position +
            # penalty_points, so the stored penalty is the points difference.
            pos = int(v[1])
            pts = float(v[2]) if len(v) > 2 and v[2] is not None else float(pos)
            results.append({"boat_id": bid, "code": "FINISHED",
                            "finish_time": f"{date}T{10 + pos // 60:02d}:{30 + pos:02d}:00+00:00",
                            "position": pos, "penalty_points": pts - pos})
        elif isinstance(v, (list, tuple)) and v:
            results.append({"boat_id": bid, "code": str(v[0]), "finish_time": None,
                            "position": None, "penalty_points": float(v[1])})
        else:
            results.append({"boat_id": bid, "code": str(v), "finish_time": None,
                            "position": None, "penalty_points": 0})
    return {
        "id": new_id(), "date": date, "class_id": class_id, "series_id": sid,
        "year": year, "race_number": race_num, "start_time": default_start,
        "start_tz_offset_minutes": 60, "actual_start": None,
        "course": "", "special_rules": "", "life_jackets": False,
        "status": "published", "entries_count": entries_count, "results": results,
        "created_at": now_iso(), "published_at": now_iso(), "version": 1,
    }


def iter_races(races):
    """Yield (date, race_number, placings) from either the dict form
    {date: placings} (numbers 1..n in insertion order) or the list form
    [{date, number?, placings}, ...] (explicit numbers, for multi-race days)."""
    if isinstance(races, list):
        for i, item in enumerate(races, start=1):
            date = item.get("date")
            if not date:
                raise ValueError(f"Race entry missing 'date': {item!r}")
            yield date, int(item.get("number") or i), item.get("placings") or {}
    else:
        for n, (date, placings) in enumerate((races or {}).items(), start=1):
            yield date, n, placings


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: import_results.py <manifest.json>", file=sys.stderr)
        return 2
    mpath = sys.argv[1]
    try:
        manifest = json.loads(Path(mpath).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Could not read manifest {mpath}: {exc}", file=sys.stderr)
        return 2

    for key in ("club", "class", "year", "series", "boats"):
        if not manifest.get(key):
            print(f"Manifest missing required key: {key}", file=sys.stderr)
            return 2
    club_name = manifest["club"]
    class_name = manifest["class"]
    year = int(manifest["year"])
    flags = a5_flags(manifest.get("a5_convention"))

    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    print(f"Importing into club='{club_name}' class='{class_name}' year={year}")
    club = resolve_club(db, club_name)
    cls = resolve_class(db, club["id"], class_name)
    default_start = manifest.get("default_start_time") \
        or (cls or {}).get("default_start_time") or "13:50"

    # --- Boats ---------------------------------------------------------
    boat_by_prefix = upsert_boats(db, cls["id"], year, manifest["boats"], club["name"])
    print(f"  boats: {len(boat_by_prefix)} upserted")
    entries_count = len(boat_by_prefix)

    # --- Series + races ------------------------------------------------
    summary = []
    total_races = 0
    for s in manifest["series"]:
        sname = s["name"]
        discards = int(s.get("discards", 0))
        included = bool(s.get("included_in_overall", True))
        order = int(s.get("order", 0))
        # Recreate this named series for the class/year (idempotent). Remove
        # the old series AND its races — deleting only the series would leave
        # its races behind as invisible orphans.
        old_ids = [o["id"] for o in db.series.find(
            {"class_id": cls["id"], "year": year, "name": sname}, {"_id": 0, "id": 1})]
        if old_ids:
            db.races.delete_many({"series_id": {"$in": old_ids}})
        db.series.delete_many({"class_id": cls["id"], "year": year, "name": sname})
        sid = new_id()
        db.series.insert_one({
            "id": sid, "name": sname, "class_id": cls["id"], "year": year,
            "discards": discards, "included_in_overall": included, "order": order,
            "created_at": now_iso(), "version": 1,
            "scoring_mode": "one_design", "planned_races": 0,
            "use_a5_3": flags["use_a5_3"], "use_finishers": flags["use_finishers"],
            "mini_series": False, "mini_series_groups": None,
            "member_boat_ids": None, "scoring_config": None,
        })
        # Replace this series' races cleanly.
        db.races.delete_many({"series_id": sid})
        docs = [build_race(cls["id"], sid, year, date, race_no, placings,
                           boat_by_prefix, entries_count, default_start)
                for _, (date, race_no, placings) in enumerate(iter_races(s.get("races")))]
        if docs:
            db.races.insert_many(docs)
        total_races += len(docs)
        summary.append(f"{sname}: {len(docs)} published race(s), discards {discards}, "
                       f"overall={'yes' if included else 'no'}")
        print("  " + summary[-1])

    # Cleanup: drop any orphaned races for this class/year whose series no
    # longer exists (leftovers from a previous generation of series that was
    # deleted or recreated elsewhere). They would otherwise ride along in
    # future backups without ever appearing on the site.
    valid_ids = [s["id"] for s in db.series.find(
        {"class_id": cls["id"], "year": year}, {"_id": 0, "id": 1})]
    if valid_ids:
        res = db.races.delete_many({"class_id": cls["id"], "year": year,
                                    "series_id": {"$nin": valid_ids}})
        if res.deleted_count:
            print(f"  cleaned {res.deleted_count} orphaned race(s) for {class_name} {year}")

    print(f"Done: {len(summary)} series, {total_races} published races imported.")
    print("Verify on the site: the club → class → series standings are computed live.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())