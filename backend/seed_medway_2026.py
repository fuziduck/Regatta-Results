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


# Real 2026 Medway Yacht Club fleets (from sailwave.com/results/medway)
FLEETS = {
    "Dragon": [
        ("OCD", "GBR675", "TBC"),
        ("Taniwha", "GBR823", "TBC"),
        ("Repeat Offender", "GBR597", "TBC"),
        ("Tempest", "GBR689", "TBC"),
        ("Aria", "GBR704", "TBC"),
        ("Hands Off", "GBR760", "TBC"),
        ("Whistle", "GBR560", "TBC"),
        ("Suti", "GBR747", "TBC"),
        ("Gandalf", "GBR726", "TBC"),
    ],
    "Sonata": [
        ("Screwloose", "8410", "Paul Kirk"),
        ("Silver Lining", "8421", "Club Boat"),
        ("Red Dwarf 2", "8087", "Rob Hill"),
        ("Bluetack", "8189", "Paul Sharp"),
        ("BD2", "8999", "Alistair Bolton"),
        ("Watersong", "8420", "Luke Hopper"),
        ("Cry Havoc", "8048", "Chris Lyndsey"),
        ("Munchkin", "8436", "Adrian & Julian"),
        ("Araya", "8901", "Hal Courtney"),
    ],
}

# clear demo races so the fleet starts fresh
races_deleted = db.races.delete_many({}).deleted_count

for cname, boats in FLEETS.items():
    cls = db.classes.find_one({"name": cname})
    if not cls:
        cid = str(uuid.uuid4())
        db.classes.insert_one({"id": cid, "name": cname, "default_start_time": "10:30", "created_at": now_iso()})
    else:
        cid = cls["id"]
    removed = db.boats.delete_many({"class_id": cid, "year": YEAR}).deleted_count
    docs = [{
        "id": str(uuid.uuid4()), "name": n, "sail_no": s, "class_id": cid,
        "helm": h, "year": YEAR, "active": True, "created_at": now_iso(),
    } for n, s, h in boats]
    db.boats.insert_many(docs)
    print(f"{cname}: removed {removed}, inserted {len(docs)}")

print(f"races cleared: {races_deleted}")
print("classes:", [c["name"] for c in db.classes.find({}, {"_id": 0, "name": 1})])
