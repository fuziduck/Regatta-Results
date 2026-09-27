"""Unit tests for the unified public search (clubs, classes, series, boats).

The endpoint reads only the four collections, so the DB layer is stubbed
(exactly like test_fleet_identity.py) and the endpoint invoked directly.
"""
import asyncio
import re
import types

import pytest

import server


class _Coll:
    """Minimal async collection stub: `await find(...)` returns a cursor that
    supports both `to_list(n)` and `async for` (the endpoint only uses to_list)."""
    def __init__(self, docs):
        self.docs = list(docs)

    def find(self, q, proj=None):
        # Motor's find returns a cursor (not a coroutine); callers use
        # `await coll.find(...).to_list(n)` or `async for` over it.
        return _Cursor([d for d in self.docs if _matches(d, q)])

    async def find_one(self, q, proj=None):
        return next((d for d in self.docs if _matches(d, q)), None)

    async def count_documents(self, q):
        return len([d for d in self.docs if _matches(d, q)])


def _matches(doc, query):
    for key, value in query.items():
        if key in ("$or", "$and"):
            checks = [_matches(doc, clause) for clause in value]
            if (key == "$or" and not any(checks)) or (key == "$and" and not all(checks)):
                return False
        elif isinstance(value, re.Pattern):
            if not value.search(str(doc.get(key, ""))):
                return False
        elif isinstance(value, dict) and "$regex" in value:
            flags = re.IGNORECASE if value.get("$options") == "i" else 0
            if not re.search(value["$regex"], str(doc.get(key, "")), flags):
                return False
        elif isinstance(value, dict) and "$in" in value:
            if doc.get(key) not in value["$in"]:
                return False
        elif isinstance(value, dict) and "$exists" in value:
            if (key in doc) != value["$exists"]:
                return False
        elif doc.get(key) != value:
            return False
    return True


class _Cursor:
    """Async cursor stub: `await coll.find(...)` returns one of these; supports
    `to_list(n)` (awaitable) and `async for`. Re-iterable, since the endpoint
    may pass over the same result set more than once."""
    def __init__(self, docs):
        self.docs = list(docs)
        self.i = 0

    def __aiter__(self):
        self.i = 0
        return self

    async def __anext__(self):
        if self.i >= len(self.docs):
            raise StopAsyncIteration
        doc = self.docs[self.i]
        self.i += 1
        return doc

    async def to_list(self, n):
        return list(self.docs)


def _boat(bid, name, sail_no, class_id, year, fleet_id=None):
    return {"id": bid, "name": name, "sail_no": sail_no, "class_id": class_id,
            "year": year, "fleet_id": fleet_id or bid,
            "fleet_key": server.fleet_key(name, sail_no)}


def _db(**kwargs):
    base = {
        "clubs": _Coll([]), "classes": _Coll([]), "series": _Coll([]), "boats": _Coll([]),
    }
    base.update(kwargs)
    return types.SimpleNamespace(**base)


class TestUnifiedSearch:
    def test_empty_query_returns_empty(self):
        server.db = _db()
        out = asyncio.run(server.unified_search("", request=None))
        assert out == {"clubs": [], "classes": [], "series": [], "boats": []}

    def test_matches_clubs_classes_and_series_by_name(self):
        server.db = _db(
            clubs=_Coll([{"id": "club-a", "name": "Medway Yacht Club", "slug": "medway-yacht-club"}]),
            classes=_Coll([{"id": "c1", "name": "Sonata", "club_id": "club-a"}]),
            series=_Coll([{"id": "s1", "name": "Early Spring", "class_id": "c1", "year": 2026}]),
            boats=_Coll([]))
        out = asyncio.run(server.unified_search("medway", request=None))
        assert [c["slug"] for c in out["clubs"]] == ["medway-yacht-club"]
        out = asyncio.run(server.unified_search("sonata", request=None))
        assert out["classes"][0]["name"] == "Sonata"
        assert out["classes"][0]["club_slug"] == "medway-yacht-club"
        out = asyncio.run(server.unified_search("spring", request=None))
        assert out["series"][0]["name"] == "Early Spring"
        assert out["series"][0]["year"] == 2026
        assert out["series"][0]["class_name"] == "Sonata"
        assert out["series"][0]["club_slug"] == "medway-yacht-club"

    def test_club_result_counts_classes(self):
        server.db = _db(
            clubs=_Coll([{"id": "club-a", "name": "Medway Yacht Club", "slug": "m"}]),
            classes=_Coll([{"id": "c1", "name": "Sonata", "club_id": "club-a"},
                           {"id": "c2", "name": "Wayfarer", "club_id": "club-a"},
                           {"id": "c3", "name": "Dragon", "club_id": "other"}]),
            series=_Coll([]), boats=_Coll([]))
        out = asyncio.run(server.unified_search("medway", request=None))
        assert out["clubs"][0]["classes"] == 2

    def test_boat_results_group_by_identity(self):
        server.db = _db(
            clubs=_Coll([{"id": "club-a", "name": "Medway YC", "slug": "m"}]),
            classes=_Coll([{"id": "c1", "name": "Sonata", "club_id": "club-a"}]),
            series=_Coll([]),
            boats=_Coll([_boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1"),
                         _boat("b2", "Water Song", "8420", "c1", 2027, fleet_id="F1")]))
        out = asyncio.run(server.unified_search("watersong", request=None))
        assert len(out["boats"]) == 1
        assert out["boats"][0]["fleet_id"] == "F1"
        assert out["boats"][0]["records"] == 2

    def test_sail_number_finds_boat(self):
        server.db = _db(
            clubs=_Coll([{"id": "club-a", "name": "Medway YC", "slug": "m"}]),
            classes=_Coll([{"id": "c1", "name": "Sonata", "club_id": "club-a"}]),
            series=_Coll([]),
            boats=_Coll([_boat("b1", "Watersong", "GBR 8420", "c1", 2026)]))
        out = asyncio.run(server.unified_search("8420", request=None))
        assert [b["name"] for b in out["boats"]] == ["Watersong"]

    def test_unapproved_clubs_are_excluded_from_all_search_results(self):
        private = {"id": "private", "name": "Secret Sailing Club", "slug": "secret-club",
                   "approval_status": "pending"}
        server.db = _db(
            clubs=_Coll([private]),
            classes=_Coll([{"id": "private-class", "name": "Secret Fleet", "club_id": "private"}]),
            series=_Coll([{"id": "private-series", "name": "Secret Series", "class_id": "private-class"}]),
            boats=_Coll([_boat("private-boat", "Secret Boat", "999", "private-class", 2026)]))

        assert asyncio.run(server.unified_search("secret", request=None)) == {
            "clubs": [], "classes": [], "series": [], "boats": []}
        assert asyncio.run(server.fleet_search("secret", request=None)) == []
        with pytest.raises(server.HTTPException) as exc:
            asyncio.run(server.fleet_profile("private-boat", request=None))
        assert exc.value.status_code == 404

    def test_limit_applies_per_type(self):
        clubs = _Coll([{"id": f"c{i}", "name": f"Club {i}", "slug": f"club-{i}"} for i in range(5)])
        server.db = _db(clubs=clubs, classes=_Coll([]), series=_Coll([]), boats=_Coll([]))
        out = asyncio.run(server.unified_search("club", limit=2, request=None))
        assert len(out["clubs"]) == 2

    def test_orphaned_series_and_classes_are_excluded(self):
        # A series whose class (or club) no longer exists used to surface with
        # an empty club_slug and link to a dead "/club/" page from the search
        # popup — rows that can't link anywhere must not be offered.
        server.db = _db(
            clubs=_Coll([{"id": "club-a", "name": "Medway YC", "slug": "medway-yacht-club"}]),
            classes=_Coll([{"id": "c1", "name": "Sonata", "club_id": "club-a"},
                           {"id": "c2", "name": "Ghost Class", "club_id": "ghost-club"}]),
            series=_Coll([{"id": "s1", "name": "Summer Series", "class_id": "c1", "year": 2026},
                          {"id": "s2", "name": "Summer Series", "class_id": "gone-class", "year": 2026},
                          {"id": "s3", "name": "Summer Series", "class_id": "c2", "year": 2026}]),
            boats=_Coll([]))
        out = asyncio.run(server.unified_search("summer", request=None))
        assert [s["id"] for s in out["series"]] == ["s1"]
        assert all(s.get("club_slug") for s in out["series"])
        # A class whose club no longer exists is excluded as well.
        out2 = asyncio.run(server.unified_search("ghost", request=None))
        assert out2["classes"] == []
