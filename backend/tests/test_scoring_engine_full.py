"""Full unit tests for the RRS 2025-2028 Appendix A Low Point scoring engine.

Covers the configurable scoring engine end to end (pure functions plus the
standings pipeline with the DB layer stubbed out, exactly like the existing
test_scoring_rrs.py):

- every Appendix A scoring code with its underlying rule (not just a label)
- TLE (Time Limit Expired) with per-series configurable methods
- configurable SCP/ZFP penalty rules (percent / points / places, DNF cap)
- A5.2 / A5.3 / finishers+1 conventions behind one config knob
- fixed, multiple and increasing discards; DNE never discarded
- A8 tie-breaking and A7 tied-place point splitting
- duty/average points recalculated on every standings computation
- season locking: immutable snapshots served instead of recomputation
- the administrator amendment flow: new version, previous preserved, diff
- validation of invalid result combinations
"""
import os
import sys
import asyncio
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "scoring_test")
os.environ.setdefault("JWT_SECRET", "test")
os.environ.setdefault("RACE_OFFICER_PIN", "1")
os.environ.setdefault("RACE_ADMIN_PIN", "2")

import server  # noqa: E402


def _res(code, position=None, penalty_points=None):
    return {"code": code, "position": position, "penalty_points": penalty_points}


def _cfg(**overrides):
    cfg = server._default_scoring_config()
    cfg.update(overrides)
    return cfg


# ---------------------------------------------------------------------------
# Every Appendix A code has a real scoring rule
# ---------------------------------------------------------------------------

class TestEveryCodeScores:
    """Each code must feed the race score / series score / discard pipeline
    with its own Appendix A calculation — none is a mere text label."""

    def test_finished_scores_place(self):
        assert server.result_points(_res("FINISHED", 3), 10, 8) == 3.0

    def test_non_finish_codes_score_series_plus_1_default(self):
        # A5.2 default: every DNC-family code scores series entries + 1.
        for code in ("DNC", "DNS", "OCS", "UFD", "BFD", "NSC", "DNF", "RET", "DSQ", "DNE"):
            assert server.result_points(_res(code), 10, 8) == 11.0, code

    def test_dnc_always_series_plus_1(self):
        # Even under A5.3 / finishers conventions DNC uses the series total.
        for conv in ("a5_3", "finishers"):
            cfg = _cfg(a5_convention=conv)
            assert server.result_points(_res("DNC"), 10, 8, cfg=cfg) == 11.0

    def test_scp_zfp_percent_default(self):
        # Rule 44.3(c): place + round_half_up(20% of DNF); DNF = 11 -> +2.
        assert server.result_points(_res("SCP", 4), 10, 8) == 6.0
        assert server.result_points(_res("ZFP", 4), 10, 8) == 6.0

    def test_scp_zfp_capped_at_dnf(self):
        assert server.result_points(_res("SCP", 10), 10, 8) == 11.0
        assert server.result_points(_res("ZFP", 12), 10, 8) == 11.0

    def test_rdg_dpi_use_manual_points(self):
        assert server.result_points(_res("RDG", penalty_points=3.5), 10, 8) == 3.5
        assert server.result_points(_res("DPI", penalty_points=7), 10, 8) == 7.0

    def test_ood_is_duty(self):
        assert server.DUTY_CODES == {"OOD"}
        assert "OOD" in [c["code"] for c in server.RRS_CODES]

    def test_tle_is_a_code_with_a_rule(self):
        codes = {c["code"] for c in server.RRS_CODES}
        assert "TLE" in codes
        # default TLE method "finishers_plus_1": one more than the boats that
        # finished the race, regardless of the A5 base
        assert server.result_points(_res("TLE"), 10, 8, finishers=6) == 7.0


# ---------------------------------------------------------------------------
# TLE — Time Limit Expired (configurable per series/season)
# ---------------------------------------------------------------------------

class TestTle:
    def test_tle_method_dnf_uses_active_a5_base(self):
        # A5.3 base = start-area entries + 1
        cfg = _cfg(a5_convention="a5_3", tle={"enabled": True, "method": "dnf", "time_limit_minutes": 90})
        assert server.result_points(_res("TLE"), 10, 8, cfg=cfg) == 9.0
        # finishers convention base = finishers + 1
        cfg = _cfg(a5_convention="finishers", tle={"enabled": True, "method": "dnf"})
        assert server.result_points(_res("TLE"), 10, 8, finishers=6, cfg=cfg) == 7.0

    def test_tle_method_finishers_plus_1(self):
        cfg = _cfg(tle={"enabled": True, "method": "finishers_plus_1"})
        assert server.result_points(_res("TLE"), 10, 8, finishers=6, cfg=cfg) == 7.0

    def test_tle_method_dnc(self):
        cfg = _cfg(tle={"enabled": True, "method": "dnc"})
        assert server.result_points(_res("TLE"), 10, 8, finishers=6, cfg=cfg) == 11.0

    def test_tle_is_configurable_per_series_not_hardcoded(self):
        # Two series, same race data, different TLE methods -> different scores.
        a = _cfg(tle={"enabled": True, "method": "finishers_plus_1"})
        b = _cfg(tle={"enabled": True, "method": "dnc"})
        assert server.result_points(_res("TLE"), 10, 8, finishers=6, cfg=a) == 7.0
        assert server.result_points(_res("TLE"), 10, 8, finishers=6, cfg=b) == 11.0

    def test_tle_end_to_end_in_standings(self):
        # 4 boats: b1 1st, b2 2nd, b3 TLE, b4 DNC. TLE rule finishers+1 = 3,
        # DNC = 5. TLE boats must NOT be treated as a finishing position.
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0,
                  "scoring_config": {"tle": {"enabled": True, "method": "finishers_plus_1"}}}
        boats = [_boat(i) for i in range(1, 5)]
        race = {
            "id": "r1", "series_id": "s1", "class_id": "c1", "year": 2026,
            "race_number": 1, "date": "2026-05-02", "status": "published", "entries_count": 4,
            "results": [
                {"boat_id": "b1", "code": "FINISHED", "position": 1, "finish_time": "2026-05-02T10:05:00Z", "penalty_points": 0},
                {"boat_id": "b2", "code": "FINISHED", "position": 2, "finish_time": "2026-05-02T10:06:00Z", "penalty_points": 0},
                {"boat_id": "b3", "code": "TLE", "position": None, "finish_time": "2026-05-02T12:00:00Z", "penalty_points": 0},
                {"boat_id": "b4", "code": "DNC", "position": None, "finish_time": None, "penalty_points": 0},
            ],
        }
        st = _standings(series, boats, [race])
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b3"]["scores"][0]["code"] == "TLE"
        assert by_id["b3"]["net"] == 3.0          # finishers (2) + 1
        assert by_id["b4"]["net"] == 5.0          # DNC: series entries + 1
        assert by_id["b3"]["positions"] == [None]  # TLE is not a place


# ---------------------------------------------------------------------------
# Configurable SCP / ZFP penalty rules
# ---------------------------------------------------------------------------

class TestConfigurablePenalties:
    def test_scp_percent_is_configurable(self):
        cfg = _cfg(scp={"method": "percent", "value": 50.0, "cap_dnf": True})
        # place 2 + round_half_up(50% of 11=5.5) = 8
        assert server.result_points(_res("SCP", 2), 10, 8, cfg=cfg) == 8.0

    def test_scp_points_method(self):
        cfg = _cfg(scp={"method": "points", "value": 3.0, "cap_dnf": True})
        assert server.result_points(_res("SCP", 2), 10, 8, cfg=cfg) == 5.0

    def test_scp_places_method(self):
        cfg = _cfg(scp={"method": "places", "value": 2.0, "cap_dnf": True})
        assert server.result_points(_res("SCP", 4), 10, 8, cfg=cfg) == 6.0

    def test_cap_can_be_disabled(self):
        cfg = _cfg(scp={"method": "percent", "value": 50.0, "cap_dnf": False})
        # place 10 + 6 = 16, worse than DNF (11) — allowed when SIs say so.
        assert server.result_points(_res("SCP", 10), 10, 8, cfg=cfg) == 16.0

    def test_zfp_and_scp_independently_configured(self):
        cfg = _cfg(scp={"method": "percent", "value": 20.0, "cap_dnf": True},
                   zfp={"method": "points", "value": 4.0, "cap_dnf": True})
        # DNF = 11; SCP +round_half_up(2.2)=+2 -> 5; ZFP +4 -> 7
        assert server.result_points(_res("SCP", 3), 10, 8, cfg=cfg) == 5.0
        assert server.result_points(_res("ZFP", 3), 10, 8, cfg=cfg) == 7.0

    def test_no_place_falls_back_to_dnf(self):
        assert server.result_points(_res("SCP"), 10, 8) == 11.0


# ---------------------------------------------------------------------------
# Scoring config normalization / versioning
# ---------------------------------------------------------------------------

class TestScoringConfig:
    def test_defaults_are_rrs_2025_2028_a5_2(self):
        cfg = server._default_scoring_config()
        assert cfg["rrs_edition"] == "RRS 2025-2028"
        assert cfg["a5_convention"] == "a5_2"
        assert cfg["scp"]["value"] == 20.0 and cfg["zfp"]["value"] == 20.0
        assert cfg["tle"]["enabled"] is False

    def test_legacy_flags_normalized(self):
        assert server._series_scoring_config({"use_a5_3": True})["a5_convention"] == "a5_3"
        assert server._series_scoring_config({"use_finishers": True})["a5_convention"] == "finishers"
        assert server._series_scoring_config({})["a5_convention"] == "a5_2"

    def test_stored_config_merges_over_defaults(self):
        series = {"scoring_config": {
            "a5_convention": "finishers",
            "tle": {"enabled": True, "method": "finishers_plus_1"},
            "scp": {"value": 30.0},
            "discard_policy": "increasing",
            "discard_schedule": [{"after_races": 3, "discards": 1}],
        }}
        cfg = server._series_scoring_config(series)
        assert cfg["a5_convention"] == "finishers"
        assert cfg["tle"]["method"] == "finishers_plus_1"
        assert cfg["scp"]["value"] == 30.0
        assert cfg["scp"]["cap_dnf"] is True  # untouched defaults preserved
        assert cfg["discard_policy"] == "increasing"

    def test_effective_discards_fixed(self):
        cfg = server._default_scoring_config()
        assert server._effective_discards(cfg, 8, 2) == 2

    def test_effective_discards_increasing(self):
        cfg = _cfg(discard_policy="increasing",
                   discard_schedule=[{"after_races": 3, "discards": 0},
                                     {"after_races": 6, "discards": 1},
                                     {"after_races": 9, "discards": 2}])
        assert server._effective_discards(cfg, 2, 0) == 0
        assert server._effective_discards(cfg, 5, 0) == 0
        assert server._effective_discards(cfg, 6, 0) == 1
        assert server._effective_discards(cfg, 8, 0) == 1
        assert server._effective_discards(cfg, 10, 0) == 2


# ---------------------------------------------------------------------------
# Series standings: discards, DNE, duty, ties (DB stubbed like the existing suite)
# ---------------------------------------------------------------------------

def _boat(i, **extra):
    b = {"id": f"b{i}", "name": f"Boat {i}", "sail_no": str(i), "helm": "H",
         "class_id": "c1", "year": 2026}
    b.update(extra)
    return b


def _race(rn, results, date=None, entries=None, **extra):
    r = {"id": f"r{rn}", "series_id": "s1", "class_id": "c1", "year": 2026,
         "race_number": rn, "date": date or f"2026-05-{rn:02d}", "status": "published",
         "entries_count": entries or len(results), "results": results}
    r.update(extra)
    return r


def _fin(bid, pos=None, code="FINISHED", ft=None):
    return {"boat_id": bid, "code": code, "position": pos,
            "finish_time": ft or (f"2026-05-02T10:{pos:02d}:00Z" if pos else None),
            "penalty_points": 0}


def _standings(series, boats, races):
    server.db = types.SimpleNamespace(
        races=_Coll(races), boats=_Coll(boats),
        classes=_Coll([{"id": "c1", "club_id": "club-1"}]), clubs=_Coll([]))
    return asyncio.run(server.compute_series_standings(series))


class _Cursor:
    def __init__(self, items):
        self.items = items

    def sort(self, key, direction=-1):
        items = list(self.items)
        items.sort(key=lambda d: d.get(key) if d.get(key) is not None else -10**9,
                   reverse=(direction == -1))
        return _Cursor(items)

    async def to_list(self, n):
        return self.items[:n] if n else self.items


class _Coll:
    def __init__(self, items):
        self.items = list(items)

    def find(self, *_a, **_k):
        return _Cursor(self.items)

    async def find_one(self, *_a, **_k):
        return self.items[0] if self.items else None


class _FilterColl:
    """Filter-aware collection applying the abandoned-exclusion query the
    scoring engine uses (`abandoned != true`), so abandoned races are dropped
    exactly as MongoDB would."""

    def __init__(self, items):
        self.items = list(items)

    def find(self, filt=None, projection=None):
        out = self.items
        if filt and filt.get("abandoned") == {"$ne": True}:
            out = [d for d in out if not d.get("abandoned")]
        return _Cursor(out)

    async def find_one(self, filt=None, projection=None):
        return (await self.find(filt, projection).to_list(1))[0] if self.items else None


def _standings_filtered(series, boats, races):
    """Compute standings with the races collection applying the abandoned
    filter (races keeps its published status in every fixture)."""
    server.db = types.SimpleNamespace(
        races=_FilterColl(races), boats=_Coll(boats),
        classes=_Coll([{"id": "c1", "club_id": "club-1"}]), clubs=_Coll([]))
    return asyncio.run(server.compute_series_standings(series))


class TestSeriesMembership:
    """Explicit series membership (officer/admin managed boat list) drives
    which fleet the DNC engine scores. Members absent from a race auto-score
    DNC; non-members are excluded from the standings entirely — even if they
    appeared in a race (e.g. a boat signed onto a different series)."""

    def _series(self, **extra):
        s = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0}
        s.update(extra)
        return s

    def test_members_only_scored_dnc_for_absent(self):
        series = self._series(member_boat_ids=["b1", "b3"])
        boats = [_boat(i) for i in range(1, 5)]  # b1..b4 in the class
        races = [_race(1, [_fin("b1", 1), _fin("b2", 2)])]  # b2 races but is NOT a member
        st = _standings(series, boats, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert set(by_id) == {"b1", "b3"}
        assert by_id["b1"]["net"] == 1.0
        # Member b3 never sailed -> DNC = series entries + 1 (2 entered boats)
        assert by_id["b3"]["scores"][0]["code"] == "DNC"
        assert by_id["b3"]["net"] == 3.0
        # Non-member b2 raced but must not appear in the series standings
        assert "b2" not in by_id
        assert "b4" not in by_id

    def test_members_absent_from_whole_series_still_scored_dnc(self):
        """A member who never sailed ANY race of the series still belongs to
        it (all-DNC rows), unlike the auto-detected fleet which only admits
        boats that raced at least once."""
        series = self._series(member_boat_ids=["b1", "b2"])
        boats = [_boat(i) for i in range(1, 4)]
        races = [_race(1, [_fin("b1", 1)])]
        st = _standings(series, boats, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert set(by_id) == {"b1", "b2"}
        assert by_id["b2"]["scores"][0]["code"] == "DNC"
        assert by_id["b2"]["net"] == 2.0  # 1 entered boat + 1

    def test_empty_membership_falls_back_to_auto_detected_fleet(self):
        """Clearing the explicit list returns to auto-detection: only boats
        that appear in a published race are entered."""
        series = self._series(member_boat_ids=[])
        boats = [_boat(i) for i in range(1, 4)]
        races = [_race(1, [_fin("b1", 1), _fin("b2", 2)])]
        st = _standings(series, boats, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert set(by_id) == {"b1", "b2"}
        assert "b3" not in by_id


class TestAbandonedRaces:
    def test_abandoned_race_reduces_race_count_and_discards(self):
        """An abandoned race is not scored: the series has one fewer race and,
        with an increasing discard schedule, the discard threshold is not
        reached until the scheduled race count applies."""
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0,
                  "scoring_config": {"discard_policy": "increasing",
                                     "discard_schedule": [{"after_races": 4, "discards": 1}]}}
        boats = [_boat(i) for i in range(1, 3)]
        races = [
            _race(1, [_fin("b1", 1), _fin("b2", 2)]),
            _race(2, [_fin("b1", 1), _fin("b2", 2)]),
            _race(3, [_fin("b1", 1), _fin("b2", 2)]),
            _race(4, [_fin("b1", 1), _fin("b2", 2)], abandoned=True),
            _race(5, [_fin("b1", 1), _fin("b2", 2)]),
        ]
        st = _standings_filtered(series, boats, races)
        assert st["race_count"] == 4           # abandoned race not counted
        assert st["discards"] == 1             # 4 races scored -> 1 discard
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert len(by_id["b1"]["scores"]) == 4  # no score row for the abandoned race
        assert by_id["b1"]["net"] == 3.0        # 1,1,1,1 discard one -> 3

    def test_abandoned_race_below_discard_threshold(self):
        """If abandoning drops the scored races below the schedule threshold,
        no discard applies yet — exactly the 'changes the discards' rule."""
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0,
                  "scoring_config": {"discard_policy": "increasing",
                                     "discard_schedule": [{"after_races": 4, "discards": 1}]}}
        boats = [_boat(i) for i in range(1, 3)]
        races = [
            _race(1, [_fin("b1", 1), _fin("b2", 2)]),
            _race(2, [_fin("b1", 1), _fin("b2", 2)]),
            _race(3, [_fin("b1", 1), _fin("b2", 2)]),
            _race(4, [_fin("b1", 1), _fin("b2", 2)], abandoned=True),
        ]
        st = _standings_filtered(series, boats, races)
        assert st["race_count"] == 3
        assert st["discards"] == 0             # threshold (4 races) not reached
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b1"]["net"] == 3.0        # 1+1+1, nothing discarded

    def test_abandoned_race_caps_fixed_discards(self):
        """Fixed discards still cannot exceed races scored - 1."""
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 2}
        boats = [_boat(i) for i in range(1, 3)]
        races = [
            _race(1, [_fin("b1", 1), _fin("b2", 2)]),
            _race(2, [_fin("b1", 1), _fin("b2", 2)]),
            _race(3, [_fin("b1", 1), _fin("b2", 2)], abandoned=True),
            _race(4, [_fin("b1", 1), _fin("b2", 2)]),
        ]
        st = _standings_filtered(series, boats, races)
        assert st["race_count"] == 3
        assert st["discards"] == 2             # min(2, 3-1) — never discard every race
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b1"]["net"] == 1.0        # 1,1,1 discard two


class TestDiscards:
    def test_multiple_discards(self):
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 2}
        boats = [_boat(i) for i in range(1, 3)]
        races = [
            _race(1, [_fin("b1", 1), _fin("b2", 2)]),
            _race(2, [_fin("b1", 2), _fin("b2", 1)]),
            _race(3, [_fin("b1", 1), _fin("b2", 2)]),
            _race(4, [_fin("b1", 4), _fin("b2", 5)]),
            _race(5, [_fin("b1", 1), _fin("b2", 2)]),
        ]
        st = _standings(series, boats, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        # b1: 1,2,1,4,1 -> discard 4 and 2 -> net 3
        assert by_id["b1"]["net"] == 3.0 and by_id["b1"]["total"] == 9.0
        # b2: 2,1,2,5,2 -> discard 5 and 2 -> net 5
        assert by_id["b2"]["net"] == 5.0
        assert sum(1 for s in by_id["b2"]["scores"] if s["discarded"]) == 2

    def test_increasing_discards_apply_by_races_scored(self):
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0,
                  "scoring_config": {"discard_policy": "increasing",
                                     "discard_schedule": [{"after_races": 3, "discards": 0},
                                                          {"after_races": 4, "discards": 1}]}}
        boats = [_boat(i) for i in range(1, 3)]
        races = [
            _race(1, [_fin("b1", 1), _fin("b2", 2)]),
            _race(2, [_fin("b1", 1), _fin("b2", 2)]),
            _race(3, [_fin("b1", 1), _fin("b2", 2)]),
            _race(4, [_fin("b1", 5), _fin("b2", 5)]),
        ]
        # Before race 4 is scored (3 races): no discard.
        st3 = _standings(series, boats, races[:3])
        assert st3["discards"] == 0 and st3["discard_policy"] == "increasing"
        assert st3["standings"][0]["net"] == 3.0
        # After 4 races: 1 discard kicks in automatically.
        st4 = _standings(series, boats, races)
        assert st4["discards"] == 1
        by_id = {r["boat_id"]: r for r in st4["standings"]}
        assert by_id["b1"]["net"] == 3.0  # the 5 is discarded

    def test_dne_is_never_discarded(self):
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 1}
        boats = [_boat(i) for i in range(1, 3)]
        # b1: 1st, 1st, DNE (7 = entries+1... entries 2 -> DNE 3.0). DNE is the
        # worst score but must NOT be discarded — the 2nd race (1) is not
        # discarded because 1 is best... with only 3 races and DNE worst, the
        # discard must skip the DNE and drop the next-worst eligible (the
        # equal-worst 1s are tied; earliest dropped -> race 1).
        races = [
            _race(1, [_fin("b1", 1), _fin("b2", 2)]),
            _race(2, [_fin("b1", 1), _fin("b2", 2)]),
            _race(3, [_fin("b1", code="DNE"), _fin("b2", 1)]),
        ]
        st = _standings(series, boats, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        scores = by_id["b1"]["scores"]
        assert scores[2]["code"] == "DNE" and scores[2]["discarded"] is False
        # DNE = entries(2)+1 = 3. It must count; the discard drops one of the
        # two equal-best 1.0s (earliest) -> net = 1 + 3 = 4, never 2.
        assert by_id["b1"]["net"] == 4.0
        assert sum(1 for s in scores if s["discarded"]) == 1

    def test_dne_not_discarded_dynamically_as_series_grows(self):
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 1}
        boats = [_boat(i) for i in range(1, 3)]
        races = [
            _race(1, [_fin("b1", 1), _fin("b2", 2)]),
            _race(2, [_fin("b1", code="DNE"), _fin("b2", 1)]),
            _race(3, [_fin("b1", 2), _fin("b2", 1)]),
        ]
        st = _standings(series, boats, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        scores = by_id["b1"]["scores"]
        assert scores[1]["code"] == "DNE" and scores[1]["discarded"] is False
        # worst discardable score (2) discarded -> net 1 + 3 = 4
        assert by_id["b1"]["net"] == 4.0


class TestTieBreaking:
    def test_a8_resolves_equal_nets(self):
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0}
        boats = [_boat(i) for i in range(1, 3)]
        # b1: 1,4,5 = 10; b2: 2,3,5 = 10. A8.1: b1 (1,4,5) beats b2 (2,3,5)
        # at the first difference (1 < 2).
        races = [
            _race(1, [_fin("b1", 1), _fin("b2", 2)]),
            _race(2, [_fin("b1", 4), _fin("b2", 3)]),
            _race(3, [_fin("b1", 5), _fin("b2", 5)]),
        ]
        st = _standings(series, boats, races)
        order = [r["boat_id"] for r in st["standings"]]
        assert order == ["b1", "b2"]

    def test_a8_2_last_race_decides_when_counting_scores_tie(self):
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0}
        boats = [_boat(i) for i in range(1, 3)]
        # Identical A8.1 lists (1,4,5) but b1's last race was a 5th, b2's a 4th.
        races = [
            _race(1, [_fin("b1", 1), _fin("b2", 1)]),
            _race(2, [_fin("b1", 4), _fin("b2", 5)]),
            _race(3, [_fin("b1", 5), _fin("b2", 4)]),
        ]
        st = _standings(series, boats, races)
        order = [r["boat_id"] for r in st["standings"]]
        assert order == ["b2", "b1"]

    def test_ties_never_share_a_position_when_a8_decides(self):
        # Two boats on equal net get distinct ranks, not both "1st".
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0}
        boats = [_boat(i) for i in range(1, 3)]
        races = [_race(1, [_fin("b1", 2), _fin("b2", 2)]),
                 _race(2, [_fin("b1", 1), _fin("b2", 1)])]
        st = _standings(series, boats, races)
        ranks = [r["rank"] for r in st["standings"]]
        assert sorted(ranks) == [1, 2]

    def test_a7_tied_finishing_line_splits_points(self):
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0}
        boats = [_boat(i) for i in range(1, 4)]
        race = _race(1, [_fin("b1", 1), _fin("b2", 1), _fin("b3", 3)])
        st = _standings(series, boats, [race])
        by_id = {r["boat_id"]: r for r in st["standings"]}
        # b1 and b2 tied on the line share places 1+2 -> 1.5 each; b3 keeps 3.
        assert by_id["b1"]["net"] == 1.5 and by_id["b2"]["net"] == 1.5
        assert by_id["b3"]["net"] == 3.0


class TestDutyRecalculation:
    def _series(self):
        return {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0,
                "scoring_config": {"duty": {"enabled": True, "method": "average_own_sailed", "round": 2}}}

    def test_duty_average_uses_races_scored_to_date(self):
        boats = [_boat(i) for i in range(1, 3)]
        r1 = _race(1, [_fin("b1", 1), _fin("b2", 2)])
        r2 = _race(2, [_fin("b1", 2), _fin("b2", 1)])
        r3 = _race(3, [_fin("b1", code="OOD"), _fin("b2", 1)])

        # After races 1+2 only: no OOD yet.
        st2 = _standings(self._series(), boats, [r1, r2])
        assert st2["standings"][0]["net"] == 3.0

        # After race 3 (OOD): the duty score is the average of the series so
        # far = (1 + 2) / 2 = 1.5 — recalculated, not fixed at an earlier value.
        st3 = _standings(self._series(), boats, [r1, r2, r3])
        by_id = {r["boat_id"]: r for r in st3["standings"]}
        ood = by_id["b1"]["scores"][2]
        assert ood["code"] == "OOD" and ood["points"] == 1.5

        # Add another sailed race: the OOD average must move to (1+2+1)/3 = 1.33
        # (the standings table rounds the displayed score to one decimal).
        r4 = _race(4, [_fin("b1", 1), _fin("b2", 2)])
        st4 = _standings(self._series(), boats, [r1, r2, r3, r4])
        by_id4 = {r["boat_id"]: r for r in st4["standings"]}
        assert by_id4["b1"]["scores"][2]["points"] == 1.3

    def test_duty_applied_before_discard(self):
        # OOD average must feed the discard calculation: the duty race itself
        # is discardable and the net reflects it.
        boats = [_boat(i) for i in range(1, 3)]
        races = [
            _race(1, [_fin("b1", 1), _fin("b2", 2)]),
            _race(2, [_fin("b1", 5), _fin("b2", 6)]),
            _race(3, [_fin("b1", code="OOD"), _fin("b2", 1)]),
        ]
        series = {**self._series(), "discards": 1}
        st = _standings(series, boats, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        # b1 sailed 1st and 5th -> OOD = 3.0; worst discardable (5) dropped ->
        # net = 1 + 3 = 4.
        assert by_id["b1"]["scores"][2]["points"] == 3.0
        assert by_id["b1"]["net"] == 4.0

    def test_duty_average_includes_dnc_and_dnc_is_still_discardable(self):
        # Full pipeline: the DNC (series entries + 1 = 4 with 3 boats) must feed
        # the OOD average, and the DNC race itself must remain discardable so
        # the discard applies AFTER the OOD score is fixed.
        boats = [_boat(i) for i in range(1, 4)]
        r1 = _race(1, [_fin("b1", 1), _fin("b2", 2), _fin("b3", 3)])
        r2 = _race(2, [_fin("b2", 1), _fin("b3", 2)], entries=3)  # b1 absent -> DNC
        r3 = _race(3, [_fin("b1", code="OOD"), _fin("b2", 1), _fin("b3", 2)])
        r4 = _race(4, [_fin("b1", 2), _fin("b2", 1), _fin("b3", 3)])

        # After r1+r2 only: no OOD yet; b1 = 1st + DNC(4) = 5.
        st2 = _standings(self._series(), boats, [r1, r2])
        by_id2 = {r["boat_id"]: r for r in st2["standings"]}
        assert by_id2["b1"]["net"] == 5.0

        # After r3 (OOD): the average covers the complete series including the
        # DNC -> OOD = (1 + 4) / 2 = 2.5, net = 1 + 4 + 2.5 = 7.5.
        st3 = _standings(self._series(), boats, [r1, r2, r3])
        by_id3 = {r["boat_id"]: r for r in st3["standings"]}
        ood = by_id3["b1"]["scores"][2]
        assert ood["code"] == "OOD" and ood["points"] == 2.5
        assert by_id3["b1"]["net"] == 7.5

        # After r4: the OOD average moves to (1 + 4 + 2) / 3 = 2.33 (displayed
        # 2.3), and the DNC (4) is the worst race, so with 1 discard it is
        # dropped from the net: 1 + 2.33 + 2 = 5.33 (displayed 5.3).
        series = {**self._series(), "discards": 1}
        st4 = _standings(series, boats, [r1, r2, r3, r4])
        by_id4 = {r["boat_id"]: r for r in st4["standings"]}
        scores = by_id4["b1"]["scores"]
        assert scores[1]["code"] == "DNC" and scores[1]["discarded"] is True
        assert scores[2]["code"] == "OOD" and scores[2]["points"] == 2.3
        assert by_id4["b1"]["net"] == 5.3


class TestSeriesToDatePayload:
    def test_payload_has_provisional_series_metadata(self):
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 1,
                  "planned_races": 8}
        boats = [_boat(i) for i in range(1, 3)]
        races = [_race(1, [_fin("b1", 1), _fin("b2", 2)]),
                 _race(2, [_fin("b1", 2), _fin("b2", 1)])]
        st = _standings(series, boats, races)
        assert st["race_count"] == 2 and st["races_scored"] == 2
        assert st["discards"] == 1 and st["discards_applied"] == 1
        assert st["engine_version"] == server.SCORING_ENGINE_VERSION
        assert st["scoring_config"]["rrs_edition"] == "RRS 2025-2028"
        assert st["planned_races"] == 8
        # every standings row carries the series-to-date numbers
        row = st["standings"][0]
        assert {"net", "total", "rank", "scores", "positions"} <= set(row)


# ---------------------------------------------------------------------------
# Season locking — immutable snapshots, amendment flow
# ---------------------------------------------------------------------------

def _matches(doc, filt):
    if not filt:
        return True
    for k, v in filt.items():
        if isinstance(v, dict):
            for op, val in v.items():
                if op == "$in" and doc.get(k) not in val:
                    return False
                if op == "$ne" and doc.get(k) == val:
                    return False
                if op == "$exists" and ((k in doc) != bool(val)):
                    return False
        elif doc.get(k) != v:
            return False
    return True


def _apply_update(doc, update):
    for op, fields in update.items():
        if op == "$set":
            doc.update(fields)
        elif op == "$unset":
            for k in fields:
                doc.pop(k, None)


class _FakeCursor:
    def __init__(self, coll, filt):
        self.coll = coll
        self.filt = filt or {}
        self._sort = None

    def sort(self, key, direction=-1):
        self._sort = (key, direction)
        return self

    async def to_list(self, n):
        items = [d for d in self.coll.docs if _matches(d, self.filt)]
        if self._sort:
            key, direction = self._sort
            items = sorted(items, key=lambda d: d.get(key) if d.get(key) is not None else -10**9,
                           reverse=(direction == -1))
        if n:
            items = items[:n]
        return items


class _FakeColl:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, filt=None, _projection=None):
        return _FakeCursor(self, filt)

    async def find_one(self, filt=None, _projection=None):
        for d in self.docs:
            if _matches(d, filt or {}):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)
        return doc

    async def update_one(self, filt, update):
        for d in self.docs:
            if _matches(d, filt):
                _apply_update(d, update)
                return types.SimpleNamespace(matched_count=1, modified_count=1)
        return types.SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, filt, update):
        for d in self.docs:
            if _matches(d, filt):
                _apply_update(d, update)

    async def delete_one(self, filt):
        for i, d in enumerate(self.docs):
            if _matches(d, filt):
                del self.docs[i]
                return types.SimpleNamespace(deleted_count=1)
        return types.SimpleNamespace(deleted_count=0)

    async def count_documents(self, filt):
        return sum(1 for d in self.docs if _matches(d, filt))


def _fake_db(races, boats, series_docs, snapshots=None):
    return types.SimpleNamespace(
        races=_FakeColl(races), boats=_FakeColl(boats), series=_FakeColl(series_docs),
        season_snapshots=_FakeColl(snapshots or []),
        classes=_FakeColl([{"id": "c1", "club_id": "club-1", "name": "Sonata"}]),
        clubs=_FakeColl([{"id": "club-1", "name": "Medway Yacht Club"}]),
        audit_logs=_FakeColl([]),
    )


ADMIN_USER = {"role": "admin", "club_id": "club-1", "user_id": "u-admin",
              "username": "admin@medway"}


def _lock_series(series, db):
    server.db = db
    return asyncio.run(server.lock_series(
        series["id"], server.LockSeriesInput(confirm=True, reason="Season finalised"),
        None, ADMIN_USER))


def _unlock_series(series, db):
    server.db = db
    return asyncio.run(server.unlock_series(
        series["id"], server.LockSeriesInput(confirm=True, reason="Correction required"),
        None, ADMIN_USER))


def _standings_for(series, db):
    server.db = db
    return asyncio.run(server._standings_for_series(series))


class TestSeasonLocking:
    def _make_locked_season(self):
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0,
                  "name": "2026 Sonata Series", "planned_races": 6,
                  "scoring_config": {"a5_convention": "a5_2",
                                     "tle": {"enabled": True, "method": "finishers_plus_1"}}}
        boats = [_boat(i) for i in range(1, 4)]
        races = [
            _race(1, [_fin("b1", 1), _fin("b2", 2), _fin("b3", 3)]),
            _race(2, [_fin("b1", 2), _fin("b2", 1), _fin("b3", 3)]),
        ]
        db = _fake_db(races, boats, [dict(series)])
        server.db = db
        resp = _lock_series(series, db)
        series_doc = db.series.docs[0]
        return series, db, resp, series_doc

    def test_lock_creates_immutable_snapshot(self):
        series, db, resp, series_doc = self._make_locked_season()
        assert resp["version"] == 1
        assert series_doc["lock_status"] == server.LOCK_LOCKED
        snaps = db.season_snapshots.docs
        assert len(snaps) == 1
        snap = snaps[0]
        assert snap["version"] == 1 and snap["status"] == "locked"
        assert snap["locked_by"] == "admin@medway"
        assert snap["locked_at"]
        assert snap["engine_version"] == server.SCORING_ENGINE_VERSION
        assert snap["scoring_config"]["tle"]["method"] == "finishers_plus_1"
        assert snap["payload"]["race_count"] == 2
        # per-race detail with computed points and codes is captured
        r1 = next(r for r in snap["races"] if r["race_number"] == 1)
        b1 = next(e for e in r1["results"] if e["boat_id"] == "b1")
        assert b1["code"] == "FINISHED" and b1["points"] == 1.0
        # ratings and NoR/SI settings captured
        assert snap["ratings"]["b1"] == {"tcc": None, "py": None}
        assert snap["nor_si_settings"]["planned_races"] == 6

    def test_locked_standings_served_from_snapshot_never_recomputed(self):
        """Section 16: after locking, changing the engine, TLE rule, handicap,
        discard rules, duty or boat details must NOT alter the served results."""
        series, db, resp, series_doc = self._make_locked_season()
        frozen = _standings_for(db.series.docs[0], db)
        frozen_net = {r["boat_id"]: r["net"] for r in frozen["standings"]}
        frozen_rank = {r["boat_id"]: r["rank"] for r in frozen["standings"]}

        # Now wreck the live data: different rules, different ratings, changed
        # results, extra boat, different discards.
        series_doc["scoring_config"] = {
            "a5_convention": "finishers",
            "tle": {"enabled": True, "method": "dnc"},
            "scp": {"value": 60.0},
            "discard_policy": "increasing",
            "discard_schedule": [{"after_races": 1, "discards": 1}],
        }
        series_doc["discards"] = 2
        series_doc["use_finishers"] = True
        for r in db.races.docs:
            for res in r["results"]:
                res["code"] = "DNF"  # nobody finishes under the "new" engine
        for b in db.boats.docs:
            b["py"] = 900  # handicap changed
        db.boats.docs.append(_boat(4))

        # The served standings are still the frozen snapshot.
        served = _standings_for(db.series.docs[0], db)
        assert served["locked"] is True
        assert served["snapshot_version"] == 1
        assert served["engine_version"] == server.SCORING_ENGINE_VERSION
        assert {r["boat_id"]: r["net"] for r in served["standings"]} == frozen_net
        assert {r["boat_id"]: r["rank"] for r in served["standings"]} == frozen_rank
        assert served["scoring_config"]["tle"]["method"] == "finishers_plus_1"

        # Sanity: the LIVE engine really would produce different numbers now,
        # proving the snapshot (not the engine) is what is being served.
        live = asyncio.run(server.compute_series_standings(series_doc))
        assert live["scoring_config"]["tle"]["method"] == "dnc"
        assert {r["boat_id"]: r["net"] for r in live["standings"]} != frozen_net

    def test_mutation_guards_reject_locked_season(self):
        series, db, resp, series_doc = self._make_locked_season()
        server.db = db
        with _raises_http(409):
            asyncio.run(server._ensure_series_not_locked("s1"))
        # open series passes
        series_doc["lock_status"] = server.LOCK_OPEN
        asyncio.run(server._ensure_series_not_locked("s1"))  # no raise

    def test_unlock_requires_confirmation_and_reason(self):
        series, db, resp, series_doc = self._make_locked_season()
        server.db = db
        import pytest
        with pytest.raises(Exception):
            asyncio.run(server.unlock_series(
                "s1", server.LockSeriesInput(confirm=False, reason=""), None, ADMIN_USER))
        assert series_doc["lock_status"] == server.LOCK_LOCKED

    def test_amendment_preserves_previous_version_and_records_diff(self):
        """Section 18: correct -> unlock (reason recorded) -> fix -> re-lock
        creates a NEW version; the previous result is preserved and exactly
        what changed is recorded."""
        series, db, resp, series_doc = self._make_locked_season()
        _unlock_series(series, db)
        assert db.series.docs[0]["lock_status"] == server.LOCK_OPEN
        assert [s["status"] for s in db.season_snapshots.docs] == ["superseded"]

        # Genuine correction: race 2's true order was b1 1st, b3 2nd, b2 3rd
        # (b1 also won race 2 — the original b2 1st was the scoring error).
        r2 = next(r for r in db.races.docs if r["race_number"] == 2)
        for res in r2["results"]:
            res["position"] = {"b1": 1, "b3": 2, "b2": 3}[res["boat_id"]]
        # re-sequence order by position for the fake data
        r2["results"] = sorted(r2["results"], key=lambda x: x["position"] or 99)

        resp2 = _lock_series(series, db)
        assert resp2["version"] == 2
        amendment = resp2["amendment"]
        assert amendment["reason"] == "Season finalised"
        b3_change = next(c for c in amendment["changes"] if c["boat_id"] == "b3")
        assert b3_change["rank_before"] == 3 and b3_change["rank_after"] == 2

        snaps = sorted(db.season_snapshots.docs, key=lambda s: s["version"])
        assert [s["version"] for s in snaps] == [1, 2]
        # v1 is preserved (superseded, payload intact); v2 is the active lock.
        assert snaps[0]["status"] == "superseded"
        assert snaps[0]["payload"]["standings"][2]["boat_id"] == "b3"
        assert snaps[1]["status"] == "locked"
        assert snaps[1]["amendment"]["changes"]

        # Served standings now come from v2.
        served = _standings_for(db.series.docs[0], db)
        assert served["snapshot_version"] == 2
        assert served["standings"][1]["boat_id"] == "b3"

    def test_snapshots_history_endpoint_shape(self):
        series, db, resp, series_doc = self._make_locked_season()
        server.db = db
        snaps = asyncio.run(server.series_snapshots("s1", None, ADMIN_USER))
        assert len(snaps) == 1
        assert snaps[0]["version"] == 1
        assert "payload" not in snaps[0]  # history list stays light


def _raises_http(status):
    import contextlib
    import fastapi
    @contextlib.contextmanager
    def cm():
        try:
            yield
        except fastapi.HTTPException as exc:
            assert exc.status_code == status
        else:
            raise AssertionError(f"expected HTTP {status}")
    return cm()


# ---------------------------------------------------------------------------
# Validation — flag invalid combinations
# ---------------------------------------------------------------------------

class TestValidation:
    def test_duplicate_boat_is_flagged(self):
        results = [
            {"boat_id": "b1", "code": "DNF", "position": None, "penalty_points": None},
            {"boat_id": "b1", "code": "DSQ", "position": None, "penalty_points": None},
        ]
        errors = [w for w in server.validate_race_results(results) if w["level"] == "error"]
        assert any("more than once" in w["message"] for w in errors)

    def test_position_with_non_finish_code_flagged(self):
        results = [{"boat_id": "b1", "code": "DNC", "position": 3, "penalty_points": None}]
        errors = [w for w in server.validate_race_results(results) if w["level"] == "error"]
        assert any("position" in w["message"] for w in errors)

    def test_dpi_without_points_flagged(self):
        results = [{"boat_id": "b1", "code": "DPI", "position": None, "penalty_points": None}]
        errors = [w for w in server.validate_race_results(results) if w["level"] == "error"]
        assert any("DPI" in w["message"] for w in errors)

    def test_rdg_without_points_flagged(self):
        results = [{"boat_id": "b1", "code": "RDG", "position": None, "penalty_points": None}]
        errors = [w for w in server.validate_race_results(results) if w["level"] == "error"]
        assert any("RDG" in w["message"] for w in errors)

    def test_dpi_without_decision_maker_warns(self):
        results = [{"boat_id": "b1", "code": "DPI", "position": None, "penalty_points": 6.0}]
        warnings = [w for w in server.validate_race_results(results) if w["level"] == "warning"]
        assert any("DPI" in w["message"] for w in warnings)
        # recording the decision-maker clears the warning
        results[0]["dpi_decision_maker"] = "Protest Committee"
        results[0]["dpi_reason"] = "RRS 44.1(b)"
        warnings = [w for w in server.validate_race_results(results) if w["level"] == "warning"]
        assert not any("DPI" in w["message"] for w in warnings)

    def test_tle_without_configured_rule_warns(self):
        results = [{"boat_id": "b1", "code": "TLE", "position": None, "penalty_points": None}]
        warnings = [w for w in server.validate_race_results(results, _cfg()) if w["level"] == "warning"]
        assert any("TLE" in w["message"] for w in warnings)
        # with the TLE rule configured, the warning disappears
        cfg = _cfg(tle={"enabled": True, "method": "finishers_plus_1"})
        warnings = [w for w in server.validate_race_results(results, cfg) if w["level"] == "warning"]
        assert not any("TLE" in w["message"] for w in warnings)

    def test_clean_results_produce_no_errors(self):
        results = [
            {"boat_id": "b1", "code": "FINISHED", "position": 1, "penalty_points": None},
            {"boat_id": "b2", "code": "DNC", "position": None, "penalty_points": None},
            {"boat_id": "b3", "code": "DPI", "position": None, "penalty_points": 6.0,
             "dpi_decision_maker": "PC", "dpi_reason": "RRS 44.1(b)"},
        ]
        issues = server.validate_race_results(results)
        assert not [w for w in issues if w["level"] == "error"]

    def test_finished_without_position_warns(self):
        results = [{"boat_id": "b1", "code": "FINISHED", "position": None, "penalty_points": None}]
        warnings = [w for w in server.validate_race_results(results) if w["level"] == "warning"]
        assert any("no finishing position" in w["message"] for w in warnings)
