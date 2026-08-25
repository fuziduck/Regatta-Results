"""Seed the 2026 MYC Regatta (5-7 June 2026) from sailwave.com/results/medway.

Creates (idempotently, for Medway Yacht Club):
  - a "2026 Regatta" series for the existing Dragon and Sonata classes
  - "Cruiser Class 1" / "Cruiser Class 2" classes, each with a separate
    "2026 Regatta IRC" (corrected = elapsed x TCC) and
    "2026 Regatta YTC" (corrected = elapsed x 1000 / PY) series
  - the boats entered in each fleet (reusing existing MYC Sonata boats
    where they already exist; new boats for Dragon and the cruisers)
  - the races with each boat's result, plus the real start and finish
    times from the Sailwave files for the cruisers so the elapsed /
    corrected columns reproduce the published results exactly

Usage:
    python seed_myc_regatta_2026.py

Scoring notes (all verified against the Sailwave files):
  - Dragons:  7 races, 1 discard, 9 entries  -> DNC/DNF = 10.0 (entries + 1)
  - Sonatas:  6 races, 1 discard, 4 entries  -> DNC/DNS = 5.0
  - Cruiser Class 1 IRC: 3 races, 3 entries  -> DSQ = 4.0
  - Cruiser Class 1 YTC: 3 races, 4 entries  -> DNS/DSQ = 5.0
  - Cruiser Class 2 IRC: 3 races, 1 entry    -> no non-finishers
  - Cruiser Class 2 YTC: 3 races, 8 entries  -> DNS/DNC/DNF = 9.0

The script finishes by comparing the computed standings for every series
against the nett totals published by Sailwave and exits non-zero on any
mismatch.
"""
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).parent / ".env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

YEAR = 2026
CLUB_NAME = "Medway Yacht Club"
REGATTA_NAME = "2026 Regatta"
# Dragon races: R1-R2 Fri 5 Jun, R3-R5 Sat 6 Jun, R6-R7 Sun 7 Jun 2026
DRAGON_DATES = ["2026-06-05", "2026-06-05", "2026-06-06",
                "2026-06-06", "2026-06-06", "2026-06-07", "2026-06-07"]
# Sonata race dates are not in the source file; the regatta sailed Fri-Sun
# with two races a day (same as the Dragon fleet's pattern).
SONATA_DATES = ["2026-06-05", "2026-06-05", "2026-06-06",
                "2026-06-06", "2026-06-07", "2026-06-07"]
# Cruisers: R1+R2 Sat 6 Jun, R3 Sun 7 Jun (scheduled start / actual gun
# from the file's race captions).
CRUISER_RACES = [
    {"date": "2026-06-06", "start": "10:00", "actual_start": "10:10"},
    {"date": "2026-06-06", "start": "11:50", "actual_start": "11:50"},
    {"date": "2026-06-07", "start": "10:00", "actual_start": "10:20"},
]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def _cleanup(class_id, series_names, sail_nos):
    """Remove a previous run of this seed (idempotent re-run).

    Deletes the regatta series + races, and any boats the seed created
    that are not referenced by other (non-regatta) races.
    """
    for s in db.series.find({"class_id": class_id, "name": {"$in": series_names}}):
        db.races.delete_many({"series_id": s["id"]})
        db.series.delete_one({"id": s["id"]})
    for b in db.boats.find({"class_id": class_id, "sail_no": {"$in": sail_nos}}):
        if db.races.count_documents({"results.boat_id": b["id"]}) == 0:
            db.boats.delete_one({"id": b["id"]})


def _existing_boat_id(class_id, sail):
    """Match a regatta sail number to a stored boat (tolerating the
    "GBR " prefix the app's fleet uses, e.g. "GBR 8421" vs "8421")."""
    for cand in (sail, f"GBR {sail}", sail.replace(" ", ""), f"GBR{sail}"):
        b = db.boats.find_one({"class_id": class_id, "sail_no": cand})
        if b:
            return b["id"]
    return None


def _make_boats(class_id, boats, clean_sails=()):
    """Create boats; returns {sail_no: boat_id} using the app's stored
    sail_no as key (prefixed "GBR " for one-design fleets, raw for the
    cruisers, matching each existing fleet's convention)."""
    bmap = {}
    for name, sail, helm, home_club, extra in boats:
        bid = _existing_boat_id(class_id, sail)
        if bid is None:
            doc = {"id": str(uuid.uuid4()), "name": name, "sail_no": extra.get("stored_sail", sail),
                   "class_id": class_id, "helm": helm, "year": YEAR, "active": True,
                   "home_club": home_club, "created_at": now_iso()}
            for key in ("tcc", "py", "boat_type"):
                if extra.get(key) is not None:
                    doc[key] = extra[key]
            db.boats.insert_one(doc)
            bid = doc["id"]
        bmap[sail] = bid
    return bmap


def _one_design_race(sid, class_id, date, race_number, entries, placings, bmap):
    """placings: {sail_no: position | (CODE, None)}. Missing boats -> DNC.
    Synthetic finish times (start 10:30 + place minutes) keep the stored
    positions consistent with the engine's finish-time resequencing."""
    results = []
    for sail, bid in bmap.items():
        v = placings.get(sail)
        if v is None:
            results.append({"boat_id": bid, "code": "DNC", "finish_time": None,
                            "position": None, "penalty_points": 0})
        elif isinstance(v, int):
            ft = f"{date}T10:{30 + v:02d}:00+00:00"
            results.append({"boat_id": bid, "code": "FINISHED", "finish_time": ft,
                            "position": v, "penalty_points": 0})
        else:
            code = v[0]
            results.append({"boat_id": bid, "code": code, "finish_time": None,
                            "position": None, "penalty_points": 0})
    return {"id": str(uuid.uuid4()), "date": date, "class_id": class_id,
            "series_id": sid, "year": YEAR, "race_number": race_number,
            "start_time": "10:30", "course": "", "special_rules": "",
            "life_jackets": False, "status": "published", "entries_count": len(bmap),
            "results": results, "created_at": now_iso(), "published_at": now_iso()}


def _handicap_race(sid, class_id, meta, race_number, entries, placings, bmap):
    """placings: {sail_no: (code, position, finish_time | None)}. Boats not
    listed are omitted from the race (they did not enter that fleet)."""
    results = []
    for sail, bid in bmap.items():
        if sail not in placings:
            continue
        code, pos, ft = placings[sail]
        finish_time = f"{meta['date']}T{ft}+00:00" if ft else None
        results.append({"boat_id": bid, "code": code, "finish_time": finish_time,
                        "position": pos, "penalty_points": 0})
    return {"id": str(uuid.uuid4()), "date": meta["date"], "class_id": class_id,
            "series_id": sid, "year": YEAR, "race_number": race_number,
            "start_time": meta["start"], "actual_start": f"{meta['date']}T{meta['actual_start']}:00+00:00",
            "course": "", "special_rules": "", "life_jackets": False,
            "status": "published", "entries_count": entries, "results": results,
            "created_at": now_iso(), "published_at": now_iso()}


def _series(class_id, name, scoring_mode, discards, order, race_dates):
    sid = str(uuid.uuid4())
    db.series.insert_one({"id": sid, "name": name, "class_id": class_id, "year": YEAR,
                          "scoring_mode": scoring_mode, "discards": discards,
                          "included_in_overall": True, "order": order,
                          "planned_races": len(race_dates), "schedule": race_dates,
                          "use_a5_3": False, "use_finishers": False,
                          "created_at": now_iso()})
    return sid


# ---------------------------------------------------------------------------
# DRAGONS — 7 races, 1 discard, 9 entries
# ---------------------------------------------------------------------------
DRAGON_BOATS = [
    # (name, sail_no, helm, home_club, extra)
    ("Suti", "747", "T Atack", "MYC", {}),
    ("Navaho", "764", "R Gillingham", "AYC", {}),
    ("Gandalf", "726", "E Hannant", "MYC", {}),
    ("Hands Off", "760", "A Moss", "MYC", {}),
    ("Repeat Offender", "597", "P Walker", "MYC", {}),
    ("OCD", "675", "C Brealy", "MYC", {}),
    ("Taniwha", "823", "H Paterson", "MYC", {}),
    ("Aria", "704", "T Townsend", "MYC", {}),
    ("Kismet", "821", "C Ogden", "RFYC", {}),
]
# placings: position int, or ("DNC"|"DNF"|"DNS"|"DSQ"|..., None)
DRAGON_PLACINGS = [
    {"747": 6, "764": ("DNC", None), "726": 4, "760": 1, "597": 2,
     "675": 5, "823": 3, "704": ("DNC", None), "821": 7},
    {"747": 1, "764": 2, "726": 3, "760": ("DNF", None), "597": ("DNC", None),
     "675": ("DNC", None), "823": ("DNC", None), "704": ("DNC", None), "821": ("DNC", None)},
    {"747": 1, "764": 2, "726": 3, "760": ("DNC", None), "597": ("DNC", None),
     "675": ("DNC", None), "823": ("DNC", None), "704": ("DNC", None), "821": ("DNC", None)},
    {"747": 2, "764": 1, "726": 3, "760": ("DNC", None), "597": ("DNC", None),
     "675": ("DNC", None), "823": ("DNC", None), "704": ("DNC", None), "821": ("DNC", None)},
    {"747": 2, "764": 1, "726": 3, "760": ("DNC", None), "597": ("DNC", None),
     "675": ("DNC", None), "823": ("DNC", None), "704": ("DNC", None), "821": ("DNC", None)},
    {"747": 3, "764": ("DNC", None), "726": ("DNC", None), "760": 1, "597": 4,
     "675": 2, "823": 6, "704": 5, "821": 7},
    {"747": 3, "764": ("DNC", None), "726": ("DNC", None), "760": 2, "597": 6,
     "675": 5, "823": 4, "704": 1, "821": ("DNF", None)},
]
DRAGON_EXPECTED = {"747": 12.0, "764": 26.0, "726": 26.0, "760": 34.0, "597": 42.0,
                   "675": 42.0, "823": 43.0, "704": 46.0, "821": 54.0}

# ---------------------------------------------------------------------------
# SONATAS — 6 races, 1 discard, 4 entries (existing boats reused)
# ---------------------------------------------------------------------------
SONATA_BOATS = [
    ("BD2", "8999", "A Bolton", "MYC", {}),
    ("White Noise", "8361", "L Stone", "MYC", {}),
    ("Silver Lining", "8421", "P Gayton", "MYC", {}),
    ("Araya", "8901", "H. Courtney", "MYC", {}),
]
SONATA_PLACINGS = [
    {"8999": 1, "8361": 2, "8421": ("DNC", None), "8901": ("DNC", None)},
    {"8999": 1, "8361": 2, "8421": 3, "8901": ("DNS", None)},
    {"8999": 1, "8361": 2, "8421": 3, "8901": ("DNS", None)},
    {"8999": 1, "8361": 2, "8421": ("DNS", None), "8901": ("DNS", None)},
    {"8999": 1, "8361": 3, "8421": 2, "8901": ("DNC", None)},
    {"8999": 1, "8361": 3, "8421": 2, "8901": ("DNC", None)},
]
SONATA_EXPECTED = {"8999": 5.0, "8361": 11.0, "8421": 15.0, "8901": 25.0}

# ---------------------------------------------------------------------------
# CRUISER CLASS 1 — IRC1 (3) + YTC1 (4) fleets, 3 races, no discards
# ---------------------------------------------------------------------------
CRUISER1_BOATS = [
    ("Countdown", "4502", "Q Strauss", "MYC", {"tcc": 0.906, "py": 938, "boat_type": "Sigma 33"}),
    ("Zephyros", "9746", "T French Syndicate", "MYC", {"tcc": 0.897, "py": 955, "boat_type": "Dehler 34"}),
    ("Toucan", "1598R", "R Leeming", "MYC", {"tcc": 0.941, "py": 900, "boat_type": "Beneteau 31.7"}),
    ("Equinox", "3724T", "K Lennox", "MYC", {"py": 959, "boat_type": "Dehler 34"}),
]
# (code, position, finish_time) — finish times only for boats that finished.
IRC1_PLACINGS = [
    {"4502": ("FINISHED", 2, "11:22:07"), "9746": ("FINISHED", 1, "11:22:49"),
     "1598R": ("DSQ", None, None)},
    {"4502": ("FINISHED", 1, "12:40:37"), "9746": ("FINISHED", 2, "12:41:26"),
     "1598R": ("DSQ", None, None)},
    {"4502": ("FINISHED", 1, "13:12:49"), "9746": ("FINISHED", 2, "13:21:51"),
     "1598R": ("FINISHED", 3, "13:42:36")},
]
YTC1_PLACINGS = [
    {"9746": ("FINISHED", 1, "11:22:49"), "4502": ("FINISHED", 2, "11:22:07"),
     "3724T": ("DNS", None, None), "1598R": ("DSQ", None, None)},
    {"9746": ("FINISHED", 1, "12:41:26"), "4502": ("FINISHED", 2, "12:40:37"),
     "3724T": ("DNS", None, None), "1598R": ("DSQ", None, None)},
    {"4502": ("FINISHED", 1, "13:12:49"), "3724T": ("FINISHED", 2, "13:22:22"),
     "9746": ("FINISHED", 3, "13:21:51"), "1598R": ("FINISHED", 4, "13:42:36")},
]
IRC1_EXPECTED = {"4502": 4.0, "9746": 5.0, "1598R": 11.0}
YTC1_EXPECTED = {"9746": 5.0, "4502": 5.0, "3724T": 12.0, "1598R": 14.0}

# ---------------------------------------------------------------------------
# CRUISER CLASS 2 — IRC2 (1) + YTC2 (8) fleets, 3 races, no discards
# ---------------------------------------------------------------------------
CRUISER2_BOATS = [
    ("LoFlyer", "102", "J Barnard", "GYC", {"tcc": 0.810, "py": 1034, "boat_type": "Zygal Limbo 6.6"}),
    ("First Knight", "3848T", "R Sutton", "HCC", {"py": 1055, "boat_type": "Beneteau First 25"}),
    ("Valencia", "3529T", "A Thomas", "EYC", {"py": 1042, "boat_type": "Beneteau First 325"}),
    ("Audouin", "3258Y", "D Cannock", "HNSC", {"py": 1086, "boat_type": "Trapper 500"}),
    ("Naiad", "170", "J Wightman", "GYC", {"py": 1122, "boat_type": "Hunter Medina"}),
    ("Jeannie", "766", "T Bowring", "MYC", {"py": 1129, "boat_type": "Folkboat"}),
    ("Demon of Arun", "SW26", "L Willis", "GYC", {"py": 1065, "boat_type": "Seawolf 26"}),
    ("Hotspur", "3174Y", "D Thompson", "MYC", {"py": 1003, "boat_type": "Colvic UFO 31"}),
]
IRC2_PLACINGS = [
    {"102": ("FINISHED", 1, "11:20:41")},
    {"102": ("FINISHED", 1, "12:36:07")},
    {"102": ("FINISHED", 1, "13:20:45")},
]
YTC2_PLACINGS = [
    {"3529T": ("FINISHED", 1, "11:12:32"), "3848T": ("FINISHED", 2, "11:15:37"),
     "3258Y": ("FINISHED", 3, "11:21:01"), "170": ("FINISHED", 4, "11:25:35"),
     "102": ("FINISHED", 5, "11:20:41"), "SW26": ("FINISHED", 6, "11:27:53"),
     "766": ("DNS", None, None)},
    {"3848T": ("FINISHED", 1, "12:34:04"), "3529T": ("FINISHED", 2, "12:33:39"),
     "102": ("FINISHED", 3, "12:36:07"), "3258Y": ("FINISHED", 4, "12:40:26"),
     "170": ("FINISHED", 5, "12:43:08"), "SW26": ("FINISHED", 6, "12:45:12"),
     "766": ("DNC", None, None), "3174Y": ("DNC", None, None)},
    {"766": ("FINISHED", 1, "13:27:55"), "3848T": ("FINISHED", 2, "13:20:40"),
     "102": ("FINISHED", 3, "13:20:45"), "3174Y": ("FINISHED", 4, "13:16:51"),
     "3529T": ("FINISHED", 5, "13:26:46"), "170": ("FINISHED", 6, "13:42:44"),
     "3258Y": ("FINISHED", 7, "13:39:52"), "SW26": ("DNF", None, None)},
]
IRC2_EXPECTED = {"102": 3.0}
YTC2_EXPECTED = {"3848T": 5.0, "3529T": 8.0, "102": 11.0, "3258Y": 14.0,
                 "170": 15.0, "766": 19.0, "SW26": 21.0, "3174Y": 22.0}


def _insert_one_design_series(class_id, series_order, boats, dates, placings_list):
    sid = _series(class_id, REGATTA_NAME, "one_design", 1, series_order, dates)
    # MYC's stored convention is "GBR NNNN" (matches the existing Sonata fleet).
    boats = [(n, s, h, c, {**e, "stored_sail": f"GBR {s}"}) for n, s, h, c, e in boats]
    bmap = _make_boats(class_id, boats)
    for i, placings in enumerate(placings_list, start=1):
        db.races.insert_one(_one_design_race(sid, class_id, dates[i - 1], i,
                                             len(bmap), placings, bmap))
    return sid, bmap


def _insert_handicap_series(class_id, name, scoring_mode, order, fleet_boats,
                            placings_list, entries):
    sid = _series(class_id, name, scoring_mode, 0, order,
                  [m["date"] for m in CRUISER_RACES])
    bmap = _make_boats(class_id, fleet_boats)
    for i, placings in enumerate(placings_list, start=1):
        db.races.insert_one(_handicap_race(sid, class_id, CRUISER_RACES[i - 1], i,
                                           entries, placings, bmap))
    return sid, bmap


def _verify(label, sid, expected):
    """Compare the standings API nett scores with the Sailwave nett values."""
    import json
    import urllib.request
    base = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
    with urllib.request.urlopen(f"{base}/api/standings/series/{sid}", timeout=30) as resp:
        st = json.loads(resp.read())
    def norm(s):
        return (s or "").replace("GBR", "").replace(" ", "")
    got = {norm(row["sail_no"]): row["net"] for row in st["standings"]}
    ok = True
    print(f"\n{label} — sailwave nett vs ours:")
    for sail in sorted(expected):
        exp, ours = expected[sail], got.get(norm(sail))
        match = ours is not None and abs(ours - exp) < 0.01
        ok = ok and match
        print(f"  {sail:>6}: sailwave {exp:>5}  ours {ours!s:>5}  {'OK' if match else 'MISMATCH'}")
    return ok


def main():
    club = db.clubs.find_one({"name": CLUB_NAME})
    if not club:
        raise SystemExit(f"club '{CLUB_NAME}' not found in DB")
    dragon = db.classes.find_one({"name": "Dragon", "club_id": club["id"]})
    sonata = db.classes.find_one({"name": "Sonata", "club_id": club["id"]})
    if not dragon or not sonata:
        raise SystemExit("MYC Dragon/Sonata classes not found — has the production data been imported?")

    # ---- clean previous runs of this seed ----
    _cleanup(dragon["id"], [REGATTA_NAME], [f"GBR {b[1]}" for b in DRAGON_BOATS])
    _cleanup(sonata["id"], [REGATTA_NAME], ["GBR 8361"])
    for cls_name, boats in (("Cruiser Class 1", CRUISER1_BOATS),
                            ("Cruiser Class 2", CRUISER2_BOATS)):
        cls = db.classes.find_one({"name": cls_name, "club_id": club["id"]})
        if cls:
            _cleanup(cls["id"], [f"{REGATTA_NAME} IRC", f"{REGATTA_NAME} YTC"],
                     [b[1] for b in boats])

    # ---- one-design fleets ----
    d_sid, d_bmap = _insert_one_design_series(dragon["id"], 1, DRAGON_BOATS,
                                              DRAGON_DATES, DRAGON_PLACINGS)
    print(f"Dragon: {len(d_bmap)} boats, 7 races")
    s_sid, s_bmap = _insert_one_design_series(sonata["id"], 6, SONATA_BOATS,
                                              SONATA_DATES, SONATA_PLACINGS)
    print(f"Sonata: {len(s_bmap)} boats, 6 races (White Noise created, "
          f"{len(s_bmap) - 1} existing reused)")

    # ---- cruiser classes ----
    c1 = db.classes.find_one({"name": "Cruiser Class 1", "club_id": club["id"]})
    if not c1:
        c1 = {"id": str(uuid.uuid4())}
        db.classes.insert_one({"id": c1["id"], "club_id": club["id"],
                               "name": "Cruiser Class 1", "default_start_time": "10:00",
                               "scoring_mode": "py", "created_at": now_iso()})
    c1_irc_sid, _ = _insert_handicap_series(c1["id"], f"{REGATTA_NAME} IRC", "irc",
                                            1, CRUISER1_BOATS, IRC1_PLACINGS, 3)
    c1_ytc_sid, _ = _insert_handicap_series(c1["id"], f"{REGATTA_NAME} YTC", "py",
                                            2, CRUISER1_BOATS, YTC1_PLACINGS, 4)
    print("Cruiser Class 1: 4 boats, IRC (3 entries) + YTC (4 entries), 3 races each")

    c2 = db.classes.find_one({"name": "Cruiser Class 2", "club_id": club["id"]})
    if not c2:
        c2 = {"id": str(uuid.uuid4())}
        db.classes.insert_one({"id": c2["id"], "club_id": club["id"],
                               "name": "Cruiser Class 2", "default_start_time": "10:00",
                               "scoring_mode": "py", "created_at": now_iso()})
    c2_irc_sid, _ = _insert_handicap_series(c2["id"], f"{REGATTA_NAME} IRC", "irc",
                                            1, CRUISER2_BOATS, IRC2_PLACINGS, 1)
    c2_ytc_sid, _ = _insert_handicap_series(c2["id"], f"{REGATTA_NAME} YTC", "py",
                                            2, CRUISER2_BOATS, YTC2_PLACINGS, 8)
    print("Cruiser Class 2: 8 boats, IRC (1 entry) + YTC (8 entries), 3 races each")

    # ---- verification against the Sailwave nett totals ----
    ok = True
    ok &= _verify("Dragon 2026 Regatta", d_sid, DRAGON_EXPECTED)
    ok &= _verify("Sonata 2026 Regatta", s_sid, SONATA_EXPECTED)
    ok &= _verify("Cruiser Class 1 IRC", c1_irc_sid, IRC1_EXPECTED)
    ok &= _verify("Cruiser Class 1 YTC", c1_ytc_sid, YTC1_EXPECTED)
    ok &= _verify("Cruiser Class 2 IRC", c2_irc_sid, IRC2_EXPECTED)
    ok &= _verify("Cruiser Class 2 YTC", c2_ytc_sid, YTC2_EXPECTED)
    if not ok:
        raise SystemExit("\nNET MISMATCH — see above")
    print("\nAll 6 series nett scores match the Sailwave files.")


if __name__ == "__main__":
    main()
