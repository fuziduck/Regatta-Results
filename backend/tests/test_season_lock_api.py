"""Live-API tests for season locking and the configurable scoring engine.

These run against the compose stack like the rest of the live suite (see
conftest.py): a dedicated test club is created and torn down, and nothing
outside the test club is ever touched.

Covers: lock/unlock confirmation+reason requirements, the 409 mutation guard
on a locked season, standings served from the frozen snapshot after the rules
change, the amendment flow (unlock -> fix -> re-lock creates a new version),
and the per-race validation endpoint.
"""
import requests
from datetime import datetime, timezone

from conftest import API, TEST_OFFICER_PIN, TEST_ADMIN_PIN, club_user_username, login, h

YEAR = datetime.now(timezone.utc).year


def _setup(club_admin_token, club_officer_token):
    """A dedicated class/series/fleet with two published races."""
    r = requests.post(f"{API}/classes", json={"name": "Lock Flow Class", "default_start_time": "10:30"},
                      headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    cls = r.json()
    r = requests.post(f"{API}/series", json={
        "name": "Lock Flow Series", "class_id": cls["id"], "year": YEAR,
        "discards": 1, "included_in_overall": True, "order": 1,
        "scoring_config": {"tle": {"enabled": True, "method": "finishers_plus_1"}},
    }, headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    series = r.json()
    boats = []
    for i, (nm, sl) in enumerate([("L One", "L1"), ("L Two", "L2"), ("L Three", "L3")], start=1):
        r = requests.post(f"{API}/boats", json={
            "name": nm, "sail_no": sl, "class_id": cls["id"], "helm": f"H{i}",
            "year": YEAR, "active": True}, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        boats.append(r.json())
    race_ids = []
    for rn in (1, 2):
        r = requests.post(f"{API}/races", json={
            "date": f"{YEAR}-05-{rn:02d}", "class_id": cls["id"], "series_id": series["id"],
            "race_number": rn, "start_time": "10:30"}, headers=h(club_officer_token))
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        race_ids.append(rid)
        requests.post(f"{API}/races/{rid}/select-boats", json={"boat_ids": [b["id"] for b in boats]},
                      headers=h(club_officer_token))
        for pos, b in enumerate(boats, start=1):
            requests.post(f"{API}/races/{rid}/finish", json={"boat_id": b["id"]}, headers=h(club_officer_token))
        requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))
    return cls, series, boats, race_ids


def _cleanup(cls, series, boats, race_ids, club_admin_token, club_officer_token):
    for rid in race_ids:
        requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))
    requests.delete(f"{API}/series/{series['id']}", headers=h(club_admin_token))
    requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))


class TestSeasonLockApi:
    def test_lock_requires_confirmation_and_reason(self, club_admin_token, club_officer_token):
        cls, series, boats, race_ids = _setup(club_admin_token, club_officer_token)
        try:
            r = requests.post(f"{API}/series/{series['id']}/lock", json={"confirm": False, "reason": "x"},
                              headers=h(club_admin_token))
            assert r.status_code == 400
            r = requests.post(f"{API}/series/{series['id']}/lock", json={"confirm": True, "reason": ""},
                              headers=h(club_admin_token))
            assert r.status_code == 400
            # a race officer cannot lock a season
            r = requests.post(f"{API}/series/{series['id']}/lock",
                              json={"confirm": True, "reason": "Final"}, headers=h(club_officer_token))
            assert r.status_code == 403
        finally:
            _cleanup(cls, series, boats, race_ids, club_admin_token, club_officer_token)

    def test_lock_then_mutations_rejected_and_standings_frozen(self, club_admin_token, club_officer_token):
        cls, series, boats, race_ids = _setup(club_admin_token, club_officer_token)
        try:
            r = requests.post(f"{API}/series/{series['id']}/lock",
                              json={"confirm": True, "reason": "Season finalised"},
                              headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            assert r.json()["version"] == 1
            sid = series["id"]

            frozen = requests.get(f"{API}/standings/series/{sid}").json()
            assert frozen.get("locked") is True and frozen["snapshot_version"] == 1
            frozen_nets = {row["boat_id"]: row["net"] for row in frozen["standings"]}

            # Every normal mutation is rejected with 409 (race-level via the
            # officer role; series-level via the admin role so the request gets
            # past the role check and actually hits the lock guard).
            for method, url, body, token in (
                ("PUT", f"{API}/races/{race_ids[0]}/result/{boats[0]['id']}", {"code": "DSQ"}, club_officer_token),
                ("POST", f"{API}/races/{race_ids[0]}/finish", {"boat_id": boats[1]["id"]}, club_officer_token),
                ("POST", f"{API}/races/{race_ids[0]}/status/published", None, club_officer_token),
                ("DELETE", f"{API}/races/{race_ids[0]}", None, club_officer_token),
                ("PUT", f"{API}/series/{sid}", {"name": "Nope", "class_id": cls["id"], "year": YEAR,
                                                "discards": 5, "included_in_overall": True, "order": 1},
                 club_admin_token),
                ("DELETE", f"{API}/series/{sid}", None, club_admin_token),
            ):
                r = requests.request(method, url, json=body, headers=h(token))
                assert r.status_code == 409, f"{method} {url} should be 409, got {r.status_code}"

            # Boat delete in a locked season is rejected too.
            r = requests.delete(f"{API}/boats/{boats[0]['id']}", headers=h(club_admin_token))
            assert r.status_code == 409

            # Wreck the rules + results: served standings must stay frozen.
            requests.put(f"{API}/series/{sid}", json={
                "name": "Lock Flow Series", "class_id": cls["id"], "year": YEAR,
                "discards": 0, "included_in_overall": True, "order": 1,
                "scoring_config": {"a5_convention": "finishers"}}, headers=h(club_admin_token))
            r = requests.get(f"{API}/standings/series/{sid}").json()
            assert {row["boat_id"]: row["net"] for row in r["standings"]} == frozen_nets
            assert r["scoring_config"]["tle"]["method"] == "finishers_plus_1"
        finally:
            # unlock so cleanup is allowed
            requests.post(f"{API}/series/{series['id']}/unlock",
                          json={"confirm": True, "reason": "test cleanup"}, headers=h(club_admin_token))
            _cleanup(cls, series, boats, race_ids, club_admin_token, club_officer_token)

    def test_amendment_flow_creates_new_version(self, club_admin_token, club_officer_token):
        cls, series, boats, race_ids = _setup(club_admin_token, club_officer_token)
        try:
            sid = series["id"]
            requests.post(f"{API}/series/{sid}/lock", json={"confirm": True, "reason": "Final"},
                          headers=h(club_admin_token))
            # unlock (correction window)
            r = requests.post(f"{API}/series/{sid}/unlock",
                              json={"confirm": True, "reason": "Position error in race 2"},
                              headers=h(club_admin_token))
            assert r.status_code == 200
            # fix race 2: swap positions of boats 1 and 2, and re-score with no
            # discard (a 1-discard / 2-race series discards any single-race
            # change, so the amendment must also change the discard rule to
            # produce a real standings difference).
            r = requests.put(f"{API}/races/{race_ids[1]}/result/{boats[0]['id']}", json={"position": 2},
                             headers=h(club_officer_token))
            assert r.status_code == 200
            r = requests.put(f"{API}/series/{sid}", json={
                "name": "Lock Flow Series", "class_id": cls["id"], "year": YEAR,
                "discards": 0, "included_in_overall": True, "order": 1},
                headers=h(club_admin_token))
            assert r.status_code == 200
            # re-lock -> version 2 with an amendment record
            r = requests.post(f"{API}/series/{sid}/lock", json={"confirm": True, "reason": "Corrected"},
                              headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["version"] == 2
            assert body["amendment"]["changes"]

            snaps = requests.get(f"{API}/series/{sid}/snapshots", headers=h(club_admin_token)).json()
            assert len(snaps) == 2
            by_version = {s["version"]: s for s in snaps}
            assert by_version[1]["status"] == "superseded"   # preserved, never overwritten
            assert by_version[2]["status"] == "locked"
            assert by_version[2]["locked_by"]

            served = requests.get(f"{API}/standings/series/{sid}").json()
            assert served["snapshot_version"] == 2
        finally:
            requests.post(f"{API}/series/{sid}/unlock", json={"confirm": True, "reason": "test cleanup"},
                          headers=h(club_admin_token))
            _cleanup(cls, series, boats, race_ids, club_admin_token, club_officer_token)

    def test_validation_endpoint_flags_invalid_combos(self, club_admin_token, club_officer_token):
        cls, series, boats, race_ids = _setup(club_admin_token, club_officer_token)
        try:
            rid = race_ids[0]
            # DPI without the committee-entered points -> validation error, and
            # the result endpoint itself refuses to record it.
            r = requests.put(f"{API}/races/{rid}/result/{boats[0]['id']}", json={"code": "DPI"},
                             headers=h(club_officer_token))
            assert r.status_code == 400
            # with points + decision record it succeeds and is identifiable
            r = requests.put(f"{API}/races/{rid}/result/{boats[0]['id']}",
                             json={"code": "DPI", "penalty_points": 6.0,
                                   "dpi_decision_maker": "Protest Committee",
                                   "dpi_reason": "RRS 44.1(b)", "dpi_notes": "Two-turn penalty not taken"},
                             headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            entry = next(x for x in r.json()["results"] if x["boat_id"] == boats[0]["id"])
            assert entry["dpi_decision_maker"] == "Protest Committee"
            # validation now reports no error for this boat
            v = requests.get(f"{API}/races/{rid}/validation", headers=h(club_officer_token)).json()
            assert not [e for e in v["errors"] if "DPI" in e["message"]]
            # a non-finish code carrying a position is rejected by the API
            r = requests.put(f"{API}/races/{rid}/result/{boats[0]['id']}",
                             json={"code": "DNC", "position": 2}, headers=h(club_officer_token))
            assert r.status_code == 400
        finally:
            _cleanup(cls, series, boats, race_ids, club_admin_token, club_officer_token)
