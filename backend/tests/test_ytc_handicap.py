"""Live-API test for the RYA Yacht Time Correction scoring option.

RYA YTC publishes a yardstick-form number (corrected = elapsed x 1000 / YTC),
but a YTC certificate is a separate document from a Portsmouth Yardstick one,
so a boat can hold both and the series' scoring mode decides which is used.

Runs against the compose stack like the rest of the live suite (see
conftest.py): the class, series, boats and race are created inside a dedicated
test club and torn down afterwards. The two boats carry deliberately
contradictory PY and YTC numbers, so the finishing order proves which
certificate the mode actually read.
"""
import requests
from datetime import datetime, timezone

from conftest import API, h

YEAR = datetime.now(timezone.utc).year
START = "10:00"
# Elapsed times: boat "slow" 1800 s, boat "fast" 2000 s.
SLOW_ELAPSED, FAST_ELAPSED = 1800, 2000
# YTC: slow 2250 corrected, fast 1667 -> fast wins.
# PY:  slow 1500 corrected, fast 2500 -> slow wins.
SLOW_PY, FAST_PY = 1200, 800
SLOW_YTC, FAST_YTC = 800, 1200


def _create_boat(token, class_id, name, sail_no, **ratings):
    r = requests.post(f"{API}/boats", json={
        "name": name, "sail_no": sail_no, "class_id": class_id, "helm": f"H {name}",
        "year": YEAR, "active": True, **ratings}, headers=h(token))
    assert r.status_code == 200, r.text
    return r.json()


def _set_elapsed(token, race_id, boat_id, seconds):
    """Record a finish time by elapsed duration — the officer console's own
    route, which re-sequences the race from the class ratings."""
    r = requests.put(f"{API}/races/{race_id}/result/{boat_id}",
                     json={"elapsed_seconds": seconds}, headers=h(token))
    assert r.status_code == 200, r.text
    return {res["boat_id"]: res["position"] for res in r.json()["results"]}


class TestSeparateRatingSeries:
    """A club can run one IRC series and one YTC series for the same class. A
    boat holding only one certificate is scored only in that series — she does
    not appear in the other system's table merely because she sailed the race.
    """

    def test_a_boat_without_a_certificate_is_not_scored_in_that_series(
            self, test_club, club_admin_token, club_officer_token):
        cls = requests.post(f"{API}/classes", json={
            "name": "Two Systems Class", "default_start_time": START,
            "scoring_mode": "irc"}, headers=h(club_admin_token)).json()
        boats, races, series_docs = [], [], []
        try:
            irc_boat = _create_boat(club_admin_token, cls["id"], "Irc Boat", "IR1", tcc=1.0)
            ytc_boat = _create_boat(club_admin_token, cls["id"], "Ytc Boat", "YT1", ytc=1000)
            boats = [irc_boat, ytc_boat]
            for i, (name, mode) in enumerate((("Two Systems IRC", "irc"),
                                              ("Two Systems YTC", "ytc"))):
                series = requests.post(f"{API}/series", json={
                    "name": name, "class_id": cls["id"], "year": YEAR,
                    "scoring_mode": mode, "discards": 0, "order": i + 1},
                    headers=h(club_admin_token)).json()
                series_docs.append(series)
                race = requests.post(f"{API}/races", json={
                    "date": f"{YEAR}-05-0{i + 2}", "class_id": cls["id"],
                    "series_id": series["id"], "race_number": 1, "start_time": START},
                    headers=h(club_officer_token)).json()
                races.append(race["id"])
                # Both boats sign on and sail the same race: one holds a TCC,
                # the other a YTC number, so each series can rate only its own.
                requests.post(f"{API}/races/{race['id']}/select-boats",
                              json={"boat_ids": [b["id"] for b in boats]},
                              headers=h(club_officer_token))
                _set_elapsed(club_officer_token, race["id"], irc_boat["id"], 1800)
                _set_elapsed(club_officer_token, race["id"], ytc_boat["id"], 1900)
                requests.post(f"{API}/races/{race['id']}/status/published",
                              headers=h(club_officer_token))

            irc_series, ytc_series = series_docs
            irc_table = requests.get(f"{API}/standings/series/{irc_series['id']}",
                                     headers=h(club_admin_token)).json()
            ytc_table = requests.get(f"{API}/standings/series/{ytc_series['id']}",
                                     headers=h(club_admin_token)).json()
            assert [r["sail_no"] for r in irc_table["standings"]] == ["IR1"], \
                f"the IRC series holds only boats with a TCC: {irc_table['standings']}"
            assert [r["sail_no"] for r in ytc_table["standings"]] == ["YT1"], \
                f"the YTC series holds only boats with a YTC number: {ytc_table['standings']}"

            # The race itself keeps both finishes — the boat this series cannot
            # rate simply has no place in it.
            irc_race = requests.get(f"{API}/races/{races[0]}",
                                    headers=h(club_officer_token)).json()
            pos = {r["boat_id"]: r["position"] for r in irc_race["results"]}
            assert pos[irc_boat["id"]] == 1
            assert pos[ytc_boat["id"]] is None
        finally:
            for rid in races:
                requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))
            for s in series_docs:
                requests.delete(f"{API}/series/{s['id']}", headers=h(club_admin_token))
            for b in boats:
                requests.delete(f"{API}/boats/{b['id']}", headers=h(club_admin_token))
            requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))


class TestYtcScoringOption:
    def test_series_scores_by_ytc_and_switching_to_py_reads_the_other_certificate(
            self, test_club, club_admin_token, club_officer_token):
        cls = requests.post(f"{API}/classes", json={
            "name": "YTC Flow Class", "default_start_time": START,
            "scoring_mode": "ytc"}, headers=h(club_admin_token)).json()
        assert cls["scoring_mode"] == "ytc", "the class accepts RYA YTC as its scoring system"
        boats, races = [], []
        try:
            slow = _create_boat(club_admin_token, cls["id"], "YTC Slow", "Y1",
                                py=SLOW_PY, ytc=SLOW_YTC)
            fast = _create_boat(club_admin_token, cls["id"], "YTC Fast", "Y2",
                                py=FAST_PY, ytc=FAST_YTC)
            boats = [slow, fast]
            # Both certificates round-trip, so Admin can enter a YTC number.
            listed = requests.get(f"{API}/boats", params={"class_id": cls["id"]},
                                  headers=h(club_admin_token)).json()
            assert {b["sail_no"]: (b["py"], b["ytc"]) for b in listed} == {
                "Y1": (SLOW_PY, SLOW_YTC), "Y2": (FAST_PY, FAST_YTC)}

            series = requests.post(f"{API}/series", json={
                "name": "YTC Flow Series", "class_id": cls["id"], "year": YEAR,
                "scoring_mode": "ytc", "discards": 0, "order": 1}, headers=h(club_admin_token)).json()
            assert series["scoring_mode"] == "ytc"
            race = requests.post(f"{API}/races", json={
                "date": f"{YEAR}-05-02", "class_id": cls["id"], "series_id": series["id"],
                "race_number": 1, "start_time": START}, headers=h(club_officer_token)).json()
            races = [race["id"]]
            requests.post(f"{API}/races/{race['id']}/select-boats",
                          json={"boat_ids": [b["id"] for b in boats]},
                          headers=h(club_officer_token))

            _set_elapsed(club_officer_token, race["id"], slow["id"], SLOW_ELAPSED)
            pos = _set_elapsed(club_officer_token, race["id"], fast["id"], FAST_ELAPSED)
            # YTC: fast 2000 x 1000/1200 = 1667 beats slow 1800 x 1000/800 = 2250.
            assert pos[fast["id"]] == 1 and pos[slow["id"]] == 2, \
                f"YTC corrected time should order fast first, got {pos}"

            # Switching the series to PY must re-score from the PY numbers:
            # slow 1500 beats fast 2500 — the opposite order, from the same
            # finish times.
            current = next(s for s in requests.get(f"{API}/series", params={"class_id": cls["id"]},
                                                   headers=h(club_admin_token)).json()
                           if s["id"] == series["id"])
            r = requests.put(f"{API}/series/{series['id']}", json={
                "name": current["name"], "class_id": cls["id"], "year": YEAR,
                "scoring_mode": "py", "discards": 0, "order": 1,
                "expected_version": current["version"]}, headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            _set_elapsed(club_officer_token, race["id"], slow["id"], SLOW_ELAPSED)
            pos = _set_elapsed(club_officer_token, race["id"], fast["id"], FAST_ELAPSED)
            assert pos[slow["id"]] == 1 and pos[fast["id"]] == 2, \
                f"PY corrected time should order slow first, got {pos}"

            standings = requests.get(f"{API}/standings/series/{series['id']}",
                                     headers=h(club_admin_token)).json()
            assert {row["boat_id"] for row in standings["standings"]} == {slow["id"], fast["id"]}
        finally:
            for rid in races:
                requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))
            for s in requests.get(f"{API}/series", params={"class_id": cls["id"]},
                                  headers=h(club_admin_token)).json():
                requests.delete(f"{API}/series/{s['id']}", headers=h(club_admin_token))
            for b in boats:
                requests.delete(f"{API}/boats/{b['id']}", headers=h(club_admin_token))
            requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))
