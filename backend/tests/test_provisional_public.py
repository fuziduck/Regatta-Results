"""Public visibility of a provisional race.

A provisional result is a completed race awaiting confirmation: it already
counts in the series and championship tables, so the public race list and the
single race page must serve it — results included — exactly as they serve a
published one, otherwise the race reads as one still to be sailed and the
standings can never be checked against it. A race nobody has scored stays
metadata-only, as before.
"""
import asyncio
from types import SimpleNamespace
from urllib.parse import urlencode

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import server


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, key_or_list, direction=1):
        if isinstance(key_or_list, list):
            for key, dirn in reversed(key_or_list):
                self.docs.sort(key=lambda doc: (doc.get(key) is None, doc.get(key) or ""),
                               reverse=(dirn < 0))
        else:
            self.docs.sort(key=lambda doc: (doc.get(key_or_list) is None, doc.get(key_or_list) or ""),
                           reverse=(direction < 0))
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    async def to_list(self, n):
        return [dict(d) for d in self.docs[:n]]


class _Coll:
    def __init__(self, docs=()):
        self.docs = [dict(d) for d in docs]

    def find(self, query=None, proj=None):
        return _Cursor([d for d in self.docs if _matches(d, query or {})])

    async def find_one(self, query, proj=None):
        return next((dict(d) for d in self.docs if _matches(d, query)), None)

    async def count_documents(self, query):
        return sum(1 for d in self.docs if _matches(d, query))


def _matches(doc, query):
    for key, wanted in query.items():
        val = doc.get(key)
        if isinstance(wanted, dict):
            if "$in" in wanted and val not in wanted["$in"]:
                return False
            if "$ne" in wanted and val == wanted["$ne"]:
                return False
        elif val != wanted:
            return False
    return True


def _make_request(path="/api/races", query=None):
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


async def _anonymous(request):
    return None


def _race(race_id, number, status):
    return {
        "id": race_id,
        "club_id": "club-1",
        "class_id": "class-1",
        "series_id": "series-1",
        "year": 2026,
        "race_number": number,
        "date": f"2026-05-0{number}",
        "start_time": "10:30",
        "status": status,
        "entries_count": 2,
        "results": [
            {"boat_id": "b1", "code": "FINISHED", "position": 1},
            {"boat_id": "b2", "code": "FINISHED", "position": 2},
        ],
    }


def _sample_db():
    club = {"id": "club-1", "name": "Harbour Club", "slug": "harbour", "approval_status": "approved"}
    classes = [{"id": "class-1", "club_id": "club-1", "name": "Sonata", "scoring_mode": "one_design"}]
    series = [{"id": "series-1", "class_id": "class-1", "name": "Summer", "year": 2026,
               "scoring_mode": "one_design"}]
    races = [
        _race("race-provisional", 1, "provisional"),
        _race("race-published", 2, "published"),
        _race("race-scheduled", 3, "scheduled"),
    ]
    return SimpleNamespace(clubs=_Coll([club]), classes=_Coll(classes),
                           series=_Coll(series), races=_Coll(races))


def test_public_race_list_serves_provisional_results(monkeypatch):
    server.db = _sample_db()
    monkeypatch.setattr(server, "get_current_user", _anonymous)
    request = _make_request("/api/races", {"class_id": "class-1"})

    items = asyncio.run(server.get_races(request, class_id="class-1"))
    by_id = {item["id"]: item for item in items}

    # A provisional race is a sailed race: its results are public, like a
    # published one's, and the race page labels it provisional.
    assert by_id["race-provisional"]["results"] == [
        {"boat_id": "b1", "code": "FINISHED", "position": 1},
        {"boat_id": "b2", "code": "FINISHED", "position": 2},
    ]
    assert by_id["race-provisional"]["entries_count"] == 2
    assert by_id["race-published"]["results"]
    # A race nobody has scored still contributes metadata only.
    assert "results" not in by_id["race-scheduled"]
    assert "entries_count" not in by_id["race-scheduled"]


def test_public_race_page_opens_a_provisional_race(monkeypatch):
    server.db = _sample_db()
    monkeypatch.setattr(server, "get_current_user", _anonymous)
    request = _make_request("/api/races/race-provisional")

    race = asyncio.run(server.get_race("race-provisional", request))

    assert race["status"] == "provisional"
    assert len(race["results"]) == 2


def test_public_race_page_still_hides_an_unscored_race(monkeypatch):
    server.db = _sample_db()
    monkeypatch.setattr(server, "get_current_user", _anonymous)
    request = _make_request("/api/races/race-scheduled")

    with pytest.raises(HTTPException) as raised:
        asyncio.run(server.get_race("race-scheduled", request))

    assert raised.value.status_code == 404
