"""Unit tests for the webmaster two-factor authentication (TOTP + emailed
fallback code).

The 2FA endpoints mutate the SINGLETON webmaster account, so these tests
never talk to the shared live backend: the DB layer is stubbed out (exactly
like test_scoring_engine_full.py) and the endpoint functions are invoked
directly with a minimal fake Request. This keeps the live suite's shared
webmaster session working for every other module, while still covering:

- enrollment: setup -> enable (wrong code rejected) -> status -> disable
- two-step login: passcode wins a pending cookie, TOTP completes it
- email fallback: dev code returned, completes login, single use
- disable / email-change require the current passcode
- hygiene: 2FA fields never leak from user listings or backups
- audit events recorded for every 2FA action
"""
import os
import sys
import asyncio
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "tfa_test")
os.environ.setdefault("JWT_SECRET", "test")
os.environ.setdefault("ENV", "development")
os.environ.setdefault("WEBMASTER_PASSCODE", "master2026")
os.environ.setdefault("SMTP_HOST", "")

import pytest
import pyotp

import server

WEBMASTER_PASSCODE = "master2026"
USER_ID = "wm-user-1"


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------
class FakeRequest:
    """Minimal stand-in for a Starlette Request: the endpoints only read
    cookies, headers, client IP, method and URL path."""

    def __init__(self, cookies=None, headers=None, ip="127.0.0.1",
                 method="POST", path="/api/auth/test"):
        self.cookies = dict(cookies or {})
        self.headers = dict(headers or {})
        self.client = types.SimpleNamespace(host=ip)
        self.method = method
        self.url = types.SimpleNamespace(path=path)


def _matches(doc, filt):
    if not filt:
        return True
    for k, v in filt.items():
        if doc.get(k) != v:
            return False
    return True


class _Coll:
    def __init__(self):
        self.docs = []

    async def find_one(self, filt=None, projection=None):
        for d in self.docs:
            if _matches(d, filt or {}):
                return d
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)
        return doc

    async def update_one(self, filt, update):
        for d in self.docs:
            if _matches(d, filt or {}):
                if update.get("$set"):
                    d.update(update["$set"])
                if update.get("$inc"):
                    for k, v in update["$inc"].items():
                        d[k] = (d.get(k) or 0) + v
                if update.get("$unset"):
                    for k in update["$unset"]:
                        d.pop(k, None)
                return types.SimpleNamespace(modified_count=1)
        return types.SimpleNamespace(modified_count=0)

    async def update_many(self, filt, update):
        for d in self.docs:
            if _matches(d, filt or {}):
                if update.get("$set"):
                    d.update(update["$set"])
        return types.SimpleNamespace(modified_count=1)


class _Cursor:
    def __init__(self, items):
        self.items = list(items)

    def sort(self, *_a, **_k):
        return self

    async def to_list(self, n):
        return self.items[:n] if n else list(self.items)


def make_db():
    wm = {
        "id": USER_ID, "club_id": None, "role": "webmaster",
        "username": "webmaster", "name": "Webmaster",
        "passcode_hash": server.hash_passcode(WEBMASTER_PASSCODE),
        "active": True, "token_version": 0,
        "failed_attempts": 0,
    }
    users = _Coll(); users.docs.append(wm)
    return types.SimpleNamespace(
        users=users,
        clubs=_Coll(),
        settings=_Coll(),
        audit_logs=_Coll(),
        series=_Coll(), races=_Coll(), boats=_Coll(), classes=_Coll(),
    )


def make_session_request():
    """A request carrying a valid webmaster session cookie."""
    token = server.create_token("webmaster", None, USER_ID, "webmaster", 0)
    return FakeRequest(cookies={server.SESSION_COOKIE: token})


def make_pending_request():
    """A request carrying a valid pending-2FA cookie (passcode step done)."""
    token = server.create_pending_2fa_token(USER_ID)
    return FakeRequest(cookies={server.PENDING2FA_COOKIE: token})


def _audit_actions(db):
    return [a["action"] for a in db.audit_logs.docs]


@pytest.fixture(autouse=True)
def _clean_globals():
    server.db = make_db()
    server._login_attempts.clear()
    server._revoked_jtis.clear()
    server._pending_setup_secrets.clear()
    yield
    server._pending_setup_secrets.clear()
    server._login_attempts.clear()


async def _enable_2fa(db, email="wm2fa@test.club"):
    """Full enrollment through the real endpoints; returns the TOTP secret."""
    req = make_session_request()
    r = await server.tfa_setup(req, {"user_id": USER_ID, "username": "webmaster",
                                     "role": "webmaster", "club_id": None})
    secret = r["secret"]
    code = pyotp.TOTP(secret).now()
    await server.tfa_enable(type("E", (), {"code": code, "email": email})(),
                            req,
                            {"user_id": USER_ID, "username": "webmaster",
                             "role": "webmaster", "club_id": None})
    return secret


# ---------------------------------------------------------------------------
# Enrollment
# ---------------------------------------------------------------------------
class TestEnrollment:
    def test_setup_returns_secret_and_uri(self):
        r = asyncio.run(server.tfa_setup(make_session_request(),
                                         {"user_id": USER_ID, "username": "webmaster",
                                          "role": "webmaster", "club_id": None}))
        assert r["secret"]
        assert r["otpauth_uri"].startswith("otpauth://totp/")

    def test_enable_rejects_wrong_code(self):
        req = make_session_request()
        asyncio.run(server.tfa_setup(req, {"user_id": USER_ID, "username": "webmaster",
                                           "role": "webmaster", "club_id": None}))
        with pytest.raises(Exception) as ei:
            asyncio.run(server.tfa_enable(type("E", (), {"code": "000000", "email": None})(),
                                          req, {"user_id": USER_ID, "username": "webmaster",
                                                "role": "webmaster", "club_id": None}))
        assert "incorrect" in str(ei.value).lower() or ei.value.status_code == 400
        assert "AUTH_2FA_ENABLE_FAILED" in _audit_actions(server.db)

    def test_enable_requires_setup_first(self):
        with pytest.raises(Exception) as ei:
            asyncio.run(server.tfa_enable(type("E", (), {"code": "123456", "email": None})(),
                                          make_session_request(),
                                          {"user_id": USER_ID, "username": "webmaster",
                                           "role": "webmaster", "club_id": None}))
        assert "Start 2FA setup first" in str(ei.value)

    def test_status_reports_enabled_and_masked_email(self):
        asyncio.run(_enable_2fa(server.db))
        st = asyncio.run(server.tfa_status(make_session_request(),
                                           {"user_id": USER_ID, "username": "webmaster",
                                            "role": "webmaster", "club_id": None}))
        assert st["enabled"] is True
        assert st["has_email"] is True
        assert "wm2fa@test.club" not in st["email"]  # masked, never full
        assert st["email"].endswith("@test.club")

    def test_disable_requires_passcode_and_code(self):
        secret = asyncio.run(_enable_2fa(server.db))
        req = make_session_request()
        # wrong passcode rejected
        with pytest.raises(Exception) as ei:
            asyncio.run(server.tfa_disable(type("D", (), {
                "current_passcode": "wrong", "code": pyotp.TOTP(secret).now(),
                "method": "totp"})(), req,
                {"user_id": USER_ID, "username": "webmaster", "role": "webmaster", "club_id": None}))
        assert ei.value.status_code == 401
        # wrong code rejected even with the right passcode
        with pytest.raises(Exception) as ei:
            asyncio.run(server.tfa_disable(type("D", (), {
                "current_passcode": WEBMASTER_PASSCODE, "code": "000000",
                "method": "totp"})(), req,
                {"user_id": USER_ID, "username": "webmaster", "role": "webmaster", "club_id": None}))
        assert ei.value.status_code == 401
        # correct passcode + code disables
        r = asyncio.run(server.tfa_disable(type("D", (), {
            "current_passcode": WEBMASTER_PASSCODE, "code": pyotp.TOTP(secret).now(),
            "method": "totp"})(), req,
            {"user_id": USER_ID, "username": "webmaster", "role": "webmaster", "club_id": None}))
        assert r["enabled"] is False
        assert "AUTH_2FA_DISABLED" in _audit_actions(server.db)

    def test_change_email_requires_passcode(self):
        asyncio.run(_enable_2fa(server.db))
        req = make_session_request()
        with pytest.raises(Exception) as ei:
            asyncio.run(server.tfa_set_email(type("M", (), {
                "current_passcode": "wrong", "email": "x@y.org"})(), req,
                {"user_id": USER_ID, "username": "webmaster", "role": "webmaster", "club_id": None}))
        assert ei.value.status_code == 401
        r = asyncio.run(server.tfa_set_email(type("M", (), {
            "current_passcode": WEBMASTER_PASSCODE, "email": "new@test.club"})(), req,
            {"user_id": USER_ID, "username": "webmaster", "role": "webmaster", "club_id": None}))
        assert r["ok"] is True
        assert server.db.users.docs[0]["email"] == "new@test.club"


# ---------------------------------------------------------------------------
# Two-step login
# ---------------------------------------------------------------------------
class TestLoginFlow:
    def _login(self, passcode=WEBMASTER_PASSCODE):
        return asyncio.run(server.login(type("L", (), {
            "role": "webmaster", "username": "webmaster", "passcode": passcode,
            "club_id": None})(), FakeRequest(ip="10.0.0.1")))

    def test_passcode_only_when_2fa_off(self):
        resp = self._login()
        assert resp.status_code == 200
        body = resp.body.decode()
        assert "requires_2fa" not in body

    def test_login_returns_pending_when_2fa_on(self):
        asyncio.run(_enable_2fa(server.db))
        resp = self._login()
        assert resp.status_code == 200
        body = resp.body.decode()
        assert '"requires_2fa":true' in body
        set_cookies = resp.raw_headers
        joined = " ".join(f"{k.decode()}={v.decode()}" for k, v in set_cookies)
        assert "scr_pending2fa=" in joined
        assert "AUTH_2FA_REQUIRED" in _audit_actions(server.db)

    def test_login_2fa_with_totp(self):
        secret = asyncio.run(_enable_2fa(server.db))
        self._login()
        req = make_pending_request()
        # wrong code rejected
        with pytest.raises(Exception) as ei:
            asyncio.run(server.login_2fa(type("F", (), {"code": "000000", "method": "totp"})(),
                                         req))
        assert ei.value.status_code == 401
        assert "AUTH_LOGIN_2FA_FAILED" in _audit_actions(server.db)
        # correct code completes the login
        resp = asyncio.run(server.login_2fa(type("F", (), {
            "code": pyotp.TOTP(secret).now(), "method": "totp"})(), req))
        assert resp.status_code == 200
        joined = " ".join(f"{k.decode()}={v.decode()}" for k, v in resp.raw_headers)
        assert "scr_token=" in joined
        assert "AUTH_LOGIN_SUCCESS" in _audit_actions(server.db)

    def test_login_2fa_rejects_missing_pending(self):
        asyncio.run(_enable_2fa(server.db))
        with pytest.raises(Exception) as ei:
            asyncio.run(server.login_2fa(type("F", (), {"code": "123456", "method": "totp"})(),
                                         FakeRequest()))
        assert ei.value.status_code == 401

    def test_email_fallback(self):
        asyncio.run(_enable_2fa(server.db))
        self._login()
        # send the fallback code (dev: returned in the response)
        resp = asyncio.run(server.send_email_2fa_code(make_pending_request()))
        assert resp.get("ok") is True
        dev = resp.get("dev_code")
        assert dev and len(dev) == 6
        assert "AUTH_2FA_EMAIL_SENT" in _audit_actions(server.db)
        # complete login with the emailed code
        final = asyncio.run(server.login_2fa(type("F", (), {
            "code": dev, "method": "email"})(), make_pending_request()))
        assert final.status_code == 200
        # single use: a second attempt with the same code fails
        server._login_attempts.clear()
        with pytest.raises(Exception) as ei:
            asyncio.run(server.login_2fa(type("F", (), {
                "code": dev, "method": "email"})(), make_pending_request()))
        assert ei.value.status_code == 401

    def test_email_fallback_requires_email_set(self):
        # 2FA enabled without a fallback email -> no code can be sent
        asyncio.run(_enable_2fa(server.db, email=None))
        with pytest.raises(Exception) as ei:
            asyncio.run(server.send_email_2fa_code(make_pending_request()))
        assert ei.value.status_code == 400


# ---------------------------------------------------------------------------
# Webmaster passcode reset (via the stored backup email)
# ---------------------------------------------------------------------------
class TestForgotPassword:
    def _forgot(self, email, club_id="c1"):
        return asyncio.run(server.forgot_password(
            types.SimpleNamespace(club_id=club_id, email=email),
            FakeRequest(ip="10.0.0.1")))

    def test_reset_link_sent_to_backup_email(self):
        asyncio.run(_enable_2fa(server.db))  # stores email wm2fa@test.club
        r = self._forgot("wm2fa@test.club")
        assert r.get("dev_reset_token")
        assert server.db.users.docs[0].get("reset_token_hash")
        assert "PASSWORD_RESET_REQUESTED" in _audit_actions(server.db)

    def test_reset_completes_with_token(self):
        asyncio.run(_enable_2fa(server.db))
        token = self._forgot("wm2fa@test.club")["dev_reset_token"]
        resp = asyncio.run(server.reset_password(
            types.SimpleNamespace(token=token, new_passcode="Fresh99!"),
            FakeRequest(ip="10.0.0.1")))
        assert resp == {"ok": True}
        doc = server.db.users.docs[0]
        assert server.verify_passcode("Fresh99!", doc["passcode_hash"])
        assert "reset_token_hash" not in doc  # single use
        assert "PASSWORD_RESET_COMPLETED" in _audit_actions(server.db)

    def test_backup_email_survives_2fa_disable(self):
        # Disabling 2FA keeps the backup email, so the reset path still works
        # when 2FA is off (recovery must not depend on 2FA being on).
        secret = asyncio.run(_enable_2fa(server.db))
        asyncio.run(server.tfa_disable(types.SimpleNamespace(
            current_passcode=WEBMASTER_PASSCODE,
            code=pyotp.TOTP(secret).now(), method="totp"),
            make_session_request(),
            {"user_id": USER_ID, "username": "webmaster",
             "role": "webmaster", "club_id": None}))
        doc = server.db.users.docs[0]
        assert doc.get("email") == "wm2fa@test.club"  # kept
        assert not doc.get("totp_enabled")
        r = self._forgot("wm2fa@test.club")
        assert r.get("dev_reset_token")

    def test_unknown_email_gets_no_token(self):
        r = self._forgot("nobody@test.club")
        assert r == {"ok": True}  # generic answer, nothing leaked
        assert not r.get("dev_reset_token")
        assert not server.db.users.docs[0].get("reset_token_hash")

    def test_no_backup_email_gets_no_token(self):
        # webmaster without a stored backup email cannot request a reset
        r = self._forgot("webmaster@test.club")
        assert r == {"ok": True}
        assert not r.get("dev_reset_token")


# ---------------------------------------------------------------------------
# Hygiene — 2FA material never leaves the server
# ---------------------------------------------------------------------------
class TestHygiene:
    def _enabled_user(self):
        asyncio.run(_enable_2fa(server.db))
        return server.db.users.docs[0]

    def test_user_public_strips_2fa_fields(self):
        u = self._enabled_user()
        pub = server._user_public(dict(u))
        assert "totp_secret_enc" not in pub
        assert "totp_enabled" not in pub
        assert "email" not in pub
        assert "email_otp_hash" not in pub
        assert "passcode_hash" not in pub

    def test_backup_strip_strips_2fa_fields(self):
        u = self._enabled_user()
        stripped = server._strip_backup_secrets(dict(u))
        for key in ("totp_secret_enc", "totp_enabled", "email",
                    "email_otp_hash", "email_otp_expires", "passcode_hash"):
            assert key not in stripped

    def test_full_backup_rejects_none_2fa(self):
        # Belt and braces: BACKUP_SECRET_KEYS drives the strip used on export.
        for key in ("totp_secret_enc", "totp_enabled", "email",
                    "email_otp_hash", "email_otp_expires"):
            assert key in server.BACKUP_SECRET_KEYS

    def test_login_failures_count_toward_lockout(self):
        # Failed second-factor attempts must hit the same per-account lockout.
        asyncio.run(_enable_2fa(server.db))
        for i in range(server.MAX_FAILED_ATTEMPTS):
            server._login_attempts.clear()
            req = make_pending_request()
            try:
                asyncio.run(server.login_2fa(type("F", (), {
                    "code": "000000", "method": "totp"})(), req))
            except Exception:
                pass
        assert server.db.users.docs[0].get("locked_until"), \
            "repeated bad 2FA codes must lock the account"
