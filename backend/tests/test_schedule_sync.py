"""Bug-fix regression: editing a series schedule must sync existing race dates."""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"role": "admin", "pin": "admin2026"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def H(t):
    return {"Authorization": f"Bearer {t}"}


def _find_series(name, class_name="Sonata"):
    classes = requests.get(f"{API}/classes").json()
    cls = next(c for c in classes if c["name"] == class_name)
    series_list = requests.get(f"{API}/series", params={"class_id": cls["id"], "year": 2026}).json()
    return next(s for s in series_list if s["name"] == name)


class TestScheduleSync:
    def test_put_series_syncs_existing_race_date(self, admin_token):
        series = _find_series("Early Spring")
        sid = series["id"]

        # baseline standings and races
        st = requests.get(f"{API}/standings/series/{sid}").json()
        assert st["race_count"] >= 1
        races = requests.get(f"{API}/races", params={"series_id": sid}).json()
        r1 = next(r for r in races if r["race_number"] == 1)
        original_date = r1["date"]
        new_date = "2026-04-18" if original_date == "2026-04-11" else "2026-04-11"

        # Build schedule of length >= max race_number
        max_rn = max(r["race_number"] for r in races)
        planned = max(series.get("planned_races") or 0, max_rn)
        schedule = list(series.get("schedule") or [])
        while len(schedule) < planned:
            schedule.append("")
        schedule[0] = new_date

        payload = {
            "name": series["name"],
            "class_id": series["class_id"],
            "year": series["year"],
            "discards": series.get("discards", 0),
            "included_in_overall": series.get("included_in_overall", True),
            "order": series.get("order", 0),
            "planned_races": planned,
            "schedule": schedule,
        }
        r = requests.put(f"{API}/series/{sid}", json=payload, headers=H(admin_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["schedule"][0] == new_date

        # Race document's date must have been synced
        races2 = requests.get(f"{API}/races", params={"series_id": sid}).json()
        r1b = next(r for r in races2 if r["race_number"] == 1)
        assert r1b["date"] == new_date, f"Race R1 date not synced. Got {r1b['date']}"

        # Standings must reflect new date in races[] and schedule[]
        st2 = requests.get(f"{API}/standings/series/{sid}").json()
        r1_meta = next(rm for rm in st2["races"] if rm["race_number"] == 1)
        assert r1_meta["date"] == new_date
        assert st2["schedule"][0] == new_date

        # Regression: scoring net/total shouldn't have changed due to date edit
        # Compare set of (boat_id, total) tuples pre and post
        pre = {(row["boat_id"], row["total"], row["net"]) for row in st["standings"]}
        post = {(row["boat_id"], row["total"], row["net"]) for row in st2["standings"]}
        assert pre == post, "Scoring changed after date edit - dates must not affect points"

    def test_put_series_schedule_slot_with_no_race_persists(self, admin_token):
        series = _find_series("Early Spring")
        sid = series["id"]
        races = requests.get(f"{API}/races", params={"series_id": sid}).json()
        max_rn = max((r["race_number"] for r in races), default=0)
        # Make schedule longer than existing races (future TBC slot)
        planned = max(series.get("planned_races") or 0, max_rn + 2)
        cur = requests.get(f"{API}/series", params={"class_id": series["class_id"], "year": 2026}).json()
        cur_series = next(s for s in cur if s["id"] == sid)
        schedule = list(cur_series.get("schedule") or [])
        while len(schedule) < planned:
            schedule.append("")
        future_idx = planned - 1  # last (future) slot, no race exists
        future_date = "2026-11-28"
        schedule[future_idx] = future_date

        payload = {
            "name": cur_series["name"],
            "class_id": cur_series["class_id"],
            "year": cur_series["year"],
            "discards": cur_series.get("discards", 0),
            "included_in_overall": cur_series.get("included_in_overall", True),
            "order": cur_series.get("order", 0),
            "planned_races": planned,
            "schedule": schedule,
        }
        r = requests.put(f"{API}/series/{sid}", json=payload, headers=H(admin_token))
        assert r.status_code == 200, r.text
        assert r.json()["schedule"][future_idx] == future_date

        # No race should exist for that race_number (schedule slot only)
        races2 = requests.get(f"{API}/races", params={"series_id": sid}).json()
        assert not any(rr["race_number"] == future_idx + 1 for rr in races2)

        # Standings schedule reflects new future date
        st = requests.get(f"{API}/standings/series/{sid}").json()
        assert st["schedule"][future_idx] == future_date

    def test_generate_schedule_preserves_sailed_dates_and_syncs(self, admin_token):
        # Use John Field Trophy (Dragon, 3 published races)
        series = _find_series("John Field Trophy", class_name="Dragon")
        sid = series["id"]
        races_before = requests.get(f"{API}/races", params={"series_id": sid}).json()
        sailed_dates = sorted(r["date"] for r in races_before)

        payload = {"start_date": "2026-10-03", "count": len(races_before) + 2}
        r = requests.post(f"{API}/series/{sid}/generate-schedule", json=payload, headers=H(admin_token))
        assert r.status_code == 200, r.text
        body = r.json()
        # First N slots must equal sailed dates (sorted); tail must be future Saturdays
        assert body["schedule"][: len(sailed_dates)] == sailed_dates
        assert len(body["schedule"]) == len(races_before) + 2

        # And existing races' dates unchanged (they equal schedule slots by construction)
        races_after = requests.get(f"{API}/races", params={"series_id": sid}).json()
        for rb in races_before:
            ra = next(r for r in races_after if r["id"] == rb["id"])
            assert ra["date"] == rb["date"]
