"""Bug-fix regression: editing a series schedule must sync existing race dates.
Runs inside the dedicated test club (see conftest.py) — the series and races
are created fresh per test, so no seed data is required or mutated."""

import uuid
import requests
from datetime import datetime, timezone

from conftest import API, h

YEAR = datetime.now(timezone.utc).year


def _make_series(club_admin_token, club_officer_token, name="Sync Series"):
    """Create a class + series + boat + two published races. Each call gets
    its own class so no other test's fleet leaks in."""
    r = requests.post(f"{API}/classes", json={
        "name": f"Sync Class {uuid.uuid4().hex[:4]}", "default_start_time": "10:30"},
        headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    cls = r.json()
    r = requests.post(f"{API}/series", json={
        "name": name, "class_id": cls["id"], "year": YEAR,
        "discards": 0, "included_in_overall": True, "order": 4}, headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    series = r.json()
    # one boat, so creating races is possible
    r = requests.post(f"{API}/boats", json={
        "name": "Sync Boat", "sail_no": "SY1", "class_id": cls["id"],
        "helm": "S", "year": YEAR, "active": True}, headers=h(club_admin_token))
    boat = r.json()
    # two races: R1 on a fixed date, R2 published later
    for rn, date in ((1, f"{YEAR}-04-11"), (2, f"{YEAR}-04-18")):
        r = requests.post(f"{API}/races", json={
            "date": date, "class_id": cls["id"], "series_id": series["id"],
            "race_number": rn}, headers=h(club_officer_token))
        assert r.status_code == 200, r.text
        requests.post(f"{API}/races/{r.json()['id']}/select-boats", json={"boat_ids": [boat["id"]]},
                      headers=h(club_officer_token))
        requests.post(f"{API}/races/{r.json()['id']}/finish", json={"boat_id": boat["id"]},
                      headers=h(club_officer_token))
        requests.post(f"{API}/races/{r.json()['id']}/status/published", headers=h(club_officer_token))
    return series


class TestScheduleSync:
    def test_put_series_syncs_existing_race_date(self, club_admin_token, club_officer_token):
        series = _make_series(club_admin_token, club_officer_token)
        sid = series["id"]

        st = requests.get(f"{API}/standings/series/{sid}").json()
        assert st["race_count"] >= 1
        races = requests.get(f"{API}/races", params={"series_id": sid}).json()
        r1 = next(r for r in races if r["race_number"] == 1)
        original_date = r1["date"]
        new_date = f"{YEAR}-04-25" if original_date != f"{YEAR}-04-25" else f"{YEAR}-04-04"

        max_rn = max(r["race_number"] for r in races)
        planned = max(series.get("planned_races") or 0, max_rn)
        schedule = list(series.get("schedule") or [])
        while len(schedule) < planned:
            schedule.append("")
        schedule[0] = new_date

        payload = {
            "name": series["name"], "class_id": series["class_id"], "year": series["year"],
            "discards": series.get("discards", 0), "included_in_overall": series.get("included_in_overall", True),
            "order": series.get("order", 0), "planned_races": planned, "schedule": schedule,
        }
        r = requests.put(f"{API}/series/{sid}", json=payload, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        assert r.json()["schedule"][0] == new_date

        races2 = requests.get(f"{API}/races", params={"series_id": sid}).json()
        r1b = next(r for r in races2 if r["race_number"] == 1)
        assert r1b["date"] == new_date, f"Race R1 date not synced. Got {r1b['date']}"

        st2 = requests.get(f"{API}/standings/series/{sid}").json()
        r1_meta = next(rm for rm in st2["races"] if rm["race_number"] == 1)
        assert r1_meta["date"] == new_date
        assert st2["schedule"][0] == new_date

        pre = {(row["boat_id"], row["total"], row["net"]) for row in st["standings"]}
        post = {(row["boat_id"], row["total"], row["net"]) for row in st2["standings"]}
        assert pre == post, "Scoring changed after date edit - dates must not affect points"

    def test_put_series_schedule_slot_with_no_race_persists(self, club_admin_token, club_officer_token):
        series = _make_series(club_admin_token, club_officer_token)
        sid = series["id"]
        races = requests.get(f"{API}/races", params={"series_id": sid}).json()
        max_rn = max((r["race_number"] for r in races), default=0)
        planned = max(series.get("planned_races") or 0, max_rn + 2)
        cur = requests.get(f"{API}/series", params={"class_id": series["class_id"], "year": YEAR}).json()
        cur_series = next(s for s in cur if s["id"] == sid)
        schedule = list(cur_series.get("schedule") or [])
        while len(schedule) < planned:
            schedule.append("")
        future_idx = planned - 1
        future_date = f"{YEAR}-11-28"
        schedule[future_idx] = future_date

        payload = {
            "name": cur_series["name"], "class_id": cur_series["class_id"], "year": cur_series["year"],
            "discards": cur_series.get("discards", 0), "included_in_overall": cur_series.get("included_in_overall", True),
            "order": cur_series.get("order", 0), "planned_races": planned, "schedule": schedule,
        }
        r = requests.put(f"{API}/series/{sid}", json=payload, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        assert r.json()["schedule"][future_idx] == future_date

        races2 = requests.get(f"{API}/races", params={"series_id": sid}).json()
        assert not any(rr["race_number"] == future_idx + 1 for rr in races2)

        st = requests.get(f"{API}/standings/series/{sid}").json()
        assert st["schedule"][future_idx] == future_date

    def test_generate_schedule_preserves_sailed_dates_and_syncs(self, club_admin_token, club_officer_token):
        series = _make_series(club_admin_token, club_officer_token)
        sid = series["id"]
        races_before = requests.get(f"{API}/races", params={"series_id": sid}).json()
        sailed_dates = sorted(r["date"] for r in races_before)

        payload = {"start_date": f"{YEAR}-10-03", "count": len(races_before) + 2}
        r = requests.post(f"{API}/series/{sid}/generate-schedule", json=payload, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["schedule"][: len(sailed_dates)] == sailed_dates
        assert len(body["schedule"]) == len(races_before) + 2

        races_after = requests.get(f"{API}/races", params={"series_id": sid}).json()
        for rb in races_before:
            ra = next(r for r in races_after if r["id"] == rb["id"])
            assert ra["date"] == rb["date"]
