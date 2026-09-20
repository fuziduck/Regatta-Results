"""Releasing a result from a code back to a normal finish.

An officer has to be able to take a code back — an OCS that was not one, a
protest dismissed, a redress withdrawn. The boat must come out as an ordinary
finishing result: no committee points, no decision record left attached, and
back in the finishing order. One-design places are the officer's order and are
never re-derived from the clock.

The DB layer is stubbed (like test_regattas.py) and the endpoint invoked
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


class _Coll:
    def __init__(self, docs):
        self.docs = list(docs)

    def find(self, q, proj=None):
        return _Cursor([d for d in self.docs if all(d.get(k) == v for k, v in q.items())])

    async def find_one(self, q, proj=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                return d
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)
        return doc

    async def update_one(self, q, update, *a, **k):
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                if "$set" in update:
                    d.update(update["$set"])
                if "$unset" in update:
                    for key in update["$unset"]:
                        d.pop(key, None)
                return types.SimpleNamespace(modified_count=1)
        return types.SimpleNamespace(modified_count=0)

    async def count_documents(self, q):
        return len([d for d in self.docs if all(d.get(k) == v for k, v in q.items())])


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

    def sort(self, *a, **k):
        return self

    async def to_list(self, n):
        return list(self.docs)


def _db(races, series, classes, boats=()):
    return types.SimpleNamespace(
        races=_Coll(races), series=_Coll(series), classes=_Coll(classes),
        boats=_Coll(boats), audit_logs=_Coll([]), season_snapshots=_Coll([]),
        users=_Coll([]))


ADMIN = {"user_id": "u1", "username": "a@b.c", "role": "admin", "club_id": "club-a"}
CLASSES = [{"id": "c1", "name": "Cruisers", "club_id": "club-a"}]
# Start 11:00, so 12:00 / 12:10 / 12:20 elapsed 3600 / 4200 / 4800 seconds.
# Corrected (elapsed x 1000 / PY): 4000 / 4379 / 5117 — the same order.
BOATS = [{"id": "b1", "class_id": "c1", "py": 900},
         {"id": "b2", "class_id": "c1", "py": 959},
         {"id": "b3", "class_id": "c1", "py": 938}]
PY_SERIES = [{"id": "s1", "class_id": "c1", "scoring_mode": "py", "lock_status": "open"}]
ONE_DESIGN_SERIES = [{"id": "s1", "class_id": "c1", "scoring_mode": "one_design", "lock_status": "open"}]


def _result(boat_id, code, position=None, finish_time=None, **extra):
    out = {"boat_id": boat_id, "code": code, "position": position,
           "finish_time": finish_time, "penalty_points": 0}
    out.update(extra)
    return out


def _race(results):
    return {"id": "r1", "class_id": "c1", "series_id": "s1", "date": "2026-05-02",
            "start_time": "11:00", "start_tz_offset_minutes": 0, "status": "setup",
            "version": 1, "results": results}


def _finished_on_time():
    """Three finishers, placed by corrected time."""
    return _race([_result("b1", "FINISHED", 1, "2026-05-02T12:00:00Z"),
                  _result("b2", "FINISHED", 2, "2026-05-02T12:10:00Z"),
                  _result("b3", "FINISHED", 3, "2026-05-02T12:20:00Z")])


def _places(race):
    return {r["boat_id"]: r["position"] for r in race["results"]}


def _apply(race, boat_id, **patch):
    server.db = _db([race], PY_SERIES, CLASSES, BOATS)
    return asyncio.run(server.adjust_result("r1", boat_id, server.ResultAdjustInput(**patch), ADMIN))


class TestRestoringANormalFinish:
    def test_the_boat_returns_to_its_place_by_corrected_time(self):
        race = _finished_on_time()
        _apply(race, "b2", code="OCS")
        assert _places(race) == {"b1": 1, "b2": None, "b3": 2}  # boats behind move up

        _apply(race, "b2", code="FINISHED")
        assert _places(race) == {"b1": 1, "b2": 2, "b3": 3}  # and back down again

    def test_a_restored_finish_keeps_its_time_but_no_penalty_record(self):
        race = _race([_result("b1", "FINISHED", 1, "2026-05-02T12:00:00Z"),
                      _result("b2", "RDG", None, "2026-05-02T12:10:00Z", penalty_points=3,
                              rdg_reason="RRS 62.2 protest upheld", rdg_decision_maker="PC"),
                      _result("b3", "FINISHED", 3, "2026-05-02T12:20:00Z")])

        _apply(race, "b2", code="FINISHED")
        restored = race["results"][1]
        assert restored["code"] == "FINISHED"
        assert restored["penalty_points"] == 0
        assert "rdg_reason" not in restored and "rdg_decision_maker" not in restored
        assert restored["finish_time"] == "2026-05-02T12:10:00Z"
        assert restored["position"] == 2

    def test_one_design_places_are_never_rederived_from_the_clock(self):
        race = _race([_result("b1", "FINISHED", 1),
                      _result("b2", "DNF", None, "2026-05-02T12:10:00Z"),
                      _result("b3", "FINISHED", 2)])
        server.db = _db([race], ONE_DESIGN_SERIES, CLASSES, BOATS)
        asyncio.run(server.adjust_result(
            "r1", "b2", server.ResultAdjustInput(code="FINISHED", position=3), ADMIN))

        # b2 takes the place the officer gave it; the tapped order is untouched.
        assert _places(race) == {"b1": 1, "b2": 3, "b3": 2}
