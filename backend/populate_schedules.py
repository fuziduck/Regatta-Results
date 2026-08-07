import os
from datetime import datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).parent / ".env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

START = "2026-08-08"  # next race, a Saturday


def saturdays(start, n):
    d0 = datetime.strptime(start, "%Y-%m-%d").date()
    return [(d0 + timedelta(days=7 * i)).isoformat() for i in range(max(0, n))]


for s in db.series.find({}):
    planned = s.get("planned_races", 0) or 0
    races = list(db.races.find({"series_id": s["id"], "status": "published"}, {"_id": 0}))
    races.sort(key=lambda r: (r.get("date", ""), r.get("race_number", 0)))
    sailed = [r["date"] for r in races]
    total = max(planned, len(sailed))
    schedule = sailed + saturdays(START, total - len(sailed))
    db.series.update_one({"id": s["id"]}, {"$set": {"schedule": schedule, "planned_races": total}})
    print(f'{s["name"]:18} sailed={len(sailed)} planned={total} next={schedule[len(sailed)] if len(schedule)>len(sailed) else "-"}')
