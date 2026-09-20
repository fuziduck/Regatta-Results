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

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "scoring_test")
os.environ.setdefault("JWT_SECRET", "test")


import server


def _matches(doc, query):
    for key, want in query.items():
        got = doc.get(key)
        if isinstance(want, dict) and "$in" in want:
            if got not in want["$in"]:
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


def _select(race, boat_ids):
    server.db = types.SimpleNamespace(
        races=_Coll([race]), series=_Coll(SERIES), classes=_Coll(CLASSES),
        boats=_Coll(BOATS), audit_logs=_Coll([]), season_snapshots=_Coll([]))
    return asyncio.run(server.select_boats(
        "r1", server.SelectBoatsInput(boat_ids=boat_ids), ADMIN))


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
