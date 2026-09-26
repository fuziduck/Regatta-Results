"""Unit coverage for the public SEO metadata and crawler endpoints."""

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlencode

import pytest
from fastapi import FastAPI
from starlette.requests import Request

BACKEND_DIR = str(Path(__file__).resolve().parent.parent)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import seo


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def to_list(self, limit):
        async def get_rows():
            return self.rows[:limit]
        return get_rows()


class FakeCollection:
    def __init__(self, rows=()):
        self.rows = list(rows)

    async def find_one(self, query, projection=None):
        return next((row.copy() for row in self.rows if matches(row, query)), None)

    def find(self, query=None, projection=None):
        query = query or {}
        return FakeCursor(row.copy() for row in self.rows if matches(row, query))

    async def count_documents(self, query):
        return sum(1 for row in self.rows if matches(row, query))


def matches(row, query):
    for key, wanted in query.items():
        if key == "$or":
            if not any(matches(row, option) for option in wanted):
                return False
            continue
        value = row
        for part in key.split("."):
            if isinstance(value, list):
                value = [item.get(part) if isinstance(item, dict) else None for item in value]
            elif isinstance(value, dict):
                value = value.get(part)
            else:
                value = None
        values = value if isinstance(value, list) else [value]
        if isinstance(wanted, dict):
            if "$in" in wanted and not any(item in wanted["$in"] for item in values):
                return False
            if "$ne" in wanted and any(item == wanted["$ne"] for item in values):
                return False
            if "$exists" in wanted:
                exists = value is not None
                if exists != wanted["$exists"]:
                    return False
        elif not any(item == wanted for item in values):
            return False
    return True


def _request(app, uri=None):
    query_string = urlencode({"uri": uri}).encode() if uri is not None else b""
    return Request({
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": "/api/seo-meta",
        "raw_path": b"/api/seo-meta",
        "query_string": query_string,
        "headers": [(b"host", b"attacker.example")],
        "server": ("attacker.example", 443),
        "client": ("127.0.0.1", 12345),
        "root_path": "",
        "app": app,
    })


def _metadata(app, uri):
    return asyncio.run(seo.seo_meta(_request(app, uri)))


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    monkeypatch.delenv("PUBLIC_APP_BASE_URL", raising=False)
    db = SimpleNamespace(
        clubs=FakeCollection([
            {"id": "c1", "name": "Medway Yacht Club", "slug": "medway-yacht-club", "icon": "data:image/png;base64,SECRET", "admin_pin": "do-not-leak"},
            {"id": "empty", "name": "Empty Club", "slug": "empty-club"},
        ]),
        classes=FakeCollection([
            {"id": "cl1", "club_id": "c1", "name": "Sonata", "scoring_mode": "one_design"},
            {"id": "cl2", "club_id": "c1", "name": "Laser", "scoring_mode": "one_design"},
        ]),
        series=FakeCollection([
            {"id": "s1", "class_id": "cl1", "name": "Summer Series", "year": 2026, "schedule": ["2026-05-01"]},
            {"id": "s2", "class_id": "cl2", "name": "Winter Series", "year": 2027},
            {"id": "orphan-series", "class_id": "deleted-class", "name": "Orphan Series", "year": 2026},
        ]),
        regattas=FakeCollection([
            {"id": "reg1", "club_id": "c1", "name": "Medway Regatta", "year": 2026,
             "competition_type": "regatta", "host_club": "Medway Yacht Club", "start_date": "2026-06-01",
             "end_date": "2026-06-02", "status": "completed", "thumbnail": "https://images.example/regatta.jpg"},
        ]),
        races=FakeCollection([
            {"id": "race1", "class_id": "cl1", "series_id": "s1", "race_number": 6, "year": 2026,
             "date": "2026-06-01", "status": "published", "abandoned": False,
             "results": [
                 {"boat_id": "b1", "code": "FINISHED", "position": 1},
                 {"boat_id": "b2", "code": "DNC", "position": None},
             ]},
            {"id": "secret", "class_id": "cl1", "series_id": "s1", "race_number": 7, "year": 2026,
             "status": "draft", "results": [{"boat_id": "b1", "code": "FINISHED", "position": 1}]},
            {"id": "orphan-race", "class_id": "deleted-class", "series_id": "orphan-series", "race_number": 1, "year": 2026,
             "status": "published", "results": [{"boat_id": "b1", "code": "FINISHED", "position": 1}]},
            {"id": "unlinked-race", "class_id": "cl1", "race_number": 2, "year": 2026,
             "status": "published", "results": [{"boat_id": "b1", "code": "FINISHED", "position": 1}]},
            {"id": "cross-linked-race", "class_id": "cl1", "series_id": "s2", "race_number": 99, "year": 2027,
             "status": "published", "results": [{"boat_id": "b1", "code": "FINISHED", "position": 1}]},
        ]),
        boats=FakeCollection([
            {"id": "b1", "fleet_id": "f1", "fleet_key": "8420|watersong", "class_id": "cl1", "name": "Watersong", "sail_no": "8420", "created_at": "2025-01-01", "helm": "Private Helm"},
            {"id": "b2", "fleet_id": "f2", "class_id": "cl1", "name": "DNC Boat", "sail_no": "2"},
        ]),
    )
    application = FastAPI()
    application.state.db = db
    application.include_router(seo.router)
    return application


def test_legacy_and_readable_routes_share_metadata_and_canonical(app):
    legacy = _metadata(app, "/club/medway-yacht-club?class=cl1&series=s1&year=2026")
    readable_path = "/club/medway-yacht-club/series/s1/summer-series-2026?class=cl1&year=2026"
    readable = _metadata(app, readable_path)

    assert legacy["title"] == "Summer Series 2026 Results – Sonata | Medway Yacht Club | SailScore"
    assert legacy["canonical"] == "https://www.sailscore.co.uk" + readable_path
    assert readable["canonical"] == legacy["canonical"]
    assert "1 published race" in legacy["description"]
    assert legacy["robots"] == "index,follow"


def test_regatta_and_race_metadata_use_public_racing_data(app):
    event = _metadata(app, "/club/medway-yacht-club/regatta/reg1/medway-regatta-2026")
    race = _metadata(app, "/club/medway-yacht-club/race/race1/sonata-summer-series-race-6-2026")

    assert event["title"] == "Medway Regatta 2026 Results | SailScore"
    assert event["schema"]["@type"] == "SportsEvent"
    assert event["schema"]["startDate"] == "2026-06-01"
    assert race["title"] == "Sonata Race 6 Results – Medway Yacht Club | SailScore"
    assert race["schema"]["@type"] == "SportsEvent"
    assert "DNC Boat" not in race["description"]
    response = asyncio.run(seo.seo_html(_request(app, "/club/medway-yacht-club/race/race1")))
    assert response.status_code == 200
    assert "Top published finishers: 1. Watersong (8420)." in response.body.decode()
    assert "Private Helm" not in response.body.decode()


def test_boat_and_class_pages_are_only_indexable_with_published_results(app):
    boat = _metadata(app, "/boat/f1/watersong")
    empty_boat = _metadata(app, "/boat/f2/dnc-boat")
    class_page = _metadata(app, "/class/cl1/sonata")

    assert boat["title"] == "Watersong – SailScore Sailing Results"
    assert boat["canonical"] == "https://www.sailscore.co.uk/boat/f1/watersong"
    assert "helm" not in str(boat).lower()
    assert empty_boat["robots"] == "noindex,nofollow"
    assert class_page["robots"] == "index,follow"


def test_private_pages_unknown_paths_and_notice_board_are_noindex(app):
    for uri in ("/admin", "/subscriptions/manage?token=secret", "/unknown/path", "/club/medway-yacht-club/notice-board"):
        metadata = _metadata(app, uri)
        assert metadata["robots"] == "noindex,nofollow"
    robots = asyncio.run(seo.robots_txt(_request(app))).body.decode()
    assert "Disallow: /admin" in robots
    assert "Disallow: /subscriptions/" in robots
    assert "Sitemap: https://www.sailscore.co.uk/sitemap.xml" in robots
    assert seo._public_base(_request(app)) == "https://www.sailscore.co.uk"


def test_html_escapes_metadata_and_includes_social_cards(app):
    page = {
        "base": "https://www.sailscore.co.uk",
        "canonical": "https://www.sailscore.co.uk/x?a=\"bad\"",
        "description": "A <script>safe</script> & valid description",
        "robots": "index,follow", "kind": "article", "image": "https://example.test/photo.jpg",
        "title": "A < B & C", "schema": {"@type": "Thing", "name": "</script><script>alert(1)</script>"},
    }
    rendered = seo._render_html(page)
    assert "<title>A &lt; B &amp; C</title>" in rendered
    assert 'property="og:url"' in rendered
    assert 'name="twitter:card" content="summary_large_image"' in rendered
    assert "<script>alert(1)</script>" not in rendered
    assert "data:image" not in rendered


def test_sitemap_only_contains_published_and_public_entities(app):
    sitemap = asyncio.run(seo.sitemap_xml(_request(app))).body.decode()
    assert "/club/medway-yacht-club" in sitemap
    assert "/club/empty-club" not in sitemap
    assert "/boat/f1/watersong" in sitemap
    assert "/boat/f2/dnc-boat" not in sitemap
    assert "/race/race1/" in sitemap
    assert "secret" not in sitemap
    assert "admin_pin" not in sitemap
    assert "notice-board" not in sitemap
    assert "orphan-race" not in sitemap
    assert "unlinked-race" not in sitemap
    assert "cross-linked-race" not in sitemap
    assert "/series/s2/" not in sitemap
    assert "year=2027" not in sitemap
