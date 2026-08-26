"""Live-API tests for the race-day mini-series split (POST /series/{id}/mini-split).

Runs against the compose stack like the rest of the live suite (see
conftest.py): a dedicated test club is created and torn down, and nothing
outside the test club is ever touched.

Covers: turning one planned race into a mini series (combined + additional
scoring), the extra sub-races being created, later races renumbering, the
combined standings showing ONE column with a drill-down, and the guards
(locked series, splitting a published slot, renumbering a published race).
"""
import requests
from datetime import datetime, timezone

from conftest import API, TEST_OFFICER_PIN, TEST_ADMIN_PIN, club_user_username, login, h

YEAR = datetime.now(timezone.utc).year


def _setup(club_admin_token, club_officer_token, planned=6):
    """A dedicated class + series (with schedule) + 3 boats, no races yet."""
    r = requests.post(f"{API}/classes", json={"name": "Split Flow Class", "default_start_time": "10:30"},
                      headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    cls = r.json()
    schedule = [f"{YEAR}-05-{d:02d}" for d in range(1, planned + 1)]
    r = requests.post(f"{API}/series", json={
        "name": "Split Flow Series", "class_id": cls["id"], "year": YEAR,
        "discards": 1, "included_in_overall": True, "order": 1,
        "planned_races": planned, "schedule": schedule,
    }, headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    series = r.json()
    boats = []
    for i, (nm, sl) in enumerate([("S One", "S1"), ("S Two", "S2"), ("S Three", "S3")], start=1):
        r = requests.post(f"{API}/boats", json={
            "name": nm, "sail_no": sl, "class_id": cls["id"], "helm": f"H{i}",
            "year": YEAR, "active": True}, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        boats.append(r.json())
    return cls, series, boats


def _cleanup(cls, series, boats, club_admin_token, club_officer_token):
    for race in requests.get(f"{API}/races", params={"series_id": series["id"]}, headers=h(club_officer_token)).json():
        requests.delete(f"{API}/races/{race['id']}", headers=h(club_officer_token))
    requests.delete(f"{API}/series/{series['id']}", headers=h(club_admin_token))
    for b in boats:
        requests.delete(f"{API}/boats/{b['id']}", headers=h(club_admin_token))
    requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))


class TestMiniSplitApi:
    def test_combined_split_creates_group_and_sub_races(self, club_admin_token, club_officer_token):
        cls, series, boats = _setup(club_admin_token, club_officer_token)
        try:
            r = requests.post(f"{API}/series/{series['id']}/mini-split", json={
                "race_number": 3, "count": 2, "name": "Morning Two", "scoring": "combined",
            }, headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["group"]["race_numbers"] == [3, 4]
            assert body["group"]["scoring"] == "combined"
            assert len(body["races"]) == 2
            nums = sorted(race["race_number"] for race in body["races"])
            assert nums == [3, 4]
            assert all(race["status"] == "setup" for race in body["races"])
            assert all(len(race["results"]) == 3 for race in body["races"])
            # Series now knows it is a mini series.
            fresh = requests.get(f"{API}/series", params={"class_id": cls["id"], "year": YEAR},
                                 headers=h(club_admin_token)).json()
            sr = next(s for s in fresh if s["id"] == series["id"])
            assert sr["mini_series"] is True
            assert sr["mini_series_groups"][0]["race_numbers"] == [3, 4]
            # Later planned races moved up: 6 planned -> 7 planned.
            assert sr["planned_races"] == 7
            assert sr["schedule"][2] == sr["schedule"][3]  # sub-races share the day
        finally:
            _cleanup(cls, series, boats, club_admin_token, club_officer_token)

    def test_additional_split_counts_each_race_separately(self, club_admin_token, club_officer_token):
        cls, series, boats = _setup(club_admin_token, club_officer_token)
        try:
            r = requests.post(f"{API}/series/{series['id']}/mini-split", json={
                "race_number": 1, "count": 3, "scoring": "additional",
            }, headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["group"]["race_numbers"] == [1, 2, 3]
            assert body["group"]["scoring"] == "additional"
            assert len(body["races"]) == 3
        finally:
            _cleanup(cls, series, boats, club_admin_token, club_officer_token)

    def test_existing_races_renumber_to_make_room(self, club_admin_token, club_officer_token):
        cls, series, boats = _setup(club_admin_token, club_officer_token)
        try:
            # Create race 5 (published) and race 6 (setup) ahead of time.
            r = requests.post(f"{API}/races", json={
                "date": f"{YEAR}-05-05", "class_id": cls["id"], "series_id": series["id"],
                "race_number": 5, "start_time": "10:30"}, headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            race5 = r.json()
            requests.post(f"{API}/races/{race5['id']}/status/published", headers=h(club_officer_token))
            # Splitting race 3 into 2 would renumber the published race 5 -> 6: blocked.
            r = requests.post(f"{API}/series/{series['id']}/mini-split", json={
                "race_number": 3, "count": 2, "scoring": "combined"}, headers=h(club_officer_token))
            assert r.status_code == 400, r.text
            assert "published" in r.json()["detail"].lower()
        finally:
            _cleanup(cls, series, boats, club_admin_token, club_officer_token)

    def test_cannot_split_published_slot_or_locked_series(self, club_admin_token, club_officer_token):
        cls, series, boats = _setup(club_admin_token, club_officer_token)
        try:
            r = requests.post(f"{API}/races", json={
                "date": f"{YEAR}-05-01", "class_id": cls["id"], "series_id": series["id"],
                "race_number": 1, "start_time": "10:30"}, headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            race1 = r.json()
            requests.post(f"{API}/races/{race1['id']}/status/published", headers=h(club_officer_token))
            r = requests.post(f"{API}/series/{series['id']}/mini-split", json={
                "race_number": 1, "count": 2, "scoring": "combined"}, headers=h(club_officer_token))
            assert r.status_code == 400, r.text
            assert "published" in r.json()["detail"].lower()
            # Locked series rejects the split.
            r = requests.post(f"{API}/series/{series['id']}/lock", json={"confirm": True, "reason": "test"},
                              headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            r = requests.post(f"{API}/series/{series['id']}/mini-split", json={
                "race_number": 2, "count": 2, "scoring": "combined"}, headers=h(club_officer_token))
            assert r.status_code == 409, r.text
        finally:
            _cleanup(cls, series, boats, club_admin_token, club_officer_token)

    def test_combined_split_shows_one_column_with_drill_down(self, club_admin_token, club_officer_token):
        """Score both sub-races, publish them, and the series standings must
        show ONE combined column while the mini view shows each race."""
        cls, series, boats = _setup(club_admin_token, club_officer_token)
        try:
            r = requests.post(f"{API}/series/{series['id']}/mini-split", json={
                "race_number": 1, "count": 2, "name": "Day", "scoring": "combined"},
                headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            races = sorted(r.json()["races"], key=lambda x: x["race_number"])
            # Score both races: S1 wins race 1, S2 wins race 2.
            for race, winner in zip(races, (boats[0], boats[1])):
                rid = race["id"]
                requests.post(f"{API}/races/{rid}/select-boats",
                              json={"boat_ids": [b["id"] for b in boats]}, headers=h(club_officer_token))
                for b in boats:
                    requests.post(f"{API}/races/{rid}/finish", json={"boat_id": b["id"]},
                                  headers=h(club_officer_token))
                # Winner gets the lowest finish time so it wins the race.
                requests.put(f"{API}/races/{rid}/result/{winner['id']}",
                             json={"position": 1}, headers=h(club_officer_token))
                requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))
            st = requests.get(f"{API}/standings/series/{series['id']}",
                              headers=h(club_officer_token)).json()
            # One combined column: races list shows the folded meta entry.
            assert len(st["races"]) == 1, st["races"]
            assert st["races"][0]["combined"] is True
            assert st["races"][0]["mini_races"] == 2
            # The mini detail view shows each race separately.
            mini = requests.get(f"{API}/standings/series/{series['id']}", params={"mini": 1},
                                headers=h(club_officer_token)).json()
            assert mini["mini_index"] == 1
            assert len(mini["races"]) == 2
        finally:
            _cleanup(cls, series, boats, club_admin_token, club_officer_token)
