"""Unit tests for the Clubhouse TV Display backend endpoints and configuration."""

import asyncio
from types import SimpleNamespace
from urllib.parse import urlencode
import pytest
from fastapi import HTTPException
from starlette.requests import Request

import server
from app import tv_display


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)
        self.i = 0

    def sort(self, key_or_list, direction=1):
        if isinstance(key_or_list, list):
            for k, d in reversed(key_or_list):
                self.docs.sort(key=lambda doc: (doc.get(k) is None, doc.get(k) or ""), reverse=(d < 0))
        else:
            self.docs.sort(key=lambda doc: (doc.get(key_or_list) is None, doc.get(key_or_list) or ""), reverse=(direction < 0))
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    def __aiter__(self):
        self.i = 0
        return self

    async def __anext__(self):
        if self.i >= len(self.docs):
            raise StopAsyncIteration
        doc = self.docs[self.i]
        self.i += 1
        return doc.copy()

    async def to_list(self, n):
        return [d.copy() for d in self.docs[:n]]


class _Coll:
    def __init__(self, docs=()):
        self.docs = [dict(d) for d in docs]

    def find(self, query=None, proj=None):
        query = query or {}
        return _Cursor([d for d in self.docs if _matches(d, query)])

    async def find_one(self, query, proj=None):
        return next((d.copy() for d in self.docs if _matches(d, query)), None)

    async def update_one(self, query, update):
        for d in self.docs:
            if _matches(d, query):
                if "$set" in update:
                    d.update(update["$set"])
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    async def count_documents(self, query):
        return sum(1 for d in self.docs if _matches(d, query))


def _matches(doc, query):
    for key, wanted in query.items():
        if key == "$or":
            if not any(_matches(doc, opt) for opt in wanted):
                return False
            continue
        if key == "$and":
            if not all(_matches(doc, opt) for opt in wanted):
                return False
            continue
        val = doc.get(key)
        if isinstance(wanted, dict):
            if "$in" in wanted and val not in wanted["$in"]:
                return False
            if "$ne" in wanted and val == wanted["$ne"]:
                return False
            if "$exists" in wanted and ((key in doc and doc[key] is not None) != wanted["$exists"]):
                return False
        else:
            if val != wanted:
                return False
    return True


def _make_request(path="/api/clubs/royal-harbour/display", query=None):
    qs = urlencode(query or {}).encode()
    return Request({
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": qs,
        "headers": [],
        "server": ("127.0.0.1", 8000),
        "client": ("127.0.0.1", 50000),
        "root_path": "",
    })


def _sample_db(tv_config=None, race_day_info=None, approval_status="approved"):
    club = {
        "id": "club-1",
        "name": "Royal Harbour Sailing Club",
        "slug": "royal-harbour",
        "color": "#0F4C81",
        "icon": "data:image/png;base64,iVBORw0KGgo=",
        "approval_status": approval_status,
        "race_day_notices": True,
        "official_notice_board": True,
    }
    if tv_config is not None:
        club["tv_config"] = tv_config
    if race_day_info is not None:
        club["race_day_info"] = race_day_info

    other_club = {
        "id": "club-2",
        "name": "Other Yacht Club",
        "slug": "other-club",
        "approval_status": "approved",
    }

    classes = [
        {
            "id": "class-sonata",
            "club_id": "club-1",
            "name": "Sonata",
            "scoring_mode": "one_design",
            "default_start_time": "10:30",
        },
        {
            "id": "class-cruiser",
            "club_id": "club-1",
            "name": "Cruiser Fleet",
            "scoring_mode": "irc",
            "default_start_time": "11:00",
            "divisions": [
                {"name": "IRC", "scoring_mode": "irc"},
                {"name": "YTC", "scoring_mode": "ytc"},
            ],
        },
        {
            "id": "class-other",
            "club_id": "club-2",
            "name": "Other Class",
            "scoring_mode": "one_design",
        },
    ]

    boats = [
        {
            "id": "b1",
            "class_id": "class-sonata",
            "name": "Bluebird",
            "sail_no": "GBR 8123",
            "helm": "Alice Smith",
            "year": 2026,
            "fleet_id": "fb1",
        },
        {
            "id": "b2",
            "class_id": "class-sonata",
            "name": "Tailwind",
            "sail_no": "GBR 8456",
            "helm": "Bob Jones",
            "year": 2026,
            "fleet_id": "fb2",
        },
        {
            "id": "b3",
            "class_id": "class-cruiser",
            "name": "Zephyr",
            "sail_no": "GBR 901",
            "helm": "Charlie Brown",
            "tcc": 0.985,
            "division": "IRC",
            "year": 2026,
            "fleet_id": "fb3",
        },
        {
            "id": "b4",
            "class_id": "class-cruiser",
            "name": "Mistral",
            "sail_no": "GBR 902",
            "helm": "Diana Prince",
            "ytc": 920,
            "division": "YTC",
            "year": 2026,
            "fleet_id": "fb4",
        },
    ]

    series = [
        {
            "id": "series-sonata-summer",
            "class_id": "class-sonata",
            "name": "Summer Points",
            "year": 2026,
            "planned_races": 6,
            "discards": 0,
            "schedule": ["2026-06-01", "2026-06-08", "2026-11-01"],
        },
        {
            "id": "series-cruiser-summer",
            "class_id": "class-cruiser",
            "name": "Cruiser Summer",
            "year": 2026,
            "planned_races": 4,
            "discards": 0,
            "schedule": ["2026-06-01", "2026-11-15"],
        },
    ]

    races = [
        {
            "id": "race-1",
            "club_id": "club-1",
            "class_id": "class-sonata",
            "series_id": "series-sonata-summer",
            "race_number": 1,
            "year": 2026,
            "date": "2026-06-01",
            "status": "published",
            "start_time": "10:30:00",
            "course": "Windward-Leeward 3 laps (Marks 1p, 4s)",
            "results": [
                {"boat_id": "b1", "code": "FINISHED", "position": 1, "finish_time": "11:23:20"},
                {"boat_id": "b2", "code": "FINISHED", "position": 2, "finish_time": "11:25:10"},
            ],
        },
        {
            "id": "race-2",
            "club_id": "club-1",
            "class_id": "class-sonata",
            "series_id": "series-sonata-summer",
            "race_number": 2,
            "year": 2026,
            "date": "2026-06-08",
            "status": "provisional",
            "start_time": "10:30:00",
            "course": "Harbour Tour (Marks A, B, C)",
            "special_rules": "Keep clear of commercial channel",
            "life_jackets": True,
            "results": [
                {"boat_id": "b2", "code": "FINISHED", "position": 1, "finish_time": "11:19:10"},
                {"boat_id": "b1", "code": "FINISHED", "position": 2, "finish_time": "11:20:10"},
            ],
        },
        {
            "id": "race-3",
            "club_id": "club-1",
            "class_id": "class-cruiser",
            "series_id": "series-cruiser-summer",
            "race_number": 1,
            "year": 2026,
            "date": "2026-06-01",
            "status": "published",
            "start_time": "11:00:00",
            "results": [
                {"boat_id": "b3", "code": "FINISHED", "position": 1, "finish_time": "12:00:00"},
                {"boat_id": "b4", "code": "FINISHED", "position": 2, "finish_time": "12:00:20"},
            ],
        },
    ]

    regattas = [
        {
            "id": "reg-1",
            "club_id": "club-1",
            "name": "Autumn Regatta",
            "year": 2026,
            "series_ids": ["series-sonata-summer", "series-cruiser-summer"],
        }
    ]

    notices = [
        {
            "id": "n-1",
            "club_id": "club-1",
            "title": "Change to Mark 4 position",
            "notice_type": "SI Amendment",
            "notice_number": 2,
            "status": "published",
            "created_at": "2026-06-08T08:00:00+00:00",
            "fields": {"instruction": "Mark 4 moved 100m north"},
        },
        {
            "id": "n-draft",
            "club_id": "club-1",
            "title": "Secret draft notice",
            "notice_type": "General Notice",
            "notice_number": 3,
            "status": "draft",
            "created_at": "2026-06-08T09:00:00+00:00",
            "fields": {"body": "Do not show on TV"},
        },
    ]

    return SimpleNamespace(
        clubs=_Coll([club, other_club]),
        classes=_Coll(classes),
        boats=_Coll(boats),
        series=_Coll(series),
        races=_Coll(races),
        regattas=_Coll(regattas),
        notices=_Coll(notices),
        season_snapshots=_Coll([]),
        audit_logs=_Coll([]),
    )


class TestClubhouseTvDisplayPayload:
    def test_resolves_club_by_slug_or_id_and_computes_views(self):
        server.db = _sample_db()
        req = _make_request("/api/clubs/royal-harbour/display")

        payload = asyncio.run(tv_display.get_club_tv_display("royal-harbour", req))

        assert payload["club"]["id"] == "club-1"
        assert payload["club"]["name"] == "Royal Harbour Sailing Club"
        assert payload["club"]["slug"] == "royal-harbour"
        assert payload["config"]["enabled"] is True
        assert payload["config"]["rotation_seconds"] == 15

        views = payload["views"]
        assert len(views["overall"]) >= 1
        assert len(views["classes"]) >= 2
        assert len(views["latest_races"]) >= 2
        assert len(views["series_progress"]) >= 2

        # A class view carries its series' schedule so the TV can show every
        # planned race (dated) in the series sheet, not only those sailed.
        sonata = next(v for v in views["classes"] if v["series_id"] == "series-sonata-summer")
        assert sonata["planned_races"] == 6
        assert sonata["schedule"] == ["2026-06-01", "2026-06-08", "2026-11-01"]

        # Overall view uses official scoring and orders leading boats
        overall = views["overall"][0]
        assert overall["class_name"] in ("Sonata", "Cruiser Fleet")
        assert len(overall["standings"]) == 2
        assert overall["standings"][0]["rank"] == 1

    def test_supports_multiple_rating_systems_as_distinct_class_views(self):
        server.db = _sample_db()
        req = _make_request("/api/clubs/club-1/display")

        payload = asyncio.run(tv_display.get_club_tv_display("club-1", req))

        class_views = payload["views"]["classes"]
        labels = [(v["class_name"], v["scoring_mode"], v.get("division_name")) for v in class_views]
        # Sonata (one_design) + Cruiser Fleet (IRC division) + Cruiser Fleet (YTC division)
        assert ("Sonata", "one_design", None) in labels
        assert ("Cruiser Fleet", "irc", "IRC") in labels
        assert ("Cruiser Fleet", "ytc", "YTC") in labels

    def test_ytc_race_view_publishes_elapsed_and_corrected_times_like_irc(self):
        """YTC is a handicap division, so its TV table carries the same time
        columns as IRC — and it never falls back to a points column, even when
        a boat has no computable corrected time yet.
        """
        db = _sample_db()
        for race in db.races.docs:
            if race["id"] != "race-3":
                continue
            race["start_tz_offset_minutes"] = 0
            for res in race["results"]:
                res["finish_time"] = (
                    "2026-06-01T12:00:00+00:00" if res["boat_id"] == "b3"
                    else "2026-06-01T12:05:00+00:00"
                )
        server.db = db

        payload = asyncio.run(tv_display.get_club_tv_display(
            "royal-harbour", _make_request("/api/clubs/royal-harbour/display")))
        by_division = {v["division_name"]: v for v in payload["views"]["latest_races"]}

        irc, ytc = by_division["IRC"], by_division["YTC"]
        assert irc["scoring_mode"] == "irc" and ytc["scoring_mode"] == "ytc"
        assert irc["shows_times"] is True and ytc["shows_times"] is True
        # IRC corrects by the boat's TCC, YTC by her yardstick number.
        assert irc["results"][0]["corrected_formatted"] == "59:06"
        assert ytc["results"][0]["elapsed_formatted"] == "1:05:00"
        assert ytc["results"][0]["corrected_formatted"] == "1:10:39"

        one_design = next(v for v in payload["views"]["latest_races"]
                          if v["scoring_mode"] == "one_design")
        assert one_design["shows_times"] is False

        # A missing YTC number leaves the corrected cell empty, but the table
        # still shows both time columns rather than switching to points.
        for boat in db.boats.docs:
            if boat["id"] == "b4":
                boat["ytc"] = None
        payload = asyncio.run(tv_display.get_club_tv_display(
            "royal-harbour", _make_request("/api/clubs/royal-harbour/display")))
        ytc = next(v for v in payload["views"]["latest_races"]
                   if v["division_name"] == "YTC")
        assert ytc["shows_times"] is True
        assert ytc["results"][0]["elapsed_formatted"] == "1:05:00"
        assert ytc["results"][0]["corrected_formatted"] is None

    def test_a_single_system_race_lists_only_boats_it_can_rate(self):
        """A race scored in one rating system is that system's fleet on the TV
        too: a boat with no certificate for it is not listed in that table (she
        still scores in the other system's series over the same races)."""
        db = _sample_db()
        cls = next(c for c in db.classes.docs if c["id"] == "class-cruiser")
        cls["divisions"] = []
        cls["scoring_mode"] = "ytc"
        ser = next(s for s in db.series.docs if s["id"] == "series-cruiser-summer")
        ser["scoring_mode"] = "ytc"
        server.db = db

        payload = asyncio.run(tv_display.get_club_tv_display(
            "royal-harbour", _make_request("/api/clubs/royal-harbour/display")))
        view = next(v for v in payload["views"]["latest_races"] if v["race_id"] == "race-3")
        assert view["scoring_mode"] == "ytc"
        # Zephyr carries a TCC only, so she has no place in a YTC race.
        assert [r["sail_no"] for r in view["results"]] == ["GBR 902"]

    def test_distinguishes_provisional_and_finalised_latest_races(self):
        server.db = _sample_db()
        req = _make_request("/api/clubs/royal-harbour/display")

        payload = asyncio.run(tv_display.get_club_tv_display("royal-harbour", req))

        latest_views = payload["views"]["latest_races"]
        assert len(latest_views) >= 2
        by_race = {v["race_id"]: v for v in latest_views}
        # Race 2 is provisional -> is_provisional = True, status = provisional
        assert by_race["race-2"]["is_provisional"] is True
        assert by_race["race-2"]["status"] == "provisional"
        # Race 3 is published -> is_provisional = False, status = final
        assert by_race["race-3"]["is_provisional"] is False
        assert by_race["race-3"]["status"] == "final"

    def test_enforces_public_access_control_when_disabled_or_unapproved(self, monkeypatch):
        # 1. Disabled TV display returns 403 for anonymous viewer
        server.db = _sample_db(tv_config={"enabled": False})
        req = _make_request("/api/clubs/royal-harbour/display")
        with pytest.raises(HTTPException) as exc:
            asyncio.run(tv_display.get_club_tv_display("royal-harbour", req))
        assert exc.value.status_code == 403

        # 2. Authorised club admin CAN preview when disabled if ?preview=1
        async def fake_admin_user(_req):
            return {"id": "u1", "role": "admin", "club_id": "club-1", "username": "admin@club1"}
        monkeypatch.setattr(server, "get_current_user", fake_admin_user)

        preview_req = _make_request("/api/clubs/royal-harbour/display", {"preview": "1"})
        payload = asyncio.run(tv_display.get_club_tv_display("royal-harbour", preview_req))
        assert payload["club"]["id"] == "club-1"

        # 3. Admin from ANOTHER club cannot preview disabled display
        async def fake_other_admin(_req):
            return {"id": "u2", "role": "admin", "club_id": "club-2", "username": "admin@club2"}
        monkeypatch.setattr(server, "get_current_user", fake_other_admin)

        with pytest.raises(HTTPException) as exc2:
            asyncio.run(tv_display.get_club_tv_display("royal-harbour", preview_req))
        assert exc2.value.status_code == 403

        # 4. Pending club is hidden from anonymous users (404)
        async def fake_anon(_req):
            return None
        monkeypatch.setattr(server, "get_current_user", fake_anon)
        server.db = _sample_db(approval_status="pending")
        with pytest.raises(HTTPException) as exc3:
            asyncio.run(tv_display.get_club_tv_display("royal-harbour", req))
        assert exc3.value.status_code == 404

    def test_empty_club_returns_clean_empty_views(self):
        server.db = _sample_db()
        req = _make_request("/api/clubs/other-club/display")
        payload = asyncio.run(tv_display.get_club_tv_display("other-club", req))
        assert payload["club"]["slug"] == "other-club"
        assert payload["views"]["overall"] == []
        assert payload["views"]["classes"] == []
        assert payload["views"]["latest_races"] == []
        assert payload["views"]["series_progress"] == []

    def test_race_day_panel_merges_configured_info_and_live_races_without_leaking_draft_notices(self):
        server.db = _sample_db(
            race_day_info={
                "title": "Commodore's Cup Race Day",
                "date": "2026-06-08",
                "race_officer": "RO David Williams",
                "status": "racing",
                "courses": "Sonata: Course B (1p - 2p - 4s, 3 laps)",
                "course_diagram": "Start -> 1(P) -> 2(P) -> 4(S) -> Finish",
                "start_sequence": "10:25 Warning (Code Flag S) · 10:30 Start",
                "notes": "Strong ebb tide on the northern bank.",
                "announcements": "Prize giving in the clubhouse bar at 16:00.",
            }
        )
        req = _make_request("/api/clubs/royal-harbour/display")
        payload = asyncio.run(tv_display.get_club_tv_display("royal-harbour", req))

        rd = payload["race_day"]
        assert rd["title"] == "Commodore's Cup Race Day"
        assert rd["race_officer"] == "RO David Williams"
        assert rd["status"] == "racing"
        assert rd["notes"] == "Strong ebb tide on the northern bank."
        assert "Course B" in rd["courses"]
        assert "10:25 Warning" in rd["start_sequence"]
        assert "Prize giving in the clubhouse bar at 16:00." in rd["announcements"]
        # Live race data on 2026-06-08 is also surfaced
        assert rd["life_jackets"] is True
        assert any("Keep clear of commercial channel" in n for n in rd["live_notes"])
        # Official notices only include published ones, never drafts
        notice_titles = [n["title"] for n in rd["onb_notices"]]
        assert "Change to Mark 4 position" in notice_titles
        assert "Secret draft notice" not in notice_titles

    def test_race_day_mode_shows_only_latest_race_date_and_its_classes(self):
        server.db = _sample_db(tv_config={"display_mode": "race_day"})
        req = _make_request("/api/clubs/royal-harbour/display")
        payload = asyncio.run(tv_display.get_club_tv_display("royal-harbour", req))

        assert payload["config"]["display_mode"] == "race_day"
        assert payload["results_date"]
        assert payload["views"]["overall"] == []
        assert payload["views"]["series_progress"] == []

        latest = payload["views"]["latest_races"]
        assert latest
        assert {r["date"] for r in latest} == {payload["results_date"]}

        raced_class_ids = {r["class_id"] for r in latest}
        class_views = payload["views"]["classes"]
        assert class_views
        assert {cv["class_id"] for cv in class_views} <= raced_class_ids

    def test_racing_calendar_groups_upcoming_planned_dates_by_date_with_race_numbers(self):
        # Fixed far-future dates keep this deterministic regardless of the run date.
        server.db = _sample_db()
        server.db.series.docs.append({
            "id": "series-sonata-winter", "class_id": "class-sonata", "name": "Winter Series",
            "year": 2026, "schedule": ["2000-01-01", "2099-01-01", "2099-01-08"],
        })
        server.db.series.docs.append({
            "id": "series-cruiser-winter", "class_id": "class-cruiser", "name": "Cruiser Winter",
            "year": 2026, "schedule": ["2099-01-01"],
        })
        req = _make_request("/api/clubs/royal-harbour/display")
        payload = asyncio.run(tv_display.get_club_tv_display("royal-harbour", req))

        calendar = payload["race_day"]["calendar"]
        dates = [day["date"] for day in calendar]
        assert dates == sorted(dates)
        assert "2000-01-01" not in dates
        assert len(calendar) <= tv_display.CALENDAR_SUMMARY_DAYS

        by_date = {day["date"]: day["races"] for day in calendar}
        assert by_date["2099-01-01"] == [
            {"series_name": "Cruiser Winter", "class_name": "Cruiser Fleet", "race_number": 1},
            {"series_name": "Winter Series", "class_name": "Sonata", "race_number": 2},
        ]
        assert by_date["2099-01-08"] == [
            {"series_name": "Winter Series", "class_name": "Sonata", "race_number": 3},
        ]

    def test_racing_calendar_can_be_switched_off_and_is_capped(self):
        server.db = _sample_db(tv_config={"show_calendar": False})
        req = _make_request("/api/clubs/royal-harbour/display")
        payload = asyncio.run(tv_display.get_club_tv_display("royal-harbour", req))
        assert payload["race_day"]["calendar"] == []

        server.db = _sample_db()
        server.db.series.docs.append({
            "id": "series-many", "class_id": "class-sonata", "name": "Many Dates",
            "year": 2026, "schedule": [f"2099-02-{d:02d}" for d in range(1, 9)],
        })
        payload = asyncio.run(tv_display.get_club_tv_display("royal-harbour", req))
        assert len(payload["race_day"]["calendar"]) == tv_display.CALENDAR_SUMMARY_DAYS

    def test_saved_section_switches_persist_and_hide_sections(self):
        server.db = _sample_db(race_day_info={
            "race_officer": "RO Jane",
            "courses": "Course 1 (windward)",
            "announcements": "Prize giving at 16:30",
            "notes": "Life jackets mandatory",
            "start_sequence": "10:30 Sonata",
        })
        admin_user = {"id": "u1", "role": "admin", "club_id": "club-1", "username": "admin@club1"}
        section_keys = (
            "show_race_officer", "show_courses", "show_schedule", "show_notes",
            "show_announcements", "show_status", "show_calendar",
        )
        cfg_in = tv_display.TvDisplayConfigInput(**{key: False for key in section_keys})
        req = _make_request("/api/clubs/royal-harbour/tv-config")
        res = asyncio.run(tv_display.update_club_tv_config("royal-harbour", cfg_in, req, user=admin_user))
        for key in section_keys:
            assert res["tv_config"][key] is False, key

        stored = server.db.clubs.docs[0]["tv_config"]
        for key in section_keys:
            assert stored[key] is False, key

        payload = asyncio.run(
            tv_display.get_club_tv_display("royal-harbour", _make_request("/api/clubs/royal-harbour/display"))
        )
        for key in section_keys:
            assert payload["config"][key] is False, key
        race_day = payload["race_day"]
        assert race_day["race_officer"] == ""
        assert race_day["courses"] == ""
        assert race_day["live_courses"] == []
        assert race_day["course_diagram"] == ""
        assert race_day["start_sequence"] == ""
        assert race_day["schedule"] == []
        assert race_day["notes"] == ""
        assert race_day["live_notes"] == []
        assert race_day["announcements"] == ""
        assert race_day["onb_notices"] == []
        assert race_day["status"] == ""
        assert race_day["calendar"] == []

    def test_race_officer_may_read_and_change_the_display_config(self):
        """The TV is the race officer's own scoreboard, so the config routes
        accept officers — not just club admins. The dependency is checked on
        the route itself because the handlers are exercised with a user dict
        below.
        """
        for method in ("GET", "PUT"):
            deps = [
                dep.call
                for route in tv_display.router.routes
                if route.path == "/api/clubs/{club_identifier}/tv-config" and method in route.methods
                for dep in route.dependant.dependencies
            ]
            assert deps == [tv_display._require_officer_dep], method

    def test_admin_reads_saved_config_for_club_missing_from_public_list(self):
        section_keys = (
            "show_race_officer", "show_courses", "show_schedule", "show_notes",
            "show_announcements", "show_status", "show_calendar",
        )
        server.db = _sample_db(
            tv_config={key: False for key in section_keys},
            approval_status="pending",
        )
        admin_user = {"id": "u1", "role": "admin", "club_id": "club-1", "username": "admin@club1"}
        res = asyncio.run(tv_display.get_club_tv_config("royal-harbour", user=admin_user))
        for key in section_keys:
            assert res["tv_config"][key] is False, key

    def test_admin_cannot_read_another_clubs_tv_config(self):
        server.db = _sample_db()
        other_admin = {"id": "u2", "role": "admin", "club_id": "club-2", "username": "admin@club2"}
        with pytest.raises(HTTPException) as exc:
            asyncio.run(tv_display.get_club_tv_config("royal-harbour", user=other_admin))
        assert exc.value.status_code == 403

    def test_active_series_ids_normalize_and_keep_legacy_single_series(self):
        cfg = tv_display.normalize_tv_config({"active_series_ids": ["a", "a", "b"]})
        assert cfg["active_series_ids"] == ["a", "b"]
        assert cfg["active_series_id"] == "a"
        legacy = tv_display.normalize_tv_config({"active_series_id": "s1"})
        assert legacy["active_series_ids"] == ["s1"]
        assert tv_display.normalize_tv_config({})["active_series_ids"] == []

    def test_ticked_series_rotate_and_unticked_series_are_left_out(self):
        req = _make_request("/api/clubs/royal-harbour/display")

        server.db = _sample_db(
            tv_config={"display_mode": "full", "active_series_ids": ["series-sonata-summer", "series-cruiser-summer"]}
        )
        payload = asyncio.run(tv_display.get_club_tv_display("royal-harbour", req))
        assert {cv["series_id"] for cv in payload["views"]["classes"]} == {
            "series-sonata-summer",
            "series-cruiser-summer",
        }

        server.db = _sample_db(tv_config={"display_mode": "full", "active_series_ids": ["series-sonata-summer"]})
        payload = asyncio.run(tv_display.get_club_tv_display("royal-harbour", req))
        assert {cv["series_id"] for cv in payload["views"]["classes"]} == {"series-sonata-summer"}

    def test_saving_an_unknown_ticked_series_is_rejected(self):
        server.db = _sample_db()
        req = _make_request("/api/clubs/royal-harbour/tv-config")
        admin_user = {"id": "u1", "role": "admin", "club_id": "club-1", "username": "admin@club1"}
        cfg_in = tv_display.TvDisplayConfigInput(active_series_ids=["series-missing"])
        try:
            asyncio.run(tv_display.update_club_tv_config("royal-harbour", cfg_in, req, user=admin_user))
        except Exception as exc:
            assert getattr(exc, "status_code", None) == 400
        else:
            raise AssertionError("expected a 400 for an unknown series")

    def test_config_and_race_day_update_endpoints_and_normalizers(self):
        server.db = _sample_db()
        req = _make_request("/api/clubs/royal-harbour/tv-config")
        admin_user = {"id": "u1", "role": "admin", "club_id": "club-1", "username": "admin@club1"}

        cfg_in = tv_display.TvDisplayConfigInput(
            enabled=False,
            active_series_id="series-sonata-summer",
            rotation_seconds=25,
            display_mode="race_day",
        )
        res = asyncio.run(tv_display.update_club_tv_config("royal-harbour", cfg_in, req, user=admin_user))
        assert res["tv_config"]["enabled"] is False
        assert res["tv_config"]["active_series_id"] == "series-sonata-summer"
        assert res["tv_config"]["rotation_seconds"] == 25
        assert res["tv_config"]["display_mode"] == "race_day"
        assert tv_display.normalize_tv_config({"display_mode": "bogus"})["display_mode"] == "full"

        officer_user = {"id": "u2", "role": "officer", "club_id": "club-1", "username": "ro@club1", "name": "RO Jane"}
        rd_in = tv_display.RaceDayInfoInput(
            title="  Spring Sunday  ",
            race_officer="RO Jane",
            status="postponed",
            courses="Course 3",
            announcements="AP over H displayed",
        )
        rd_res = asyncio.run(tv_display.update_club_race_day_info("royal-harbour", rd_in, req, user=officer_user))
        assert rd_res["race_day_info"]["title"] == "Spring Sunday"
        assert rd_res["race_day_info"]["status"] == "postponed"
        assert rd_res["race_day_info"]["updated_by"] == "RO Jane"
