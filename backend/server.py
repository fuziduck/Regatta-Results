from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
import jwt
import re
import base64
import bcrypt
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
# Global role PIN for the Webmaster — the one role not bound to a single club.
# (Seeded as the webmaster user account's passcode at startup.)
WEBMASTER_PIN = os.environ.get("WEBMASTER_PIN", "9999")
# Failed-attempt lockout for user accounts (never applied to the webmaster).
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


def create_token(role: str, club_id: str, user_id: Optional[str] = None,
                  username: Optional[str] = None) -> str:
    payload = {
        "role": role,
        "club_id": club_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
        "type": "access",
    }
    if user_id:
        payload["user_id"] = user_id
    if username:
        payload["username"] = username
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(request: Request):
    """Decode the bearer token -> {role, club_id, user_id, username}, or None.

    Tokens minted for a user account are re-validated against the users
    collection on every request, so deactivating or deleting an account
    revokes its sessions immediately. Legacy tokens (no user_id) — minted by
    the shared club-PIN login — pass through on role/club claims alone.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None
    user_id = payload.get("user_id")
    if user_id:
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "passcode_hash": 0})
        if not user or not user.get("active"):
            return None
        return {"role": user.get("role"), "club_id": user.get("club_id"),
                "user_id": user["id"], "username": user.get("username")}
    # Legacy token (minted by the old shared-PIN login, no user account).
    # Club officer/admin tokens keep working for backward compatibility, but
    # the webmaster is now a user account — stale webmaster tokens from the
    # old system must not keep full platform control.
    if payload.get("role") == "webmaster":
        return None
    return {"role": payload.get("role"), "club_id": payload.get("club_id")}


async def require_admin(request: Request) -> dict:
    user = await get_current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("role") not in ("admin", "webmaster"):
        raise HTTPException(status_code=403, detail="Race Admin access required")
    return user


async def require_officer(request: Request) -> dict:
    user = await get_current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("role") not in ("officer", "admin", "webmaster"):
        raise HTTPException(status_code=403, detail="Race Officer access required")
    return user


async def require_webmaster(request: Request) -> dict:
    user = await get_current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("role") != "webmaster":
        raise HTTPException(status_code=403, detail="Webmaster access required")
    return user


def _ensure_club(user: dict, club_id):
    """Guard: an authenticated user may only touch their own club's data.
    The webmaster is the one role that may touch any club."""
    if not user:
        raise HTTPException(status_code=403, detail="Access to this club's data denied")
    if user.get("role") == "webmaster":
        return
    if not club_id or user.get("club_id") != club_id:
        raise HTTPException(status_code=403, detail="Access to this club's data denied")


async def _resolve_club_id(request: Request, club_id: Optional[str] = None) -> Optional[str]:
    """The club scope for a request.

    - Anonymous callers (public pages): the explicit club_id query param.
    - Race Officer / Race Admin: always their own club — the param can never
      widen access to another club.
    - Webmaster: any club_id param (or None for all clubs).
    """
    user = await get_current_user(request)
    if not user:
        return club_id
    if user.get("role") == "webmaster":
        return club_id
    return user.get("club_id")


async def _club_class_ids(club_id: Optional[str]):
    """ids of all classes belonging to a club (None when unscoped)."""
    if not club_id:
        return None
    classes = await db.classes.find({"club_id": club_id}, {"_id": 0, "id": 1}).to_list(1000)
    return [c["id"] for c in classes]


async def _class_club_id(class_id) -> Optional[str]:
    cls = await db.classes.find_one({"id": class_id}, {"_id": 0, "club_id": 1})
    return (cls or {}).get("club_id")


async def _class_of_club(class_id: str, user: dict):
    """Return the class if it belongs to the user's club, else raise."""
    cls = await db.classes.find_one({"id": class_id}, {"_id": 0})
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    _ensure_club(user, cls.get("club_id"))
    return cls


async def _series_of_club(series_id: str, user: dict):
    series = await db.series.find_one({"id": series_id}, {"_id": 0})
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    _ensure_club(user, await _class_club_id(series.get("class_id")))
    return series


async def _boat_of_club(boat_id: str, user: dict):
    boat = await db.boats.find_one({"id": boat_id}, {"_id": 0})
    if not boat:
        raise HTTPException(status_code=404, detail="Boat not found")
    _ensure_club(user, await _class_club_id(boat.get("class_id")))
    return boat


async def _race_of_club(race_id: str, user: dict):
    race = await db.races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    _ensure_club(user, await _class_club_id(race.get("class_id")))
    return race


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginInput(BaseModel):
    role: str
    # Per-user login: username + passcode. `pin` is kept as an alias for
    # `passcode` so legacy clients and the shared club-PIN fallback still work.
    username: Optional[str] = None
    passcode: Optional[str] = None
    pin: Optional[str] = None
    club_id: Optional[str] = None


class UserInput(BaseModel):
    club_id: Optional[str] = None
    role: Literal["officer", "admin"] = "officer"
    username: str
    name: str = ""
    passcode: str = ""


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["officer", "admin"]] = None
    active: Optional[bool] = None
    passcode: Optional[str] = None


class ClubInput(BaseModel):
    name: str
    slug: Optional[str] = None
    color: str = "#0A369D"
    officer_pin: str = ""
    admin_pin: str = ""


class AdvertUpdate(BaseModel):
    """Editable advert metadata (the image itself is uploaded separately)."""
    name: Optional[str] = None
    link_url: Optional[str] = None
    active: Optional[bool] = None
    order: Optional[int] = None


class ClassInput(BaseModel):
    name: str
    default_start_time: str = "10:30"
    # Scoring system for the class: "one_design" (finish order), "irc"
    # (corrected = elapsed x TCC, per IRC Rule 12.2) or "py" (Portsmouth
    # Yardstick: corrected = elapsed x 1000 / PY).
    scoring_mode: Literal["one_design", "irc", "py"] = "one_design"
    # Required when a webmaster creates a class (officer/admin default to
    # their own club).
    club_id: Optional[str] = None


class BoatInput(BaseModel):
    name: str
    sail_no: str
    class_id: str
    helm: str
    year: int
    active: bool = True
    # IRC Time Correction Coefficient (rating certificate); None for
    # one-design classes. Corrected time = elapsed x TCC.
    tcc: Optional[float] = None
    # RYA Portsmouth Yardstick number (e.g. 1013); None for one-design
    # classes. Corrected time = elapsed x 1000 / PY. A boat may carry both
    # TCC and PY and the class's scoring mode decides which is used.
    py: Optional[float] = None
    # Boat make/model (used mainly for the cruiser fleet, e.g. "Bavaria 34").
    boat_type: Optional[str] = None
    # Home club label shown on results (defaults to the club that set up the
    # fleet; free text so visiting boats from other clubs can be named).
    home_club: Optional[str] = ""


class SeriesInput(BaseModel):
    name: str
    class_id: str
    year: int
    # Scoring system for THIS series: "one_design" (finish order), "irc"
    # (corrected = elapsed x TCC) or "py" (Portsmouth: corrected =
    # elapsed x 1000 / PY). The choice lives on the series, not the class or
    # boat, so a fleet can race IRC one series and PY the next. Races without
    # a series (legacy) fall back to the class's legacy scoring_mode.
    scoring_mode: Literal["one_design", "irc", "py"] = "one_design"
    discards: int = 0
    included_in_overall: bool = True
    order: int = 0
    planned_races: int = 0
    schedule: Optional[List[str]] = None
    # Sailing-instruction option: apply RRS A5.3 so boats that came to the
    # starting area but did not finish score start-area entries + 1 (better
    # than DNC), instead of the A5.2 default of series entries + 1 for all.
    use_a5_3: bool = False
    # RYA/Sailwave convention used by many clubs (mutually exclusive with
    # use_a5_3): boats that came to the starting area but did not finish score
    # one more than the number of boats that FINISHED the race. DNC always
    # scores series entries + 1 regardless of this flag.
    use_finishers: bool = False


class GenScheduleInput(BaseModel):
    start_date: str
    count: Optional[int] = None


class RaceCreateInput(BaseModel):
    date: str
    class_id: str
    series_id: str
    race_number: int
    start_time: Optional[str] = None
    # Officer's device UTC offset (minutes east of UTC, e.g. 60 for BST)
    # captured when the race is created, so the scheduled-start fallback lines
    # up with the device-UTC finish times recorded on tap.
    start_tz_offset_minutes: Optional[int] = None


class RaceNotificationInput(BaseModel):
    course: Optional[str] = None
    special_rules: Optional[str] = None
    life_jackets: Optional[bool] = None
    start_time: Optional[str] = None
    start_tz_offset_minutes: Optional[int] = None


class StartRaceInput(BaseModel):
    start_time: Optional[str] = None  # ISO timestamp; null clears the gun


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
    # Corrected elapsed time in seconds for a finished boat (e.g. when the
    # finish-button tap recorded the wrong duration). Converts to finish_time
    # from the race start and re-sequences the race.
    elapsed_seconds: Optional[float] = None


# RRS Appendix A10 scoring abbreviations (2025-2028).
RRS_CODES = [
    {"code": "FINISHED", "label": "Finished (use position)"},
    {"code": "DNC", "label": "DNC — Did not come to starting area"},
    {"code": "DNS", "label": "DNS — Did not start"},
    {"code": "OCS", "label": "OCS — On course side at start"},
    {"code": "UFD", "label": "UFD — Disqualification under rule 30.3"},
    {"code": "BFD", "label": "BFD — Disqualification under rule 30.4"},
    {"code": "ZFP", "label": "ZFP — 20% penalty under rule 30.2 (scored per rule 44.3(c))"},
    {"code": "SCP", "label": "SCP — Scoring penalty taken (rule 44.3)"},
    {"code": "NSC", "label": "NSC — Did not sail the course"},
    {"code": "DNF", "label": "DNF — Did not finish"},
    {"code": "RET", "label": "RET — Retired"},
    {"code": "DSQ", "label": "DSQ — Disqualified"},
    {"code": "DNE", "label": "DNE — Disqualification not excludable"},
    {"code": "DPI", "label": "DPI — Discretionary penalty imposed (manual points)"},
    {"code": "RDG", "label": "RDG — Redress given (manual points)"},
]
# Rule A2.1: only DNE may not be excluded from a series score.
NON_DISCARDABLE = {"DNE"}
FINISH_CODES = {"FINISHED"}
# Codes that mean the boat did not finish (or never started): scoring them on a
# boat that had finished triggers RRS A6.1 (boats behind move up one place).
POST_FINISH_RETIRE_CODES = {"DNC", "DNS", "OCS", "UFD", "BFD", "DNF", "RET", "DSQ", "DNE", "NSC"}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def hash_passcode(passcode: str) -> str:
    """bcrypt hash of a user passcode (bcrypt caps input at 72 bytes)."""
    return bcrypt.hashpw(passcode.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_passcode(passcode: str, passcode_hash: str) -> bool:
    try:
        return bcrypt.checkpw(passcode.encode("utf-8"), passcode_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


async def _record_failed_login(user: dict):
    """Count a failed attempt, locking the account after MAX_FAILED_ATTEMPTS
    for LOCKOUT_MINUTES."""
    n = (user.get("failed_attempts") or 0) + 1
    if n >= MAX_FAILED_ATTEMPTS:
        await db.users.update_one({"id": user["id"]}, {"$set": {
            "failed_attempts": 0,
            "locked_until": (datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)).isoformat(),
        }})
    else:
        await db.users.update_one({"id": user["id"]}, {"$set": {"failed_attempts": n}})


def _user_locked(user: dict) -> bool:
    locked = user.get("locked_until")
    if not locked:
        return False
    try:
        return datetime.fromisoformat(locked) > datetime.now(timezone.utc)
    except ValueError:
        return False


async def _login_user(u: dict, passcode: str) -> dict:
    """Verify a passcode against a user account with failed-attempt lockout.
    Lockout never applies to the webmaster singleton, so the master key can't
    lock itself out of the system."""
    if not u or not u.get("active"):
        raise HTTPException(status_code=401, detail="Incorrect username or passcode")
    if u.get("role") != "webmaster":
        if _user_locked(u):
            raise HTTPException(status_code=423, detail="Account locked — too many failed attempts. Try again later.")
        if not verify_passcode(passcode, u.get("passcode_hash", "")):
            await _record_failed_login(u)
            raise HTTPException(status_code=401, detail="Incorrect username or passcode")
    elif not verify_passcode(passcode, u.get("passcode_hash", "")):
        raise HTTPException(status_code=401, detail="Incorrect username or passcode")
    await db.users.update_one({"id": u["id"]}, {"$set": {"failed_attempts": 0, "last_login": now_iso()},
                                                "$unset": {"locked_until": ""}})
    return u


@api_router.post("/auth/login")
async def login(data: LoginInput):
    role = data.role
    passcode = (data.passcode or data.pin or "").strip()
    if role == "webmaster":
        wm = await db.users.find_one({"role": "webmaster", "club_id": None}, {"_id": 0})
        if not wm:
            raise HTTPException(status_code=401, detail="Incorrect username or passcode")
        u = await _login_user(wm, passcode)
        token = create_token("webmaster", None, u["id"], u.get("username"))
        return {"token": token, "role": "webmaster", "club_id": None, "club_name": None,
                "username": u.get("username"), "name": u.get("name")}
    if role not in ("officer", "admin"):
        raise HTTPException(status_code=401, detail="Unknown role")
    club = None
    if data.club_id:
        club = await db.clubs.find_one({"id": data.club_id}, {"_id": 0})
    else:
        # No club chosen: only unambiguous if exactly one club exists.
        clubs = await db.clubs.find({}, {"_id": 0}).to_list(100)
        if len(clubs) == 1:
            club = clubs[0]
    if not club:
        raise HTTPException(status_code=404, detail="Club not found — choose your club")
    if data.username:
        # Per-user login — the primary path. The account's role is
        # authoritative: a username only ever logs into the club it belongs
        # to, under the role the account was given.
        user = await db.users.find_one({"club_id": club["id"], "username": data.username.strip()}, {"_id": 0})
        u = await _login_user(user, passcode)
        role = u["role"]
        token = create_token(role, club["id"], u["id"], u.get("username"))
        return {"token": token, "role": role, "club_id": club["id"],
                "club_name": club.get("name"), "username": u.get("username"),
                "name": u.get("name")}
    # Legacy shared-PIN login (the club master passcode, set by the webmaster).
    expected = club.get("admin_pin") if role == "admin" else club.get("officer_pin")
    if not expected or passcode != expected:
        raise HTTPException(status_code=401, detail="Incorrect passcode")
    return {"token": create_token(role, club["id"]), "role": role,
            "club_id": club["id"], "club_name": club.get("name")}


@api_router.get("/auth/me")
async def me(request: Request):
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    club_name = None
    if user.get("club_id"):
        club = await db.clubs.find_one({"id": user["club_id"]}, {"_id": 0, "name": 1})
        club_name = (club or {}).get("name")
    return {"role": user.get("role"), "club_id": user.get("club_id"),
            "club_name": club_name, "username": user.get("username"),
            "name": user.get("name")}


# ---------------------------------------------------------------------------
# Users (per-club logins)
# ---------------------------------------------------------------------------
def _user_public(u: dict) -> dict:
    """User without the passcode hash (never leak credentials)."""
    return {k: v for k, v in u.items() if k not in ("passcode_hash",)}


@api_router.get("/users")
async def get_users(request: Request, club_id: Optional[str] = None):
    """List users. Race Admins only ever see their own club's users; the
    webmaster may list any club's (or all, when no club_id is given)."""
    user = await require_admin(request)
    q = {}
    if user.get("role") == "webmaster":
        if club_id:
            q["club_id"] = club_id
    else:
        q["club_id"] = user.get("club_id")
    users = await db.users.find(q, {"_id": 0}).sort("role", 1).sort("username", 1).to_list(500)
    return [_user_public(u) for u in users]


@api_router.post("/users")
async def create_user(data: UserInput, user: dict = Depends(require_admin)):
    """Create a login for a club. Race Admins may only create officer/admin
    logins inside their own club; the webmaster may create them for any club."""
    is_webmaster = user.get("role") == "webmaster"
    club_id = (data.club_id or user.get("club_id")) if is_webmaster else user.get("club_id")
    if not club_id:
        raise HTTPException(status_code=400, detail="club_id is required")
    _ensure_club(user, club_id)
    username = data.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    passcode = data.passcode.strip()
    if len(passcode) < 4:
        raise HTTPException(status_code=400, detail="Passcode must be at least 4 characters")
    if await db.users.find_one({"club_id": club_id, "username": username}, {"_id": 0}):
        raise HTTPException(status_code=400, detail=f"Username '{username}' already exists for this club")
    doc = {
        "id": new_id(), "club_id": club_id, "role": data.role,
        "username": username, "name": data.name.strip(),
        "passcode_hash": hash_passcode(passcode),
        "active": True, "created_by": user.get("user_id") or "webmaster",
        "created_at": now_iso(), "failed_attempts": 0,
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    return _user_public(doc)


@api_router.put("/users/{user_id}")
async def update_user(user_id: str, data: UserUpdate, user: dict = Depends(require_admin)):
    """Edit a user: display name, role, active flag or passcode reset.
    Race Admins may only touch their own club's users, may never touch the
    webmaster account, and may never deactivate or re-role themselves."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    is_webmaster = user.get("role") == "webmaster"
    if not is_webmaster:
        _ensure_club(user, target.get("club_id"))
        if target.get("role") == "webmaster":
            raise HTTPException(status_code=403, detail="Cannot modify the webmaster account")
    if user.get("user_id") == user_id and (data.active is False or (data.role and data.role != target.get("role"))):
        raise HTTPException(status_code=400, detail="You cannot deactivate or change the role of your own account")
    update = {}
    if data.name is not None:
        update["name"] = data.name.strip()
    if data.role is not None:
        update["role"] = data.role
    if data.active is not None:
        update["active"] = data.active
    if data.passcode:
        update["passcode_hash"] = hash_passcode(data.passcode.strip())
    if update:
        await db.users.update_one({"id": user_id}, {"$set": update})
    return _user_public(await db.users.find_one({"id": user_id}, {"_id": 0}))


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_admin)):
    """Remove a user login. An admin may not delete their own account, and a
    club must always keep at least one active admin."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    is_webmaster = user.get("role") == "webmaster"
    if not is_webmaster:
        _ensure_club(user, target.get("club_id"))
        if target.get("role") == "webmaster":
            raise HTTPException(status_code=403, detail="Cannot delete the webmaster account")
    if user.get("user_id") == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if target.get("role") == "admin" and not is_webmaster:
        active_admins = await db.users.count_documents(
            {"club_id": target.get("club_id"), "role": "admin", "active": True})
        if active_admins <= 1:
            raise HTTPException(status_code=400, detail="A club must keep at least one active admin")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}


async def _ensure_club_users(club: dict):
    """Backfill the legacy club-PIN accounts as per-club users.

    Each club keeps one 'officer' and one 'admin' account, seeded from (and
    kept in sync with) the club's shared PINs — so existing PIN logins keep
    working as username+passcode logins. Any additional users created by the
    race admin or webmaster are never touched.
    """
    if not club or not club.get("id"):
        return
    for role, pin in (("officer", club.get("officer_pin")), ("admin", club.get("admin_pin"))):
        if not pin:
            continue
        existing = await db.users.find_one({"club_id": club["id"], "role": role, "username": role}, {"_id": 0})
        if existing:
            if not verify_passcode(pin, existing.get("passcode_hash", "")):
                await db.users.update_one({"id": existing["id"]}, {"$set": {"passcode_hash": hash_passcode(pin)}})
            continue
        await db.users.insert_one({
            "id": new_id(), "club_id": club["id"], "role": role,
            "username": role, "name": f"{club.get('name', 'Club')} {role.title()}",
            "passcode_hash": hash_passcode(pin), "active": True,
            "created_by": "system", "created_at": now_iso(), "failed_attempts": 0,
        })


async def ensure_webmaster_user():
    """Seed the singleton webmaster account from WEBMASTER_PIN (default 9999)."""
    wm = await db.users.find_one({"role": "webmaster", "club_id": None}, {"_id": 0})
    if not wm:
        await db.users.insert_one({
            "id": new_id(), "club_id": None, "role": "webmaster",
            "username": "webmaster", "name": "Webmaster",
            "passcode_hash": hash_passcode(WEBMASTER_PIN),
            "active": True, "created_by": "system", "created_at": now_iso(),
            "failed_attempts": 0,
        })
    return wm


async def _ensure_all_club_users():
    clubs = await db.clubs.find({}, {"_id": 0}).to_list(1000)
    for club in clubs:
        await _ensure_club_users(club)

# ---------------------------------------------------------------------------
# Clubs
# ---------------------------------------------------------------------------
def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "club"


def _club_public(club: dict) -> dict:
    """Club without the PIN fields (never leak passcodes)."""
    return {k: v for k, v in club.items() if k not in ("officer_pin", "admin_pin")}


@api_router.get("/clubs")
async def get_clubs():
    clubs = await db.clubs.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return [_club_public(c) for c in clubs]


@api_router.get("/clubs/manage")
async def clubs_manage(user: dict = Depends(require_webmaster)):
    """Webmaster-only: full club documents including passcodes, so the
    webmaster can edit (and change) them. Public /clubs never leaks PINs."""
    return await db.clubs.find({}, {"_id": 0}).sort("name", 1).to_list(100)


@api_router.get("/clubs/directory")
async def clubs_directory(year: Optional[int] = None):
    """Front-page data: every club with its classes and each class's most
    recent published race's top three finishers.

    Pass `year` to view a specific season: the latest result is scoped to that
    year, and a club is included when any of its classes has either published
    results or a series set up ("planned") for that year — so clubs with a
    pre-arranged future season appear before any racing has happened."""
    clubs = await db.clubs.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    out = []
    for club in clubs:
        classes = await db.classes.find({"club_id": club["id"]}, {"_id": 0}).sort("name", 1).to_list(200)
        class_info = []
        for c in classes:
            latest = None
            q = {"class_id": c["id"], "status": "published"}
            if year:
                q["year"] = year
            races = await db.races.find(q, {"_id": 0})\
                .sort("date", -1).sort("race_number", -1).limit(1).to_list(1)
            if races:
                r = races[0]
                finished = sorted(
                    [x for x in r.get("results", []) if x.get("code") == "FINISHED" and x.get("position")],
                    key=lambda x: x["position"],
                )[:3]
                bids = [x["boat_id"] for x in finished]
                boats = {b["id"]: b for b in await db.boats.find({"id": {"$in": bids}}, {"_id": 0}).to_list(50)}
                mode = None
                if r.get("series_id"):
                    ser = await db.series.find_one({"id": r["series_id"]}, {"_id": 0, "scoring_mode": 1})
                    mode = (ser or {}).get("scoring_mode")
                latest = {
                    "race_number": r.get("race_number"),
                    "date": r.get("date"),
                    "scoring_mode": mode or c.get("scoring_mode") or "one_design",
                    "top3": [{"position": x["position"],
                               "boat": boats.get(x["boat_id"], {}).get("name", "?"),
                               "sail_no": boats.get(x["boat_id"], {}).get("sail_no", "")}
                              for x in finished],
                }
            planned_series = []
            # Show the season's planned series for the current year too — so a
            # class whose series hasn't started yet lists what's set up instead
            # of just "No published races yet".
            series_year = year or datetime.now(tz=timezone.utc).year
            if series_year:
                series = await db.series.find({"class_id": c["id"], "year": series_year},
                                              {"_id": 0, "name": 1, "planned_races": 1,
                                               "order": 1, "schedule": 1}).to_list(50)

                def _series_first_date(s):
                    dates = sorted(d for d in (s.get("schedule") or []) if isinstance(d, str))
                    return dates[0] if dates else None

                def _series_sort_key(s):
                    # Soonest series first: by the first scheduled date; series
                    # without a schedule fall back to their display order.
                    first = _series_first_date(s)
                    if first:
                        return (0, first)
                    return (1, s.get("order") or 0)

                series.sort(key=_series_sort_key)
                planned_series = [{"name": s.get("name", ""),
                                   "planned_races": s.get("planned_races", 0),
                                   "first_date": _series_first_date(s)} for s in series]
            class_info.append({"id": c["id"], "name": c["name"],
                               "scoring_mode": c.get("scoring_mode", "one_design"),
                               "latest": latest, "planned_series": planned_series})
        if year and not any(ci["latest"] or ci["planned_series"] for ci in class_info):
            continue  # nothing raced or planned that season — omit the club
        out.append({"id": club["id"], "name": club["name"], "slug": club.get("slug"),
                    "color": club.get("color", "#0A369D"), "icon": club.get("icon"),
                    "classes": class_info})
    return out


@api_router.get("/seasons")
async def seasons(club_id: Optional[str] = None):
    """Distinct years that have any series set up. Public — the front page
    uses it to show only the future-year buttons that actually have a
    planned season (optionally scoped to one club's series)."""
    q = {}
    if club_id:
        ids = await _club_class_ids(club_id)
        if not ids:
            return {"years": []}  # club has no classes, so no series
        q["class_id"] = {"$in": ids}
    years = await db.series.distinct("year", q)
    return {"years": sorted(y for y in years if isinstance(y, int))}


@api_router.post("/clubs")
async def create_club(data: ClubInput, user: dict = Depends(require_webmaster)):
    slug = (data.slug or slugify(data.name)).lower()
    if await db.clubs.find_one({"slug": slug}, {"_id": 0}):
        slug = f"{slug}-{new_id()[:4]}"
    doc = {"id": new_id(), "name": data.name, "slug": slug, "color": data.color,
           "officer_pin": data.officer_pin, "admin_pin": data.admin_pin,
           "created_at": now_iso()}
    await db.clubs.insert_one(doc)
    doc.pop("_id", None)
    await _ensure_club_users(doc)
    return _club_public(doc)


@api_router.put("/clubs/{club_id}")
async def update_club(club_id: str, data: ClubInput, user: dict = Depends(require_webmaster)):
    club = await db.clubs.find_one({"id": club_id}, {"_id": 0})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    update = {"name": data.name, "color": data.color,
              "officer_pin": data.officer_pin, "admin_pin": data.admin_pin}
    if data.slug:
        update["slug"] = data.slug.lower()
    await db.clubs.update_one({"id": club_id}, {"$set": update})
    await _ensure_club_users({**club, **update})
    return _club_public(await db.clubs.find_one({"id": club_id}, {"_id": 0}))


@api_router.put("/clubs/{club_id}/icon")
async def upload_club_icon(club_id: str, user: dict = Depends(require_admin), file: UploadFile = File(...)):
    """Set a club's icon (PNG/JPG/WebP etc, up to 512 KB). The club's own
    race admin may set their club's icon; the webmaster may set any club's.
    Stored as a base64 data URL on the club doc — no file storage to manage.
    """
    _ensure_club(user, club_id)
    club = await db.clubs.find_one({"id": club_id}, {"_id": 0})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    data = await file.read()
    if len(data) > 512 * 1024:
        raise HTTPException(status_code=400, detail="Icon must be 512 KB or smaller")
    ctype = file.content_type or "image/png"
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload must be an image file")
    icon = f"data:{ctype};base64,{base64.b64encode(data).decode()}"
    await db.clubs.update_one({"id": club_id}, {"$set": {"icon": icon}})
    return _club_public(await db.clubs.find_one({"id": club_id}, {"_id": 0}))


@api_router.delete("/clubs/{club_id}/icon")
async def delete_club_icon(club_id: str, user: dict = Depends(require_admin)):
    """Remove a club's icon so the letter fallback returns."""
    _ensure_club(user, club_id)
    await db.clubs.update_one({"id": club_id}, {"$unset": {"icon": ""}})
    return _club_public(await db.clubs.find_one({"id": club_id}, {"_id": 0}))


@api_router.delete("/clubs/{club_id}")
async def delete_club(club_id: str, user: dict = Depends(require_webmaster)):
    n = await db.classes.count_documents({"club_id": club_id})
    if n:
        raise HTTPException(status_code=400,
                            detail="Club still has classes — delete its classes first")
    await db.clubs.delete_one({"id": club_id})
    await db.users.delete_many({"club_id": club_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Adverts (webmaster-managed; shown interleaved on public pages)
# ---------------------------------------------------------------------------
ADVERT_IMAGE_MAX = 2 * 1024 * 1024


@api_router.get("/adverts")
async def get_adverts():
    """Public: active adverts only, in display order. The rotation (rolling
    window capped at 10 per page load) is chosen client-side on refresh."""
    docs = await db.adverts.find({"active": True}, {"_id": 0}).sort("order", 1).to_list(100)
    return [{k: a.get(k) for k in ("id", "name", "image", "link_url")} for a in docs]


@api_router.get("/adverts/manage")
async def adverts_manage(user: dict = Depends(require_webmaster)):
    """Webmaster-only: every advert, active or not, with its metadata."""
    return await db.adverts.find({}, {"_id": 0}).sort("order", 1).to_list(100)


async def _read_advert_image(file: UploadFile) -> str:
    """Validate + read an advert image into a base64 data URL (2 MB cap)."""
    data = await file.read()
    if len(data) > ADVERT_IMAGE_MAX:
        raise HTTPException(status_code=400, detail="Advert image must be 2 MB or smaller")
    ctype = file.content_type or "image/png"
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload must be an image file")
    return f"data:{ctype};base64,{base64.b64encode(data).decode()}"


@api_router.post("/adverts")
async def create_advert(user: dict = Depends(require_webmaster),
                        name: str = Form(""), link_url: str = Form(""),
                        active: bool = Form(True), file: UploadFile = File(None)):
    """Create an advert. The image is optional at creation (the card then
    shows a placeholder) and can be added or replaced later via PUT image."""
    order = await db.adverts.count_documents({})
    image = await _read_advert_image(file) if file else None
    doc = {"id": new_id(), "name": name, "link_url": link_url, "active": bool(active),
           "order": order, "image": image, "created_at": now_iso()}
    await db.adverts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/adverts/{advert_id}")
async def update_advert(advert_id: str, data: AdvertUpdate,
                        user: dict = Depends(require_webmaster)):
    doc = await db.adverts.find_one({"id": advert_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Advert not found")
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if update:
        await db.adverts.update_one({"id": advert_id}, {"$set": update})
    return await db.adverts.find_one({"id": advert_id}, {"_id": 0})


@api_router.put("/adverts/{advert_id}/image")
async def upload_advert_image(advert_id: str, user: dict = Depends(require_webmaster),
                              file: UploadFile = File(...)):
    if not await db.adverts.find_one({"id": advert_id}, {"_id": 0}):
        raise HTTPException(status_code=404, detail="Advert not found")
    await db.adverts.update_one({"id": advert_id},
                                {"$set": {"image": await _read_advert_image(file)}})
    return await db.adverts.find_one({"id": advert_id}, {"_id": 0})


@api_router.delete("/adverts/{advert_id}")
async def delete_advert(advert_id: str, user: dict = Depends(require_webmaster)):
    await db.adverts.delete_one({"id": advert_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------
@api_router.get("/classes")
async def get_classes(request: Request, club_id: Optional[str] = None):
    q = {}
    club = await _resolve_club_id(request, club_id)
    if club:
        q["club_id"] = club
    items = await db.classes.find(q, {"_id": 0}).sort("name", 1).to_list(1000)
    return items


@api_router.post("/classes")
async def create_class(data: ClassInput, user: dict = Depends(require_admin)):
    club_id = data.club_id or user.get("club_id")
    if not club_id:
        raise HTTPException(status_code=400, detail="club_id is required")
    _ensure_club(user, club_id)
    doc = {"id": new_id(), "club_id": club_id, "name": data.name,
           "default_start_time": data.default_start_time,
           "scoring_mode": data.scoring_mode, "created_at": now_iso()}
    await db.classes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/classes/{class_id}")
async def update_class(class_id: str, data: ClassInput, user: dict = Depends(require_admin)):
    cls = await _class_of_club(class_id, user)
    await db.classes.update_one({"id": class_id}, {"$set": {"name": data.name,
                                  "default_start_time": data.default_start_time, "scoring_mode": data.scoring_mode}})
    return await db.classes.find_one({"id": class_id}, {"_id": 0})


@api_router.delete("/classes/{class_id}")
async def delete_class(class_id: str, user: dict = Depends(require_admin)):
    await _class_of_club(class_id, user)
    await db.classes.delete_one({"id": class_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Boats
# ---------------------------------------------------------------------------
@api_router.get("/boats")
async def get_boats(request: Request, class_id: Optional[str] = None, year: Optional[int] = None,
                   active_only: bool = False, club_id: Optional[str] = None):
    q = {}
    club = await _resolve_club_id(request, club_id)
    if class_id:
        q["class_id"] = class_id
    elif club:
        ids = await _club_class_ids(club)
        if not ids:
            return []
        q["class_id"] = {"$in": ids}
    if year:
        q["year"] = year
    if active_only:
        q["active"] = True
    items = await db.boats.find(q, {"_id": 0}).sort("sail_no", 1).to_list(2000)
    return items


@api_router.post("/boats")
async def create_boat(data: BoatInput, user: dict = Depends(require_admin)):
    await _class_of_club(data.class_id, user)
    doc = data.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    await db.boats.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/boats/{boat_id}")
async def update_boat(boat_id: str, data: BoatInput, user: dict = Depends(require_admin)):
    await _boat_of_club(boat_id, user)
    await _class_of_club(data.class_id, user)
    await db.boats.update_one({"id": boat_id}, {"$set": data.model_dump()})
    return await db.boats.find_one({"id": boat_id}, {"_id": 0})


@api_router.delete("/boats/{boat_id}")
async def delete_boat(boat_id: str, user: dict = Depends(require_admin)):
    await _boat_of_club(boat_id, user)
    await db.boats.delete_one({"id": boat_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Series
# ---------------------------------------------------------------------------
@api_router.get("/series")
async def get_series(request: Request, class_id: Optional[str] = None, year: Optional[int] = None,
                    club_id: Optional[str] = None):
    q = {}
    club = await _resolve_club_id(request, club_id)
    if class_id:
        q["class_id"] = class_id
    elif club:
        ids = await _club_class_ids(club)
        if not ids:
            return []
        q["class_id"] = {"$in": ids}
    if year:
        q["year"] = year
    items = await db.series.find(q, {"_id": 0}).sort("order", 1).to_list(1000)
    return items


@api_router.post("/series")
async def create_series(data: SeriesInput, user: dict = Depends(require_admin)):
    await _class_of_club(data.class_id, user)
    doc = data.model_dump()
    if doc.get("schedule") is None:
        doc["schedule"] = []
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    await db.series.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _sync_race_dates(series_id: str, schedule):
    """Push edited schedule dates onto existing races of the series, matched by race_number."""
    if not schedule:
        return
    races = await db.races.find({"series_id": series_id}, {"_id": 0}).to_list(1000)
    for r in races:
        rn = r.get("race_number")
        if rn and 1 <= rn <= len(schedule):
            new_date = schedule[rn - 1]
            if new_date and new_date != r.get("date"):
                await db.races.update_one({"id": r["id"]}, {"$set": {"date": new_date}})


@api_router.put("/series/{series_id}")
async def update_series(series_id: str, data: SeriesInput, user: dict = Depends(require_admin)):
    await _series_of_club(series_id, user)
    await _class_of_club(data.class_id, user)
    update = data.model_dump()
    if update.get("schedule") is None:
        update.pop("schedule", None)
    await db.series.update_one({"id": series_id}, {"$set": update})
    await _sync_race_dates(series_id, update.get("schedule"))
    return await db.series.find_one({"id": series_id}, {"_id": 0})


def _saturdays_from(start: str, n: int):
    d0 = datetime.strptime(start, "%Y-%m-%d").date()
    return [(d0 + timedelta(days=7 * i)).isoformat() for i in range(max(0, n))]


@api_router.post("/series/{series_id}/generate-schedule")
async def generate_schedule(series_id: str, data: GenScheduleInput, user: dict = Depends(require_admin)):
    series = await _series_of_club(series_id, user)
    total = data.count or series.get("planned_races", 0)
    races = await db.races.find({"series_id": series_id, "status": "published"}, {"_id": 0}).to_list(1000)
    races.sort(key=lambda r: (r.get("date", ""), r.get("race_number", 0)))
    sailed_dates = [r["date"] for r in races]
    if total < len(sailed_dates):
        total = len(sailed_dates)
    future = _saturdays_from(data.start_date, total - len(sailed_dates))
    schedule = sailed_dates + future
    await db.series.update_one({"id": series_id}, {"$set": {"schedule": schedule, "planned_races": total}})
    await _sync_race_dates(series_id, schedule)
    return await db.series.find_one({"id": series_id}, {"_id": 0})


@api_router.delete("/series/{series_id}")
async def delete_series(series_id: str, user: dict = Depends(require_admin)):
    await _series_of_club(series_id, user)
    await db.series.delete_one({"id": series_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Races
# ---------------------------------------------------------------------------
async def _class_active_boats(class_id: str, year: int):
    return await db.boats.find({"class_id": class_id, "year": year, "active": True}, {"_id": 0}).to_list(2000)


@api_router.get("/races")
async def get_races(request: Request, status: Optional[str] = None, class_id: Optional[str] = None,
                    series_id: Optional[str] = None, date: Optional[str] = None,
                    club_id: Optional[str] = None):
    q = {}
    club = await _resolve_club_id(request, club_id)
    if status:
        q["status"] = status
    if class_id:
        q["class_id"] = class_id
    elif club:
        ids = await _club_class_ids(club)
        if not ids:
            return []
        q["class_id"] = {"$in": ids}
    if series_id:
        q["series_id"] = series_id
    if date:
        q["date"] = date
    items = await db.races.find(q, {"_id": 0}).sort("date", -1).to_list(2000)
    return items


@api_router.get("/races/{race_id}")
async def get_race(race_id: str, request: Request):
    race = await db.races.find_one({"id": race_id}, {"_id": 0})
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    # Published races are public; but staff may never view another club's
    # race (which would expose unpublished results and notices). 404 (not
    # 403) so the existence of another club's race is never revealed.
    user = await get_current_user(request)
    if user and user.get("role") != "webmaster":
        if user.get("club_id") != await _class_club_id(race.get("class_id")):
            raise HTTPException(status_code=404, detail="Race not found")
    return race


@api_router.post("/races")
async def create_race(data: RaceCreateInput, user: dict = Depends(require_officer)):
    series = await db.series.find_one({"id": data.series_id}, {"_id": 0})
    cls = await db.classes.find_one({"id": data.class_id}, {"_id": 0})
    if not series or not cls:
        raise HTTPException(status_code=400, detail="Invalid class or series")
    _ensure_club(user, cls.get("club_id"))
    _ensure_club(user, await _class_club_id(series.get("class_id")))
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
        "start_tz_offset_minutes": data.start_tz_offset_minutes,
        "actual_start": None,
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


@api_router.post("/races/{race_id}/start")
async def start_race(race_id: str, data: StartRaceInput, user: dict = Depends(require_officer)):
    """Set (or clear) the actual start time ('gun'). Device time is captured on
    the client and sent here; the timer runs from this instant."""
    race = await _race_of_club(race_id, user)
    actual_start = data.start_time or None
    await db.races.update_one({"id": race_id}, {"$set": {"actual_start": actual_start}})
    updated = await db.races.find_one({"id": race_id}, {"_id": 0})
    return updated


@api_router.put("/races/{race_id}/notifications")
async def update_notifications(race_id: str, data: RaceNotificationInput, user: dict = Depends(require_officer)):
    await _race_of_club(race_id, user)
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    await db.races.update_one({"id": race_id}, {"$set": update})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.post("/races/{race_id}/select-boats")
async def select_boats(race_id: str, data: SelectBoatsInput, user: dict = Depends(require_officer)):
    race = await _race_of_club(race_id, user)
    selected = set(data.boat_ids)
    results = race["results"]
    previously_finished = {r["boat_id"] for r in results if r.get("code") == "FINISHED"}
    for r in results:
        if r["boat_id"] in selected:
            if r["code"] == "DNC":
                r["code"] = "DNS"  # racing, not yet finished
        else:
            r["code"] = "DNC"
            r["finish_time"] = None
            r["position"] = None
    # RRS A6.1: a boat scored as not racing after having finished moves the
    # boats behind her up one place.
    if any(r["boat_id"] in previously_finished and r["code"] != "FINISHED" for r in results):
        await _resequence_race(race)
    await db.races.update_one({"id": race_id}, {"$set": {"results": results}})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.post("/races/{race_id}/finish")
async def record_finish(race_id: str, data: FinishInput, user: dict = Depends(require_officer)):
    race = await _race_of_club(race_id, user)
    results = race["results"]
    for r in results:
        if r["boat_id"] == data.boat_id:
            r["code"] = "FINISHED"
            r["finish_time"] = data.finish_time or now_iso()
            r["position"] = None  # set by re-sequencing below
    # Re-sequence all finishers: one-design by finish time, IRC by corrected time.
    await _resequence_race(race)
    await db.races.update_one({"id": race_id}, {"$set": {"results": results}})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.post("/races/{race_id}/undo-finish")
async def undo_finish(race_id: str, data: FinishInput, user: dict = Depends(require_officer)):
    race = await _race_of_club(race_id, user)
    results = race["results"]
    for r in results:
        if r["boat_id"] == data.boat_id:
            r["code"] = "DNS"
            r["finish_time"] = None
            r["position"] = None
    # Re-sequence the remaining finishers per the class scoring mode (finish
    # time for one-design, corrected time for IRC/PY handicap classes).
    await _resequence_race(race)
    await db.races.update_one({"id": race_id}, {"$set": {"results": results}})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.put("/races/{race_id}/result/{boat_id}")
async def adjust_result(race_id: str, boat_id: str, data: ResultAdjustInput,
                        user: dict = Depends(require_officer)):
    race = await _race_of_club(race_id, user)
    results = race["results"]
    target = next((r for r in results if r["boat_id"] == boat_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Boat not in race")
    prev_code = target.get("code")
    if data.code is not None:
        target["code"] = data.code
        # ZFP/SCP/DPI/RDG boats finished (or were scored by the jury), so their
        # finishing place is kept; only true non-finishers lose their place.
        if data.code not in ("FINISHED", "ZFP", "SCP", "RDG", "DPI"):
            target["position"] = None
    if data.position is not None:
        target["position"] = data.position
    if data.finish_time is not None:
        target["finish_time"] = data.finish_time
    if data.elapsed_seconds is not None:
        start = await _resolve_race_start(race)
        if start is None:
            raise HTTPException(status_code=400,
                                detail="No start time recorded for this race — set the start (start gun or class start time) before entering elapsed times")
        ft = _finish_time_from_elapsed(start, data.elapsed_seconds)
        if ft is None:
            raise HTTPException(status_code=400, detail="Start time could not be parsed")
        target["finish_time"] = ft
        target["code"] = "FINISHED"
        target["position"] = None  # recomputed by re-sequencing below
    if data.penalty_points is not None:
        target["penalty_points"] = data.penalty_points
    # Re-sequence when the finishing order may have changed: RRS A6.1 (a
    # finisher scored as not finishing/retiring/DSQ) or an elapsed-time edit.
    resequence = data.elapsed_seconds is not None
    if data.code is not None and prev_code == "FINISHED" and data.code in POST_FINISH_RETIRE_CODES:
        resequence = True
    if resequence:
        await _resequence_race(race)
    await db.races.update_one({"id": race_id}, {"$set": {"results": results}})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.post("/races/{race_id}/status/{status}")
async def set_race_status(race_id: str, status: str, user: dict = Depends(require_officer)):
    if status not in ("setup", "provisional", "published"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await _race_of_club(race_id, user)
    await db.races.update_one({"id": race_id}, {"$set": {"status": status, "published_at": now_iso() if status == "published" else None}})
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.delete("/races/{race_id}")
async def delete_race(race_id: str, user: dict = Depends(require_officer)):
    await _race_of_club(race_id, user)
    await db.races.delete_one({"id": race_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Notifications (public banner)
# ---------------------------------------------------------------------------
@api_router.get("/notifications")
async def get_notifications(request: Request, club_id: Optional[str] = None):
    q = {"status": {"$in": ["setup", "provisional"]}}
    club = await _resolve_club_id(request, club_id)
    if club:
        ids = await _club_class_ids(club)
        if not ids:
            return []
        q["class_id"] = {"$in": ids}
    races = await db.races.find(q, {"_id": 0}).to_list(500)
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
# Scoring — RRS Appendix A (Low Point System) + rule 44.3(c)
# ---------------------------------------------------------------------------
def round_half_up(x: float) -> int:
    """RRS 44.3(c): round to the nearest whole number, 0.5 rounded upward."""
    return int(x + 0.5)


def _start_area_entries(results) -> int:
    """Boats that came to the starting area = those selected to race (not DNC)."""
    return len([r for r in results if r.get("code") != "DNC"])


def result_points(r, series_entries, start_area_entries, use_a5_3=False,
                  use_finishers=False, finishers=0):
    """Points for one boat in one race under RRS Appendix A.

    series_entries:    boats entered in the series.
    start_area_entries: boats that came to the starting area (selected to race).
    use_a5_3:          sailing instructions opted into rule A5.3, so boats that
                       came to the starting area but did not finish score
                       start-area entries + 1 (better than DNC).
    use_finishers:     RYA/Sailwave convention: boats that came to the starting
                       area but did not finish score finishers + 1 (DNC still
                       scores series entries + 1). Takes precedence over
                       use_a5_3 when both are set.
    finishers:         boats that finished the race (for use_finishers).
    """
    code = r.get("code")
    # Base DNF score under the active convention: A5.2 default = series
    # entries + 1; A5.3 = start-area entries + 1; finishers = finishers + 1.
    if use_finishers:
        dnf = finishers + 1
    elif use_a5_3:
        dnf = start_area_entries + 1
    else:
        dnf = series_entries + 1
    if code == "FINISHED":
        base = float(r["position"]) if r.get("position") else float(dnf)
        base += float(r.get("penalty_points") or 0)
        return base
    if code in ("RDG", "DPI"):
        pts = r.get("penalty_points")
        return float(pts) if pts is not None else float(dnf)
    if code in ("ZFP", "SCP"):
        # Rule 44.3(c): her score without the penalty (her finishing place) made
        # worse by 20% of the DNF score, rounded half-up, never worse than DNF.
        place = r.get("position")
        if not place:
            return float(dnf)
        penalty = round_half_up(0.2 * dnf)
        return min(float(place) + penalty, float(dnf))
    # A5.2 (default): DNC, DNS, OCS, UFD, BFD, DNF, RET, DSQ, DNE and NSC all
    # score one more than the number of boats entered in the series.
    # A5.3 (SI option) / finishers convention: only DNC uses the series total;
    # the other codes use the active base (start-area or finishers).
    if code != "DNC" and (use_a5_3 or use_finishers):
        return float(dnf)
    return float(series_entries + 1)


def _parse_iso(s):
    """ISO timestamp -> epoch seconds, or None if missing/unparseable."""
    if not s:
        return None
    s = str(s).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).timestamp()
    except (ValueError, TypeError):
        pass
    # Python <3.11 cannot parse fractional seconds; drop the fraction and
    # retry (sub-second precision is then lost, but whole-second corrected
    # times remain correct).
    frac = s.find(".")
    if frac != -1:
        tz = s.find("+", frac)
        if tz == -1:
            tz = s.find("-", frac)
        s = s[:frac] + (s[tz:] if tz != -1 else "")
        try:
            return datetime.fromisoformat(s).timestamp()
        except (ValueError, TypeError):
            return None
    return None


def _elapsed_seconds(finish_time, start_time):
    """Elapsed seconds between start and finish; None if either is missing.

    A finish recorded before the start (stray tap, device clock skew, or a
    mis-set scheduled start) is treated as unknown rather than a negative
    elapsed time, which would otherwise outrank every real finisher."""
    f, st = _parse_iso(finish_time), _parse_iso(start_time)
    if f is None or st is None:
        return None
    el = f - st
    return el if el >= 0 else None


def _corrected_time_sec(finish_time, start_time, tcc):
    """IRC Rule 12.2: corrected time = elapsed x TCC, rounded to the nearest
    second with 0.5 seconds rounding up. None if not computable."""
    el = _elapsed_seconds(finish_time, start_time)
    if el is None or not tcc:
        return None
    return round_half_up(el * tcc)


def _py_corrected_sec(finish_time, start_time, py):
    """Portsmouth Yardstick: corrected time = elapsed x 1000 / PY, rounded to
    the nearest second with 0.5 seconds rounding up (same convention as IRC).
    None if not computable."""
    el = _elapsed_seconds(finish_time, start_time)
    if el is None or not py:
        return None
    return round_half_up(el * 1000.0 / py)


def _race_start_time(race, cls=None):
    """Best known start instant for a race: the start gun (actual_start), else
    the scheduled class start on the race date. None if neither resolves."""
    if race.get("actual_start"):
        return race["actual_start"]
    date = race.get("date")
    # The race's own scheduled start wins over the class default: the officer
    # sets start_time per race on the day.
    st = race.get("start_time") or (cls or {}).get("default_start_time")
    if date and st:
        # Scheduled start is timezone-less club time. Finish times are captured
        # from the officer's device as UTC, so anchor the scheduled start to the
        # device's UTC offset (captured at race creation) to keep the elapsed
        # math consistent. Falls back to UTC when no offset was recorded.
        off = race.get("start_tz_offset_minutes")
        if off is None:
            return f"{date}T{st}:00+00:00"
        sign = "+" if off >= 0 else "-"
        m = abs(int(off))
        return f"{date}T{st}:00{sign}{m // 60:02d}:{m % 60:02d}"
    return None


def _finish_time_from_elapsed(start, elapsed_seconds):
    """Finish ISO timestamp = start + elapsed seconds (UTC). None if the start
    cannot be parsed."""
    base = _parse_iso(start)
    if base is None:
        return None
    return datetime.fromtimestamp(base + elapsed_seconds, tz=timezone.utc).isoformat()


async def _resolve_race_start(race):
    """Resolve the race start instant, fetching the class for the scheduled
    start fallback (see _race_start_time)."""
    cls = await db.classes.find_one({"id": race.get("class_id")}, {"_id": 0}) or {}
    return _race_start_time(race, cls)


def _resequence_finished(results, scoring_mode="one_design", start_time=None, boat_ratings=None):
    """Assign finishing places 1..n to finished boats.

    one_design: by recorded finish time.
    irc: by corrected time (elapsed x TCC, rounded per IRC Rule 12.2).
    py: by corrected time (elapsed x 1000 / PY, Portsmouth Yardstick).
    Handicap modes: boats with equal corrected time share a place, and RRS A7
    later splits the points of the tied places and the place immediately
    below. Boats whose corrected time cannot be computed (no rating / no start
    time) fall back to finish time and rank after the computable boats.
    """
    finished = [r for r in results if r.get("code") == "FINISHED"]
    if not finished:
        return
    if scoring_mode in ("irc", "py") and start_time:
        ratings = boat_ratings or {}

        def ct(r):
            bid = r.get("boat_id")
            if scoring_mode == "py":
                return _py_corrected_sec(r.get("finish_time"), start_time, ratings.get(bid))
            return _corrected_time_sec(r.get("finish_time"), start_time, ratings.get(bid))

        pairs = [(r, ct(r)) for r in finished]
        pairs.sort(key=lambda rc: (rc[1] is None,
                                   rc[1] if rc[1] is not None else 0,
                                   rc[0].get("finish_time") or "",
                                   rc[0].get("position") or 0))
        # Group equal corrected times; each group of N tied boats occupies
        # places pos..pos+N-1, so the next group starts at pos+N (RRS A7).
        groups = []
        for r, c in pairs:
            if c is None:
                groups.append((None, [r]))
            elif groups and groups[-1][0] is not None and groups[-1][0] == c:
                groups[-1][1].append(r)
            else:
                groups.append((c, [r]))
        pos = 0
        for c, rs in groups:
            pos += 1
            for r in rs:
                r["position"] = pos
            pos += len(rs) - 1
    else:
        finished.sort(key=lambda x: x.get("finish_time") or "")
        for i, r in enumerate(finished):
            r["position"] = i + 1


async def _race_scoring_mode(race, cls=None):
    """Scoring mode for a race: the mode set on its series (the source of
    truth), falling back to the class's legacy mode for races without a
    series."""
    if race.get("series_id"):
        ser = await db.series.find_one({"id": race["series_id"]}, {"_id": 0, "scoring_mode": 1})
        mode = (ser or {}).get("scoring_mode")
        if mode:
            return mode
    cls = cls if cls is not None else await db.classes.find_one({"id": race.get("class_id")}, {"_id": 0}) or {}
    return cls.get("scoring_mode") or "one_design"


async def _resequence_race(race):
    """Re-sequence a race's finished boats per the race's series scoring mode
    (legacy races fall back to the class mode). Fetches the class (scheduled
    start) and boats (TCC or PY ratings) when the series is handicap-scored."""
    cls = await db.classes.find_one({"id": race.get("class_id")}, {"_id": 0}) or {}
    mode = await _race_scoring_mode(race, cls)
    if mode not in ("irc", "py"):
        _resequence_finished(race.get("results", []))
        return
    boats = await db.boats.find({"class_id": race.get("class_id")}, {"_id": 0}).to_list(2000)
    key = "tcc" if mode == "irc" else "py"
    ratings = {b["id"]: b.get(key) for b in boats}
    _resequence_finished(race.get("results", []), mode, _race_start_time(race, cls), ratings)


def _a8_tiebreak(entries, drop):
    """RRS A8 series-tie keys.

    A8.1: each boat's counting race scores listed best to worst; the boat with
          the best score at the first difference wins. Excluded scores are not
          used.
    A8.2: if still tied, scores in the last race, then next-to-last, and so on
          (excluded scores ARE used).
    """
    a8_1 = sorted([e["points"] for i, e in enumerate(entries) if i not in drop])
    a8_2 = [e["points"] for e in reversed(entries)]
    return a8_1, a8_2


async def _club_name_of_class(class_id):
    """Name of the club that owns a class (for defaulting a boat's home club).
    Defensive about missing collections so pure scoring unit tests with a
    stubbed DB still work."""
    cls_col = getattr(db, "classes", None)
    if cls_col is None:
        return ""
    cls = await cls_col.find_one({"id": class_id}, {"_id": 0, "club_id": 1})
    if not cls:
        return ""
    club_col = getattr(db, "clubs", None)
    if club_col is None:
        return ""
    club = await club_col.find_one({"id": cls.get("club_id")}, {"_id": 0, "name": 1})
    return (club or {}).get("name", "")


async def _series_scores(series):
    """Return (agg, boat_map, race_meta, use_a5_3). agg: boat_id -> list of
    per-race entry dicts, aligned to race_meta."""
    races = await db.races.find({"series_id": series["id"], "status": "published"}, {"_id": 0}).to_list(1000)
    races.sort(key=lambda r: (r.get("date", ""), r.get("race_number", 0)))
    boats = await db.boats.find({"class_id": series["class_id"], "year": series["year"]}, {"_id": 0}).to_list(2000)
    boat_map = {b["id"]: b for b in boats}
    use_a5_3 = bool(series.get("use_a5_3", False))
    use_finishers = bool(series.get("use_finishers", False))
    race_meta = [{"race_number": r.get("race_number"), "date": r.get("date")} for r in races]
    agg = {bid: [] for bid in boat_map}
    for race in races:
        results = race.get("results", [])
        series_entries = race.get("entries_count") or len(results)
        start_entries = _start_area_entries(results)
        finishers = len([r for r in results if r.get("code") == "FINISHED"])
        present = {r["boat_id"]: r for r in results}
        per_boat = {}
        for bid in boat_map:
            r = present.get(bid)
            if r is None:
                per_boat[bid] = {"points": float(series_entries + 1), "discardable": True,
                                 "position": None, "code": "DNC"}
            else:
                code = r.get("code")
                per_boat[bid] = {
                    "points": result_points(r, series_entries, start_entries, use_a5_3,
                                             use_finishers, finishers),
                    "discardable": code not in NON_DISCARDABLE,
                    "position": r.get("position") if code == "FINISHED" else None,
                    "code": code,
                }
        # RRS A7: boats tied on the finishing line (equal stored position) split
        # the points of the tied place(s) and the place(s) immediately below.
        by_pos = {}
        for bid, e in per_boat.items():
            if e["code"] == "FINISHED" and e.get("position"):
                by_pos.setdefault(e["position"], []).append(bid)
        for pos, bids in by_pos.items():
            if len(bids) > 1:
                shared = sum(range(pos, pos + len(bids))) / len(bids)
                for bid in bids:
                    per_boat[bid]["points"] = shared
        for bid, e in per_boat.items():
            agg[bid].append(e)
    return agg, boat_map, race_meta, use_a5_3, use_finishers


async def compute_series_standings(series):
    agg, boat_map, race_meta, use_a5_3, use_finishers = await _series_scores(series)
    club_name = await _club_name_of_class(series.get("class_id"))
    race_count = len(race_meta)
    # Effective discards never remove every race: at least one always counts.
    # Rule A2.1 also discards the earliest of equal worst scores (stable sort).
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
        a8_1, a8_2 = _a8_tiebreak(entries, drop)
        scores = [{"points": round(e["points"], 1), "code": e["code"], "discarded": i in drop}
                  for i, e in enumerate(entries)]
        rows.append({
            "boat_id": bid,
            "boat_name": b["name"],
            "sail_no": b["sail_no"],
            "helm": b["helm"],
            "home_club": b.get("home_club") or club_name,
            "net": round(net, 1),
            "total": round(total, 1),
            "scores": scores,
            "positions": [e["position"] for e in entries],
            "_tb": (a8_1, a8_2),
        })
    rows.sort(key=lambda x: (x["net"], x["_tb"][0], x["_tb"][1]))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
        r.pop("_tb", None)
    return {"race_count": race_count, "discards": discards,
            "configured_discards": series.get("discards", 0),
            "use_a5_3": use_a5_3,
            "use_finishers": use_finishers,
            "planned_races": series.get("planned_races", 0),
            "schedule": series.get("schedule", []),
            "races": race_meta, "standings": rows}


@api_router.get("/standings/series/{series_id}")
async def series_standings(series_id: str, request: Request, club_id: Optional[str] = None):
    series = await db.series.find_one({"id": series_id}, {"_id": 0})
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    club = await _resolve_club_id(request, club_id)
    if club and (await _class_club_id(series.get("class_id"))) != club:
        raise HTTPException(status_code=404, detail="Series not found")
    return await compute_series_standings(series)


@api_router.get("/standings/overall")
async def overall_standings(class_id: str, year: int, request: Request, club_id: Optional[str] = None):
    club = await _resolve_club_id(request, club_id)
    if club and (await _class_club_id(class_id)) != club:
        raise HTTPException(status_code=404, detail="Class not found")

    all_series = await db.series.find({"class_id": class_id, "year": year, "included_in_overall": True}, {"_id": 0}).to_list(1000)
    boats = await db.boats.find({"class_id": class_id, "year": year}, {"_id": 0}).to_list(2000)
    club_name = await _club_name_of_class(class_id)
    boat_map = {b["id"]: b for b in boats}
    totals = {}
    per_series_nets = {}
    series_names = []
    for series in sorted(all_series, key=lambda s: s.get("order", 0)):
        series_names.append(series["name"])
        result = await compute_series_standings(series)
        for row in result["standings"]:
            totals[row["boat_id"]] = totals.get(row["boat_id"], 0.0) + row["net"]
            per_series_nets.setdefault(row["boat_id"], {})[series["name"]] = row["net"]
    rows = []
    for bid, total in totals.items():
        b = boat_map.get(bid)
        if not b:
            continue
        nets = [per_series_nets[bid].get(name) for name in series_names]
        counting = [v for v in nets if v is not None]
        # A8 applied to the championship: best series results first, then the
        # most recent series backwards.
        a8_1 = sorted(counting)
        a8_2 = list(reversed(counting))
        rows.append({
            "boat_id": bid,
            "boat_name": b["name"],
            "sail_no": b["sail_no"],
            "helm": b["helm"],
            "home_club": b.get("home_club") or club_name,
            "net": round(total, 1),
            "per_series": {k: round(v, 1) for k, v in per_series_nets[bid].items()},
            "_tb": (a8_1, a8_2),
        })
    rows.sort(key=lambda x: (x["net"], x["_tb"][0], x["_tb"][1]))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
        r.pop("_tb", None)
    return {"series_names": series_names, "standings": rows}


@api_router.get("/rrs-codes")
async def rrs_codes():
    return RRS_CODES


@api_router.get("/scheduled-races")
async def scheduled_races(request: Request, date: Optional[str] = None, club_id: Optional[str] = None):
    q = {}
    club = await _resolve_club_id(request, club_id)
    if club:
        ids = await _club_class_ids(club)
        if not ids:
            return []
        q["class_id"] = {"$in": ids}
    all_series = await db.series.find(q, {"_id": 0}).to_list(1000)
    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(1000)}
    out = []
    for s in all_series:
        sched = s.get("schedule") or []
        if not sched:
            continue
        races = await db.races.find({"series_id": s["id"]}, {"_id": 0}).to_list(1000)
        existing = {r.get("race_number"): r for r in races}
        cls = classes.get(s["class_id"], {})
        for i, d in enumerate(sched):
            rn = i + 1
            r = existing.get(rn)
            status = r["status"] if r else "scheduled"
            if status == "published":
                continue
            if date and d != date:
                continue
            out.append({
                "series_id": s["id"], "series_name": s["name"],
                "class_id": s["class_id"], "class_name": cls.get("name"),
                "race_number": rn, "date": d, "status": status,
                "race_id": r["id"] if r else None,
                "start_time": r["start_time"] if r else cls.get("default_start_time", "10:30"),
            })
    out.sort(key=lambda x: (x["date"], x["class_name"] or "", x["race_number"]))
    return out


@api_router.get("/")
async def root():
    return {"message": "Sailing Club Racing API"}


# ---------------------------------------------------------------------------
# Seed sample data
# ---------------------------------------------------------------------------
@api_router.post("/seed")
async def seed(user: dict = Depends(require_admin)):
    return await run_seed()


async def ensure_default_club():
    """Multi-club migration: create a first club (from env PINs) if none exists,
    and attach any classes that predate clubs to it."""
    clubs = await db.clubs.find({}, {"_id": 0}).to_list(10)
    if clubs:
        default = clubs[0]
    else:
        default = {
            "id": new_id(),
            "name": os.environ.get("CLUB_NAME", "Sailing Club"),
            "slug": slugify(os.environ.get("CLUB_NAME", "Sailing Club")),
            "color": "#0A369D",
            "officer_pin": os.environ.get("RACE_OFFICER_PIN", "1234"),
            "admin_pin": os.environ.get("RACE_ADMIN_PIN", "5678"),
            "created_at": now_iso(),
        }
        await db.clubs.insert_one(default)
    # Pre-club data (or any orphaned classes) belong to the default club.
    await db.classes.update_many({"club_id": {"$exists": False}}, {"$set": {"club_id": default["id"]}})
    return default


async def run_seed():
    if await db.classes.count_documents({}) > 0:
        return {"seeded": False, "message": "Data already present"}
    default = await ensure_default_club()
    club_id = default["id"]
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
        await db.classes.insert_one({"id": cid, "club_id": club_id, "name": name,
                                    "default_start_time": st, "created_at": now_iso()})
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
    await ensure_default_club()
    await ensure_webmaster_user()
    await _ensure_all_club_users()
    await run_seed()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
