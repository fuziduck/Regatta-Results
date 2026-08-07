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


DRAGON_SERIES = [
    ("Proton Cup", 1, 1, True),
    ("Dragon Flagon", 2, 1, True),
    ("John Field Trophy", 3, 1, True),
    ("211 Cup", 4, 1, True),
]

cls = db.classes.find_one({"name": "Dragon"})
cid = cls["id"]
removed = db.series.delete_many({"class_id": cid, "year": YEAR}).deleted_count
docs = [{
    "id": str(uuid.uuid4()), "name": n, "class_id": cid, "year": YEAR,
    "discards": d, "included_in_overall": overall, "order": o, "created_at": now_iso(),
} for n, o, d, overall in DRAGON_SERIES]
db.series.insert_many(docs)
print(f"Dragon series: removed {removed}, inserted {len(docs)}")
for s in db.series.find({"class_id": cid, "year": YEAR}, {"_id": 0, "name": 1, "order": 1, "discards": 1}).sort("order", 1):
    print("  ", s["order"], s["name"], "discards", s["discards"])
