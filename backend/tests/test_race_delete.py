"""Deleting a race.

The officer deletes a race (and with it the fleet signed on for it). A plain
race is simply removed. A mini-series sub-race is subtler: every sub-race of a
group shares the group's one race number (R3A, R3B, … all carry number 3), so
removing the group's number while sibling sub-races remain would orphan those
races — and the fleet signed on in them — with nothing referencing them.

The DB layer is stubbed (like test_race_sign_on.py) and the endpoint invoked
directly.
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
        if isinstance(want, dict):
            if "$in" in want and got not in want["$in"]:
                return False
            if "$exists" in want and (key in doc) != want["$exists"]:
                return False
        elif got != want:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

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


class _Coll:
    def __init__(self, docs):
        self.docs = list(docs)

    def find(self, q=None, proj=None):
        return _Cursor([d for d in self.docs if _matches(d, q or {})])

    async def find_one(self, q, proj=None):
        for d in self.docs:
            if _matches(d, q):
                return d
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)
        return doc

    async def delete_one(self, q):
        for i, d in enumerate(self.docs):
            if _matches(d, q):
                self.docs.pop(i)
                return types.SimpleNamespace(deleted_count=1)
        return types.SimpleNamespace(deleted_count=0)

    async def update_one(self, q, update, *a, **k):
        for d in self.docs:
            if _matches(d, q):
                if "$set" in update:
                    d.update(update["$set"])
                if "$unset" in update:
                    for key in update["$unset"]:
                        d.pop(key, None)
                return types.SimpleNamespace(modified_count=1)
        return types.SimpleNamespace(modified_count=0)

    async def count_documents(self, q):
        return len([d for d in self.docs if _matches(d, q)])


CLUBS = [{"id": "club-a", "name": "Club A", "approval_status": "approved"}]
CLASSES = [{"id": "c1", "name": "Cruisers", "club_id": "club-a"}]
OFFICER = {"user_id": "u1", "username": "o@b.c", "role": "officer", "club_id": "club-a"}


def _sub_race(rid, label, group_index, race_number=3, signed_on=("b1", "b2")):
    """A mini-series sub-race with its fleet signed on (results lines)."""
    return {"id": rid, "class_id": "c1", "series_id": "s1", "date": "2026-05-02",
            "race_number": race_number, "status": "setup", "version": 1,
            "mini_group_id": group_index, "mini_group_label": label,
            "results": [{"boat_id": b, "code": "DNS", "finish_time": None,
                         "position": None, "penalty_points": 0} for b in signed_on]}


def _series(groups):
    return {"id": "s1", "class_id": "c1", "name": "S", "year": 2026,
            "lock_status": "open", "mini_series": True, "version": 5,
            "mini_series_groups": groups}


def _delete(races, series, race_id="r2"):
    server.db = types.SimpleNamespace(
        races=_Coll(races), series=_Coll([series]), classes=_Coll(CLASSES),
        clubs=_Coll(CLUBS), boats=_Coll([]), audit_logs=_Coll([]),
        season_snapshots=_Coll([]))
    return asyncio.run(server.delete_race(race_id, _NoQuery(), OFFICER))


class _NoQuery:
    """A request whose query string carries no expected_version."""
    query_params = {}

    def __bool__(self):
        return False


def _race_ids(races):
    return {r["id"] for r in races}


class TestDeleteRace:
    def test_a_plain_race_is_removed(self):
        race = {"id": "r1", "class_id": "c1", "series_id": "s1", "date": "2026-05-02",
                "race_number": 1, "status": "setup", "version": 1,
                "results": [{"boat_id": "b1", "code": "DNS"}]}
        series = _series([])
        _delete([race], series, race_id="r1")
        assert server.db.races.docs == []

    def test_deleting_a_sub_race_keeps_the_group_and_its_siblings(self):
        """The sibling sub-race (with its fleet signed on) must survive, and
        the group must still reference the shared race number — otherwise the
        remaining race is orphaned with nothing pointing at it."""
        r1 = _sub_race("r1", "R3A", 0)
        r2 = _sub_race("r2", "R3B", 0)
        series = _series([{"name": "Morning", "race_numbers": [3], "discards": 0,
                           "scoring": "combined"}])
        _delete([r1, r2], series)

        assert _race_ids(server.db.races.docs) == {"r1"}
        # The sibling R3A is still signed on / scoreable.
        assert server.db.races.docs[0]["results"][0]["code"] == "DNS"
        assert series["mini_series_groups"][0]["race_numbers"] == [3]

    def test_deleting_the_last_sub_race_drops_the_number_and_group(self):
        r1 = _sub_race("r1", "R3A", 0)
        series = _series([{"name": "Morning", "race_numbers": [3], "discards": 0,
                           "scoring": "combined"}])
        # Delete the only sub-race (use r1's id).
        server.db = types.SimpleNamespace(
            races=_Coll([r1]), series=_Coll([series]), classes=_Coll(CLASSES),
            clubs=_Coll(CLUBS), boats=_Coll([]), audit_logs=_Coll([]),
            season_snapshots=_Coll([]))
        asyncio.run(server.delete_race("r1", _NoQuery(), OFFICER))

        assert server.db.races.docs == []
        assert series["mini_series_groups"] == []
        assert series["mini_series"] is False
