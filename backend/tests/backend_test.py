"""Backend API tests for sailing club racing app."""
import os
import pytest
import requests
from datetime import datetime, timezone

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://fleet-timer-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
YEAR = datetime.now(timezone.utc).year


@pytest.fixture(scope="session")
def officer_token():
    r = requests.post(f"{API}/auth/login", json={"role": "officer", "pin": "sail2026"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"role": "admin", "pin": "admin2026"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Auth ----------
class TestAuth:
    def test_officer_login(self):
        r = requests.post(f"{API}/auth/login", json={"role": "officer", "pin": "sail2026"})
        assert r.status_code == 200
        assert r.json()["role"] == "officer"
        assert isinstance(r.json()["token"], str)

    def test_admin_login(self):
        r = requests.post(f"{API}/auth/login", json={"role": "admin", "pin": "admin2026"})
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_bad_pin(self):
        r = requests.post(f"{API}/auth/login", json={"role": "officer", "pin": "wrong"})
        assert r.status_code == 401

    def test_me(self, officer_token):
        r = requests.get(f"{API}/auth/me", headers=h(officer_token))
        assert r.status_code == 200
        assert r.json()["role"] == "officer"

    def test_no_auth_protected(self):
        r = requests.post(f"{API}/classes", json={"name": "x"})
        assert r.status_code == 401

    def test_officer_cannot_admin(self, officer_token):
        r = requests.post(f"{API}/classes", json={"name": "x"}, headers=h(officer_token))
        assert r.status_code == 403


# ---------- Public reads ----------
class TestPublic:
    def test_classes(self):
        r = requests.get(f"{API}/classes")
        assert r.status_code == 200
        names = [c["name"] for c in r.json()]
        assert "Dragon" in names and "Sonata" in names and "Wayfarer" in names

    def test_series(self):
        r = requests.get(f"{API}/series")
        assert r.status_code == 200
        assert len(r.json()) >= 15

    def test_boats(self):
        r = requests.get(f"{API}/boats")
        assert r.status_code == 200
        assert len(r.json()) >= 10

    def test_rrs(self):
        r = requests.get(f"{API}/rrs-codes")
        assert r.status_code == 200
        codes = [c["code"] for c in r.json()]
        assert "DNC" in codes and "FINISHED" in codes and "DNE" in codes

    def test_notifications(self):
        r = requests.get(f"{API}/notifications")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- Admin CRUD ----------
class TestAdminCRUD:
    def test_boat_crud(self, admin_token):
        classes = requests.get(f"{API}/classes").json()
        cid = classes[0]["id"]
        payload = {"name": "TEST_Boat", "sail_no": "TEST99", "class_id": cid, "helm": "TEST helm", "year": YEAR, "active": True}
        r = requests.post(f"{API}/boats", json=payload, headers=h(admin_token))
        assert r.status_code == 200
        bid = r.json()["id"]
        # update
        payload["name"] = "TEST_Boat2"
        r = requests.put(f"{API}/boats/{bid}", json=payload, headers=h(admin_token))
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Boat2"
        # delete
        r = requests.delete(f"{API}/boats/{bid}", headers=h(admin_token))
        assert r.status_code == 200

    def test_class_crud(self, admin_token):
        r = requests.post(f"{API}/classes", json={"name": "TEST_Class", "default_start_time": "12:00"}, headers=h(admin_token))
        assert r.status_code == 200
        cid = r.json()["id"]
        r = requests.put(f"{API}/classes/{cid}", json={"name": "TEST_Class2", "default_start_time": "13:00"}, headers=h(admin_token))
        assert r.status_code == 200
        assert r.json()["default_start_time"] == "13:00"
        r = requests.delete(f"{API}/classes/{cid}", headers=h(admin_token))
        assert r.status_code == 200

    def test_series_crud(self, admin_token):
        classes = requests.get(f"{API}/classes").json()
        cid = classes[0]["id"]
        payload = {"name": "TEST_Series", "class_id": cid, "year": YEAR, "discards": 0, "included_in_overall": False, "order": 99}
        r = requests.post(f"{API}/series", json=payload, headers=h(admin_token))
        assert r.status_code == 200
        sid = r.json()["id"]
        payload["discards"] = 2
        r = requests.put(f"{API}/series/{sid}", json=payload, headers=h(admin_token))
        assert r.status_code == 200
        assert r.json()["discards"] == 2
        r = requests.delete(f"{API}/series/{sid}", headers=h(admin_token))
        assert r.status_code == 200


# ---------- Full race flow ----------
class TestRaceFlow:
    def test_full_race_lifecycle(self, officer_token):
        classes = requests.get(f"{API}/classes").json()
        # pick Sonata to avoid touching demo Dragon Early Spring race
        cls = next(c for c in classes if c["name"] == "Sonata")
        series_list = requests.get(f"{API}/series", params={"class_id": cls["id"], "year": YEAR}).json()
        series = next(s for s in series_list if s["name"] == "Late Spring")
        boats = requests.get(f"{API}/boats", params={"class_id": cls["id"], "year": YEAR}).json()
        assert len(boats) >= 3

        # Create race
        r = requests.post(f"{API}/races", json={
            "date": f"{YEAR}-05-15", "class_id": cls["id"], "series_id": series["id"],
            "race_number": 1, "start_time": "10:45"
        }, headers=h(officer_token))
        assert r.status_code == 200, r.text
        race = r.json()
        rid = race["id"]
        assert race["status"] == "setup"
        assert len(race["results"]) == len(boats)
        assert all(res["code"] == "DNC" for res in race["results"])

        # Notifications appear
        notifs = requests.get(f"{API}/notifications").json()
        assert any(n["race_id"] == rid for n in notifs)

        # Update notifications
        r = requests.put(f"{API}/races/{rid}/notifications", json={
            "course": "Windward-leeward", "life_jackets": True, "special_rules": "No spinnakers"
        }, headers=h(officer_token))
        assert r.status_code == 200
        assert r.json()["life_jackets"] is True

        # Select boats (all)
        boat_ids = [b["id"] for b in boats]
        r = requests.post(f"{API}/races/{rid}/select-boats", json={"boat_ids": boat_ids}, headers=h(officer_token))
        assert r.status_code == 200
        codes = {res["boat_id"]: res["code"] for res in r.json()["results"]}
        assert all(c == "DNS" for c in codes.values())

        # Record finishes for first 2
        r = requests.post(f"{API}/races/{rid}/finish", json={"boat_id": boat_ids[0]}, headers=h(officer_token))
        assert r.status_code == 200
        r = requests.post(f"{API}/races/{rid}/finish", json={"boat_id": boat_ids[1]}, headers=h(officer_token))
        assert r.status_code == 200
        race = r.json()
        positions = {res["boat_id"]: res["position"] for res in race["results"] if res["code"] == "FINISHED"}
        assert positions[boat_ids[0]] == 1 and positions[boat_ids[1]] == 2

        # Undo first finish - re-sequence
        r = requests.post(f"{API}/races/{rid}/undo-finish", json={"boat_id": boat_ids[0]}, headers=h(officer_token))
        assert r.status_code == 200
        race = r.json()
        finished = [res for res in race["results"] if res["code"] == "FINISHED"]
        assert len(finished) == 1
        assert finished[0]["position"] == 1
        assert finished[0]["boat_id"] == boat_ids[1]

        # Re-finish boat 0
        requests.post(f"{API}/races/{rid}/finish", json={"boat_id": boat_ids[0]}, headers=h(officer_token))
        # finish third boat if available
        if len(boat_ids) >= 3:
            requests.post(f"{API}/races/{rid}/finish", json={"boat_id": boat_ids[2]}, headers=h(officer_token))

        # Adjust: set boat[0] position to 3 and change code
        r = requests.put(f"{API}/races/{rid}/result/{boat_ids[0]}",
                         json={"position": 3, "code": "FINISHED"}, headers=h(officer_token))
        assert r.status_code == 200
        # Apply DSQ to boat[0]
        r = requests.put(f"{API}/races/{rid}/result/{boat_ids[0]}",
                         json={"code": "DSQ"}, headers=h(officer_token))
        assert r.status_code == 200
        assert next(res for res in r.json()["results"] if res["boat_id"] == boat_ids[0])["code"] == "DSQ"

        # provisional
        r = requests.post(f"{API}/races/{rid}/status/provisional", headers=h(officer_token))
        assert r.status_code == 200
        assert r.json()["status"] == "provisional"

        # publish
        r = requests.post(f"{API}/races/{rid}/status/published", headers=h(officer_token))
        assert r.status_code == 200
        assert r.json()["status"] == "published"

        # Notification should no longer include it
        notifs = requests.get(f"{API}/notifications").json()
        assert not any(n["race_id"] == rid for n in notifs)

        # Standings
        r = requests.get(f"{API}/standings/series/{series['id']}")
        assert r.status_code == 200
        st = r.json()
        assert st["race_count"] >= 1
        assert len(st["standings"]) >= len(boats)
        # Boat b[1] should be rank 1 (won since b[0] DSQ'd)
        winner = st["standings"][0]
        assert winner["boat_id"] == boat_ids[1]

        # Overall
        r = requests.get(f"{API}/standings/overall", params={"class_id": cls["id"], "year": YEAR})
        assert r.status_code == 200
        overall = r.json()
        assert "Summer" not in overall["series_names"]  # excluded from overall
        assert "Late Spring" in overall["series_names"]

        # cleanup - delete race
        r = requests.delete(f"{API}/races/{rid}", headers=h(officer_token))
        assert r.status_code == 200


# ---------- Scoring specifics ----------
class TestScoring:
    def test_dnc_points_equal_entries_plus_1(self, officer_token):
        classes = requests.get(f"{API}/classes").json()
        cls = next(c for c in classes if c["name"] == "Wayfarer")
        series_list = requests.get(f"{API}/series", params={"class_id": cls["id"], "year": YEAR}).json()
        series = next(s for s in series_list if s["name"] == "Early Autumn")
        boats = requests.get(f"{API}/boats", params={"class_id": cls["id"], "year": YEAR}).json()
        r = requests.post(f"{API}/races", json={
            "date": f"{YEAR}-09-10", "class_id": cls["id"], "series_id": series["id"], "race_number": 1
        }, headers=h(officer_token))
        rid = r.json()["id"]
        # select 2 boats
        selected = [b["id"] for b in boats[:2]]
        requests.post(f"{API}/races/{rid}/select-boats", json={"boat_ids": selected}, headers=h(officer_token))
        # finish first
        requests.post(f"{API}/races/{rid}/finish", json={"boat_id": selected[0]}, headers=h(officer_token))
        requests.post(f"{API}/races/{rid}/status/published", headers=h(officer_token))

        st = requests.get(f"{API}/standings/series/{series['id']}").json()
        entries = len(boats)
        dnc_pts = entries + 1
        # non-selected boats should have net including DNC = entries+1
        winner = [row for row in st["standings"] if row["boat_id"] == selected[0]][0]
        assert winner["net"] == 1.0 or winner["net"] == winner["total"]  # only race
        non_sel = [row for row in st["standings"] if row["boat_id"] not in selected]
        assert all(row["total"] == dnc_pts for row in non_sel)

        requests.delete(f"{API}/races/{rid}", headers=h(officer_token))
