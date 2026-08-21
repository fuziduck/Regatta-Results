"""Backend API tests: auth, webmaster club management, club isolation,
admin CRUD, the full race lifecycle, and RRS scoring — all inside a
dedicated test club (see conftest.py) so the suite never depends on or
mutates a real club's data."""

import base64
import requests
from datetime import datetime, timezone

from conftest import API, WEBMASTER_PIN, TEST_OFFICER_PIN, TEST_ADMIN_PIN, login, h

YEAR = datetime.now(timezone.utc).year


def _all_clubs():
    return requests.get(f"{API}/clubs").json()


def _other_club_id(test_club):
    return next(c["id"] for c in _all_clubs() if c["id"] != test_club["id"])


# ---------- Auth ----------
class TestAuth:
    def test_webmaster_login(self):
        r = requests.post(f"{API}/auth/login", json={"role": "webmaster", "pin": WEBMASTER_PIN})
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "webmaster"
        assert body["club_id"] is None
        assert isinstance(body["token"], str)

    def test_webmaster_bad_pin(self):
        r = requests.post(f"{API}/auth/login", json={"role": "webmaster", "pin": "wrong"})
        assert r.status_code == 401

    def test_unknown_role(self):
        r = requests.post(f"{API}/auth/login", json={"role": "crew", "pin": "x"})
        assert r.status_code == 401

    def test_club_login(self, test_club):
        for role, pin in (("officer", TEST_OFFICER_PIN), ("admin", TEST_ADMIN_PIN)):
            r = requests.post(f"{API}/auth/login", json={"role": role, "pin": pin, "club_id": test_club["id"]})
            assert r.status_code == 200, r.text
            assert r.json()["role"] == role
            assert r.json()["club_id"] == test_club["id"]
            assert r.json()["club_name"] == test_club["name"]

    def test_club_login_wrong_pin(self, test_club):
        r = requests.post(f"{API}/auth/login", json={"role": "officer", "pin": "nope", "club_id": test_club["id"]})
        assert r.status_code == 401

    def test_club_login_unknown_club(self):
        r = requests.post(f"{API}/auth/login", json={
            "role": "officer", "pin": TEST_OFFICER_PIN, "club_id": "00000000-0000-0000-0000-000000000000"})
        assert r.status_code == 404

    def test_me(self, club_officer_token, test_club):
        r = requests.get(f"{API}/auth/me", headers=h(club_officer_token))
        assert r.status_code == 200
        assert r.json()["role"] == "officer"
        assert r.json()["club_id"] == test_club["id"]
        assert r.json()["club_name"] == test_club["name"]

    def test_no_auth_protected(self):
        r = requests.post(f"{API}/classes", json={"name": "x"})
        assert r.status_code == 401

    def test_officer_cannot_admin(self, club_officer_token):
        r = requests.post(f"{API}/classes", json={"name": "x"}, headers=h(club_officer_token))
        assert r.status_code == 403


# ---------- Webmaster club management ----------
class TestWebmaster:
    def test_clubs_public_never_leaks_pins(self, test_club):
        clubs = _all_clubs()
        assert any(c["id"] == test_club["id"] for c in clubs)
        for c in clubs:
            assert "officer_pin" not in c and "admin_pin" not in c

    def test_clubs_manage_webmaster_only(self, webmaster_token, club_admin_token, test_club):
        r = requests.get(f"{API}/clubs/manage", headers=h(webmaster_token))
        assert r.status_code == 200
        mine = next(c for c in r.json() if c["id"] == test_club["id"])
        assert mine["officer_pin"] == TEST_OFFICER_PIN
        assert mine["admin_pin"] == TEST_ADMIN_PIN
        # a club admin may not read the passcodes
        r = requests.get(f"{API}/clubs/manage", headers=h(club_admin_token))
        assert r.status_code == 403

    def test_admin_cannot_create_update_delete_club(self, club_admin_token, test_club):
        for method, url, body in (
            ("POST", f"{API}/clubs", {"name": "Nope", "officer_pin": "1", "admin_pin": "2"}),
            ("PUT", f"{API}/clubs/{test_club['id']}", {"name": "Nope", "color": "#000000", "officer_pin": "1", "admin_pin": "2"}),
            ("DELETE", f"{API}/clubs/{test_club['id']}", None),
        ):
            r = requests.request(method, url, json=body, headers=h(club_admin_token))
            assert r.status_code == 403, f"{method} {url} should be 403 for admin"

    def test_webmaster_crud_club(self, webmaster_token):
        r = requests.post(f"{API}/clubs", json={
            "name": "Tmp Club", "color": "#111111", "officer_pin": "1111", "admin_pin": "2222"},
            headers=h(webmaster_token))
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        r = requests.put(f"{API}/clubs/{cid}", json={
            "name": "Tmp Club 2", "color": "#222222", "officer_pin": "3333", "admin_pin": "4444"},
            headers=h(webmaster_token))
        assert r.status_code == 200
        assert r.json()["name"] == "Tmp Club 2"
        # PINs are only readable via /clubs/manage (webmaster-only), never on /clubs
        manage = requests.get(f"{API}/clubs/manage", headers=h(webmaster_token)).json()
        updated = next(c for c in manage if c["id"] == cid)
        assert updated["officer_pin"] == "3333" and updated["admin_pin"] == "4444"
        r = requests.delete(f"{API}/clubs/{cid}", headers=h(webmaster_token))
        assert r.status_code == 200

    def test_webmaster_has_admin_and_officer_access(self, webmaster_token, test_class):
        # webmaster can mutate any club's data (admin-level boat create here)
        r = requests.post(f"{API}/boats", json={
            "name": "WM Boat", "sail_no": "WM1", "class_id": test_class["id"],
            "helm": "WM", "year": YEAR, "active": True},
            headers=h(webmaster_token))
        assert r.status_code == 200, r.text
        requests.delete(f"{API}/boats/{r.json()['id']}", headers=h(webmaster_token))

    def test_club_icon_upload_remove(self, test_club, club_admin_token, webmaster_token):
        # 1x1 transparent PNG
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
        cid = test_club["id"]
        # unauthorised -> 401
        r = requests.put(f"{API}/clubs/{cid}/icon", files={"file": ("icon.png", png, "image/png")})
        assert r.status_code == 401
        # the club's own admin can upload
        r = requests.put(f"{API}/clubs/{cid}/icon", files={"file": ("icon.png", png, "image/png")},
                         headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        assert r.json()["icon"].startswith("data:image/png;base64,")
        # public /clubs carries the icon
        club = next(c for c in _all_clubs() if c["id"] == cid)
        assert club["icon"].startswith("data:image/png;base64,")
        # non-image rejected
        r = requests.put(f"{API}/clubs/{cid}/icon", files={"file": ("x.txt", b"hello", "text/plain")},
                         headers=h(club_admin_token))
        assert r.status_code == 400
        # oversized rejected (513 KB)
        big = b"\x89PNG" + b"0" * (513 * 1024)
        r = requests.put(f"{API}/clubs/{cid}/icon", files={"file": ("big.png", big, "image/png")},
                         headers=h(club_admin_token))
        assert r.status_code == 400
        # webmaster can remove it
        r = requests.delete(f"{API}/clubs/{cid}/icon", headers=h(webmaster_token))
        assert r.status_code == 200
        assert "icon" not in r.json()
        club = next(c for c in _all_clubs() if c["id"] == cid)
        assert "icon" not in club

    def test_admin_cannot_set_other_club_icon(self, test_club, other_club_with_data, club_admin_token):
        other_id = other_club_with_data["id"]
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
        r = requests.put(f"{API}/clubs/{other_id}/icon",
                         files={"file": ("icon.png", png, "image/png")},
                         headers=h(club_admin_token))
        assert r.status_code == 403


# ---------- Club isolation ----------
class TestIsolation:
    def test_admin_scope_ignores_club_param(self, test_club, test_class, club_admin_token):
        """An admin asking for another club's data via ?club_id gets only their own club."""
        other = _other_club_id(test_club)
        r = requests.get(f"{API}/classes", params={"club_id": other}, headers=h(club_admin_token))
        assert r.status_code == 200
        ids = {c["id"] for c in r.json()}
        assert test_class["id"] in ids
        # never any class belonging to another club
        other_classes = requests.get(f"{API}/classes", params={"club_id": other}).json()
        assert not any(c["id"] in ids for c in other_classes)

    def test_officer_cannot_read_other_club_race(self, test_club, club_officer_token, other_club_with_data):
        oc = other_club_with_data["classes"][0]
        races = requests.get(f"{API}/races", params={"class_id": oc["id"]}).json()
        assert races, "expected the other club to have races"
        r = requests.get(f"{API}/races/{races[0]['id']}", headers=h(club_officer_token))
        assert r.status_code == 404

    def test_admin_cannot_create_class_in_other_club(self, club_admin_token, other_club_with_data):
        other = other_club_with_data["id"]
        r = requests.post(f"{API}/classes", json={"name": "Sneaky", "club_id": other}, headers=h(club_admin_token))
        assert r.status_code == 403

    def test_officer_cannot_mutate_other_club_series(self, test_club, club_officer_token, other_club_with_data):
        oc = other_club_with_data["classes"][0]
        series = requests.get(f"{API}/series", params={"class_id": oc["id"]}).json()
        assert series
        r = requests.delete(f"{API}/series/{series[0]['id']}", headers=h(club_officer_token))
        assert r.status_code == 403

    def test_standings_scoped_to_own_club(self, club_admin_token, other_club_with_data):
        oc = other_club_with_data["classes"][0]
        r = requests.get(f"{API}/standings/overall", params={"class_id": oc["id"], "year": YEAR},
                         headers=h(club_admin_token))
        assert r.status_code == 404  # other club's class looks like it doesn't exist


# ---------- Public reads ----------
class TestPublic:
    def test_classes(self, test_class):
        r = requests.get(f"{API}/classes")
        assert r.status_code == 200
        names = [c["name"] for c in r.json()]
        assert "Test Fleet" in names

    def test_series(self, test_club, test_class):
        r = requests.get(f"{API}/series", params={"class_id": test_class["id"]})
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_boats(self):
        r = requests.get(f"{API}/boats")
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_rrs(self):
        r = requests.get(f"{API}/rrs-codes")
        assert r.status_code == 200
        codes = [c["code"] for c in r.json()]
        assert "DNC" in codes and "FINISHED" in codes and "DNE" in codes

    def test_notifications(self):
        r = requests.get(f"{API}/notifications")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_club_directory(self):
        r = requests.get(f"{API}/clubs/directory")
        assert r.status_code == 200
        clubs = r.json()
        assert clubs
        for c in clubs:
            assert "officer_pin" not in c and "admin_pin" not in c

    def test_club_directory_year_filter(self):
        full = requests.get(f"{API}/clubs/directory").json()
        ids = {c["id"] for c in full}
        r = requests.get(f"{API}/clubs/directory", params={"year": YEAR})
        assert r.status_code == 200
        for c in r.json():
            assert c["id"] in ids  # year-filtered directory is a subset
            # clubs are omitted entirely when they have nothing that year
            assert any(ci.get("latest") or ci.get("planned_series") for ci in c["classes"])
        # a future year has nothing set up anywhere
        r2 = requests.get(f"{API}/clubs/directory", params={"year": 2100})
        assert r2.status_code == 200 and r2.json() == []

    def test_club_directory_shows_planned_future_series(self, test_club, test_class, club_admin_token):
        """A club with a series set up (but no races) appears on that year's
        directory, marked as planned."""
        future = YEAR + 1
        st = requests.post(f"{API}/series", json={
            "name": "Planned Future Series", "class_id": test_class["id"], "year": future,
            "discards": 0, "included_in_overall": True, "order": 1, "planned_races": 6,
        }, headers=h(club_admin_token))
        assert st.status_code == 200, st.text
        sid = st.json()["id"]
        try:
            r = requests.get(f"{API}/clubs/directory", params={"year": future})
            assert r.status_code == 200
            club = next((c for c in r.json() if c["id"] == test_club["id"]), None)
            assert club, f"test club missing from {future} directory"
            assert any(ci.get("planned_series") for ci in club["classes"])
            assert not any(ci.get("latest") for ci in club["classes"])
        finally:
            requests.delete(f"{API}/series/{sid}", headers=h(club_admin_token))

    def test_seasons(self, test_club, test_class, club_admin_token):
        """/seasons reports only years that actually have series (all clubs,
        or scoped to one club)."""
        future = YEAR + 1
        st = requests.post(f"{API}/series", json={
            "name": "Seasons Test Series", "class_id": test_class["id"], "year": future,
            "discards": 0, "included_in_overall": True, "order": 1, "planned_races": 3,
        }, headers=h(club_admin_token))
        assert st.status_code == 200, st.text
        sid = st.json()["id"]
        try:
            all_years = requests.get(f"{API}/seasons").json()["years"]
            assert isinstance(all_years, list) and all_years == sorted(all_years)
            assert future in all_years
            club_years = requests.get(f"{API}/seasons", params={"club_id": test_club["id"]}).json()["years"]
            assert future in club_years
        finally:
            requests.delete(f"{API}/series/{sid}", headers=h(club_admin_token))


# ---------- Admin CRUD (inside the test club) ----------
class TestAdminCRUD:
    def test_boat_crud(self, test_class, club_admin_token):
        payload = {"name": "TEST_Boat", "sail_no": "TEST99", "class_id": test_class["id"],
                   "helm": "TEST helm", "year": YEAR, "active": True, "home_club": "TEST Home Club",
                   "tcc": 1.015, "py": 1013}
        r = requests.post(f"{API}/boats", json=payload, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        assert r.json()["home_club"] == "TEST Home Club"
        assert r.json()["tcc"] == 1.015 and r.json()["py"] == 1013
        bid = r.json()["id"]
        payload["name"] = "TEST_Boat2"
        payload["home_club"] = "TEST Home Club 2"
        r = requests.put(f"{API}/boats/{bid}", json=payload, headers=h(club_admin_token))
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Boat2"
        assert r.json()["home_club"] == "TEST Home Club 2"
        r = requests.delete(f"{API}/boats/{bid}", headers=h(club_admin_token))
        assert r.status_code == 200

    def test_class_crud(self, test_club, club_admin_token):
        r = requests.post(f"{API}/classes", json={"name": "TEST_Class", "default_start_time": "12:00"},
                          headers=h(club_admin_token))
        assert r.status_code == 200
        cid = r.json()["id"]
        assert r.json()["club_id"] == test_club["id"]
        r = requests.put(f"{API}/classes/{cid}", json={"name": "TEST_Class2", "default_start_time": "13:00"},
                         headers=h(club_admin_token))
        assert r.status_code == 200
        assert r.json()["default_start_time"] == "13:00"
        r = requests.delete(f"{API}/classes/{cid}", headers=h(club_admin_token))
        assert r.status_code == 200

    def test_series_crud(self, test_class, club_admin_token):
        payload = {"name": "TEST_Series", "class_id": test_class["id"], "year": YEAR,
                   "discards": 0, "included_in_overall": False, "order": 99}
        r = requests.post(f"{API}/series", json=payload, headers=h(club_admin_token))
        assert r.status_code == 200
        sid = r.json()["id"]
        payload["discards"] = 2
        r = requests.put(f"{API}/series/{sid}", json=payload, headers=h(club_admin_token))
        assert r.status_code == 200
        assert r.json()["discards"] == 2
        r = requests.delete(f"{API}/series/{sid}", headers=h(club_admin_token))
        assert r.status_code == 200


# ---------- Full race flow (inside the test club) ----------
class TestRaceFlow:
    def _make_series_and_boats(self, club_admin_token):
        # A dedicated class so no other test's boats inflate this fleet
        r = requests.post(f"{API}/classes", json={"name": "Race Flow Class", "default_start_time": "10:30"},
                          headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        cls = r.json()
        r = requests.post(f"{API}/series", json={
            "name": "Race Flow Series", "class_id": cls["id"], "year": YEAR,
            "discards": 0, "included_in_overall": True, "order": 1}, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        series = r.json()
        boats = []
        for i, (name, sail) in enumerate([("Alpha", "A1"), ("Bravo", "B2"), ("Charlie", "C3")], start=1):
            r = requests.post(f"{API}/boats", json={
                "name": name, "sail_no": sail, "class_id": cls["id"],
                "helm": f"Helm {i}", "year": YEAR, "active": True, "home_club": f"{name} SC"}, headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            boats.append(r.json())
        return cls, series, boats

    def test_full_race_lifecycle(self, club_officer_token, club_admin_token):
        cls, series, boats = self._make_series_and_boats(club_admin_token)
        sid, b = series["id"], [x["id"] for x in boats]

        # Create race
        r = requests.post(f"{API}/races", json={
            "date": f"{YEAR}-05-15", "class_id": cls["id"], "series_id": sid,
            "race_number": 1, "start_time": "10:45"}, headers=h(club_officer_token))
        assert r.status_code == 200, r.text
        race = r.json()
        rid = race["id"]
        assert race["status"] == "setup"
        assert len(race["results"]) == len(b)
        assert all(res["code"] == "DNC" for res in race["results"])

        # Notifications appear
        notifs = requests.get(f"{API}/notifications").json()
        assert any(n["race_id"] == rid for n in notifs)

        # Update notifications
        r = requests.put(f"{API}/races/{rid}/notifications", json={
            "course": "Windward-leeward", "life_jackets": True, "special_rules": "No spinnakers"},
            headers=h(club_officer_token))
        assert r.status_code == 200
        assert r.json()["life_jackets"] is True

        # Select all boats
        r = requests.post(f"{API}/races/{rid}/select-boats", json={"boat_ids": b}, headers=h(club_officer_token))
        assert r.status_code == 200
        codes = {res["boat_id"]: res["code"] for res in r.json()["results"]}
        assert all(c == "DNS" for c in codes.values())

        # Record finishes for first two
        requests.post(f"{API}/races/{rid}/finish", json={"boat_id": b[0]}, headers=h(club_officer_token))
        r = requests.post(f"{API}/races/{rid}/finish", json={"boat_id": b[1]}, headers=h(club_officer_token))
        assert r.status_code == 200
        positions = {res["boat_id"]: res["position"] for res in r.json()["results"] if res["code"] == "FINISHED"}
        assert positions[b[0]] == 1 and positions[b[1]] == 2

        # Undo first finish -> re-sequence
        r = requests.post(f"{API}/races/{rid}/undo-finish", json={"boat_id": b[0]}, headers=h(club_officer_token))
        race = r.json()
        finished = [res for res in race["results"] if res["code"] == "FINISHED"]
        assert len(finished) == 1
        assert finished[0]["position"] == 1 and finished[0]["boat_id"] == b[1]

        # Re-finish and finish third
        requests.post(f"{API}/races/{rid}/finish", json={"boat_id": b[0]}, headers=h(club_officer_token))
        requests.post(f"{API}/races/{rid}/finish", json={"boat_id": b[2]}, headers=h(club_officer_token))

        # Adjust: DSQ boat[0]
        r = requests.put(f"{API}/races/{rid}/result/{b[0]}", json={"code": "DSQ"}, headers=h(club_officer_token))
        assert r.status_code == 200
        assert next(res for res in r.json()["results"] if res["boat_id"] == b[0])["code"] == "DSQ"

        # provisional -> publish
        r = requests.post(f"{API}/races/{rid}/status/provisional", headers=h(club_officer_token))
        assert r.status_code == 200 and r.json()["status"] == "provisional"
        r = requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))
        assert r.status_code == 200 and r.json()["status"] == "published"

        # Notification cleared
        notifs = requests.get(f"{API}/notifications").json()
        assert not any(n["race_id"] == rid for n in notifs)

        # Series standings: boat[1] won (b[0] DSQ'd, b[2] finished 3rd-ish)
        st = requests.get(f"{API}/standings/series/{sid}").json()
        assert st["race_count"] == 1
        assert st["standings"][0]["boat_id"] == b[1]
        # home club label flows into standings (Bravo SC won this race)
        assert st["standings"][0]["home_club"] == "Bravo SC"

        # Overall: only the included series appears
        r = requests.get(f"{API}/standings/overall", params={"class_id": cls["id"], "year": YEAR})
        assert r.status_code == 200
        overall = r.json()
        assert "Race Flow Series" in overall["series_names"]

        # cleanup
        requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))


# ---------- Scoring specifics ----------
class TestScoring:
    def test_dnc_points_equal_entries_plus_1(self, club_officer_token, club_admin_token):
        # dedicated class so the fleet is exactly the 3 boats created here
        r = requests.post(f"{API}/classes", json={"name": "Scoring Class", "default_start_time": "10:30"},
                          headers=h(club_admin_token))
        cls = r.json()
        r = requests.post(f"{API}/series", json={
            "name": "Scoring Series", "class_id": cls["id"], "year": YEAR,
            "discards": 0, "included_in_overall": True, "order": 2}, headers=h(club_admin_token))
        series = r.json()
        boats = []
        for i, (name, sail) in enumerate([("One", "S1"), ("Two", "S2"), ("Three", "S3")]):
            r = requests.post(f"{API}/boats", json={
                "name": name, "sail_no": sail, "class_id": cls["id"],
                "helm": f"H{i}", "year": YEAR, "active": True}, headers=h(club_admin_token))
            boats.append(r.json()["id"])
        rid = requests.post(f"{API}/races", json={
            "date": f"{YEAR}-09-10", "class_id": cls["id"], "series_id": series["id"],
            "race_number": 1}, headers=h(club_officer_token)).json()["id"]
        selected = boats[:2]
        requests.post(f"{API}/races/{rid}/select-boats", json={"boat_ids": selected}, headers=h(club_officer_token))
        requests.post(f"{API}/races/{rid}/finish", json={"boat_id": selected[0]}, headers=h(club_officer_token))
        requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))

        st = requests.get(f"{API}/standings/series/{series['id']}").json()
        entries = len(boats)
        non_sel = [row for row in st["standings"] if row["boat_id"] not in selected]
        assert non_sel, "expected non-selected boats in standings"
        assert all(row["total"] == entries + 1 for row in non_sel)

        requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))


# ---------- Scoring mode lives on the series, not the class/boat ----------
class TestSeriesScoringMode:
    """The one_design/IRC/PY choice is made per series: two series on the same
    class and boats can score the identical race differently."""

    def test_series_mode_drives_finish_order(self, club_officer_token, club_admin_token):
        import datetime
        r = requests.post(f"{API}/classes", json={"name": "Mode Class", "default_start_time": "10:30"},
                          headers=h(club_admin_token))
        assert r.status_code == 200
        cls = r.json()
        boats = []
        # PY ratings chosen so corrected order differs from finish order:
        # finishes M1(1800s), M3(1900s), M2(2000s); corrected M2 1667, M3 1900, M1 2000
        for i, (nm, sl, py) in enumerate([("M One", "M1", 900), ("M Two", "M2", 1200), ("M Three", "M3", 1000)]):
            r = requests.post(f"{API}/boats", json={
                "name": nm, "sail_no": sl, "class_id": cls["id"],
                "helm": f"H{i}", "year": YEAR, "active": True, "py": py}, headers=h(club_admin_token))
            assert r.status_code == 200
            boats.append(r.json())

        def make_series(name, mode):
            r = requests.post(f"{API}/series", json={
                "name": name, "class_id": cls["id"], "year": YEAR,
                "scoring_mode": mode, "discards": 0, "included_in_overall": False,
                "order": 10}, headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            return r.json()

        one_design = make_series("Mode One-Design", "one_design")
        py = make_series("Mode PY", "py")
        assert py["scoring_mode"] == "py"

        def race_positions(series):
            rid = requests.post(f"{API}/races", json={
                "date": f"{YEAR}-08-21", "class_id": cls["id"], "series_id": series["id"],
                "race_number": 1, "start_time": "10:30"}, headers=h(club_officer_token)).json()["id"]
            requests.post(f"{API}/races/{rid}/select-boats", json={"boat_ids": [b["id"] for b in boats]},
                          headers=h(club_officer_token))
            base = datetime.datetime(YEAR, 8, 21, 10, 30, 0)
            for b, secs in [(boats[0], 1800), (boats[2], 1900), (boats[1], 2000)]:
                ft = (base + datetime.timedelta(seconds=secs)).isoformat()
                r = requests.post(f"{API}/races/{rid}/finish", json={"boat_id": b["id"], "finish_time": ft},
                                  headers=h(club_officer_token))
                assert r.status_code == 200, r.text
            race = requests.get(f"{API}/races/{rid}").json()
            pos = {next(b["sail_no"] for b in boats if b["id"] == x["boat_id"]): x["position"]
                   for x in race["results"] if x["code"] == "FINISHED"}
            requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))
            return pos

        # one-design: pure finish order M1, M3, M2
        assert race_positions(one_design) == {"M1": 1, "M3": 2, "M2": 3}
        # PY: corrected order (M2 1667 < M3 1900 < M1 2000) — the last boat over
        # the line wins because it is rated much faster
        assert race_positions(py) == {"M2": 1, "M3": 2, "M1": 3}
