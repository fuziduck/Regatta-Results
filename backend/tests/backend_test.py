"""Backend API tests: auth, webmaster club management, club isolation,
admin CRUD, the full race lifecycle, and RRS scoring — all inside a
dedicated test club (see conftest.py) so the suite never depends on or
mutates a real club's data."""

import base64
import requests
from datetime import datetime, timezone

from conftest import (API, WEBMASTER_PASSCODE, TEST_OFFICER_PIN, TEST_ADMIN_PIN,
                       club_user_username, login, h)

YEAR = datetime.now(timezone.utc).year


def _all_clubs():
    return requests.get(f"{API}/clubs").json()


def _other_club_id(test_club):
    return next(c["id"] for c in _all_clubs() if c["id"] != test_club["id"])


# ---------- Auth ----------
class TestAuth:
    def test_webmaster_login(self):
        r = requests.post(f"{API}/auth/login", json={
            "role": "webmaster", "username": "webmaster", "passcode": WEBMASTER_PASSCODE})
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "webmaster"
        assert body["club_id"] is None
        # The JWT is delivered as an HttpOnly session cookie — never in the
        # response body, so JavaScript cannot read it.
        assert "token" not in body
        assert isinstance(r.cookies.get("scr_token"), str)

    def test_webmaster_bad_passcode(self):
        r = requests.post(f"{API}/auth/login", json={
            "role": "webmaster", "username": "webmaster", "passcode": "wrong"})
        assert r.status_code == 401

    def test_unknown_role(self):
        r = requests.post(f"{API}/auth/login", json={"role": "crew", "username": "x", "passcode": "x"})
        assert r.status_code == 401

    def test_club_login(self, test_club):
        for role, pin in (("officer", TEST_OFFICER_PIN), ("admin", TEST_ADMIN_PIN)):
            r = requests.post(f"{API}/auth/login", json={
                "role": role, "username": club_user_username(role, test_club["id"]),
                "passcode": pin, "club_id": test_club["id"]})
            assert r.status_code == 200, r.text
            assert r.json()["role"] == role
            assert r.json()["club_id"] == test_club["id"]
            assert r.json()["club_name"] == test_club["name"]

    def test_club_login_wrong_passcode(self, test_club):
        r = requests.post(f"{API}/auth/login", json={
            "role": "officer", "username": "officer", "passcode": "nope", "club_id": test_club["id"]})
        assert r.status_code == 401

    def test_club_login_unknown_club(self):
        r = requests.post(f"{API}/auth/login", json={
            "role": "officer", "username": "officer", "passcode": TEST_OFFICER_PIN,
            "club_id": "00000000-0000-0000-0000-000000000000"})
        assert r.status_code == 401  # generic — never reveals whether the club exists

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
        # no plaintext PINs anywhere — logins are individual user accounts
        assert "officer_pin" not in mine and "admin_pin" not in mine
        # a club admin may not read the management payload
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

    def test_club_settings_race_day_notices(self, webmaster_token, club_admin_token,
                                             club_officer_token, test_club, other_club_with_data):
        # A club admin may toggle their own club's race-day notices setting.
        r = requests.put(f"{API}/clubs/{test_club['id']}/settings",
                         json={"race_day_notices": False}, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        assert r.json()["race_day_notices"] is False
        # The setting is visible through the public clubs payload (officers
        # read it to decide whether to show the notice section).
        clubs = requests.get(f"{API}/clubs").json()
        mine = next(c for c in clubs if c["id"] == test_club["id"])
        assert mine.get("race_day_notices") is False
        # It defaults to on for a fresh club.
        fresh = requests.post(f"{API}/clubs", json={"name": "Settings Club", "color": "#333333"},
                              headers=h(webmaster_token)).json()
        assert fresh.get("race_day_notices", True) is True
        # An officer may not change the club's settings.
        r = requests.put(f"{API}/clubs/{test_club['id']}/settings",
                         json={"race_day_notices": True}, headers=h(club_officer_token))
        assert r.status_code == 403
        # ... and a club admin may not change another club's settings.
        r = requests.put(f"{API}/clubs/{other_club_with_data['id']}/settings",
                         json={"race_day_notices": False}, headers=h(club_admin_token))
        assert r.status_code == 403
        # The webmaster may change any club's settings.
        r = requests.put(f"{API}/clubs/{other_club_with_data['id']}/settings",
                         json={"race_day_notices": False}, headers=h(webmaster_token))
        assert r.status_code == 200
        assert r.json()["race_day_notices"] is False
        # Toggle back on and clean up.
        requests.put(f"{API}/clubs/{other_club_with_data['id']}/settings",
                     json={"race_day_notices": True}, headers=h(webmaster_token))
        requests.put(f"{API}/clubs/{test_club['id']}/settings",
                     json={"race_day_notices": True}, headers=h(club_admin_token))
        requests.delete(f"{API}/clubs/{fresh['id']}", headers=h(webmaster_token))

    def test_notifications_hidden_when_club_disables_notices(self, club_admin_token,
                                                             club_officer_token, test_club, test_class):
        # An unpublished race with a course in the test club.
        r = requests.post(f"{API}/series", json={
            "name": "Notice Hide Series", "class_id": test_class["id"], "year": YEAR,
            "discards": 0, "included_in_overall": False, "order": 99}, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        r = requests.post(f"{API}/races", json={
            "date": "2026-09-12", "class_id": test_class["id"], "series_id": sid,
            "race_number": 1, "start_time": "10:30", "start_tz_offset_minutes": 0},
            headers=h(club_officer_token))
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        r = requests.put(f"{API}/races/{rid}/notifications", json={"course": "Windward/Leeward"},
                         headers=h(club_officer_token))
        assert r.status_code == 200, r.text

        # The notice shows on the public feed for the club.
        feed = requests.get(f"{API}/notifications",
                            params={"club_id": test_club["id"]}).json()
        assert any(n["race_id"] == rid for n in feed)

        # Disabling race-day notices hides it from the public feed too.
        requests.put(f"{API}/clubs/{test_club['id']}/settings",
                     json={"race_day_notices": False}, headers=h(club_admin_token))
        feed = requests.get(f"{API}/notifications",
                            params={"club_id": test_club["id"]}).json()
        assert not any(n["race_id"] == rid for n in feed)

        # Re-enabling brings the notice back.
        requests.put(f"{API}/clubs/{test_club['id']}/settings",
                     json={"race_day_notices": True}, headers=h(club_admin_token))
        feed = requests.get(f"{API}/notifications",
                            params={"club_id": test_club["id"]}).json()
        assert any(n["race_id"] == rid for n in feed)
        requests.delete(f"{API}/series/{sid}", headers=h(club_admin_token))

    def test_webmaster_crud_club(self, webmaster_token):
        r = requests.post(f"{API}/clubs", json={"name": "Tmp Club", "color": "#111111"},
                          headers=h(webmaster_token))
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        r = requests.put(f"{API}/clubs/{cid}", json={"name": "Tmp Club 2", "color": "#222222"},
                         headers=h(webmaster_token))
        assert r.status_code == 200
        assert r.json()["name"] == "Tmp Club 2"
        # no PIN fields are ever stored or returned
        manage = requests.get(f"{API}/clubs/manage", headers=h(webmaster_token)).json()
        updated = next(c for c in manage if c["id"] == cid)
        assert "officer_pin" not in updated and "admin_pin" not in updated
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

    def test_directory_latest_is_most_recently_dated_race(self, test_club, club_admin_token, club_officer_token):
        """Front-page 'latest' must be the most recently DATED published race.
        Regression: chained PyMongo .sort() calls replace each other, so the
        directory used to pick the highest race_number regardless of date."""
        r = requests.post(f"{API}/classes", json={"name": "Dir Latest Class", "default_start_time": "10:30"},
                          headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        cls = r.json()
        r = requests.post(f"{API}/series", json={
            "name": "Dir Latest Series", "class_id": cls["id"], "year": YEAR,
            "discards": 0, "included_in_overall": False, "order": 60}, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        created = {}
        try:
            # Race 2 has the HIGHER race number but an EARLIER date than race 1.
            for rn, date in [(2, f"{YEAR}-04-01"), (1, f"{YEAR}-06-15")]:
                r = requests.post(f"{API}/races", json={
                    "date": date, "class_id": cls["id"], "series_id": sid, "race_number": rn},
                    headers=h(club_officer_token))
                assert r.status_code == 200, r.text
                rid = r.json()["id"]
                r = requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))
                assert r.status_code == 200, r.text
                created[rn] = rid
            directory = requests.get(f"{API}/clubs/directory").json()
            club_entry = next((c for c in directory if c["id"] == test_club["id"]), None)
            assert club_entry
            ci = next((x for x in club_entry["classes"] if x["id"] == cls["id"]), None)
            assert ci and ci["latest"], "directory must report a latest race"
            assert ci["latest"]["race_number"] == 1, "must pick the latest-dated race, not the highest race number"
            assert ci["latest"]["date"] == f"{YEAR}-06-15"
        finally:
            for rid in created.values():
                requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))
            requests.delete(f"{API}/series/{sid}", headers=h(club_admin_token))
            requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))

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

    def test_duplicate_race_number_rejected_with_clear_error(self, club_officer_token, club_admin_token):
        """A race number may only be used once per series — the API must
        answer 400 with a helpful message, not crash into the unique index
        (which surfaced as an opaque 500 without CORS headers in the app)."""
        cls, series, boats = self._make_series_and_boats(club_admin_token)
        sid, cls_id = series["id"], cls["id"]
        try:
            payload = {"date": f"{YEAR}-05-15", "class_id": cls_id, "series_id": sid,
                       "race_number": 1, "start_time": "10:45"}
            r = requests.post(f"{API}/races", json=payload, headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            r = requests.post(f"{API}/races", json=payload, headers=h(club_officer_token))
            assert r.status_code == 400, r.text
            assert "already exists" in r.json()["detail"]
        finally:
            for race in requests.get(f"{API}/races", params={"series_id": sid},
                                     headers=h(club_officer_token)).json():
                requests.delete(f"{API}/races/{race['id']}", headers=h(club_officer_token))


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


# ---------- Mini-series (long series split into consecutive chunks) ----------
class TestMiniSeriesEndpoint:
    def test_mini_endpoint(self, club_officer_token, club_admin_token):
        r = requests.post(f"{API}/classes", json={"name": "Mini Series Class", "default_start_time": "10:30"},
                          headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        cls = r.json()
        r = requests.post(f"{API}/series", json={
            "name": "Mini Split Series", "class_id": cls["id"], "year": YEAR,
            "discards": 0, "included_in_overall": False, "order": 11,
            "mini_series": True,
            "mini_series_groups": [
                {"name": "Early", "race_numbers": [1, 2], "discards": 1},
                {"name": "Late", "race_numbers": [3], "discards": 0},
            ]},
            headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        series = r.json()
        sid = series["id"]
        assert series["mini_series"] is True
        assert series["mini_series_groups"][0]["name"] == "Early"

        # Non-mini series rejects the mini param.
        r = requests.post(f"{API}/series", json={
            "name": "No Mini", "class_id": cls["id"], "year": YEAR,
            "discards": 0, "included_in_overall": False, "order": 12},
            headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        other = r.json()["id"]
        assert requests.get(f"{API}/standings/series/{other}", params={"mini": 1}).status_code == 400

        # Publish 3 races; the groups pick races 1-2 and 3.
        for rn in range(1, 4):
            r = requests.post(f"{API}/races", json={
                "date": f"{YEAR}-06-{rn:02d}", "class_id": cls["id"],
                "series_id": sid, "race_number": rn}, headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            rid = r.json()["id"]
            r = requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))
            assert r.status_code == 200, r.text

        full = requests.get(f"{API}/standings/series/{sid}").json()
        assert full["race_count"] == 3
        assert full["mini_series"]["groups"] == [
            {"name": "Early", "race_numbers": [1, 2], "discards": 1, "scoring": "additional", "race_count": 2},
            {"name": "Late", "race_numbers": [3], "discards": 0, "scoring": "additional", "race_count": 1},
        ]
        m1 = requests.get(f"{API}/standings/series/{sid}", params={"mini": 1}).json()
        assert m1["race_count"] == 2 and m1["mini_index"] == 1 and m1["mini_name"] == "Early"
        assert m1["discards"] == 1  # the group's discards apply, not the series' 0
        m2 = requests.get(f"{API}/standings/series/{sid}", params={"mini": 2}).json()
        assert m2["race_count"] == 1 and m2["mini_index"] == 2 and m2["mini_name"] == "Late"
        assert requests.get(f"{API}/standings/series/{sid}", params={"mini": 3}).status_code == 404
        assert requests.get(f"{API}/standings/series/{sid}", params={"mini": 0}).status_code == 404

        # cleanup: races, then series
        for s in (sid, other):
            for race in requests.get(f"{API}/races", params={"series_id": s}).json():
                requests.delete(f"{API}/races/{race['id']}", headers=h(club_officer_token))
            requests.delete(f"{API}/series/{s}", headers=h(club_admin_token))

    def test_overall_dnc_default_for_series_not_raced(self, club_officer_token, club_admin_token):
        """A boat that never signed onto a series scores DNC in EVERY race of
        that series (net after the series' discards) in the overall
        championship — never 0, and never a single flat DNC — so a part-time
        boat can't float to the top of the leaderboard by skipping series."""
        r = requests.post(f"{API}/classes", json={"name": "Overall DNC Class", "default_start_time": "10:30"},
                          headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        cls = r.json()
        boats = []
        for i, (nm, sl) in enumerate([("Full Time", "F1"), ("Part Time", "P1"), ("Regular", "R1")], start=1):
            r = requests.post(f"{API}/boats", json={
                "name": nm, "sail_no": sl, "class_id": cls["id"], "helm": f"H{i}",
                "year": YEAR, "active": True}, headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            boats.append(r.json())
        b = [x["id"] for x in boats]
        created = []
        try:
            # Series 1 (one race): all three boats race (Full Time 1st,
            # Part Time 2nd, Regular 3rd). Series 2 (THREE races, one
            # discard): only Full Time and Regular race — Part Time is
            # absent entirely, so she must score DNC for every race of the
            # series: (3 entries + 1) x (3 races - 1 discard) = 8, not 4.
            r = requests.post(f"{API}/series", json={
                "name": "DNC Series One", "class_id": cls["id"], "year": YEAR,
                "discards": 0, "included_in_overall": True, "order": 21},
                headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            sid1 = r.json()["id"]
            created.append(("series", sid1))
            rid = requests.post(f"{API}/races", json={
                "date": f"{YEAR}-09-01", "class_id": cls["id"], "series_id": sid1,
                "race_number": 1, "start_time": "10:30"}, headers=h(club_officer_token)).json()["id"]
            created.append(("race", rid))
            requests.post(f"{API}/races/{rid}/select-boats", json={"boat_ids": b},
                          headers=h(club_officer_token))
            for pos, bid in enumerate(b, start=1):
                requests.put(f"{API}/races/{rid}/result/{bid}",
                             json={"code": "FINISHED", "position": pos},
                             headers=h(club_officer_token))
            requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))

            r = requests.post(f"{API}/series", json={
                "name": "DNC Series Two", "class_id": cls["id"], "year": YEAR,
                "discards": 1, "included_in_overall": True, "order": 22},
                headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            sid2 = r.json()["id"]
            created.append(("series", sid2))
            for rn in range(1, 4):
                rid = requests.post(f"{API}/races", json={
                    "date": f"{YEAR}-09-1{rn}", "class_id": cls["id"], "series_id": sid2,
                    "race_number": rn, "start_time": "10:30"}, headers=h(club_officer_token)).json()["id"]
                created.append(("race", rid))
                racing = [b[0], b[2]]  # Full Time + Regular only
                requests.post(f"{API}/races/{rid}/select-boats", json={"boat_ids": racing},
                              headers=h(club_officer_token))
                for pos, bid in enumerate(racing, start=1):
                    requests.put(f"{API}/races/{rid}/result/{bid}",
                                 json={"code": "FINISHED", "position": pos},
                                 headers=h(club_officer_token))
                requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))

            overall = requests.get(f"{API}/standings/overall",
                                   params={"class_id": cls["id"], "year": YEAR}).json()
            by_id = {row["boat_id"]: row for row in overall["standings"]}
            # Part Time skipped series 2 entirely: DNC = 3 boats + 1 = 4 per
            # race, 3 races, 1 discard → 4 x 2 counting = 8. Total 2 + 8 = 10,
            # below everyone who raced both series (Full Time 1+2=3,
            # Regular 3+4=7). Never 0, never a single flat DNC, never at top.
            pt = by_id[b[1]]
            assert pt["per_series"]["DNC Series Two"] == 8.0
            assert pt["net"] == 10.0
            assert by_id[b[0]]["net"] == 3.0 and by_id[b[0]]["rank"] == 1
            assert by_id[b[2]]["net"] == 7.0 and by_id[b[2]]["rank"] == 2
            assert pt["rank"] == 3
            # Series 1's net values are untouched (1, 2, 3).
            assert by_id[b[1]]["per_series"]["DNC Series One"] == 2.0
        finally:
            for kind, ident in reversed(created):
                if kind == "race":
                    requests.delete(f"{API}/races/{ident}", headers=h(club_officer_token))
                else:
                    requests.delete(f"{API}/series/{ident}", headers=h(club_admin_token))
            requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))

    def test_mini_combined_daily_result(self, club_officer_token, club_admin_token):
        # A mini series with scoring "combined" folds into ONE main-series
        # result: group discards first, then the average of the counting races.
        r = requests.post(f"{API}/classes", json={"name": "Mini Combined Class", "default_start_time": "10:30"},
                          headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        cls = r.json()
        r = requests.post(f"{API}/series", json={
            "name": "Mini Combined Series", "class_id": cls["id"], "year": YEAR,
            "discards": 0, "included_in_overall": False, "order": 13,
            "mini_series": True,
            "mini_series_groups": [
                {"name": "Regatta Day", "race_numbers": [1, 2, 3], "discards": 1,
                 "scoring": "combined"},
            ]},
            headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        assert r.json()["mini_series_groups"][0]["scoring"] == "combined"
        boats = []
        for i, (nm, sl) in enumerate([("C One", "C1"), ("C Two", "C2")], start=1):
            r = requests.post(f"{API}/boats", json={
                "name": nm, "sail_no": sl, "class_id": cls["id"], "helm": f"H{i}",
                "year": YEAR, "active": True}, headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            boats.append(r.json())
        b = [x["id"] for x in boats]
        created = []
        try:
            # Three races: C1 scores 2, 5, 9 (positions set explicitly); C2
            # wins each race (position 1).
            for rn, pos in [(1, 2), (2, 5), (3, 9)]:
                r = requests.post(f"{API}/races", json={
                    "date": f"{YEAR}-08-0{rn}", "class_id": cls["id"], "series_id": sid,
                    "race_number": rn, "start_time": "10:30"}, headers=h(club_officer_token))
                assert r.status_code == 200, r.text
                rid = r.json()["id"]
                created.append(rid)
                r = requests.put(f"{API}/races/{rid}/result/{b[1]}",
                                 json={"code": "FINISHED", "position": 1}, headers=h(club_officer_token))
                assert r.status_code == 200, r.text
                r = requests.put(f"{API}/races/{rid}/result/{b[0]}",
                                 json={"code": "FINISHED", "position": pos}, headers=h(club_officer_token))
                assert r.status_code == 200, r.text
                requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))

            full = requests.get(f"{API}/standings/series/{sid}").json()
            # The whole mini series is ONE main-series scoring unit.
            assert full["race_count"] == 1
            row = next(x for x in full["standings"] if x["boat_id"] == b[0])
            assert row["scores"][0]["code"] == "MINI"
            # C Two wins every race (avg 1.0 → position 1), C One scores
            # 2+5+9 → avg 3.5 → position 2; the combined column carries the
            # position, not the average.
            assert row["scores"][0]["points"] == 2 and row["net"] == 2
            assert full["mini_series"]["groups"][0]["scoring"] == "combined"

            # The detailed mini view still shows the three individual races,
            # marks the discarded one, and reports the finishing position.
            m1 = requests.get(f"{API}/standings/series/{sid}", params={"mini": 1}).json()
            assert m1["race_count"] == 3 and m1["mini_combined"]["name"] == "Regatta Day"
            row = next(x for x in m1["standings"] if x["boat_id"] == b[0])
            assert [s["points"] for s in row["scores"]] == [2.0, 5.0, 9.0]
            assert row["scores"][2]["discarded"] is True
            assert row["combined_average"] == 2
        finally:
            for rid in created:
                requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))
            requests.delete(f"{API}/series/{sid}", headers=h(club_admin_token))
            requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))

    def test_mini_combined_detail_ranks_by_daily_result(self, club_officer_token, club_admin_token):
        # A combined mini series detail page ranks boats by the daily result
        # (the single score feeding the main series), not by the sum of the
        # races — and the main series breaks ties on the folded column with
        # the same mini countback, so the two views always agree.
        r = requests.post(f"{API}/classes", json={"name": "Mini Rank Class", "default_start_time": "10:30"},
                          headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        cls = r.json()
        r = requests.post(f"{API}/series", json={
            "name": "Mini Rank Series", "class_id": cls["id"], "year": YEAR,
            "discards": 0, "included_in_overall": False, "order": 14,
            "mini_series": True,
            "mini_series_groups": [
                {"name": "Day", "race_numbers": [1, 2], "discards": 0,
                 "scoring": "combined"},
            ]},
            headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        boats = []
        for i, nm in enumerate(["Alpha", "Bravo", "Charlie", "Delta"], start=1):
            r = requests.post(f"{API}/boats", json={
                "name": nm, "sail_no": f"RK{i}", "class_id": cls["id"], "helm": f"H{i}",
                "year": YEAR, "active": True}, headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            boats.append(r.json())
        b = [x["id"] for x in boats]
        created = []
        try:
            # Race 1: Charlie 1st, Alpha 2nd, Bravo 3rd, Delta 4th.
            # Race 2: Bravo 1st, Alpha 2nd, Charlie 3rd, Delta 4th.
            # Daily averages: Alpha/Bravo/Charlie all 2.0, Delta 4.0 — the 2.0
            # tie is broken by the mini countback: Bravo [1,3] beats Charlie
            # [3,1] beats Alpha [2,2]. The net sums (all 4.0) would not.
            for rn, pos in [(1, [2, 3, 1, 4]), (2, [2, 1, 3, 4])]:
                r = requests.post(f"{API}/races", json={
                    "date": f"{YEAR}-09-0{rn}", "class_id": cls["id"], "series_id": sid,
                    "race_number": rn, "start_time": "10:30"}, headers=h(club_officer_token))
                assert r.status_code == 200, r.text
                rid = r.json()["id"]
                created.append(rid)
                for bi, p in enumerate(pos):
                    requests.put(f"{API}/races/{rid}/result/{b[bi]}",
                                 json={"code": "FINISHED", "position": p}, headers=h(club_officer_token))
                requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))

            mini = requests.get(f"{API}/standings/series/{sid}", params={"mini": 1}).json()
            assert [x["boat_name"] for x in mini["standings"]] == ["Bravo", "Charlie", "Alpha", "Delta"]
            # The combined_average field now carries the finishing position,
            # not the daily average — Bravo 1st, Charlie 2nd, Alpha 3rd,
            # Delta 4th.
            assert [x["combined_average"] for x in mini["standings"]] == [1, 2, 3, 4]
            # Every 2.0 boat nets 4.0, so net alone could not produce this
            # order — the detail view must rank by the daily result.
            assert all(x["net"] == 4.0 for x in mini["standings"][:3])
            # The main series folds to one column and must agree exactly.
            full = requests.get(f"{API}/standings/series/{sid}").json()
            assert [x["boat_name"] for x in full["standings"]] == ["Bravo", "Charlie", "Alpha", "Delta"]
        finally:
            for rid in created:
                requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))
            requests.delete(f"{API}/series/{sid}", headers=h(club_admin_token))
            requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))

    def test_mini_group_discards_change(self, club_officer_token, club_admin_token):
        """The race officer may change a mini-series group's discard count
        from the batch scoring page without leaving for the admin editor."""
        cls = None
        try:
            r = requests.post(f"{API}/classes", json={"name": "Discard Change Class", "default_start_time": "10:30"},
                              headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            cls = r.json()
            r = requests.post(f"{API}/series", json={
                "name": "Discard Change Series", "class_id": cls["id"], "year": YEAR,
                "discards": 0, "included_in_overall": False, "order": 10,
                "planned_races": 2,
                "schedule": ["2026-09-12", "2026-09-19"]},
                headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            sid = r.json()["id"]
            # Split into 2 races as a combined mini series.
            r = requests.post(f"{API}/series/{sid}/mini-split",
                              json={"race_number": 1, "count": 2, "name": "Discard Test",
                                    "scoring": "combined"},
                              headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            group_index = r.json()["group_index"]
            groups = r.json()["series"]["mini_series_groups"]
            assert groups[group_index]["discards"] == 0

            # Officer sets discards to 1.
            r = requests.put(f"{API}/series/{sid}/mini/{group_index}",
                             json={"discards": 1}, headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            assert r.json()["group"]["discards"] == 1
            groups = r.json()["series"]["mini_series_groups"]
            assert groups[group_index]["discards"] == 1
            # Reverting back to 0 also works.
            r = requests.put(f"{API}/series/{sid}/mini/{group_index}",
                             json={"discards": 0}, headers=h(club_officer_token))
            assert r.status_code == 200
            assert r.json()["group"]["discards"] == 0
        finally:
            if cls:
                requests.delete(f"{API}/series/{sid}", headers=h(club_admin_token))
                requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))


    def test_mini_series_merge_reverts_to_single_race(self, club_officer_token, club_admin_token):
        """A split mini series can be reverted back into ONE normal race:
        the child races are deleted, later races are renumbered back down,
        the group config is removed and the slot race loses its stamp."""
        cls = None
        try:
            r = requests.post(f"{API}/classes", json={"name": "Merge Class", "default_start_time": "10:30"},
                              headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            cls = r.json()
            r = requests.post(f"{API}/boats", json={
                "name": "Merge Boat", "sail_no": "M1", "class_id": cls["id"],
                "helm": "T", "year": YEAR, "active": True},
                headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            boat_id = r.json()["id"]
            r = requests.post(f"{API}/series", json={
                "name": "Merge Series", "class_id": cls["id"], "year": YEAR,
                "discards": 0, "included_in_overall": False, "order": 11,
                "planned_races": 3,
                "schedule": ["2026-09-12", "2026-09-19", "2026-09-26"]},
                headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            sid = r.json()["id"]
            # Create the later planned race (race 3) so the split shifts it.
            r = requests.post(f"{API}/races", json={
                "class_id": cls["id"], "series_id": sid, "date": "2026-09-26",
                "race_number": 3, "start_time": "10:30",
                "start_tz_offset_minutes": 0}, headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            later_race_id = r.json()["id"]
            # Split race 1 into two: race 3 shifts up to race 4.
            r = requests.post(f"{API}/series/{sid}/mini-split",
                              json={"race_number": 1, "count": 2, "name": "Merge Me",
                                    "scoring": "combined"},
                              headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            gi = r.json()["group_index"]
            assert r.json()["series"]["planned_races"] == 4
            races = requests.get(f"{API}/races?series_id={sid}", headers=h(club_officer_token)).json()
            assert sorted(x["race_number"] for x in races) == [1, 2, 4]
            child = next(x for x in races if x["race_number"] == 2)

            # Seed a leftover EMPTY mini-series group (debris from an earlier
            # split/merge) — the revert must sweep that away too so no phantom
            # mini-series config survives in the admin console.
            series_docs = requests.get(f"{API}/series?class_id={cls['id']}&year={YEAR}",
                                       headers=h(club_admin_token)).json()
            ss = next(x for x in series_docs if x["id"] == sid)
            ss.setdefault("mini_series_groups", []).append(
                {"name": "Ghost", "race_numbers": [], "discards": 0, "scoring": "combined"})
            r = requests.put(f"{API}/series/{sid}", json=ss, headers=h(club_admin_token))
            assert r.status_code == 200, r.text

            # Merge back — the extra race disappears, race 4 returns to 3,
            # and the empty leftover group is dropped with mini_series off.
            r = requests.post(f"{API}/series/{sid}/mini/{gi}/merge", headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            s = r.json()["series"]
            assert s["mini_series_groups"] == []
            assert s["mini_series"] is False
            assert s["planned_races"] == 3
            assert s["schedule"] == ["2026-09-12", "2026-09-19", "2026-09-26"]
            races = requests.get(f"{API}/races?series_id={sid}", headers=h(club_officer_token)).json()
            assert sorted(x["race_number"] for x in races) == [1, 3]
            # The child race is gone; the slot race is a plain race again.
            assert all(x["id"] != child["id"] for x in races)
            slot = next(x for x in races if x["race_number"] == 1)
            assert "mini_group_label" not in slot
            assert later_race_id in [x["id"] for x in races]

            # Merge is rejected once a child race holds recorded results.
            r = requests.post(f"{API}/series/{sid}/mini-split",
                              json={"race_number": 1, "count": 2, "name": "Merge Me 2",
                                    "scoring": "combined"},
                              headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            gi = r.json()["group_index"]
            child_id = r.json()["races"][1]["id"]
            r = requests.post(f"{API}/races/{child_id}/select-boats",
                              json={"boat_ids": [boat_id]},
                              headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            r = requests.post(f"{API}/series/{sid}/mini/{gi}/merge", headers=h(club_officer_token))
            assert r.status_code == 400
            assert "recorded results" in r.json()["detail"]
            # Unknown group index.
            r = requests.post(f"{API}/series/{sid}/mini/99/merge", headers=h(club_officer_token))
            assert r.status_code == 404
        finally:
            if cls:
                requests.delete(f"{API}/series/{sid}", headers=h(club_admin_token))
                requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))


# ---------- Duty points (OOD average over the series, DNC included) ----------
class TestDutyPoints:
    def test_ood_scores_average_of_own_sailed_races(self, club_officer_token, club_admin_token):
        r = requests.post(f"{API}/classes", json={"name": "Duty Points Class", "default_start_time": "10:30"},
                          headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        cls = r.json()
        r = requests.post(f"{API}/series", json={
            "name": "Duty Points Series", "class_id": cls["id"], "year": YEAR,
            "discards": 0, "included_in_overall": False, "order": 70}, headers=h(club_admin_token))
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        boats = []
        for i, (nm, sl) in enumerate([("D One", "D1"), ("D Two", "D2"), ("D Three", "D3")], start=1):
            r = requests.post(f"{API}/boats", json={
                "name": nm, "sail_no": sl, "class_id": cls["id"], "helm": f"H{i}",
                "year": YEAR, "active": True}, headers=h(club_admin_token))
            assert r.status_code == 200, r.text
            boats.append(r.json())
        b = [x["id"] for x in boats]
        created = []
        try:
            # Race 1: D1 1st, D2 2nd. Race 2: D1 2nd, D2 1st. Race 3: D1 OOD, D2 1st.
            positions = [(1, 0, 1), (2, 1, 0)]
            for rn, first_idx, second_idx in positions:
                r = requests.post(f"{API}/races", json={
                    "date": f"{YEAR}-07-{rn:02d}", "class_id": cls["id"], "series_id": sid,
                    "race_number": rn, "start_time": "10:30"}, headers=h(club_officer_token))
                assert r.status_code == 200, r.text
                rid = r.json()["id"]
                created.append(rid)
                requests.post(f"{API}/races/{rid}/finish", json={"boat_id": b[first_idx]}, headers=h(club_officer_token))
                requests.post(f"{API}/races/{rid}/finish", json={"boat_id": b[second_idx]}, headers=h(club_officer_token))
                requests.post(f"{API}/races/{rid}/status/published", headers=h(club_officer_token))
            # Race 3: D1 -> OOD, D2 finishes 1st.
            r = requests.post(f"{API}/races", json={
                "date": f"{YEAR}-07-03", "class_id": cls["id"], "series_id": sid,
                "race_number": 3, "start_time": "10:30"}, headers=h(club_officer_token))
            rid3 = r.json()["id"]
            created.append(rid3)
            r = requests.put(f"{API}/races/{rid3}/result/{b[0]}", json={"code": "OOD"}, headers=h(club_officer_token))
            assert r.status_code == 200, r.text
            assert next(x for x in r.json()["results"] if x["boat_id"] == b[0])["code"] == "OOD"
            requests.post(f"{API}/races/{rid3}/finish", json={"boat_id": b[1]}, headers=h(club_officer_token))
            requests.post(f"{API}/races/{rid3}/status/published", headers=h(club_officer_token))

            st = requests.get(f"{API}/standings/series/{sid}").json()
            row = next(x for x in st["standings"] if x["boat_id"] == b[0])
            # D1: 1st + 2nd + OOD. The OOD average covers the whole series
            # including D3's absence (DNC = series entries + 1 = 4):
            # OOD = (1 + 2 + 4) / 3 = 2.33 -> displayed 2.3, net = 5.33.
            assert row["scores"][2]["code"] == "OOD" and row["scores"][2]["points"] == 2.3
            assert row["net"] == 5.3
            # D2: 2 + 1 + 1 = 4, so D2 wins the series on duty points
            row2 = next(x for x in st["standings"] if x["boat_id"] == b[1])
            assert row2["rank"] == 1 and row2["net"] == 4.0
        finally:
            for rid in created:
                requests.delete(f"{API}/races/{rid}", headers=h(club_officer_token))
            requests.delete(f"{API}/series/{sid}", headers=h(club_admin_token))
            requests.delete(f"{API}/classes/{cls['id']}", headers=h(club_admin_token))
