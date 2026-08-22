"""Live-API tests for the per-user auth system: seeded club accounts,
user CRUD with club scoping, passcode lockout, and session revocation.

Runs against the same deployment as the rest of the suite (see conftest.py),
inside a dedicated test club that is torn down afterwards.
"""

import uuid
import requests

from conftest import API, WEBMASTER_PIN, TEST_OFFICER_PIN, TEST_ADMIN_PIN, h


def _login_user(role, username, passcode, club_id=None):
    body = {"role": role, "username": username, "passcode": passcode}
    if club_id:
        body["club_id"] = club_id
    r = requests.post(f"{API}/auth/login", json=body)
    assert r.status_code == 200, f"user login failed: {r.text}"
    return r.json()


def _mk_user(webmaster_token, club_id, role, username, passcode, name=""):
    r = requests.post(f"{API}/users", json={
        "club_id": club_id, "role": role, "username": username,
        "name": name, "passcode": passcode,
    }, headers=h(webmaster_token))
    assert r.status_code == 200, r.text
    return r.json()


def _club_users(club_id, token):
    r = requests.get(f"{API}/users", params={"club_id": club_id}, headers=h(token))
    assert r.status_code == 200, r.text
    return r.json()


class TestPerUserLogin:
    def test_webmaster_username_login(self):
        body = _login_user("webmaster", "webmaster", WEBMASTER_PIN)
        assert body["role"] == "webmaster"
        assert body["club_id"] is None
        assert body["username"] == "webmaster"
        assert body["token"]

    def test_webmaster_bad_passcode(self):
        r = requests.post(f"{API}/auth/login", json={"role": "webmaster", "username": "webmaster", "passcode": "wrong"})
        assert r.status_code == 401

    def test_seeded_club_accounts_match_pins(self, test_club):
        """The club's PINs are seeded as 'admin'/'officer' accounts."""
        for role, pin in (("officer", TEST_OFFICER_PIN), ("admin", TEST_ADMIN_PIN)):
            body = _login_user(role, role, pin, test_club["id"])
            assert body["role"] == role
            assert body["club_id"] == test_club["id"]
            assert body["username"] == role

    def test_username_scoped_to_own_club(self, test_club, webmaster_token):
        """The same username in another club must not authenticate here."""
        other = next(c["id"] for c in requests.get(f"{API}/clubs").json() if c["id"] != test_club["id"])
        u = _mk_user(webmaster_token, other, "officer", "sharedname", "sh4red1")
        try:
            r = requests.post(f"{API}/auth/login", json={
                "role": "officer", "username": "sharedname", "passcode": "sh4red1", "club_id": test_club["id"]})
            assert r.status_code == 401
        finally:
            requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))


class TestUserCrudScoping:
    def test_no_hash_leaked(self, test_club, webmaster_token):
        for u in _club_users(test_club["id"], webmaster_token):
            assert "passcode_hash" not in u
            assert "passcode" not in u

    def test_admin_sees_only_own_club(self, test_club, club_admin_token, webmaster_token):
        mine = requests.get(f"{API}/users", headers=h(club_admin_token)).json()
        assert mine, "admin should see their club's seeded users"
        assert all(u["club_id"] == test_club["id"] for u in mine)

    def test_admin_cannot_create_user_in_other_club(self, test_club, club_admin_token):
        other = next(c["id"] for c in requests.get(f"{API}/clubs").json() if c["id"] != test_club["id"])
        r = requests.post(f"{API}/users", json={
            "club_id": other, "role": "admin", "username": "sneaky", "passcode": "1234"},
            headers=h(club_admin_token))
        # Server scopes creation to the caller's own club — never the other club.
        assert r.status_code == 200
        assert r.json()["club_id"] == test_club["id"]

    def test_admin_cannot_delete_other_clubs_user(self, test_club, club_admin_token, webmaster_token):
        other = next(c["id"] for c in requests.get(f"{API}/clubs").json() if c["id"] != test_club["id"])
        victim = _mk_user(webmaster_token, other, "officer", f"vic{uuid.uuid4().hex[:5]}", "vic1234")
        try:
            r = requests.delete(f"{API}/users/{victim['id']}", headers=h(club_admin_token))
            assert r.status_code == 403
        finally:
            requests.delete(f"{API}/users/{victim['id']}", headers=h(webmaster_token))

    def test_duplicate_username_rejected(self, test_club, club_admin_token):
        r = requests.post(f"{API}/users", json={
            "club_id": test_club["id"], "role": "officer",
            "username": "admin", "passcode": "dup1234"}, headers=h(club_admin_token))
        assert r.status_code == 400

    def test_short_passcode_rejected(self, test_club, club_admin_token):
        r = requests.post(f"{API}/users", json={
            "club_id": test_club["id"], "role": "officer",
            "username": "shorty", "passcode": "12"}, headers=h(club_admin_token))
        assert r.status_code == 400

    def test_admin_cannot_delete_own_account(self, test_club):
        # Per-user token (the legacy PIN token has no user identity).
        me = _login_user("admin", "admin", TEST_ADMIN_PIN, test_club["id"])
        users = _club_users(test_club["id"], me["token"])
        mine = next(u for u in users if u["username"] == me["username"])
        r = requests.delete(f"{API}/users/{mine['id']}", headers=h(me["token"]))
        assert r.status_code == 400

    def test_admin_cannot_deactivate_self(self, test_club):
        me = _login_user("admin", "admin", TEST_ADMIN_PIN, test_club["id"])
        users = _club_users(test_club["id"], me["token"])
        mine = next(u for u in users if u["username"] == me["username"])
        r = requests.put(f"{API}/users/{mine['id']}", json={"active": False}, headers=h(me["token"]))
        assert r.status_code == 400


class TestLockoutAndRevocation:
    def test_lockout_after_five_failures(self, test_club, webmaster_token):
        u = _mk_user(webmaster_token, test_club["id"], "officer",
                     f"lock{uuid.uuid4().hex[:5]}", "lock1234")
        for _ in range(5):
            r = requests.post(f"{API}/auth/login", json={
                "role": "officer", "username": u["username"], "passcode": "wrong", "club_id": test_club["id"]})
            assert r.status_code == 401
        # Correct passcode is now rejected while the account is locked.
        r = requests.post(f"{API}/auth/login", json={
            "role": "officer", "username": u["username"], "passcode": "lock1234", "club_id": test_club["id"]})
        assert r.status_code == 423
        requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))

    def test_deactivate_revokes_existing_token(self, test_club, webmaster_token):
        u = _mk_user(webmaster_token, test_club["id"], "officer",
                     f"rev{uuid.uuid4().hex[:5]}", "rev1234")
        body = _login_user("officer", u["username"], "rev1234", test_club["id"])
        assert requests.get(f"{API}/auth/me", headers=h(body["token"])).status_code == 200
        r = requests.put(f"{API}/users/{u['id']}", json={"active": False}, headers=h(webmaster_token))
        assert r.status_code == 200
        assert requests.get(f"{API}/auth/me", headers=h(body["token"])).status_code == 401
        requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))

    def test_passcode_reset_blocks_old_passcode(self, test_club, webmaster_token):
        u = _mk_user(webmaster_token, test_club["id"], "officer",
                     f"pw{uuid.uuid4().hex[:5]}", "pw1234")
        _login_user("officer", u["username"], "pw1234", test_club["id"])
        r = requests.put(f"{API}/users/{u['id']}", json={"passcode": "new5678"}, headers=h(webmaster_token))
        assert r.status_code == 200
        r = requests.post(f"{API}/auth/login", json={
            "role": "officer", "username": u["username"], "passcode": "pw1234", "club_id": test_club["id"]})
        assert r.status_code == 401
        body = _login_user("officer", u["username"], "new5678", test_club["id"])
        assert body["token"]
        requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))

    def test_deleted_user_cannot_login(self, test_club, webmaster_token):
        u = _mk_user(webmaster_token, test_club["id"], "officer",
                     f"del{uuid.uuid4().hex[:5]}", "del1234")
        requests.delete(f"{API}/users/{u['id']}", headers=h(webmaster_token))
        r = requests.post(f"{API}/auth/login", json={
            "role": "officer", "username": u["username"], "passcode": "del1234", "club_id": test_club["id"]})
        assert r.status_code == 401
