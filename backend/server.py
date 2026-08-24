from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form
from dotenv import load_dotenv
from fastapi.responses import JSONResponse, Response
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
import os
import io
import json
import logging
import time
import hashlib
import secrets
import smtplib
import zipfile
from collections import defaultdict, deque
from email.message import EmailMessage
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import uuid
import jwt
import re
import base64
import bcrypt
import ipaddress
from cryptography.fernet import Fernet
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Security configuration
# ---------------------------------------------------------------------------
# APP_ENV switches development vs production behaviour: production refuses to
# start with weak secrets, disables interactive API docs, enables HSTS and
# locked-down headers. JWT_SECRET and MONGO_URL are always required.
APP_ENV = os.environ.get("ENV", "development").strip().lower()
JWT_SECRET = os.environ['JWT_SECRET']           # required — no default
JWT_ALGORITHM = "HS256"
JWT_ISSUER = "sailscore"
JWT_AUDIENCE = "sailscore-app"
# Short-lived access tokens (8h default). There is no refresh-token flow, so a
# signed-in officer is simply asked to sign in again after this window.
JWT_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", "8"))
# Bootstrap passcode for the singleton webmaster user account. Seeded only when
# the account does not exist yet; never re-applied on restart. Required in
# production (the app refuses to start without it).
WEBMASTER_PASSCODE = os.environ.get("WEBMASTER_PASSCODE")
# Failed-attempt lockout for user accounts. Every account — including the
# webmaster — is protected: 5 failed attempts lock the account, initially for
# 5 minutes, and each repeated lockout escalates (10, 20) up to a 30-minute
# cap. Lockouts are always temporary, and a successful login resets the
# counter, so no account can be permanently locked by an attacker. The
# per-IP throttle (below) bounds how many different accounts one attacker can
# probe, so a single source cannot trivially lock out a whole club.
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_BASE_MINUTES = 5
LOCKOUT_MAX_MINUTES = 30
# Per-IP login throttle (in-memory sliding window; each app instance tracks its
# own window, which is fine behind a single reverse proxy).
LOGIN_IP_LIMIT = int(os.environ.get("LOGIN_IP_LIMIT", "60"))
LOGIN_IP_WINDOW_SECONDS = 60

# Trusted reverse proxies. The real client IP is only ever taken from
# X-Forwarded-For when the request's DIRECT socket peer is one of these
# (comma-separated IPs or CIDRs). A client-supplied X-Forwarded-For header is
# ignored for every other source, so an attacker cannot spoof the IP used for
# login throttling / account lockout or written into the audit log.
#   - Production (Caddy on the host -> nginx container): set this to the
#     Docker internal network (or the nginx container's address). The compose
#     file pins the internal network to 172.28.0.0/16 and defaults this to it.
#   - Development (browser talks to the API directly): leave empty, the
#     socket peer is the real client.
TRUSTED_PROXY_IPS = os.environ.get("TRUSTED_PROXY_IPS", "")

# Password/passcode policy for NEW or CHANGED credentials. Existing stored
# passcodes are never re-validated, so nobody is locked out by this change.
# The policy is deliberately minimal (6 chars + 1 number + 1 special) and easy
# to strengthen later without touching every call site: see
# validate_password_policy().
PASSWORD_MIN_LEN = 6
PASSWORD_POLICY_HINT = ("Passcode must be at least 6 characters and contain "
                        "at least one number and one special character "
                        "(e.g. ! @ # $ % ^ & * ( ) - _ + = ?).")

# HttpOnly session cookie that carries the JWT. The token never reaches
# JavaScript: it is set by the server, read only by the server, and deleted on
# logout. SameSite=Lax keeps the cookie off cross-site requests (CSRF defence
# in depth); Secure is applied only in production (development uses plain
# HTTP on localhost).
SESSION_COOKIE = "scr_token"
# Password reset by email (SMTP via the stdlib). SMTP can be configured at
# runtime from the webmaster console (stored encrypted in the database); the
# environment variables below are the fallback/bootstrap and the source of
# truth until the webmaster saves settings. In development with no SMTP the
# reset token is returned in the response so the flow works without a mail
# server. Production requires APP_BASE_URL (see _production_config_errors).
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
MAIL_FROM = os.environ.get("MAIL_FROM", "") or SMTP_USER
APP_BASE_URL = os.environ.get("APP_BASE_URL", "")
RESET_TOKEN_MINUTES = int(os.environ.get("RESET_TOKEN_MINUTES", "30"))
RESET_EMAIL_LIMIT = int(os.environ.get("RESET_EMAIL_LIMIT", "5"))
RESET_EMAIL_WINDOW_SECONDS = 600

WEAK_JWT_SECRETS = {"change-me-to-a-long-random-string", "changeme", "secret",
                    "dev", "development", "jwt-secret", "insecure", "none"}


def _production_config_errors() -> List[str]:
    """Configuration problems that must stop a production start. Empty list
    means the environment is safe to boot."""
    errors = []
    secret_l = JWT_SECRET.lower()
    if len(JWT_SECRET) < 32 or secret_l in WEAK_JWT_SECRETS \
            or secret_l.startswith(("replace_with", "change-me", "changeme")):
        errors.append("JWT_SECRET must be a random string of at least 32 characters")
    cors = os.environ.get("CORS_ORIGINS", "")
    if not cors.strip() or cors.strip() == "*":
        errors.append("CORS_ORIGINS must list the production origin(s) (never '*')")
    if not WEBMASTER_PASSCODE or len(WEBMASTER_PASSCODE) < 8:
        errors.append("WEBMASTER_PASSCODE must be set to a value of at least 8 characters")
    if "mongodb://" in mongo_url.lower() and "@" not in mongo_url.split("//", 1)[-1]:
        errors.append("MONGO_URL must include database credentials in production")
    # SMTP is intentionally NOT required at startup: the webmaster can enable
    # email from the webmaster console once the site is live (stored in the
    # database, encrypted at rest). Until then, reset emails simply cannot be
    # sent and the forgot endpoint answers 503.
    if not APP_BASE_URL:
        errors.append("APP_BASE_URL must be set in production (reset links)")
    return errors


if APP_ENV == "production":
    _cfg_errors = _production_config_errors()
    if _cfg_errors:
        raise RuntimeError("Refusing to start in production:\n- " + "\n- ".join(_cfg_errors))
    # No interactive API docs in production (limits info disclosure).
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
else:
    app = FastAPI()

api_router = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


def create_token(role: str, club_id: str, user_id: Optional[str] = None,
                  username: Optional[str] = None, token_version: int = 0) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "role": role,
        "club_id": club_id,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": now,
        "exp": now + timedelta(hours=JWT_EXPIRE_HOURS),
        "type": "access",
        "tv": int(token_version or 0),
        # Unique token id: lets logout revoke this exact session server-side.
        "jti": secrets.token_urlsafe(16),
    }
    if user_id:
        payload["user_id"] = user_id
        payload["sub"] = user_id
    if username:
        payload["username"] = username
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


# In-memory registry of logged-out token ids (jti -> expiry epoch). Logout
# adds the current token here so it stops working immediately even if an
# attacker recovered it; entries are pruned once their JWT expires, keeping
# the registry bounded by the number of logouts in one token lifetime.
_revoked_jtis = {}


def _prune_revoked_jtis():
    now = time.time()
    for jti in [j for j, exp in _revoked_jtis.items() if exp <= now]:
        _revoked_jtis.pop(jti, None)


def _session_cookie_kwargs() -> dict:
    """Attributes for the HttpOnly session cookie. Secure is only ever set in
    production (development runs plain HTTP on localhost); SameSite=Lax keeps
    the cookie out of cross-site requests while still working for the
    same-site dev topology (localhost:3000 -> localhost:8000) and the
    same-origin production topology (nginx)."""
    return {
        "key": SESSION_COOKIE,
        "httponly": True,
        "secure": APP_ENV == "production",
        "samesite": "lax",
        "max_age": JWT_EXPIRE_HOURS * 3600,
        "path": "/",
    }


def _token_from_request(request: Request) -> Optional[str]:
    """The JWT for this request: the HttpOnly session cookie first (browser
    sessions), then the Authorization bearer header (API clients)."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        return token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


async def get_current_user(request: Request):
    """Decode the session token (HttpOnly cookie, or bearer for API clients)
    and resolve the live user account.

    Every accepted token belongs to a user account and is re-validated against
    the users collection on every request, so deactivating, deleting,
    re-roling or resetting the passcode of an account revokes its sessions
    immediately (role and club always come from the database, never from the
    token). Tokens without a user account — minted by the legacy shared-PIN
    login — are rejected outright. Signature, expiry, issuer, audience and the
    required claims are all verified; only HS256 is accepted. Logged-out
    sessions are rejected via the jti denylist.
    """
    token = _token_from_request(request)
    if not token:
        return None
    try:
        payload = jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER, audience=JWT_AUDIENCE,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError:
        return None
    _prune_revoked_jtis()
    if payload.get("jti") in _revoked_jtis:
        return None  # this session was explicitly logged out
    user_id = payload.get("user_id") or payload.get("sub")
    if not user_id:
        return None  # legacy shared-PIN token — no user account
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "passcode_hash": 0})
    if not user or not user.get("active"):
        return None
    tv = payload.get("tv")
    if int(tv if tv is not None else -1) != int(user.get("token_version") or 0):
        return None  # token predates a passcode reset / role change / deactivation
    return {"role": user.get("role"), "club_id": user.get("club_id"),
            "user_id": user["id"], "username": user.get("username")}


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


async def _class_visible_or_404(class_id: str, user: dict):
    """A non-webmaster staff member may only ever see their own club's class.
    404 (not 403) so another club's resources are never revealed to exist."""
    cid = await _class_club_id(class_id)
    if cid is None or (user.get("role") != "webmaster" and cid != user.get("club_id")):
        raise HTTPException(status_code=404, detail="Class not found")


async def _series_visible_or_404(series_id: str, user: dict):
    """A non-webmaster staff member may only ever see their own club's series."""
    series = await db.series.find_one({"id": series_id}, {"_id": 0, "class_id": 1})
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    await _class_visible_or_404(series.get("class_id"), user)


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
# Optimistic concurrency control
# ---------------------------------------------------------------------------
def _expected_version(data) -> Optional[int]:
    """The expected_version a client claims its edit is based on, or None when
    the client did not send one (legacy clients are allowed but their writes
    still bump the version). Rejects non-integer values outright."""
    v = getattr(data, "expected_version", None)
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400,
                            detail="expected_version must be an integer (the version you loaded)")


def _version_filter(doc_id: str, expected: Optional[int]) -> dict:
    """Document predicate for an atomic optimistic update: the id always, plus
    the version when the client supplied one. The database itself rejects the
    write when the version no longer matches (modified_count == 0)."""
    filt = {"id": doc_id}
    if expected is not None:
        filt["version"] = expected
    return filt


def _raise_stale(expected: Optional[int]):
    """409 when an optimistic update matched nothing. When the client sent an
    expected_version the cause is a concurrent change; without one it is a
    deleted record."""
    detail = STALE_VERSION_MSG if expected is not None else "Record no longer exists"
    raise HTTPException(status_code=409, detail=detail)


def _expected_version_query(request: Request) -> Optional[int]:
    """expected_version supplied as a query parameter (for endpoints without a
    JSON body, e.g. status transitions and deletes)."""
    raw = request.query_params.get("expected_version")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400,
                            detail="expected_version must be an integer (the version you loaded)")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginInput(BaseModel):
    # Individual user accounts only — there is no shared-PIN login any more.
    # `role` is a routing hint (webmaster vs club staff); the account's own
    # role is authoritative once the passcode verifies.
    role: str = "officer"
    username: Optional[str] = None
    passcode: Optional[str] = None
    club_id: Optional[str] = None


class UserInput(BaseModel):
    club_id: Optional[str] = None
    role: Literal["officer", "admin"] = "officer"
    # Usernames are email addresses (the account's password-reset contact).
    username: EmailStr
    name: str = ""
    passcode: str = ""


class UserUpdate(BaseModel):
    username: Optional[EmailStr] = None
    name: Optional[str] = None
    role: Optional[Literal["officer", "admin"]] = None
    active: Optional[bool] = None
    passcode: Optional[str] = None


class ClubInput(BaseModel):
    name: str
    slug: Optional[str] = None
    color: str = "#0A369D"
    # No PIN fields: logins are individual user accounts managed per club.


class AdvertUpdate(BaseModel):
    """Editable advert metadata (the image itself is uploaded separately)."""
    name: Optional[str] = None
    link_url: Optional[str] = None
    active: Optional[bool] = None
    order: Optional[int] = None
    # Display shape: "auto" fits the uploaded image's own ratio, or one of
    # "landscape" / "portrait" / "square" to standardise the card box.
    format: Optional[str] = None


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
    # Optimistic concurrency control: the version this edit was based on
    # (from a previous GET). When set, the update only applies if the stored
    # version still matches — otherwise 409 Conflict is returned instead of
    # silently overwriting a concurrent change.
    expected_version: Optional[int] = None
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


class MiniSeriesGroup(BaseModel):
    """One mini series inside a long series: which races it contains (by race
    number) and how many discards it applies independently of the main series."""
    name: str = ""
    race_numbers: List[int] = []
    discards: int = 0


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
    # Long-series feature: when enabled, the series is split into named mini
    # series (mini_series_groups). Each group picks which of the series' races
    # it contains (by race number) and has its own discard count, scored and
    # shown separately. The series as a whole still counts towards the overall
    # championship using its full standings and its own discards.
    mini_series: bool = False
    mini_series_groups: Optional[List[MiniSeriesGroup]] = None
    # Versioned scoring-rule configuration for this season (the "rules of the
    # series"): RRS edition, A5 convention, TLE rule, SCP/ZFP penalty rule,
    # duty/average-points rule and the discard policy. Stored on the series so
    # every season carries its own snapshot of the rules that applied to it.
    # See _normalize_scoring_config() for the canonical shape and defaults.
    scoring_config: Optional[dict] = None
    # Optimistic concurrency control: version this edit was based on (see
    # BoatInput.expected_version).
    expected_version: Optional[int] = None


class GenScheduleInput(BaseModel):
    start_date: str
    count: Optional[int] = None
    expected_version: Optional[int] = None


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
    expected_version: Optional[int] = None


class StartRaceInput(BaseModel):
    start_time: Optional[str] = None  # ISO timestamp; null clears the gun
    expected_version: Optional[int] = None


class SelectBoatsInput(BaseModel):
    boat_ids: List[str]
    expected_version: Optional[int] = None


class FinishInput(BaseModel):
    boat_id: str
    finish_time: Optional[str] = None
    expected_version: Optional[int] = None


class ResultAdjustInput(BaseModel):
    position: Optional[int] = None
    code: Optional[str] = None
    finish_time: Optional[str] = None
    penalty_points: Optional[float] = None
    # Corrected elapsed time in seconds for a finished boat (e.g. when the
    # finish-button tap recorded the wrong duration). Converts to finish_time
    # from the race start and re-sequences the race.
    elapsed_seconds: Optional[float] = None
    # DPI (Discretionary Penalty Imposed) decision record: which committee
    # imposed it, on what basis, when, and any notes. Stored on the result so
    # the redress/penalty is auditable and identifiable as a decision, never
    # as an ordinary finishing position.
    dpi_reason: Optional[str] = None
    dpi_decision_maker: Optional[str] = None
    dpi_date: Optional[str] = None
    dpi_notes: Optional[str] = None
    # RDG (Redress Granted) decision record — same shape as the DPI record.
    rdg_reason: Optional[str] = None
    rdg_decision_maker: Optional[str] = None
    rdg_date: Optional[str] = None
    rdg_notes: Optional[str] = None
    # Optimistic concurrency control (see BoatInput.expected_version).
    expected_version: Optional[int] = None


class LockSeriesInput(BaseModel):
    """Administrator confirmation for locking/unlocking/archiving a season.
    The reason is mandatory for the audit trail; confirm must be explicitly
    true so no accidental click finalises (or unfinalises) a season."""
    confirm: bool = False
    reason: str = ""
    expected_version: Optional[int] = None


# RRS Appendix A10 scoring abbreviations (2025-2028).
RRS_CODES = [
    {"code": "FINISHED", "label": "Finished (use position)"},
    {"code": "DNC", "label": "DNC — Did not come to starting area"},
    {"code": "DNS", "label": "DNS — Did not start"},
    {"code": "OCS", "label": "OCS — On course side at start"},
    {"code": "UFD", "label": "UFD — Disqualification under rule 30.3"},
    {"code": "BFD", "label": "BFD — Disqualification under rule 30.4"},
    {"code": "ZFP", "label": "ZFP — Z flag penalty (rule 30.2, scored per the series penalty rule)"},
    {"code": "SCP", "label": "SCP — Scoring penalty taken (rule 44.3)"},
    {"code": "NSC", "label": "NSC — Did not sail the course"},
    {"code": "DNF", "label": "DNF — Did not finish"},
    {"code": "RET", "label": "RET — Retired"},
    {"code": "DSQ", "label": "DSQ — Disqualified"},
    {"code": "DNE", "label": "DNE — Disqualification not excludable"},
    {"code": "DPI", "label": "DPI — Discretionary penalty imposed (manual points)"},
    {"code": "RDG", "label": "RDG — Redress given (manual points)"},
    {"code": "TLE", "label": "TLE — Time limit expired (scored per the series TLE rule)"},
    {"code": "OOD", "label": "OOD — Officer of the Day duty (average of own other race scores)"},
]
# Rule A2.1: only DNE may not be excluded from a series score.
NON_DISCARDABLE = {"DNE"}
FINISH_CODES = {"FINISHED"}
# Codes that mean the boat did not finish (or never started): scoring them on a
# boat that had finished triggers RRS A6.1 (boats behind move up one place).
POST_FINISH_RETIRE_CODES = {"DNC", "DNS", "OCS", "UFD", "BFD", "DNF", "RET", "DSQ", "DNE", "NSC", "OOD", "TLE"}
# Duty codes (Sailwave club convention): the boat did not race — it did its
# club duty (Officer of the Day, rescue boat, crew) — and scores the average
# of its own points in the series' other races where it actually sailed.
DUTY_CODES = {"OOD"}
# TLE — Time Limit Expired: the boat failed to finish within the series'
# configured time limit. Scored per the series' TLE rule, never as a place.
TLE_CODES = {"TLE"}
# Penalties applied on top of a finishing place (RRS 44.3(c) / 30.2). The
# applicable percentage/points/places come from the series scoring config.
PENALTY_CODES = {"SCP", "ZFP"}
# Manual-points codes: the race committee / protest committee decides the
# resulting score (DPI — discretionary penalty; RDG — redress granted).
MANUAL_POINT_CODES = {"DPI", "RDG"}
# Version of this scoring engine. Every locked-season snapshot records the
# engine version that produced it, so a future rewrite can never be mistaken
# for the rules that actually applied to a historical season.
SCORING_ENGINE_VERSION = "2.2.0"
# Season lifecycle. LIVE (open) -> PROVISIONAL (per-race published results) ->
# FINAL (locked: results are served from the frozen snapshot) -> ARCHIVED
# (terminal: the same immutability, but the season can no longer be edited in
# place at all — correcting requires the explicit unlock-for-correction flow,
# which re-finalises as a NEW snapshot version).
LOCK_OPEN = "open"
LOCK_LOCKED = "locked"
LOCK_ARCHIVED = "archived"
# States in which the season's results are frozen and every normal mutation
# of its races/results/config is rejected with 409.
NOT_EDITABLE = frozenset({LOCK_LOCKED, LOCK_ARCHIVED})
# Optimistic concurrency: shown when a write carries an expected_version that
# no longer matches the stored version (another user changed the record first).
STALE_VERSION_MSG = ("This record has been changed by another user. Your version is out of "
                     "date. Reload the latest version before making further changes.")


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


def validate_password_policy(passcode: str) -> Optional[str]:
    """Single source of truth for the password policy applied to NEW and
    CHANGED credentials. Returns a user-facing error message, or None when
    the passcode complies. Existing stored passcodes are never re-validated,
    so tightening the policy here never locks anyone out — it only applies
    from the next create/change. Deliberately minimal (6 chars + 1 number + 1
    special) and trivial to strengthen later without touching call sites."""
    if len(passcode) < PASSWORD_MIN_LEN:
        return "Passcode must be at least 6 characters"
    if not any(c.isdigit() for c in passcode):
        return "Passcode must contain at least one number"
    if not any(not c.isalnum() and not c.isspace() for c in passcode):
        return "Passcode must contain at least one special character (e.g. ! @ # $ % ^ & * ( ) - _ + = ?)"
    return None


# In-memory login throttle: key -> recent attempt timestamps. Only timestamps
# inside the sliding window are ever kept, so the map stays bounded. The
# per-account lockout is the real protection, the per-IP limit just slows mass
# account scanning. Keys are the REAL client IPs computed by _client_ip(), so
# forged X-Forwarded-For headers cannot rotate the bucket.
_login_attempts = defaultdict(deque)


def _is_trusted_proxy(peer: str) -> bool:
    """True when the direct socket peer is a configured trusted reverse proxy
    (exact IP or CIDR). No TRUSTED_PROXY_IPS configured means no proxy is
    trusted — the socket peer is always the real client."""
    if not TRUSTED_PROXY_IPS.strip():
        return False
    try:
        peer_ip = ipaddress.ip_address(peer)
    except ValueError:
        return False
    for entry in TRUSTED_PROXY_IPS.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                if peer_ip in ipaddress.ip_network(entry, strict=False):
                    return True
            elif entry == peer:
                return True
        except ValueError:
            continue
    return False


def _client_ip(request: Request) -> str:
    """The real client IP for a request.

    - If the DIRECT socket peer is a trusted reverse proxy, the client IP is
      the first entry of X-Forwarded-For (the proxy chain preserves the
      original client, and the proxy itself overwrites/sanitises the header).
    - Otherwise — direct connection, or a forged X-Forwarded-For from an
      untrusted peer — the socket peer is authoritative and the header is
      ignored. This is what makes brute-force throttling and audit-log IPs
      unspoofable.
    """
    peer = request.client.host if request.client else "unknown"
    if not _is_trusted_proxy(peer):
        return peer
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip() or peer
    return peer


def _login_ip_limited(ip: str) -> bool:
    """True when this IP has exceeded the login throttle window."""
    now = time.time()
    dq = _login_attempts[f"ip:{ip}"]
    while dq and dq[0] < now - LOGIN_IP_WINDOW_SECONDS:
        dq.popleft()
    if len(dq) >= LOGIN_IP_LIMIT:
        return True
    dq.append(now)
    return False


def _lockout_minutes(lockout_level: int) -> int:
    """Progressive account lockout: 5, then 10, then 20 minutes, capped at 30
    (never permanent). Repeated lockouts escalate, but a successful login
    resets the level, so real users are never stuck."""
    return min(LOCKOUT_BASE_MINUTES * (2 ** max(0, int(lockout_level or 0))), LOCKOUT_MAX_MINUTES)


async def _record_failed_login(user: dict, ip: str = ""):
    """Persist one failed attempt on the account (Mongo-backed, so it
    survives restarts). After MAX_FAILED_ATTEMPTS the account is locked for a
    progressively longer window; the counter then resets so the lock expires
    naturally. Never logs the passcode."""
    n = (user.get("failed_attempts") or 0) + 1
    now = datetime.now(timezone.utc)
    update = {"failed_attempts": n, "last_failed_login": now.isoformat()}
    if n >= MAX_FAILED_ATTEMPTS:
        level = (user.get("lockout_level") or 0) + 1
        minutes = _lockout_minutes(level - 1)
        locked_until = (now + timedelta(minutes=minutes)).isoformat()
        update.update({"failed_attempts": 0, "locked_until": locked_until,
                       "lockout_level": level})
        logger.warning("ACCOUNT LOCKOUT user=%s ip=%s for %d minutes",
                       user.get("username"), ip, minutes)
    else:
        logger.info("LOGIN FAIL user=%s ip=%s attempts=%d", user.get("username"), ip, n)
    await db.users.update_one({"id": user["id"]}, {"$set": update})


def _user_locked(user: dict) -> bool:
    """True while the account's lockout window is still running. Applies to
    every account type including the webmaster (a lockout is always
    temporary — max 30 minutes — so the master key can never be permanently
    locked)."""
    locked = user.get("locked_until")
    if not locked:
        return False
    try:
        return datetime.fromisoformat(locked) > datetime.now(timezone.utc)
    except (ValueError, TypeError):
        return False


async def _login_user(u: dict, passcode: str, ip: str = "") -> dict:
    """Verify a passcode against a user account with failed-attempt lockout.
    The same protection applies to every account, including the webmaster.
    All failures return the same generic message so the endpoint cannot be
    used to enumerate accounts."""
    if not u or not u.get("active"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if _user_locked(u):
        logger.warning("LOGIN LOCKED user=%s ip=%s", u.get("username"), ip)
        raise HTTPException(status_code=423,
                            detail="Account temporarily locked — too many failed attempts. Try again later.")
    if not verify_passcode(passcode, u.get("passcode_hash", "")):
        await _record_failed_login(u, ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    # Successful login clears the failure counter, the last-failure timestamp
    # and any lockout state (the lockout level too, so escalation restarts).
    await db.users.update_one({"id": u["id"]}, {"$set": {"failed_attempts": 0, "last_login": now_iso()},
                                                "$unset": {"locked_until": "",
                                                           "lockout_level": "",
                                                           "last_failed_login": ""}})
    return u


async def _log_audit(request: Optional[Request], user: Optional[dict], action: str,
                     description: str = "", resource_type: Optional[str] = None,
                     resource_id: Optional[str] = None, success: bool = True,
                     target_user_id: Optional[str] = None,
                     target_username: Optional[str] = None,
                     club_id: Optional[str] = None):
    """Append one event to the persistent audit log (audit_logs collection,
    survives restarts). Best-effort: a logging failure never breaks the
    operation that triggered it. Sensitive values (passcodes, hashes, tokens,
    reset links) are never accepted or stored here."""
    try:
        club = club_id if club_id is not None else (user or {}).get("club_id")
        await db.audit_logs.insert_one({
            "id": new_id(),
            "timestamp": now_iso(),
            "user_id": (user or {}).get("user_id"),
            "username": (user or {}).get("username"),
            "role": (user or {}).get("role"),
            "club_id": club,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "description": description,
            "ip_address": _client_ip(request) if request else "",
            "success": bool(success),
            "request_method": request.method if request else None,
            "request_path": request.url.path if request else None,
            "target_user_id": target_user_id,
            "target_username": target_username,
        })
    except Exception as exc:
        logger.error("AUDIT LOG FAILED action=%s error=%s", action, exc)


@api_router.post("/auth/login")
async def login(data: LoginInput, request: Request):
    """Sign in. On success the JWT is set as an HttpOnly session cookie — the
    token is never returned in the response body, so it is not accessible to
    JavaScript. Every failure returns the same generic message (no account
    enumeration); failures are counted per account (progressive lockout) and
    throttled per IP."""
    ip = _client_ip(request)
    if _login_ip_limited(ip):
        raise HTTPException(status_code=429,
                            detail="Too many login attempts — please try again shortly")
    passcode = (data.passcode or "").strip()
    if data.role not in ("officer", "admin", "webmaster"):
        await _log_audit(request, None, "AUTH_LOGIN_FAILED",
                         description="Login rejected: unknown role")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if data.role == "webmaster":
        wm = await db.users.find_one({"role": "webmaster", "club_id": None}, {"_id": 0})
        if not wm:
            await _log_audit(request, None, "AUTH_LOGIN_FAILED",
                             description="Webmaster login: account not found")
            raise HTTPException(status_code=401, detail="Invalid credentials")
        try:
            u = await _login_user(wm, passcode, ip)
        except HTTPException as exc:
            actor = {"user_id": wm["id"], "username": wm.get("username"),
                     "role": "webmaster", "club_id": None}
            if exc.status_code == 423:
                await _log_audit(request, actor, "AUTH_LOCKOUT",
                                 description=f"Account {wm.get('username')} locked after repeated failures",
                                 success=False)
            else:
                await _log_audit(request, actor, "AUTH_LOGIN_FAILED",
                                 description=f"Failed login for {wm.get('username')}", success=False)
            raise
        token = create_token("webmaster", None, u["id"], u.get("username"), u.get("token_version"))
        await _log_audit(request, {"user_id": u["id"], "username": u.get("username"),
                                  "role": "webmaster", "club_id": None},
                         "AUTH_LOGIN_SUCCESS", description="Webmaster signed in")
        logger.info("LOGIN OK user=%s role=webmaster ip=%s", u.get("username"), ip)
        response = JSONResponse({"role": "webmaster", "club_id": None, "club_name": None,
                                 "username": u.get("username"), "name": u.get("name")})
        response.set_cookie(value=token, **_session_cookie_kwargs())
        return response
    # Club staff: the account is looked up by username inside the chosen club;
    # the account's own role and club decide the session. The client can never
    # claim a role or club it was not given.
    club = None
    if data.club_id:
        club = await db.clubs.find_one({"id": data.club_id}, {"_id": 0})
    else:
        # No club chosen: only unambiguous if exactly one club exists.
        clubs = await db.clubs.find({}, {"_id": 0}).to_list(100)
        if len(clubs) == 1:
            club = clubs[0]
    if not club or not data.username:
        await _log_audit(request, None, "AUTH_LOGIN_FAILED",
                         description=f"Login rejected for username {data.username or ''}")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = await db.users.find_one({"club_id": club["id"], "username": data.username.strip().lower()}, {"_id": 0})
    if not user:
        await _log_audit(request, None, "AUTH_LOGIN_FAILED",
                         description=f"Login rejected: unknown account {data.username.strip().lower()}")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    try:
        u = await _login_user(user, passcode, ip)
    except HTTPException as exc:
        actor = {"user_id": user["id"], "username": user.get("username"),
                 "role": user.get("role"), "club_id": user.get("club_id")}
        if exc.status_code == 423:
            await _log_audit(request, actor, "AUTH_LOCKOUT",
                             description=f"Account {user.get('username')} locked after repeated failures",
                             success=False)
        else:
            await _log_audit(request, actor, "AUTH_LOGIN_FAILED",
                             description=f"Failed login for {user.get('username')}", success=False)
        raise
    role = u["role"]
    token = create_token(role, club["id"], u["id"], u.get("username"), u.get("token_version"))
    await _log_audit(request, {"user_id": u["id"], "username": u.get("username"),
                               "role": role, "club_id": club["id"]},
                     "AUTH_LOGIN_SUCCESS",
                     description=f"{u.get('username')} signed in to {club.get('name')}")
    logger.info("LOGIN OK user=%s role=%s club=%s ip=%s", u.get("username"), role, club["id"], ip)
    response = JSONResponse({"role": role, "club_id": club["id"],
                             "club_name": club.get("name"), "username": u.get("username"),
                             "name": u.get("name")})
    response.set_cookie(value=token, **_session_cookie_kwargs())
    return response


@api_router.post("/auth/logout")
async def logout(request: Request):
    """Sign out: revoke this session's token server-side (jti denylist) and
    delete the session cookie. Works even when the token is already invalid."""
    user = await get_current_user(request)
    if user:
        await _log_audit(request, user, "AUTH_LOGOUT",
                         description=f"{user.get('username')} signed out")
    token = _token_from_request(request)
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
                                 issuer=JWT_ISSUER, audience=JWT_AUDIENCE,
                                 options={"require": ["exp", "iat", "iss", "aud", "sub"]})
            _revoked_jtis[payload.get("jti")] = int(payload.get("exp") or time.time())
        except jwt.PyJWTError:
            pass  # nothing to revoke server-side; the cookie is still cleared
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


class ChangePasscodeInput(BaseModel):
    current_passcode: str
    new_passcode: str


class ForgotInput(BaseModel):
    club_id: Optional[str] = None
    email: EmailStr


class ResetPasswordInput(BaseModel):
    token: str
    new_passcode: str


class EmailSettingsInput(BaseModel):
    """Webmaster-configured SMTP settings (stored in the settings collection,
    password encrypted at rest). Blank smtp_password keeps the existing one;
    blank smtp_host clears the runtime config (falls back to env vars)."""
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = Field(default=None, ge=1, le=65535)
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    mail_from: Optional[EmailStr] = None


class TestEmailInput(BaseModel):
    to_email: EmailStr


# ---------------------------------------------------------------------------
# Runtime email (SMTP) settings
# ---------------------------------------------------------------------------
def _settings_fernet() -> Fernet:
    """Deterministic encryption key derived from JWT_SECRET for the SMTP
    password at rest. Changing JWT_SECRET invalidates stored secrets — the
    webmaster simply re-enters the password."""
    digest = hashlib.sha256(JWT_SECRET.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _encrypt_secret(plain: str) -> str:
    return _settings_fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def _decrypt_secret(token: str) -> str:
    try:
        return _settings_fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except Exception:
        return ""


async def _get_email_settings() -> dict:
    """Live SMTP settings: the webmaster-configured doc in the settings
    collection takes precedence; environment variables are the fallback.
    Never exposes the plaintext password to callers that must not see it —
    decrypt only where the value is actually needed."""
    doc = await db.settings.find_one({"key": "email"}, {"_id": 0})
    if doc and doc.get("smtp_host"):
        return {
            "smtp_host": doc["smtp_host"],
            "smtp_port": int(doc.get("smtp_port", 587)),
            "smtp_user": doc.get("smtp_user", ""),
            "smtp_password": (_decrypt_secret(doc.get("smtp_password_enc", ""))
                               if doc.get("smtp_password_enc") else ""),
            "mail_from": doc.get("mail_from", "") or doc.get("smtp_user", ""),
            "using_env": False,
            "configured": True,
        }
    return {
        "smtp_host": SMTP_HOST,
        "smtp_port": SMTP_PORT,
        "smtp_user": SMTP_USER,
        "smtp_password": SMTP_PASSWORD,
        "mail_from": MAIL_FROM or SMTP_USER,
        "using_env": bool(SMTP_HOST),
        "configured": bool(SMTP_HOST),
    }


def _reset_email_limited(email: str) -> bool:
    """Per-email throttle on reset requests (stops email-bombing a victim)."""
    now = time.time()
    dq = _login_attempts[f"reset:{email}"]
    while dq and dq[0] < now - RESET_EMAIL_WINDOW_SECONDS:
        dq.popleft()
    if len(dq) >= RESET_EMAIL_LIMIT:
        return True
    dq.append(now)
    return False


async def _send_reset_email(to_email: str, reset_link: str, cfg: dict) -> bool:
    """Send the reset link over SMTP (stdlib). Returns False when SMTP is not
    configured or the send fails — never raises, never leaks internals."""
    if not cfg.get("smtp_host"):
        return False
    msg = EmailMessage()
    msg["Subject"] = "SailScore — reset your passcode"
    msg["From"] = cfg.get("mail_from") or cfg.get("smtp_user") or "sailscore@localhost"
    msg["To"] = to_email
    msg.set_content(
        "Someone asked to reset the SailScore passcode for this email address.\n\n"
        f"Reset your passcode here: {reset_link}\n\n"
        f"This link expires in {RESET_TOKEN_MINUTES} minutes. If you did not request "
        "a reset, you can ignore this email — your passcode is unchanged.\n"
    )
    try:
        with smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"], timeout=15) as s:
            s.starttls()
            if cfg.get("smtp_user"):
                s.login(cfg["smtp_user"], cfg.get("smtp_password") or "")
            s.send_message(msg)
        return True
    except Exception as exc:
        logger.error("RESET EMAIL SEND FAILED to=%s error=%s", to_email, exc)
        return False


@api_router.post("/auth/forgot")
async def forgot_password(data: ForgotInput, request: Request):
    """Request a passcode reset link. Always answers with the same generic
    body so the endpoint cannot be used to enumerate accounts; the reset
    email is only sent when a matching account exists. Tokens are stored as
    a SHA-256 hash (never plaintext), expire after RESET_TOKEN_MINUTES and
    are single-use."""
    ip = _client_ip(request)
    if _login_ip_limited(ip):
        raise HTTPException(status_code=429,
                            detail="Too many requests — please try again shortly")
    email = data.email.strip().lower()
    if _reset_email_limited(email):
        raise HTTPException(status_code=429,
                            detail="Too many requests — please try again shortly")
    cfg = await _get_email_settings()
    if APP_ENV == "production" and not cfg.get("configured"):
        raise HTTPException(status_code=503, detail="Password reset email is not configured")
    user = None
    if data.club_id:
        user = await db.users.find_one({"club_id": data.club_id, "username": email}, {"_id": 0})
    else:
        # No club chosen: unambiguous only when exactly one club exists.
        clubs = await db.clubs.find({}, {"_id": 0}).to_list(100)
        if len(clubs) == 1:
            user = await db.users.find_one({"username": email}, {"_id": 0})
    if user:
        token = secrets.token_urlsafe(32)
        await db.users.update_one({"id": user["id"]}, {"$set": {
            "reset_token_hash": hashlib.sha256(token.encode("utf-8")).hexdigest(),
            "reset_token_expires": (datetime.now(timezone.utc)
                                    + timedelta(minutes=RESET_TOKEN_MINUTES)).isoformat(),
        }})
        reset_link = f"{APP_BASE_URL.rstrip('/')}/reset-password?token={token}" if APP_BASE_URL else ""
        sent = await _send_reset_email(email, reset_link, cfg)
        logger.info("PASSWORD RESET REQUEST user=%s ip=%s email_sent=%s",
                    user.get("username"), ip, sent)
        await _log_audit(request, None, "PASSWORD_RESET_REQUESTED",
                         description=f"Reset link requested for {email}",
                         target_username=email, club_id=user.get("club_id"))
        if not sent and APP_ENV != "production":
            # Development convenience: no SMTP configured — hand the token back
            # so the flow can be exercised end-to-end locally. Production never
            # returns tokens.
            return {"ok": True, "dev_reset_token": token}
    return {"ok": True}


@api_router.post("/auth/reset-password")
async def reset_password(data: ResetPasswordInput, request: Request):
    """Complete a passcode reset with the emailed token (single use, expiry).
    The passcode hash is replaced, every outstanding session is revoked, and
    the reset token is consumed."""
    ip = _client_ip(request)
    if _login_ip_limited(ip):
        raise HTTPException(status_code=429,
                            detail="Too many requests — please try again shortly")
    new = data.new_passcode.strip()
    policy_err = validate_password_policy(new)
    if policy_err:
        raise HTTPException(status_code=400, detail=policy_err)
    token_hash = hashlib.sha256(data.token.strip().encode("utf-8")).hexdigest()
    user = await db.users.find_one({"reset_token_hash": token_hash}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401,
                            detail="This reset link is invalid or has already been used")
    try:
        expires = datetime.fromisoformat(user.get("reset_token_expires", ""))
    except (TypeError, ValueError):
        await db.users.update_one({"id": user["id"]},
                                  {"$unset": {"reset_token_hash": "", "reset_token_expires": ""}})
        raise HTTPException(status_code=401,
                            detail="This reset link is invalid or has already been used")
    if expires <= datetime.now(timezone.utc):
        await db.users.update_one({"id": user["id"]},
                                  {"$unset": {"reset_token_hash": "", "reset_token_expires": ""}})
        raise HTTPException(status_code=401,
                            detail="This reset link has expired — please request a new one")
    if verify_passcode(new, user.get("passcode_hash", "")):
        raise HTTPException(status_code=400,
                            detail="New passcode must be different from the current one")
    new_tv = (user.get("token_version") or 0) + 1
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "passcode_hash": hash_passcode(new),
        "token_version": new_tv,
        "last_passcode_change": now_iso(),
    }, "$unset": {"reset_token_hash": "", "reset_token_expires": ""}})
    logger.info("PASSWORD RESET OK user=%s ip=%s", user.get("username"), ip)
    await _log_audit(request, None, "PASSWORD_RESET_COMPLETED",
                     description=f"Passcode reset completed for {user.get('username')}",
                     target_user_id=user.get("id"), target_username=user.get("username"),
                     club_id=user.get("club_id"))
    return {"ok": True}


@api_router.post("/auth/change-passcode")
async def change_passcode(data: ChangePasscodeInput, request: Request):
    """A signed-in officer/admin/webmaster may change their own passcode.

    The current passcode must verify (failed attempts count toward the same
    account lockout as login). The hash is updated and the token version is
    bumped, which revokes every other outstanding session; a fresh token for
    THIS session is returned so the user stays signed in. Only the caller's
    own account is ever touched — there is no way to target another user.
    """
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    doc = await db.users.find_one({"id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=401, detail="Not authenticated")
    ip = _client_ip(request)
    if _login_ip_limited(ip):
        raise HTTPException(status_code=429,
                            detail="Too many attempts — please try again shortly")
    current = data.current_passcode.strip()
    new = data.new_passcode.strip()
    policy_err = validate_password_policy(new)
    if policy_err:
        raise HTTPException(status_code=400, detail=policy_err)
    if _user_locked(doc):
        logger.warning("PASSCODE CHANGE LOCKED user=%s ip=%s", doc.get("username"), ip)
        await _log_audit(request, user, "AUTH_LOCKOUT",
                         description=f"Account {doc.get('username')} locked after repeated failures",
                         success=False)
        raise HTTPException(status_code=423,
                            detail="Account temporarily locked — too many failed attempts. Try again later.")
    if not verify_passcode(current, doc.get("passcode_hash", "")):
        await _record_failed_login(doc, ip)
        await _log_audit(request, user, "AUTH_LOGIN_FAILED",
                         description=f"Wrong current passcode while changing passcode ({doc.get('username')})",
                         success=False)
        raise HTTPException(status_code=401, detail="Current passcode is incorrect")
    if verify_passcode(new, doc.get("passcode_hash", "")):
        raise HTTPException(status_code=400,
                            detail="New passcode must be different from the current one")
    new_tv = (doc.get("token_version") or 0) + 1
    await db.users.update_one({"id": doc["id"]}, {"$set": {
        "passcode_hash": hash_passcode(new),
        "token_version": new_tv,
        "last_passcode_change": now_iso(),
    }})
    logger.info("PASSCODE CHANGE user=%s role=%s ip=%s", doc.get("username"), doc.get("role"), ip)
    await _log_audit(request, user, "PASSCODE_CHANGE",
                     description=f"Passcode changed for {doc.get('username')}",
                     target_user_id=doc["id"], target_username=doc.get("username"))
    token = create_token(doc["role"], doc.get("club_id"), doc["id"],
                         doc.get("username"), new_tv)
    club_name = None
    if doc.get("club_id"):
        club = await db.clubs.find_one({"id": doc["club_id"]}, {"_id": 0, "name": 1})
        club_name = (club or {}).get("name")
    response = JSONResponse({"role": doc["role"], "club_id": doc.get("club_id"),
                             "club_name": club_name, "username": doc.get("username"),
                             "name": doc.get("name")})
    response.set_cookie(value=token, **_session_cookie_kwargs())
    return response


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
    """User without credential material or internal security counters. Never
    leaks a passcode hash, a pending reset token, the token version used for
    session revocation, or the failed-attempt/lockout state."""
    secret_keys = ("passcode_hash", "password_hash", "reset_token_hash",
                   "reset_token_expires", "token_version", "failed_attempts",
                   "last_failed_login", "locked_until", "lockout_level")
    return {k: v for k, v in u.items() if k not in secret_keys}


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
    users = await db.users.find(q, {"_id": 0}).sort([("role", 1), ("username", 1)]).to_list(500)
    return [_user_public(u) for u in users]


@api_router.post("/users")
async def create_user(data: UserInput, request: Request, user: dict = Depends(require_admin)):
    """Create a login for a club. Race Admins may only create officer/admin
    logins inside their own club; the webmaster may create them for any club."""
    is_webmaster = user.get("role") == "webmaster"
    club_id = (data.club_id or user.get("club_id")) if is_webmaster else user.get("club_id")
    if not club_id:
        raise HTTPException(status_code=400, detail="club_id is required")
    _ensure_club(user, club_id)
    username = data.username.strip().lower()
    passcode = data.passcode.strip()
    policy_err = validate_password_policy(passcode)
    if policy_err:
        raise HTTPException(status_code=400, detail=policy_err)
    if await db.users.find_one({"club_id": club_id, "username": username}, {"_id": 0}):
        raise HTTPException(status_code=400, detail=f"Username '{username}' already exists for this club")
    doc = {
        "id": new_id(), "club_id": club_id, "role": data.role,
        "username": username, "name": data.name.strip(),
        "passcode_hash": hash_passcode(passcode),
        "active": True, "created_by": user.get("user_id") or "webmaster",
        "created_at": now_iso(), "failed_attempts": 0, "token_version": 0,
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    logger.info("USER CREATE id=%s username=%s role=%s club=%s by=%s",
                doc["id"], username, data.role, club_id, user.get("username"))
    await _log_audit(request=request, user=user, action="USER_CREATED",
                     description=f"Created login {username} ({data.role})",
                     resource_type="user", resource_id=doc["id"],
                     target_user_id=doc["id"], target_username=username,
                     club_id=club_id)
    return _user_public(doc)


@api_router.put("/users/{user_id}")
async def update_user(user_id: str, data: UserUpdate, request: Request, user: dict = Depends(require_admin)):
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
    # A club must always keep at least one active admin: a non-webmaster may
    # not deactivate the club's last active admin (mirrors the delete guard).
    if (not is_webmaster and target.get("role") == "admin" and data.active is False
            and target.get("active") is not False):
        active_admins = await db.users.count_documents(
            {"club_id": target.get("club_id"), "role": "admin", "active": True})
        if active_admins <= 1:
            raise HTTPException(status_code=400,
                                detail="A club must keep at least one active admin")
    update = {}
    if data.username is not None:
        new_username = data.username.strip().lower()
        dup = await db.users.find_one({"club_id": target.get("club_id"), "username": new_username,
                                       "id": {"$ne": user_id}}, {"_id": 0})
        if dup:
            raise HTTPException(status_code=400,
                                detail=f"Username '{new_username}' already exists for this club")
        update["username"] = new_username
    if data.name is not None:
        update["name"] = data.name.strip()
    if data.role is not None:
        update["role"] = data.role
    if data.active is not None:
        update["active"] = data.active
    if data.passcode:
        policy_err = validate_password_policy(data.passcode.strip())
        if policy_err:
            raise HTTPException(status_code=400, detail=policy_err)
        update["passcode_hash"] = hash_passcode(data.passcode.strip())
    # Any change that alters what an existing token authorises (username,
    # passcode, role or activation) bumps the token version, revoking every
    # previously issued session for this account immediately.
    revoke = (data.username is not None) or bool(data.passcode) \
        or data.role is not None or data.active is not None
    if update:
        if revoke:
            update["token_version"] = (target.get("token_version") or 0) + 1
        await db.users.update_one({"id": user_id}, {"$set": update})
    logger.info("USER UPDATE id=%s by=%s fields=%s revoke=%s",
                user_id, user.get("username"), sorted(update.keys()), revoke)
    # Audit the most significant change (the record always describes the rest).
    if data.passcode:
        action = "USER_PASSCODE_RESET"
    elif data.active is False:
        action = "USER_DEACTIVATED"
    elif data.active is True:
        action = "USER_REACTIVATED"
    elif data.role is not None:
        action = "USER_ROLE_CHANGED"
    else:
        action = "USER_UPDATED"
    await _log_audit(request=request, user=user, action=action,
                     description=f"Updated login {target.get('username')} ({action.lower().replace('_', ' ')})",
                     resource_type="user", resource_id=user_id,
                     target_user_id=user_id, target_username=target.get("username"),
                     club_id=target.get("club_id"))
    return _user_public(await db.users.find_one({"id": user_id}, {"_id": 0}))


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request, user: dict = Depends(require_admin)):
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
    logger.info("USER DELETE id=%s username=%s by=%s", user_id, target.get("username"), user.get("username"))
    await _log_audit(request=request, user=user, action="USER_DELETED",
                     description=f"Deleted login {target.get('username')}",
                     resource_type="user", resource_id=user_id,
                     target_user_id=user_id, target_username=target.get("username"),
                     club_id=target.get("club_id"))
    return {"ok": True}


async def _ensure_user_token_version(user_id: str):
    await db.users.update_one({"id": user_id, "token_version": {"$exists": False}},
                              {"$set": {"token_version": 0}})


async def _migrate_legacy_club_pins():
    """One-time, idempotent migration of the legacy shared-PIN scheme.

    Clubs used to carry plaintext officer_pin/admin_pin fields and a
    username-less shared-PIN login. This turns each PIN into the passcode of
    the club's seeded 'officer'/'admin' user account (bcrypt-hashed), then
    removes the plaintext fields from the club document. It is safe to run
    any number of times — once the fields are gone nothing further happens —
    and it never touches clubs/classes/boats/series/races or other users.
    """
    clubs = await db.clubs.find({}, {"_id": 0}).to_list(1000)
    for club in clubs:
        officer_pin = club.get("officer_pin")
        admin_pin = club.get("admin_pin")
        for role, pin in (("officer", officer_pin), ("admin", admin_pin)):
            if not pin:
                continue
            existing = await db.users.find_one(
                {"club_id": club["id"], "role": role, "username": role}, {"_id": 0})
            if existing:
                # Refresh the seeded account's hash so the old PIN keeps working
                # as that account's passcode, and bump its token version so any
                # outstanding sessions from before the migration are revoked.
                if not verify_passcode(pin, existing.get("passcode_hash", "")):
                    await db.users.update_one(
                        {"id": existing["id"]},
                        {"$set": {"passcode_hash": hash_passcode(pin),
                                   "token_version": (existing.get("token_version") or 0) + 1}})
            else:
                await db.users.insert_one({
                    "id": new_id(), "club_id": club["id"], "role": role,
                    "username": role, "name": f"{club.get('name', 'Club')} {role.title()}",
                    "passcode_hash": hash_passcode(pin), "active": True,
                    "created_by": "legacy-pin-migration", "created_at": now_iso(),
                    "failed_attempts": 0, "token_version": 0,
                })
            logger.info("SECURITY MIGRATE legacy %s PIN -> user account (club %s)",
                        role, club.get("id"))
        if officer_pin is not None or admin_pin is not None:
            await db.clubs.update_one({"id": club["id"]},
                                      {"$unset": {"officer_pin": "", "admin_pin": ""}})
            logger.info("SECURITY MIGRATE removed plaintext PIN fields from club %s",
                        club.get("id"))


async def ensure_webmaster_user():
    """Bootstrap the singleton webmaster user account.

    The account is created once from the WEBMASTER_PASSCODE environment
    variable (required — production refuses to start without it). It is never
    re-seeded on restart, so a later env change does not silently reset the
    passcode, and it is never a shared-PIN login.
    """
    wm = await db.users.find_one({"role": "webmaster", "club_id": None}, {"_id": 0})
    if wm:
        await _ensure_user_token_version(wm["id"])
        return wm
    if not WEBMASTER_PASSCODE:
        raise RuntimeError("WEBMASTER_PASSCODE must be set to bootstrap the webmaster account")
    await db.users.insert_one({
        "id": new_id(), "club_id": None, "role": "webmaster",
        "username": "webmaster", "name": "Webmaster",
        "passcode_hash": hash_passcode(WEBMASTER_PASSCODE),
        "active": True, "created_by": "system", "created_at": now_iso(),
        "failed_attempts": 0, "token_version": 0,
    })
    logger.info("SECURITY BOOTSTRAP webmaster user account created")
    return await db.users.find_one({"role": "webmaster", "club_id": None}, {"_id": 0})


async def _ensure_all_user_token_versions():
    await db.users.update_many({"token_version": {"$exists": False}},
                               {"$set": {"token_version": 0}})

# ---------------------------------------------------------------------------
# Clubs
# ---------------------------------------------------------------------------
def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "club"


def _club_public(club: dict) -> dict:
    """Club without credential material (legacy plaintext PIN fields are
    stripped even if a pre-migration document still carries them)."""
    return {k: v for k, v in club.items() if k not in ("officer_pin", "admin_pin")}


@api_router.get("/clubs")
async def get_clubs():
    clubs = await db.clubs.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return [_club_public(c) for c in clubs]


@api_router.get("/clubs/manage")
async def clubs_manage(user: dict = Depends(require_webmaster)):
    """Webmaster-only: full club documents for management. Public /clubs
    returns the same shape minus any legacy credential fields."""
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
            # NB: chained .sort() calls REPLACE each other in PyMongo ("only
            # the last sort has any effect"), so both keys must go in one list.
            races = await db.races.find(q, {"_id": 0})\
                .sort([("date", -1), ("race_number", -1)]).limit(1).to_list(1)
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
           "created_at": now_iso()}
    await db.clubs.insert_one(doc)
    doc.pop("_id", None)
    logger.info("CLUB CREATE id=%s name=%s by=%s", doc["id"], doc["name"], user.get("username"))
    await _log_audit(request=None, user=user, action="CLUB_CREATED",
                     description=f"Created club {doc['name']}",
                     resource_type="club", resource_id=doc["id"], club_id=doc["id"])
    return _club_public(doc)


@api_router.put("/clubs/{club_id}")
async def update_club(club_id: str, data: ClubInput, user: dict = Depends(require_webmaster)):
    club = await db.clubs.find_one({"id": club_id}, {"_id": 0})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    update = {"name": data.name, "color": data.color}
    if data.slug:
        update["slug"] = data.slug.lower()
    await db.clubs.update_one({"id": club_id}, {"$set": update})
    logger.info("CLUB UPDATE id=%s by=%s", club_id, user.get("username"))
    await _log_audit(request=None, user=user, action="CLUB_UPDATED",
                     description=f"Updated club {club.get('name')}",
                     resource_type="club", resource_id=club_id, club_id=club_id)
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
    ctype = _detect_image_type(data)
    if not ctype:
        raise HTTPException(status_code=400,
                            detail="Upload must be a PNG, JPEG, GIF or WebP image")
    icon = f"data:{ctype};base64,{base64.b64encode(data).decode()}"
    await db.clubs.update_one({"id": club_id}, {"$set": {"icon": icon}})
    await _log_audit(request=None, user=user, action="CLUB_ICON_UPDATED",
                     description=f"Updated club icon for {club.get('name')}",
                     resource_type="club", resource_id=club_id, club_id=club_id)
    return _club_public(await db.clubs.find_one({"id": club_id}, {"_id": 0}))


@api_router.delete("/clubs/{club_id}/icon")
async def delete_club_icon(club_id: str, user: dict = Depends(require_admin)):
    """Remove a club's icon so the letter fallback returns."""
    _ensure_club(user, club_id)
    club = await db.clubs.find_one({"id": club_id}, {"_id": 0})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    await db.clubs.update_one({"id": club_id}, {"$unset": {"icon": ""}})
    await _log_audit(request=None, user=user, action="CLUB_ICON_DELETED",
                     description=f"Removed club icon for {club.get('name')}",
                     resource_type="club", resource_id=club_id, club_id=club_id)
    return _club_public(await db.clubs.find_one({"id": club_id}, {"_id": 0}))


@api_router.delete("/clubs/{club_id}")
async def delete_club(club_id: str, user: dict = Depends(require_webmaster)):
    n = await db.classes.count_documents({"club_id": club_id})
    if n:
        raise HTTPException(status_code=400,
                            detail="Club still has classes — delete its classes first")
    await db.clubs.delete_one({"id": club_id})
    await db.users.delete_many({"club_id": club_id})
    logger.info("CLUB DELETE id=%s by=%s", club_id, user.get("username"))
    await _log_audit(request=None, user=user, action="CLUB_DELETED",
                     description=f"Deleted club", resource_type="club",
                     resource_id=club_id, club_id=club_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Adverts (webmaster-managed; shown interleaved on public pages)
# ---------------------------------------------------------------------------
ADVERT_IMAGE_MAX = 2 * 1024 * 1024
ADVERT_FORMATS = ("auto", "landscape", "portrait", "square")


def _valid_advert_format(fmt: Optional[str]) -> str:
    """Normalise + validate an advert's display shape (defaults to auto)."""
    f = (fmt or "auto").strip().lower() or "auto"
    if f not in ADVERT_FORMATS:
        raise HTTPException(status_code=400,
                            detail="format must be auto, landscape, portrait or square")
    return f


@api_router.get("/adverts")
async def get_adverts():
    """Public: active adverts only, in display order. The rotation (rolling
    window capped at 10 per page load) is chosen client-side on refresh.
    Each advert carries up to three images (landscape/portrait/square) so the
    card can pick the one matching its display box; legacy adverts fall back
    to their single `image`."""
    docs = await db.adverts.find({"active": True}, {"_id": 0}).sort("order", 1).to_list(100)
    return [{k: a.get(k) for k in ("id", "name", "image", "images", "link_url", "format")} for a in docs]


@api_router.get("/adverts/manage")
async def adverts_manage(user: dict = Depends(require_webmaster)):
    """Webmaster-only: every advert, active or not, with its metadata."""
    return await db.adverts.find({}, {"_id": 0}).sort("order", 1).to_list(100)


def _detect_image_type(data: bytes) -> Optional[str]:
    """MIME type from magic bytes only — the client-declared content type is
    never trusted, so a file cannot masquerade as an image (SVG/HTML/JS are
    all rejected) and stored data can never be rendered as executable content.
    """
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return None


ADVERT_IMAGE_SHAPES = ("landscape", "portrait", "square")


async def _read_advert_image(file: UploadFile) -> str:
    """Validate + read an advert image into a base64 data URL (2 MB cap).
    The image type is verified from magic bytes, never the declared type."""
    data = await file.read()
    if len(data) > ADVERT_IMAGE_MAX:
        raise HTTPException(status_code=400, detail="Image is too large — 2 MB max")
    ctype = _detect_image_type(data)
    if not ctype:
        raise HTTPException(status_code=400,
                            detail="Not a recognised image — the file must be a PNG, JPEG, GIF or WebP")
    return f"data:{ctype};base64,{base64.b64encode(data).decode()}"


async def _read_advert_images(landscape: Optional[UploadFile], portrait: Optional[UploadFile],
                              square: Optional[UploadFile]) -> dict:
    """Read the three optional per-shape images into a {shape: dataURL} map,
    keeping only the shapes that were actually uploaded."""
    images = {}
    for f, shape in ((landscape, "landscape"), (portrait, "portrait"), (square, "square")):
        if f:
            images[shape] = await _read_advert_image(f)
    return images


@api_router.post("/adverts")
async def create_advert(user: dict = Depends(require_webmaster),
                        name: str = Form(""), link_url: str = Form(""),
                        active: bool = Form(True), format: str = Form("auto"),
                        file: UploadFile = File(None),
                        file_landscape: UploadFile = File(None),
                        file_portrait: UploadFile = File(None),
                        file_square: UploadFile = File(None)):
    """Create an advert. Up to three images can be supplied — one per display
    shape (file_landscape / file_portrait / file_square) — so the card always
    picks the image that fits its box. The legacy single `file` field is still
    accepted (stored as the advert's `image`) for backward compatibility.
    Images are optional at creation; more can be added later via PUT images."""
    order = await db.adverts.count_documents({})
    images = await _read_advert_images(file_landscape, file_portrait, file_square)
    image = await _read_advert_image(file) if file else None
    # Mirror the legacy single file into the landscape slot so new cards can
    # always display it, unless an explicit landscape image was supplied.
    if image and "landscape" not in images:
        images["landscape"] = image
    doc = {"id": new_id(), "name": name, "link_url": link_url, "active": bool(active),
           "format": _valid_advert_format(format),
           "order": order, "images": images, "image": image, "created_at": now_iso()}
    await db.adverts.insert_one(doc)
    doc.pop("_id", None)
    await _log_audit(request=None, user=user, action="ADVERT_CREATED",
                     description=f"Created advert {name or '(no name)'}",
                     resource_type="advert", resource_id=doc["id"])
    return doc


@api_router.put("/adverts/{advert_id}")
async def update_advert(advert_id: str, data: AdvertUpdate,
                        user: dict = Depends(require_webmaster)):
    doc = await db.adverts.find_one({"id": advert_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Advert not found")
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if "format" in update:
        update["format"] = _valid_advert_format(update["format"])
    if update:
        await db.adverts.update_one({"id": advert_id}, {"$set": update})
    await _log_audit(request=None, user=user, action="ADVERT_UPDATED",
                     description=f"Updated advert {doc.get('name') or advert_id}",
                     resource_type="advert", resource_id=advert_id)
    return await db.adverts.find_one({"id": advert_id}, {"_id": 0})


@api_router.put("/adverts/{advert_id}/image")
async def upload_advert_image(advert_id: str, user: dict = Depends(require_webmaster),
                              file: UploadFile = File(...)):
    """Legacy single-image upload (kept for backward compatibility). Also
    recorded as the landscape variant so new cards can use it."""
    doc = await db.adverts.find_one({"id": advert_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Advert not found")
    data = await _read_advert_image(file)
    images = dict(doc.get("images") or {})
    images["landscape"] = data
    await db.adverts.update_one({"id": advert_id},
                                {"$set": {"image": data, "images": images}})
    await _log_audit(request=None, user=user, action="ADVERT_IMAGE_UPDATED",
                     description="Replaced advert image", resource_type="advert",
                     resource_id=advert_id)
    return await db.adverts.find_one({"id": advert_id}, {"_id": 0})


@api_router.put("/adverts/{advert_id}/images")
async def upload_advert_images(advert_id: str, user: dict = Depends(require_webmaster),
                               file_landscape: UploadFile = File(None),
                               file_portrait: UploadFile = File(None),
                               file_square: UploadFile = File(None)):
    """Set or replace the per-shape images of an advert. Only the shapes
    supplied in this request change; the others keep their current image."""
    doc = await db.adverts.find_one({"id": advert_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Advert not found")
    images = dict(doc.get("images") or {})
    images.update(await _read_advert_images(file_landscape, file_portrait, file_square))
    await db.adverts.update_one({"id": advert_id}, {"$set": {"images": images}})
    await _log_audit(request=None, user=user, action="ADVERT_IMAGE_UPDATED",
                     description="Updated advert images", resource_type="advert",
                     resource_id=advert_id)
    return await db.adverts.find_one({"id": advert_id}, {"_id": 0})


@api_router.delete("/adverts/{advert_id}")
async def delete_advert(advert_id: str, user: dict = Depends(require_webmaster)):
    await db.adverts.delete_one({"id": advert_id})
    await _log_audit(request=None, user=user, action="ADVERT_DELETED",
                     description="Deleted advert", resource_type="advert",
                     resource_id=advert_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Email settings (webmaster-only) — runtime SMTP configuration so email can
# be enabled from the webmaster console once the site is live, without
# touching the server. The password is encrypted at rest.
# ---------------------------------------------------------------------------
@api_router.get("/admin/email-settings")
async def get_email_settings(user: dict = Depends(require_webmaster)):
    cfg = await _get_email_settings()
    doc = await db.settings.find_one({"key": "email"}, {"_id": 0})
    return {
        "configured": cfg["configured"],
        "using_env": cfg["using_env"],
        "smtp_host": cfg["smtp_host"],
        "smtp_port": cfg["smtp_port"],
        "smtp_user": cfg["smtp_user"],
        "mail_from": cfg["mail_from"],
        # Never return the plaintext password — only whether one is set.
        "password_set": bool(doc and doc.get("smtp_password_enc")) or bool(SMTP_PASSWORD),
    }


@api_router.put("/admin/email-settings")
async def update_email_settings(data: EmailSettingsInput, request: Request,
                                user: dict = Depends(require_webmaster)):
    host = (data.smtp_host or "").strip()
    if host and data.smtp_port is None:
        raise HTTPException(status_code=400,
                            detail="SMTP port is required when setting an SMTP host")
    existing = await db.settings.find_one({"key": "email"}, {"_id": 0}) or {}
    update = {
        "smtp_host": host,
        "smtp_port": int(data.smtp_port or 587),
        "smtp_user": (data.smtp_user or "").strip(),
        "mail_from": (data.mail_from or "").strip() if data.mail_from is not None
                     else existing.get("mail_from", ""),
        "updated_at": now_iso(),
        "updated_by": user.get("username"),
    }
    if data.smtp_password is not None and data.smtp_password.strip():
        update["smtp_password_enc"] = _encrypt_secret(data.smtp_password.strip())
    elif host and existing.get("smtp_password_enc"):
        # Blank password + existing secret: keep the stored one.
        update["smtp_password_enc"] = existing["smtp_password_enc"]
    else:
        update["smtp_password_enc"] = ""
    await db.settings.update_one({"key": "email"}, {"$set": update}, upsert=True)
    logger.info("SECURITY EMAIL SETTINGS CHANGED by=%s host=%s ip=%s",
                user.get("username"), host, _client_ip(request))
    await _log_audit(request=request, user=user, action="EMAIL_SETTINGS_CHANGED",
                     description=f"Email (SMTP) settings updated (host {host or 'cleared'})")
    return {"ok": True, "configured": bool(host)}


@api_router.post("/admin/email-settings/test")
async def test_email_settings(data: TestEmailInput, request: Request,
                              user: dict = Depends(require_webmaster)):
    cfg = await _get_email_settings()
    if not cfg.get("configured"):
        raise HTTPException(status_code=400,
                            detail="Email settings are not configured yet — save them first")
    msg = EmailMessage()
    msg["Subject"] = "SailScore — test email"
    msg["From"] = cfg.get("mail_from") or cfg.get("smtp_user") or "sailscore@localhost"
    msg["To"] = data.to_email
    msg.set_content(
        "This is a test email from SailScore. Your email settings are working — "
        "passcode-reset emails will be delivered to this server.\n"
    )
    try:
        with smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"], timeout=15) as s:
            s.starttls()
            if cfg.get("smtp_user"):
                s.login(cfg["smtp_user"], cfg.get("smtp_password") or "")
            s.send_message(msg)
    except Exception as exc:
        logger.error("TEST EMAIL FAILED to=%s by=%s error=%s",
                     data.to_email, user.get("username"), exc)
        raise HTTPException(status_code=502,
                            detail="Test email failed to send — check the SMTP host, port and credentials")
    logger.info("TEST EMAIL SENT to=%s by=%s ip=%s",
                data.to_email, user.get("username"), _client_ip(request))
    await _log_audit(request=request, user=user, action="EMAIL_TEST_SENT",
                     description=f"Test email sent to {data.to_email}")
    return {"ok": True, "message": f"Test email sent to {data.to_email}"}


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
    await _log_audit(request=None, user=user, action="CLASS_CREATED",
                     description=f"Created class {data.name}",
                     resource_type="class", resource_id=doc["id"], club_id=club_id)
    return doc


@api_router.put("/classes/{class_id}")
async def update_class(class_id: str, data: ClassInput, user: dict = Depends(require_admin)):
    cls = await _class_of_club(class_id, user)
    await db.classes.update_one({"id": class_id}, {"$set": {"name": data.name,
                                  "default_start_time": data.default_start_time, "scoring_mode": data.scoring_mode}})
    await _log_audit(request=None, user=user, action="CLASS_UPDATED",
                     description=f"Updated class {cls.get('name')}",
                     resource_type="class", resource_id=class_id, club_id=cls.get("club_id"))
    return await db.classes.find_one({"id": class_id}, {"_id": 0})


@api_router.delete("/classes/{class_id}")
async def delete_class(class_id: str, user: dict = Depends(require_admin)):
    cls = await _class_of_club(class_id, user)
    await db.classes.delete_one({"id": class_id})
    await _log_audit(request=None, user=user, action="CLASS_DELETED",
                     description=f"Deleted class {cls.get('name')}",
                     resource_type="class", resource_id=class_id, club_id=cls.get("club_id"))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Boats
# ---------------------------------------------------------------------------
@api_router.get("/boats")
async def get_boats(request: Request, class_id: Optional[str] = None, year: Optional[int] = None,
                   active_only: bool = False, club_id: Optional[str] = None):
    q = {}
    user = await get_current_user(request)
    if user and user.get("role") != "webmaster" and class_id:
        # Staff may never enumerate another club's boats via a class_id param.
        await _class_visible_or_404(class_id, user)
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
    cls = await _class_of_club(data.class_id, user)
    doc = data.model_dump()
    doc.pop("expected_version", None)
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["version"] = 1
    await db.boats.insert_one(doc)
    doc.pop("_id", None)
    await _log_audit(request=None, user=user, action="BOAT_CREATED",
                     description=f"Created boat {doc.get('name')} ({doc.get('sail_no')})",
                     resource_type="boat", resource_id=doc["id"], club_id=cls.get("club_id"))
    return doc


@api_router.put("/boats/{boat_id}")
async def update_boat(boat_id: str, data: BoatInput, user: dict = Depends(require_admin)):
    boat = await _boat_of_club(boat_id, user)
    cls = await _class_of_club(data.class_id, user)
    expected = _expected_version(data)
    update = data.model_dump()
    update.pop("expected_version", None)
    result = await db.boats.update_one(_version_filter(boat_id, expected),
                                       {"$set": update, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    await _log_audit(request=None, user=user, action="BOAT_UPDATED",
                     description=f"Updated boat {boat.get('name')}",
                     resource_type="boat", resource_id=boat_id, club_id=cls.get("club_id"))
    return await db.boats.find_one({"id": boat_id}, {"_id": 0})


@api_router.delete("/boats/{boat_id}")
async def delete_boat(boat_id: str, request: Request,
                      user: dict = Depends(require_admin)):
    boat = await _boat_of_club(boat_id, user)
    # A boat that took part in a locked season can never be deleted: the
    # frozen snapshot references it by id, and the boat's own record keeps the
    # results auditable. (Editing details is harmless — locked standings come
    # from the snapshot, which stores its own copy of the boat's name.)
    locked = await db.series.count_documents({"class_id": boat.get("class_id"),
                                               "year": boat.get("year"),
                                               "lock_status": {"$in": list(NOT_EDITABLE)}})
    if locked:
        raise HTTPException(status_code=409,
                            detail="This boat took part in a locked or archived season and cannot be deleted.")
    expected = _expected_version_query(request)
    result = await db.boats.delete_one(_version_filter(boat_id, expected))
    if result.deleted_count == 0:
        _raise_stale(expected)
    club_id = await _class_club_id(boat.get("class_id"))
    await _log_audit(request=None, user=user, action="BOAT_DELETED",
                     description=f"Deleted boat {boat.get('name')}",
                     resource_type="boat", resource_id=boat_id, club_id=club_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Series
# ---------------------------------------------------------------------------
@api_router.get("/series")
async def get_series(request: Request, class_id: Optional[str] = None, year: Optional[int] = None,
                    club_id: Optional[str] = None):
    q = {}
    user = await get_current_user(request)
    if user and user.get("role") != "webmaster" and class_id:
        # Staff may never enumerate another club's series via a class_id param.
        await _class_visible_or_404(class_id, user)
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
    cls = await _class_of_club(data.class_id, user)
    doc = data.model_dump()
    doc.pop("expected_version", None)
    if doc.get("schedule") is None:
        doc["schedule"] = []
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["version"] = 1
    await db.series.insert_one(doc)
    doc.pop("_id", None)
    await _log_audit(request=None, user=user, action="SERIES_CREATED",
                     description=f"Created series {data.name} ({data.year})",
                     resource_type="series", resource_id=doc["id"], club_id=cls.get("club_id"))
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
    series = await _series_of_club(series_id, user)
    await _ensure_series_not_locked(series_id,
                                    detail="Season results are locked — scoring rules cannot be changed. Use the administrator correction process to amend the season.")
    cls = await _class_of_club(data.class_id, user)
    expected = _expected_version(data)
    update = data.model_dump()
    update.pop("expected_version", None)
    if update.get("schedule") is None:
        update.pop("schedule", None)
    result = await db.series.update_one(_version_filter(series_id, expected),
                                        {"$set": update, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    await _sync_race_dates(series_id, update.get("schedule"))
    await _log_audit(request=None, user=user, action="SERIES_UPDATED",
                     description=f"Updated series {series.get('name')}",
                     resource_type="series", resource_id=series_id, club_id=cls.get("club_id"))
    return await db.series.find_one({"id": series_id}, {"_id": 0})


def _saturdays_from(start: str, n: int):
    d0 = datetime.strptime(start, "%Y-%m-%d").date()
    return [(d0 + timedelta(days=7 * i)).isoformat() for i in range(max(0, n))]


@api_router.post("/series/{series_id}/generate-schedule")
async def generate_schedule(series_id: str, data: GenScheduleInput, user: dict = Depends(require_admin)):
    series = await _series_of_club(series_id, user)
    await _ensure_series_not_locked(series_id,
                                    detail="Season results are locked — the schedule cannot be changed. Use the administrator correction process to amend the season.")
    expected = _expected_version(data)
    total = data.count or series.get("planned_races", 0)
    races = await db.races.find({"series_id": series_id, "status": "published"}, {"_id": 0}).to_list(1000)
    races.sort(key=lambda r: (r.get("date", ""), r.get("race_number", 0)))
    sailed_dates = [r["date"] for r in races]
    if total < len(sailed_dates):
        total = len(sailed_dates)
    future = _saturdays_from(data.start_date, total - len(sailed_dates))
    schedule = sailed_dates + future
    result = await db.series.update_one(_version_filter(series_id, expected),
                                        {"$set": {"schedule": schedule, "planned_races": total},
                                         "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    await _sync_race_dates(series_id, schedule)
    club_id = await _class_club_id(series.get("class_id"))
    await _log_audit(request=None, user=user, action="SERIES_UPDATED",
                     description=f"Generated schedule for series {series.get('name')}",
                     resource_type="series", resource_id=series_id, club_id=club_id)
    return await db.series.find_one({"id": series_id}, {"_id": 0})


@api_router.delete("/series/{series_id}")
async def delete_series(series_id: str, request: Request,
                        user: dict = Depends(require_admin)):
    series = await _series_of_club(series_id, user)
    await _ensure_series_not_locked(series_id, detail="Season results are locked — the series cannot be deleted.")
    expected = _expected_version_query(request)
    result = await db.series.delete_one(_version_filter(series_id, expected))
    if result.deleted_count == 0:
        _raise_stale(expected)
    club_id = await _class_club_id(series.get("class_id"))
    await _log_audit(request=None, user=user, action="SERIES_DELETED",
                     description=f"Deleted series {series.get('name')}",
                     resource_type="series", resource_id=series_id, club_id=club_id)
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
    user = await get_current_user(request)
    if user and user.get("role") != "webmaster":
        # Staff may never enumerate another club's races via class/series ids.
        if class_id:
            await _class_visible_or_404(class_id, user)
        if series_id:
            await _series_visible_or_404(series_id, user)
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
    # Integrity: the race's class must be the series' class — a race cannot be
    # attached to a series from another fleet/class.
    if series.get("class_id") != data.class_id:
        raise HTTPException(status_code=400,
                            detail="Class does not match the series — a race must belong to its series' fleet")
    await _ensure_series_not_locked(series["id"],
                                    detail="Season results are locked — new races cannot be created.")
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
        "version": 1,  # optimistic concurrency counter, bumped on every mutation
    }
    await db.races.insert_one(doc)
    doc.pop("_id", None)
    await _log_audit(request=None, user=user, action="RACE_CREATED",
                     description=f"Created race {data.race_number} on {data.date} ({cls.get('name')})",
                     resource_type="race", resource_id=doc["id"], club_id=cls.get("club_id"))
    return doc


@api_router.post("/races/{race_id}/start")
async def start_race(race_id: str, data: StartRaceInput, user: dict = Depends(require_officer)):
    """Set (or clear) the actual start time ('gun'). Device time is captured on
    the client and sent here; the timer runs from this instant."""
    race = await _race_of_club(race_id, user)
    await _ensure_series_not_locked(race.get("series_id"))
    expected = _expected_version(data)
    actual_start = data.start_time or None
    result = await db.races.update_one(_version_filter(race_id, expected),
                                       {"$set": {"actual_start": actual_start},
                                        "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    updated = await db.races.find_one({"id": race_id}, {"_id": 0})
    club_id = await _class_club_id(race.get("class_id"))
    await _log_audit(request=None, user=user, action="RACE_UPDATED",
                     description=f"Start gun {'set' if actual_start else 'cleared'} for race {race.get('race_number')}",
                     resource_type="race", resource_id=race_id, club_id=club_id)
    return updated


@api_router.put("/races/{race_id}/notifications")
async def update_notifications(race_id: str, data: RaceNotificationInput, user: dict = Depends(require_officer)):
    race = await _race_of_club(race_id, user)
    await _ensure_series_not_locked(race.get("series_id"))
    expected = _expected_version(data)
    update = {k: v for k, v in data.model_dump().items()
              if v is not None and k != "expected_version"}
    result = await db.races.update_one(_version_filter(race_id, expected),
                                       {"$set": update, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    club_id = await _class_club_id(race.get("class_id"))
    await _log_audit(request=None, user=user, action="RACE_UPDATED",
                     description=f"Updated notifications for race {race.get('race_number')}",
                     resource_type="race", resource_id=race_id, club_id=club_id)
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.post("/races/{race_id}/select-boats")
async def select_boats(race_id: str, data: SelectBoatsInput, user: dict = Depends(require_officer)):
    race = await _race_of_club(race_id, user)
    await _ensure_series_not_locked(race.get("series_id"))
    expected = _expected_version(data)
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
    result = await db.races.update_one(_version_filter(race_id, expected),
                                       {"$set": {"results": results}, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    club_id = await _class_club_id(race.get("class_id"))
    await _log_audit(request=None, user=user, action="RACE_UPDATED",
                     description=f"Updated starters for race {race.get('race_number')} ({len(selected)} boats)",
                     resource_type="race", resource_id=race_id, club_id=club_id)
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.post("/races/{race_id}/finish")
async def record_finish(race_id: str, data: FinishInput, user: dict = Depends(require_officer)):
    race = await _race_of_club(race_id, user)
    await _ensure_series_not_locked(race.get("series_id"))
    expected = _expected_version(data)
    results = race["results"]
    for r in results:
        if r["boat_id"] == data.boat_id:
            r["code"] = "FINISHED"
            r["finish_time"] = data.finish_time or now_iso()
            r["position"] = None  # set by re-sequencing below
    # Re-sequence all finishers: one-design by finish time, IRC by corrected time.
    await _resequence_race(race)
    result = await db.races.update_one(_version_filter(race_id, expected),
                                       {"$set": {"results": results}, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    club_id = await _class_club_id(race.get("class_id"))
    await _log_audit(request=None, user=user, action="RESULTS_SUBMITTED",
                     description=f"Finish recorded for boat {data.boat_id} in race {race.get('race_number')}",
                     resource_type="race", resource_id=race_id, club_id=club_id)
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.post("/races/{race_id}/undo-finish")
async def undo_finish(race_id: str, data: FinishInput, user: dict = Depends(require_officer)):
    race = await _race_of_club(race_id, user)
    await _ensure_series_not_locked(race.get("series_id"))
    expected = _expected_version(data)
    results = race["results"]
    for r in results:
        if r["boat_id"] == data.boat_id:
            r["code"] = "DNS"
            r["finish_time"] = None
            r["position"] = None
    # Re-sequence the remaining finishers per the class scoring mode (finish
    # time for one-design, corrected time for IRC/PY handicap classes).
    await _resequence_race(race)
    result = await db.races.update_one(_version_filter(race_id, expected),
                                       {"$set": {"results": results}, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    club_id = await _class_club_id(race.get("class_id"))
    await _log_audit(request=None, user=user, action="RESULTS_UPDATED",
                     description=f"Finish undone for boat {data.boat_id} in race {race.get('race_number')}",
                     resource_type="race", resource_id=race_id, club_id=club_id)
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.put("/races/{race_id}/result/{boat_id}")
async def adjust_result(race_id: str, boat_id: str, data: ResultAdjustInput,
                        user: dict = Depends(require_officer)):
    race = await _race_of_club(race_id, user)
    await _ensure_series_not_locked(race.get("series_id"))
    results = race["results"]
    target = next((r for r in results if r["boat_id"] == boat_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Boat not in race")
    prev_code = target.get("code")
    new_code = data.code if data.code is not None else prev_code
    if data.code is not None:
        target["code"] = data.code
        # ZFP/SCP boats finished, so their finishing place is kept; RDG/DPI
        # boats are scored by the committee's manual points (place irrelevant);
        # TLE boats crossed after the limit and score per the TLE rule; all
        # other codes lose their place.
        if data.code not in ("FINISHED", *PENALTY_CODES, *MANUAL_POINT_CODES, *TLE_CODES):
            target["position"] = None
        # Leaving a manual-points code clears the committee's points so they
        # can never leak into a later finishing-place score.
        if prev_code in MANUAL_POINT_CODES and data.code not in MANUAL_POINT_CODES:
            target["penalty_points"] = 0
    # DPI/RDG are decisions, never inferences: the resulting score must be
    # entered by the committee on THIS request rather than guessed. The stored
    # penalty_points default of 0 must never satisfy the requirement — a
    # boat moved to DPI/RDG without an explicit committee score would
    # silently score 0, so the field is mandatory when entering the code.
    if new_code in MANUAL_POINT_CODES and data.penalty_points is None:
        raise HTTPException(status_code=400,
                            detail=f"{new_code} requires the resulting points entered by the committee "
                                   "(penalty_points) — the system will not infer a score.")
    for field in ("dpi_reason", "dpi_decision_maker", "dpi_date", "dpi_notes",
                  "rdg_reason", "rdg_decision_maker", "rdg_date", "rdg_notes"):
        value = getattr(data, field)
        if value is not None:
            target[field] = value
    if data.position is not None:
        # A non-finish code cannot carry a finishing position: DNC/DNS/OCS/
        # NSC/DNF/RET/DSQ/DNE/UFD/BFD boats have no place, and TLE boats are
        # scored by the TLE rule, not by where they crossed.
        if new_code not in ("FINISHED", *PENALTY_CODES, *MANUAL_POINT_CODES):
            raise HTTPException(status_code=400,
                                detail=f"A boat scored {new_code} cannot carry a finishing position — {new_code} boats are not placed.")
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
    expected = _expected_version(data)
    result = await db.races.update_one(_version_filter(race_id, expected),
                                       {"$set": {"results": results}, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    club_id = await _class_club_id(race.get("class_id"))
    await _log_audit(request=None, user=user, action="RESULTS_UPDATED",
                     description=f"Result adjusted for boat {boat_id} in race {race.get('race_number')} (code {target.get('code')})",
                     resource_type="race", resource_id=race_id, club_id=club_id)
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.get("/races/{race_id}/validation")
async def race_validation(race_id: str, request: Request, user: dict = Depends(require_officer)):
    """Validation report for a race: errors (structurally invalid result
    combinations) and warnings (missing decision records, penalty basis,
    TLE rule not configured...). The series' scoring config is taken into
    account, so a TLE warning only appears when no TLE rule is configured."""
    race = await _race_of_club(race_id, user)
    series = {}
    if race.get("series_id"):
        series = await db.series.find_one({"id": race["series_id"]}, {"_id": 0}) or {}
    cfg = _series_scoring_config(series)
    issues = validate_race_results(race.get("results", []), cfg)
    return {
        "race_id": race_id,
        "errors": [w for w in issues if w["level"] == "error"],
        "warnings": [w for w in issues if w["level"] == "warning"],
        "all": issues,
    }


@api_router.post("/races/{race_id}/status/{status}")
async def set_race_status(race_id: str, status: str, request: Request,
                          user: dict = Depends(require_officer)):
    if status not in ("setup", "provisional", "published"):
        raise HTTPException(status_code=400, detail="Invalid status")
    race = await _race_of_club(race_id, user)
    await _ensure_series_not_locked(race.get("series_id"))
    expected = _expected_version_query(request)
    result = await db.races.update_one(
        _version_filter(race_id, expected),
        {"$set": {"status": status, "published_at": now_iso() if status == "published" else None},
         "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    club_id = await _class_club_id(race.get("class_id"))
    if status == "published":
        action = "RESULTS_PUBLISHED"
    elif race.get("status") == "published":
        action = "RESULTS_UNPUBLISHED"
    else:
        action = "RACE_STATUS_CHANGED"
    await _log_audit(request=None, user=user, action=action,
                     description=f"Race {race.get('race_number')} status -> {status}",
                     resource_type="race", resource_id=race_id, club_id=club_id)
    updated = await db.races.find_one({"id": race_id}, {"_id": 0})
    # Validate before publishing (Requirement 7: race result saved -> validate
    # -> recalculate series -> update standings). The standings are computed on
    # read, so they always reflect the latest published races; publishing
    # attaches the validation report so the committee can see warnings/errors.
    if status == "published" and updated:
        series = {}
        if updated.get("series_id"):
            series = await db.series.find_one({"id": updated["series_id"]}, {"_id": 0}) or {}
        issues = validate_race_results(updated.get("results", []), _series_scoring_config(series))
        errors = [w for w in issues if w["level"] == "error"]
        warnings = [w for w in issues if w["level"] == "warning"]
        if errors or warnings:
            logger.warning("RACE PUBLISH VALIDATION race=%s errors=%d warnings=%d",
                           race_id, len(errors), len(warnings))
        updated = dict(updated)
        updated["validation"] = {"errors": errors, "warnings": warnings}
    return updated


@api_router.delete("/races/{race_id}")
async def delete_race(race_id: str, request: Request,
                      user: dict = Depends(require_officer)):
    race = await _race_of_club(race_id, user)
    await _ensure_series_not_locked(race.get("series_id"))
    expected = _expected_version_query(request)
    result = await db.races.delete_one(_version_filter(race_id, expected))
    if result.deleted_count == 0:
        _raise_stale(expected)
    club_id = await _class_club_id(race.get("class_id"))
    await _log_audit(request=None, user=user, action="RACE_DELETED",
                     description=f"Deleted race {race.get('race_number')} ({race.get('date')})",
                     resource_type="race", resource_id=race_id, club_id=club_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Audit log (persistent, Mongo-backed)
# ---------------------------------------------------------------------------
AUDIT_LIMIT_MAX = 500


@api_router.get("/audit")
async def read_audit(request: Request, user: dict = Depends(require_admin),
                     club_id: Optional[str] = None, username: Optional[str] = None,
                     role: Optional[str] = None, action: Optional[str] = None,
                     from_date: Optional[str] = None, to_date: Optional[str] = None,
                     limit: int = 100, offset: int = 0):
    """Audit events, newest first. Club admins see ONLY their own club's
    events — the club scope is derived from the authenticated account and a
    club_id param can never widen it. The webmaster sees everything and may
    additionally filter by club, user, role, action and date range."""
    q = {}
    if user.get("role") == "webmaster":
        if club_id:
            q["club_id"] = club_id
    else:
        q["club_id"] = user.get("club_id")
    if username:
        q["username"] = username
    if role:
        q["role"] = role
    if action:
        q["action"] = action
    ts = {}
    if from_date:
        ts["$gte"] = from_date if len(from_date) > 10 else f"{from_date}T00:00:00+00:00"
    if to_date:
        ts["$lte"] = to_date if len(to_date) > 10 else f"{to_date}T23:59:59.999+00:00"
    if ts:
        q["timestamp"] = ts
    lim = min(max(1, limit), AUDIT_LIMIT_MAX)
    off = max(0, offset)
    total = await db.audit_logs.count_documents(q)
    items = await db.audit_logs.find(q, {"_id": 0})\
        .sort("timestamp", -1)\
        .skip(off)\
        .limit(lim)\
        .to_list(lim)
    return {"items": items, "total": total, "limit": lim, "offset": off}


# ---------------------------------------------------------------------------
# Backup / export (zip of JSON collection dumps)
# ---------------------------------------------------------------------------
# Fields that must never leave the server in a backup (authentication
# secrets, revocation counters, lockout state).
BACKUP_SECRET_KEYS = ("passcode_hash", "password_hash", "reset_token_hash",
                      "reset_token_expires", "token_version", "failed_attempts",
                      "last_failed_login", "locked_until", "lockout_level")


def _strip_backup_secrets(doc: dict) -> dict:
    """Remove credential/security fields from a document before export."""
    return {k: v for k, v in doc.items() if k not in BACKUP_SECRET_KEYS and k != "_id"}


async def _build_backup(request: Request, user: dict, scope_club_id: Optional[str]):
    """Build a zip of JSON dumps for one club (Race Admin always; Webmaster
    with ?club_id=) or every club (Webmaster, no param). The server
    constructs every query itself — callers cannot inject queries, and a
    non-webmaster caller's scope is always their own club regardless of any
    club_id parameter."""
    if user.get("role") != "webmaster":
        scope_club_id = user.get("club_id")
    if not scope_club_id and user.get("role") != "webmaster":
        raise HTTPException(status_code=403, detail="Backup requires a club scope")
    now = datetime.now(timezone.utc)
    stamp = now.date().isoformat()
    class_ids = None
    if scope_club_id:
        classes_in = await db.classes.find({"club_id": scope_club_id}, {"_id": 0, "id": 1}).to_list(5000)
        class_ids = [c["id"] for c in classes_in]
    clubs = await db.clubs.find({"id": scope_club_id} if scope_club_id else {}, {"_id": 0}).to_list(5000)
    users = await db.users.find({"club_id": scope_club_id} if scope_club_id else {}, {"_id": 0}).to_list(5000)
    classes = await db.classes.find({"club_id": scope_club_id} if scope_club_id else {}, {"_id": 0}).to_list(5000)
    boats = await db.boats.find({"class_id": {"$in": class_ids}} if scope_club_id else {}, {"_id": 0}).to_list(5000)
    series = await db.series.find({"class_id": {"$in": class_ids}} if scope_club_id else {}, {"_id": 0}).to_list(5000)
    races = await db.races.find({"class_id": {"$in": class_ids}} if scope_club_id else {}, {"_id": 0}).to_list(5000)
    # Adverts are GLOBAL (webmaster-managed, no club_id) — they are never part
    # of a club-scoped backup. Only the webmaster's full-system backup (no
    # scope) includes them; a club admin can never obtain another club's (or
    # any global) advert data this way.
    adverts = await db.adverts.find({}, {"_id": 0}).to_list(5000) if not scope_club_id else []
    audit_logs = await db.audit_logs.find({"club_id": scope_club_id} if scope_club_id else {}, {"_id": 0}).to_list(20000)
    results = []
    for r in races:
        for res in r.get("results", []):
            row = dict(res)
            row.update({"race_id": r["id"], "date": r.get("date"),
                        "class_id": r.get("class_id"), "series_id": r.get("series_id")})
            results.append(row)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, payload in (
            ("metadata.json", {"app": "SailScore", "exported_at": now.isoformat(),
                               "scope": "all-clubs" if not scope_club_id else "club",
                               "club_id": scope_club_id,
                               "generated_by": user.get("username"),
                               "generated_by_role": user.get("role")}),
            ("clubs.json", clubs),
            ("users.json", [_strip_backup_secrets(u) for u in users]),
            ("classes.json", classes),
            ("boats.json", boats),
            ("series.json", series),
            ("races.json", races),
            ("results.json", results),
            ("adverts.json", adverts),
            ("audit_logs.json", audit_logs),
        ):
            zf.writestr(name, json.dumps(payload, indent=2, default=str))
    data = buf.getvalue()
    slug, club_name = "", ""
    if scope_club_id:
        club = await db.clubs.find_one({"id": scope_club_id}, {"_id": 0, "slug": 1, "name": 1})
        slug = (club or {}).get("slug", "club")
        club_name = (club or {}).get("name", "")
    fname = (f"sailscore-{slug}-backup-{stamp}.zip" if scope_club_id
             else f"sailscore-backup-{stamp}.zip")
    description = (f"{user.get('username')} (webmaster) downloaded full system backup"
                   if not scope_club_id
                   else f"{club_name or 'Club'} {user.get('role')} downloaded club backup")
    # The audit record reflects the ACTUAL authorised scope (derived from the
    # authenticated account, never from a client-supplied club_id).
    await _log_audit(request=request, user=user, action="BACKUP_DOWNLOAD",
                     description=description, resource_type="backup",
                     resource_id=scope_club_id or "all", club_id=scope_club_id)
    logger.info("BACKUP DOWNLOAD scope=%s by=%s ip=%s",
                scope_club_id or "all", user.get("username"), _client_ip(request))
    return Response(content=data, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{fname}"',
        "Cache-Control": "no-store",
    })


@api_router.get("/admin/backup")
async def admin_backup(request: Request, club_id: Optional[str] = None,
                       user: dict = Depends(require_webmaster)):
    """Webmaster only: download one club's backup (?club_id=) or the full
    system backup (no param)."""
    return await _build_backup(request, user, club_id)


@api_router.get("/backup")
async def club_backup(request: Request, club_id: Optional[str] = None,
                      user: dict = Depends(require_admin)):
    """Race Admin only: download their own club's backup. A club_id param can
    never widen the scope — the club is derived from the authenticated
    account, and officers are denied outright."""
    return await _build_backup(request, user, club_id)


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
#
# The engine is rules-configurable per series/season: the default is RRS
# 2025-2028 Appendix A Low Point, and every alternative (A5.3 start-area
# scoring, the finishers+1 RYA/Sailwave convention, the TLE rule, the SCP/ZFP
# penalty percentage, duty/average points and the discard policy) is a
# versioned setting on the series. Historical seasons carry their own
# snapshot of these rules, so changing them never rewrites past results.
# ---------------------------------------------------------------------------
def round_half_up(x: float) -> int:
    """RRS 44.3(c): round to the nearest whole number, 0.5 rounded upward."""
    return int(x + 0.5)


def _start_area_entries(results) -> int:
    """Boats that came to the starting area = those selected to race (not DNC
    and not on duty — an OOD boat is on the bank, not on the start line)."""
    return len([r for r in results if r.get("code") not in ("DNC", *DUTY_CODES)])


def _default_scoring_config(use_a5_3=False, use_finishers=False) -> dict:
    """The canonical, complete scoring-rule configuration for a series.

    This is the baseline RRS 2025-2028 Appendix A Low Point configuration:

    - a5_convention "a5_2": every non-finish code (DNC, DNS, OCS, UFD, BFD,
      DNF, RET, DSQ, DNE, NSC) scores series entries + 1 (A5.2 default).
      "a5_3" scores start-area codes start-area entries + 1 (A5.3 SI option);
      "finishers" scores them finishers + 1 (RYA/Sailwave convention, DNC
      always series entries + 1).
    - tle: Time Limit Expired rule. Disabled by default; when enabled the
      race committee records a boat as TLE and it scores per `method`
      ("dnf" = the active A5 DNF score, "finishers_plus_1", or "dnc").
    - scp/zfp: penalty rule per RRS 44.3(c)/30.2 — a percentage of the DNF
      score added to the boat's place, rounded half-up, never worse than DNF
      (that cap is itself configurable via cap_dnf).
    - duty: the boat's own average of its other sailed races in the series.
    - discard_policy: "fixed" (the series' discards field) or "increasing"
      (discard_schedule: discard N after M races scored).
    """
    if use_finishers:
        convention = "finishers"
    elif use_a5_3:
        convention = "a5_3"
    else:
        convention = "a5_2"
    return {
        "rrs_edition": "RRS 2025-2028",
        "a5_convention": convention,
        "discard_policy": "fixed",
        "discard_schedule": [],
        "tle": {"enabled": False, "time_limit_minutes": None, "method": "dnf"},
        "scp": {"method": "percent", "value": 20.0, "cap_dnf": True},
        "zfp": {"method": "percent", "value": 20.0, "cap_dnf": True},
        "duty": {"enabled": True, "method": "average_own_sailed", "round": 2},
    }


def _series_scoring_config(series: dict) -> dict:
    """The effective scoring config for a series: its own scoring_config
    (if stored) merged over the baseline defaults, with legacy flat flags
    (use_a5_3 / use_finishers) honoured when no explicit config exists."""
    cfg = _default_scoring_config(bool(series.get("use_a5_3")),
                                  bool(series.get("use_finishers")))
    sc = series.get("scoring_config")
    if isinstance(sc, dict):
        for key in ("rrs_edition", "a5_convention", "discard_policy", "discard_schedule"):
            if sc.get(key) is not None:
                cfg[key] = sc[key]
        for key in ("tle", "scp", "zfp", "duty"):
            if isinstance(sc.get(key), dict):
                merged = dict(cfg[key])
                merged.update({k: v for k, v in sc[key].items() if v is not None})
                cfg[key] = merged
    return cfg


def _resolve_a5_base(cfg: dict, series_entries: int, start_area_entries: int,
                     finishers: int) -> int:
    """The DNF-equivalent score under the series' active A5 convention."""
    convention = cfg.get("a5_convention", "a5_2")
    if convention == "finishers":
        return finishers + 1
    if convention == "a5_3":
        return start_area_entries + 1
    return series_entries + 1


def _effective_discards(cfg: dict, race_count: int, configured_discards: int) -> int:
    """Discards to apply for a series with `race_count` races scored.

    "increasing" policy: the largest schedule step whose after_races threshold
    has been reached (e.g. [{3,0},{6,1}] -> no discard until 6 races scored,
    then 1). "fixed" (and mini-series groups) use the configured count.
    """
    if cfg.get("discard_policy") == "increasing":
        steps = sorted(
            (s for s in (cfg.get("discard_schedule") or [])
             if isinstance(s, dict) and s.get("after_races")),
            key=lambda s: int(s["after_races"]),
        )
        d = 0
        for s in steps:
            if race_count >= int(s["after_races"]):
                d = int(s.get("discards") or 0)
        return d
    return int(configured_discards or 0)


def result_points(r, series_entries, start_area_entries, use_a5_3=False,
                  use_finishers=False, finishers=0, cfg=None):
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
    cfg:               the series scoring config (see _default_scoring_config).
                       When omitted a default config is built from the legacy
                       use_a5_3 / use_finishers flags, so callers that only
                       have the flags keep working.

    Every code has an underlying scoring rule here — none is a mere text
    label:

    FINISHED -> her place (ties split later per RRS A7).
    RDG/DPI  -> the manual points the committee decided (fallback: DNF score).
    SCP/ZFP  -> her place made worse by the series' configured penalty
                (percent of DNF, or points/places), capped at DNF when the
                series rules impose that limit.
    TLE      -> the series' configured TLE rule (default: the DNF score).
    DNC      -> series entries + 1 under every convention.
    DNS/OCS/UFD/BFD/NSC/DNF/RET/DSQ/DNE -> the active A5 base: series
                entries + 1 (A5.2 default), start-area entries + 1 (A5.3),
                or finishers + 1 (RYA/Sailwave convention).
    OOD      -> duty average, filled in later by _apply_duty_points().
    """
    if cfg is None:
        cfg = _default_scoring_config(use_a5_3, use_finishers)
    code = r.get("code")
    dnf = _resolve_a5_base(cfg, series_entries, start_area_entries, finishers)
    if code == "FINISHED":
        base = float(r["position"]) if r.get("position") else float(dnf)
        base += float(r.get("penalty_points") or 0)
        return base
    if code in MANUAL_POINT_CODES:
        pts = r.get("penalty_points")
        return float(pts) if pts is not None else float(dnf)
    if code in PENALTY_CODES:
        rule = cfg["scp"] if code == "SCP" else cfg["zfp"]
        place = r.get("position")
        if not place:
            return float(dnf)
        if rule.get("method") == "percent":
            # RRS 44.3(c): score without the penalty (her finishing place) made
            # worse by the configured percentage of the DNF score, rounded
            # half-up.
            penalty = round_half_up(float(rule.get("value", 20.0)) / 100.0 * dnf)
        else:  # "points" / "places": add the configured number outright.
            penalty = float(rule.get("value", 0.0))
        pts = float(place) + penalty
        if rule.get("cap_dnf", True):
            pts = min(pts, float(dnf))
        return pts
    if code in TLE_CODES:
        # The TLE rule is stored on the series so a future change of the
        # club's TLE convention never recalculates a historical season.
        method = (cfg.get("tle") or {}).get("method", "dnf")
        if method == "finishers_plus_1":
            return float(finishers + 1)
        if method == "dnc":
            return float(series_entries + 1)
        return float(dnf)
    # A5.2 (default): DNC, DNS, OCS, UFD, BFD, DNF, RET, DSQ, DNE and NSC all
    # score one more than the number of boats entered in the series.
    # A5.3 (SI option) / finishers convention: only DNC uses the series total;
    # the other codes use the active base (start-area or finishers).
    if code != "DNC" and cfg.get("a5_convention") in ("a5_3", "finishers"):
        return float(dnf)
    return float(series_entries + 1)


def validate_race_results(results, cfg=None) -> list:
    """Flag potentially invalid result combinations so the race committee is
    warned before publishing. Returns [{level: "error"|"warning", message}].

    Errors are structurally invalid (a boat scored twice — which would allow
    e.g. DNF AND DSQ simultaneously; a non-finish code carrying a position;
    DPI/RDG without the committee-entered score). Warnings are omissions the
    scoring rules ask the committee to record (a DPI without its decision
    basis, a TLE without an enabled TLE rule, a penalty without a place).
    """
    issues = []
    seen = {}
    for r in results:
        bid = r.get("boat_id")
        code = r.get("code")
        if bid in seen:
            issues.append({"level": "error",
                           "message": f"Boat {bid} appears more than once in this race — a boat cannot be scored twice (e.g. DNF and DSQ together)."})
        seen[bid] = True
        if not code:
            continue
        if code not in ("FINISHED", *PENALTY_CODES, *MANUAL_POINT_CODES, *TLE_CODES) \
                and r.get("position") is not None:
            issues.append({"level": "error",
                           "message": f"Boat {bid} is scored {code} but also carries a finishing position — {code} boats are not placed."})
        if code == "FINISHED" and r.get("position") is None:
            issues.append({"level": "warning",
                           "message": f"Boat {bid} is marked finished but has no finishing position — re-sequence the race."})
        if code in MANUAL_POINT_CODES and r.get("penalty_points") is None:
            issues.append({"level": "error",
                           "message": f"Boat {bid} is scored {code} without the committee-entered points — the resulting score must be recorded, never inferred."})
        if code in PENALTY_CODES and r.get("position") is None:
            issues.append({"level": "warning",
                           "message": f"Boat {bid} is scored {code} but has no finishing place to apply the penalty to — the penalty rule cannot be applied."})
        if code in TLE_CODES:
            tle = (cfg or {}).get("tle") or {}
            if not tle.get("enabled"):
                issues.append({"level": "warning",
                               "message": f"Boat {bid} is scored TLE but this series has no TLE rule configured — check the series scoring settings."})
        if code == "DPI" and not (r.get("dpi_decision_maker") or r.get("dpi_reason")):
            issues.append({"level": "warning",
                           "message": f"DPI for boat {bid} should record the decision-maker/committee and the reason for the discretionary penalty."})
        if code == "RDG" and not (r.get("rdg_decision_maker") or r.get("rdg_reason")):
            issues.append({"level": "warning",
                           "message": f"RDG for boat {bid} should record the redress decision (RRS 62.2) and the committee that granted it."})
    return issues


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


def _normalize_mini_groups(series, races):
    """Normalize a series' mini-series groups for display and scoring.

    Returns a list of dicts: {name, race_numbers, discards, race_count}.
    Explicit groups (mini_series_groups) are honoured as-is; a legacy series
    stored with mini_series_size is split into consecutive chunks of that
    size. race_count is how many of the group's race numbers actually have
    published races in the series."""
    races = list(races)
    published_numbers = {r.get("race_number") for r in races}
    groups = series.get("mini_series_groups") or []
    if not groups and series.get("mini_series_size"):
        size = max(1, int(series.get("mini_series_size") or 1))
        race_nums = [r.get("race_number") for r in races]
        groups = [{"name": f"Mini {i + 1}", "race_numbers": race_nums[i * size:(i + 1) * size],
                   "discards": series.get("mini_series_discards", 0)}
                  for i in range((len(race_nums) + size - 1) // size)]
    out = []
    for i, g in enumerate(groups):
        rns = sorted({int(n) for n in (g.get("race_numbers") or []) if int(n) >= 1})
        name = (g.get("name") or "").strip() or f"Mini {i + 1}"
        out.append({"name": name, "race_numbers": rns,
                    "discards": int(g.get("discards", 0)),
                    "race_count": len([n for n in rns if n in published_numbers])})
    return out


def _apply_duty_points(agg, entries_by_race, cfg=None):
    """Duty races (OOD — Officer of the Day) score the boat's own average of
    its OTHER races in the series where it actually sailed (code not DNC and
    not another duty), matching the Sailwave club convention of "OOD average
    points excluding DNC". A boat with no other sailed races falls back to
    the DNC score (series entries + 1) so duty can never score better than a
    finish in a tiny fleet.

    The duty rule comes from the series scoring config (cfg["duty"]); the
    rounding precision is configurable (default 2 dp). This runs on every
    standings computation, so a duty score is always the average of the
    races scored to date — it is dynamically recalculated after every race
    until the series is completed, before discards are applied."""
    duty_cfg = (cfg or _default_scoring_config()).get("duty") or {}
    precision = int(duty_cfg.get("round", 2))
    if not duty_cfg.get("enabled", True):
        # Series opted out of duty scoring: OOD entries keep their base
        # non-finish score instead of the average.
        return
    for entries in agg.values():
        sailed = [e["points"] for e in entries if e["code"] not in ("DNC", *DUTY_CODES)]
        for i, e in enumerate(entries):
            if e["code"] in DUTY_CODES:
                if sailed:
                    e["points"] = round(sum(sailed) / len(sailed), precision)
                else:
                    e["points"] = float(entries_by_race[i] + 1)


async def _series_scores(series, race_numbers=None):
    """Return (agg, boat_map, race_meta, cfg, races). agg: boat_id -> list of
    per-race entry dicts, aligned to race_meta; cfg: the series' effective
    scoring config; races: the published races scored. If race_numbers is
    given (a set/list of the series' race numbers), only those races count."""
    races = await db.races.find({"series_id": series["id"], "status": "published"}, {"_id": 0}).to_list(1000)
    races.sort(key=lambda r: (r.get("date", ""), r.get("race_number", 0)))
    if race_numbers is not None:
        keep = {int(n) for n in race_numbers}
        races = [r for r in races if int(r.get("race_number") or 0) in keep]
    boats = await db.boats.find({"class_id": series["class_id"], "year": series["year"]}, {"_id": 0}).to_list(2000)
    boat_map = {b["id"]: b for b in boats}
    cfg = _series_scoring_config(series)
    race_meta = [{"race_number": r.get("race_number"), "date": r.get("date")} for r in races]
    agg = {bid: [] for bid in boat_map}
    entries_by_race = []
    for race in races:
        results = race.get("results", [])
        series_entries = race.get("entries_count") or len(results)
        entries_by_race.append(series_entries)
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
                    "points": result_points(r, series_entries, start_entries,
                                             finishers=finishers, cfg=cfg),
                    "discardable": code not in NON_DISCARDABLE,
                    "position": r.get("position") if code in ("FINISHED", *PENALTY_CODES) else None,
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
    _apply_duty_points(agg, entries_by_race, cfg)
    return agg, boat_map, race_meta, cfg, races


async def compute_series_standings(series, race_numbers=None, discards=None):
    agg, boat_map, race_meta, cfg, races = await _series_scores(series, race_numbers)
    club_name = await _club_name_of_class(series.get("class_id"))
    race_count = len(race_meta)
    # Effective discards never remove every race: at least one always counts.
    # Rule A2.1 also discards the earliest of equal worst scores (stable sort).
    # A mini-series view uses that group's discard count; the full series its
    # own (fixed count or the increasing schedule from the scoring config).
    if discards is not None:
        configured_discards = discards
    else:
        configured_discards = series.get("discards", 0)
    discard_policy = cfg.get("discard_policy", "fixed")
    if discards is None and discard_policy == "increasing":
        configured_discards = _effective_discards(cfg, race_count, configured_discards)
    discards = min(configured_discards, max(0, race_count - 1))
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
    payload = {"race_count": race_count, "races_scored": race_count,
               "discards": discards, "discards_applied": discards,
               "configured_discards": configured_discards,
               "discard_policy": discard_policy,
               "use_a5_3": cfg.get("a5_convention") == "a5_3",
               "use_finishers": cfg.get("a5_convention") == "finishers",
               "engine_version": SCORING_ENGINE_VERSION,
               "scoring_config": cfg,
               "planned_races": series.get("planned_races", 0),
               "schedule": series.get("schedule", []),
               "races": race_meta, "standings": rows}
    if series.get("mini_series"):
        payload["mini_series"] = {
            "enabled": True,
            "groups": _normalize_mini_groups(series, race_meta),
        }
    else:
        payload["mini_series"] = None
    return payload


# ---------------------------------------------------------------------------
# Season locking — immutable historical snapshots
# ---------------------------------------------------------------------------
# Once a season is finalised (locked), its results are served from a saved
# snapshot rather than recomputed, so later changes to the scoring engine,
# TLE rule, handicap system, duty calculation, discard rules, penalties,
# boats or series configuration can never rewrite history. Correcting a
# genuine error is an administrator-only flow: unlock for correction (with
# confirmation + reason), fix the data, then re-lock — which preserves the
# previous version and records exactly what changed.

def _standings_diff(prev: dict, new: dict) -> list:
    """Per-boat rank/net differences between two standings payloads, for the
    amendment record of a re-locked season."""
    def index(p):
        return {r["boat_id"]: r for r in p.get("standings", [])}
    prev_by = index(prev or {})
    new_by = index(new or {})
    changes = []
    for bid in sorted(set(prev_by) | set(new_by)):
        a, b = prev_by.get(bid), new_by.get(bid)
        if not a or not b:
            changes.append({"boat_id": bid,
                            "rank_before": (a or {}).get("rank"), "rank_after": (b or {}).get("rank"),
                            "net_before": (a or {}).get("net"), "net_after": (b or {}).get("net"),
                            "note": "boat added/removed by amendment"})
        elif a.get("rank") != b.get("rank") or a.get("net") != b.get("net"):
            changes.append({"boat_id": bid, "rank_before": a.get("rank"), "rank_after": b.get("rank"),
                            "net_before": a.get("net"), "net_after": b.get("net")})
    return changes


async def _build_snapshot_doc(series: dict, user: dict, version: int,
                              reason: str = "", prev_payload: Optional[dict] = None) -> dict:
    """Capture EVERYTHING needed to display a historical season without ever
    recomputing it: final standings payload, per-race raw results with their
    computed points, duty/TLE/penalty/redress decisions, discards, tie-breaks,
    the ratings used, the scoring-rule configuration and who locked it."""
    agg, boat_map, race_meta, cfg, races = await _series_scores(series)
    payload = await compute_series_standings(series)
    # Freeze each mini-series view too, so a locked season's mini standings
    # are equally immutable.
    if series.get("mini_series"):
        all_races = await db.races.find({"series_id": series["id"], "status": "published"},
                                        {"_id": 0, "race_number": 1}).to_list(1000)
        groups = _normalize_mini_groups(series, all_races)
        mini_payloads = {}
        for gi, group in enumerate(groups, start=1):
            try:
                mini_payloads[str(gi)] = await compute_series_standings(
                    series, race_numbers=group["race_numbers"], discards=group["discards"])
            except Exception:
                continue
        if mini_payloads:
            payload["mini_payloads"] = mini_payloads
    races_detail = []
    for i, race in enumerate(races):
        present = {r["boat_id"]: r for r in race.get("results", [])}
        entries = []
        for bid in boat_map:
            e = agg[bid][i]
            raw = present.get(bid) or {}
            dpi = {k: raw.get(k) for k in ("dpi_reason", "dpi_decision_maker", "dpi_date", "dpi_notes")
                   if raw.get(k)}
            rdg = {k: raw.get(k) for k in ("rdg_reason", "rdg_decision_maker", "rdg_date", "rdg_notes")
                   if raw.get(k)}
            entries.append({
                "boat_id": bid, "boat_name": boat_map[bid].get("name"),
                "sail_no": boat_map[bid].get("sail_no"),
                "code": e["code"], "position": raw.get("position"),
                "finish_time": raw.get("finish_time"),
                "penalty_points": raw.get("penalty_points"),
                "points": e["points"], "discardable": e["discardable"],
                "dpi": dpi or None, "rdg": rdg or None,
            })
        races_detail.append({
            "race_number": race.get("race_number"), "date": race.get("date"),
            "status": race.get("status"), "entries_count": race.get("entries_count"),
            "start_time": race.get("start_time"), "actual_start": race.get("actual_start"),
            "results": entries,
        })
    amendment = None
    if prev_payload is not None:
        amendment = {"reason": reason or "", "changes": _standings_diff(prev_payload, payload)}
    return {
        "id": new_id(), "series_id": series["id"], "series_name": series.get("name"),
        "class_id": series.get("class_id"), "year": series.get("year"),
        "version": version, "status": LOCK_LOCKED,
        "locked_at": now_iso(), "locked_by": user.get("username"),
        "locked_by_user_id": user.get("user_id"),
        "engine_version": SCORING_ENGINE_VERSION,
        "scoring_config": cfg,
        "nor_si_settings": {
            "schedule": series.get("schedule", []),
            "planned_races": series.get("planned_races", 0),
            "scoring_mode": series.get("scoring_mode"),
            "included_in_overall": series.get("included_in_overall", True),
            "order": series.get("order", 0),
            "use_a5_3": bool(series.get("use_a5_3")),
            "use_finishers": bool(series.get("use_finishers")),
        },
        "payload": payload, "races": races_detail,
        # Frozen boat identity + ratings: the historical result references
        # these copies, never the live boat records.
        "boats": {bid: {"name": b.get("name"), "sail_no": b.get("sail_no"),
                         "helm": b.get("helm"), "home_club": b.get("home_club"),
                         "tcc": b.get("tcc"), "py": b.get("py"),
                         "boat_type": b.get("boat_type")}
                   for bid, b in boat_map.items()},
        "ratings": {bid: {"tcc": b.get("tcc"), "py": b.get("py")} for bid, b in boat_map.items()},
        # Scoring engine + rules versions that produced this result.
        "scoring_engine_version": SCORING_ENGINE_VERSION,
        "scoring_rules_version": cfg.get("rrs_edition", "RRS 2025-2028"),
        "amendment": amendment,
    }


async def _standings_for_series(series: dict, mini: Optional[int] = None):
    """Standings for a series: the frozen snapshot when the season is FINAL
    (locked) or ARCHIVED — so history is never recomputed — otherwise the live
    calculation."""
    if series.get("lock_status") in NOT_EDITABLE:
        snaps = await db.season_snapshots.find(
            {"series_id": series["id"], "status": {"$in": [LOCK_LOCKED, LOCK_ARCHIVED]}}, {"_id": 0})\
            .sort("version", -1).to_list(1)
        snap = snaps[0] if snaps else None
        if snap and snap.get("payload"):
            payload = dict(snap["payload"])
            if mini is not None:
                mp = payload.get("mini_payloads") or {}
                if str(mini) not in mp:
                    raise HTTPException(status_code=404, detail="Mini series not found")
                return dict(mp[str(mini)])
            payload.update({
                "locked": True, "snapshot_version": snap.get("version"),
                "locked_at": snap.get("locked_at"), "locked_by": snap.get("locked_by"),
                "engine_version": snap.get("engine_version", payload.get("engine_version")),
                "scoring_engine_version": snap.get("scoring_engine_version", SCORING_ENGINE_VERSION),
                "scoring_rules_version": snap.get("scoring_rules_version"),
            })
            if series.get("lock_status") == LOCK_ARCHIVED:
                payload["archived"] = True
            return payload
    return None


async def _ensure_series_not_locked(series_id: Optional[str],
                                    detail: str = "Season results are locked — they are final. Use the administrator correction process to amend them."):
    """409 when a series' season is FINAL (locked) or ARCHIVED. Every normal
    (non-admin-amendment) mutation of a race, result or series config goes
    through this guard."""
    if not series_id:
        return
    series = await db.series.find_one({"id": series_id}, {"_id": 0, "lock_status": 1})
    if series and series.get("lock_status") in NOT_EDITABLE:
        raise HTTPException(status_code=409, detail=detail)


@api_router.post("/series/{series_id}/lock")
async def lock_series(series_id: str, data: LockSeriesInput, request: Request,
                      user: dict = Depends(require_admin)):
    """Finalise a season: compute the results once, store the immutable
    snapshot, and mark the series locked. Requires explicit confirmation and
    a reason (both audited). A re-lock after a correction creates a NEW
    version, preserving the previous one and recording what changed."""
    series = await _series_of_club(series_id, user)
    if not data.confirm:
        raise HTTPException(status_code=400, detail="Confirmation is required to lock this season")
    if not (data.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required when locking a season")
    if series.get("lock_status") == LOCK_LOCKED:
        raise HTTPException(status_code=400, detail="This season is already locked")
    if series.get("lock_status") == LOCK_ARCHIVED:
        raise HTTPException(status_code=400,
                            detail="This season is archived — open it for correction (unlock) before locking again.")
    expected = _expected_version(data)
    snaps = await db.season_snapshots.find({"series_id": series_id}, {"_id": 0})\
        .sort("version", -1).to_list(1)
    prev = snaps[0] if snaps else None
    version = int((prev or {}).get("version", 0)) + 1
    doc = await _build_snapshot_doc(series, user, version, data.reason,
                                    (prev or {}).get("payload"))
    await db.season_snapshots.update_many({"series_id": series_id, "status": {"$in": [LOCK_LOCKED, LOCK_ARCHIVED]}},
                                          {"$set": {"status": "superseded"}})
    try:
        await db.season_snapshots.insert_one(doc)
    except DuplicateKeyError:
        # Another administrator locked (or is locking) this season at the same
        # version — the database's unique (series_id, version) index refuses
        # the duplicate snapshot rather than corrupting history.
        raise HTTPException(status_code=409,
                            detail="This season was locked by another user at the same time. Reload and try again.")
    result = await db.series.update_one(
        _version_filter(series_id, expected),
        {"$set": {
            "lock_status": LOCK_LOCKED, "lock_version": version,
            "locked_at": doc["locked_at"], "locked_by": user.get("username"),
            "unlocked_at": "", "unlocked_by": "", "unlock_reason": "",
        }, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    club_id = await _class_club_id(series.get("class_id"))
    action = "SERIES_LOCKED" if version == 1 else "SEASON_AMENDED"
    description = (f"Locked season for series {series.get('name')} (version {version})"
                   if version == 1 else
                   f"Amended locked season for series {series.get('name')} — new version {version} "
                   f"({len(doc.get('amendment', {}).get('changes', []))} standings changes)")
    await _log_audit(request=request, user=user, action=action,
                     description=f"{description}. Reason: {data.reason}",
                     resource_type="series", resource_id=series_id, club_id=club_id)
    return {"ok": True, "version": version, "amendment": doc.get("amendment"),
            "locked_at": doc["locked_at"]}


@api_router.post("/series/{series_id}/unlock")
async def unlock_series(series_id: str, data: LockSeriesInput, request: Request,
                        user: dict = Depends(require_admin)):
    """Open a locked season for correction (administrator-only, confirmed +
    reasoned). The last locked snapshot is preserved (marked superseded) so
    nothing is ever silently overwritten; re-locking creates a new version."""
    series = await _series_of_club(series_id, user)
    if not data.confirm:
        raise HTTPException(status_code=400, detail="Confirmation is required to unlock this season")
    if not (data.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required when unlocking a season")
    if series.get("lock_status") not in (LOCK_LOCKED, LOCK_ARCHIVED):
        raise HTTPException(status_code=400, detail="This season is not locked")
    expected = _expected_version(data)
    result = await db.series.update_one(_version_filter(series_id, expected), {"$set": {
        "lock_status": LOCK_OPEN, "unlocked_at": now_iso(),
        "unlocked_by": user.get("username"), "unlock_reason": data.reason,
    }, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    await db.season_snapshots.update_many(
        {"series_id": series_id, "status": {"$in": [LOCK_LOCKED, LOCK_ARCHIVED]}},
        {"$set": {"status": "superseded"}})
    club_id = await _class_club_id(series.get("class_id"))
    await _log_audit(request=request, user=user, action="SEASON_UNLOCKED",
                     description=f"Season opened for correction: {series.get('name')}. Reason: {data.reason}",
                     resource_type="series", resource_id=series_id, club_id=club_id)
    return {"ok": True}


@api_router.post("/series/{series_id}/archive")
async def archive_series(series_id: str, data: LockSeriesInput, request: Request,
                         user: dict = Depends(require_admin)):
    """Move a FINAL (locked) season to the terminal ARCHIVED state. ARCHIVED
    seasons are served from their frozen snapshot forever; the only way back
    is the audited administrator unlock-for-correction flow."""
    series = await _series_of_club(series_id, user)
    if not data.confirm:
        raise HTTPException(status_code=400, detail="Confirmation is required to archive this season")
    if not (data.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required when archiving a season")
    if series.get("lock_status") != LOCK_LOCKED:
        raise HTTPException(status_code=400,
                            detail="Only a locked (FINAL) season can be archived")
    expected = _expected_version(data)
    result = await db.series.update_one(_version_filter(series_id, expected), {"$set": {
        "lock_status": LOCK_ARCHIVED, "archived_at": now_iso(),
        "archived_by": user.get("username"), "archive_reason": data.reason,
    }, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    await db.season_snapshots.update_many(
        {"series_id": series_id, "status": LOCK_LOCKED},
        {"$set": {"status": LOCK_ARCHIVED}})
    club_id = await _class_club_id(series.get("class_id"))
    await _log_audit(request=request, user=user, action="SEASON_ARCHIVED",
                     description=f"Archived season: {series.get('name')}. Reason: {data.reason}",
                     resource_type="series", resource_id=series_id, club_id=club_id)
    return {"ok": True, "archived_at": now_iso()}


@api_router.get("/series/{series_id}/snapshots")
async def series_snapshots(series_id: str, request: Request,
                           user: dict = Depends(require_admin)):
    """Version history of a season: every locked snapshot and its amendment
    record, newest first (payload kept — the UI shows the standings via the
    regular standings endpoint, which serves the locked snapshot)."""
    series = await _series_of_club(series_id, user)
    snaps = await db.season_snapshots.find({"series_id": series_id}, {"_id": 0})\
        .sort("version", -1).to_list(100)
    for s in snaps:
        s.pop("payload", None)
        s.pop("races", None)
        s.pop("ratings", None)
    return snaps


@api_router.get("/standings/series/{series_id}")
async def series_standings(series_id: str, request: Request, club_id: Optional[str] = None,
                           mini: Optional[int] = None):
    series = await db.series.find_one({"id": series_id}, {"_id": 0})
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    club = await _resolve_club_id(request, club_id)
    if club and (await _class_club_id(series.get("class_id"))) != club:
        raise HTTPException(status_code=404, detail="Series not found")
    if mini is None:
        frozen = await _standings_for_series(series)
        if frozen is not None:
            return frozen
        return await compute_series_standings(series)
    # Mini-series view: standings over one of the series' named mini groups.
    if not series.get("mini_series"):
        raise HTTPException(status_code=400, detail="This series is not split into mini series")
    frozen = await _standings_for_series(series, mini=mini)
    if frozen is not None:
        return frozen
    all_races = await db.races.find({"series_id": series_id, "status": "published"},
                                    {"_id": 0, "race_number": 1}).to_list(1000)
    groups = _normalize_mini_groups(series, all_races)
    if mini < 1 or mini > len(groups):
        raise HTTPException(status_code=404, detail="Mini series not found")
    group = groups[mini - 1]
    result = await compute_series_standings(series, race_numbers=group["race_numbers"],
                                            discards=group["discards"])
    result["mini_index"] = mini
    result["mini_name"] = group["name"]
    result["mini_series"] = {"enabled": True, "groups": groups}
    return result


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
        frozen = await _standings_for_series(series)
        result = frozen if frozen is not None else await compute_series_standings(series)
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
async def seed(user: dict = Depends(require_webmaster)):
    """Seed sample data — a global, data-creating operation, so webmaster-only."""
    logger.info("SEED requested by=%s", user.get("username"))
    await _log_audit(request=None, user=user, action="SEED",
                     description="Sample data seed requested")
    return await run_seed()


async def ensure_default_club():
    """Multi-club migration: create a first club (from env PINs) if none exists,
    and attach any classes that predate clubs to it."""
    clubs = await db.clubs.find({}, {"_id": 0}).to_list(10)
    if clubs:
        default = clubs[0]
    else:
        # New clubs carry no PINs — logins are individual user accounts.
        default = {
            "id": new_id(),
            "name": os.environ.get("CLUB_NAME", "Sailing Club"),
            "slug": slugify(os.environ.get("CLUB_NAME", "Sailing Club")),
            "color": "#0A369D",
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

class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Defence-in-depth response headers for every API response.

    The API only ever returns JSON, so the strictest CSP is safe here; the
    SPA itself is served by the reverse proxy with a document CSP that is
    compatible with the React app (see deploy/). HSTS is only advertised when
    serving HTTPS (production).
    """

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        if APP_ENV == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


class _CSRFOriginMiddleware(BaseHTTPMiddleware):
    """Defence in depth against cross-site request forgery for state-changing
    requests. The session cookie is SameSite=Lax, so browsers already refuse
    to attach it to cross-site requests; this additionally rejects any unsafe
    request that carries an Origin header from outside the allowed origins.
    Browsers always attach Origin to cross-site POSTs, so this is robust
    without breaking non-browser clients (curl, tests, scripts), which send
    no Origin."""

    async def dispatch(self, request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("origin")
            if origin:
                allowed = {o.rstrip("/") for o in _cors_origins}
                same_origin = f"{request.url.scheme}://{request.url.netloc}".rstrip("/")
                if origin.rstrip("/") not in allowed and origin.rstrip("/") != same_origin:
                    return JSONResponse({"detail": "Cross-origin request rejected"},
                                        status_code=403)
        return await call_next(request)


# CORS: the origin list is entirely environment-configured. Production refuses
# to start with '*' (see _production_config_errors), and the dev default is
# the local dev frontend only.
_cors_origins = [o.strip() for o in os.environ.get('CORS_ORIGINS', 'http://localhost:3000').split(',') if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(_SecurityHeadersMiddleware)
app.add_middleware(_CSRFOriginMiddleware)


async def _backfill_versions():
    """Give every pre-existing race/series/boat/class/club/snapshot the
    optimistic-concurrency counter (version=1) so the first concurrent write
    after this deploy is already guarded. Idempotent and cheap."""
    for coll in (db.races, db.series, db.boats, db.classes, db.clubs,
                 db.season_snapshots, db.users):
        try:
            await coll.update_many({"version": {"$exists": False}},
                                   {"$set": {"version": 1}})
        except Exception as exc:
            logger.warning("VERSION BACKFILL FAILED (%s): %s", coll.name, exc)


async def _ensure_db_constraints():
    """Database-level integrity constraints (second line of defence):
    - unique `id` on every entity collection (guarantees a guessed id can
      only ever hit at most one document of that collection);
    - unique club slug;
    - unique (series, race_number) so a series can never gain a duplicate
      race; a race's series ownership is enforced by the app layer.
    - unique (club_id, username) per club user.
    All idempotent (create_index is a no-op if the index already exists)."""
    plans = {
        db.races: [([("id", 1)], {"unique": True}),
                   ([("series_id", 1), ("race_number", 1)], {"unique": True})],
        db.series: [([("id", 1)], {"unique": True})],
        db.boats: [([("id", 1)], {"unique": True})],
        db.classes: [([("id", 1)], {"unique": True})],
        db.clubs: [([("id", 1)], {"unique": True}),
                   ([("slug", 1)], {"unique": True})],
        db.season_snapshots: [([("id", 1)], {"unique": True}),
                              ([("series_id", 1), ("version", 1)], {"unique": True})],
        db.users: [([("id", 1)], {"unique": True}),
                   ([("club_id", 1), ("username", 1)],
                    {"unique": True, "partialFilterExpression": {"club_id": {"$exists": True}}})],
        db.audit_logs: [([("id", 1)], {"unique": True})],
    }
    for coll, indexes in plans.items():
        for keys, kwargs in indexes:
            try:
                await coll.create_index(keys, **kwargs)
            except Exception as exc:
                logger.warning("INDEX CREATION FAILED (%s %s): %s",
                               coll.name, keys, exc)


@app.on_event("startup")
async def startup():
    await ensure_default_club()
    await _migrate_legacy_club_pins()
    await ensure_webmaster_user()
    await _ensure_all_user_token_versions()
    await run_seed()
    # Integrity layer: backfill the optimistic-concurrency counter on legacy
    # documents, then enforce unique-id / ownership constraints at the
    # database level so the DB is a second line of defence behind the API.
    try:
        await _backfill_versions()
        await _ensure_db_constraints()
    except Exception as exc:
        logger.warning("DB CONSTRAINT SETUP FAILED: %s", exc)
    # Indexes for the audit log (idempotent; speeds up club-scoped,
    # newest-first reads and the webmaster filters).
    try:
        await db.audit_logs.create_index([("timestamp", -1)])
        await db.audit_logs.create_index([("club_id", 1), ("timestamp", -1)])
        await db.audit_logs.create_index([("username", 1), ("timestamp", -1)])
    except Exception as exc:
        logger.warning("AUDIT INDEX CREATION FAILED: %s", exc)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
