"""Seed the 2025 Sonata series for Medway Yacht Club from Sailwave HTML exports.

Each exported file is one named series (Early Spring, Late Spring, Summer,
Early Autumn, Late Autumn). The per-race placings below reproduce the Sailwave
"Appendix A" low-point overalls: DNC scores series entries + 1 (11 with 10
entries) under the A5.3 convention, while DNF/RET score that race's
participants + 1. Discard counts match each exported summary.

Run inside the backend container (network + env resolve there):
    docker exec regatta-backend python /app/seed_sonata_2025.py
Idempotent: removes existing 2025 Sonata boats/series/races for the club first.
"""

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

# Fall back to the project root .env if run outside the container.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
YEAR = 2025
CLUB_ID = None
CLASS_ID = None


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


def resolve_class():
    global CLUB_ID, CLASS_ID
    club = db.clubs.find_one({"name": "Medway Yacht Club"}, {"_id": 0, "id": 1})
    if not club:
        raise SystemExit("Medway Yacht Club not found")
    CLUB_ID = club["id"]
    cls = db.classes.find_one({"name": "Sonata", "club_id": CLUB_ID}, {"_id": 0, "id": 1})
    if not cls:
        raise SystemExit(f"No Sonata class for club {CLUB_ID}")
    CLASS_ID = cls["id"]


# sail_no prefix -> (boat name, helm, home club)
BOATS = {
    "8420": ("Watersong", "Luke Hopper", "Medway Yacht Club"),
    "8087": ("Red Dwarf 2", "Rob Hill", "Medway Yacht Club"),
    "8410": ("Screwloose", "Paul Kirk", "Medway Yacht Club"),
    "8189": ("Bluetack", "Paul Sharp", "Medway Yacht Club"),
    "8219": ("Skipper", "John Harvey", "Medway Yacht Club"),
    "8999": ("BD2", "Alistair Bolton", "Medway Yacht Club"),
    "8048": ("Cry Havoc", "Chris Lyndsey", "Medway Yacht Club"),
    "8421": ("Silver Lining", "Class Boat", "Medway Yacht Club"),
    "8436": ("Munchkin", "Adrian & Julian", "Medway Yacht Club"),
    "8361": ("White Noise", "Jonny Hewat", "Medway Yacht Club"),
}
# Series: name -> (discards, included_in_overall, order)
SERIES_DEFS = [
    ("Early Spring", 1, True, 1),
    ("Late Spring", 1, True, 2),
    ("Summer Series", 1, False, 3),
    ("Early Autumn", 1, True, 4),
    ("Late Autumn", 0, True, 5),
]

# placings: date -> {sail_prefix: position | 'DNF' | 'RET'}. Boats absent are DNC.
RACES = {
    "Early Spring": {
        "2025-04-26": {"8087": 1, "8410": 2, "8189": 3, "8219": 4, "8420": "DNF"},
        "2025-05-03": {"8420": 1, "8999": 2, "8087": 3, "8410": 4, "8189": 5, "8219": 6, "8048": 7},
        "2025-05-10": {"8420": 1, "8999": 2, "8087": 3, "8410": 4, "8189": 5, "8219": 6},
        "2025-05-17": {"8420": 1, "8087": 2, "8410": 3},
        "2025-05-24": {"8420": 1, "8410": 2, "8189": 3, "8219": 4},
    },
    "Late Spring": {
        "2025-05-31": {"8189": 1, "8420": 2, "8087": 3, "8410": 4, "8219": "DNF"},
        "2025-06-07": {"8420": 1, "8410": 2, "8219": 3},
        "2025-06-28": {"8410": 1, "8087": 2, "8189": 3, "8219": 4, "8048": 5},
        "2025-07-05": {"8420": 1, "8087": 2, "8189": 3, "8410": 4, "8219": 5, "8048": 6},
        "2025-07-12": {"8420": 1, "8189": 2, "8410": 3, "8219": 4, "8048": 5},
    },
    "Summer Series": {
        "2025-07-26": {"8420": 1, "8410": 2, "8219": 3, "8189": 4},
        "2025-08-02": {"8420": 1, "8189": 2, "8087": 3, "8219": 4, "8410": 5},
        "2025-08-09": {"8410": 1, "8420": 2, "8436": 3, "8087": 4, "8189": 5, "8219": 6},
        "2025-08-16": {"8420": 1, "8087": 2, "8410": 3, "8436": 4},
    },
    "Early Autumn": {
        "2025-08-30": {"8420": 1, "8189": 2, "8410": 3, "8219": 4},
        "2025-09-06": {"8420": 1, "8189": 2, "8410": 3, "8219": 4, "8436": "DNF"},
        "2025-09-13": {"8420": 1, "8219": 2, "8189": "RET"},
        "2025-09-20": {"8420": 1, "8410": 2, "8189": 3, "8048": 4, "8219": 5, "8436": 6},
    },
    "Late Autumn": {
        "2025-09-27": {"8420": 1, "8087": 2, "8410": 3, "8219": 4, "8189": 5, "8048": 6},
        "2025-10-18": {"8420": 1, "8087": 2, "8410": 3, "8189": 4, "8219": 5, "8436": 6, "8048": 7},
        "2025-10-25": {"8420": 1, "8087": 2, "8410": 3, "8189": 4, "8219": 5},
    },
}


def build_race(sid, date, race_num, placings, boat_by_prefix, default_start):
    """One published race. All class boats appear; absent runners are DNC."""
    results = []
    for prefix in BOATS:
        bid = boat_by_prefix[prefix]
        v = placings.get(prefix)
        if v is None:
            results.append({"boat_id": bid, "code": "DNC", "finish_time": None,
                            "position": None, "penalty_points": 0})
        elif isinstance(v, int):
            results.append({"boat_id": bid, "code": "FINISHED",
                            "finish_time": f"{date}T{10 + v // 60:02d}:{30 + v:02d}:00+00:00",
                            "position": v, "penalty_points": 0})
        else:
            results.append({"boat_id": bid, "code": v, "finish_time": None,
                            "position": None, "penalty_points": 0})
    return {
        "id": new_id(), "date": date, "class_id": CLASS_ID, "series_id": sid,
        "year": YEAR, "race_number": race_num, "start_time": default_start,
        "start_tz_offset_minutes": 60, "actual_start": None,
        "course": "", "special_rules": "", "life_jackets": False,
        "status": "published", "entries_count": len(BOATS), "results": results,
        "created_at": now_iso(), "published_at": now_iso(), "version": 1,
    }


def main():
    resolve_class()
    print(f"Club {CLUB_ID} / Sonata class {CLASS_ID} / year {YEAR}")

    cls = db.classes.find_one({"id": CLASS_ID}, {"_id": 0, "default_start_time": 1})
    default_start = (cls or {}).get("default_start_time") or "13:50"

    # --- Boats ---------------------------------------------------------
    removed = db.boats.delete_many({"class_id": CLASS_ID, "year": YEAR}).deleted_count
    boat_by_prefix = {}
    boat_docs = []
    for prefix, (name, helm, home) in BOATS.items():
        sail = f"GBR {prefix}"
        bid = new_id()
        boat_by_prefix[prefix] = bid
        boat_docs.append({
            "id": bid, "name": name, "sail_no": sail, "class_id": CLASS_ID,
            "helm": helm, "year": YEAR, "active": True, "tcc": None, "py": None,
            "boat_type": "Sonata", "home_club": home,
            "created_at": now_iso(), "version": 1, "fleet_id": None, "fleet_key": None,
        })
    if boat_docs:
        db.boats.insert_many(boat_docs)
    print(f"Boats: removed {removed}, inserted {len(boat_docs)}")

    # --- Series --------------------------------------------------------
    removed = db.series.delete_many({"class_id": CLASS_ID, "year": YEAR}).deleted_count
    series_by_name = {}
    for sname, discards, included, order in SERIES_DEFS:
        sid = new_id()
        series_by_name[sname] = sid
        db.series.insert_one({
            "id": sid, "name": sname, "class_id": CLASS_ID, "year": YEAR,
            "discards": discards, "included_in_overall": included, "order": order,
            "created_at": now_iso(), "version": 1,
            "scoring_mode": "one_design", "planned_races": 0,
            "use_a5_3": True, "use_finishers": False,
            "mini_series": False, "mini_series_groups": None,
            "member_boat_ids": None, "scoring_config": None,
        })
    print(f"Series: removed {removed}, inserted {len(series_by_name)}")

    # --- Races ---------------------------------------------------------
    removed = db.races.delete_many({"class_id": CLASS_ID, "year": YEAR,
                                    "series_id": {"$in": list(series_by_name.values())}}).deleted_count
    race_docs = []
    for sname, races in RACES.items():
        sid = series_by_name[sname]
        for race_num, (date, placings) in enumerate(races.items(), start=1):
            race_docs.append(build_race(sid, date, race_num, placings,
                                        boat_by_prefix, default_start))
    if race_docs:
        db.races.insert_many(race_docs)
    print(f"Races: removed {removed}, inserted {len(race_docs)}")

    # Idempotency note: fleet_key uniqueness not enforced, so re-running on
    # existing 2025 boats simply replaces them.


if __name__ == "__main__":
    main()