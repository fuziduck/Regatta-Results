"""Shared fixtures for the live-API test suite.

The suite is self-contained: each pytest-xdist worker creates a dedicated
club (via the webmaster role — which also exercises club management) with its
own officer/admin passcodes and runs its CRUD/race-flow tests inside it, so
the tests never depend on — or mutate — a real club's data. Everything is
torn down at session end.

Point the suite at a deployment with REACT_APP_BACKEND_URL (defaults to the
local compose stack, http://127.0.0.1:8000).
"""
import os
import uuid

import pytest
import requests

API = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000").rstrip("/") + "/api"
WEBMASTER_PIN = os.environ.get("WEBMASTER_PIN", "master2026")

TEST_OFFICER_PIN = "test1234"
TEST_ADMIN_PIN = "test5678"


def login(role, pin, club_id=None):
    body = {"role": role, "pin": pin}
    if club_id:
        body["club_id"] = club_id
    r = requests.post(f"{API}/auth/login", json=body)
    assert r.status_code == 200, f"login {role} failed: {r.text}"
    return r.json()


def h(token):
    return {"Authorization": f"Bearer {token}"}


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
    return login("webmaster", WEBMASTER_PIN)["token"]


@pytest.fixture(scope="session")
def test_club(webmaster_token):
    """A dedicated club for this worker's tests (webmaster-only creation)."""
    r = requests.post(f"{API}/clubs", json={
        "name": f"API Test Club {uuid.uuid4().hex[:6]}",
        "color": "#123456",
        "officer_pin": TEST_OFFICER_PIN,
        "admin_pin": TEST_ADMIN_PIN,
    }, headers=h(webmaster_token))
    assert r.status_code == 200, f"test club creation failed: {r.text}"
    club = r.json()
    yield club
    _delete_test_club(club["id"], webmaster_token)


@pytest.fixture(scope="session")
def club_admin_token(test_club):
    return login("admin", TEST_ADMIN_PIN, test_club["id"])["token"]


@pytest.fixture(scope="session")
def club_officer_token(test_club):
    return login("officer", TEST_OFFICER_PIN, test_club["id"])["token"]


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
