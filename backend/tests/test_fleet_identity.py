"""Unit tests for the shared boat registry (fleet identity).

The same physical boat can race at several clubs or in several classes. Each
club/class keeps its own boat record and all records for one boat share a
`fleet_id`, derived by default from the normalized sail number + name — but a
record can be kept separate when two genuinely different boats share the same
details. These tests exercise the identity logic and the career-profile
aggregation with a filter-aware in-memory DB (no network).
"""
import asyncio
import os
import re as _re
import sys
import types
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "scoring_test")
os.environ.setdefault("JWT_SECRET", "test")
os.environ.setdefault("RACE_OFFICER_PIN", "1")
os.environ.setdefault("RACE_ADMIN_PIN", "2")

import server  # noqa: E402


# ---------------------------------------------------------------------------
# Tiny filter-aware in-memory DB (supports the query shapes the fleet code
# uses: exact equality, $in, $ne, $regex, dotted array fields, $or).
# ---------------------------------------------------------------------------
def _scalar_match(v, val):
    if isinstance(val, dict):
        # $options rides along with $regex; strip it before iterating ops.
        options = val.get("$options")
        for op, arg in val.items():
            if op == "$options":
                continue
            if op == "$in":
                if isinstance(v, list):
                    if not any(x in arg for x in v):
                        return False
                elif v not in arg:
                    return False
            elif op == "$ne":
                if v == arg:
                    return False
            elif op == "$nin":
                if v in arg:
                    return False
            elif op == "$regex":
                flags = _re.IGNORECASE if options == "i" else 0
                if not _re.search(arg, str(v or ""), flags):
                    return False
            else:
                raise NotImplementedError(op)
        return True
    return v == val


def _fmatches(doc, filt):
    if not filt:
        return True
    for key, val in filt.items():
        if key == "$or":
            if not any(_fmatches(doc, sub) for sub in val):
                return False
            continue
        if "." in key:
            base, sub = key.split(".", 1)
            arr = doc.get(base)
            if not (isinstance(arr, list) and any(
                    isinstance(x, dict) and _scalar_match(x.get(sub), val) for x in arr)):
                return False
            continue
        if not _scalar_match(doc.get(key), val):
            return False
    return True


class _Cur:
    def __init__(self, items):
        self.items = list(items)

    def sort(self, key, direction=-1):
        self.items.sort(key=lambda d: d.get(key), reverse=(direction == -1))
        return self

    async def to_list(self, n):
        return self.items[:n]


class _Res:
    def __init__(self, n):
        self.modified_count = n
        self.deleted_count = n


class _Coll:
    def __init__(self, items):
        self.items = list(items)

    def find(self, filt=None, projection=None):
        return _Cur([d for d in self.items if _fmatches(d, filt)])

    async def find_one(self, filt=None, projection=None):
        for d in self.items:
            if _fmatches(d, filt):
                out = dict(d)
                out.pop("_id", None)
                return out
        return None

    async def update_one(self, filt, update):
        for d in self.items:
            if _fmatches(d, filt):
                for k, v in update.get("$set", {}).items():
                    d[k] = v
                for k, v in update.get("$inc", {}).items():
                    d[k] = d.get(k, 0) + v
                return _Res(1)
        return _Res(0)

    async def insert_one(self, doc):
        self.items.append(doc)
        return _Res(1)


def _boat(id_, name, sail_no, class_id, year, fleet_id=None, fleet_key=None, **extra):
    b = {"id": id_, "name": name, "sail_no": sail_no, "helm": "H",
         "class_id": class_id, "year": year, "active": True,
         "fleet_id": fleet_id or id_, "fleet_key": fleet_key or server.fleet_key(name, sail_no),
         "created_at": "2026-01-01T00:00:00+00:00"}
    b.update(extra)
    return b


def _inp(name, sail_no, class_id="c2", year=2027, fleet_id=None, separate=False):
    return server.BoatInput(name=name, sail_no=sail_no, class_id=class_id, year=year,
                            helm="H", fleet_id=fleet_id, separate_fleet=separate)


class TestFleetKey:
    def test_normalises_sail_number_and_name(self):
        assert server.fleet_key("Watersong", "GBR 4502") == "gbr4502|watersong"
        assert server.fleet_key("water-song", "gbr-4502") == "gbr4502|watersong"
        assert server.fleet_key("Water Song", "GBR4502") == "gbr4502|watersong"
        assert server.fleet_key("8420", " 8 420 ") == "8420|8420"

    def test_empty_parts(self):
        assert server.fleet_key("", "") == "|"


class TestResolveFleetIdentity:
    def test_create_with_no_match_gets_new_identity(self):
        server.db = types.SimpleNamespace(boats=_Coll([]))
        fid, key, amb = asyncio.run(server._resolve_fleet_identity(_inp("Fresh", "123")))
        assert amb is None
        assert uuid.UUID(fid)  # a new identity
        assert key == "123|fresh"

    def test_create_auto_links_across_clubs(self):
        b1 = _boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1")
        server.db = types.SimpleNamespace(boats=_Coll([b1]))
        # Same sail+name but a different class/year (the shared-registry case).
        fid, key, amb = asyncio.run(server._resolve_fleet_identity(_inp("Water Song", "8420")))
        assert amb is None
        assert fid == "F1"

    def test_create_same_class_and_year_is_ambiguous(self):
        b1 = _boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1")
        server.db = types.SimpleNamespace(boats=_Coll([b1]))
        # A boat with the same details in the SAME class+year is never merged
        # silently — the caller gets the candidates to ask the admin.
        fid, key, amb = asyncio.run(server._resolve_fleet_identity(
            _inp("Watersong", "8420", class_id="c1", year=2026)))
        assert fid is None
        assert amb and amb[0]["id"] == "b1"

    def test_separate_fleet_forces_new_identity(self):
        b1 = _boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1")
        server.db = types.SimpleNamespace(boats=_Coll([b1]))
        fid, key, amb = asyncio.run(server._resolve_fleet_identity(
            _inp("Watersong", "8420", class_id="c1", year=2026, separate=True)))
        assert amb is None
        assert fid != "F1"

    def test_explicit_fleet_id_wins(self):
        b1 = _boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1")
        server.db = types.SimpleNamespace(boats=_Coll([b1]))
        fid, key, amb = asyncio.run(server._resolve_fleet_identity(
            _inp("Different Name", "999", fleet_id="b1")))
        assert fid == "F1"  # resolves through the target's own fleet_id

    def test_explicit_fleet_id_missing_raises(self):
        server.db = types.SimpleNamespace(boats=_Coll([]))
        try:
            asyncio.run(server._resolve_fleet_identity(_inp("X", "1", fleet_id="nope")))
            assert False, "expected HTTPException"
        except server.HTTPException as exc:
            assert exc.status_code == 400

    def test_update_keeps_identity_when_details_unchanged(self):
        b2 = _boat("b2", "Watersong", "8420", "c2", 2027, fleet_id="F1")
        server.db = types.SimpleNamespace(boats=_Coll([b2]))
        fid, key, amb = asyncio.run(server._resolve_fleet_identity(
            _inp("Watersong", "8420", class_id="c2", year=2027), editing=b2))
        assert amb is None
        assert fid == "F1"

    def test_update_rename_auto_relinks_to_other_club_match(self):
        b2 = _boat("b2", "Old Name", "111", "c2", 2027, fleet_id="F2")
        b1 = _boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1")
        server.db = types.SimpleNamespace(boats=_Coll([b2, b1]))
        # Renaming b2 to match b1 (a different class) links them.
        fid, key, amb = asyncio.run(server._resolve_fleet_identity(
            _inp("Watersong", "8420", class_id="c2", year=2027), editing=b2))
        assert amb is None
        assert fid == "F1"

    def test_update_rename_colliding_same_class_is_ambiguous(self):
        b2 = _boat("b2", "Old Name", "111", "c1", 2026, fleet_id="F2")
        b1 = _boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1")
        server.db = types.SimpleNamespace(boats=_Coll([b2, b1]))
        fid, key, amb = asyncio.run(server._resolve_fleet_identity(
            _inp("Watersong", "8420", class_id="c1", year=2026), editing=b2))
        assert fid is None
        assert [c["id"] for c in amb] == ["b1"]


class TestFleetProfile:
    def _db(self, snapshots=None):
        clubs = [{"id": "club-a", "name": "Medway YC", "slug": "medway"},
                 {"id": "club-b", "name": "Other SC", "slug": "other"}]
        classes = [{"id": "c1", "name": "Sonata", "club_id": "club-a"},
                   {"id": "c2", "name": "Wayfarer", "club_id": "club-b"}]
        b1 = _boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1")
        b2 = _boat("b2", "Water Song", "8420", "c2", 2027, fleet_id="F1")
        s1 = {"id": "s1", "name": "Late Spring", "class_id": "c1", "year": 2026,
              "scoring_mode": "one_design", "discards": 0, "included_in_overall": True,
              "order": 0, "lock_status": None}
        s2 = {"id": "s2", "name": "Spring Series", "class_id": "c2", "year": 2027,
              "scoring_mode": "one_design", "discards": 0, "included_in_overall": True,
              "order": 0, "lock_status": None}
        r1 = {"id": "r1", "series_id": "s1", "class_id": "c1", "year": 2026,
              "race_number": 1, "date": "2026-06-13", "status": "published",
              "results": [{"boat_id": "b1", "code": "FINISHED", "position": 1,
                           "finish_time": "2026-06-13T10:00:00Z", "penalty_points": 0}]}
        r2 = {"id": "r2", "series_id": "s2", "class_id": "c2", "year": 2027,
              "race_number": 1, "date": "2027-04-10", "status": "published",
              "results": [{"boat_id": "b2", "code": "FINISHED", "position": 1,
                           "finish_time": "2027-04-10T10:00:00Z", "penalty_points": 0}]}
        return types.SimpleNamespace(
            boats=_Coll([b1, b2]), races=_Coll([r1, r2]), series=_Coll([s1, s2]),
            classes=_Coll(classes), clubs=_Coll(clubs),
            season_snapshots=_Coll(snapshots or []))

    def test_career_across_two_clubs(self):
        server.db = self._db()
        prof = asyncio.run(server.fleet_profile("F1"))
        assert prof["name"] == "Watersong"
        assert prof["sail_no"] == "8420"
        assert len(prof["records"]) == 2
        # newest series first
        assert [s["series_name"] for s in prof["series"]] == ["Spring Series", "Late Spring"]
        assert all(s["rank"] == 1 and s["net"] == 1 for s in prof["series"])
        assert prof["series"][0]["club_name"] == "Other SC"
        assert prof["series"][1]["club_name"] == "Medway YC"
        # overall championship position in each class+year
        assert len(prof["overall"]) == 2
        assert all(o["rank"] == 1 for o in prof["overall"])

    def test_locked_season_served_from_snapshot(self):
        snapshot = {"id": "snap1", "series_id": "s1", "status": server.LOCK_LOCKED,
                    "version": 1, "locked_at": "2026-09-01T00:00:00+00:00",
                    "engine_version": "2.2.0",
                    "payload": {"standings": [
                        {"boat_id": "b1", "boat_name": "Watersong", "sail_no": "8420",
                         "net": 4.0, "total": 4.0, "rank": 3}],
                        "race_count": 1, "discards": 0}}
        server.db = self._db(snapshots=[snapshot])
        # Mark s1 locked so _standings_for_series uses the frozen snapshot.
        for d in server.db.series.items:
            if d["id"] == "s1":
                d["lock_status"] = server.LOCK_LOCKED
        prof = asyncio.run(server.fleet_profile("F1"))
        late = next(s for s in prof["series"] if s["series_name"] == "Late Spring")
        assert late["rank"] == 3
        assert late["locked"] is True
        # the live 2027 series is still computed normally
        spring = next(s for s in prof["series"] if s["series_name"] == "Spring Series")
        assert spring["rank"] == 1
        assert spring["locked"] is False

    def test_profile_groups_records_sharing_name_and_sail(self):
        """Two clubs record the same boat under DIFFERENT fleet_ids (never
        explicitly linked). The career profile must still group them, because
        the boat name and sail number match."""
        b1 = _boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1")
        b2 = _boat("b2", "Water Song", "8420", "c2", 2027, fleet_id="F2")  # same key, other fleet
        s1 = {"id": "s1", "name": "Late Spring", "class_id": "c1", "year": 2026,
              "scoring_mode": "one_design", "discards": 0, "included_in_overall": True,
              "order": 0, "lock_status": None}
        s2 = {"id": "s2", "name": "Spring Series", "class_id": "c2", "year": 2027,
              "scoring_mode": "one_design", "discards": 0, "included_in_overall": True,
              "order": 0, "lock_status": None}
        r1 = {"id": "r1", "series_id": "s1", "class_id": "c1", "year": 2026,
              "race_number": 1, "date": "2026-06-13", "status": "published",
              "results": [{"boat_id": "b1", "code": "FINISHED", "position": 1,
                           "finish_time": "2026-06-13T10:00:00Z", "penalty_points": 0}]}
        r2 = {"id": "r2", "series_id": "s2", "class_id": "c2", "year": 2027,
              "race_number": 1, "date": "2027-04-10", "status": "published",
              "results": [{"boat_id": "b2", "code": "FINISHED", "position": 1,
                           "finish_time": "2027-04-10T10:00:00Z", "penalty_points": 0}]}
        server.db = types.SimpleNamespace(
            boats=_Coll([b1, b2]), races=_Coll([r1, r2]), series=_Coll([s1, s2]),
            classes=_Coll([{"id": "c1", "name": "Sonata", "club_id": "club-a"},
                           {"id": "c2", "name": "Wayfarer", "club_id": "club-b"}]),
            clubs=_Coll([{"id": "club-a", "name": "Medway YC", "slug": "m"},
                         {"id": "club-b", "name": "Other SC", "slug": "o"}]),
            season_snapshots=_Coll([]))
        prof = asyncio.run(server.fleet_profile("F1"))
        assert len(prof["records"]) == 2
        assert [s["series_name"] for s in prof["series"]] == ["Spring Series", "Late Spring"]

    def test_unknown_fleet_404(self):
        server.db = self._db()
        try:
            asyncio.run(server.fleet_profile("missing"))
            assert False, "expected HTTPException"
        except server.HTTPException as exc:
            assert exc.status_code == 404


class TestFleetSearch:
    def test_search_matches_name_and_groups_by_identity(self):
        b1 = _boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1")
        b2 = _boat("b2", "Water Song", "8420", "c2", 2027, fleet_id="F1")
        b3 = _boat("b3", "Screwloose", "8410", "c1", 2026, fleet_id="F3")
        server.db = types.SimpleNamespace(
            boats=_Coll([b1, b2, b3]),
            classes=_Coll([{"id": "c1", "name": "Sonata", "club_id": "club-a"},
                           {"id": "c2", "name": "Wayfarer", "club_id": "club-b"}]),
            clubs=_Coll([{"id": "club-a", "name": "Medway YC", "slug": "m"},
                         {"id": "club-b", "name": "Other SC", "slug": "o"}]))
        out = asyncio.run(server.fleet_search("watersong"))
        assert len(out) == 1
        assert out[0]["fleet_id"] == "F1"
        assert set(out[0]["clubs"]) == {"Medway YC", "Other SC"}
        assert set(out[0]["classes"]) == {"Sonata", "Wayfarer"}
        assert out[0]["records"] == 2

    def test_search_groups_same_name_sail_even_when_fleet_ids_differ(self):
        """The same boat recorded at two clubs under different fleet_ids (never
        linked) appears ONCE because the name and sail number match."""
        b1 = _boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1")
        b2 = _boat("b2", "Water Song", "8420", "c2", 2027, fleet_id="F2")
        server.db = types.SimpleNamespace(
            boats=_Coll([b1, b2]),
            classes=_Coll([{"id": "c1", "name": "Sonata", "club_id": "club-a"},
                           {"id": "c2", "name": "Wayfarer", "club_id": "club-b"}]),
            clubs=_Coll([{"id": "club-a", "name": "Medway YC", "slug": "m"},
                         {"id": "club-b", "name": "Other SC", "slug": "o"}]))
        out = asyncio.run(server.fleet_search("watersong"))
        assert len(out) == 1
        assert set(out[0]["clubs"]) == {"Medway YC", "Other SC"}
        assert out[0]["records"] == 2

    def test_search_by_sail_number_token(self):
        server.db = types.SimpleNamespace(
            boats=_Coll([_boat("b1", "Watersong", "8420", "c1", 2026, fleet_id="F1")]),
            classes=_Coll([{"id": "c1", "name": "Sonata", "club_id": "club-a"}]),
            clubs=_Coll([{"id": "club-a", "name": "Medway YC", "slug": "m"}]))
        out = asyncio.run(server.fleet_search("8420"))
        assert len(out) == 1 and out[0]["name"] == "Watersong"

    def test_short_query_returns_empty(self):
        server.db = types.SimpleNamespace(boats=_Coll([]), classes=_Coll([]), clubs=_Coll([]))
        assert asyncio.run(server.fleet_search("x")) == []
