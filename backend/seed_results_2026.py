import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).parent / ".env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
YEAR = datetime.now(timezone.utc).year


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def cls_id(name):
    return db.classes.find_one({"name": name})["id"]


def series_id(class_id, name):
    return db.series.find_one({"class_id": class_id, "name": name, "year": YEAR})["id"]


def boat_map(class_id):
    return {b["sail_no"]: b["id"] for b in db.boats.find({"class_id": class_id, "year": YEAR})}


def build_race(class_id, sid, date, race_num, entries, placings, start="10:30"):
    """placings: dict sail_no -> int(position) | 'DNF'/'RET'/'DNS'/'OCS' | ('RDG', pts)."""
    bmap = boat_map(class_id)
    results = []
    for sail_no, bid in bmap.items():
        v = placings.get(sail_no)
        if v is None:
            results.append({"boat_id": bid, "code": "DNC", "finish_time": None, "position": None, "penalty_points": 0})
        elif isinstance(v, int):
            ft = f"{date}T{10 + v // 60:02d}:{30 + v % 30:02d}:00+00:00"
            results.append({"boat_id": bid, "code": "FINISHED", "finish_time": ft, "position": v, "penalty_points": 0})
        elif isinstance(v, tuple) and v[0] == "RDG":
            results.append({"boat_id": bid, "code": "RDG", "finish_time": None, "position": None, "penalty_points": float(v[1])})
        else:
            results.append({"boat_id": bid, "code": v, "finish_time": None, "position": None, "penalty_points": 0})
    return {
        "id": str(uuid.uuid4()), "date": date, "class_id": class_id, "series_id": sid, "year": YEAR,
        "race_number": race_num, "start_time": start, "course": "", "special_rules": "", "life_jackets": False,
        "status": "published", "entries_count": entries, "results": results,
        "created_at": now_iso(), "published_at": now_iso(),
    }


# ============================= SONATA =============================
SON = cls_id("Sonata")
# Early Spring (5 races), entries 9
es = series_id(SON, "Early Spring")
early_spring = [
    ("2026-04-25", {"8999": 1, "8420": 2, "8410": 3, "8087": 4, "8189": 5, "8048": "DNF"}),
    ("2026-05-02", {"8420": 1, "8410": 2, "8087": 2, "8189": 3, "8421": 4, "8436": 5, "8048": 6}),
    ("2026-05-09", {"8420": 1, "8410": 2, "8189": 3, "8087": 4, "8436": 5, "8421": 6, "8048": 7}),
    ("2026-05-16", {"8420": 1, "8999": 2, "8410": ("RDG", 2.9), "8087": 3, "8436": 4, "8421": 5, "8189": "RET", "8048": "RET"}),
    ("2026-05-30", {"8420": 1, "8087": 2, "8189": 3, "8410": 4, "8901": 5, "8048": 6, "8436": 7}),
]
# Late Spring (6 races)
ls = series_id(SON, "Late Spring")
late_spring = [
    ("2026-06-13", {"8410": 1, "8420": 2, "8087": 3, "8189": 4, "8436": 5, "8421": 6}),
    ("2026-06-20", {"8420": 1, "8410": 2, "8189": 3, "8901": 4, "8436": 5}),
    ("2026-06-27", {"8420": 1, "8410": 2, "8421": 3, "8189": 4, "8436": 5, "8048": ("RDG", 10)}),
    ("2026-07-04", {"8420": 1, "8189": 2, "8087": 3, "8436": 4, "8410": 5, "8421": 6}),
    ("2026-07-11", {"8420": 1, "8410": 2, "8436": 3, "8189": 4, "8421": 5}),
    ("2026-07-18", {"8999": 1, "8420": 2, "8410": 3, "8436": 4, "8189": 5, "8421": 6, "8901": 7}),
]
# Summer (2 races) - excluded from overall
su = series_id(SON, "Summer")
summer = [
    ("2026-07-25", {"8410": 1, "8421": 2, "8189": 3}),
    ("2026-08-01", {"8087": 1, "8410": 2, "8421": 3}),
]

# ============================= DRAGON =============================
DRA = cls_id("Dragon")
# John Field Trophy (3 races), entries 9
jf = series_id(DRA, "John Field Trophy")
john_field = [
    ("2026-08-15", {"GBR760": 1, "GBR823": 2, "GBR597": 3, "GBR675": 4, "GBR704": 5, "GBR747": "DNS"}),
    ("2026-08-22", {"GBR675": 1, "GBR747": 2, "GBR689": 3, "GBR597": 4,
                     "GBR760": ("RDG", 5.5), "GBR823": ("RDG", 6.0), "GBR560": ("RDG", 10)}),
    ("2026-08-29", {"GBR704": 1, "GBR675": 2, "GBR597": 3, "GBR689": 4}),
]
# Dragon Flagon (R1 was all-DNC/abandoned; import the 5 sailed races)
df = series_id(DRA, "Dragon Flagon")
dragon_flagon = [
    ("2026-06-13", {"GBR560": 1, "GBR823": 2, "GBR704": 3, "GBR675": 4, "GBR726": 5, "GBR747": 6, "GBR689": 7, "GBR597": 8}),
    ("2026-06-20", {"GBR675": 1, "GBR704": 2, "GBR597": 3, "GBR689": 4}),
    ("2026-06-27", {"GBR675": 1, "GBR823": 2, "GBR760": 3, "GBR597": 4, "GBR689": ("RDG", 5.7), "GBR747": "RET"}),
    ("2026-07-04", {"GBR675": 1, "GBR689": 2, "GBR597": 3, "GBR823": ("RDG", 5.1), "GBR760": ("RDG", 8.0), "GBR560": ("RDG", 8.2)}),
    ("2026-07-11", {"GBR675": 1, "GBR823": 2, "GBR597": 3, "GBR747": 4, "GBR704": 5, "GBR689": 6, "GBR760": 7}),
]

PLAN = [
    (SON, es, early_spring, 9, "10:45"),
    (SON, ls, late_spring, 9, "10:45"),
    (SON, su, summer, 9, "10:45"),
    (DRA, jf, john_field, 9, "10:30"),
    (DRA, df, dragon_flagon, 9, "10:30"),
]

# clear existing published imports first (idempotent re-run)
db.races.delete_many({})

docs = []
for class_id, sid, races, entries, start in PLAN:
    for i, (date, placings) in enumerate(races, start=1):
        docs.append(build_race(class_id, sid, date, i, entries, placings, start))
db.races.insert_many(docs)
print(f"Inserted {len(docs)} published races")
