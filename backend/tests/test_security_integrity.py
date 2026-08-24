"""Priority-1 security & data-integrity live tests.

Runs against the compose stack like the rest of the live suite (conftest.py).
Covers the three pillars of the security upgrade:

1. Cross-workspace tenancy — a full matrix of GET/POST/PUT/DELETE attempts by
   Club A staff against Club B's series, races, boats, standings, snapshots,
   locking and validation. Every attempt must be denied (403/404), and
   unfiltered list endpoints must never leak another club's rows.

2. Optimistic concurrency — two scorers load version N; the first write bumps
   it to N+1; the second write with the stale expected_version gets 409 and
   the first writer's change stays intact. Exercised for race results, race
   status, series config and boats.

3. FINAL/ARCHIVED immutability — a locked season rejects every normal
   mutation, serves standings from its frozen snapshot even after live boat
   identity/handicap data changes, records the scoring-engine version, and
   the ARCHIVED terminal state can only be escaped through the audited
   administrator unlock-and-correction flow (which produces a new version).

Nothing outside the dedicated test clubs is ever touched; locked seasons are
always unlocked in cleanup so teardown can delete them.
"""
import uuid
from datetime import datetime, timezone

import pytest
import requests

from conftest import (API, WEBMASTER_PASSCODE, TEST_OFFICER_PIN, TEST_ADMIN_PIN,
                      club_user_username, login, h)

YEAR = datetime.now(timezone.utc).year


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def intruder_club(webmaster_token):
    """A second, fully-populated club (Club B) that Club A staff must never
    be able to reach. Created by the webmaster; torn down at module end."""
    r = requests.post(f"{API}/clubs", json={
        "name": f"Intruder Club {uuid.uuid4().hex[:6]}", "color": "#654321",
    }, headers=h(webmaster_token))
    assert r.status_code == 200, r.text
    club = r.json()
    for role, pin in (("officer", TEST_OFFICER_PIN), ("admin", TEST_ADMIN_PIN)):
        r = requests.post(f"{API}/users", json={
            "club_id": club["id"], "role": role,
            "username": club_user_username(role, club["id"]),
            "name": f"Intruder {role}", "passcode": pin,
        }, headers=h(webmaster_token))
        assert r.status_code == 200, r.text
    admin_tok = login("admin", club_user_username("admin", club["id"]),
                      TEST_ADMIN_PIN, club["id"])["token"]
    r = requests.post(f"{API}/classes", json={"name": "Intruder Fleet", "default_start_time": "10:30"},
                      headers=h(admin_tok))
    assert r.status_code == 200, r.text
    cls = r.json()
    r = requests.post(f"{API}/series", json={
        "name": "Intruder Series", "class_id": cls["id"], "year": YEAR,
        "discards": 1, "included_in_overall": True, "order": 1,
    }, headers=h(admin_tok))
    assert r.status_code == 200, r.text
    series = r.json()
    boats = []
    for i, (nm, sl) in enumerate([("B One", "B1"), ("B Two", "B2"), ("B Three", "B3")], start=1):
        r = requests.post(f"{API}/boats", json={
            "name": nm, "sail_no": sl, "class_id": cls["id"], "helm": f"H{i}",
            "year": YEAR, "active": True}, headers=h(admin_tok))
        assert r.status_code == 200, r.text
        boats.append(r.json())
    yield {
        "club": club, "class": cls, "series": series, "boats": boats,
        "admin_token": admin_tok,
    }
    # Teardown (never locked, so plain deletes work).
    for b in boats:
        requests.delete(f"{API}/boats/{b['id']}", headers=h(admin_tok))
    requests.delete(f"{API}/series/{series['id']}", headers=h(admin_tok))
    requests.delete(f"{API}/classes/{cls['id']}", headers=h(admin_tok))
    requests.delete(f"{API}/clubs/{club['id']}", headers=h(webmaster_token))


def _setup_series(club_admin_token, club_officer_token):
    """A dedicated class/series/fleet with two published races (Club A)."""
    r = requests.post(f"{API}/classes", json={"name": "Integrity Class", "default_start_time": "10:30"},
                      headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    cls = r.json()
    r = requests.post(f"{API}/series", json={
        "name": "Integrity Series", "class_id": cls["id"], "year": YEAR,
        "discards": 1, "included_in_overall": True, "order": 1,
    }, headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    series = r.json()
    boats = []
    for i, (nm, sl) in enumerate([("I One", "I1"), ("I Two", "I2"), ("I Three", "I3")], start=1):
        r = requests.post(f"{API}/boats", json={
            "name": nm, "sail_no": sl, "class_id": cls["id"], "helm": f"H{i}",
            "year": YEAR, "active": True}, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        boats.append(r.json())
    race_ids = []
    for rn in (1, 2):
        r = requests.post(f"{API}/races", json={
            "date": f"{YEAR}-08-{rn:02d}", "class_id": cls["id"], "series_id": series["id"],
            "race_number": rn, "start_time": "10:30"}, headers=h(club_officer_token))
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        race_ids.append(rid)
        requests.post(f"{API}/races/{rid}/select-boats", json={"boat_ids": [b["id"] for b in boats]},
                      headers=h(club_officer_token))
        for b in boats:
            requests.post(f"{API}/races/{rid}/finish", json={"boat_id": b["id"]},
                          headers=h(club_officer_token))
        requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))
    return cls, series, boats, race_ids


def _unlock_and_cleanup(cls, series, boats, race_ids, club_admin_token, club_officer_token):
    requests.post(f"{API}/series/{series['id']}/unlock",
                  json={"confirm": True, "reason": "test cleanup"}, headers=h(club_admin_token))
    for rid in race_ids:
        requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))
    requests.delete(f"{API}/series/{series['id']}", headers=h(club_admin_token))
    requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))


def _assert_denied(r):
    assert r.status_code in (403, 404), f"expected denial, got {r.status_code}: {r.text}"


# ---------------------------------------------------------------------------
# 1. Cross-workspace tenancy
# ---------------------------------------------------------------------------
class TestCrossWorkspaceMatrix:
    def test_club_a_cannot_read_or_write_club_b_resources(self, test_club, club_admin_token,
                                                          club_officer_token, intruder_club):
        b = intruder_club
        b_class, b_series, b_boats = b["class"]["id"], b["series"]["id"], b["boats"]
        b_race = None  # created below (needs club B officer login)
        b_officer_tok = login("officer", club_user_username("officer", b["club"]["id"]),
                              TEST_OFFICER_PIN, b["club"]["id"])["token"]
        r = requests.post(f"{API}/races", json={
            "date": f"{YEAR}-09-01", "class_id": b_class, "series_id": b_series,
            "race_number": 1, "start_time": "10:30"}, headers=h(b_officer_tok))
        assert r.status_code == 200, r.text
        b_race = r.json()["id"]

        # ---- Club A admin tries every verb against Club B's series ----
        _assert_denied(requests.get(f"{API}/series", params={"class_id": b_class}, headers=h(club_admin_token)))
        _assert_denied(requests.put(f"{API}/series/{b_series}", json={
            "name": "Hijack", "class_id": b_class, "year": YEAR, "discards": 0,
            "included_in_overall": True, "order": 1}, headers=h(club_admin_token)))
        _assert_denied(requests.delete(f"{API}/series/{b_series}", headers=h(club_admin_token)))
        _assert_denied(requests.post(f"{API}/series/{b_series}/lock",
                                     json={"confirm": True, "reason": "hijack"}, headers=h(club_admin_token)))
        _assert_denied(requests.post(f"{API}/series/{b_series}/unlock",
                                     json={"confirm": True, "reason": "hijack"}, headers=h(club_admin_token)))
        _assert_denied(requests.post(f"{API}/series/{b_series}/archive",
                                     json={"confirm": True, "reason": "hijack"}, headers=h(club_admin_token)))
        _assert_denied(requests.get(f"{API}/series/{b_series}/snapshots", headers=h(club_admin_token)))

        # ---- Club A admin/officer tries Club B's races ----
        _assert_denied(requests.get(f"{API}/races/{b_race}", headers=h(club_admin_token)))
        _assert_denied(requests.get(f"{API}/races", params={"series_id": b_series}, headers=h(club_admin_token)))
        _assert_denied(requests.get(f"{API}/races", params={"class_id": b_class}, headers=h(club_admin_token)))
        _assert_denied(requests.put(f"{API}/races/{b_race}/result/{b_boats[0]['id']}",
                                    json={"code": "DSQ"}, headers=h(club_officer_token)))
        _assert_denied(requests.post(f"{API}/races/{b_race}/finish",
                                     json={"boat_id": b_boats[0]["id"]}, headers=h(club_officer_token)))
        _assert_denied(requests.post(f"{API}/races/{b_race}/select-boats",
                                     json={"boat_ids": [b_boats[0]["id"]]}, headers=h(club_officer_token)))
        _assert_denied(requests.post(f"{API}/races/{b_race}/start",
                                     json={"start_time": None}, headers=h(club_officer_token)))
        _assert_denied(requests.put(f"{API}/races/{b_race}/notifications",
                                    json={"course": "x"}, headers=h(club_officer_token)))
        _assert_denied(requests.post(f"{API}/races/{b_race}/status/published", headers=h(club_officer_token)))
        _assert_denied(requests.delete(f"{API}/races/{b_race}", headers=h(club_officer_token)))
        _assert_denied(requests.get(f"{API}/races/{b_race}/validation", headers=h(club_officer_token)))

        # ---- Club A admin tries Club B's boats ----
        _assert_denied(requests.get(f"{API}/boats", params={"class_id": b_class}, headers=h(club_admin_token)))
        _assert_denied(requests.put(f"{API}/boats/{b_boats[0]['id']}", json={
            "name": "Stolen", "sail_no": "X1", "class_id": b_class, "helm": "X",
            "year": YEAR, "active": True}, headers=h(club_admin_token)))
        _assert_denied(requests.delete(f"{API}/boats/{b_boats[0]['id']}", headers=h(club_admin_token)))

        # ---- Standings are scoped too ----
        _assert_denied(requests.get(f"{API}/standings/series/{b_series}", headers=h(club_admin_token)))
        _assert_denied(requests.get(f"{API}/standings/overall", params={"class_id": b_class, "year": YEAR},
                                    headers=h(club_admin_token)))

        # ---- Unfiltered lists never leak Club B rows ----
        a_races = requests.get(f"{API}/races", headers=h(club_admin_token)).json()
        assert all(r["id"] != b_race for r in a_races)
        a_boats = requests.get(f"{API}/boats", headers=h(club_admin_token)).json()
        assert all(r["id"] != b_boats[0]["id"] for r in a_boats)
        a_series = requests.get(f"{API}/series", headers=h(club_admin_token)).json()
        assert all(s["id"] != b_series for s in a_series)

        # ---- And the reverse: Club B staff cannot touch Club A's club ----
        _assert_denied(requests.put(f"{API}/clubs/{test_club['id']}",
                                    json={"name": "Nope"}, headers=h(b_officer_tok)))
        _assert_denied(requests.delete(f"{API}/clubs/{test_club['id']}", headers=h(b_officer_tok)))


# ---------------------------------------------------------------------------
# 2. Optimistic concurrency control
# ---------------------------------------------------------------------------
class TestOptimisticConcurrency:
    def test_race_result_stale_write_rejected_and_first_change_kept(self, club_admin_token, club_officer_token):
        cls, series, boats, race_ids = _setup_series(club_admin_token, club_officer_token)
        try:
            rid, bid = race_ids[0], boats[0]["id"]
            # Both scorers load the race at its current version.
            r = requests.get(f"{API}/races/{rid}", headers=h(club_officer_token)).json()
            v1 = r["version"]

            # Scorer A writes with the loaded version -> 200, version bumps by one.
            r = requests.put(f"{API}/races/{rid}/result/{bid}", json={"code": "DSQ", "expected_version": v1},
                             headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            assert r.json()["version"] == v1 + 1

            # Scorer B, still holding the old version, writes -> 409, A's change intact.
            r = requests.put(f"{API}/races/{rid}/result/{bid}", json={"code": "RET", "expected_version": v1},
                             headers=h(club_officer_token))
            assert r.status_code == 409, r.text
            fresh = requests.get(f"{API}/races/{rid}", headers=h(club_officer_token)).json()
            assert fresh["version"] == v1 + 1
            entry = next(x for x in fresh["results"] if x["boat_id"] == bid)
            assert entry["code"] == "DSQ"  # A's write survived
        finally:
            _unlock_and_cleanup(cls, series, boats, race_ids, club_admin_token, club_officer_token)

    def test_race_status_and_boat_series_occ(self, club_admin_token, club_officer_token):
        cls, series, boats, race_ids = _setup_series(club_admin_token, club_officer_token)
        try:
            # Race status transition (expected_version as a query parameter).
            rid = race_ids[0]
            v1 = requests.get(f"{API}/races/{rid}", headers=h(club_officer_token)).json()["version"]
            r = requests.post(f"{API}/races/{rid}/status/provisional?expected_version={v1}",
                              headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            assert r.json()["version"] == v1 + 1
            r = requests.post(f"{API}/races/{rid}/status/provisional?expected_version={v1}",
                              headers=h(club_officer_token))
            assert r.status_code == 409, r.text

            # Series config OCC.
            sid = series["id"]
            r = requests.get(f"{API}/series", params={"class_id": cls["id"], "year": YEAR},
                             headers=h(club_admin_token)).json()
            assert next(s for s in r if s["id"] == sid)["version"] == 1
            body = {"name": "Integrity Series", "class_id": cls["id"], "year": YEAR,
                    "discards": 2, "included_in_overall": True, "order": 1, "expected_version": 1}
            r = requests.put(f"{API}/series/{sid}", json=body, headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            assert r.json()["version"] == 2
            r = requests.put(f"{API}/series/{sid}", json=body, headers=h(club_admin_token))
            assert r.status_code == 409, r.text

            # Boat OCC.
            bid = boats[0]["id"]
            body = {"name": "I One", "sail_no": "I1", "class_id": cls["id"], "helm": "H1",
                    "year": YEAR, "active": True, "expected_version": 1}
            r = requests.put(f"{API}/boats/{bid}", json=body, headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            assert r.json()["version"] == 2
            r = requests.put(f"{API}/boats/{bid}", json=body, headers=h(club_admin_token))
            assert r.status_code == 409, r.text

            # Lock/unlock OCC: locking bumps the series version, so an unlock
            # carrying the pre-lock version must be rejected.
            r = requests.get(f"{API}/series", params={"class_id": cls["id"], "year": YEAR},
                             headers=h(club_admin_token)).json()
            pre_lock_version = next(s for s in r if s["id"] == sid)["version"]
            r = requests.post(f"{API}/series/{sid}/lock",
                              json={"confirm": True, "reason": "OCC test", "expected_version": pre_lock_version},
                              headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            r = requests.post(f"{API}/series/{sid}/unlock",
                              json={"confirm": True, "reason": "OCC test", "expected_version": pre_lock_version},
                              headers=h(club_admin_token))
            assert r.status_code == 409, r.text
            r = requests.post(f"{API}/series/{sid}/unlock",
                              json={"confirm": True, "reason": "OCC test", "expected_version": pre_lock_version + 1},
                              headers=h(club_admin_token))
            assert r.status_code == 200, r.text
        finally:
            _unlock_and_cleanup(cls, series, boats, race_ids, club_admin_token, club_officer_token)


# ---------------------------------------------------------------------------
# 3. FINAL / ARCHIVED immutability
# ---------------------------------------------------------------------------
class TestFinalisationImmutability:
    def test_locked_season_frozen_against_live_boat_and_handicap_changes(self, club_admin_token, club_officer_token):
        cls, series, boats, race_ids = _setup_series(club_admin_token, club_officer_token)
        sid = series["id"]
        try:
            r = requests.post(f"{API}/series/{sid}/lock",
                              json={"confirm": True, "reason": "Season finalised"},
                              headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            assert r.json()["version"] == 1

            frozen = requests.get(f"{API}/standings/series/{sid}").json()
            assert frozen.get("locked") is True and frozen["snapshot_version"] == 1
            assert frozen.get("scoring_engine_version")
            assert frozen.get("scoring_rules_version")
            frozen_names = {row["boat_id"]: row["boat_name"] for row in frozen["standings"]}
            frozen_nets = {row["boat_id"]: row["net"] for row in frozen["standings"]}

            # Engine + rules versions are recorded in the snapshot history too.
            snaps = requests.get(f"{API}/series/{sid}/snapshots", headers=h(club_admin_token)).json()
            assert snaps[0]["engine_version"] == frozen["scoring_engine_version"]
            assert snaps[0]["scoring_rules_version"] == frozen["scoring_rules_version"]
            assert snaps[0]["status"] == "locked" and snaps[0]["locked_by"]

            # Live boat identity/handicap changes are allowed (they never touch
            # the frozen snapshot) but the served standings must not change.
            bid = boats[0]["id"]
            r = requests.put(f"{API}/boats/{bid}", json={
                "name": "Renamed After Lock", "sail_no": "ZZZ", "class_id": cls["id"],
                "helm": "New Helm", "year": YEAR, "active": True, "tcc": 1.05, "py": 900.0},
                headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            r = requests.get(f"{API}/standings/series/{sid}").json()
            assert {row["boat_id"]: row["boat_name"] for row in r["standings"]} == frozen_names
            assert {row["boat_id"]: row["net"] for row in r["standings"]} == frozen_nets

            # A second lock is refused — the season is already FINAL.
            r = requests.post(f"{API}/series/{sid}/lock",
                              json={"confirm": True, "reason": "again"}, headers=h(club_admin_token))
            assert r.status_code == 400
        finally:
            _unlock_and_cleanup(cls, series, boats, race_ids, club_admin_token, club_officer_token)

    def test_archive_terminal_state_and_correction_flow(self, club_admin_token, club_officer_token):
        cls, series, boats, race_ids = _setup_series(club_admin_token, club_officer_token)
        sid = series["id"]
        try:
            requests.post(f"{API}/series/{sid}/lock",
                          json={"confirm": True, "reason": "Final"}, headers=h(club_admin_token))
            # FINAL -> ARCHIVED (admin, confirm + reason).
            r = requests.post(f"{API}/series/{sid}/archive",
                              json={"confirm": True, "reason": "Season complete — archive"},
                              headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            served = requests.get(f"{API}/standings/series/{sid}").json()
            assert served.get("archived") is True and served.get("locked") is True
            snaps = requests.get(f"{API}/series/{sid}/snapshots", headers=h(club_admin_token)).json()
            assert snaps[0]["status"] == "archived"

            # Archived seasons are immutable through every normal route.
            r = requests.put(f"{API}/races/{race_ids[0]}/result/{boats[0]['id']}",
                             json={"code": "DSQ"}, headers=h(club_officer_token))
            assert r.status_code == 409
            r = requests.post(f"{API}/races/{race_ids[0]}/status/setup", headers=h(club_officer_token))
            assert r.status_code == 409
            r = requests.put(f"{API}/series/{sid}", json={
                "name": "Nope", "class_id": cls["id"], "year": YEAR, "discards": 9,
                "included_in_overall": True, "order": 1}, headers=h(club_admin_token))
            assert r.status_code == 409
            # Locking an archived season directly is refused — unlock first.
            r = requests.post(f"{API}/series/{sid}/lock",
                              json={"confirm": True, "reason": "x"}, headers=h(club_admin_token))
            assert r.status_code == 400

            # The audited correction path: unlock from ARCHIVED -> fix -> re-lock
            # creates a new version while preserving the archived one. The fix
            # must actually change the standings: swap race 2's top two places
            # (a genuine protest outcome) and re-score with no discard.
            r = requests.post(f"{API}/series/{sid}/unlock",
                              json={"confirm": True, "reason": "Genuine error in race 2"},
                              headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            r = requests.put(f"{API}/races/{race_ids[1]}/result/{boats[0]['id']}", json={"position": 2},
                             headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            r = requests.put(f"{API}/series/{sid}", json={
                "name": "Integrity Series", "class_id": cls["id"], "year": YEAR,
                "discards": 0, "included_in_overall": True, "order": 1,
                "expected_version": requests.get(f"{API}/series", params={"class_id": cls["id"], "year": YEAR},
                                                  headers=h(club_admin_token)).json()[0]["version"]},
                headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            r = requests.post(f"{API}/series/{sid}/lock",
                              json={"confirm": True, "reason": "Corrected"},
                              headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            assert r.json()["version"] == 2
            snaps = requests.get(f"{API}/series/{sid}/snapshots", headers=h(club_admin_token)).json()
            by_version = {s["version"]: s for s in snaps}
            assert by_version[1]["status"] == "superseded"  # preserved, never overwritten
            assert by_version[2]["status"] == "locked"
            assert by_version[2]["amendment"]["changes"]
        finally:
            _unlock_and_cleanup(cls, series, boats, race_ids, club_admin_token, club_officer_token)
