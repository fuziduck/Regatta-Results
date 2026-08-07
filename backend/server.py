from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
import jwt
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


def create_token(role: str) -> str:
    payload = {
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_role(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth_header[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("role")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_admin(role: str = Depends(get_current_role)) -> str:
    if role != "admin":
        raise HTTPException(status_code=403, detail="Race Admin access required")
    return role


def require_officer(role: str = Depends(get_current_role)) -> str:
    if role not in ("officer", "admin"):
        raise HTTPException(status_code=403, detail="Race Officer access required")
    return role


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginInput(BaseModel):
    role: str
    pin: str


class ClassInput(BaseModel):
    name: str
    default_start_time: str = "10:30"


class BoatInput(BaseModel):
    name: str
    sail_no: str
    class_id: str
    helm: str
    year: int
    active: bool = True


class SeriesInput(BaseModel):
    name: str
    class_id: str
    year: int
    discards: int = 0
    included_in_overall: bool = True
    order: int = 0
    planned_races: int = 0


class RaceCreateInput(BaseModel):
    date: str
    class_id: str
    series_id: str
    race_number: int
    start_time: Optional[str] = None


class RaceNotificationInput(BaseModel):
    course: Optional[str] = None
    special_rules: Optional[str] = None
    life_jackets: Optional[bool] = None
    start_time: Optional[str] = None


class SelectBoatsInput(BaseModel):
    boat_ids: List[str]


class FinishInput(BaseModel):
    boat_id: str
    finish_time: Optional[str] = None


class ResultAdjustInput(BaseModel):
    position: Optional[int] = None
    code: Optional[str] = None
    finish_time: Optional[str] = None
    penalty_points: Optional[float] = None


RRS_CODES = [
    {"code": "FINISHED", "label": "Finished (use position)"},
    {"code": "DNC", "label": "DNC — Did Not Come to starting area"},
    {"code": "DNS", "label": "DNS — Did Not Start"},
    {"code": "OCS", "label": "OCS — On Course Side at start"},
    {"code": "DNF", "label": "DNF — Did Not Finish"},
    {"code": "RET", "label": "RET — Retired"},
    {"code": "DSQ", "label": "DSQ — Disqualified"},
    {"code": "DNE", "label": "DNE — Disqualification not excludable"},
    {"code": "RDG", "label": "RDG — Redress given (manual points)"},
]
NON_DISCARDABLE = {"DNE"}
FINISH_CODES = {"FINISHED"}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@api_router.post("/auth/login")
async def login(data: LoginInput):
    role = data.role
    pin = data.pin.strip()
    if role == "officer" and pin == os.environ["RACE_OFFICER_PIN"]:
        return {"token": create_token("officer"), "role": "officer"}
    if role == "admin" and pin == os.environ["RACE_ADMIN_PIN"]:
        return {"token": create_token("admin"), "role": "admin"}
    raise HTTPException(status_code=401, detail="Incorrect passcode")


@api_router.get("/auth/me")
async def me(role: str = Depends(get_current_role)):
    return {"role": role}


# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------
@api_router.get("/classes")
async def get_classes():
    items = await db.classes.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    return items


@api_router.post("/classes")
async def create_class(data: ClassInput, _: str = Depends(require_admin)):
    doc = {"id": new_id(), "name": data.name, "default_start_time": data.default_start_time, "created_at": now_iso()}
    await db.classes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/classes/{class_id}")
async def update_class(class_id: str, data: ClassInput, _: str = Depends(require_admin)):
    await db.classes.update_one({"id": class_id}, {"$set": {"name": data.name, "default_start_time": data.default_start_time}})
    return await db.classes.find_one({"id": class_id}, {"_id": 0})


@api_router.delete("/classes/{class_id}")
async def delete_class(class_id: str, _: str = Depends(require_admin)):
    await db.classes.delete_one({"id": class_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Boats
# ---------------------------------------------------------------------------
@api_router.get("/boats")
async def get_boats(class_id: Optional[str] = None, year: Optional[int] = None, active_only: bool = False):
    q = {}
    if class_id:
        q["class_id"] = class_id
    if year:
        q["year"] = year
    if active_only:
        q["active"] = True
    items = await db.boats.find(q, {"_id": 0}).sort("sail_no", 1).to_list(2000)
    return items


@api_router.post("/boats")
async def create_boat(data: BoatInput, _: str = Depends(require_admin)):
    doc = data.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    await db.boats.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/boats/{boat_id}")
async def update_boat(boat_id: str, data: BoatInput, _: str = Depends(require_admin)):
    await db.boats.update_one({"id": boat_id}, {"$set": data.model_dump()})
    return await db.boats.find_one({"id": boat_id}, {"_id": 0})


@api_router.delete("/boats/{boat_id}")
async def delete_boat(boat_id: str, _: str = Depends(require_admin)):
    await db.boats.delete_one({"id": boat_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Series
# ---------------------------------------------------------------------------
@api_router.get("/series")
async def get_series(class_id: Optional[str] = None, year: Optional[int] = None):
    q = {}
    if class_id:
        q["class_id"] = class_id
    if year:
        q["year"] = year
    items = await db.series.find(q, {"_id": 0}).sort("order", 1).to_list(1000)
    return items


@api_router.post("/series")
async def create_series(data: SeriesInput, _: str = Depends(require_admin)):
    doc = data.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    await db.series.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/series/{series_id}")
async def update_series(series_id: str, data: SeriesInput, _: str = Depends(require_admin)):
    await db.series.update_one({"id": series_id}, {"$set": data.model_dump()})
    return await db.series.find_one({"id": series_id}, {"_id": 0})


@api_router.delete("/series/{series_id}")
async def delete_series(series_id: str, _: str = Depends(require_admin)):
    await db.series.delete_one({"id": series_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Races
# ---------------------------------------------------------------------------
async def _class_active_boats(class_id: str, year: int):
    return await db.boats.find({"class_id": class_id, "year": year, "active": True}, {"_id": 0}).to_list(2000)


@api_router.get("/races")
async def get_races(status: Optional[str] = None, class_id: Optional[str] = None,
                    series_id: Optional[str] = None, date: Optional[str] = None):
    q = {}
    if status:
        q["status"] = status
    if class_id:
        q["class_id"] = class_id
    if series_id:
        q["series_id"] = series_id
    if date:
        q["date"] = date
    items = await db.races.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    return items


@api_router.get("/races/{race_id}")
async def get_race(race_id: str):
    race = await db.races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    return race


@api_router.post("/races")
async def create_race(data: RaceCreateInput, _: str = Depends(require_officer)):
    series = await db.series.find_one({"id": data.series_id}, {"_id": 0})
    cls = await db.classes.find_one({"id": data.class_id}, {"_id": 0})
    if not series or not cls:
        raise HTTPException(status_code=400, detail="Invalid class or series")
    year = series["year"]
    boats = await _class_active_boats(data.class_id, year)
    results = [{
        "boat_id": b["id"],
        "code": "DNC",
        "finish_time": None,
        "position": None,
        "penalty_points": 0,
    } for b in boats]
    doc = {
        "id": new_id(),
        "date": data.date,
        "class_id": data.class_id,
        "series_id": data.series_id,
        "year": year,
        "race_number": data.race_number,
        "start_time": data.start_time or cls.get("default_start_time", "10:30"),
        "course": "",
        "special_rules": "",
        "life_jackets": False,
        "status": "setup",
        "entries_count": len(results),
        "results": results,
        "created_at": now_iso(),
    }
    await db.races.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/races/{race_id}/notifications")
async def update_notifications(race_id: str, data: RaceNotificationInput, _: str = Depends(require_officer)):
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    await db.races.update_one({"id": race_id}, {"$set": update})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.post("/races/{race_id}/select-boats")
async def select_boats(race_id: str, data: SelectBoatsInput, _: str = Depends(require_officer)):
    race = await db.races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    selected = set(data.boat_ids)
    results = race["results"]
    for r in results:
        if r["boat_id"] in selected:
            if r["code"] == "DNC":
                r["code"] = "DNS"  # racing, not yet finished
        else:
            r["code"] = "DNC"
            r["finish_time"] = None
            r["position"] = None
    await db.races.update_one({"id": race_id}, {"$set": {"results": results}})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.post("/races/{race_id}/finish")
async def record_finish(race_id: str, data: FinishInput, _: str = Depends(require_officer)):
    race = await db.races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    results = race["results"]
    # next position = count of currently finished boats + 1
    finished = [r for r in results if r["code"] == "FINISHED"]
    next_pos = len(finished) + 1
    for r in results:
        if r["boat_id"] == data.boat_id:
            r["code"] = "FINISHED"
            r["finish_time"] = data.finish_time or now_iso()
            r["position"] = next_pos
    await db.races.update_one({"id": race_id}, {"$set": {"results": results}})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.post("/races/{race_id}/undo-finish")
async def undo_finish(race_id: str, data: FinishInput, _: str = Depends(require_officer)):
    race = await db.races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    results = race["results"]
    for r in results:
        if r["boat_id"] == data.boat_id:
            r["code"] = "DNS"
            r["finish_time"] = None
            r["position"] = None
    # re-sequence remaining finished positions by finish_time
    finished = sorted([r for r in results if r["code"] == "FINISHED"], key=lambda x: x["finish_time"] or "")
    for i, r in enumerate(finished):
        r["position"] = i + 1
    await db.races.update_one({"id": race_id}, {"$set": {"results": results}})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.put("/races/{race_id}/result/{boat_id}")
async def adjust_result(race_id: str, boat_id: str, data: ResultAdjustInput,
                        _: str = Depends(require_officer)):
    race = await db.races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    results = race["results"]
    for r in results:
        if r["boat_id"] == boat_id:
            if data.code is not None:
                r["code"] = data.code
                if data.code != "FINISHED":
                    r["position"] = None
            if data.position is not None:
                r["position"] = data.position
            if data.finish_time is not None:
                r["finish_time"] = data.finish_time
            if data.penalty_points is not None:
                r["penalty_points"] = data.penalty_points
    await db.races.update_one({"id": race_id}, {"$set": {"results": results}})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.post("/races/{race_id}/status/{status}")
async def set_race_status(race_id: str, status: str, _: str = Depends(require_officer)):
    if status not in ("setup", "provisional", "published"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await db.races.update_one({"id": race_id}, {"$set": {"status": status, "published_at": now_iso() if status == "published" else None}})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.delete("/races/{race_id}")
async def delete_race(race_id: str, _: str = Depends(require_officer)):
    await db.races.delete_one({"id": race_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Notifications (public banner)
# ---------------------------------------------------------------------------
@api_router.get("/notifications")
async def get_notifications():
    races = await db.races.find({"status": {"$in": ["setup", "provisional"]}}, {"_id": 0}).to_list(500)
    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(1000)}
    out = []
    for r in races:
        cls = classes.get(r["class_id"], {})
        out.append({
            "race_id": r["id"],
            "class_name": cls.get("name", "Class"),
            "start_time": r.get("start_time"),
            "course": r.get("course"),
            "special_rules": r.get("special_rules"),
            "life_jackets": r.get("life_jackets", False),
            "date": r.get("date"),
        })
    return out


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def result_points(r, entries_count):
    code = r.get("code")
    if code == "FINISHED" and r.get("position"):
        base = float(r["position"])
    elif code == "RDG":
        base = float(r.get("penalty_points") or (entries_count + 1))
    else:
        base = float(entries_count + 1)
    base += float(r.get("penalty_points") or 0) if code == "FINISHED" else 0
    return base


def net_from_scores(scores, discards):
    """scores: list of (points, discardable). Returns (net, total, sorted_points_list)."""
    total = sum(p for p, _ in scores)
    discardable = sorted([p for p, d in scores if d], reverse=True)
    drop = sum(discardable[:discards]) if discards > 0 else 0
    return total - drop, total


async def _series_scores(series):
    """Return (agg, boat_map, race_meta). agg: boat_id -> list of per-race entry dicts, aligned to race_meta."""
    races = await db.races.find({"series_id": series["id"], "status": "published"}, {"_id": 0}).to_list(1000)
    races.sort(key=lambda r: (r.get("date", ""), r.get("race_number", 0)))
    boats = await db.boats.find({"class_id": series["class_id"], "year": series["year"]}, {"_id": 0}).to_list(2000)
    boat_map = {b["id"]: b for b in boats}
    race_meta = [{"race_number": r.get("race_number"), "date": r.get("date")} for r in races]
    agg = {bid: [] for bid in boat_map}
    for race in races:
        entries = race.get("entries_count") or len(race.get("results", []))
        present = {r["boat_id"]: r for r in race["results"]}
        for bid in boat_map:
            r = present.get(bid)
            if r is None:
                agg[bid].append({"points": float(entries + 1), "discardable": True, "position": None, "code": "DNC"})
            else:
                code = r.get("code")
                agg[bid].append({
                    "points": result_points(r, entries),
                    "discardable": code not in NON_DISCARDABLE,
                    "position": r.get("position") if code == "FINISHED" else None,
                    "code": code,
                })
    return agg, boat_map, race_meta


def _tiebreak_key(positions):
    # RRS A8: count of 1sts, 2nds, ... lower count-sorted wins. Build sorted position list.
    return sorted([p for p in positions if p])


async def compute_series_standings(series):
    agg, boat_map, race_meta = await _series_scores(series)
    race_count = len(race_meta)
    # Effective discards never remove every race: at least one always counts.
    discards = min(series.get("discards", 0), max(0, race_count - 1))
    rows = []
    for bid, entries in agg.items():
        b = boat_map.get(bid)
        if not b:
            continue
        # discard the highest-scoring discardable races for this boat
        discardable_idx = sorted(
            [i for i, e in enumerate(entries) if e["discardable"]],
            key=lambda i: entries[i]["points"], reverse=True,
        )
        drop = set(discardable_idx[:discards])
        total = sum(e["points"] for e in entries)
        net = sum(e["points"] for i, e in enumerate(entries) if i not in drop)
        positions = [e["position"] for e in entries]
        scores = [{"points": round(e["points"], 1), "code": e["code"], "discarded": i in drop}
                  for i, e in enumerate(entries)]
        rows.append({
            "boat_id": bid,
            "boat_name": b["name"],
            "sail_no": b["sail_no"],
            "helm": b["helm"],
            "net": round(net, 1),
            "total": round(total, 1),
            "scores": scores,
            "positions": positions,
            "_tb": _tiebreak_key(positions),
        })
    rows.sort(key=lambda x: (x["net"], x["_tb"]))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
        r.pop("_tb", None)
    return {"race_count": race_count, "discards": discards,
            "configured_discards": series.get("discards", 0),
            "planned_races": series.get("planned_races", 0),
            "races": race_meta, "standings": rows}


@api_router.get("/standings/series/{series_id}")
async def series_standings(series_id: str):
    series = await db.series.find_one({"id": series_id}, {"_id": 0})
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    return await compute_series_standings(series)


@api_router.get("/standings/overall")
async def overall_standings(class_id: str, year: int):
    all_series = await db.series.find({"class_id": class_id, "year": year, "included_in_overall": True}, {"_id": 0}).to_list(1000)
    boats = await db.boats.find({"class_id": class_id, "year": year}, {"_id": 0}).to_list(2000)
    boat_map = {b["id"]: b for b in boats}
    totals = {}
    series_names = []
    for series in sorted(all_series, key=lambda s: s.get("order", 0)):
        series_names.append(series["name"])
        result = await compute_series_standings(series)
        for row in result["standings"]:
            totals.setdefault(row["boat_id"], {"total": 0.0, "per_series": {}})
            totals[row["boat_id"]]["total"] += row["net"]
            totals[row["boat_id"]]["per_series"][series["name"]] = row["net"]
    rows = []
    for bid, data in totals.items():
        b = boat_map.get(bid)
        if not b:
            continue
        rows.append({
            "boat_id": bid,
            "boat_name": b["name"],
            "sail_no": b["sail_no"],
            "helm": b["helm"],
            "net": round(data["total"], 1),
            "per_series": {k: round(v, 1) for k, v in data["per_series"].items()},
        })
    rows.sort(key=lambda x: x["net"])
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return {"series_names": series_names, "standings": rows}


@api_router.get("/rrs-codes")
async def rrs_codes():
    return RRS_CODES


@api_router.get("/")
async def root():
    return {"message": "Sailing Club Racing API"}


# ---------------------------------------------------------------------------
# Seed sample data
# ---------------------------------------------------------------------------
@api_router.post("/seed")
async def seed(_: str = Depends(require_admin)):
    return await run_seed()


async def run_seed():
    if await db.classes.count_documents({}) > 0:
        return {"seeded": False, "message": "Data already present"}
    year = datetime.now(timezone.utc).year
    class_defs = [
        ("Dragon", "10:30"),
        ("Sonata", "10:45"),
        ("Wayfarer", "11:00"),
    ]
    class_ids = {}
    for name, st in class_defs:
        cid = new_id()
        class_ids[name] = cid
        await db.classes.insert_one({"id": cid, "name": name, "default_start_time": st, "created_at": now_iso()})
    series_defs = [
        ("Early Spring", 1, True),
        ("Late Spring", 2, True),
        ("Summer", 3, False),
        ("Early Autumn", 4, True),
        ("Late Autumn", 5, True),
    ]
    for cname, cid in class_ids.items():
        for sname, order, overall in series_defs:
            await db.series.insert_one({
                "id": new_id(), "name": sname, "class_id": cid, "year": year,
                "discards": 1, "included_in_overall": overall, "order": order, "created_at": now_iso(),
            })
    sample_boats = {
        "Dragon": [("Bluebottle", "K1", "James Fisher"), ("Bear", "K3", "Sarah Kite"), ("Antibes", "K7", "Tom Reid"), ("Firefly", "K12", "Ella Watts")],
        "Sonata": [("Whisper", "S22", "Mark Doyle"), ("Escapade", "S45", "Nina Fox"), ("Rebel", "S9", "Owen Blythe")],
        "Wayfarer": [("Puffin", "W101", "Kate Marsh"), ("Osprey", "W88", "Dan Hughes"), ("Petrel", "W54", "Amy Cole")],
    }
    for cname, boats in sample_boats.items():
        for bname, sail, helm in boats:
            await db.boats.insert_one({
                "id": new_id(), "name": bname, "sail_no": sail, "class_id": class_ids[cname],
                "helm": helm, "year": year, "active": True, "created_at": now_iso(),
            })
    return {"seeded": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup():
    await run_seed()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
