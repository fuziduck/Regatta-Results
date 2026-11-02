"""Signing boats on for a race.

`select-boats` is the officer's sign-on: the ids it is given are the boats
racing, and every one of them must end up with a line in the race. A race is
created with the class's fleet at the time, so a boat the class gained later
(or a mini-series sub-race seeded from an older fleet) has no line yet — the
selection must still take effect instead of being silently dropped.

The DB layer is stubbed (like test_result_code_clearing.py) and the endpoint
invoked directly.
"""
import asyncio
import os
import sys
import types

import pytest
from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "scoring_test")
os.environ.setdefault("JWT_SECRET", "test")


import server


def _matches(doc, query):
    for key, want in query.items():
        got = doc.get(key)
        if isinstance(want, dict):
            if "$in" in want and got not in want["$in"]:
                return False
            if "$exists" in want and (key in doc) != want["$exists"]:
                return False
            if "$ne" in want and got == want["$ne"]:
                return False
        elif got != want:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)
        self.i = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.i >= len(self.docs):
            raise StopAsyncIteration
        doc = self.docs[self.i]
        self.i += 1
        return doc

    async def to_list(self, n):
        return list(self.docs)


class _Coll:
    def __init__(self, docs):
        self.docs = list(docs)

    def find(self, q, proj=None):
        return _Cursor([d for d in self.docs if _matches(d, q)])

    async def find_one(self, q, proj=None):
        for d in self.docs:
            if _matches(d, q):
                return d
        return None

    async def update_one(self, q, update, *a, **k):
        for d in self.docs:
            if _matches(d, q):
                if "$set" in update:
                    d.update(update["$set"])
                for key, amount in update.get("$inc", {}).items():
                    d[key] = d.get(key, 0) + amount
                for key, op in update.get("$addToSet", {}).items():
                    items = d.setdefault(key, [])
                    for value in op["$each"]:
                        if value not in items:
                            items.append(value)
                return types.SimpleNamespace(modified_count=1)
        return types.SimpleNamespace(modified_count=0)


ADMIN = {"user_id": "u1", "username": "a@b.c", "role": "admin", "club_id": "club-a"}
CLASSES = [{"id": "c1", "name": "Cruisers", "club_id": "club-a"}]
SERIES = [{"id": "s1", "class_id": "c1", "lock_status": "open"}]
# b3 joined the class after the race was created, so the race has lines for b1
# and b2 only. b4 belongs to another class.
BOATS = [{"id": "b1", "class_id": "c1"}, {"id": "b2", "class_id": "c1"},
         {"id": "b3", "class_id": "c1"}, {"id": "b4", "class_id": "c9"}]


def _race(results):
    return {"id": "r1", "class_id": "c1", "series_id": "s1", "date": "2026-05-02",
            "status": "setup", "version": 1, "results": results}


def _line(boat_id, code):
    return {"boat_id": boat_id, "code": code, "finish_time": None,
            "position": None, "penalty_points": 0}


def _select(race, boat_ids, series=None, boats=None, user=ADMIN):
    server.db = types.SimpleNamespace(
        races=_Coll([race]), series=_Coll([series] if series is not None else SERIES), classes=_Coll(CLASSES),
        boats=_Coll(boats if boats is not None else BOATS), audit_logs=_Coll([]), season_snapshots=_Coll([]),
        # The race guard resolves the owning club's visibility.
        clubs=_Coll([{"id": "club-a", "name": "Club A", "approval_status": "approved"}]))
    return asyncio.run(server.select_boats(
        "r1", server.SelectBoatsInput(boat_ids=boat_ids), user))


def _codes(race):
    return {r["boat_id"]: r["code"] for r in race["results"]}


class TestSigningOn:
    def test_a_boat_with_no_line_yet_is_added_as_racing(self):
        race = _race([_line("b1", "DNC"), _line("b2", "DNC")])

        _select(race, ["b1", "b3"])

        assert _codes(race) == {"b1": "DNS", "b2": "DNC", "b3": "DNS"}

    def test_a_boat_of_another_class_is_never_added(self):
        race = _race([_line("b1", "DNC")])

        _select(race, ["b1", "b4"])

        assert _codes(race) == {"b1": "DNS"}

    def test_deselecting_clears_the_line_back_to_dnc(self):
        race = _race([_line("b1", "FINISHED"), _line("b2", "DNS")])

        _select(race, ["b2"])

        assert _codes(race) == {"b1": "DNC", "b2": "DNS"}
        assert race["results"][0]["finish_time"] is None

    def test_new_entrant_joins_explicit_series_fleet_without_losing_members(self):
        race = _race([_line("b1", "FINISHED"), _line("b2", "DNC")])
        race["year"] = 2026
        series = {**SERIES[0], "year": 2026, "version": 2, "member_boat_ids": ["b1", "b2"]}
        boats = [{**b, "year": 2026} for b in BOATS]
        _select(race, ["b1", "b3"], series, boats, {**ADMIN, "role": "officer"})
        assert _codes(race) == {"b1": "FINISHED", "b2": "DNC", "b3": "DNS"}
        assert series["member_boat_ids"] == ["b1", "b2", "b3"]
        assert series["version"] == 3

    def test_auto_fleet_stays_automatic_and_other_seasons_are_rejected(self):
        race = _race([_line("b1", "DNS")])
        race["year"] = 2026
        series = {**SERIES[0], "year": 2026, "member_boat_ids": []}
        boats = [{**BOATS[0], "year": 2026}, {**BOATS[2], "year": 2025}]
        _select(race, ["b1", "b3"], series, boats)
        assert _codes(race) == {"b1": "DNS"}
        assert series["member_boat_ids"] == []

    def test_officer_registration_is_scoped_and_locked_series_are_rejected(self, monkeypatch):
        async def series_of_club(series_id, user):
            assert user["role"] == "officer"
            return {"id": series_id, "class_id": "c1", "year": 2026}

        async def unlocked(series_id):
            return None

        async def create(data, user):
            return {"id": "new", **data.model_dump()}

        monkeypatch.setattr(server, "_series_of_club", series_of_club)
        monkeypatch.setattr(server, "_ensure_series_not_locked", unlocked)
        monkeypatch.setattr(server, "create_boat", create)
        officer = {**ADMIN, "role": "officer"}
        data = server.BoatInput(name="New", sail_no="10", helm="Helm", class_id="c1", year=2026)
        assert asyncio.run(server.create_series_boat("s1", data, officer))["id"] == "new"
        with pytest.raises(HTTPException) as wrong_class:
            asyncio.run(server.create_series_boat("s1", data.model_copy(update={"class_id": "c9"}), officer))
        assert wrong_class.value.status_code == 400
        with pytest.raises(HTTPException) as wrong_year:
            asyncio.run(server.create_series_boat("s1", data.model_copy(update={"year": 2025}), officer))
        assert wrong_year.value.status_code == 400

        async def locked(series_id):
            raise HTTPException(status_code=403, detail="Locked")
        monkeypatch.setattr(server, "_ensure_series_not_locked", locked)
        with pytest.raises(HTTPException):
            asyncio.run(server.create_series_boat("s1", data, officer))

    def test_registration_requires_officer_and_checks_club(self, monkeypatch):
        server.db = types.SimpleNamespace(
            series=_Coll([{**SERIES[0], "year": 2026}]), classes=_Coll(CLASSES),
            clubs=_Coll([{"id": "club-a", "approval_status": "approved"}]))
        user = {**ADMIN, "role": "officer"}

        async def current_user(request):
            return user

        async def create(data, actor):
            return {"id": "new", **data.model_dump()}

        monkeypatch.setattr(server, "get_current_user", current_user)
        monkeypatch.setattr(server, "create_boat", create)
        request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
        body = server.BoatInput(name="Visitor", sail_no="3", helm="Alex", class_id="c1", year=2026)
        assert asyncio.run(server.require_officer(request)) == user
        assert asyncio.run(server.create_series_boat("s1", body, user))["id"] == "new"
        user["club_id"] = "club-b"
        with pytest.raises(HTTPException) as denied:
            asyncio.run(server.create_series_boat("s1", body, user))
        assert denied.value.status_code == 403
        user["role"] = "viewer"
        with pytest.raises(HTTPException) as denied:
            asyncio.run(server.require_officer(request))
        assert denied.value.status_code == 403
