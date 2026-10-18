"""The one-design fleet rule that decides cross-club class grouping.

Scoring lives on the series, so a class's legacy scoring_mode must not decide
whether it shares a public one-design class page. These tests pin the rule and
the API listing that applies it.
"""

import asyncio
from types import SimpleNamespace

from starlette.requests import Request

import server
from app.class_fleet import (
    division_names,
    has_rating_divisions,
    one_design_fleet,
    one_design_fleet_class_ids,
    series_scoring_modes,
)


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, key, direction=1):
        self.docs.sort(key=lambda doc: doc.get(key) or "", reverse=(direction < 0))
        return self

    async def to_list(self, _n):
        return [dict(d) for d in self.docs]


class _Coll:
    def __init__(self, docs=()):
        self.docs = [dict(d) for d in docs]

    def find(self, query=None, proj=None):
        query = query or {}
        matched = []
        for doc in self.docs:
            ok = True
            for key, wanted in query.items():
                value = doc.get(key)
                if isinstance(wanted, dict) and "$in" in wanted:
                    if value not in wanted["$in"]:
                        ok = False
                elif value != wanted:
                    ok = False
            if ok:
                matched.append(doc)
        return _Cursor(matched)


def _request():
    return Request({
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/api/classes",
        "raw_path": b"/api/classes",
        "query_string": b"",
        "headers": [],
        "server": ("127.0.0.1", 8000),
        "client": ("127.0.0.1", 50000),
        "root_path": "",
    })


def test_division_names_match_the_scoring_threshold():
    assert division_names({"divisions": [{"name": " IRC "}, {"name": "irc"}, {"name": ""}]}) == ["IRC"]
    assert has_rating_divisions({"divisions": [{"name": "IRC"}]}) is False
    assert has_rating_divisions({"divisions": [{"name": "IRC"}, {"name": "YTC"}]}) is True


def test_series_modes_fall_back_to_one_design():
    assert series_scoring_modes({"scoring_modes": ["irc", "irc", "ytc"]}) == ["irc", "ytc"]
    assert series_scoring_modes({"scoring_mode": "py"}) == ["py"]
    assert series_scoring_modes({}) == ["one_design"]


def test_a_class_is_one_design_only_when_its_series_are():
    one_design = {"id": "c1", "name": "Sonata", "scoring_mode": "irc"}
    irc = {"id": "c2", "name": "Cruisers", "scoring_mode": "one_design"}
    split = {"id": "c3", "name": "Mixed", "divisions": [
        {"name": "IRC", "scoring_mode": "irc"}, {"name": "YTC", "scoring_mode": "ytc"}]}
    unraced = {"id": "c4", "name": "New Fleet", "scoring_mode": "irc"}
    classes = [one_design, irc, split, unraced]
    series = [
        {"class_id": "c1", "scoring_mode": "one_design"},
        {"class_id": "c2", "scoring_modes": ["irc", "ytc"]},
        {"class_id": "c3", "scoring_mode": "one_design"},
    ]

    # The class's own scoring_mode is deliberately misleading in both cases.
    assert one_design_fleet(one_design, [s for s in series if s["class_id"] == "c1"]) is True
    assert one_design_fleet(irc, [s for s in series if s["class_id"] == "c2"]) is False
    assert one_design_fleet(split, [s for s in series if s["class_id"] == "c3"]) is False
    # A class with no series yet keeps the grouping a new class always had.
    assert one_design_fleet(unraced, []) is True
    assert one_design_fleet_class_ids(classes, series) == {"c1", "c4"}


def test_class_listing_groups_by_the_series_not_the_stored_class_mode(monkeypatch):
    db = SimpleNamespace(
        classes=_Coll([
            {"id": "c1", "club_id": "club-1", "name": "Sonata", "scoring_mode": "irc"},
            {"id": "c2", "club_id": "club-1", "name": "Cruisers", "scoring_mode": "one_design"},
            {"id": "c3", "club_id": "club-1", "name": "Mixed", "scoring_mode": "one_design",
             "divisions": [{"name": "IRC", "scoring_mode": "irc"},
                           {"name": "YTC", "scoring_mode": "ytc"}]},
        ]),
        series=_Coll([
            {"class_id": "c1", "scoring_mode": "one_design"},
            {"class_id": "c2", "scoring_modes": ["irc", "ytc"]},
            {"class_id": "c3", "scoring_mode": "one_design"},
        ]),
    )
    server.db = db

    async def fake_club(_request, club_id=None, honor_param=False):
        return club_id

    monkeypatch.setattr(server, "_resolve_club_id", fake_club)
    items = asyncio.run(server.get_classes(_request(), club_id="club-1"))
    keys = {item["name"]: item["class_group_key"] for item in items}

    assert keys["Sonata"] == "sonata"
    assert keys["Cruisers"] is None
    assert keys["Mixed"] is None
