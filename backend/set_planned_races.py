import os
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).parent / ".env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

# planned totals per series name
PLANNED = {
    "Early Spring": 5, "Late Spring": 6, "Summer": 6,
    "Early Autumn": 6, "Late Autumn": 6,
    "John Field Trophy": 3, "Dragon Flagon": 6, "Proton Cup": 4, "211 Cup": 3,
}
for name, n in PLANNED.items():
    res = db.series.update_many({"name": name}, {"$set": {"planned_races": n}})
    print(name, "->", n, "updated", res.modified_count)
