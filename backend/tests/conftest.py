"""Shared fixtures for the live-API test suite.

The suite is self-contained: each pytest-xdist worker creates a dedicated
club (via the webmaster role — which also exercises club management), then
creates that club's officer/admin user accounts, and runs its CRUD/race-flow
tests inside it, so the tests never depend on — or mutate — a real club's
data. Everything is torn down at session end.

Point the suite at a deployment with REACT_APP_BACKEND_URL (defaults to the
local compose stack, http://127.0.0.1:8000).
"""
import os
import uuid

import pytest
import requests

API = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000").rstrip("/") + "/api"
WEBMASTER_PASSCODE = os.environ.get("WEBMASTER_PASSCODE", "master2026")

# Passcodes meet the app-wide policy (6+ chars, number + special character).
TEST_OFFICER_PIN = "test1234!"
TEST_ADMIN_PIN = "test5678!"


def login(role, username, passcode, club_id=None):
    """Per-user login: username + passcode (individual accounts only). The JWT
    is delivered as an HttpOnly session cookie (never in the response body),
    so the returned dict carries the cookie value as its "token" for the
    request helpers below."""
    body = {"role": role, "username": username, "passcode": passcode}
    if club_id:
        body["club_id"] = club_id
    r = requests.post(f"{API}/auth/login", json=body)
    assert r.status_code == 200, f"login {role} failed: {r.text}"
    data = r.json()
    data["token"] = r.cookies.get("scr_token", "")
    return data


def h(token):
    """Authenticate as the session cookie, exactly like the browser does."""
    return {"Cookie": f"scr_token={token}"}


def _delete_test_club(club_id, token):
    """Tear down races -> series -> boats -> classes -> club for a test club."""
    for c in requests.get(f"{API}/classes", params={"club_id": club_id}, headers=h(token)).json():
        for s in requests.get(f"{API}/series", params={"class_id": c["id"]}, headers=h(token)).json():
            for race in requests.get(f"{API}/races", params={"series_id": s["id"]}, headers=h(token)).json():
                requests.delete(f"{API}/races/{race['id']}", headers=h(token))
            requests.delete(f"{API}/series/{s['id']}", headers=h(token))
        for b in requests.get(f"{API}/boats", params={"class_id": c["id"]}, headers=h(token)).json():
            requests.delete(f"{API}/boats/{b['id']}", headers=h(token))
        requests.delete(f"{API}/classes/{c['id']}", headers=h(token))
    requests.delete(f"{API}/clubs/{club_id}", headers=h(token))


@pytest.fixture(scope="session")
def webmaster_token():
    return login("webmaster", "webmaster", WEBMASTER_PASSCODE)["token"]


def club_user_username(role, club_id):
    """Usernames are email addresses; stable per test club."""
    return f"{role}@{club_id[:8]}.test.club"


@pytest.fixture(scope="session")
def test_club(webmaster_token):
    """A dedicated club for this worker's tests (webmaster-only creation), with
    its own officer/admin user accounts (individual email logins)."""
    r = requests.post(f"{API}/clubs", json={
        "name": f"API Test Club {uuid.uuid4().hex[:6]}",
        "color": "#123456",
    }, headers=h(webmaster_token))
    assert r.status_code == 200, f"test club creation failed: {r.text}"
    club = r.json()
    for role, pin, name in (("officer", TEST_OFFICER_PIN, "Test Officer"),
                            ("admin", TEST_ADMIN_PIN, "Test Admin")):
        r = requests.post(f"{API}/users", json={
            "club_id": club["id"], "role": role,
            "username": club_user_username(role, club["id"]),
            "name": name, "passcode": pin,
        }, headers=h(webmaster_token))
        assert r.status_code == 200, f"test user creation failed: {r.text}"
    yield club
    _delete_test_club(club["id"], webmaster_token)


@pytest.fixture(scope="session")
def club_admin_token(test_club):
    return login("admin", club_user_username("admin", test_club["id"]),
                 TEST_ADMIN_PIN, test_club["id"])["token"]


@pytest.fixture(scope="session")
def club_officer_token(test_club):
    return login("officer", club_user_username("officer", test_club["id"]),
                 TEST_OFFICER_PIN, test_club["id"])["token"]


@pytest.fixture(scope="session")
def test_class(test_club, club_admin_token):
    """A 'Test Fleet' class inside the test club."""
    r = requests.post(f"{API}/classes", json={"name": "Test Fleet", "default_start_time": "10:30"},
                      headers=h(club_admin_token))
    assert r.status_code == 200, f"test class creation failed: {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def other_club_with_data():
    """A real (non-test) club that has classes, for cross-club isolation tests.
    Prefers a real club (never torn down) over another worker's test club."""
    directory = requests.get(f"{API}/clubs/directory").json()
    candidates = [c for c in directory if c.get("classes")]
    real = [c for c in candidates if not c["name"].startswith("API Test Club")]
    pick = (real or candidates)[0]
    assert pick, "No club with classes available for isolation tests"
    return pick
