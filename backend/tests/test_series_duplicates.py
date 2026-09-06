"""Series duplicate detection and merge — contract tests.

Duplicates (same class, name, year in one club) silently split a fleet
across two standings tables, so the API must detect them, refuse to create
them, and merge them without touching result data. The DB layer is stubbed
(like test_regattas.py) and the endpoints invoked directly.
"""
import asyncio
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "scoring_test")
os.environ.setdefault("JWT_SECRET", "test")
os.environ.setdefault("RACE_OFFICER_PIN", "1")
os.environ.setdefault("RACE_ADMIN_PIN", "2")

import server


class _Coll:
    """In-memory Mongo stand-in covering the calls the endpoints make."""

    def __init__(self, docs):
        self.docs = list(docs)

    def find(self, q, proj=None):
        def match(doc, cond):
            for key, value in cond.items():
                if isinstance(value, dict) and "$in" in value:
                    if doc.get(key) not in value["$in"]:
                        return False
                elif doc.get(key) != value:
                    return False
            return True
        return _Cursor([d for d in self.docs if match(d, q)])

    async def find_one(self, q, proj=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                return d
        return None

    async def count_documents(self, q):
        return sum(1 for d in self.docs
                   if all(d.get(k) == v for k, v in q.items()))

    async def update_many(self, q, update):
        n = 0
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                d.update(update["$set"])
                n += 1
        return n

    async def delete_one(self, q):
        for i, d in enumerate(self.docs):
            if all(d.get(k) == v for k, v in q.items()):
                del self.docs[i]
                return types.SimpleNamespace(deleted_count=1)
        return types.SimpleNamespace(deleted_count=0)

    async def update_one(self, q, update):
        n = 0
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                d.update(update["$set"])
                n += 1
                break
        return types.SimpleNamespace(modified_count=n)

    async def insert_one(self, doc):
        self.docs.append(doc)
        return doc


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, *a, **k):
        return self

    async def to_list(self, n=None):
        return list(self.docs)


class _QP(dict):
    """Starlette's QueryParams exposes .get(); a plain dict covers it."""
    pass


class _Req:
    """Minimal Request stand-in (cookies/headers unused by these endpoints)."""

    def __init__(self, params=None):
        self.cookies = {}
        self.method = "POST"
        self.headers = {}
        self.query_params = _QP(params or {})
        self.client = types.SimpleNamespace(host="127.0.0.1")

    async def json(self):
        return {}


def _db(series=None, classes=None, races=None, snapshots=None):
    return types.SimpleNamespace(
        series=_Coll(series or []),
        classes=_Coll(classes or []),
        races=_Coll(races or []),
        season_snapshots=_Coll(snapshots or []),
        audit_logs=_Coll([]),
        users=_Coll([]),
    )


ADMIN = {"user_id": "u1", "username": "a@b.c", "role": "admin", "club_id": "club-a"}
CLASSES = [{"id": "c1", "name": "Sonata", "club_id": "club-a"},
           {"id": "c2", "name": "Dragon", "club_id": "club-a"}]


def _series(sid, name="Early Autumn", cls="c1", year=2026, **extra):
    doc = {"id": sid, "name": name, "class_id": cls, "year": year,
           "version": 3, "member_boat_ids": []}
    doc.update(extra)
    return doc


def _merge_input(**kw):
    defaults = {"confirm": True, "reason": "dedupe", "expected_version": None}
    return types.SimpleNamespace(**{**defaults, **kw})


class TestDuplicateDetection:
    def test_same_class_name_year_grouped(self):
        server.db = _db(
            series=[_series("s1"), _series("s2")],
            classes=CLASSES)
        out = asyncio.run(server.get_series_duplicates(_Req({"club_id": "club-a"})))
        assert len(out) == 1
        assert out[0]["name"] == "Early Autumn"
        assert sorted(m["id"] for m in out[0]["members"]) == ["s1", "s2"]
        assert out[0]["race_number_overlap"] is False

    def test_different_year_is_not_a_duplicate(self):
        server.db = _db(
            series=[_series("s1", year=2025), _series("s2", year=2026)],
            classes=CLASSES)
        assert asyncio.run(server.get_series_duplicates(_Req({"club_id": "club-a"}))) == []

    def test_other_clubs_never_leak_into_the_scan(self):
        server.db = _db(
            series=[_series("s1"), _series("s2", cls="c9")],
            classes=CLASSES)
        assert asyncio.run(server.get_series_duplicates(_Req({"club_id": "club-a"}))) == []

    def test_race_and_snapshot_counts_enriched(self):
        server.db = _db(
            series=[_series("s1", lock_status="locked"),
                    _series("s2", member_boat_ids=["b1", "b2"])],
            classes=CLASSES,
            races=[{"id": "r1", "series_id": "s1", "status": "published", "race_number": 1},
                   {"id": "r2", "series_id": "s1", "status": "draft", "race_number": 2}],
            snapshots=[{"id": "k1", "series_id": "s1", "version": 1}])
        out = asyncio.run(server.get_series_duplicates(_Req({"club_id": "club-a"})))
        members = {m["id"]: m for m in out[0]["members"]}
        assert members["s1"]["published"] == 1
        assert members["s1"]["race_count"] == 2
        assert members["s1"]["snapshot_count"] == 1
        assert members["s1"]["lock_status"] == "locked"
        assert members["s2"]["members"] == 2

    def test_missing_club_scope_rejected(self):
        server.db = _db(series=[], classes=CLASSES)
        try:
            asyncio.run(server.get_series_duplicates(_Req()))
            assert False, "expected HTTPException"
        except server.HTTPException as exc:
            assert exc.status_code == 400


class TestMergeGuards:
    def test_merge_moves_races_snapshots_and_membership(self):
        source = _series("s1", member_boat_ids=["b2", "b1"])
        target = _series("s2", member_boat_ids=["b3"])
        server.db = _db(
            series=[source, target],
            classes=CLASSES,
            races=[{"id": "r1", "series_id": "s1", "race_number": 7}],
            snapshots=[{"id": "k1", "series_id": "s1"}])
        out = asyncio.run(server.merge_series("s1", "s2", _merge_input(), _Req(), ADMIN))
        assert out["id"] == "s2"
        assert server.db.races.docs[0]["series_id"] == "s2"
        assert server.db.season_snapshots.docs[0]["series_id"] == "s2"
        assert target["member_boat_ids"] == ["b3", "b1", "b2"]
        assert server.db.series.docs == [target]  # source removed, target intact

    def test_identity_mismatch_rejected(self):
        server.db = _db(
            series=[_series("s1"), _series("s2", name="Late Autumn")],
            classes=CLASSES)
        try:
            asyncio.run(server.merge_series("s1", "s2", _merge_input(), _Req(), ADMIN))
            assert False, "expected HTTPException"
        except server.HTTPException as exc:
            assert exc.status_code == 400

    def test_locked_series_cannot_merge(self):
        server.db = _db(
            series=[_series("s1"), _series("s2", lock_status="locked")],
            classes=CLASSES)
        try:
            asyncio.run(server.merge_series("s1", "s2", _merge_input(), _Req(), ADMIN))
            assert False, "expected HTTPException"
        except server.HTTPException as exc:
            assert exc.status_code == 409

    def test_overlapping_race_numbers_refused(self):
        server.db = _db(
            series=[_series("s1"), _series("s2")],
            classes=CLASSES,
            races=[{"id": "r1", "series_id": "s1", "race_number": 2},
                   {"id": "r2", "series_id": "s2", "race_number": 2}])
        try:
            asyncio.run(server.merge_series("s1", "s2", _merge_input(), _Req(), ADMIN))
            assert False, "expected HTTPException"
        except server.HTTPException as exc:
            assert exc.status_code == 400
        # Nothing moved.
        assert server.db.races.docs[0]["series_id"] == "s1"

    def test_confirm_and_reason_required(self):
        server.db = _db(series=[_series("s1"), _series("s2")], classes=CLASSES)
        for bad in (_merge_input(confirm=False),
                    types.SimpleNamespace(confirm=True, reason="", expected_version=None)):
            try:
                asyncio.run(server.merge_series("s1", "s2", bad, _Req(), ADMIN))
                assert False, "expected HTTPException"
            except server.HTTPException as exc:
                assert exc.status_code == 400
        assert len(server.db.series.docs) == 2  # nothing merged
