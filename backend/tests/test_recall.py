"""Tests for the recall -> re-publish cycle (setup <-> published), run inside
the dedicated test club (see conftest.py) so real club data is untouched:
  1. Officer/Admin can flip a published race back to 'setup' via
     POST /api/races/{id}/status/setup and published_at is cleared.
  2. GET /api/standings drops the race while it is in setup.
  3. GET /api/notifications includes the race while in setup.
  4. Re-publishing restores standings and removes the notification.
Data is restored (re-published) at the end of each test.
"""

import uuid
import requests
from datetime import datetime, timezone

from conftest import API, h

YEAR = datetime.now(timezone.utc).year


def _make_published_race(club_admin_token, club_officer_token):
    """Create a class + series + one boat + a published race in the test club.
    Each call gets its own class so no other test's fleet leaks in."""
    r = requests.post(f"{API}/classes", json={
        "name": f"Recall Class {uuid.uuid4().hex[:4]}", "default_start_time": "10:30"},
        headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    cls = r.json()
    r = requests.post(f"{API}/series", json={
        "name": "Recall Series", "class_id": cls["id"], "year": YEAR,
        "discards": 0, "included_in_overall": True, "order": 3}, headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    series = r.json()
    r = requests.post(f"{API}/boats", json={
        "name": "Recall Boat", "sail_no": "RC1", "class_id": cls["id"],
        "helm": "R", "year": YEAR, "active": True}, headers=h(club_admin_token))
    boat = r.json()
    r = requests.post(f"{API}/races", json={
        "date": f"{YEAR}-06-20", "class_id": cls["id"], "series_id": series["id"],
        "race_number": 1}, headers=h(club_officer_token))
    race = r.json()
    requests.post(f"{API}/races/{race['id']}/select-boats", json={"boat_ids": [boat["id"]]},
                  headers=h(club_officer_token))
    requests.post(f"{API}/races/{race['id']}/finish", json={"boat_id": boat["id"]},
                  headers=h(club_officer_token))
    r = requests.post(f"{API}/races/{race['id']}/status/published", headers=h(club_officer_token))
    assert r.status_code == 200, r.text
    return race["id"], series["id"]


def test_recall_and_republish_officer(club_officer_token, club_admin_token):
    rid, sid = _make_published_race(club_admin_token, club_officer_token)
    s0 = requests.get(f"{API}/standings/series/{sid}").json()
    base_races = len(s0.get("races", []))

    try:
        r = requests.post(f"{API}/races/{rid}/status/setup", headers=h(club_officer_token))
        assert r.status_code == 200, r.text

        got = requests.get(f"{API}/races/{rid}").json()
        assert got["status"] == "setup"
        assert got.get("published_at") in (None, "")

        s1 = requests.get(f"{API}/standings/series/{sid}").json()
        assert len(s1.get("races", [])) == base_races - 1

        notifs = requests.get(f"{API}/notifications").json()
        assert any(n["race_id"] == rid for n in notifs), "recalled race should appear in notifications"
    finally:
        r = requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))
        assert r.status_code == 200
        got = requests.get(f"{API}/races/{rid}").json()
        assert got["status"] == "published"
        assert got.get("published_at")

    s2 = requests.get(f"{API}/standings/series/{sid}").json()
    assert len(s2.get("races", [])) == base_races
    notifs2 = requests.get(f"{API}/notifications").json()
    assert not any(n["race_id"] == rid for n in notifs2)


def test_recall_admin_role_also_allowed(club_admin_token, club_officer_token):
    rid, _ = _make_published_race(club_admin_token, club_officer_token)
    try:
        r = requests.post(f"{API}/races/{rid}/status/setup", headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        assert requests.get(f"{API}/races/{rid}").json()["status"] == "setup"
    finally:
        requests.post(f"{API}/races/{rid}/status/published", headers=h(club_admin_token))


def test_status_endpoint_requires_auth(club_admin_token, club_officer_token):
    rid, _ = _make_published_race(club_admin_token, club_officer_token)
    r = requests.post(f"{API}/races/{rid}/status/setup")
    assert r.status_code in (401, 403)
