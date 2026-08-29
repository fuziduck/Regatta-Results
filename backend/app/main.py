from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form
from dotenv import load_dotenv
from fastapi.responses import JSONResponse, Response, HTMLResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
import os
import io
import json
import logging
import asyncio
import html as html_lib
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
import pyotp
import ipaddress
from cryptography.fernet import Fernet
from datetime import datetime, timezone, timedelta

from app.racing.export import normalize_series_export, result_export_lines

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
# Two-step webmaster login: after the passcode verifies, a short-lived
# pending cookie carries the in-progress login until the second factor
# (TOTP code or emailed one-time code) completes. It is never a usable
# session by itself, expires in minutes, and is cleared on success/logout.
PENDING2FA_COOKIE = "scr_pending2fa"
PENDING2FA_MINUTES = 5
# Email OTP (fallback second factor): 6-digit code, single-use, 10-minute
# expiry, SHA-256 hashed at rest, throttled per address and per IP so an
# attacker cannot flood a victim's inbox or brute-force the code.
EMAIL_OTP_MINUTES = 10
EMAIL_OTP_LIMIT = int(os.environ.get("EMAIL_OTP_LIMIT", "5"))
EMAIL_OTP_WINDOW_SECONDS = 600
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
PUBLIC_APP_BASE_URL = os.environ.get("PUBLIC_APP_BASE_URL", "")
PUBLIC_API_BASE_URL = os.environ.get("PUBLIC_API_BASE_URL", "")
RESET_TOKEN_MINUTES = int(os.environ.get("RESET_TOKEN_MINUTES", "30"))
RESET_EMAIL_LIMIT = int(os.environ.get("RESET_EMAIL_LIMIT", "5"))
RESET_EMAIL_WINDOW_SECONDS = 600
SUBSCRIPTION_MAX_EMAIL_ROWS = 100
SUBSCRIPTION_VERIFY_MINUTES = int(os.environ.get("SUBSCRIPTION_VERIFY_MINUTES", "60"))
SUBSCRIPTION_RATE_LIMIT = int(os.environ.get("SUBSCRIPTION_RATE_LIMIT", "5"))
SUBSCRIPTION_RATE_WINDOW_SECONDS = 600


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

# In-memory holder for the TOTP secret between /auth/2fa/setup and
# /auth/2fa/enable (never persisted; cleared on enable or server restart).
_pending_setup_secrets = {}


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


def _pending_2fa_cookie_kwargs() -> dict:
    """Attributes for the short-lived pending-2FA cookie (same host/security
    attributes as the session cookie, but a far shorter lifetime)."""
    return {
        "key": PENDING2FA_COOKIE,
        "httponly": True,
        "secure": APP_ENV == "production",
        "samesite": "lax",
        "max_age": PENDING2FA_MINUTES * 60,
        "path": "/",
    }


def create_pending_2fa_token(user_id: str) -> str:
    """Short-lived JWT proving a webmaster login has passed step one (the
    passcode) and is awaiting a second factor. Never usable as a session:
    type=pending_2fa, expires in PENDING2FA_MINUTES, and the only endpoint
    that accepts it is the login-2fa verification."""
    now = datetime.now(timezone.utc)
    return jwt.encode({
        "type": "pending_2fa",
        "sub": user_id,
        "user_id": user_id,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": now,
        "exp": now + timedelta(minutes=PENDING2FA_MINUTES),
        "jti": secrets.token_urlsafe(16),
    }, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _pending_2fa_user_id(request: Request) -> Optional[str]:
    """The user_id carried by a valid, unexpired pending-2FA cookie, or None."""
    token = request.cookies.get(PENDING2FA_COOKIE)
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
    if payload.get("type") != "pending_2fa":
        return None
    return payload.get("user_id") or payload.get("sub")


def _pending_2fa_cookie_clear_kwargs() -> dict:
    return {"key": PENDING2FA_COOKIE, "path": "/"}


def _user_email(user: dict) -> str:
    """The address emailed one-time codes and reset links go to: the explicit
    backup `email` field when set, otherwise the username when it is an email
    (club staff usernames are their login email). The webmaster's username
    is "webmaster" (not an email), so it always needs an explicit backup
    email."""
    email = (user.get("email") or "").strip().lower()
    if not email and "@" in (user.get("username") or ""):
        email = (user.get("username") or "").strip().lower()
    return email


def _totp_secret(user: dict) -> Optional[str]:
    """Decrypted TOTP secret for a user, or None when 2FA is not enrolled or
    the secret cannot be decrypted (e.g. JWT_SECRET changed)."""
    if not user.get("totp_enabled"):
        return None
    enc = user.get("totp_secret_enc")
    if not enc:
        return None
    return _decrypt_secret(enc)


def _verify_totp(user: dict, code: str) -> bool:
    """Verify a 6-digit TOTP code against the user's enrolled secret with a
    ±1-step window (allows for clock drift / a code generated just before the
    step boundary)."""
    secret = _totp_secret(user)
    if not secret:
        return False
    try:
        return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)
    except Exception:
        return False


def _email_otp_limited(email: str, ip: str) -> bool:
    """True when too many OTP emails were recently sent to this address or
    from this IP (bounds inbox-flooding and brute-force windows)."""
    now = time.time()
    limited = False
    for key in (f"otp-email:{email}", f"otp-ip:{ip}"):
        dq = _login_attempts[key]
        while dq and dq[0] < now - EMAIL_OTP_WINDOW_SECONDS:
            dq.popleft()
        if len(dq) >= EMAIL_OTP_LIMIT:
            limited = True
        dq.append(now)
    return limited


async def _send_email_otp(user: dict, ip: str) -> Optional[str]:
    """Email a 6-digit one-time code to the user's fallback address. Stores a
    SHA-256 hash + expiry on the user (single use, EMAIL_OTP_MINUTES). Returns
    the plaintext code ONLY in development when SMTP is not configured, so the
    flow is exercisable end-to-end without a mail server (mirrors the
    password-reset dev convenience). Returns None when sending fails and no
    dev fallback applies."""
    email = _user_email(user)
    if not email:
        return None
    code = f"{secrets.randbelow(1000000):06d}"
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "email_otp_hash": hashlib.sha256(code.encode("utf-8")).hexdigest(),
        "email_otp_expires": (datetime.now(timezone.utc)
                              + timedelta(minutes=EMAIL_OTP_MINUTES)).isoformat(),
    }})
    cfg = await _get_email_settings()
    sent = False
    if cfg.get("smtp_host"):
        msg = EmailMessage()
        msg["Subject"] = "SailScore — webmaster sign-in code"
        msg["From"] = cfg.get("mail_from") or cfg.get("smtp_user") or "sailscore@localhost"
        msg["To"] = email
        msg.set_content(
            f"Your SailScore webmaster sign-in code is: {code}\n\n"
            f"It expires in {EMAIL_OTP_MINUTES} minutes and can be used once. "
            "If you did not try to sign in, ignore this email."
        )
        try:
            with smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"], timeout=15) as s:
                s.starttls()
                if cfg.get("smtp_user"):
                    s.login(cfg["smtp_user"], cfg.get("smtp_password") or "")
                s.send_message(msg)
            sent = True
        except Exception as exc:
            logger.error("2FA EMAIL SEND FAILED to=%s error=%s", email, exc)
    if not sent and APP_ENV != "production":
        return code  # dev convenience: no SMTP — hand the code back
    return None


async def _verify_email_otp(user: dict, code: str) -> bool:
    """Verify a single-use email OTP and consume it (hashed comparison, so
    the stored code is never reversible). A wrong code leaves it in place so
    a mistyped entry can be retried until the expiry."""
    stored = user.get("email_otp_hash") or ""
    if not stored:
        return False
    try:
        expires = datetime.fromisoformat(user.get("email_otp_expires", ""))
    except (TypeError, ValueError):
        expires = datetime.min.replace(tzinfo=timezone.utc)
    candidate = hashlib.sha256(code.strip().encode("utf-8")).hexdigest()
    if secrets.compare_digest(candidate, stored) and expires > datetime.now(timezone.utc):
        await db.users.update_one({"id": user["id"]},
                                  {"$unset": {"email_otp_hash": "", "email_otp_expires": ""}})
        return True
    return False


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
            "user_id": user["id"], "username": user.get("username"),
            "name": user.get("name")}


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


async def require_user(request: Request) -> dict:
    """Any signed-in user (webmaster, admin or officer). Used for account-level
    self-service endpoints like 2FA management."""
    user = await get_current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
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


# ---------------------------------------------------------------------------
# Fleet identity: one boat, many records
# ---------------------------------------------------------------------------
# The same physical boat can race at several clubs, or in several classes at
# the same club. Each club/class keeps its OWN boat record — its helm, PY/TCC
# rating, home-club label and season are club/class-specific — and all the
# records that represent the same boat share a `fleet_id`. The identity is
# derived from the sail number + name so boats link automatically across
# clubs, but a record can always be kept separate (two genuinely different
# boats with identical details) or linked explicitly.

def _clean_fleet_part(s):
    """Lowercase alphanumerics only, so 'GBR 4502', 'gbr-4502' and 'GBR4502'
    all normalise to the same key part."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def fleet_key(name, sail_no):
    """The canonical identity key: sail number first, then boat name."""
    return f"{_clean_fleet_part(sail_no)}|{_clean_fleet_part(name)}"


async def _fleet_candidates(key: str, exclude_boat_id: Optional[str] = None):
    """Every boat record in the database sharing a fleet identity key."""
    q = {"fleet_key": key}
    if exclude_boat_id:
        q["id"] = {"$ne": exclude_boat_id}
    return await db.boats.find(q, {"_id": 0}).to_list(2000)


async def _fleet_candidate_summary(boats):
    """Human-readable summaries of candidate boats for the admin to choose
    between (link, or keep as a separate identity)."""
    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(1000)}
    clubs = {c["id"]: c for c in await db.clubs.find({}, {"_id": 0}).to_list(100)}
    out = []
    for b in boats:
        cls = classes.get(b.get("class_id"), {})
        club = clubs.get(cls.get("club_id"), {})
        out.append({
            "boat_id": b["id"],
            "fleet_id": b.get("fleet_id") or b["id"],
            "name": b.get("name"), "sail_no": b.get("sail_no"),
            "class_name": cls.get("name", "—"),
            "club_name": club.get("name", "—"),
            "year": b.get("year"),
        })
    return out


async def _resolve_fleet_identity(data, editing=None):
    """Decide the fleet identity for a boat being created or edited.

    Returns (fleet_id, fleet_key, ambiguous_candidates). Priority:
    1. an explicit `fleet_id` links to that identity;
    2. `separate_fleet` forces a brand-new identity (identical-details case);
    3. an already-linked boat whose name/sail didn't change keeps its identity;
    4. otherwise auto-link to the first boat with the same key in a different
       class+year (the shared-registry case);
    5. matches only within the same class+year are ambiguous — the caller
       receives the candidates to ask the admin, instead of silently merging
       what may be a duplicate entry.
    """
    key = fleet_key(data.name, data.sail_no)
    if data.fleet_id:
        target = await db.boats.find_one({"id": data.fleet_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=400,
                                detail="The boat to link this fleet identity to no longer exists.")
        return target.get("fleet_id") or target["id"], key, None
    if data.separate_fleet:
        return new_id(), key, None
    if editing:
        if editing.get("fleet_id") and key == editing.get("fleet_key"):
            return editing["fleet_id"], key, None
        same = (editing.get("class_id"), editing.get("year"))
    else:
        same = (data.class_id, data.year)
    candidates = await _fleet_candidates(key, exclude_boat_id=editing["id"] if editing else None)
    linkable = [c for c in candidates if (c.get("class_id"), c.get("year")) != same]
    if linkable:
        return linkable[0].get("fleet_id") or linkable[0]["id"], key, None
    if candidates:
        return None, key, candidates
    return new_id(), key, None


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


class Login2faInput(BaseModel):
    """Second factor for a two-step webmaster login. `method` is either
    "totp" (authenticator app) or "email" (emailed one-time code); the code
    is always a 6-digit string."""
    code: str
    method: str = "totp"


class TfaEnableInput(BaseModel):
    """Confirm 2FA enrollment: verify one TOTP code against the secret from
    setup, and (optionally) set the fallback email for emailed codes."""
    code: str
    email: Optional[str] = None


class TfaDisableInput(BaseModel):
    """Turn 2FA off. Requires the current passcode AND a valid second-factor
    code (TOTP or email), so a stolen session alone cannot disable it."""
    current_passcode: str
    code: str
    method: str = "totp"


class TfaEmailInput(BaseModel):
    """Set (or clear) the fallback email used for emailed sign-in codes.
    Requires the current passcode so a stolen session cannot redirect the
    recovery path."""
    current_passcode: str
    email: Optional[str] = None


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


class ClubSettingsInput(BaseModel):
    # Whether the race-day notice section (course, special rules, life
    # jackets) is required in the race officer console. When off, the section
    # is hidden entirely and no notice is expected for the club's races.
    race_day_notices: bool = True
    # Whether this club publishes the formal Official Notice Board. This is
    # independent from race-day notices: a club may use one without the other.
    official_notice_board: bool = True
    notice_areas: List[str] = []
    # Custom ONB areas created by the club's Race Admin/Race Officer.
    notice_areas: List[str] = Field(default_factory=list)


class MiniGroupSettingsInput(BaseModel):
    # The race officer may change a mini-series group's discard count on the
    # day without leaving the batch scoring page.
    discards: int = 0


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
    # Shared fleet identity: the same physical boat racing at another club or
    # in another class. When set, this record joins that boat's identity; the
    # server otherwise auto-links by normalized sail number + name (see
    # _resolve_fleet_identity). `separate_fleet` forces a brand-new identity
    # even when the details match an existing boat — two genuinely different
    # boats with identical details must never be merged silently.
    fleet_id: Optional[str] = None
    separate_fleet: bool = False


class MiniSeriesGroup(BaseModel):
    """One mini series inside a long series: which races it contains (by race
    number) and how many discards it applies independently of the main series.

    scoring:
      "additional" (default): each mini race is an individual main-series race
      (scored, discardable and shown separately, as today).
      "combined": the mini races are aggregated into ONE daily result for the
      main series — the group's discards are applied first, then the average
      of the counting races becomes a single score. The individual races stay
      in the database and remain visible in the mini-series detail view.

    Parent/child structure: a mini series is one scoring event (the parent)
    whose child races are ordinary races stamped with mini_group_id (the
    0-based index of this group on the series) and mini_group_label (e.g.
    "R3A", "R3B"). Children are never deleted when combined — they remain for
    audit, correction and the public breakdown.
    """
    name: str = ""
    race_numbers: List[int] = []
    discards: int = 0
    scoring: Literal["additional", "combined"] = "additional"


class MiniSplitInput(BaseModel):
    """Race-day split: turn one planned race into a mini series of `count`
    races for this class, scored either as ONE combined daily result or as
    `count` separate races in the main series (see MiniSeriesGroup.scoring)."""
    race_number: int = Field(..., ge=1, description="The race slot being split (1-based)")
    count: int = Field(..., ge=2, le=20, description="How many races the mini series contains")
    name: str = ""
    scoring: Literal["additional", "combined"] = "combined"
    # Optimistic concurrency: version the series doc this split is based on.
    expected_version: Optional[int] = None


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


class RaceAbandonInput(BaseModel):
    """Mark a race abandoned (or restore it). An abandoned race is excluded
    from series scoring entirely: it does not count as a race sailed, so the
    series has fewer races scored and the discard schedule (especially
    increasing discards) may reduce accordingly."""
    abandoned: bool = True


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
    {"code": "OOD", "label": "OOD — Officer of the Day duty (average of own scores across the series, incl. DNC)"},
]
# Rule A2.1: only DNE may not be excluded from a series score.
NON_DISCARDABLE = {"DNE"}
FINISH_CODES = {"FINISHED"}
# Codes that mean the boat did not finish (or never started): scoring them on a
# boat that had finished triggers RRS A6.1 (boats behind move up one place).
POST_FINISH_RETIRE_CODES = {"DNC", "DNS", "OCS", "UFD", "BFD", "DNF", "RET", "DSQ", "DNE", "NSC", "OOD", "TLE"}
# Duty codes: the boat did not race — it did its club duty (Officer of the
# Day, rescue boat, crew) — and scores the average of its own points across
# every race in the series before discards, DNC included (see
# _apply_duty_points).
DUTY_CODES = {"OOD"}
# Synthetic code attached to a combined mini-series daily result in standings
# (see _fold_combined_mini_groups). It is display-only — it never appears on
# a race result and is not part of RRS_CODES.
MINI_COMBINED_CODE = "MINI"
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
SCORING_ENGINE_VERSION = "2.4.0"
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
        # Two-step login when 2FA is enrolled: the passcode only wins the
        # right to attempt the second factor. A short-lived pending cookie is
        # set (never a usable session) and the client is told to continue at
        # /auth/login/2fa.
        if u.get("totp_enabled"):
            await _log_audit(request, {"user_id": u["id"], "username": u.get("username"),
                                      "role": "webmaster", "club_id": None},
                             "AUTH_2FA_REQUIRED",
                             description="Webmaster passcode verified — second factor required")
            logger.info("LOGIN 2FA REQUIRED user=%s role=webmaster ip=%s", u.get("username"), ip)
            response = JSONResponse({"requires_2fa": True, "methods": ["totp", "email"]})
            response.set_cookie(value=create_pending_2fa_token(u["id"]),
                                **_pending_2fa_cookie_kwargs())
            return response
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
    # Two-step login when the account has 2FA enrolled: the passcode only wins
    # the right to attempt the second factor (same flow as the webmaster).
    if u.get("totp_enabled"):
        await _log_audit(request, {"user_id": u["id"], "username": u.get("username"),
                                  "role": u.get("role"), "club_id": club["id"]},
                         "AUTH_2FA_REQUIRED",
                         description=f"Passcode verified for {u.get('username')} — second factor required")
        logger.info("LOGIN 2FA REQUIRED user=%s role=%s club=%s ip=%s",
                    u.get("username"), u.get("role"), club["id"], ip)
        email = _user_email(u)
        response = JSONResponse({"requires_2fa": True,
                                 "methods": ["totp", "email"] if email else ["totp"]})
        response.set_cookie(value=create_pending_2fa_token(u["id"]),
                            **_pending_2fa_cookie_kwargs())
        return response
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
    response.delete_cookie(PENDING2FA_COOKIE, path="/")
    return response


@api_router.post("/auth/login/2fa")
async def login_2fa(data: Login2faInput, request: Request):
    """Complete a two-step login with the second factor, for any account that
    has 2FA enrolled (webmaster or club staff). Requires the short-lived
    pending cookie from a successful passcode step; verifies a TOTP code or
    an emailed one-time code, then issues the real session. Failures count
    toward the same per-account lockout and per-IP throttle as login, so the
    second factor cannot be brute-forced."""
    ip = _client_ip(request)
    if _login_ip_limited(ip):
        raise HTTPException(status_code=429,
                            detail="Too many attempts — please try again shortly")
    user_id = _pending_2fa_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401,
                            detail="Login session expired or missing — sign in again")
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u or not u.get("totp_enabled"):
        raise HTTPException(status_code=401,
                            detail="Login session expired or missing — sign in again")
    actor = {"user_id": u["id"], "username": u.get("username"),
             "role": u.get("role"), "club_id": u.get("club_id")}
    method = (data.method or "totp").strip().lower()
    ok = False
    if method == "totp":
        ok = _verify_totp(u, data.code)
    elif method == "email":
        ok = await _verify_email_otp(u, data.code)
    if not ok:
        await _record_failed_login(u, ip)
        await _log_audit(request, actor, "AUTH_LOGIN_2FA_FAILED",
                         description=f"Wrong second-factor code ({method}) for {u.get('username')}",
                         success=False)
        logger.warning("LOGIN 2FA FAIL user=%s method=%s ip=%s", u.get("username"), method, ip)
        raise HTTPException(status_code=401, detail="Invalid verification code")
    await db.users.update_one({"id": u["id"]},
                              {"$set": {"failed_attempts": 0, "last_login": now_iso()},
                               "$unset": {"locked_until": "", "lockout_level": "",
                                           "last_failed_login": "",
                                           "email_otp_hash": "", "email_otp_expires": ""}})
    role = u.get("role") or "officer"
    club_id = u.get("club_id")
    club_name = None
    if club_id:
        club = await db.clubs.find_one({"id": club_id}, {"_id": 0})
        club_name = (club or {}).get("name")
    token = create_token(role, club_id, u["id"], u.get("username"), u.get("token_version"))
    await _log_audit(request, actor, "AUTH_LOGIN_SUCCESS",
                     description=f"{u.get('username')} signed in (second factor verified)")
    logger.info("LOGIN OK user=%s role=%s club=%s 2fa=%s ip=%s",
                u.get("username"), role, club_id, method, ip)
    response = JSONResponse({"role": role, "club_id": club_id, "club_name": club_name,
                             "username": u.get("username"), "name": u.get("name")})
    response.set_cookie(value=token, **_session_cookie_kwargs())
    response.delete_cookie(PENDING2FA_COOKIE, path="/")
    return response


@api_router.post("/auth/2fa/send-email-code")
async def send_email_2fa_code(request: Request):
    """Email the fallback one-time code for a two-step login, or to a signed-in
    account (e.g. disabling 2FA with an emailed code). Throttled per address
    and per IP; in development without SMTP the code is returned in the
    response so the flow works end-to-end."""
    ip = _client_ip(request)
    if _login_ip_limited(ip):
        raise HTTPException(status_code=429,
                            detail="Too many attempts — please try again shortly")
    user_id = _pending_2fa_user_id(request)
    if user_id:
        # Mid-login: only a pending passcode step for an account with 2FA on.
        u = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not u or not u.get("totp_enabled"):
            raise HTTPException(status_code=401,
                                detail="Login session expired or missing — sign in again")
        actor = {"user_id": u["id"], "username": u.get("username"),
                 "role": u.get("role"), "club_id": u.get("club_id")}
    else:
        # Signed in: any user may email a code to their own fallback address
        # (e.g. when disabling 2FA with an emailed code).
        user = await get_current_user(request)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        u = await db.users.find_one({"id": user["user_id"]}, {"_id": 0})
        actor = user
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    email = _user_email(u)
    if not email:
        raise HTTPException(status_code=400,
                            detail="No fallback email is set — use the authenticator app code instead")
    if _email_otp_limited(email, ip):
        raise HTTPException(status_code=429,
                            detail="Too many codes sent — please try again shortly")
    dev_code = await _send_email_otp(u, ip)
    await _log_audit(request, actor, "AUTH_2FA_EMAIL_SENT",
                     description=f"Fallback sign-in code emailed to {email}")
    logger.info("2FA EMAIL SENT user=%s ip=%s", u.get("username"), ip)
    body = {"ok": True}
    if dev_code is not None:
        body["dev_code"] = dev_code
    return body


@api_router.get("/auth/2fa/status")
async def tfa_status(request: Request, user: dict = Depends(require_user)):
    """Current 2FA state for the signed-in account: whether it is enabled and
    the masked fallback email (never the full address)."""
    doc = await db.users.find_one({"id": user["user_id"]}, {"_id": 0})
    email = _user_email(doc or {})
    masked = ""
    if email and "@" in email:
        local, _, domain = email.partition("@")
        masked = f"{local[:1]}•••••@{domain}" if local else email
    return {"enabled": bool((doc or {}).get("totp_enabled")),
            "email": masked,
            "has_email": bool(email),
            "methods": ["totp", "email"] if email else ["totp"]}


@api_router.post("/auth/2fa/setup")
async def tfa_setup(request: Request, user: dict = Depends(require_user)):
    """Start enrolling TOTP: returns a fresh secret and its otpauth://
    provisioning URI for the authenticator app. Nothing is persisted until
    /auth/2fa/enable verifies a code against this secret."""
    secret = pyotp.random_base32()
    _pending_setup_secrets[user["user_id"]] = secret
    uri = pyotp.TOTP(secret).provisioning_uri(
        name=user.get("username") or "sailscore", issuer_name="SailScore")
    await _log_audit(request, user, "AUTH_2FA_SETUP",
                     description=f"{user.get('username')} started 2FA enrollment")
    return {"secret": secret, "otpauth_uri": uri}


@api_router.post("/auth/2fa/enable")
async def tfa_enable(data: TfaEnableInput, request: Request,
                     user: dict = Depends(require_user)):
    """Complete enrollment: the code must match the most recent setup secret
    (stored only on this in-memory session holder keyed by user id — a stale
    or guessed code cannot enable 2FA). Also records the fallback email; when
    none is given it defaults to the account's email username."""
    doc = await db.users.find_one({"id": user["user_id"]}, {"_id": 0})
    secret = _pending_setup_secrets.get(user["user_id"])
    if not secret:
        raise HTTPException(status_code=400, detail="Start 2FA setup first")
    if not pyotp.TOTP(secret).verify(data.code.strip(), valid_window=1):
        await _log_audit(request, user, "AUTH_2FA_ENABLE_FAILED",
                         description="2FA enrollment rejected: wrong verification code",
                         success=False)
        raise HTTPException(status_code=400, detail="Verification code is incorrect")
    email = (data.email or "").strip().lower() if data.email else ""
    if not email and "@" in (user.get("username") or ""):
        email = (user.get("username") or "").strip().lower()
    _pending_setup_secrets.pop(user["user_id"], None)
    update = {"totp_enabled": True,
              "totp_secret_enc": _encrypt_secret(secret),
              "totp_enrolled_at": now_iso()}
    if email:
        update["email"] = email
    await db.users.update_one({"id": user["user_id"]}, {"$set": update})
    await _log_audit(request, user, "AUTH_2FA_ENABLED",
                     description=f"Two-factor authentication enabled for {user.get('username')}"
                                 + (f" (fallback {email})" if email else ""))
    logger.info("2FA ENABLED user=%s ip=%s", user.get("username"), _client_ip(request))
    return {"enabled": True}


@api_router.post("/auth/2fa/disable")
async def tfa_disable(data: TfaDisableInput, request: Request,
                      user: dict = Depends(require_user)):
    """Turn 2FA off. Requires the current passcode AND a valid second-factor
    code (TOTP, or an emailed code via method="email"), so a stolen session
    alone cannot disable the protection. Wrong passcode counts toward the
    normal account lockout."""
    doc = await db.users.find_one({"id": user["user_id"]}, {"_id": 0})
    ip = _client_ip(request)
    if _login_ip_limited(ip):
        raise HTTPException(status_code=429,
                            detail="Too many attempts — please try again shortly")
    if not verify_passcode(data.current_passcode.strip(), doc.get("passcode_hash", "")):
        await _record_failed_login(doc, ip)
        await _log_audit(request, user, "AUTH_2FA_DISABLE_FAILED",
                         description="2FA disable rejected: wrong passcode", success=False)
        raise HTTPException(status_code=401, detail="Current passcode is incorrect")
    method = (data.method or "totp").strip().lower()
    if method == "email":
        if not await _verify_email_otp(doc, data.code):
            raise HTTPException(status_code=401, detail="Invalid verification code")
    elif not _verify_totp(doc, data.code):
        raise HTTPException(status_code=401, detail="Invalid verification code")
    # Keep the backup email after disabling 2FA: it is the account's recovery
    # contact (passcode-reset links as well as emailed sign-in codes), so it
    # must survive turning 2FA off. Only the TOTP material and any in-flight
    # emailed OTP are cleared.
    await db.users.update_one({"id": user["user_id"]},
                              {"$unset": {"totp_secret_enc": "", "totp_enabled": "",
                                           "totp_enrolled_at": "",
                                           "email_otp_hash": "", "email_otp_expires": ""}})
    await _log_audit(request, user, "AUTH_2FA_DISABLED",
                     description=f"Two-factor authentication disabled for {user.get('username')}")
    logger.info("2FA DISABLED user=%s ip=%s", user.get("username"), ip)
    return {"enabled": False}


@api_router.post("/auth/2fa/email")
async def tfa_set_email(data: TfaEmailInput, request: Request,
                        user: dict = Depends(require_user)):
    """Set (or clear, with an empty email) the fallback email used for emailed
    sign-in codes. Requires the current passcode so a stolen session cannot
    silently redirect the recovery path."""
    doc = await db.users.find_one({"id": user["user_id"]}, {"_id": 0})
    ip = _client_ip(request)
    if _login_ip_limited(ip):
        raise HTTPException(status_code=429,
                            detail="Too many attempts — please try again shortly")
    if not verify_passcode(data.current_passcode.strip(), doc.get("passcode_hash", "")):
        await _record_failed_login(doc, ip)
        await _log_audit(request, user, "AUTH_2FA_EMAIL_CHANGE_FAILED",
                         description="Fallback email change rejected: wrong passcode",
                         success=False)
        raise HTTPException(status_code=401, detail="Current passcode is incorrect")
    email = (data.email or "").strip().lower() if data.email else ""
    update = {"email": email}
    await db.users.update_one({"id": user["user_id"]}, {"$set": update})
    await _log_audit(request, user, "AUTH_2FA_EMAIL_CHANGED",
                     description=f"Fallback email updated" + (f" to {email}" if email else " (cleared)"))
    logger.info("2FA EMAIL CHANGED user=%s ip=%s", user.get("username"), ip)
    return {"ok": True}


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


class ResultsSubscriptionInput(BaseModel):
    email: EmailStr
    subscription_type: Literal["class", "series", "boat"]
    target_id: str


class SubscriptionTokenInput(BaseModel):
    token: str


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
    if not user:
        # The webmaster account has no club and a fixed username, so the club
        # lookup can never match it — its reset link goes to the backup email
        # stored on the account (the same address used for 2FA fallback codes).
        user = await db.users.find_one({"role": "webmaster", "email": email}, {"_id": 0})
    if not user and not data.club_id:
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
                   "last_failed_login", "locked_until", "lockout_level",
                   "totp_secret_enc", "totp_enabled", "email",
                   "email_otp_hash", "email_otp_expires")
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
            q = {"class_id": c["id"], "status": "published", "abandoned": {"$ne": True}}
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
                ser = None
                if r.get("series_id"):
                    ser = await db.series.find_one({"id": r["series_id"]},
                                                   {"_id": 0, "id": 1, "scoring_mode": 1,
                                                    "name": 1, "planned_races": 1,
                                                    "lock_status": 1})
                    mode = (ser or {}).get("scoring_mode")
                top3 = [{"position": x["position"],
                         "boat": boats.get(x["boat_id"], {}).get("name", "?"),
                         "sail_no": boats.get(x["boat_id"], {}).get("sail_no", "")}
                        for x in finished]
                is_overall = False
                if ser and (ser.get("planned_races") or 0) > 0:
                    # A series is "complete" once every planned race has been
                    # sailed and published. When the most recent race belongs to
                    # a complete series, the front page shows the OVERALL series
                    # result rather than the last race's top three.
                    raced = await db.races.count_documents(
                        {"series_id": ser["id"], "status": "published",
                         "abandoned": {"$ne": True}})
                    is_overall = raced >= ser.get("planned_races", 0)
                if is_overall:
                    full = await db.series.find_one({"id": ser["id"]}, {"_id": 0})
                    payload = await _standings_for_series(full)
                    if payload is None:
                        payload = await compute_series_standings(full)
                    standings = payload.get("standings") or []
                    top3 = [{"position": s.get("rank", i + 1),
                             "boat": s.get("boat_name", "?"),
                             "sail_no": s.get("sail_no", "")}
                            for i, s in enumerate(standings[:3])]
                latest = {
                    "race_number": r.get("race_number"),
                    "date": r.get("date"),
                    "scoring_mode": mode or c.get("scoring_mode") or "one_design",
                    "is_overall": is_overall,
                    "series_name": ser.get("name") if (is_overall and ser) else None,
                    "top3": top3,
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


@api_router.put("/clubs/{club_id}/settings")
async def update_club_settings(club_id: str, data: ClubSettingsInput,
                               user: dict = Depends(require_admin)):
    """Club-level preferences, e.g. whether race-day notices are required.
    Race admins may change their own club's settings; the webmaster may
    change any club's. Read through the public /clubs payload."""
    _ensure_club(user, club_id)
    club = await db.clubs.find_one({"id": club_id}, {"_id": 0})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    await db.clubs.update_one({"id": club_id},
                              {"$set": {
                                  "race_day_notices": data.race_day_notices,
                                  "official_notice_board": data.official_notice_board,
                                  "notice_areas": list(dict.fromkeys([a.strip() for a in data.notice_areas if a.strip()]))[:50],
                              }})
    await _log_audit(request=None, user=user, action="CLUB_SETTINGS_UPDATED",
                     description=(f"Set race_day_notices={data.race_day_notices}, "
                                  f"official_notice_board={data.official_notice_board} "
                                  f"for {club.get('name')}"),
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
    fleet_id, key, ambiguous = await _resolve_fleet_identity(data)
    if ambiguous:
        raise HTTPException(status_code=409, detail={
            "message": ("A boat with this name and sail number already exists in this class "
                        "and year. It may be a duplicate entry, or a different boat that "
                        "happens to share the same details — link them as one boat, or keep "
                        "this one separate."),
            "fleet_candidates": await _fleet_candidate_summary(ambiguous),
        })
    doc = data.model_dump()
    doc.pop("expected_version", None)
    doc.pop("separate_fleet", None)
    doc["id"] = new_id()
    doc["fleet_id"] = fleet_id
    doc["fleet_key"] = key
    doc["created_at"] = now_iso()
    doc["version"] = 1
    await db.boats.insert_one(doc)
    doc.pop("_id", None)
    linked = fleet_id != doc["id"]
    await _log_audit(request=None, user=user, action="BOAT_CREATED",
                     description=f"Created boat {doc.get('name')} ({doc.get('sail_no')})"
                                 + (" — linked to a shared boat identity" if linked else ""),
                     resource_type="boat", resource_id=doc["id"], club_id=cls.get("club_id"))
    return doc


@api_router.put("/boats/{boat_id}")
async def update_boat(boat_id: str, data: BoatInput, user: dict = Depends(require_admin)):
    boat = await _boat_of_club(boat_id, user)
    cls = await _class_of_club(data.class_id, user)
    expected = _expected_version(data)
    fleet_id, key, ambiguous = await _resolve_fleet_identity(data, editing=boat)
    if ambiguous:
        raise HTTPException(status_code=409, detail={
            "message": ("Changing the boat to this name and sail number would match another "
                        "boat in the same class and year. It may be a duplicate, or a "
                        "different boat with identical details — link them as one boat, or "
                        "keep this one separate."),
            "fleet_candidates": await _fleet_candidate_summary(ambiguous),
        })
    update = data.model_dump()
    update.pop("expected_version", None)
    update.pop("separate_fleet", None)
    update["fleet_id"] = fleet_id
    update["fleet_key"] = key
    result = await db.boats.update_one(_version_filter(boat_id, expected),
                                       {"$set": update, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    linked = fleet_id != boat_id
    await _log_audit(request=None, user=user, action="BOAT_UPDATED",
                     description=f"Updated boat {boat.get('name')}"
                                 + (" — linked to a shared boat identity" if linked else ""),
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


@api_router.post("/series/{series_id}/mini-split")
async def split_into_mini_series(series_id: str, data: MiniSplitInput,
                                 user: dict = Depends(require_officer)):
    """Race-day split: turn one planned race into a mini series of `count`
    races for this class.

    The slot race keeps its number (it becomes the first sub-race); the extra
    sub-races take the following numbers, and any later planned races shift
    their numbers (and schedule dates) by count-1 to make room — mirroring how
    the admin's auto-split numbers groups. Only unpublished races are shifted;
    if a later race is already published the split is rejected.

    scoring: "combined" folds the sub-races into ONE main-series daily result;
    "additional" counts each sub-race as its own main-series race.
    """
    series = await _series_of_club(series_id, user)
    await _ensure_series_not_locked(series_id,
                                    detail="Season results are locked — the schedule cannot be changed. Use the administrator correction process to amend the season.")
    cls = await db.classes.find_one({"id": series.get("class_id")}, {"_id": 0})
    base = data.race_number
    count = data.count

    # The split slot must be a real (planned or already-created) race of the series.
    existing_races = await db.races.find({"series_id": series_id}, {"_id": 0}).to_list(1000)
    by_number = {r.get("race_number"): r for r in existing_races}
    max_number = max(list(by_number) + [0])
    horizon = max(series.get("planned_races", 0), len(series.get("schedule") or []), max_number)
    if base > horizon:
        raise HTTPException(status_code=400,
                            detail=f"Race {base} is not a planned race of this series (1–{horizon})")
    base_race = by_number.get(base)
    if base_race and base_race.get("status") == "published":
        raise HTTPException(status_code=400,
                            detail="A published race cannot be split into a mini series")

    # A race may only belong to one mini series.
    groups = series.get("mini_series_groups") or []
    for g in groups:
        nums = g.get("race_numbers") or []
        if base in nums:
            raise HTTPException(status_code=400,
                                detail=f"Race {base} already belongs to a mini series — remove it from “{g.get('name')}” first")

    # No race number shifting — future races keep their original numbers.
    # Sub-races all share the base race number with suffix labels (R3A, R3B, R3C).
    sched = list(series.get("schedule") or [])
    base_date = base_race.get("date") if base_race else None
    if not base_date and sched and base <= len(sched):
        base_date = sched[base - 1]
    if not base_date:
        raise HTTPException(status_code=400,
                            detail="This series has no scheduled date for the race — set the schedule first (admin)")

    # The sub-races: the slot race (created if needed) plus count-1 new races.
    # All sub-races share the same race_number (the base number).
    year = series["year"]
    boats = await _class_active_boats(series.get("class_id"), year)
    new_races = []
    for sub_idx in range(count):
        # All sub-races use the same race_number as the base race
        rn = base
        r = by_number.get(base) if sub_idx == 0 else None
        if r is None:
            results = [{"boat_id": b["id"], "code": "DNC", "finish_time": None,
                        "position": None, "penalty_points": 0} for b in boats]
            doc = {
                "id": new_id(), "date": base_date, "class_id": series["class_id"],
                "series_id": series_id, "year": year, "race_number": rn,
                "start_time": (base_race or {}).get("start_time") or cls.get("default_start_time", "10:30"),
                "start_tz_offset_minutes": None, "actual_start": None, "course": "",
                "special_rules": "", "life_jackets": False, "status": "setup",
                "entries_count": len(results), "results": results,
                "created_at": now_iso(), "version": 1,
            }
            await db.races.insert_one(doc)
            doc.pop("_id", None)
            new_races.append(doc)
        else:
            new_races.append(r)

    # Register the mini series group (one atomic write, versioned).
    # race_numbers is just the base number since all sub-races share it.
    group = {"name": (data.name or "").strip() or f"Mini R{base}",
             "race_numbers": [base], "discards": 0,
             "scoring": data.scoring}
    # Parent/child structure: stamp each child race with its group so the
    # relationship is explicit. Labels run A, B, C… after the slot number:
    # a split of race 3 into three races gives R3A, R3B, R3C.
    group_index = len(groups)
    for sub_idx, r in enumerate(new_races):
        suffix = chr(ord("A") + sub_idx)
        label = f"R{base}{suffix}" if count > 1 else f"R{base}"
        await db.races.update_one({"id": r["id"]},
                                  {"$set": {"mini_group_id": group_index,
                                            "mini_group_label": label},
                                   "$inc": {"version": 1}})
        r["mini_group_id"] = group_index
        r["mini_group_label"] = label
    update = {"$set": {"mini_series": True, "mini_series_groups": groups + [group]},
              "$inc": {"version": 1}}
    result = await db.series.update_one(_version_filter(series_id, _expected_version(data)), update)
    if result.modified_count == 0:
        _raise_stale(_expected_version(data))
    fresh = await db.series.find_one({"id": series_id}, {"_id": 0})
    club_id = await _class_club_id(series.get("class_id"))
    await _log_audit(request=None, user=user, action="MINI_SPLIT_CREATED",
                     description=f"Split race {base} into {count} races as mini series “{group['name']}” ({group['scoring']})",
                     resource_type="series", resource_id=series_id, club_id=club_id)
    return {"series": fresh, "group": group,
            "group_index": group_index,
            "races": new_races}


class MiniAddRaceInput(BaseModel):
    # The new race's date (defaults to the mini series' existing date).
    date: Optional[str] = None
    start_time: Optional[str] = None


@api_router.post("/series/{series_id}/mini/{group_index}/races")
async def add_mini_series_race(series_id: str, group_index: int,
                               data: MiniAddRaceInput,
                               user: dict = Depends(require_officer)):
    """Grow a mini series by one race on the day: appends the next race number
    to the group, slots it into the schedule and creates the child race (with
    its parent/child stamp). Only allowed when the group sits at the end of
    the series so no later race needs renumbering."""
    series = await _series_of_club(series_id, user)
    await _ensure_series_not_locked(series_id,
                                    detail="Season results are locked — the schedule cannot be changed.")
    groups = list(series.get("mini_series_groups") or [])
    if group_index < 0 or group_index >= len(groups):
        raise HTTPException(status_code=404, detail="Mini series not found")
    group = dict(groups[group_index])
    nums = sorted({int(n) for n in (group.get("race_numbers") or []) if int(n) >= 1})
    if not nums:
        raise HTTPException(status_code=400, detail="Mini series has no races")
    base = nums[0]
    existing = await db.races.find({"series_id": series_id, "race_number": base, "mini_group_id": group_index}, {"_id": 0}).to_list(1000)
    sub_count = len(existing)
    suffix = chr(ord("A") + sub_count)
    label = f"R{base}{suffix}"

    cls = await db.classes.find_one({"id": series.get("class_id")}, {"_id": 0})
    year = series["year"]
    boats = await _class_active_boats(series.get("class_id"), year)
    results = [{"boat_id": b["id"], "code": "DNC", "finish_time": None,
                "position": None, "penalty_points": 0} for b in boats]
    # Use the date from an existing sub-race in this group.
    base_date = data.date or (await db.races.find_one(
        {"series_id": series_id, "race_number": base, "mini_group_id": group_index}, {"_id": 0, "date": 1}) or {}).get("date")
    if not base_date:
        raise HTTPException(status_code=400,
                            detail="No date for the new race — set the mini series date first")
    doc = {
        "id": new_id(), "date": base_date, "class_id": series["class_id"],
        "series_id": series_id, "year": year, "race_number": base,
        "start_time": data.start_time or cls.get("default_start_time", "10:30"),
        "start_tz_offset_minutes": None, "actual_start": None, "course": "",
        "special_rules": "", "life_jackets": False, "status": "setup",
        "entries_count": len(results), "results": results,
        "created_at": now_iso(), "version": 1,
        "mini_group_id": group_index, "mini_group_label": label,
    }
    await db.races.insert_one(doc)
    doc.pop("_id", None)

    groups[group_index] = group
    update = {"$set": {"mini_series_groups": groups, "version": (series.get("version") or 0) + 1}}
    result = await db.series.update_one({"id": series_id}, update)
    if result.modified_count == 0:
        raise HTTPException(status_code=409, detail="Series changed — reload and try again")
    fresh = await db.series.find_one({"id": series_id}, {"_id": 0})
    club_id = await _class_club_id(series.get("class_id"))
    await _log_audit(request=None, user=user, action="MINI_RACE_ADDED",
                     description=f"Added race {label} to mini series “{group['name']}”",
                     resource_type="series", resource_id=series_id, club_id=club_id)
    return {"series": fresh, "group": group, "group_index": group_index, "race": doc}


@api_router.put("/series/{series_id}/mini/{group_index}")
async def update_mini_group_settings(
        series_id: str, group_index: int, data: MiniGroupSettingsInput,
        user: dict = Depends(require_officer)):
    """Allow the race officer to change a mini-series group's discard count
    on the day, without navigating to the admin series editor. Only the
    officer's own club's series may be changed."""
    series = await _series_of_club(series_id, user)
    await _ensure_series_not_locked(
        series_id,
        detail="Season results are locked — discards cannot be changed.")
    groups = list(series.get("mini_series_groups") or [])
    if group_index < 0 or group_index >= len(groups):
        raise HTTPException(status_code=404, detail="Mini series group not found")
    discards = max(0, data.discards)
    groups[group_index]["discards"] = discards
    new_version = (series.get("version") or 0) + 1
    result = await db.series.update_one(
        {"id": series_id},
        {"$set": {"mini_series_groups": groups, "version": new_version}})
    if result.modified_count == 0:
        raise HTTPException(status_code=409, detail="Series changed — reload and try again")
    fresh = await db.series.find_one({"id": series_id}, {"_id": 0})
    club_id = await _class_club_id(series.get("class_id"))
    await _log_audit(
        request=None, user=user, action="MINI_GROUP_DISCARDS_CHANGED",
        description=(
            f"Set discards={discards} on mini series “{groups[group_index].get('name')}”"
        ),
        resource_type="series", resource_id=series_id, club_id=club_id)
    return {"series": fresh, "group": groups[group_index], "group_index": group_index}


@api_router.post("/series/{series_id}/mini/{group_index}/merge")
async def merge_mini_series(series_id: str, group_index: int,
                            user: dict = Depends(require_officer)):
    """Revert a mini series back into ONE normal race — the inverse of the
    race-day split.

    The slot race keeps its number (it becomes the normal race again); the
    extra child races are deleted, later races are renumbered back down by
    count-1, and the schedule / planned_races shrink accordingly. This is
    only allowed while nothing has been scored or published: every race in
    the group must be setup with all-DNC entries, no later race may be
    published (they get renumbered), and no other mini series may cover
    races after this group (its stored numbers would break).
    """
    series = await _series_of_club(series_id, user)
    await _ensure_series_not_locked(
        series_id,
        detail="Season results are locked — the schedule cannot be changed. Use the administrator correction process to amend the season.")
    groups = list(series.get("mini_series_groups") or [])
    if group_index < 0 or group_index >= len(groups):
        raise HTTPException(status_code=404, detail="Mini series not found")
    group = dict(groups[group_index])
    nums = sorted({int(n) for n in (group.get("race_numbers") or []) if int(n) >= 1})
    if not nums:
        raise HTTPException(status_code=400,
                            detail="This mini series has no races — nothing to merge back")
    base = nums[0]

    races = await db.races.find({"series_id": series_id}, {"_id": 0}).to_list(1000)
    by_number = {r.get("race_number"): r for r in races}

    # Safety: no race in the group may be published or hold a recorded
    # result (sign-on or finish) — merging would throw that away.
    # Find all sub-races sharing this base race number with the group's index.
    sub_races = [r for r in races if r.get("race_number") == base and r.get("mini_group_id") == group_index]
    for r in sub_races:
        label = r.get("mini_group_label") or f"Race {base}"
        if r.get("status") == "published":
            raise HTTPException(status_code=400,
                                detail=f"{label} is published — recall it before reverting the mini series")
        for entry in r.get("results") or []:
            if (entry.get("code") or "DNC") != "DNC" or (entry.get("penalty_points") or 0) != 0:
                raise HTTPException(status_code=400,
                                    detail=f"{label} has recorded results — clear them before reverting the mini series")

    # Delete all sub-races except one (the surviving slot race).
    # No race number shifting needed — future races keep their original numbers.
    slot = None
    for r in sub_races:
        if slot is None:
            slot = r  # Keep the first sub-race as the surviving slot
        else:
            await db.races.delete_one({"id": r["id"]})

    # Clear the parent/child stamp on the surviving slot race.
    if slot:
        await db.races.update_one(
            {"id": slot["id"]},
            {"$unset": {"mini_group_id": "", "mini_group_label": ""}, "$inc": {"version": 1}})

    # Remove the group, then drop any other leftover groups that hold no
    # races (debris from earlier splits/merges). A revert must leave the
    # series fully clean — a phantom empty mini series must not keep showing
    # in the admin console's Series editor or the standings payloads.
    del groups[group_index]
    groups = [g for g in groups
              if {int(n) for n in (g.get("race_numbers") or []) if int(n) >= 1}]
    set_fields = {
        "mini_series_groups": groups,
        "version": (series.get("version") or 0) + 1,
    }
    if not groups:
        set_fields["mini_series"] = False
    await db.series.update_one({"id": series_id}, {"$set": set_fields})

    fresh = await db.series.find_one({"id": series_id}, {"_id": 0})
    club_id = await _class_club_id(series.get("class_id"))
    await _log_audit(request=None, user=user, action="MINI_SERIES_MERGED",
                     description=f"Reverted mini series “{group.get('name')}” back to a single race (R{base})",
                     resource_type="series", resource_id=series_id, club_id=club_id)
    return {"series": fresh, "race": slot}


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
    # A race number may only be used once per series (unique index also
    # enforces this — a raw DuplicateKeyError would surface as an opaque 500).
    dup = await db.races.find_one({"series_id": data.series_id,
                                   "race_number": data.race_number}, {"_id": 1})
    if dup:
        raise HTTPException(status_code=400,
                            detail=f"Race {data.race_number} already exists in this series — use the next race number.")
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
    # If this race number sits inside an admin-configured mini series group,
    # stamp it as a child race (parent/child structure).
    gi, label = _mini_group_stamp(series, data.race_number)
    if gi is not None:
        doc["mini_group_id"] = gi
        doc["mini_group_label"] = label
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
    was_published = race.get("status") == "published"
    publication_event_id = new_id() if status == "published" and not was_published else None
    expected = _expected_version_query(request)
    status_update = {"status": status, "published_at": now_iso() if status == "published" else None}
    if publication_event_id:
        status_update["publication_event_id"] = publication_event_id
    result = await db.races.update_one(
        _version_filter(race_id, expected),
        {"$set": status_update, "$inc": {"version": 1}})
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


@api_router.post("/races/{race_id}/abandon")
async def set_race_abandoned(race_id: str, data: RaceAbandonInput, request: Request,
                             user: dict = Depends(require_officer)):
    """Mark a race abandoned (or restore it). The race keeps its record and
    results (the committee may need them), but it is excluded from series
    scoring: it no longer counts as a race sailed, so the series has fewer
    races scored and its discard schedule (especially increasing discards)
    adjusts automatically. Blocked for locked/archived seasons."""
    race = await _race_of_club(race_id, user)
    await _ensure_series_not_locked(race.get("series_id"))
    expected = _expected_version_query(request)
    result = await db.races.update_one(
        _version_filter(race_id, expected),
        {"$set": {"abandoned": bool(data.abandoned)},
         "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    club_id = await _class_club_id(race.get("class_id"))
    await _log_audit(request=None, user=user,
                     action="RACE_ABANDONED" if data.abandoned else "RACE_RESTORED",
                     description=f"Race {race.get('race_number')} "
                                 f"{'abandoned' if data.abandoned else 'restored to the series'}",
                     resource_type="race", resource_id=race_id, club_id=club_id)
    return await db.races.find_one({"id": race_id}, {"_id": 0})


@api_router.delete("/races/{race_id}")
async def delete_race(race_id: str, request: Request,
                      user: dict = Depends(require_officer)):
    race = await _race_of_club(race_id, user)
    await _ensure_series_not_locked(race.get("series_id"))
    expected = _expected_version_query(request)
    result = await db.races.delete_one(_version_filter(race_id, expected))
    if result.deleted_count == 0:
        _raise_stale(expected)
    # If the race belonged to a mini-series group, remove its number from
    # the group's race_numbers list so the batch page and scoring engine
    # don't reference a race that no longer exists.
    series_id = race.get("series_id")
    race_number = race.get("race_number")
    if series_id and race_number is not None:
        series = await db.series.find_one({"id": series_id}, {"_id": 0})
        groups = list(series.get("mini_series_groups") or [])
        changed = False
        for g in groups:
            nums = g.get("race_numbers") or []
            if race_number in nums:
                g["race_numbers"] = [n for n in nums if n != race_number]
                changed = True
        if changed:
            await db.series.update_one(
                {"id": series_id},
                {"$set": {"mini_series_groups": groups, "version": (series.get("version") or 0) + 1}})
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
async def read_audit(request: Request, user: dict = Depends(require_webmaster),
                     club_id: Optional[str] = None, username: Optional[str] = None,
                     role: Optional[str] = None, action: Optional[str] = None,
                     from_date: Optional[str] = None, to_date: Optional[str] = None,
                     limit: int = 100, offset: int = 0):
    """Audit events, newest first. This endpoint is exclusively Webmaster-only;
    all filtering and retrieval remains behind the same backend role guard."""
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
                      "last_failed_login", "locked_until", "lockout_level",
                      "totp_secret_enc", "totp_enabled", "email",
                      "email_otp_hash", "email_otp_expires")


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
# Backup / restore (webmaster only)
# ---------------------------------------------------------------------------
# Collections included in a backup (insertion order matters for
# referential consistency — clubs first, then users, etc.).
BACKUP_COLLECTIONS = (
    "clubs", "users", "classes", "boats", "series", "races",
    "adverts",
)


@api_router.post("/admin/backup/restore")
async def restore_backup(request: Request, file: UploadFile = File(...),
                         user: dict = Depends(require_webmaster)):
    """Webmaster only: restore data from a backup ZIP.

    Full-system backups (scope=all-clubs) replace every collection.
    Club backups (scope=club) replace only that club's data — other clubs,
    global adverts and global users are untouched.

    Security fields (passcode_hash, reset tokens, lockout state) are
    stripped from imported user records so a leaked backup cannot inject
    credentials.
    """
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400,
                            detail="Backup file must be a .zip archive")
    raw = await file.read()
    if len(raw) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400,
                            detail="Backup file too large (50 MB max)")

    # Parse the zip and validate it looks like a valid backup.
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400,
                            detail="File is not a valid ZIP archive")
    names = set(zf.namelist())
    if "metadata.json" not in names:
        raise HTTPException(status_code=400,
                            detail="Invalid backup: missing metadata.json")

    meta = json.loads(zf.read("metadata.json"))
    scope = meta.get("scope")
    scope_club_id = meta.get("club_id")
    if scope not in ("all-clubs", "club"):
        raise HTTPException(status_code=400,
                            detail=f"Unrecognised backup scope: {scope}")

    # For a club-scoped backup, verify the club exists.
    if scope == "club":
        if not scope_club_id:
            raise HTTPException(status_code=400,
                                detail="Club backup missing club_id in metadata")
        club_doc = await db.clubs.find_one({"id": scope_club_id}, {"_id": 0})
        if not club_doc:
            raise HTTPException(status_code=400,
                                detail="The club in this backup no longer exists")

    restored = []
    errors = []

    for coll_name in BACKUP_COLLECTIONS:
        fname = f"{coll_name}.json"
        if fname not in names:
            errors.append(f"{coll_name}: not in backup (skipped)")
            continue
        try:
            docs = json.loads(zf.read(fname))
        except Exception as exc:
            errors.append(f"{coll_name}: failed to parse — {exc}")
            continue

        if scope == "all-clubs":
            # Full system restore: drop the collection and replace entirely.
            await db[coll_name].drop()
            if docs:
                await db[coll_name].insert_many(docs, ordered=False)
        else:
            # Club-scoped restore: only touch data belonging to this club.
            if coll_name == "clubs":
                # Upsert the single club document.
                existing = await db.clubs.find_one({"id": scope_club_id})
                if existing:
                    await db.clubs.update_one(
                        {"id": scope_club_id},
                        {"$set": {k: v for k, v in docs[0].items()
                                   if k != "_id"}})
                else:
                    await db.clubs.insert_one(docs[0])
            elif coll_name == "users":
                # Replace only users belonging to this club (keep the
                # webmaster and users of other clubs intact).
                await db.users.delete_many({"club_id": scope_club_id})
                if docs:
                    cleaned = [_strip_backup_secrets(u) for u in docs]
                    await db.users.insert_many(cleaned, ordered=False)
            elif coll_name == "adverts":
                # Adverts are global — only restore if this is a full backup.
                errors.append("adverts: global collection (skipped for club restore)")
                continue
            elif coll_name == "audit_logs":
                # Audit logs are append-only; insert without removing existing.
                if docs:
                    await db.audit_logs.insert_many(docs, ordered=False)
            else:
                # Class-scoped collections: delete existing, then insert.
                if coll_name == "boats":
                    # Boats are scoped by class_id, not club_id directly.
                    # Classes were already replaced above, so use the
                    # backup's class list to identify which boats to remove.
                    backup_class_ids = {c["id"] for c in
                                         json.loads(zf.read("classes.json"))}
                    await db.boats.delete_many(
                        {"class_id": {"$in": list(backup_class_ids)}})
                elif coll_name in ("classes", "series", "races"):
                    await db[coll_name].delete_many({"club_id": scope_club_id})
                if docs:
                    await db[coll_name].insert_many(docs, ordered=False)

        restored.append(coll_name)

    # Log the restore action.
    scope_label = "full system" if scope == "all-clubs" else f"club {scope_club_id}"
    desc = (f"{user.get('username')} restored {scope_label} from backup "
            f"({meta.get('exported_at', '?')})")
    await _log_audit(request=request, user=user, action="BACKUP_RESTORE",
                     description=desc, resource_type="backup",
                     resource_id=scope_club_id or "all",
                     club_id=scope_club_id)
    logger.info("BACKUP RESTORE scope=%s by=%s ip=%s", scope_club_id or "all",
                user.get("username"), _client_ip(request))

    return {
        "scope": scope,
        "club_id": scope_club_id,
        "restored": restored,
        "errors": errors,
        "backup_exported_at": meta.get("exported_at"),
        "backup_generated_by": meta.get("generated_by"),
    }


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
    # Clubs that switched race-day notices off hide their notices from the
    # public feed too — not just from the officer editor.
    disabled_clubs = {c["id"] for c in await db.clubs.find(
        {"race_day_notices": False}, {"_id": 0, "id": 1}).to_list(100)}
    out = []
    for r in races:
        cls = classes.get(r["class_id"], {})
        if cls.get("club_id") in disabled_clubs:
            continue
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
      ("finishers_plus_1" — the default: one more than the number of boats
      that finished the race; "dnf" = the active A5 DNF score; "dnc").
    - scp/zfp: penalty rule per RRS 44.3(c)/30.2 — a percentage of the DNF
      score added to the boat's place, rounded half-up, never worse than DNF
      (that cap is itself configurable via cap_dnf).
    - duty: the boat's own average of its scores across the series before
      discards (DNC and every other scoring code included, at its existing
      rule value; only other duty races are excluded from the average).
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
        "tle": {"enabled": False, "time_limit_minutes": None, "method": "finishers_plus_1"},
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
    TLE      -> the series' configured TLE rule (default: finishers + 1).
    DNC      -> series entries + 1 under every convention.
    DNS/OCS/UFD/BFD/NSC/DNF/RET/DSQ/DNE -> the active A5 base: series
                entries + 1 (A5.2 default), start-area entries + 1 (A5.3),
                or finishers + 1 (RYA/Sailwave convention).
    OOD      -> duty average over the series (DNC included), filled in later
                by _apply_duty_points().
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


def _mini_group_stamp(series, race_number):
    """Parent/child stamp for a race that belongs to a mini series.

    Returns (mini_group_id, mini_group_label) — the 0-based group index on the
    series and a display label like ("R3A", "R3B", "R3C") where 3 is the
    group's first race number. Returns (None, None) for a normal race or a
    race not covered by any group."""
    groups = series.get("mini_series_groups") or []
    for gi, g in enumerate(groups):
        nums = sorted({int(n) for n in (g.get("race_numbers") or []) if int(n) >= 1})
        if race_number in nums:
            suffix = chr(ord("A") + nums.index(race_number))
            label = f"R{nums[0]}{suffix}" if len(nums) > 1 else f"R{race_number}"
            return gi, label
    return None, None


def _normalize_mini_groups(series, races):
    """Normalize a series' mini-series groups for display and scoring.

    Returns a list of dicts:
    {name, race_numbers, discards, scoring, race_count}.
    scoring is "additional" (each mini race counts individually in the main
    series) or "combined" (the group aggregates into one daily result).
    Explicit groups (mini_series_groups) are honoured as-is; a legacy series
    stored with mini_series_size is split into consecutive chunks of that
    size (always "additional"). race_count is how many of the group's race
    numbers actually have published races in the series."""
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
        # A group with no races assigned contributes nothing to the series —
        # drop it rather than rendering an empty tab/standings section. This
        # hides leftover groups (e.g. created but never given races) from the
        # public page, the officer console and the standings payload.
        if not rns:
            continue
        name = (g.get("name") or "").strip() or f"Mini {i + 1}"
        scoring = g.get("scoring") or "additional"
        if scoring not in ("additional", "combined"):
            scoring = "additional"
        out.append({"name": name, "race_numbers": rns,
                    "discards": int(g.get("discards", 0)),
                    "scoring": scoring,
                    "race_count": len([n for n in rns if n in published_numbers])})
    return out


def _mini_combined_score(entries, discards):
    """Combine one boat's mini-series race entries into a single daily result.

    The mini series' own discard rules apply first (the worst discardable
    scores are dropped — DNE is never discardable — and at least one race
    always counts), then the average of the counting races is returned, i.e.
    the value used as ONE score in the main series.

    Returns (average, drop): the daily-average points value and the set of
    discarded entry indices (in the order the entries were given)."""
    discardable_idx = sorted(
        [i for i, e in enumerate(entries) if e["discardable"]],
        key=lambda i: entries[i]["points"], reverse=True,
    )
    d = min(int(discards or 0), max(0, len(entries) - 1))
    drop = set(discardable_idx[:d])
    counting = [e["points"] for i, e in enumerate(entries) if i not in drop]
    avg = sum(counting) / len(counting) if counting else 0.0
    return avg, drop


def _fold_combined_mini_groups(series, agg, race_meta):
    """Fold mini series configured as "combined" into single daily results.

    Each mini race is scored individually first (already in agg, including
    duty points), then the group's discards are applied and the average of
    the counting races becomes ONE main-series entry (code MINI_COMBINED_CODE)
    positioned where the group's races sit chronologically. The group's
    individual races are removed from race_meta — they no longer count as
    separate main-series races. Groups with scoring "additional" are left
    untouched. Returns (agg, race_meta)."""
    groups = _normalize_mini_groups(series, race_meta)
    combined = {tuple(g["race_numbers"]): g for g in groups
                if g["scoring"] == "combined" and g["race_numbers"]}
    if not combined:
        return agg, race_meta
    group_of_index = {}
    group_idxs = {}
    for i, m in enumerate(race_meta):
        for nums, g in combined.items():
            if m.get("race_number") in nums:
                group_of_index[i] = nums
                group_idxs.setdefault(nums, []).append(i)
                break
    if not group_of_index:
        return agg, race_meta
    # 1-based index of each combined group in the series' normalized group list,
    # so the standings table can link a combined column to its constituent races.
    combined_index = {tuple(g["race_numbers"]): i + 1
                      for i, g in enumerate(groups) if g["scoring"] == "combined"}
    new_meta = []
    new_agg = {bid: [] for bid in agg}
    consumed = set()
    for i, m in enumerate(race_meta):
        if i in consumed:
            continue
        nums = group_of_index.get(i)
        if nums is None:
            new_meta.append(m)
            for bid, entries in agg.items():
                new_agg[bid].append(entries[i])
            continue
        g = combined[nums]
        idxs = group_idxs[nums]
        consumed.update(idxs)
        new_meta.append({
            "race_number": None,
            "date": race_meta[idxs[0]].get("date"),
            "mini_name": g["name"],
            "mini_races": len(idxs),
            "mini_index": combined_index.get(nums),
            "combined": True,
        })
        # First pass: compute each boat's daily average and A8 tieback so we
        # can rank them within the mini-series day. A boat that DNC'd every
        # mini race did not take part in the day at all — it scores the same
        # DNC the main series would award for a normal race, never a
        # finishing position within the day.
        boat_scores = {}
        dnc_only = set()
        for bid, entries in agg.items():
            mini_entries = [entries[j] for j in idxs]
            if all(e["code"] == "DNC" for e in mini_entries):
                dnc_only.add(bid)
            avg, drop = _mini_combined_score(mini_entries, g["discards"])
            mini_tb_1, mini_tb_2 = _a8_tiebreak(mini_entries, drop)
            boat_scores[bid] = (avg, drop, mini_tb_1, mini_tb_2)
        # Rank the fleet: best daily average first, then A8 countback over
        # the day's races breaks ties — the rank (1 for 1st, 2 for 2nd, …)
        # becomes the single score carried into the main series, matching
        # the overall-championship convention for combined mini-series days.
        # Boats DNC for the whole day are excluded (they score DNC instead).
        sorted_bids = sorted((b for b in boat_scores if b not in dnc_only),
                             key=lambda b: (boat_scores[b][0], boat_scores[b][2], boat_scores[b][3]))
        ranks = {bid: i + 1 for i, bid in enumerate(sorted_bids)}
        # Second pass: folded entry carries the rank, not the average.
        for bid, entries in agg.items():
            avg, drop, mini_tb_1, mini_tb_2 = boat_scores[bid]
            if bid in dnc_only:
                new_agg[bid].append({"points": avg, "code": "DNC",
                                     "discardable": True, "position": None,
                                     "mini_tb": None})
            else:
                new_agg[bid].append({"points": ranks[bid], "code": MINI_COMBINED_CODE,
                                     "discardable": True, "position": None,
                                     "mini_tb": [mini_tb_1, mini_tb_2]})
    return new_agg, new_meta


def _apply_duty_points(agg, entries_by_race, cfg=None):
    """Duty races (OOD — Officer of the Day) score the boat's own average of
    its scores across EVERY race in the series before discards — including
    DNC (and DNS, RET, DNF, DSQ, etc.), each at its existing scoring-rule
    value. Only the boat's other duty races are excluded from the average
    (a duty score cannot average itself). A boat with no non-duty races
    falls back to the DNC score (series entries + 1) so duty can never score
    better than a finish in a tiny fleet.

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
        # Every race in the series contributes to the OOD average (DNC
        # included, at its existing numerical score); only other duty races
        # are left out — averaging a duty score into itself is circular.
        counting = [e["points"] for e in entries if e["code"] not in DUTY_CODES]
        for i, e in enumerate(entries):
            if e["code"] in DUTY_CODES:
                if counting:
                    e["points"] = round(sum(counting) / len(counting), precision)
                else:
                    e["points"] = float(entries_by_race[i] + 1)


async def _series_scores(series, race_numbers=None, fold_combined=False):
    """Return (agg, boat_map, race_meta, cfg, races). agg: boat_id -> list of
    per-race entry dicts, aligned to race_meta; cfg: the series' effective
    scoring config; races: the published races scored. If race_numbers is
    given (a set/list of the series' race numbers), only those races count.

    fold_combined: when True (the full-series view), mini series configured
    with scoring "combined" are folded into single daily results — the
    mini-series discards are applied, the counting races averaged, and each
    group becomes ONE scoring unit (race_meta entry + agg entry) instead of
    its individual races."""
    races = await db.races.find({"series_id": series["id"], "status": "published",
                                 "abandoned": {"$ne": True}}, {"_id": 0}).to_list(1000)
    races.sort(key=lambda r: (r.get("date", ""), r.get("race_number", 0)))
    if race_numbers is not None:
        keep = {int(n) for n in race_numbers}
        races = [r for r in races if int(r.get("race_number") or 0) in keep]
    boats = await db.boats.find({"class_id": series["class_id"], "year": series["year"]}, {"_id": 0}).to_list(2000)
    # Only boats that actually appear in at least one published race of this
    # series are entered in it. Boats registered in the class that never raced
    # the series must not clutter its standings (e.g. a one-off regatta whose
    # fleet is a subset of the club's full class fleet). Boats absent from an
    # individual race still auto-score DNC as usual; boats absent from the
    # whole series simply do not belong to it. A series with no published
    # races yet keeps its full fleet (all-zero rows) as before.
    entered = {r.get("boat_id") for race in races
               for r in (race.get("results") or []) if r.get("boat_id")}
    if races and entered:
        boats = [b for b in boats if b.get("id") in entered]
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
    if fold_combined:
        agg, race_meta = _fold_combined_mini_groups(series, agg, race_meta)
    return agg, boat_map, race_meta, cfg, races


async def compute_series_standings(series, race_numbers=None, discards=None):
    """Compute the canonical normalized results-export payload."""
    # The full series folds "combined" mini groups into one daily result each;
    # a mini-series view (race_numbers given) always shows the individual
    # races, so folding never applies there.
    agg, boat_map, race_meta, cfg, races = await _series_scores(
        series, race_numbers, fold_combined=(race_numbers is None))
    club_name = await _club_name_of_class(series.get("class_id"))
    race_count = len(race_meta)
    # A mini-series view of a group configured as "combined" also reports the
    # group's daily average per boat (after the group's own discards), so the
    # detailed view can show exactly what feeds the main series.
    combined_view = None
    if series.get("mini_series") and race_numbers is not None:
        requested = sorted({int(n) for n in race_numbers})
        for g in _normalize_mini_groups(series, races):
            if g.get("scoring") == "combined" and g["race_numbers"] == requested:
                combined_view = g
                break
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
        row = {
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
        }
        if combined_view is not None:
            avg, _drop = _mini_combined_score(entries, combined_view["discards"])
            row["_combined_avg"] = avg
        # A combined column conceals the day's races, so the main series
        # breaks ties on it with the mini day's own countback (see
        # _fold_combined_mini_groups) — never more than one per boat.
        row["_mini_tb"] = next((e.get("mini_tb") for e in entries if e.get("mini_tb")), None)
        rows.append(row)

    def _row_key(r):
        # A combined mini view ranks by the daily result (the single score it
        # contributes to the main series), not by the sum of its races; ties
        # fall back to the mini races' A8 countback. Every other view ranks
        # by net over its races.
        key = [(r.get("_combined_avg", r["net"]) if combined_view is not None else r["net"]),
               r["_tb"][0], r["_tb"][1]]
        if combined_view is None and r["_mini_tb"] is not None:
            key += list(r["_mini_tb"])
        return key

    rows.sort(key=_row_key)
    # For a combined mini view, replace the average with the finishing
    # position (1 for 1st, 2 for 2nd, …) — the same position-based
    # scoring used in the overall championship for combined mini-series.
    # A boat that DNC'd the entire day never receives a position: it shows
    # the DNC value it contributes to the main series, consistent with the
    # folded result.
    if combined_view is not None:
        participants = [r for r in rows
                        if not all(s.get("code") == "DNC" for s in r.get("scores", []))]
        rank_map = {r["boat_id"]: i + 1 for i, r in enumerate(participants)}
        for r in rows:
            r["combined_average"] = rank_map.get(r["boat_id"], r.get("_combined_avg"))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
        r.pop("_tb", None)
        r.pop("_mini_tb", None)
        r.pop("_combined_avg", None)
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
            # Computed from the underlying races (never the folded meta), so
            # every group's race_count reflects its real published races.
            "groups": _normalize_mini_groups(series, races),
        }
        if combined_view is not None:
            payload["mini_combined"] = {"name": combined_view["name"],
                                         "discards": combined_view["discards"]}
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
        all_races = await db.races.find({"series_id": series["id"], "status": "published",
                                         "abandoned": {"$ne": True}},
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
    all_races = await db.races.find({"series_id": series_id, "status": "published",
                                     "abandoned": {"$ne": True}},
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


async def compute_overall_standings(class_id: str, year: int):
    """Overall championship standings for a class and year (every series in
    the class that counts towards the championship, summed by net score)."""
    all_series = await db.series.find({"class_id": class_id, "year": year, "included_in_overall": True}, {"_id": 0}).to_list(1000)
    boats = await db.boats.find({"class_id": class_id, "year": year}, {"_id": 0}).to_list(2000)
    club_name = await _club_name_of_class(class_id)
    boat_map = {b["id"]: b for b in boats}
    totals = {}
    per_series_nets = {}
    series_names = []
    # A boat that never signed onto a series scores DNC in EVERY race of that
    # series (with the series' discards applied) — never 0, and never a single
    # flat DNC — so a boat that sits out a series (or several) can never float
    # to the top of the championship. The DNC points mirror the series' own
    # rule: series entries + 1 (the boats that actually raced the series, not
    # the whole class fleet), net after the same discard policy the series
    # would apply. A combined mini-series day already scores by finishing
    # position, so its absent-boat score is the next position after the last
    # boat. Series with no published races yet have no one to "sit out":
    # everyone scores 0 until the series starts.
    dnc_series_net = {}
    use_position = {}
    for series in all_series:
        name = series["name"]
        race_docs = await db.races.find({"series_id": series["id"], "status": "published",
                                         "abandoned": {"$ne": True}}, {"_id": 0}).to_list(1000)
        groups = series.get("mini_series_groups") or []
        pos = bool(series.get("mini_series")) and groups and all(g.get("scoring") == "combined" for g in groups)
        use_position[name] = pos
        if not race_docs:
            continue
        # DNC per race = entries + 1: the number of boats that actually raced
        # the series (falling back to the class fleet when the series is
        # empty). RRS A5: DNC always scores series entries + 1.
        raced_boats = {x.get("boat_id") for r in race_docs
                       for x in (r.get("results") or []) if x.get("boat_id")}
        entries = len(raced_boats) if raced_boats else len(boat_map)
        dnc = float(entries + 1)
        # The net an all-DNC boat scores in this series: every race is
        # discardable and identical, so after the series' effective discards
        # the counting races are race_count - discards (at least one counts).
        cfg = _series_scoring_config(series)
        discard_policy = cfg.get("discard_policy", "fixed")
        configured = series.get("discards", 0)
        if discard_policy == "increasing":
            configured = _effective_discards(cfg, len(race_docs), configured)
        discards = min(configured, max(0, len(race_docs) - 1))
        counting = max(1, len(race_docs) - discards)
        dnc_series_net[name] = dnc * counting
    for series in sorted(all_series, key=lambda s: s.get("order", 0)):
        name = series["name"]
        series_names.append(name)
        frozen = await _standings_for_series(series)
        result = frozen if frozen is not None else await compute_series_standings(series)
        pos = use_position[name]
        for row in result["standings"]:
            net = row["rank"] if pos else row["net"]
            totals[row["boat_id"]] = totals.get(row["boat_id"], 0.0) + net
            per_series_nets.setdefault(row["boat_id"], {})[name] = net
        # Boats that never raced this series score its DNC net (DNC in every
        # race, discards applied) so they sink below everyone who sailed it.
        if name in dnc_series_net:
            raced_ids = {row["boat_id"] for row in result["standings"]}
            for bid in boat_map:
                if bid in raced_ids:
                    continue
                dnc = dnc_series_net[name] if not pos else (len(result["standings"]) + 1)
                totals[bid] = totals.get(bid, 0.0) + dnc
                per_series_nets.setdefault(bid, {})[name] = dnc
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


@api_router.get("/standings/overall")
async def overall_standings(class_id: str, year: int, request: Request, club_id: Optional[str] = None):
    club = await _resolve_club_id(request, club_id)
    if club and (await _class_club_id(class_id)) != club:
        raise HTTPException(status_code=404, detail="Class not found")
    return await compute_overall_standings(class_id, year)


@api_router.get("/fleet/search")
async def fleet_search(q: Optional[str] = None, limit: int = 25):
    """Public boat search across every club: records whose boat name or sail
    number contains any query token are grouped by fleet identity, so one
    physical boat appears once with the clubs and classes it races for."""
    tokens = [t for t in re.split(r"\s+", (q or "").strip()) if t]
    if not tokens:
        return []
    cond = []
    for t in tokens:
        rx = re.escape(t)
        cond.append({"name": {"$regex": rx, "$options": "i"}})
        cond.append({"sail_no": {"$regex": rx, "$options": "i"}})
    # Also match the normalized identity key, so "watersong" finds a record
    # stored as "Water Song" and "8420" finds "GBR 8420".
    clean_q = _clean_fleet_part(q)
    if clean_q:
        cond.append({"fleet_key": {"$regex": re.escape(clean_q), "$options": "i"}})
    docs = await db.boats.find({"$or": cond}, {"_id": 0}).to_list(2000)
    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(1000)}
    clubs = {c["id"]: c for c in await db.clubs.find({}, {"_id": 0}).to_list(100)}
    groups = {}
    order = []
    for b in docs:
        # Public grouping is by the normalized sail-number + name identity key:
        # the same boat recorded at two clubs (even under different fleet_ids)
        # appears once when its name and sail number match. Records without a
        # key fall back to their fleet identity, then their own id.
        gid = b.get("fleet_key") or b.get("fleet_id") or b["id"]
        if gid not in groups:
            groups[gid] = {"fleet_id": b.get("fleet_id") or b["id"], "name": b.get("name"),
                           "sail_no": b.get("sail_no"),
                           "clubs": [], "classes": [], "records": 0}
            order.append(gid)
        g = groups[gid]
        cls = classes.get(b.get("class_id"), {})
        club = clubs.get(cls.get("club_id"), {})
        if club.get("name") and club["name"] not in g["clubs"]:
            g["clubs"].append(club["name"])
        if cls.get("name") and cls["name"] not in g["classes"]:
            g["classes"].append(cls["name"])
        g["records"] += 1
    out = [groups[fid] for fid in order]
    out.sort(key=lambda g: (g["name"] or "").lower())
    return out[: max(1, min(limit, 50))]


def _search_rx(q: str):
    """A case-insensitive regex matching any query token anywhere in a field."""
    tokens = [re.escape(t) for t in re.split(r"\s+", (q or "").strip()) if t]
    return re.compile("|".join(tokens), re.IGNORECASE) if tokens else None


@api_router.get("/search")
async def unified_search(q: Optional[str] = None, limit: int = 8):
    """Public site search: clubs, classes and series (by name) plus boats (by
    name or sail number). Each type returns the fields needed to link straight
    to its page — the club landing page for clubs/classes/series, the boat
    career page for boats."""
    rx = _search_rx(q)
    if rx is None:
        return {"clubs": [], "classes": [], "series": [], "boats": []}
    lim = max(1, min(limit, 25))

    clubs = {c["id"]: c for c in await db.clubs.find({}, {"_id": 0}).to_list(100)}
    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(1000)}

    # Clubs: name or slug.
    club_rows = await db.clubs.find({"$or": [{"name": rx}, {"slug": rx}]}, {"_id": 0}).to_list(100)
    club_out = []
    for c in club_rows:
        n_classes = sum(1 for x in classes.values() if x.get("club_id") == c["id"])
        club_out.append({"id": c["id"], "name": c.get("name"), "slug": c.get("slug"),
                         "classes": n_classes})
    club_out.sort(key=lambda c: (c["name"] or "").lower())

    # Classes: name (club context attached).
    class_rows = await db.classes.find({"name": rx}, {"_id": 0}).to_list(1000)
    class_out = []
    for c in class_rows:
        club = clubs.get(c.get("club_id"), {})
        n_series = await db.series.count_documents({"class_id": c["id"]})
        class_out.append({"id": c["id"], "name": c.get("name"),
                          "club_name": club.get("name", ""), "club_slug": club.get("slug", ""),
                          "series": n_series})
    class_out.sort(key=lambda c: (c["name"] or "").lower())

    # Series: name (class + club context attached).
    series_rows = await db.series.find({"name": rx}, {"_id": 0}).to_list(1000)
    series_out = []
    for s in series_rows:
        cls = classes.get(s.get("class_id"), {})
        club = clubs.get(cls.get("club_id"), {})
        series_out.append({"id": s["id"], "name": s.get("name"), "year": s.get("year"),
                           "class_id": s.get("class_id"), "class_name": cls.get("name", ""),
                           "club_name": club.get("name", ""), "club_slug": club.get("slug", "")})
    series_out.sort(key=lambda s: (s["name"] or "").lower())

    # Boats: same grouped-by-identity logic as fleet_search.
    boat_cond = []
    for t in re.split(r"\s+", (q or "").strip()):
        boat_cond.append({"name": rx})
        boat_cond.append({"sail_no": rx})
    clean_q = _clean_fleet_part(q)
    if clean_q:
        boat_cond.append({"fleet_key": {"$regex": re.escape(clean_q), "$options": "i"}})
    boat_docs = await db.boats.find({"$or": boat_cond}, {"_id": 0}).to_list(2000)
    groups = {}
    order = []
    for b in boat_docs:
        gid = b.get("fleet_key") or b.get("fleet_id") or b["id"]
        if gid not in groups:
            groups[gid] = {"fleet_id": b.get("fleet_id") or b["id"], "name": b.get("name"),
                           "sail_no": b.get("sail_no"), "clubs": [], "classes": [], "records": 0}
            order.append(gid)
        g = groups[gid]
        cls = classes.get(b.get("class_id"), {})
        club = clubs.get(cls.get("club_id"), {})
        if club.get("name") and club["name"] not in g["clubs"]:
            g["clubs"].append(club["name"])
        if cls.get("name") and cls["name"] not in g["classes"]:
            g["classes"].append(cls["name"])
        g["records"] += 1
    boat_out = [groups[fid] for fid in order]
    boat_out.sort(key=lambda g: (g["name"] or "").lower())

    return {"clubs": club_out[:lim], "classes": class_out[:lim],
            "series": series_out[:lim], "boats": boat_out[:lim]}


@api_router.get("/fleet/{fleet_id}")
async def fleet_profile(fleet_id: str):
    """A boat's career: every series (across clubs and classes) it has
    published results in, its final position in each, plus the club/class
    records that make up its shared identity and its overall-championship
    positions. Locked/archived seasons are served from their frozen snapshots."""
    members = await db.boats.find({"$or": [{"fleet_id": fleet_id}, {"id": fleet_id}]},
                                  {"_id": 0}).to_list(2000)
    if not members:
        raise HTTPException(status_code=404, detail="Boat not found")
    # The public career spans every record sharing the boat's normalized
    # name+sail key too — so a boat that races under two clubs groups into one
    # profile even when its club records were never explicitly linked.
    key = next((m.get("fleet_key") for m in members if m.get("fleet_key")), None)
    if key:
        known = {m["id"] for m in members}
        more = await db.boats.find({"fleet_key": key, "id": {"$nin": list(known)}},
                                   {"_id": 0}).to_list(2000)
        members.extend(more)
    ids = [m["id"] for m in members]
    races = await db.races.find({"status": "published", "results.boat_id": {"$in": ids},
                                 "abandoned": {"$ne": True}}, {"_id": 0}).to_list(5000)
    series_ids = {r.get("series_id") for r in races if r.get("series_id")}
    series_docs = {s["id"]: s for s in await db.series.find(
        {"id": {"$in": list(series_ids)}}, {"_id": 0}).to_list(1000)}
    # The boat's own result per published race, grouped by series (used below
    # to hide series she never actually raced).
    boat_results_by_series = {}
    for race in races:
        sid = race.get("series_id")
        if not sid:
            continue
        for res in race.get("results", []):
            if res.get("boat_id") in ids:
                boat_results_by_series.setdefault(sid, []).append(res)
    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0}).to_list(1000)}
    clubs = {c["id"]: c for c in await db.clubs.find({}, {"_id": 0}).to_list(100)}
    series_out = []
    for sid in sorted(series_ids):
        series = series_docs.get(sid)
        if not series:
            continue
        try:
            frozen = await _standings_for_series(series)
            standings = frozen if frozen is not None else await compute_series_standings(series)
        except HTTPException:
            continue
        row = next((r for r in standings.get("standings", []) if r["boat_id"] in ids), None)
        if row is None:
            continue
        # A series where the boat was DNC in every published race is not part
        # of her career — she never actually raced it (club fleets commonly
        # list the whole fleet DNC in races she didn't sail). Hide it from the
        # boat search page.
        own = boat_results_by_series.get(sid, [])
        if own and all((res.get("code") or "") == "DNC" for res in own):
            continue
        cls = classes.get(series.get("class_id"), {})
        club = clubs.get(cls.get("club_id"), {})
        series_out.append({
            "series_id": sid,
            "series_name": series.get("name"),
            "class_id": series.get("class_id"),
            "class_name": cls.get("name", "—"),
            "club_name": club.get("name", "—"),
            "club_slug": club.get("slug", ""),
            "year": series.get("year"),
            "rank": row.get("rank"),
            "net": row.get("net"),
            "total": row.get("total"),
            "races_scored": standings.get("race_count", 0),
            "discards": standings.get("discards", 0),
            "locked": bool(standings.get("locked")),
            "archived": bool(standings.get("archived")),
        })
    series_out.sort(key=lambda x: (x.get("year") or 0, x.get("club_name") or "",
                                   x.get("series_name") or ""), reverse=True)
    # Overall championship position per class+year the boat raced in.
    overall = []
    seen_cy = set()
    for s in series_out:
        cy = (s.get("class_id"), s.get("year"))
        if cy in seen_cy:
            continue
        seen_cy.add(cy)
        try:
            payload = await compute_overall_standings(s["class_id"], s["year"])
        except HTTPException:
            continue
        row = next((r for r in payload.get("standings", []) if r["boat_id"] in ids), None)
        if row:
            overall.append({"class_id": s.get("class_id"), "class_name": s["class_name"],
                            "club_name": s["club_name"], "club_slug": s.get("club_slug"),
                            "year": s["year"], "rank": row.get("rank"), "net": row.get("net")})
    overall.sort(key=lambda x: (x.get("year") or 0, x.get("club_name") or ""), reverse=True)
    primary = min(members, key=lambda m: m.get("created_at") or "")
    records = []
    for m in members:
        cls = classes.get(m.get("class_id"), {})
        club = clubs.get(cls.get("club_id"), {})
        records.append({
            "boat_id": m["id"], "class_name": cls.get("name", "—"),
            "club_name": club.get("name", "—"), "club_slug": club.get("slug", ""),
            "year": m.get("year"), "helm": m.get("helm"), "home_club": m.get("home_club"),
        })
    records.sort(key=lambda r: (r["club_name"], r["class_name"], r["year"] or 0))
    return {"fleet_id": fleet_id, "name": primary.get("name"), "sail_no": primary.get("sail_no"),
            "records": records, "series": series_out, "overall": overall}


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


# Account-free results subscriptions
# ---------------------------------------------------------------------------
# Subscribers are deliberately not users. A subscription is scoped to the
# target's owning club, and access is granted only by a random emailed token.
# Token plaintext is never persisted; only SHA-256 digests are stored.

class ResultsSubscriptionInput(BaseModel):
    email: EmailStr
    subscription_type: Literal["class", "series", "boat"]
    target_id: str


class SubscriptionTokenInput(BaseModel):
    token: str


def _subscription_token_hash(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def _public_web_base() -> str:
    return (PUBLIC_APP_BASE_URL or APP_BASE_URL or "http://localhost:3000").rstrip("/")


def _public_api_base() -> str:
    return (PUBLIC_API_BASE_URL or "").rstrip("/") or f"{_public_web_base()}/api"


def _subscription_rate_limited(email: str, ip: str) -> bool:
    now = time.time()
    limited = False
    for key in (f"subscription-email:{email}", f"subscription-ip:{ip}"):
        dq = _login_attempts[key]
        while dq and dq[0] < now - SUBSCRIPTION_RATE_WINDOW_SECONDS:
            dq.popleft()
        if len(dq) >= SUBSCRIPTION_RATE_LIMIT:
            limited = True
        dq.append(now)
    return limited


async def _subscription_target(subscription_type: str, target_id: str) -> dict:
    """Resolve a public target and return its immutable club scope + display
    metadata. A boat subscription uses the boat record id, never its name or
    sail number, so renaming a boat cannot break it."""
    if subscription_type == "class":
        target = await db.classes.find_one({"id": target_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Class not found")
        club = await db.clubs.find_one({"id": target.get("club_id")}, {"_id": 0, "name": 1, "slug": 1})
        return {"club_id": target["club_id"], "target_name": target.get("name"),
                "class_id": target["id"], "class_name": target.get("name"),
                "club_name": (club or {}).get("name"), "club_slug": (club or {}).get("slug")}
    if subscription_type == "series":
        target = await db.series.find_one({"id": target_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Series not found")
        cls = await db.classes.find_one({"id": target.get("class_id")}, {"_id": 0, "name": 1, "club_id": 1})
        club = await db.clubs.find_one({"id": (cls or {}).get("club_id")}, {"_id": 0, "name": 1, "slug": 1})
        if not cls or not cls.get("club_id"):
            raise HTTPException(status_code=404, detail="Series not found")
        return {"club_id": cls["club_id"], "target_name": target.get("name"),
                "series_id": target["id"], "series_name": target.get("name"),
                "class_id": target.get("class_id"), "class_name": cls.get("name"),
                "club_name": (club or {}).get("name"), "club_slug": (club or {}).get("slug")}
    if subscription_type == "boat":
        target = await db.boats.find_one({"id": target_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Boat not found")
        cls = await db.classes.find_one({"id": target.get("class_id")}, {"_id": 0, "name": 1, "club_id": 1})
        club = await db.clubs.find_one({"id": (cls or {}).get("club_id")}, {"_id": 0, "name": 1, "slug": 1})
        if not cls or not cls.get("club_id"):
            raise HTTPException(status_code=404, detail="Boat not found")
        return {"club_id": cls["club_id"], "target_name": target.get("name"),
                "boat_id": target["id"], "boat_name": target.get("name"),
                "sail_no": target.get("sail_no"), "class_id": target.get("class_id"),
                "class_name": cls.get("name"), "club_name": (club or {}).get("name"),
                "club_slug": (club or {}).get("slug")}
    raise HTTPException(status_code=400, detail="Invalid subscription type")


def _subscription_links(manage_token: str, verify_token: Optional[str] = None,
                        unsubscribe_token: Optional[str] = None) -> dict:
    manage = f"{_public_web_base()}/subscriptions/manage?token={manage_token}"
    verify = None
    if verify_token:
        verify = f"{_public_web_base()}/subscriptions/verify?token={verify_token}"
    unsubscribe = f"{_public_api_base()}/subscriptions/unsubscribe?token={unsubscribe_token}" if unsubscribe_token else None
    return {"manage": manage, "verify": verify, "unsubscribe": unsubscribe}


async def _send_subscription_verification(email: str, links: dict, target: dict) -> bool:
    cfg = await _get_email_settings()
    if not cfg.get("smtp_host"):
        return False
    msg = EmailMessage()
    msg["Subject"] = f"SailScore — confirm your {target.get('target_name', 'results')} subscription"
    msg["From"] = cfg.get("mail_from") or cfg.get("smtp_user") or "sailscore@localhost"
    msg["To"] = email
    msg.set_content(
        "You asked to receive published SailScore results by email.\n\n"
        f"Subscription: {target.get('target_name', 'results')}\n\n"
        f"Confirm Subscription: {links['verify']}\n\n"
        "This link expires in 60 minutes. If you did not request this, ignore this email."
    )
    msg.add_alternative(
        f"<p>You asked to receive published SailScore results by email.</p>"
        f"<p><strong>Subscription:</strong> {html_lib.escape(str(target.get('target_name', 'results')))}</p>"
        f"<p><a href=\"{html_lib.escape(links['verify'], quote=True)}\" style=\"background:#0a369d;color:white;padding:12px 18px;text-decoration:none;border-radius:6px\">Confirm Subscription</a></p>"
        "<p>This link expires in 60 minutes. If you did not request this, ignore this email.</p>",
        subtype="html")
    try:
        with smtplib.SMTP(cfg["smtp_host"], cfg["smtp_port"], timeout=15) as s:
            s.starttls()
            if cfg.get("smtp_user"):
                s.login(cfg["smtp_user"], cfg.get("smtp_password") or "")
            s.send_message(msg)
        return True
    except Exception as exc:
        logger.error("SUBSCRIPTION VERIFICATION EMAIL FAILED to=%s error=%s", email, exc)
        return False


@api_router.post("/subscriptions")
async def create_results_subscription(data: ResultsSubscriptionInput, request: Request):
    """Start or repeat an account-free subscription. The response is generic
    so an address cannot be used to enumerate existing subscriptions. In local
    development without SMTP, the verification token is returned solely to
    make the flow testable; production never returns it."""
    email = str(data.email).strip().lower()
    ip = _client_ip(request)
    if _subscription_rate_limited(email, ip):
        raise HTTPException(status_code=429, detail="Too many requests — please try again shortly")
    target = await _subscription_target(data.subscription_type, data.target_id)
    existing = await db.subscriptions.find_one({
        "email_hash": _subscription_token_hash(email), "subscription_type": data.subscription_type,
        "target_id": data.target_id, "active": True, "unsubscribed_at": None,
    }, {"_id": 0})
    if existing:
        return {"ok": True, "message": "If this subscription is not already active, check your email to confirm it."}
    unsubscribe_token = secrets.token_urlsafe(32)
    verify_token = secrets.token_urlsafe(32)
    existing_email = await db.subscriptions.find_one({"email_hash": _subscription_token_hash(email)}, {"_id": 0, "manage_token_enc": 1})
    manage_token = (_decrypt_secret(existing_email.get("manage_token_enc", ""))
                    if existing_email and existing_email.get("manage_token_enc") else None) or secrets.token_urlsafe(32)
    doc = {
        "id": new_id(), "email_hash": _subscription_token_hash(email),
        "email_enc": _encrypt_secret(email),
        "subscription_type": data.subscription_type, "target_id": data.target_id,
        "club_id": target["club_id"], "verification_token_hash": _subscription_token_hash(verify_token),
        "manage_token_hash": _subscription_token_hash(manage_token),
        "manage_token_enc": _encrypt_secret(manage_token),
        "unsubscribe_token_hash": _subscription_token_hash(unsubscribe_token),
        "unsubscribe_token_enc": _encrypt_secret(unsubscribe_token),
        "verification_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=SUBSCRIPTION_VERIFY_MINUTES)).isoformat(),
        "verified": False, "verified_at": None, "active": False,
        "created_at": now_iso(), "unsubscribed_at": None,
        "target_name": target.get("target_name"),
    }
    pending = await db.subscriptions.find_one({
        "email_hash": doc["email_hash"], "subscription_type": doc["subscription_type"],
        "target_id": doc["target_id"], "active": False,
        "verified": False, "unsubscribed_at": None,
    })
    if pending:
        # A repeated click before confirmation rotates the one-time verify token
        # on the same pending record without erasing an active/unsubscribed
        # history row.
        doc["id"] = pending["id"]
    await db.subscriptions.update_one(
        {"id": doc["id"]} if pending else {"email_hash": doc["email_hash"], "subscription_type": doc["subscription_type"], "target_id": doc["target_id"], "active": False, "verified": False, "unsubscribed_at": None},
        {"$set": doc}, upsert=True)
    links = _subscription_links(manage_token, verify_token, unsubscribe_token)
    sent = await _send_subscription_verification(email, links, target)
    await _log_audit(request=request, user=None, action="RESULTS_SUBSCRIPTION_REQUESTED",
                     description=f"Results subscription requested for {data.subscription_type} target {data.target_id}",
                     resource_type="subscription", resource_id=doc["id"], club_id=target["club_id"])
    response = {"ok": True, "message": "Check your email — we sent a confirmation link. Click Confirm Subscription to activate it."}
    if not sent and APP_ENV != "production":
        response["verification_token"] = verify_token
        response["manage_token"] = manage_token
        response["message"] = "SMTP is not configured in development. Use the returned verification token to confirm this subscription."
    return response


async def _activate_subscription(token: str) -> dict:
    sub = await db.subscriptions.find_one({"verification_token_hash": _subscription_token_hash(token), "active": False}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="This confirmation link is invalid or has already been used")
    try:
        expires = datetime.fromisoformat(sub.get("verification_expires_at", ""))
    except (TypeError, ValueError):
        expires = datetime.min.replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="This confirmation link has expired")
    verified_at = now_iso()
    result = await db.subscriptions.update_one({"id": sub["id"], "active": False}, {"$set": {
        "verified": True, "verified_at": verified_at, "active": True,
        "verification_token_hash": None, "verification_expires_at": None,
    }})
    if result.modified_count == 0:
        raise HTTPException(status_code=409, detail="This confirmation link has already been used")
    return await db.subscriptions.find_one({"id": sub["id"]}, {"_id": 0})


@api_router.get("/subscriptions/verify")
async def verify_results_subscription(token: str):
    sub = await _activate_subscription(token)
    await _log_audit(request=None, user=None, action="RESULTS_SUBSCRIPTION_VERIFIED",
                     description=f"Verified {sub.get('subscription_type')} subscription", resource_type="subscription", resource_id=sub["id"], club_id=sub.get("club_id"))
    return HTMLResponse("<main style='font-family:system-ui;max-width:560px;margin:12vh auto;padding:24px;text-align:center'><h1>Subscription confirmed ✓</h1><p>You'll now receive published results by email.</p><a href='" + html_lib.escape(_public_web_base()) + "'>Return to SailScore</a></main>")


def _subscription_public(sub: dict) -> dict:
    return {"id": sub["id"], "subscription_type": sub.get("subscription_type"),
            "target_id": sub.get("target_id"), "target_name": sub.get("target_name"),
            "club_id": sub.get("club_id"), "verified_at": sub.get("verified_at"),
            "created_at": sub.get("created_at")}


@api_router.get("/subscriptions/manage")
async def manage_results_subscriptions(token: str):
    token_hash = _subscription_token_hash(token)
    subs = await db.subscriptions.find({"manage_token_hash": token_hash, "active": True}, {"_id": 0}).sort("created_at", -1).to_list(SUBSCRIPTION_MAX_EMAIL_ROWS)
    return {"subscriptions": [_subscription_public(s) for s in subs], "token_valid": bool(subs)}


async def _unsubscribe_one_by_token(token: str, request: Request):
    token_hash = _subscription_token_hash(token)
    sub = await db.subscriptions.find_one({"unsubscribe_token_hash": token_hash, "active": True}, {"_id": 0})
    # Backward-compatible handling for rows created during the first draft of
    # this feature: their manage token was also the one-click token.
    if not sub:
        sub = await db.subscriptions.find_one({"manage_token_hash": token_hash, "active": True}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription link not found or already unsubscribed")
    result = await db.subscriptions.update_one({"id": sub["id"], "active": True}, {"$set": {"active": False, "unsubscribed_at": now_iso()}})
    if result.modified_count:
        await _log_audit(request=request, user=None, action="RESULTS_SUBSCRIPTION_UNSUBSCRIBED", description="Removed one results subscription", resource_type="subscription", resource_id=sub["id"], club_id=sub.get("club_id"))
    return sub


@api_router.get("/subscriptions/unsubscribe")
async def unsubscribe_results_link(token: str, request: Request):
    """One-click browser unsubscribe from the specific subscription represented
    by the secure manage token in an email."""
    sub = await _unsubscribe_one_by_token(token, request)
    return HTMLResponse("<main style='font-family:system-ui;max-width:560px;margin:12vh auto;padding:24px;text-align:center'><h1>You have been unsubscribed from these results emails.</h1><p>Other subscriptions for this email address remain active.</p><a href='" + html_lib.escape(_public_web_base() + "/subscriptions/manage?token=" + token, quote=True) + "'>Manage my subscriptions</a></main>")


@api_router.post("/subscriptions/unsubscribe")
async def unsubscribe_results(data: SubscriptionTokenInput, request: Request):
    await _unsubscribe_one_by_token(data.token, request)
    return {"ok": True, "message": "You have been unsubscribed from these results emails."}


@api_router.post("/subscriptions/unsubscribe-all")
async def unsubscribe_all_results(data: SubscriptionTokenInput, request: Request):
    token_hash = _subscription_token_hash(data.token)
    subs = await db.subscriptions.find({"manage_token_hash": token_hash, "active": True}, {"_id": 0, "id": 1, "club_id": 1}).to_list(SUBSCRIPTION_MAX_EMAIL_ROWS)
    if not subs:
        raise HTTPException(status_code=404, detail="Subscription link not found or already unsubscribed")
    ids = [s["id"] for s in subs]
    await db.subscriptions.update_many({"id": {"$in": ids}, "active": True}, {"$set": {"active": False, "unsubscribed_at": now_iso()}})
    await _log_audit(request=request, user=None, action="RESULTS_SUBSCRIPTION_UNSUBSCRIBED_ALL", description="Removed all results subscriptions", resource_type="subscription", resource_id=ids[0], club_id=subs[0].get("club_id"))
    return {"ok": True, "message": "You have been unsubscribed from all Sailscore results emails."}


@api_router.delete("/subscriptions/{subscription_id}")
async def delete_results_subscription(subscription_id: str, token: str, request: Request):
    token_hash = _subscription_token_hash(token)
    sub = await db.subscriptions.find_one({"id": subscription_id, "manage_token_hash": token_hash, "active": True}, {"_id": 0})
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    await db.subscriptions.update_one({"id": subscription_id, "active": True}, {"$set": {"active": False, "unsubscribed_at": now_iso()}})
    await _log_audit(request=request, user=None, action="RESULTS_SUBSCRIPTION_REMOVED", description="Removed one results subscription", resource_type="subscription", resource_id=subscription_id, club_id=sub.get("club_id"))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Results notification rendering and delivery
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Official Notice Board (ONB)
# ---------------------------------------------------------------------------
# One notice entity serves BOTH publication methods: notices drafted with
# Sailscore structured fields ("generated") and existing documents uploaded
# by the club ("uploaded"). Uploaded files are stored byte-for-byte as the
# authoritative document — never OCR'd, rewritten or reformatted (spec 48) —
# and carry the same metadata, versioning, audit trail and public presentation
# as generated notices, so the public ONB never needs to care which method
# produced a notice (spec 39).

# Canonical notice types. `heading` is the ONB section the type files under
# (spec 43 — the default structure is automatic). Each field spec drives the
# dynamic creation form: only the relevant fields exist for the selected type
# (spec 34), and `placeholder` is greyed-out sailing-specific guidance that is
# never stored with the notice and never published (spec 35).
def _nf(key, label, kind="text", placeholder="", required=False):
    """One dynamic-form field spec. `kind` selects the input widget; the
    series/race/class kinds are Sailscore selects whose value is an entity id
    (auto-populated from existing data per spec 46, validated server-side)."""
    return {"key": key, "label": label, "kind": kind,
            "placeholder": placeholder, "required": bool(required)}


NOTICE_TYPES = [
    {
        "key": "notice_to_competitors",
        "label": "Notice to Competitors",
        "heading": "Notices to Competitors",
        "description": "General instructions or information for racing competitors.",
        "fields": [
            _nf("series_id", "Event / Series", "series"),
            _nf("class_id", "Class / Fleet", "class"),
            _nf("date", "Date", "date"),
            _nf("time", "Time", "time"),
            _nf("subject", "Subject", "text", "Example: Change of race area for today's racing", True),
            _nf("reason", "Reason for notice", "textarea",
                "Example: The wind has shifted 40 degrees, so the race committee has moved the starting area east of Knot Point."),
            _nf("instruction", "Change / instruction", "textarea",
                "Example: Race 4 will start at 14:30 instead of 14:00. Boats must keep clear of the shipping channel until their warning signal.", True),
            _nf("effective_from", "Effective from", "text",
                "Example: Immediately, until further notice"),
            _nf("additional_info", "Additional information", "textarea",
                "Example: The committee vessel will fly flag L when the new race area is open."),
            _nf("issued_by", "Race Officer / Race Committee", "text",
                "Example: J Smith, Race Officer"),
        ],
    },
    {
        "key": "si_amendment",
        "label": "Change to Sailing Instructions",
        "heading": "Sailing Instructions / Amendments",
        "description": "Amend an instruction in the published sailing instructions.",
        "fields": [
            _nf("series_id", "Event / Series", "series"),
            _nf("class_id", "Class / Fleet", "class"),
            _nf("si_number", "SI number being changed", "text", "Example: SI 8.2", True),
            _nf("instruction_number", "Existing instruction number", "text",
                "Example: 8.2 as published on 1 May 2026"),
            _nf("existing_wording", "Existing wording", "textarea",
                "Example: The starting line will be between the staff boat flying an orange flag and the outer distance mark."),
            _nf("new_wording", "New wording", "textarea",
                "Example: SI 8.2 is amended to read: The starting line will be between the orange flag on the committee vessel and the port-end mark.", True),
            _nf("reason", "Reason for change", "textarea",
                "Example: To keep the start clear of the dredger working north of the moorings."),
            _nf("effective_at", "Effective date/time", "text",
                "Example: From 09:00 on Saturday 29 August"),
            _nf("race_event_affected", "Race / event affected", "text",
                "Example: Summer Series — all remaining races"),
            _nf("issued_by", "Issued by", "text",
                "Example: Race Committee, Medway Yacht Club"),
        ],
    },
    {
        "key": "race_postponement",
        "label": "Race Postponement",
        "heading": "Race Notices",
        "description": "Postpone a race already scheduled or under way.",
        "fields": [
            _nf("series_id", "Event / Series", "series"),
            _nf("class_id", "Class / Fleet", "class"),
            _nf("original_start_time", "Original start time", "time", "Example: 14:00"),
            _nf("new_start_time", "New start time", "time", "Example: 15:30"),
            _nf("reason", "Reason for postponement", "textarea",
                "Example: Strong winds are forecast for the scheduled start time.", True),
            _nf("new_warning_signal", "New warning signal", "time", "Example: 15:00"),
            _nf("new_starting_sequence", "New starting sequence", "text",
                "Example: Warning signal 15:00, starts from 15:05 — one minute between fleets"),
            _nf("additional_instructions", "Additional instructions", "textarea",
                "Example: Flag AP over A means racing is abandoned for the day — listen on VHF channel 37."),
            _nf("issued_by", "Race Officer / Race Committee", "text",
                "Example: J Smith, Race Officer"),
        ],
    },
    {
        "key": "race_cancellation",
        "label": "Race Cancellation",
        "heading": "Race Notices",
        "description": "Cancel a scheduled race entirely.",
        "fields": [
            _nf("series_id", "Event / Series", "series"),
            _nf("class_id", "Class / Fleet", "class"),
            _nf("scheduled_date", "Scheduled date", "date"),
            _nf("scheduled_time", "Scheduled time", "time"),
            _nf("reason", "Reason for cancellation", "textarea",
                "Example: The waterway is closed to racing by the harbour authority for dredging.", True),
            _nf("further_information", "Further information", "textarea",
                "Example: A rescheduled date will be published on the Official Notice Board."),
            _nf("issued_by", "Race Officer / Race Committee", "text",
                "Example: J Smith, Race Officer"),
        ],
    },
    {
        "key": "hearing_schedule",
        "label": "Hearing Schedule",
        "heading": "Protests & Hearings",
        "description": "Schedule a protest hearing and notify the parties.",
        "fields": [
            _nf("hearing_number", "Hearing / protest number", "text",
                "Example: Protest No. 3 — 'Wild Rose' v 'Blue Peter'", True),
            _nf("hearing_date", "Hearing date", "date"),
            _nf("hearing_time", "Hearing time", "time", "Example: 18:30"),
            _nf("location", "Location", "text", "Example: Clubhouse — committee room"),
            _nf("parties", "Parties", "text",
                "Example: Protestor: GBR 4502 Wild Rose. Protestee: GBR 112 Blue Peter."),
            _nf("series_id", "Event / Series", "series"),
            _nf("class_id", "Class / Fleet", "class"),
            _nf("additional_info", "Additional information", "textarea",
                "Example: Parties may bring witnesses and a representative; inform the race office if unable to attend."),
        ],
    },
    {
        "key": "hearing_decision",
        "label": "Hearing Decision",
        "heading": "Protests & Hearings",
        "description": "Publish the outcome of a protest hearing.",
        "fields": [
            _nf("hearing_number", "Hearing / protest number", "text",
                "Example: Protest No. 3 — 'Wild Rose' v 'Blue Peter'", True),
            _nf("decision_date", "Decision date", "date"),
            _nf("parties", "Parties", "text",
                "Example: Protestor: GBR 4502 Wild Rose. Protestee: GBR 112 Blue Peter."),
            _nf("series_id", "Event / Series", "series"),
            _nf("class_id", "Class / Fleet", "class"),
            _nf("facts_summary", "Summary of facts", "textarea",
                "Example: Boat A tacked within two lengths of Boat B's bow; Boat B luffed and made contact."),
            _nf("decision", "Decision", "textarea",
                "Example: Protest upheld. GBR 112 is disqualified (DSQ) for breaking rule 16.1.", True),
            _nf("additional_info", "Additional information", "textarea",
                "Example: Redress requests arising from this incident must reach the race office by 18:00 tomorrow."),
        ],
    },
    {
        "key": "results_notice",
        "label": "Results Notice",
        "heading": "Results",
        "description": "Publish or correct a results statement.",
        "fields": [
            _nf("series_id", "Event / Series", "series"),
            _nf("class_id", "Class / Fleet", "class"),
            _nf("results_status", "Results status", "text",
                "Example: Provisional results for Race 8 are now published", True),
            _nf("date", "Date", "date"),
            _nf("results_link", "Link / reference to results", "text",
                "Example: Results page — Summer Series, Race 8"),
            _nf("additional_info", "Additional information", "textarea",
                "Example: Corrections must reach the race officer before 17:00 on 30 August."),
        ],
    },
    {
        "key": "safety_notice",
        "label": "Safety Notice",
        "heading": "Safety",
        "description": "Warn of a hazard or issue a safety instruction.",
        "fields": [
            _nf("date", "Date", "date"),
            _nf("time", "Time", "time"),
            _nf("area", "Area / location", "text",
                "Example: East of the moorings, between buoys 4 and 6"),
            _nf("hazard", "Hazard", "textarea",
                "Example: A partially submerged pontoon has broken from its mooring near the harbour entrance.", True),
            _nf("instruction", "Safety instruction", "textarea",
                "Example: Keep 50 m clear and pass at slow speed, monitoring VHF channel 16.", True),
            _nf("effective_from", "Effective from", "text",
                "Example: Until the pontoon is recovered"),
            _nf("issued_by", "Issued by", "text",
                "Example: Hon. Sailing Secretary"),
        ],
    },
    {
        "key": "general_club_notice",
        "label": "General Club Notice",
        "heading": "General Notices",
        "description": "Any other club notice relevant to the Official Notice Board.",
        "fields": [
            _nf("date", "Date", "date"),
            _nf("body", "Notice content", "textarea",
                "Example: The clubhouse bar will be closed on Monday 31 August for maintenance. Sailing is unaffected.", True),
            _nf("issued_by", "Issued by", "text",
                "Example: Sailing Secretary"),
        ],
    },
]

NOTICE_TYPES_BY_KEY = {t["key"]: t for t in NOTICE_TYPES}
# Canonical ONB heading order (public display groups notices by heading in
# this order; headings not in the list sort last alphabetically).
NOTICE_HEADING_ORDER = []
for _t in NOTICE_TYPES:
    if _t["heading"] not in NOTICE_HEADING_ORDER:
        NOTICE_HEADING_ORDER.append(_t["heading"])

# Upload limits. The document IS the notice content for uploads — it is never
# modified (spec 48) — and everything is stored inline on the notice doc, so
# the caps keep a notice comfortably inside MongoDB's 16 MB document limit
# even after base64 encoding.
NOTICE_DOC_MAX = 10 * 1024 * 1024          # uploaded main document (raw bytes)
NOTICE_ATTACHMENT_MAX = 5 * 1024 * 1024    # per supporting attachment
NOTICE_ATTACHMENTS_MAX = 4                 # attachments per notice
NOTICE_PDF_MAX = 10 * 1024 * 1024          # Sailscore-generated PDF at publish
# Total encoded budget for one notice document (main file + attachments + PDF).
NOTICE_ENCODED_BUDGET = 14 * 1024 * 1024


def _notice_type_or_400(key: str) -> dict:
    tdef = NOTICE_TYPES_BY_KEY.get((key or "").strip())
    if not tdef:
        raise HTTPException(status_code=400, detail="Unknown notice type")
    return tdef


def _detect_notice_doc_type(data: bytes) -> Optional[str]:
    """MIME type of an uploaded notice document from magic bytes only. PDFs
    are the typical official document, but photos of signed notices (PNG/
    JPEG/WebP) and course diagrams are legitimate too. Everything else —
    Office files, HTML, executables — is rejected."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    return _detect_image_type(data)


def _valid_notice_datetime(value: Optional[str], label: str) -> Optional[str]:
    """Validate a datetime-local / ISO string for metadata fields. Returns the
    normalised ISO string, or None when nothing was supplied."""
    v = (value or "").strip()
    if not v:
        return None
    try:
        return datetime.fromisoformat(v).isoformat()
    except (TypeError, ValueError):
        raise HTTPException(status_code=400,
                            detail=f"{label} must be a valid date and time")


async def _validate_notice_links(club_id: str, race_id=None, series_id=None, class_id=None) -> dict:
    """Validate Sailscore entity links (race / series / class) for a notice and
    denormalise their display names onto the notice. Every link must belong to
    the notice's club, and the links must be mutually consistent (a race must
    belong to its series' class). Populates event/series/race/class names so
    the public ONB renders without extra lookups (spec 39)."""
    out = {"series_id": None, "series_name": None, "event_name": None,
           "race_id": None, "race_number": None, "race_date": None,
           "class_id": None, "class_name": None}

    async def _class_name(cid):
        cls = await db.classes.find_one({"id": cid}, {"_id": 0, "name": 1})
        return cls.get("name") if cls else None

    if class_id:
        cls = await db.classes.find_one({"id": class_id}, {"_id": 0, "name": 1, "club_id": 1})
        if not cls or cls.get("club_id") != club_id:
            raise HTTPException(status_code=400, detail="Class not found in this club")
        out["class_id"], out["class_name"] = class_id, cls.get("name")
    if series_id:
        s = await db.series.find_one({"id": series_id}, {"_id": 0})
        s_club = await _class_club_id(s.get("class_id")) if s else None
        if not s or s_club != club_id:
            raise HTTPException(status_code=400, detail="Series not found in this club")
        if out["class_id"] and s.get("class_id") != out["class_id"]:
            raise HTTPException(status_code=400, detail="Series does not belong to the selected class")
        out["series_id"] = s["id"]
        out["series_name"] = s.get("name")
        out["event_name"] = s.get("name")
        if not out["class_id"]:
            out["class_id"] = s.get("class_id")
            out["class_name"] = await _class_name(s.get("class_id"))
    if race_id:
        r = await db.races.find_one({"id": race_id}, {"_id": 0})
        if not r:
            raise HTTPException(status_code=400, detail="Race not found in this club")
        r_club = await _class_club_id(r.get("class_id"))
        if r_club != club_id:
            raise HTTPException(status_code=400, detail="Race not found in this club")
        if out["series_id"] and r.get("series_id") != out["series_id"]:
            raise HTTPException(status_code=400, detail="Race does not belong to the selected series")
        out["race_id"] = r["id"]
        out["race_number"] = r.get("race_number")
        out["race_date"] = r.get("date")
        if not out["series_id"]:
            out["series_id"] = r.get("series_id")
            sr = await db.series.find_one({"id": r.get("series_id")}, {"_id": 0, "name": 1})
            out["series_name"] = out["event_name"] = (sr or {}).get("name")
        if not out["class_id"]:
            out["class_id"] = r.get("class_id")
            out["class_name"] = await _class_name(r.get("class_id"))
    return out


def _clean_notice_fields(tdef: dict, fields: Optional[dict], *, partial=False) -> dict:
    """Accept only catalogue-known keys for the selected type (spec 34: no
    field leakage across types), coerce values to trimmed strings capped at
    2000 chars, and drop empties. `partial` (edit) keeps previously stored
    values for keys absent from the payload. Required-field enforcement is
    catalogue-driven; link-kind keys (series/race/class ids) are handled by
    _validate_notice_links, never stored here."""
    allowed = {f["key"]: f for f in tdef["fields"]}
    cleaned = {} if not partial else {
        k: v for k, v in (fields or {}).items() if k in allowed
    }
    for key, val in (fields or {}).items():
        fdef = allowed.get(key)
        if not fdef:
            raise HTTPException(status_code=400,
                                detail=f"'{key}' is not a field of a {tdef['label']}")
        if fdef["kind"] in ("series", "race", "class"):
            continue  # validated as club links, not stored in fields
        sval = str(val if val is not None else "").strip()[:2000]
        if sval:
            cleaned[key] = sval
        else:
            cleaned.pop(key, None)
    if not partial:
        missing = [f["label"] for f in tdef["fields"]
                   if f["required"] and f["kind"] not in ("series", "race", "class")
                   and not cleaned.get(f["key"])]
        if missing:
            raise HTTPException(status_code=400,
                                detail="Missing required field(s): " + ", ".join(missing))
    return cleaned


def _notice_body(tdef: dict, fields: dict) -> List[dict]:
    """The rendered label/value rows for the public HTML notice (spec 41),
    computed server-side in catalogue order so the ONB needs no type
    catalogue. Placeholders are never here: only stored values are."""
    rows = []
    for f in tdef["fields"]:
        if f["kind"] in ("series", "race", "class"):
            continue
        v = (fields or {}).get(f["key"])
        if v:
            rows.append({"label": f["label"], "value": v})
    return rows


async def _next_notice_number(club_id: str, type_key: str) -> int:
    """Next notice number for a club + type (notice numbers are per type, so
    'Notice to Competitors No. 4' and 'Amendment No. 4' can co-exist)."""
    agg = await db.notices.find_one(
        {"club_id": club_id, "notice_type": type_key},
        sort=[("notice_number", -1)], projection={"notice_number": 1})
    return int((agg or {}).get("notice_number") or 0) + 1


def _notice_history_entry(user: dict, action: str, note: str = "") -> dict:
    return {"action": action, "at": now_iso(), "by": (user or {}).get("username"),
            "by_id": (user or {}).get("user_id"), "note": note}


def _encoded_notice_size(doc: dict) -> int:
    """Approximate stored size of the notice (base64 payloads + fields) so an
    upload that would blow MongoDB's document cap is rejected up front."""
    total = len((doc.get("pdf_data_url") or ""))
    total += len((doc.get("file_data_url") or ""))
    for a in doc.get("attachments") or []:
        total += len(a.get("data_url") or "")
    return total


def _notice_summary(doc: dict) -> dict:
    """List-view shape: everything the ONB cards and the management list need,
    WITHOUT the heavy base64 payloads (file/PDF/attachment contents). Those
    are fetched per notice via GET /notices/{id} on demand."""
    return {k: doc.get(k) for k in (
        "id", "club_id", "notice_type", "notice_type_label", "heading",
        "publication_area", "title", "notice_number", "content_type", "status", "version",
        "root_id", "supersedes_id", "superseded_by", "published_at",
        "published_by", "effective_at", "publication_datetime",
        "created_at", "created_by", "modified_at", "modified_by",
        "event_name", "series_name", "race_number", "race_date",
        "class_name", "public_path", "board_id", "section_id", "has_file", "has_pdf",
        "attachments", "withdrawn_at", "withdrawn_by", "withdrawal_reason",
        # Render rows + structured fields (small): the public ONB renders the
        # HTML notice straight from the list response (spec 41).
        "fields", "body",
        # Sailscore links + uploaded-document facts (hash/size never change on
        # edits — the club can always demonstrate which document was issued).
        "series_id", "race_id", "class_id", "club_name",
        "original_filename", "file_type", "file_size", "file_hash",
        "created_by_id",
    )} | {
        # attachments without their data URLs
        "attachments": [
            {k: a.get(k) for k in ("id", "name", "file_type", "file_size", "file_hash")}
            for a in doc.get("attachments") or []
        ],
    }


async def _notice_of_club(notice_id: str, user: dict) -> dict:
    notice = await db.notices.find_one({"id": notice_id}, {"_id": 0})
    if not notice:
        raise HTTPException(status_code=404, detail="Notice not found")
    _ensure_club(user, notice.get("club_id"))
    return notice


class NoticeBoardInput(BaseModel):
    club_id: str
    title: str = "Official Notice Board"
    slug: Optional[str] = None
    status: Literal["active", "hidden"] = "active"


class NoticeSectionInput(BaseModel):
    board_id: str
    section_type: str = "general"
    title: str
    class_id: Optional[str] = None
    series_id: Optional[str] = None
    year: Optional[int] = None
    order: int = 0
    status: Literal["active", "hidden"] = "active"


class NoticeCreateInput(BaseModel):
    """A Sailscore-GENERATED notice: structured fields for the selected type.
    Uploaded notices go through POST /notices/upload (multipart)."""
    notice_type: str
    # Where the notice is published within the club ONB.
    publication_area: str = "club"
    title: str
    fields: dict = {}
    notice_number: Optional[int] = Field(None, ge=1, le=9999)
    effective_datetime: Optional[str] = None
    # Webmaster-only: create on behalf of a club. Staff are always pinned to
    # their own club regardless of this value.
    club_id: Optional[str] = None
    expected_version: Optional[int] = None


class NoticeUpdateInput(BaseModel):
    """Edit a DRAFT notice. Published notices are immutable — amendments
    create a new version (POST /notices/{id}/new-version, spec 49). Uploaded
    documents are never editable here; a corrected document is attached to a
    new version (PUT /notices/{id}/file)."""
    publication_area: Optional[str] = None
    title: Optional[str] = None
    fields: Optional[dict] = None
    notice_number: Optional[int] = Field(None, ge=1, le=9999)
    effective_datetime: Optional[str] = None
    expected_version: Optional[int] = None


class NoticePublishInput(BaseModel):
    """Publish a draft. Generated notices carry the client-rendered PDF
    (data URL) built from the same structured fields; uploaded notices have
    no pdf (their uploaded document is the formal version)."""
    pdf_data_url: Optional[str] = None
    expected_version: Optional[int] = None


class NoticeWithdrawInput(BaseModel):
    reason: str
    expected_version: Optional[int] = None


@api_router.get("/notice-boards")
async def list_notice_boards(request: Request, club_id: Optional[str] = None):
    scope = await _resolve_club_id(request, club_id)
    if not scope:
        raise HTTPException(status_code=400, detail="club_id is required")
    club = await db.clubs.find_one({"id": scope}, {"_id": 0, "official_notice_board": 1})
    if club and club.get("official_notice_board") is False:
        return []
    return await db.notice_boards.find({"club_id": scope, "status": "active"}, {"_id": 0}).sort("title", 1).to_list(100)


@api_router.post("/notice-boards")
async def create_notice_board(data: NoticeBoardInput, request: Request,
                              user: dict = Depends(require_officer)):
    _ensure_club(user, data.club_id)
    slug = data.slug or re.sub(r"[^a-z0-9]+", "-", data.title.lower()).strip("-")
    doc = {"id": new_id(), "club_id": data.club_id, "title": data.title.strip() or "Official Notice Board", "slug": slug, "status": data.status, "created_at": now_iso(), "created_by": user.get("username")}
    await db.notice_boards.insert_one(doc)
    await _log_audit(request=request, user=user, action="NOTICE_BOARD_CREATED", description=f"Created notice board '{doc['title']}'", resource_type="notice_board", resource_id=doc["id"], club_id=data.club_id)
    doc.pop("_id", None)
    return doc


@api_router.get("/notice-boards/{board_id}/sections")
async def list_notice_sections(board_id: str, request: Request):
    board = await db.notice_boards.find_one({"id": board_id, "status": "active"}, {"_id": 0})
    if not board:
        raise HTTPException(status_code=404, detail="Notice board not found")
    club = await db.clubs.find_one({"id": board.get("club_id")}, {"_id": 0, "official_notice_board": 1})
    if club and club.get("official_notice_board") is False:
        return []
    return await db.notice_sections.find({"board_id": board_id, "status": "active"}, {"_id": 0}).sort([("order", 1), ("title", 1)]).to_list(200)


@api_router.post("/notice-boards/{board_id}/sections")
async def create_notice_section(board_id: str, data: NoticeSectionInput, request: Request,
                                user: dict = Depends(require_officer)):
    board = await db.notice_boards.find_one({"id": board_id, "status": "active"}, {"_id": 0})
    if not board or data.board_id != board_id:
        raise HTTPException(status_code=404, detail="Notice board not found")
    _ensure_club(user, board.get("club_id"))
    doc = data.model_dump(); doc.update({"id": new_id(), "board_id": board_id, "created_at": now_iso(), "created_by": user.get("username")})
    await db.notice_sections.insert_one(doc)
    doc.pop("_id", None)
    return doc


class NoticeAreaInput(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)


@api_router.post("/clubs/{club_id}/notice-areas")
async def add_notice_area(club_id: str, data: NoticeAreaInput, request: Request,
                          user: dict = Depends(require_officer)):
    _ensure_club(user, club_id)
    title = data.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Area name is required")
    reserved = {"club notices", "open event notices"}
    if title.lower() in reserved:
        raise HTTPException(status_code=409, detail="That notice area already exists")
    club = await db.clubs.find_one({"id": club_id}, {"_id": 0, "notice_areas": 1})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    areas = list(club.get("notice_areas") or [])
    if any(existing.strip().lower() == title.lower() for existing in areas):
        raise HTTPException(status_code=409, detail="That notice area already exists")
    areas.append(title)
    await db.clubs.update_one({"id": club_id}, {"$set": {"notice_areas": areas}})
    await _log_audit(request=request, user=user, action="NOTICE_AREA_CREATED",
                     description=f"Created ONB notice area '{title}'", resource_type="club",
                     resource_id=club_id, club_id=club_id)
    return {"key": "custom:" + re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"), "title": title}


@api_router.get("/notice-areas")
async def list_notice_areas(request: Request, club_id: Optional[str] = None):
    scope = await _resolve_club_id(request, club_id)
    if not scope:
        raise HTTPException(status_code=400, detail="club_id is required")
    club = await db.clubs.find_one({"id": scope}, {"_id": 0, "notice_areas": 1})
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    return [{"key": "club", "title": "Club Notices"},
            {"key": "open_event", "title": "Open Event Notices"}] + [
                {"key": "custom:" + re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"), "title": title}
                for title in (club.get("notice_areas") or [])
            ]


@api_router.get("/notices/meta")
async def notices_meta(user: dict = Depends(require_officer)):
    """The notice type catalogue for the creation wizard: labels, ONB headings
    and the per-type dynamic field specs (with their greyed-out placeholder
    guidance, which only ever lives here — never on stored notices)."""
    return {
        "types": NOTICE_TYPES,
        "headings": NOTICE_HEADING_ORDER,
        "limits": {
            "document_max": NOTICE_DOC_MAX,
            "attachment_max": NOTICE_ATTACHMENT_MAX,
            "attachments_max": NOTICE_ATTACHMENTS_MAX,
        },
    }


@api_router.get("/notices")
async def list_notices(request: Request, club_id: Optional[str] = None,
                       status: Optional[str] = None, notice_type: Optional[str] = None,
                       race_id: Optional[str] = None, root_id: Optional[str] = None,
                       publication_area: Optional[str] = None,
                       limit: int = 200):
    """Public ONB: only published (and withdrawn, marked as such) notices for a
    club, the latest version of each notice — superseded versions are never
    listed. Signed-in staff of the club (or the webmaster) additionally see
    drafts and can filter by status / root, for the management views."""
    user = await get_current_user(request)
    scope = await _resolve_club_id(request, club_id)
    club_settings = await db.clubs.find_one({"id": scope}, {"_id": 0, "official_notice_board": 1}) if scope else None
    onb_enabled = not club_settings or club_settings.get("official_notice_board") is not False
    if not scope:
        raise HTTPException(status_code=400, detail="club_id is required")
    staff_view = bool(user) and (user.get("role") == "webmaster" or user.get("club_id") == scope)
    if not onb_enabled and not staff_view:
        return []
    limit = max(1, min(int(limit), 500))

    q = {"club_id": scope}
    if request.query_params.get("publication_area"):
        q["publication_area"] = request.query_params.get("publication_area")
    if request.query_params.get("section_id"):
        q["section_id"] = request.query_params.get("section_id")
    if request.query_params.get("board_id"):
        q["board_id"] = request.query_params.get("board_id")
    if notice_type:
        q["notice_type"] = notice_type
    if publication_area:
        q["publication_area"] = publication_area
    if race_id:
        q["race_id"] = race_id
    if root_id and staff_view:
        q["root_id"] = root_id
    if staff_view:
        if status:
            if status not in ("draft", "published", "superseded", "withdrawn", "all"):
                raise HTTPException(status_code=400, detail="Unknown status filter")
            if status != "all":
                q["status"] = status
    else:
        q["status"] = {"$in": ["published", "withdrawn"]}

    docs = await db.notices.find(q, {"_id": 0}) \
        .sort("created_at", 1).to_list(limit)
    if staff_view:
        return [_notice_summary(d) for d in docs]
    # Public: keep only the latest version of each notice (root) — an amended
    # notice shows its current version, with superseded ones available by
    # direct link for the audit trail only.
    latest = {}
    for d in docs:
        root = d.get("root_id") or d["id"]
        if root not in latest or int(d.get("version") or 1) > int(latest[root].get("version") or 1):
            latest[root] = d
    out = [d for d in latest.values() if d["status"] in ("published", "withdrawn")]
    out.sort(key=lambda d: (d.get("published_at") or d.get("created_at") or ""))
    return [_notice_summary(d) for d in out]


@api_router.get("/notices/context")
async def notice_context(request: Request, race_id: Optional[str] = None,
                         series_id: Optional[str] = None,
                         user: dict = Depends(require_officer)):
    """Everything the wizard needs to pre-fill a notice from existing Sailscore
    data (spec 46): club, event/series, race number/date/time and class for a
    race (or series), plus the officer's name for the issuing-authority field."""
    if not race_id and not series_id:
        raise HTTPException(status_code=400, detail="race_id or series_id is required")
    if race_id:
        race = await db.races.find_one({"id": race_id}, {"_id": 0})
        if not race:
            raise HTTPException(status_code=404, detail="Race not found")
        club_id = await _class_club_id(race.get("class_id"))
        _ensure_club(user, club_id)
        series = await db.series.find_one({"id": race.get("series_id")}, {"_id": 0, "name": 1})
        cls = await db.classes.find_one({"id": race.get("class_id")}, {"_id": 0, "name": 1})
        club = await db.clubs.find_one({"id": club_id}, {"_id": 0, "name": 1, "slug": 1})
        return {
            "club_id": club_id, "club_name": (club or {}).get("name"),
            "class_id": race.get("class_id"), "class_name": (cls or {}).get("name"),
            "series_id": race.get("series_id"), "series_name": (series or {}).get("name"),
            "event_name": (series or {}).get("name"),
            "race_id": race["id"], "race_number": race.get("race_number"),
            "race_date": race.get("date"), "start_time": race.get("start_time"),
            "officer_name": user.get("name") or user.get("username"),
        }
    series = await db.series.find_one({"id": series_id}, {"_id": 0})
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    club_id = await _class_club_id(series.get("class_id"))
    _ensure_club(user, club_id)
    cls = await db.classes.find_one({"id": series.get("class_id")}, {"_id": 0, "name": 1})
    club = await db.clubs.find_one({"id": club_id}, {"_id": 0, "name": 1, "slug": 1})
    return {
        "club_id": club_id, "club_name": (club or {}).get("name"),
        "class_id": series.get("class_id"), "class_name": (cls or {}).get("name"),
        "series_id": series["id"], "series_name": series.get("name"),
        "event_name": series.get("name"),
        "race_id": None, "race_number": None, "race_date": None, "start_time": None,
        "officer_name": user.get("name") or user.get("username"),
    }


@api_router.get("/notices/next-number")
async def next_notice_number(request: Request, notice_type: str,
                             club_id: Optional[str] = None,
                             user: dict = Depends(require_officer)):
    """The next free notice number for a club + type — pre-filled in the wizard
    so officers never have to track numbering themselves."""
    _notice_type_or_400(notice_type)
    scope = await _resolve_club_id(request, club_id)
    if not scope:
        raise HTTPException(status_code=400, detail="club_id is required")
    _ensure_club(user, scope)
    return {"next": await _next_notice_number(scope, notice_type)}


@api_router.post("/notices")
async def create_notice(data: NoticeCreateInput, user: dict = Depends(require_officer)):
    """Create a DRAFT notice generated from Sailscore structured fields
    (Option 1). Nothing is public until POST /notices/{id}/publish."""
    tdef = _notice_type_or_400(data.notice_type)
    club_id = data.club_id if (user.get("role") == "webmaster" and data.club_id) else user.get("club_id")
    if not club_id:
        raise HTTPException(status_code=400, detail="club_id is required")
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    fields_in = data.fields or {}
    links = await _validate_notice_links(
        club_id,
        fields_in.get("race_id"), fields_in.get("series_id"), fields_in.get("class_id"))
    # Keep the link values out of the sanitised field dict (they are stored as
    # denormalised columns) but tolerate their presence in the payload.
    fields_in = {k: v for k, v in fields_in.items()
                 if k not in ("series_id", "race_id", "class_id")}
    fields = _clean_notice_fields(tdef, fields_in)
    effective = _valid_notice_datetime(data.effective_datetime, "Effective date/time")
    club = await db.clubs.find_one({"id": club_id}, {"_id": 0, "name": 1, "slug": 1})

    notice_id = new_id()
    doc = {
        "id": notice_id, "club_id": club_id,
        "notice_type": tdef["key"], "notice_type_label": tdef["label"],
        "heading": data.publication_area, "publication_area": data.publication_area, "title": title,
        "notice_number": data.notice_number or await _next_notice_number(club_id, tdef["key"]),
        "content_type": "generated", "creation_method": "generated",
        "status": "draft", "version": 1, "root_id": notice_id,
        "supersedes_id": None, "superseded_by": None,
        "fields": fields, "body": _notice_body(tdef, fields),
        "published_at": None, "published_by": None,
        "effective_at": effective, "publication_datetime": None,
        "created_at": now_iso(), "created_by": user.get("username"),
        "created_by_id": user.get("user_id"),
        "modified_at": None, "modified_by": None,
        "withdrawn_at": None, "withdrawn_by": None, "withdrawal_reason": None,
        "club_name": (club or {}).get("name"),
        "public_path": f"/club/{(club or {}).get('slug')}#notice-{notice_id}",
        "pdf_data_url": None, "has_pdf": False,
        "file_data_url": None, "has_file": False,
        "original_filename": None, "file_type": None, "file_size": None, "file_hash": None,
        "attachments": [],
        "history": [_notice_history_entry(user, "created", "Generated with Sailscore")],
    }
    doc.update(links)
    for _ in range(5):
        try:
            await db.notices.insert_one(doc)
            break
        except DuplicateKeyError:
            # (club, type, notice_number) is unique — someone published a
            # number in between; take the next one.
            doc["notice_number"] = int(doc["notice_number"]) + 1
    else:
        raise HTTPException(status_code=400,
                            detail="Could not allocate a free notice number — try again")
    doc.pop("_id", None)
    await _log_audit(request=None, user=user, action="NOTICE_CREATED",
                     description=f"Created draft {tdef['label']} '{title}'",
                     resource_type="notice", resource_id=notice_id, club_id=club_id)
    return _notice_summary(doc)


@api_router.post("/notices/upload")
async def upload_notice(request: Request,
                        user: dict = Depends(require_officer),
                        notice_type: str = Form(...),
                        title: str = Form(...),
                        publication_area: str = Form("club"),
                        notice_number: Optional[int] = Form(None),
                        club_id_param: Optional[str] = Form(None),
                        series_id: Optional[str] = Form(None),
                        race_id: Optional[str] = Form(None),
                        class_id: Optional[str] = Form(None),
                        publication_datetime: Optional[str] = Form(None),
                        effective_datetime: Optional[str] = Form(None),
                        file: UploadFile = File(...)):
    """Create a DRAFT notice whose content is an EXISTING document (Option 2).
    The file is stored byte-for-byte and becomes the notice content — Sailscore
    adds only the surrounding metadata and ONB presentation (specs 37/38/48)."""
    tdef = _notice_type_or_400(notice_type)
    # Staff are pinned to their own club; a webmaster uploading needs an
    # explicit club (multipart bodies carry no JSON club_id field).
    club_id = (club_id_param if user.get("role") == "webmaster" else None) or user.get("club_id")
    if not club_id:
        raise HTTPException(status_code=400, detail="club_id is required")
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    links = await _validate_notice_links(club_id, race_id, series_id, class_id)
    publication = _valid_notice_datetime(publication_datetime, "Publication date/time")
    effective = _valid_notice_datetime(effective_datetime, "Effective date/time")
    data = await file.read()
    if len(data) > NOTICE_DOC_MAX:
        raise HTTPException(status_code=400,
                            detail=f"Document is too large — {NOTICE_DOC_MAX // (1024*1024)} MB max")
    ctype = _detect_notice_doc_type(data)
    if not ctype:
        raise HTTPException(status_code=400,
                            detail="The document must be a PDF, PNG, JPEG or WebP file")
    club = await db.clubs.find_one({"id": club_id}, {"_id": 0, "name": 1, "slug": 1})
    notice_id = new_id()
    doc = {
        "id": notice_id, "club_id": club_id,
        "notice_type": tdef["key"], "notice_type_label": tdef["label"],
        "heading": publication_area or "Club Notices", "publication_area": publication_area or "Club Notices", "title": title,
        "notice_number": notice_number or await _next_notice_number(club_id, tdef["key"]),
        "content_type": "uploaded", "creation_method": "uploaded",
        "status": "draft", "version": 1, "root_id": notice_id,
        "supersedes_id": None, "superseded_by": None,
        "fields": {}, "body": [],
        "published_at": None, "published_by": None,
        "effective_at": effective, "publication_datetime": publication,
        "created_at": now_iso(), "created_by": user.get("username"),
        "created_by_id": user.get("user_id"),
        "modified_at": None, "modified_by": None,
        "withdrawn_at": None, "withdrawn_by": None, "withdrawal_reason": None,
        "club_name": (club or {}).get("name"),
        "public_path": f"/club/{(club or {}).get('slug')}#notice-{notice_id}",
        "pdf_data_url": None, "has_pdf": False,
        "file_data_url": f"data:{ctype};base64,{base64.b64encode(data).decode()}",
        "has_file": True,
        "original_filename": file.filename or "document",
        "file_type": ctype, "file_size": len(data),
        "file_hash": hashlib.sha256(data).hexdigest(),
        "attachments": [],
        "history": [_notice_history_entry(
            user, "created",
            f"Uploaded document '{file.filename or 'document'}' ({len(data)} bytes)")],
    }
    doc.update(links)
    if _encoded_notice_size(doc) > NOTICE_ENCODED_BUDGET:
        raise HTTPException(status_code=400,
                            detail="Document too large to store — 14 MB total budget per notice")
    for _ in range(5):
        try:
            await db.notices.insert_one(doc)
            break
        except DuplicateKeyError:
            doc["notice_number"] = int(doc["notice_number"]) + 1
    else:
        raise HTTPException(status_code=400,
                            detail="Could not allocate a free notice number — try again")
    doc.pop("_id", None)
    await _log_audit(request=None, user=user, action="NOTICE_CREATED",
                     description=f"Uploaded draft {tdef['label']} '{title}' ({ctype}, {len(data)} bytes)",
                     resource_type="notice", resource_id=notice_id, club_id=club_id)
    return _notice_summary(doc)


@api_router.get("/notices/{notice_id}")
async def get_notice(notice_id: str, request: Request):
    """Full notice. Public callers only ever reach published / superseded /
    withdrawn notices (drafts 404 — never revealed); staff of the owning club
    (and the webmaster) can read any status. This is where the heavy payloads
    (uploaded document, generated PDF, attachment contents) are served from."""
    notice = await db.notices.find_one({"id": notice_id}, {"_id": 0})
    if not notice:
        raise HTTPException(status_code=404, detail="Notice not found")
    user = await get_current_user(request)
    staff = user and (user.get("role") == "webmaster" or user.get("club_id") == notice.get("club_id"))
    if not staff and notice.get("status") not in ("published", "superseded", "withdrawn"):
        raise HTTPException(status_code=404, detail="Notice not found")
    return notice


@api_router.put("/notices/{notice_id}")
async def update_notice(notice_id: str, data: NoticeUpdateInput,
                        user: dict = Depends(require_officer)):
    """Edit a draft (spec 49: structured fields may be edited freely before
    publication; after publication amendments create a NEW version). Uploaded
    notices only take metadata here — their document is the content and is
    never modified through this endpoint."""
    notice = await _notice_of_club(notice_id, user)
    if notice.get("status") != "draft":
        raise HTTPException(status_code=409,
                            detail="Only draft notices can be edited — create a new version to amend a published notice")
    expected = _expected_version(data)
    tdef = NOTICE_TYPES_BY_KEY[notice["notice_type"]]
    updates = {"modified_at": now_iso(), "modified_by": user.get("username")}
    history = None

    if data.title is not None:
        title = data.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title is required")
        updates["title"] = title
    if data.notice_number is not None:
        updates["notice_number"] = data.notice_number
    if data.effective_datetime is not None:
        updates["effective_at"] = _valid_notice_datetime(data.effective_datetime, "Effective date/time")

    if data.fields is not None:
        if notice["content_type"] == "uploaded":
            non_link = {k: v for k, v in data.fields.items()
                        if k not in ("series_id", "race_id", "class_id")}
            if non_link:
                raise HTTPException(status_code=400,
                                    detail="Uploaded notices keep the uploaded document as their content — metadata only")
            links = await _validate_notice_links(
                notice["club_id"], data.fields.get("race_id"),
                data.fields.get("series_id"), data.fields.get("class_id"))
            updates.update(links)
            history = "metadata updated"
        else:
            links_in = {k: data.fields[k] for k in ("series_id", "race_id", "class_id")
                        if k in data.fields}
            links = await _validate_notice_links(
                notice["club_id"], links_in.get("race_id"),
                links_in.get("series_id"), links_in.get("class_id")) if links_in else None
            fields_payload = {k: v for k, v in data.fields.items()
                              if k not in ("series_id", "race_id", "class_id")}
            fields = _clean_notice_fields(tdef, fields_payload, partial=True)
            merged = dict(notice.get("fields") or {})
            merged.update(fields)
            updates["fields"] = merged
            updates["body"] = _notice_body(tdef, merged)
            if links:
                updates.update(links)
            history = "fields updated"

    if history:
        updates["history"] = (notice.get("history") or []) + [
            _notice_history_entry(user, "modified", history)]

    result = await db.notices.update_one(_version_filter(notice_id, expected),
                                         {"$set": updates, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    await _log_audit(request=None, user=user, action="NOTICE_UPDATED",
                     description=f"Updated draft notice '{notice.get('title')}'",
                     resource_type="notice", resource_id=notice_id, club_id=notice.get("club_id"))
    return _notice_summary(await db.notices.find_one({"id": notice_id}, {"_id": 0}))


@api_router.put("/notices/{notice_id}/file")
async def replace_notice_file(notice_id: str, user: dict = Depends(require_officer),
                              file: UploadFile = File(...)):
    """Attach (or, on a new version, replace) the document of an UPLOADED draft.
    A published document is never touched here — corrected documents go onto a
    new version (spec 49), and every replacement is hashed + recorded."""
    notice = await _notice_of_club(notice_id, user)
    if notice.get("status") != "draft":
        raise HTTPException(status_code=409,
                            detail="Only draft notices can receive a document — create a new version to replace a published document")
    if notice.get("content_type") != "uploaded":
        raise HTTPException(status_code=400,
                            detail="Generated notices use the Sailscore-generated PDF, not an uploaded document")
    data = await file.read()
    if len(data) > NOTICE_DOC_MAX:
        raise HTTPException(status_code=400,
                            detail=f"Document is too large — {NOTICE_DOC_MAX // (1024*1024)} MB max")
    ctype = _detect_notice_doc_type(data)
    if not ctype:
        raise HTTPException(status_code=400,
                            detail="The document must be a PDF, PNG, JPEG or WebP file")
    replaced = notice.get("file_hash")
    updates = {
        "file_data_url": f"data:{ctype};base64,{base64.b64encode(data).decode()}",
        "has_file": True,
        "original_filename": file.filename or notice.get("original_filename") or "document",
        "file_type": ctype, "file_size": len(data),
        "file_hash": hashlib.sha256(data).hexdigest(),
        "modified_at": now_iso(), "modified_by": user.get("username"),
        "history": (notice.get("history") or []) + [_notice_history_entry(
            user, "document_replaced",
            f"Document '{file.filename or 'document'}' attached"
            + (f" (replaces hash {replaced[:12]}…)" if replaced else ""))],
    }
    test_doc = dict(notice); test_doc.pop("file_data_url", None); test_doc.update(updates)
    if _encoded_notice_size(test_doc) > NOTICE_ENCODED_BUDGET:
        raise HTTPException(status_code=400,
                            detail="Document too large to store — 14 MB total budget per notice")
    result = await db.notices.update_one({"id": notice_id, "status": "draft"},
                                         {"$set": updates, "$inc": {"version": 1}})
    if result.modified_count == 0:
        raise HTTPException(status_code=409, detail="Notice is no longer a draft")
    await _log_audit(request=None, user=user, action="NOTICE_FILE_REPLACED",
                     description=f"Document attached to draft '{notice.get('title')}' ({ctype}, {len(data)} bytes)",
                     resource_type="notice", resource_id=notice_id, club_id=notice.get("club_id"))
    return _notice_summary(await db.notices.find_one({"id": notice_id}, {"_id": 0}))


@api_router.post("/notices/{notice_id}/attachments")
async def add_notice_attachment(notice_id: str, user: dict = Depends(require_officer),
                                name: Optional[str] = Form(None),
                                file: UploadFile = File(...)):
    """Optional supporting documents (step 4 of the wizard) — sailing
    instructions PDFs, course diagrams, photos of the course board. Drafts
    only; validated by magic bytes and counted against the notice's budget."""
    notice = await _notice_of_club(notice_id, user)
    if notice.get("status") != "draft":
        raise HTTPException(status_code=409, detail="Attachments can only be added to draft notices")
    existing = notice.get("attachments") or []
    if len(existing) >= NOTICE_ATTACHMENTS_MAX:
        raise HTTPException(status_code=400,
                            detail=f"At most {NOTICE_ATTACHMENTS_MAX} attachments per notice")
    data = await file.read()
    if len(data) > NOTICE_ATTACHMENT_MAX:
        raise HTTPException(status_code=400,
                            detail=f"Attachment is too large — {NOTICE_ATTACHMENT_MAX // (1024*1024)} MB max")
    ctype = _detect_notice_doc_type(data)
    if not ctype:
        raise HTTPException(status_code=400,
                            detail="Attachments must be a PDF, PNG, JPEG or WebP file")
    test_doc = dict(notice)
    test_doc["attachments"] = existing + [{"data_url": f"data:{ctype};base64,{base64.b64encode(data).decode()}"}]
    if _encoded_notice_size(test_doc) > NOTICE_ENCODED_BUDGET:
        raise HTTPException(status_code=400,
                            detail="Attachment too large to store — 14 MB total budget per notice")
    att = {
        "id": new_id(),
        "name": (name or "").strip() or file.filename or "Attachment",
        "file_type": ctype, "file_size": len(data),
        "file_hash": hashlib.sha256(data).hexdigest(),
        "data_url": f"data:{ctype};base64,{base64.b64encode(data).decode()}",
    }
    result = await db.notices.update_one({"id": notice_id, "status": "draft"},
                                         {"$set": {"modified_at": now_iso(),
                                                   "modified_by": user.get("username")},
                                          "$inc": {"version": 1},
                                          "$push": {"attachments": att}})
    if result.modified_count == 0:
        raise HTTPException(status_code=409, detail="Notice is no longer a draft")
    await _log_audit(request=None, user=user, action="NOTICE_ATTACHMENT_ADDED",
                     description=f"Attachment '{att['name']}' added to '{notice.get('title')}'",
                     resource_type="notice", resource_id=notice_id, club_id=notice.get("club_id"))
    return _notice_summary(await db.notices.find_one({"id": notice_id}, {"_id": 0}))


@api_router.delete("/notices/{notice_id}/attachments/{attachment_id}")
async def remove_notice_attachment(notice_id: str, attachment_id: str,
                                   user: dict = Depends(require_officer)):
    notice = await _notice_of_club(notice_id, user)
    if notice.get("status") != "draft":
        raise HTTPException(status_code=409, detail="Attachments can only be removed from draft notices")
    att = next((a for a in notice.get("attachments") or [] if a.get("id") == attachment_id), None)
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    result = await db.notices.update_one({"id": notice_id, "status": "draft"},
                                         {"$set": {"modified_at": now_iso(),
                                                   "modified_by": user.get("username")},
                                          "$inc": {"version": 1},
                                          "$pull": {"attachments": {"id": attachment_id}}})
    if result.modified_count == 0:
        raise HTTPException(status_code=409, detail="Notice is no longer a draft")
    await _log_audit(request=None, user=user, action="NOTICE_ATTACHMENT_REMOVED",
                     description=f"Attachment '{att.get('name')}' removed from '{notice.get('title')}'",
                     resource_type="notice", resource_id=notice_id, club_id=notice.get("club_id"))
    return _notice_summary(await db.notices.find_one({"id": notice_id}, {"_id": 0}))


def _decode_pdf_data_url(s: Optional[str]) -> Optional[bytes]:
    """Validate a client-generated PDF data URL by magic bytes — the declared
    type is never trusted, so an HTML/JS payload can never be stored as the
    official generated PDF."""
    if not s or not isinstance(s, str):
        return None
    m = re.match(r"^data:application/pdf;base64,([A-Za-z0-9+/=\s]+)$", s)
    if not m:
        return None
    try:
        raw = base64.b64decode(m.group(1))
    except Exception:
        return None
    if not raw.startswith(b"%PDF-") or len(raw) > NOTICE_PDF_MAX:
        return None
    return raw


@api_router.post("/notices/{notice_id}/publish")
async def publish_notice(notice_id: str, data: NoticePublishInput,
                         user: dict = Depends(require_officer)):
    """Publish a draft to the Official Notice Board (spec 44: only after the
    wizard's explicit preview step). Generated notices store the client-built
    formal PDF alongside their HTML; if the notice supersedes an earlier
    version, that version is marked superseded the moment this one goes live
    (spec 49)."""
    notice = await _notice_of_club(notice_id, user)
    if notice.get("status") != "draft":
        raise HTTPException(status_code=409,
                            detail="Only draft notices can be published")
    if notice.get("content_type") == "uploaded" and not notice.get("has_file"):
        raise HTTPException(status_code=400,
                            detail="Upload the notice document before publishing")
    pdf_raw = _decode_pdf_data_url(data.pdf_data_url) if data.pdf_data_url else None
    if data.pdf_data_url and pdf_raw is None:
        raise HTTPException(status_code=400,
                            detail="pdf_data_url must be a base64 data URL of a PDF (up to 10 MB)")
    expected = _expected_version(data)
    now = now_iso()
    updates = {
        "status": "published",
        "published_at": notice.get("publication_datetime") or now,
        "published_by": user.get("username"),
        "history": (notice.get("history") or []) + [
            _notice_history_entry(user, "published")],
    }
    if pdf_raw is not None:
        updates["pdf_data_url"] = data.pdf_data_url
        updates["has_pdf"] = True
    result = await db.notices.update_one(_version_filter(notice_id, expected),
                                         {"$set": updates, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    # Version control: the previous published version this notice amends is
    # marked superseded (kept for the audit history, hidden from the public
    # list — the ONB always shows the current version).
    sup_id = notice.get("supersedes_id")
    if sup_id:
        await db.notices.update_one({"id": sup_id, "status": "published"}, {
            "$set": {"status": "superseded", "superseded_by": notice_id,
                     "history": _notice_history_entry(
                         user, "superseded",
                         f"Superseded by notice version {notice.get('version')} ({notice.get('title')})")}})
    await _log_audit(request=None, user=user, action="NOTICE_PUBLISHED",
                     description=f"Published {notice.get('notice_type_label')} '{notice.get('title')}'"
                                 + (f" (supersedes {sup_id})" if sup_id else ""),
                     resource_type="notice", resource_id=notice_id, club_id=notice.get("club_id"))
    return _notice_summary(await db.notices.find_one({"id": notice_id}, {"_id": 0}))


@api_router.post("/notices/{notice_id}/withdraw")
async def withdraw_notice(notice_id: str, data: NoticeWithdrawInput,
                          user: dict = Depends(require_officer)):
    """Withdraw a published notice (stays on the ONB, clearly marked as
    withdrawn, with the reason and who withdrew it — never silently removed)."""
    notice = await _notice_of_club(notice_id, user)
    if notice.get("status") != "published":
        raise HTTPException(status_code=409,
                            detail="Only published notices can be withdrawn")
    reason = (data.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A withdrawal reason is required")
    expected = _expected_version(data)
    updates = {
        "status": "withdrawn",
        "withdrawn_at": now_iso(), "withdrawn_by": user.get("username"),
        "withdrawal_reason": reason,
        "history": (notice.get("history") or []) + [
            _notice_history_entry(user, "withdrawn", reason)],
    }
    result = await db.notices.update_one(_version_filter(notice_id, expected),
                                         {"$set": updates, "$inc": {"version": 1}})
    if result.modified_count == 0:
        _raise_stale(expected)
    await _log_audit(request=None, user=user, action="NOTICE_WITHDRAWN",
                     description=f"Withdrew '{notice.get('title')}' — {reason}",
                     resource_type="notice", resource_id=notice_id, club_id=notice.get("club_id"))
    return _notice_summary(await db.notices.find_one({"id": notice_id}, {"_id": 0}))


@api_router.post("/notices/{notice_id}/new-version")
async def new_notice_version(notice_id: str, user: dict = Depends(require_officer)):
    """Amend a published notice: create the next version as a DRAFT that
    supersedes this one (spec 49). The current published version remains live
    and untouched until the new version is published. Uploaded documents are
    NOT copied — the corrected document is explicitly attached to the new
    version (PUT /notices/{id}/file), so an official document is never
    silently replaced."""
    notice = await _notice_of_club(notice_id, user)
    if notice.get("status") != "published":
        raise HTTPException(status_code=409,
                            detail="Only published notices can be amended — edit the draft or withdraw it instead")
    club = await db.clubs.find_one({"id": notice["club_id"]}, {"_id": 0, "slug": 1})
    new_id_v = new_id()
    doc = {
        "id": new_id_v, "club_id": notice["club_id"],
        "notice_type": notice["notice_type"], "notice_type_label": notice["notice_type_label"],
        "heading": notice["heading"], "title": notice["title"],
        "notice_number": notice["notice_number"],
        "content_type": notice["content_type"], "creation_method": notice["creation_method"],
        "status": "draft", "version": int(notice.get("version") or 1),
        "root_id": notice.get("root_id") or notice_id,
        "supersedes_id": notice_id, "superseded_by": None,
        "fields": dict(notice.get("fields") or {}),
        "body": list(notice.get("body") or []),
        "published_at": None, "published_by": None,
        "effective_at": notice.get("effective_at"),
        "publication_datetime": None,
        "created_at": now_iso(), "created_by": user.get("username"),
        "created_by_id": user.get("user_id"),
        "modified_at": None, "modified_by": None,
        "withdrawn_at": None, "withdrawn_by": None, "withdrawal_reason": None,
        "club_name": notice.get("club_name"),
        "public_path": f"/club/{(club or {}).get('slug')}#notice-{new_id_v}",
        "pdf_data_url": None, "has_pdf": False,
        # The uploaded document is deliberately not carried over: the corrected
        # official document must be uploaded for the new version.
        "file_data_url": None, "has_file": False,
        "original_filename": None, "file_type": None, "file_size": None, "file_hash": None,
        "attachments": [],
        "history": [_notice_history_entry(
            user, "created",
            f"New version of notice v{notice.get('version')} — amendment in progress")],
    }
    for key in ("series_id", "series_name", "event_name", "race_id", "race_number",
                "race_date", "class_id", "class_name"):
        doc[key] = notice.get(key)
    await db.notices.insert_one(doc)
    doc.pop("_id", None)
    await _log_audit(request=None, user=user, action="NOTICE_NEW_VERSION",
                     description=f"Started amendment (v{doc['version']}) of '{notice.get('title')}'",
                     resource_type="notice", resource_id=new_id_v, club_id=notice.get("club_id"))
    return _notice_summary(doc)


@api_router.delete("/notices/{notice_id}")
async def delete_notice(notice_id: str, request: Request,
                        user: dict = Depends(require_admin)):
    """Remove a notice from the club ONB.

    Race Admins and Webmasters may remove draft or published notices. Published
    notices are retained in the audit log but disappear from the public ONB;
    the action is explicit and audited rather than a silent replacement.
    """
    notice = await _notice_of_club(notice_id, user)
    expected = _expected_version_query(request)
    result = await db.notices.delete_one(_version_filter(notice_id, expected))
    if result.deleted_count == 0:
        _raise_stale(expected)
    await _log_audit(request=request, user=user, action="NOTICE_REMOVED_FROM_ONB",
                     description=f"Removed notice '{notice.get('title')}' from the ONB",
                     resource_type="notice", resource_id=notice_id, club_id=notice.get("club_id"))
    return {"ok": True}


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


async def _backfill_fleet_identities():
    """Give every boat a fleet identity so the shared-boat registry works for
    boats created before this feature. Records are linked only when the match
    is unambiguous (no other record with the same sail-number+name key in the
    same class+year); genuinely identical boats are left unlinked for the
    admin to resolve explicitly. Idempotent."""
    try:
        boats = await db.boats.find({}, {"_id": 0}).to_list(20000)
    except Exception as exc:
        logger.warning("FLEET BACKFILL FAILED: %s", exc)
        return
    by_key = {}
    for b in boats:
        key = b.get("fleet_key") or fleet_key(b.get("name", ""), b.get("sail_no", ""))
        by_key.setdefault(key, []).append(b)
    for key, group in by_key.items():
        for b in group:
            if b.get("fleet_id") and b.get("fleet_key"):
                continue
            others = [x for x in group if x["id"] != b["id"]]
            own = (b.get("class_id"), b.get("year"))
            linkable = [x for x in others if (x.get("class_id"), x.get("year")) != own]
            if linkable:
                target = linkable[0]
                fid = target.get("fleet_id") or target["id"]
            elif not others:
                fid = b["id"]  # singleton: its own id is its identity
            else:
                continue  # only same-class+year duplicates: leave for the admin
            try:
                await db.boats.update_one({"id": b["id"]},
                                          {"$set": {"fleet_id": fid, "fleet_key": key}})
            except Exception as exc:
                logger.warning("FLEET BACKFILL UPDATE FAILED (%s): %s", b["id"], exc)


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
                   # Unique on (series_id, race_number) for non-mini races.
                   # Mini-series sub-races share the same race_number with different
                   # mini_group_id values, so we use a partial index that only enforces
                   # uniqueness when mini_group_id is null (i.e., non-mini races).
                   ([("series_id", 1), ("race_number", 1)],
                    {"unique": True, "partialFilterExpression": {"mini_group_id": {"$exists": False}}})],
        db.series: [([("id", 1)], {"unique": True})],
        db.boats: [([("id", 1)], {"unique": True}),
                   ([("fleet_key", 1)], {})],
        db.classes: [([("id", 1)], {"unique": True})],
        db.clubs: [([("id", 1)], {"unique": True}),
                   ([("slug", 1)], {"unique": True})],
        db.season_snapshots: [([("id", 1)], {"unique": True}),
                              ([("series_id", 1), ("version", 1)], {"unique": True})],
        db.users: [([("id", 1)], {"unique": True}),
                   ([("club_id", 1), ("username", 1)],
                    {"unique": True, "partialFilterExpression": {"club_id": {"$exists": True}}})],
        db.audit_logs: [([("id", 1)], {"unique": True})],
        db.subscriptions: [([("id", 1)], {"unique": True}),
                           ([("email_hash", 1), ("subscription_type", 1), ("target_id", 1), ("active", 1)], {})],
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
    # Drop the old unique index on (series_id, race_number) that prevents
    # mini-series sub-races from sharing the same race_number. The new partial
    # index (only unique for non-mini races) is created in _ensure_db_constraints.
    try:
        await db.races.drop_index("series_id_1_race_number_1")
    except Exception:
        pass  # Index may not exist or already replaced
    # Integrity layer: backfill the optimistic-concurrency counter on legacy
    # documents, then enforce unique-id / ownership constraints at the
    # database level so the DB is a second line of defence behind the API.
    try:
        await _backfill_versions()
        await _ensure_db_constraints()
        await _backfill_fleet_identities()
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
    # Indexes for the Official Notice Board: club-scoped list reads, unique
    # per-type notice numbering (the allocator retries on this), version
    # chains (root_id) and race-scoped lookups from race consoles.
    try:
        # 2026-08 migration: numbering is a DISPLAY label, not a database
        # constraint — versions of one notice share a number ("No. 5 amended"
        # is still No. 5), so no unique index can express it. The allocator
        # (max + 1) plus the per-notice audit trail is the source of truth;
        # two simultaneous creations could in theory share a number, which is
        # cosmetic and vanishingly rare for a single-club race office.
        for legacy in ("club_id_1_notice_type_1_notice_number_1",
                       "club_id_1_notice_type_1_notice_number_1_root_id_1"):
            try:
                await db.notices.drop_index(legacy)
            except Exception:
                pass
        await db.notices.create_index([("club_id", 1), ("status", 1), ("created_at", -1)])
        await db.notices.create_index(
            [("club_id", 1), ("notice_type", 1), ("notice_number", 1)])
        await db.notices.create_index([("root_id", 1)])
        await db.notices.create_index([("race_id", 1)])
    except Exception as exc:
        logger.warning("NOTICE INDEX CREATION FAILED: %s", exc)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
