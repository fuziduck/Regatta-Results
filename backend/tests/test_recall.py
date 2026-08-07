"""Tests for the recall -> re-publish cycle (setup <-> published).

Verifies the NEW UI-facing behaviour end-to-end via API:
  1. Officer/Admin can flip a published race back to 'setup' via
     POST /api/races/{id}/status/setup and published_at is cleared.
  2. GET /api/standings drops the race while it is in setup.
  3. GET /api/notifications includes the race while in setup.
  4. Re-publishing restores standings and removes the notification.
Data is restored (re-published) at the end of each test.
"""

import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
OFFICER_PIN = "sail2026"
ADMIN_PIN = "admin2026"


def _login(role, pin):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"role": role, "pin": pin})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def officer_token():
    return _login("officer", OFFICER_PIN)


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin", ADMIN_PIN)


def _headers(tok):
    return {"Authorization": f"Bearer {tok}"}


def _find_published_race():
    r = requests.get(f"{BASE_URL}/api/races")
    r.raise_for_status()
    pubs = [x for x in r.json() if x["status"] == "published"]
    assert pubs, "No published races in seed"
    return pubs[0]


def test_recall_and_republish_officer(officer_token):
    race = _find_published_race()
    rid = race["id"]
    sid = race["series_id"]

    # baseline standings count
    s0 = requests.get(f"{BASE_URL}/api/standings/series/{sid}").json()
    base_races = len(s0.get("races", []))

    try:
        # Recall
        r = requests.post(f"{BASE_URL}/api/races/{rid}/status/setup", headers=_headers(officer_token))
        assert r.status_code == 200, r.text

        got = requests.get(f"{BASE_URL}/api/races/{rid}").json()
        assert got["status"] == "setup"
        assert got.get("published_at") in (None, "")

        # Standings drops the race
        s1 = requests.get(f"{BASE_URL}/api/standings/series/{sid}").json()
        assert len(s1.get("races", [])) == base_races - 1

        # Notifications include it
        notifs = requests.get(f"{BASE_URL}/api/notifications").json()
        assert any(n["race_id"] == rid for n in notifs), "recalled race should appear in notifications"
    finally:
        # Restore
        r = requests.post(f"{BASE_URL}/api/races/{rid}/status/published", headers=_headers(officer_token))
        assert r.status_code == 200
        got = requests.get(f"{BASE_URL}/api/races/{rid}").json()
        assert got["status"] == "published"
        assert got.get("published_at")

    # Post-restore invariants
    s2 = requests.get(f"{BASE_URL}/api/standings/series/{sid}").json()
    assert len(s2.get("races", [])) == base_races
    notifs2 = requests.get(f"{BASE_URL}/api/notifications").json()
    assert not any(n["race_id"] == rid for n in notifs2)


def test_recall_admin_role_also_allowed(admin_token):
    race = _find_published_race()
    rid = race["id"]
    try:
        r = requests.post(f"{BASE_URL}/api/races/{rid}/status/setup", headers=_headers(admin_token))
        assert r.status_code == 200, r.text
        assert requests.get(f"{BASE_URL}/api/races/{rid}").json()["status"] == "setup"
    finally:
        requests.post(f"{BASE_URL}/api/races/{rid}/status/published", headers=_headers(admin_token))


def test_status_endpoint_requires_auth():
    race = _find_published_race()
    rid = race["id"]
    r = requests.post(f"{BASE_URL}/api/races/{rid}/status/setup")
    assert r.status_code in (401, 403)
