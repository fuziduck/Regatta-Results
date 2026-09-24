"""Live-API contract for rating divisions inside one class.

A fleet sometimes races under two rating systems at once — IRC boats and YTC
boats in the same class and the same series. A class can declare those
divisions; each boat joins one (by her own choice, else by the certificate she
holds), and she is then scored only against her own division.

Runs against the compose stack like the rest of the live suite (see
conftest.py): class, series, boats and races are created inside a dedicated
test club and torn down afterwards. The elapsed times are chosen so the
divisions' orders differ from each other AND from the order a mixed corrected
-time ranking would produce, so the finishing order proves the split happened.
"""
import requests
from datetime import datetime, timezone

from conftest import API, h

YEAR = datetime.now(timezone.utc).year
START = "10:00"
# Race 1 elapsed seconds and the corrected times they produce.
#   IRC division (TCC):   A 3600 x 1.05 = 3780, B 3800 x 0.95 = 3610  -> B, A
#   YTC division (YTC):   C 4200 x 1000/900 = 4667, D 4000 x 1000/1100 = 3636 -> D, C
# Mixed by corrected time the order would be B, D, A, C — so finished order
# alone cannot explain the result.
ELAPSED = {"A": 3600, "B": 3800, "C": 4200, "D": 4000}
DIVISIONS = [{"name": "IRC", "scoring_mode": "irc"},
             {"name": "YTC", "scoring_mode": "ytc"}]


def _boat(token, class_id, name, **fields):
    r = requests.post(f"{API}/boats", json={
        "name": name, "sail_no": name, "class_id": class_id,
        "helm": f"H {name}", "year": YEAR, "active": True, **fields},
        headers=h(token))
    assert r.status_code == 200, r.text
    return r.json()


def _finish(token, race_id, boat_id, seconds):
    """Record a finish by elapsed duration — the officer console's own route."""
    r = requests.put(f"{API}/races/{race_id}/result/{boat_id}",
                     json={"elapsed_seconds": seconds}, headers=h(token))
    assert r.status_code == 200, r.text
    return {res["boat_id"]: res["position"] for res in r.json()["results"]}


def _table(payload, name):
    return next((t for t in payload.get("divisions") or [] if t["division_name"] == name), None)


class TestRatingDivisions:
    def test_each_division_is_scored_in_its_own_table(
            self, test_club, club_admin_token, club_officer_token):
        cls = requests.post(f"{API}/classes", json={
            "name": "Split Handicap Class", "default_start_time": START,
            "scoring_mode": "irc", "divisions": DIVISIONS},
            headers=h(club_admin_token)).json()
        assert [d["name"] for d in cls["divisions"]] == ["IRC", "YTC"], \
            "a class round-trips its rating divisions"
        boats, races = [], []
        try:
            # No boat names its division: A and B hold TCCs (IRC), C holds a
            # YTC number. D holds BOTH certificates and is assigned explicitly,
            # so an explicit choice beats what the certificates suggest.
            irc_a = _boat(club_admin_token, cls["id"], "A", tcc=1.05)
            irc_b = _boat(club_admin_token, cls["id"], "B", tcc=0.95)
            ytc_c = _boat(club_admin_token, cls["id"], "C", ytc=900)
            ytc_d = _boat(club_admin_token, cls["id"], "D", tcc=1.30, ytc=1100,
                          division="YTC")
            boats = [irc_a, irc_b, ytc_c, ytc_d]

            series = requests.post(f"{API}/series", json={
                "name": "Split Series", "class_id": cls["id"], "year": YEAR,
                "scoring_mode": "irc", "discards": 0, "order": 1},
                headers=h(club_admin_token)).json()
            race = requests.post(f"{API}/races", json={
                "date": f"{YEAR}-05-02", "class_id": cls["id"], "series_id": series["id"],
                "race_number": 1, "start_time": START}, headers=h(club_officer_token)).json()
            races = [race["id"]]
            requests.post(f"{API}/races/{race['id']}/select-boats",
                          json={"boat_ids": [b["id"] for b in boats]},
                          headers=h(club_officer_token))

            positions = {}
            for boat, key in ((irc_a, "A"), (irc_b, "B"), (ytc_c, "C"), (ytc_d, "D")):
                positions.update(_finish(club_officer_token, race["id"], boat["id"], ELAPSED[key]))
            requests.post(f"{API}/races/{race['id']}/status/published",
                          headers=h(club_officer_token))
            assert (positions[irc_b["id"]], positions[irc_a["id"]]) == (1, 2), \
                f"IRC places come from TCC under an IRC division, got {positions}"
            assert (positions[ytc_d["id"]], positions[ytc_c["id"]]) == (1, 2), \
                f"YTC places come from YTC numbers under a YTC division, got {positions}"

            # Race 2: only A, B and C sail. D's DNC must be measured against the
            # YTC fleet (2 + 1 = 3), not the whole class or the day's entries.
            race2 = requests.post(f"{API}/races", json={
                "date": f"{YEAR}-05-09", "class_id": cls["id"], "series_id": series["id"],
                "race_number": 2, "start_time": START}, headers=h(club_officer_token)).json()
            races.append(race2["id"])
            requests.post(f"{API}/races/{race2['id']}/select-boats",
                          json={"boat_ids": [b["id"] for b in (irc_a, irc_b, ytc_c)]},
                          headers=h(club_officer_token))
            for boat in (irc_a, irc_b, ytc_c):
                _finish(club_officer_token, race2["id"], boat["id"], ELAPSED[boat["name"]])
            requests.post(f"{API}/races/{race2['id']}/status/published",
                          headers=h(club_officer_token))

            standings = requests.get(f"{API}/standings/series/{series['id']}",
                                     headers=h(club_admin_token)).json()
            irc, ytc = _table(standings, "IRC"), _table(standings, "YTC")
            assert irc and ytc, f"the series reports one table per division: {standings.keys()}"
            assert irc["division_scoring_mode"] == "irc" and ytc["division_scoring_mode"] == "ytc"
            assert {r["sail_no"] for r in irc["standings"]} == {"A", "B"}
            assert {r["sail_no"] for r in ytc["standings"]} == {"C", "D"}
            # Each division is its own fleet: every table is rank 1..n.
            assert [r["rank"] for r in irc["standings"]] == [1, 2]
            assert [r["rank"] for r in ytc["standings"]] == [1, 2]
            d_row = next(r for r in ytc["standings"] if r["sail_no"] == "D")
            assert d_row["scores"][1] == {"points": 3.0, "code": "DNC", "discarded": False}, \
                f"DNC is scored against the YTC fleet (2 + 1), got {d_row['scores']}"
            # The whole-class table stays for per-boat history and exports.
            assert len(standings["standings"]) == 4

            # The championship is per division too.
            overall = requests.get(f"{API}/standings/overall", params={
                "class_id": cls["id"], "year": YEAR}, headers=h(club_admin_token)).json()
            assert [t["division_name"] for t in overall.get("divisions") or []] == ["IRC", "YTC"]
            assert all(len(t["standings"]) == 2 for t in overall["divisions"])
        finally:
            for rid in races:
                requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))
            for s in requests.get(f"{API}/series", params={"class_id": cls["id"]},
                                  headers=h(club_admin_token)).json():
                requests.delete(f"{API}/series/{s['id']}", headers=h(club_admin_token))
            for b in boats:
                requests.delete(f"{API}/boats/{b['id']}", headers=h(club_admin_token))
            requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))

    def test_one_division_is_not_a_split(self, test_club, club_admin_token):
        """A single division means the class is one fleet, exactly as before."""
        cls = requests.post(f"{API}/classes", json={
            "name": "Single Division Class", "scoring_mode": "irc",
            "divisions": [{"name": "IRC", "scoring_mode": "irc"}]},
            headers=h(club_admin_token)).json()
        try:
            series = requests.post(f"{API}/series", json={
                "name": "Single Series", "class_id": cls["id"], "year": YEAR,
                "scoring_mode": "irc", "order": 1}, headers=h(club_admin_token)).json()
            standings = requests.get(f"{API}/standings/series/{series['id']}",
                                     headers=h(club_admin_token)).json()
            assert "divisions" not in standings
            requests.delete(f"{API}/series/{series['id']}", headers=h(club_admin_token))
        finally:
            requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))
