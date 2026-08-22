"""Security-focused tests: JWT handling, passcode storage, production config
validation, upload magic-byte checks, legacy-PIN removal, authorization
boundaries, IDOR protection across resource types, and public access.

Unit tests import the server module with a stubbed environment (motor connects
lazily, so no database is required). Live tests exercise the deployed API
inside a dedicated test club like the rest of the suite.
"""

import base64
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta
from importlib import import_module
from pathlib import Path

import jwt as pyjwt
import pytest
import requests

from conftest import API, WEBMASTER_PASSCODE, TEST_OFFICER_PIN, TEST_ADMIN_PIN, h

BACKEND_DIR = str(Path(__file__).resolve().parent.parent)


# --------------------------------------------------------------------------
# Unit tests (no database needed) — the server module is imported with a
# stubbed environment; motor connects lazily so import is safe offline.
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def srv():
    saved = {k: os.environ.get(k) for k in ("MONGO_URL", "DB_NAME", "JWT_SECRET", "ENV")}
    os.environ["MONGO_URL"] = "mongodb://localhost:27017/regatta_test"
    os.environ["DB_NAME"] = "regatta_test"
    os.environ["JWT_SECRET"] = "unit-test-secret-that-is-long-enough-0123456789"
    os.environ["ENV"] = "development"
    try:
        for name in list(sys.modules):
            if name == "server" or name.startswith("server."):
                del sys.modules[name]
        sys.path.insert(0, BACKEND_DIR)
        yield import_module("server")
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _claims(srv, **over):
    now = int(time.time())
    c = {"role": "admin", "club_id": "club1", "sub": "u1", "user_id": "u1",
         "iss": srv.JWT_ISSUER, "aud": srv.JWT_AUDIENCE,
         "iat": now, "exp": now + 3600, "type": "access", "tv": 0}
    c.update(over)
    return c


class TestJwtUnit:
    def test_create_token_claims(self, srv):
        tok = srv.create_token("admin", "club1", "u1", "alice", 3)
        payload = pyjwt.decode(tok, srv.JWT_SECRET, algorithms=["HS256"],
                               issuer=srv.JWT_ISSUER, audience=srv.JWT_AUDIENCE)
        assert payload["iss"] == srv.JWT_ISSUER
        assert payload["aud"] == srv.JWT_AUDIENCE
        assert payload["sub"] == "u1" and payload["user_id"] == "u1"
        assert payload["tv"] == 3
        assert payload["type"] == "access"
        ttl = payload["exp"] - payload["iat"]
        assert 0 < ttl <= srv.JWT_EXPIRE_HOURS * 3600

    def test_expired_token_rejected(self, srv):
        now = int(time.time())
        tok = pyjwt.encode(_claims(srv, iat=now - 7200, exp=now - 3600),
                           srv.JWT_SECRET, algorithm="HS256")
        with pytest.raises(pyjwt.ExpiredSignatureError):
            pyjwt.decode(tok, srv.JWT_SECRET, algorithms=["HS256"],
                         issuer=srv.JWT_ISSUER, audience=srv.JWT_AUDIENCE,
                         options={"require": ["exp", "iat", "iss", "aud", "sub"]})

    def test_wrong_secret_rejected(self, srv):
        tok = pyjwt.encode(_claims(srv), "a-different-secret-that-is-long-enough-123", algorithm="HS256")
        with pytest.raises(pyjwt.InvalidSignatureError):
            pyjwt.decode(tok, srv.JWT_SECRET, algorithms=["HS256"],
                         issuer=srv.JWT_ISSUER, audience=srv.JWT_AUDIENCE)

    def test_wrong_audience_rejected(self, srv):
        tok = pyjwt.encode(_claims(srv, aud="some-other-app"), srv.JWT_SECRET, algorithm="HS256")
        with pytest.raises(pyjwt.InvalidAudienceError):
            pyjwt.decode(tok, srv.JWT_SECRET, algorithms=["HS256"],
                         issuer=srv.JWT_ISSUER, audience=srv.JWT_AUDIENCE)

    def test_wrong_issuer_rejected(self, srv):
        tok = pyjwt.encode(_claims(srv, iss="someone-else"), srv.JWT_SECRET, algorithm="HS256")
        with pytest.raises(pyjwt.InvalidIssuerError):
            pyjwt.decode(tok, srv.JWT_SECRET, algorithms=["HS256"],
                         issuer=srv.JWT_ISSUER, audience=srv.JWT_AUDIENCE)

    def test_missing_required_claim_rejected(self, srv):
        payload = _claims(srv)
        del payload["sub"]
        tok = pyjwt.encode(payload, srv.JWT_SECRET, algorithm="HS256")
        with pytest.raises(pyjwt.MissingRequiredClaimError):
            pyjwt.decode(tok, srv.JWT_SECRET, algorithms=["HS256"],
                         issuer=srv.JWT_ISSUER, audience=srv.JWT_AUDIENCE,
                         options={"require": ["exp", "iat", "iss", "aud", "sub"]})

    def test_alg_confusion_rejected(self, srv):
        """A token signed with HS256 must not verify as RS256, and the 'none'
        algorithm must never be accepted."""
        tok = pyjwt.encode(_claims(srv), srv.JWT_SECRET, algorithm="HS256")
        # Decoding with a different allowed algorithm list must fail outright
        # (algorithm confusion is impossible: the header alg is checked against
        # the allow-list before any signature verification).
        with pytest.raises(pyjwt.PyJWTError):
            pyjwt.decode(tok, srv.JWT_SECRET, algorithms=["RS256"],
                         issuer=srv.JWT_ISSUER, audience=srv.JWT_AUDIENCE)
        # hand-built unsigned token with alg=none
        header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode()
        body = base64.urlsafe_b64encode(json.dumps(_claims(srv)).encode()).rstrip(b"=").decode()
        unsigned = f"{header}.{body}."
        with pytest.raises(pyjwt.PyJWTError):
            pyjwt.decode(unsigned, srv.JWT_SECRET, algorithms=["HS256"],
                         options={"verify_signature": True})

    def test_passcode_hashing(self, srv):
        hsh = srv.hash_passcode("correct horse battery staple")
        assert hsh != "correct horse battery staple"
        assert srv.verify_passcode("correct horse battery staple", hsh)
        assert not srv.verify_passcode("wrong", hsh)
        assert srv.hash_passcode("same") != srv.hash_passcode("same")  # salted

    def test_image_type_detection(self, srv):
        assert srv._detect_image_type(b"\x89PNG\r\n\x1a\n" + b"x") == "image/png"
        assert srv._detect_image_type(b"\xff\xd8\xff\xe0" + b"x") == "image/jpeg"
        assert srv._detect_image_type(b"GIF89a" + b"x") == "image/gif"
        assert srv._detect_image_type(b"RIFF\x04\x00\x00\x00WEBP" + b"x") == "image/webp"
        # Non-images / executable content must be rejected.
        assert srv._detect_image_type(b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>") is None
        assert srv._detect_image_type(b"<html><script>alert(1)</script></html>") is None
        assert srv._detect_image_type(b"#!/bin/sh\nrm -rf /") is None
        assert srv._detect_image_type(b"PK\x03\x04 zip") is None

    def test_production_config_validation(self, srv):
        old = (srv.JWT_SECRET, srv.WEBMASTER_PASSCODE, srv.mongo_url)
        old_cors = os.environ.get("CORS_ORIGINS")
        try:
            srv.JWT_SECRET = "short"
            srv.WEBMASTER_PASSCODE = "x"
            os.environ["CORS_ORIGINS"] = "*"
            errs = srv._production_config_errors()
            assert any("JWT_SECRET" in e for e in errs)
            assert any("CORS_ORIGINS" in e for e in errs)
            assert any("WEBMASTER_PASSCODE" in e for e in errs)
            # a known-weak default must be rejected too
            srv.JWT_SECRET = "change-me-to-a-long-random-string"
            assert any("JWT_SECRET" in e for e in srv._production_config_errors())
            # a strong configuration passes
            srv.JWT_SECRET = "a" * 48
            srv.WEBMASTER_PASSCODE = "strong-passcode-123"
            srv.mongo_url = "mongodb://user:pass@localhost:27017/regatta?authSource=admin"
            os.environ["CORS_ORIGINS"] = "https://results.example.org"
            assert srv._production_config_errors() == []
        finally:
            srv.JWT_SECRET, srv.WEBMASTER_PASSCODE, srv.mongo_url = old
            if old_cors is None:
                os.environ.pop("CORS_ORIGINS", None)
            else:
                os.environ["CORS_ORIGINS"] = old_cors


# --------------------------------------------------------------------------
# Live tests — authentication
# --------------------------------------------------------------------------
def _mk_user(webmaster_token, club_id, role, username, passcode, name=""):
    r = requests.post(f"{API}/users", json={
        "club_id": club_id, "role": role, "username": username,
        "name": name, "passcode": passcode}, headers=h(webmaster_token))
    assert r.status_code == 200, r.text
    return r.json()


def _login(role, username, passcode, club_id=None):
    body = {"role": role, "username": username, "passcode": passcode}
    if club_id:
        body["club_id"] = club_id
    r = requests.post(f"{API}/auth/login", json=body)
    assert r.status_code == 200, f"login failed: {r.text}"
    return r.json()


class TestLiveAuth:
    def test_legacy_pin_login_rejected(self, test_club):
        """The old shared-PIN body (role + pin, no username) must never
        authenticate — there is no fallback mechanism."""
        for role, pin in (("officer", TEST_OFFICER_PIN), ("admin", TEST_ADMIN_PIN)):
            r = requests.post(f"{API}/auth/login", json={
                "role": role, "pin": pin, "club_id": test_club["id"]})
            assert r.status_code == 401, r.text

    def test_generic_failure_messages(self, test_club):
        """Wrong passcode and unknown username return the same status + message,
        so the endpoint cannot be used to enumerate accounts."""
        unknown = requests.post(f"{API}/auth/login", json={
            "role": "admin", "username": "nobody", "passcode": "whatever",
            "club_id": test_club["id"]})
        wrong = requests.post(f"{API}/auth/login", json={
            "role": "admin", "username": "admin", "passcode": "wrong",
            "club_id": test_club["id"]})
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json()["detail"] == wrong.json()["detail"] == "Invalid credentials"

    def test_inactive_account_rejected(self, test_club, webmaster_token):
        u = _mk_user(webmaster_token, test_club["id"], "officer",
                     f"ia{uuid.uuid4().hex[:5]}", "ia1234")
        requests.put(f"{API}/users/{u['id']}", json={"active": False},
                     headers=h(webmaster_token))
        r = requests.post(f"{API}/auth/login", json={
            "role": "officer", "username": u["username"], "passcode": "ia1234",
            "club_id": test_club["id"]})
        assert r.status_code == 401
        requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))

    def test_missing_token_rejected(self):
        assert requests.get(f"{API}/users").status_code == 401

    def test_invalid_token_rejected(self):
        assert requests.get(f"{API}/users", headers=h("not.a.jwt")).status_code == 401

    def test_tampered_token_rejected(self, webmaster_token):
        header, payload, sig = webmaster_token.split(".")
        pad = "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload + pad))
        data["role"] = "officer" if data.get("role") != "officer" else "admin"
        forged = base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()
        tok = f"{header}.{forged}.{sig}"
        assert requests.get(f"{API}/users", headers=h(tok)).status_code == 401

    def test_role_change_revokes_existing_token(self, test_club, webmaster_token):
        u = _mk_user(webmaster_token, test_club["id"], "officer",
                     f"rc{uuid.uuid4().hex[:5]}", "rc1234")
        body = _login("officer", u["username"], "rc1234", test_club["id"])
        assert requests.get(f"{API}/auth/me", headers=h(body["token"])).status_code == 200
        r = requests.put(f"{API}/users/{u['id']}", json={"role": "admin"},
                         headers=h(webmaster_token))
        assert r.status_code == 200
        # previously issued token no longer authorises anything
        assert requests.get(f"{API}/auth/me", headers=h(body["token"])).status_code == 401
        # and the account logs in under its new role
        body2 = _login("admin", u["username"], "rc1234", test_club["id"])
        assert body2["role"] == "admin"
        requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))

    def test_passcode_reset_revokes_existing_token(self, test_club, webmaster_token):
        u = _mk_user(webmaster_token, test_club["id"], "officer",
                     f"rs{uuid.uuid4().hex[:5]}", "rs1234")
        body = _login("officer", u["username"], "rs1234", test_club["id"])
        r = requests.put(f"{API}/users/{u['id']}", json={"passcode": "new5678"},
                         headers=h(webmaster_token))
        assert r.status_code == 200
        assert requests.get(f"{API}/auth/me", headers=h(body["token"])).status_code == 401
        requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))


# --------------------------------------------------------------------------
# Live tests — changing your own passcode
# --------------------------------------------------------------------------
def _mk_officer(webmaster_token, test_club, prefix):
    return _mk_user(webmaster_token, test_club["id"], "officer",
                    f"{prefix}{uuid.uuid4().hex[:5]}", "cp1234")


class TestLiveChangePasscode:
    def test_officer_changes_own_passcode(self, test_club, webmaster_token):
        u = _mk_officer(webmaster_token, test_club, "cp")
        body = _login("officer", u["username"], "cp1234", test_club["id"])
        try:
            r = requests.post(f"{API}/auth/change-passcode",
                              json={"current_passcode": "cp1234", "new_passcode": "new5678"},
                              headers=h(body["token"]))
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["token"] and data["username"] == u["username"]
            # the old token is revoked (token version bumped)…
            assert requests.get(f"{API}/auth/me", headers=h(body["token"])).status_code == 401
            # …but the fresh token keeps this session alive
            assert requests.get(f"{API}/auth/me", headers=h(data["token"])).status_code == 200
            # old passcode no longer works, new one does
            r = requests.post(f"{API}/auth/login", json={
                "role": "officer", "username": u["username"], "passcode": "cp1234",
                "club_id": test_club["id"]})
            assert r.status_code == 401
            r = requests.post(f"{API}/auth/login", json={
                "role": "officer", "username": u["username"], "passcode": "new5678",
                "club_id": test_club["id"]})
            assert r.status_code == 200
        finally:
            requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))

    def test_wrong_current_passcode_rejected(self, test_club, webmaster_token):
        u = _mk_officer(webmaster_token, test_club, "cpw")
        body = _login("officer", u["username"], "cp1234", test_club["id"])
        try:
            r = requests.post(f"{API}/auth/change-passcode",
                              json={"current_passcode": "wrong", "new_passcode": "new5678"},
                              headers=h(body["token"]))
            assert r.status_code == 401
            # nothing changed — the old passcode still works
            r = requests.post(f"{API}/auth/login", json={
                "role": "officer", "username": u["username"], "passcode": "cp1234",
                "club_id": test_club["id"]})
            assert r.status_code == 200
        finally:
            requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))

    def test_short_new_passcode_rejected(self, test_club, webmaster_token):
        u = _mk_officer(webmaster_token, test_club, "cps")
        body = _login("officer", u["username"], "cp1234", test_club["id"])
        try:
            r = requests.post(f"{API}/auth/change-passcode",
                              json={"current_passcode": "cp1234", "new_passcode": "12"},
                              headers=h(body["token"]))
            assert r.status_code == 400
        finally:
            requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))

    def test_same_passcode_rejected(self, test_club, webmaster_token):
        u = _mk_officer(webmaster_token, test_club, "cpx")
        body = _login("officer", u["username"], "cp1234", test_club["id"])
        try:
            r = requests.post(f"{API}/auth/change-passcode",
                              json={"current_passcode": "cp1234", "new_passcode": "cp1234"},
                              headers=h(body["token"]))
            assert r.status_code == 400
        finally:
            requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))

    def test_unauthenticated_rejected(self):
        r = requests.post(f"{API}/auth/change-passcode",
                          json={"current_passcode": "x", "new_passcode": "y"})
        assert r.status_code == 401

    def test_lockout_after_five_failures(self, test_club, webmaster_token):
        u = _mk_officer(webmaster_token, test_club, "cpl")
        body = _login("officer", u["username"], "cp1234", test_club["id"])
        try:
            for _ in range(5):
                r = requests.post(f"{API}/auth/change-passcode",
                                  json={"current_passcode": "wrong", "new_passcode": "new5678"},
                                  headers=h(body["token"]))
                assert r.status_code == 401
            # even the correct current passcode is now refused while locked
            r = requests.post(f"{API}/auth/change-passcode",
                              json={"current_passcode": "cp1234", "new_passcode": "new5678"},
                              headers=h(body["token"]))
            assert r.status_code == 423
        finally:
            requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))


# --------------------------------------------------------------------------
# Live tests — role escalation
# --------------------------------------------------------------------------
class TestLiveRoleEscalation:
    def test_officer_cannot_admin_endpoint(self, club_officer_token):
        r = requests.post(f"{API}/classes", json={"name": "x"},
                          headers=h(club_officer_token))
        assert r.status_code == 403

    def test_admin_cannot_webmaster_endpoints(self, club_admin_token):
        r = requests.post(f"{API}/clubs", json={"name": "x"}, headers=h(club_admin_token))
        assert r.status_code == 403
        assert requests.get(f"{API}/clubs/manage", headers=h(club_admin_token)).status_code == 403
        assert requests.get(f"{API}/adverts/manage", headers=h(club_admin_token)).status_code == 403

    def test_admin_cannot_create_webmaster(self, test_club, club_admin_token):
        r = requests.post(f"{API}/users", json={
            "club_id": test_club["id"], "role": "webmaster",
            "username": "evil", "passcode": "evil1234"}, headers=h(club_admin_token))
        assert r.status_code == 422  # role enum rejects 'webmaster'

    def test_admin_cannot_change_own_role(self, test_club, club_admin_token):
        users = requests.get(f"{API}/users", headers=h(club_admin_token)).json()
        me = next(u for u in users if u["username"] == "admin")
        r = requests.put(f"{API}/users/{me['id']}", json={"role": "officer"},
                         headers=h(club_admin_token))
        assert r.status_code == 400

    def test_admin_cannot_deactivate_self(self, test_club, club_admin_token):
        users = requests.get(f"{API}/users", headers=h(club_admin_token)).json()
        me = next(u for u in users if u["username"] == "admin")
        r = requests.put(f"{API}/users/{me['id']}", json={"active": False},
                         headers=h(club_admin_token))
        assert r.status_code == 400


# --------------------------------------------------------------------------
# Live tests — multi-club isolation / IDOR
# --------------------------------------------------------------------------
class TestLiveIdor:
    def test_club_a_admin_cannot_read_club_b(self, test_club, club_admin_token, other_club_with_data):
        other = other_club_with_data
        other_cls = other["classes"][0]["id"]
        # club-scoped reads are forced to the caller's own club
        r = requests.get(f"{API}/classes", params={"club_id": other["id"]},
                         headers=h(club_admin_token))
        assert r.status_code == 200
        assert all(c["club_id"] == test_club["id"] for c in r.json())
        # class_id-scoped reads of another club's class are rejected outright
        for path, params in (("/boats", {"class_id": other_cls}),
                             ("/series", {"class_id": other_cls}),
                             ("/races", {"class_id": other_cls})):
            r = requests.get(f"{API}{path}", params=params, headers=h(club_admin_token))
            assert r.status_code == 404, f"{path}: {r.status_code}"

    def test_club_a_admin_cannot_modify_club_b(self, club_admin_token, other_club_with_data):
        other = other_club_with_data
        other_cls = other["classes"][0]["id"]
        r = requests.put(f"{API}/classes/{other_cls}",
                         json={"name": "hacked", "default_start_time": "10:30"},
                         headers=h(club_admin_token))
        assert r.status_code == 403
        boats = requests.get(f"{API}/boats", params={"class_id": other_cls}).json()
        if boats:
            r = requests.put(f"{API}/boats/{boats[0]['id']}", json={
                "name": "hacked", "sail_no": "99", "class_id": other_cls,
                "helm": "x", "year": 2026}, headers=h(club_admin_token))
            assert r.status_code == 403
        series = requests.get(f"{API}/series", params={"class_id": other_cls}).json()
        if series:
            r = requests.put(f"{API}/series/{series[0]['id']}", json={
                "name": "hacked", "class_id": other_cls, "year": 2026},
                headers=h(club_admin_token))
            assert r.status_code == 403

    def test_club_a_officer_cannot_touch_club_b_race(self, club_officer_token, other_club_with_data):
        other = other_club_with_data
        other_cls = other["classes"][0]["id"]
        races = requests.get(f"{API}/races", params={"class_id": other_cls}).json()
        if races:
            race = races[0]
            r = requests.post(f"{API}/races/{race['id']}/status/published",
                              headers=h(club_officer_token))
            assert r.status_code == 403
            r = requests.delete(f"{API}/races/{race['id']}", headers=h(club_officer_token))
            assert r.status_code == 403

    def test_club_a_admin_cannot_upload_club_b_icon(self, club_admin_token, other_club_with_data):
        other = other_club_with_data
        png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
        r = requests.put(f"{API}/clubs/{other['id']}/icon",
                         files={"file": ("icon.png", png, "image/png")},
                         headers=h(club_admin_token))
        assert r.status_code == 403

    def test_club_a_admin_cannot_manage_club_b_users(self, club_admin_token, other_club_with_data):
        other = other_club_with_data
        r = requests.get(f"{API}/users", params={"club_id": other["id"]},
                         headers=h(club_admin_token))
        assert r.status_code == 200
        assert all(u["club_id"] != other["id"] for u in r.json())


# --------------------------------------------------------------------------
# Live tests — public access stays open, and nothing sensitive leaks
# --------------------------------------------------------------------------
class TestLivePublic:
    def test_public_results_without_auth(self):
        assert requests.get(f"{API}/clubs").status_code == 200
        directory = requests.get(f"{API}/clubs/directory").json()
        assert isinstance(directory, list)
        assert requests.get(f"{API}/seasons").status_code == 200
        assert requests.get(f"{API}/adverts").status_code == 200

    def test_public_standings_work(self):
        directory = requests.get(f"{API}/clubs/directory").json()
        for club in directory:
            for cls in club.get("classes", []):
                series = requests.get(f"{API}/series", params={"class_id": cls["id"]}).json()
                if series:
                    r = requests.get(f"{API}/standings/series/{series[0]['id']}")
                    assert r.status_code == 200
                    assert "standings" in r.json()
                    return
        pytest.skip("No class with a series available for the public-standings check")

    def test_public_payloads_clean(self, test_club, webmaster_token):
        # clubs never expose PINs / credentials
        for c in requests.get(f"{API}/clubs").json():
            assert "officer_pin" not in c and "admin_pin" not in c and "passcode" not in c
        for c in requests.get(f"{API}/clubs/manage", headers=h(webmaster_token)).json():
            assert "officer_pin" not in c and "admin_pin" not in c
        # users never expose hashes or revocation counters
        users = requests.get(f"{API}/users", params={"club_id": test_club["id"]},
                             headers=h(webmaster_token)).json()
        assert users
        for u in users:
            assert "passcode_hash" not in u and "passcode" not in u and "token_version" not in u
