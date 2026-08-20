"""Unit tests for the RRS Low Point scoring engine (pure functions in server.py).

RRS 2025-2028 Appendix A4/A5/A8 and rule 44.3(c). No database or network is
used: these tests exercise the scoring math directly.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "scoring_test")
os.environ.setdefault("JWT_SECRET", "test")
os.environ.setdefault("RACE_OFFICER_PIN", "1")
os.environ.setdefault("RACE_ADMIN_PIN", "2")

import server  # noqa: E402


def _res(code, position=None, penalty_points=None):
    return {"code": code, "position": position, "penalty_points": penalty_points}


class TestLowPointBasic:
    """A4 — boats starting and finishing score their finishing place."""

    def test_finishers_score_their_place(self):
        assert server.result_points(_res("FINISHED", 1), 9, 5) == 1.0
        assert server.result_points(_res("FINISHED", 7), 9, 5) == 7.0

    def test_finished_without_position_falls_back_to_dnf(self):
        assert server.result_points(_res("FINISHED"), 9, 5) == 10.0


class TestA52Default:
    """A5.2 (default): every non-finish code scores series entries + 1."""

    def test_all_non_finish_codes_series_plus_1(self):
        for code in ("DNC", "DNS", "OCS", "UFD", "BFD", "DNF", "RET", "DSQ", "DNE", "NSC"):
            assert server.result_points(_res(code), 9, 5) == 10.0, code

    def test_dnc_is_series_entries_plus_1(self):
        assert server.result_points(_res("DNC"), 11, 5) == 12.0


class TestA53Option:
    """A5.3 (SI option): only DNC uses series entries; start-area codes score
    start-area entries + 1, which is better than DNC."""

    def test_dnc_still_series_plus_1(self):
        assert server.result_points(_res("DNC"), 9, 5, True) == 10.0

    def test_start_area_codes_score_start_area_plus_1(self):
        assert server.result_points(_res("DNF"), 9, 5, True) == 6.0
        assert server.result_points(_res("RET"), 9, 5, True) == 6.0
        assert server.result_points(_res("DSQ"), 9, 5, True) == 6.0
        assert server.result_points(_res("OCS"), 9, 5, True) == 6.0


class TestZfpScp:
    """Rule 44.3(c): score without penalty (place) + 20% of the DNF score,
    rounded half-up, never worse than DNF."""

    def test_place_plus_20pct_of_dnf(self):
        # 11 boats in series -> DNF = 12 -> penalty = round(2.4) = 2
        assert server.result_points(_res("ZFP", 4), 11, 8) == 6.0
        assert server.result_points(_res("SCP", 4), 11, 8) == 6.0

    def test_capped_at_dnf_score(self):
        # 10th place + 2 = 12 == DNF; last place would be 13 -> capped at 12
        assert server.result_points(_res("ZFP", 10), 11, 8) == 12.0
        assert server.result_points(_res("SCP", 11), 11, 8) == 12.0

    def test_no_place_falls_back_to_dnf(self):
        assert server.result_points(_res("SCP"), 11, 8) == 12.0

    def test_round_half_up(self):
        assert server.round_half_up(2.4) == 2
        assert server.round_half_up(2.5) == 3
        assert server.round_half_up(0.5) == 1


class TestRdgDpi:
    """RDG/DPI: manual points when provided, else the DNF score."""

    def test_manual_points_used(self):
        assert server.result_points(_res("RDG", penalty_points=3.5), 9, 5) == 3.5
        assert server.result_points(_res("DPI", penalty_points=6), 9, 5) == 6.0

    def test_falls_back_to_dnf(self):
        assert server.result_points(_res("RDG"), 9, 5) == 10.0


class TestA61Resequence:
    """A6.1 — a finisher later scored as not finishing / disqualified moves the
    boats behind her up one place."""

    def test_resequence_after_dsq(self):
        results = [
            {"boat_id": "a", "code": "FINISHED", "position": 1, "finish_time": "2026-01-01T10:00:00Z"},
            {"boat_id": "b", "code": "DSQ", "position": None, "finish_time": None},
            {"boat_id": "c", "code": "FINISHED", "position": 3, "finish_time": "2026-01-01T10:05:00Z"},
        ]
        server._resequence_finished(results)
        pos = {r["boat_id"]: r["position"] for r in results if r["code"] == "FINISHED"}
        assert pos == {"a": 1, "c": 2}

    def test_resequence_orders_by_finish_time(self):
        results = [
            {"boat_id": "a", "code": "FINISHED", "position": 2, "finish_time": "2026-01-01T10:05:00Z"},
            {"boat_id": "b", "code": "FINISHED", "position": 1, "finish_time": "2026-01-01T10:00:00Z"},
        ]
        server._resequence_finished(results)
        pos = {r["boat_id"]: r["position"] for r in results}
        assert pos == {"a": 2, "b": 1}


class TestA8Tiebreak:
    """A8.1 — counting race scores best-to-worst; excluded scores not used.
    A8.2 — last race backwards, excluded scores used."""

    def test_keys_are_built_correctly(self):
        entries = [{"points": 1.0}, {"points": 3.0}, {"points": 10.0}, {"points": 2.0}]
        a8_1, a8_2 = server._a8_tiebreak(entries, drop={2})
        assert a8_1 == [1.0, 2.0, 3.0]          # excluded 10 removed, best first
        assert a8_2 == [2.0, 10.0, 3.0, 1.0]    # last race first, excluded kept

    def test_boat_with_most_firsts_wins(self):
        # same net; A has two firsts, B has one first and a 4th
        a = (10.0, [1.0, 1.0, 8.0], [8.0, 1.0, 1.0])
        b = (10.0, [1.0, 4.0, 5.0], [5.0, 4.0, 1.0])
        assert a < b

    def test_dnc_heavy_boat_loses_tiebreak(self):
        # tied on net; C never finished (DNCs), D has real finishes
        c = (10.0, [10.0, 10.0, 10.0], [10.0, 10.0, 10.0])
        d = (10.0, [2.0, 2.0, 6.0], [6.0, 2.0, 2.0])
        assert d < c

    def test_a8_2_last_race_decides(self):
        # identical A8.1 lists -> most recent race (last entry) decides
        x = (10.0, [1.0, 4.0, 5.0], [5.0, 4.0, 1.0])
        y = (10.0, [1.0, 4.0, 5.0], [4.0, 5.0, 1.0])
        assert y < x  # y's last race was a 4th (better than x's 5th)


class TestStartAreaCount:
    def test_dnc_boats_excluded_from_start_area(self):
        results = [
            {"code": "DNC"}, {"code": "DNC"},
            {"code": "FINISHED", "position": 1},
            {"code": "DNF"},
            {"code": "DNS"},
        ]
        assert server._start_area_entries(results) == 3


class _Cursor:
    def __init__(self, items):
        self.items = items

    async def to_list(self, _n):
        return self.items


class _Coll:
    def __init__(self, items):
        self.items = items

    def find(self, *_a, **_k):
        return _Cursor(self.items)


def _standings(use_a5_3):
    """Compute series standings with the DB layer faked out.

    4 boats entered; race: b1 1st, b2 2nd, b3 DNS (came to the start area),
    b4 DNC (did not come). Start area = 3 boats.
    """
    import asyncio
    import types
    series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0,
              "use_a5_3": use_a5_3}
    boats = [{"id": f"b{i}", "name": f"Boat {i}", "sail_no": str(i),
              "helm": "H", "class_id": "c1", "year": 2026} for i in range(1, 5)]
    race = {
        "id": "r1", "series_id": "s1", "class_id": "c1", "year": 2026,
        "race_number": 1, "date": "2026-05-02", "status": "published",
        "entries_count": 4,
        "results": [
            {"boat_id": "b1", "code": "FINISHED", "position": 1,
             "finish_time": "2026-05-02T10:05:00Z", "penalty_points": 0},
            {"boat_id": "b2", "code": "FINISHED", "position": 2,
             "finish_time": "2026-05-02T10:06:00Z", "penalty_points": 0},
            {"boat_id": "b3", "code": "DNS", "position": None,
             "finish_time": None, "penalty_points": 0},
            {"boat_id": "b4", "code": "DNC", "position": None,
             "finish_time": None, "penalty_points": 0},
        ],
    }
    server.db = types.SimpleNamespace(races=_Coll([race]), boats=_Coll(boats))
    return asyncio.run(server.compute_series_standings(series))


class TestA53EndToEnd:
    """The A5.3 series flag must change how DNS (start-area codes) score."""

    def test_default_a5_2_dns_scores_series_entries_plus_1(self):
        st = _standings(False)
        assert st["use_a5_3"] is False
        by_id = {r["boat_id"]: r for r in st["standings"]}
        # 4 boats entered -> DNS and DNC both score 5 under the default A5.2
        assert by_id["b3"]["net"] == 5.0
        assert by_id["b4"]["net"] == 5.0

    def test_a5_3_dns_scores_start_area_plus_1(self):
        st = _standings(True)
        assert st["use_a5_3"] is True
        by_id = {r["boat_id"]: r for r in st["standings"]}
        # Start area = 3 (b1, b2, b3) -> DNS scores 4; DNC still 5
        assert by_id["b3"]["net"] == 4.0
        assert by_id["b4"]["net"] == 5.0


# ---------------------------------------------------------------------------
# IRC: corrected time (IRC Rule 12.2) and tie handling (RRS A3 + A7)
# ---------------------------------------------------------------------------

class TestIrcCorrectedTime:
    """IRC Rule 12.2: corrected = elapsed x TCC, rounded to nearest second,
    0.5 seconds rounding up."""

    START = "2026-05-02T10:00:00Z"

    def test_elapsed_times_tcc(self):
        # 1800 s elapsed x 1.015 -> 1827.0 -> 1827 s
        assert server._corrected_time_sec("2026-05-02T10:30:00Z", self.START, 1.015) == 1827

    def test_rounds_to_nearest_second_half_up(self):
        # 10 s elapsed x 1.05 = 10.5 -> rounds up to 11 (IRC 12.2, 0.5 up)
        assert server._corrected_time_sec("2026-05-02T10:00:10Z", self.START, 1.05) == 11
        # 10 s x 1.049 = 10.49 -> rounds down to 10
        assert server._corrected_time_sec("2026-05-02T10:00:10Z", self.START, 1.049) == 10
        # 10 s x 1.06 = 10.6 -> rounds up to 11
        assert server._corrected_time_sec("2026-05-02T10:00:10Z", self.START, 1.06) == 11

    def test_missing_start_or_tcc_returns_none(self):
        assert server._corrected_time_sec("2026-05-02T10:30:00Z", None, 1.015) is None
        assert server._corrected_time_sec("2026-05-02T10:30:00Z", self.START, None) is None
        assert server._corrected_time_sec(None, self.START, 1.015) is None


def _finished(bid, ft, tcc=None):
    return {"boat_id": bid, "code": "FINISHED", "finish_time": ft,
            "position": None, "penalty_points": 0, "tcc": tcc}


def _irc_positions(results, start, tccs):
    """Run the IRC re-sequencer and return {boat_id: position}."""
    import copy
    rs = copy.deepcopy(results)
    server._resequence_finished(rs, "irc", start, tccs)
    return {r["boat_id"]: r["position"] for r in rs if r["code"] == "FINISHED"}


class TestIrcResequence:
    """Finishing places under IRC are determined by corrected time (RRS A3)."""

    START = "2026-05-02T10:00:00Z"

    def test_orders_by_corrected_time_not_elapsed(self):
        # b1 finishes first but is slow-rated; b3 finishes last but fast-rated.
        results = [
            _finished("b1", "2026-05-02T10:30:00Z"),  # elapsed 1800
            _finished("b2", "2026-05-02T10:29:30Z"),  # elapsed 1770
            _finished("b3", "2026-05-02T10:20:00Z"),  # elapsed 1200
        ]
        tccs = {"b1": 1.100, "b2": 1.100, "b3": 0.850}
        pos = _irc_positions(results, self.START, tccs)
        # corrected: b3 1020, b2 1947, b1 1980 -> order b3, b2, b1
        assert pos["b3"] == 1 and pos["b2"] == 2 and pos["b1"] == 3

    def test_equal_corrected_time_shares_place_and_next_jumps(self):
        results = [
            _finished("b1", "2026-05-02T10:30:00Z"),   # 1800 x 1.000 = 1800
            _finished("b2", "2026-05-02T10:33:20Z"),   # 2000 x 0.900 = 1800
            _finished("b3", "2026-05-02T10:40:00Z"),   # 2400 x 1.000 = 2400
        ]
        tccs = {"b1": 1.000, "b2": 0.900, "b3": 1.000}
        pos = _irc_positions(results, self.START, tccs)
        # b1 and b2 tie for 1st; b3 is 3rd (place 2 is occupied by the tie)
        assert pos["b1"] == 1 and pos["b2"] == 1 and pos["b3"] == 3

    def test_missing_tcc_falls_back_after_computable(self):
        results = [
            _finished("b1", "2026-05-02T10:30:00Z"),  # has TCC
            _finished("b2", "2026-05-02T10:20:00Z"),  # no TCC
            _finished("b3", "2026-05-02T10:10:00Z"),  # no TCC
        ]
        tccs = {"b1": 1.000}
        pos = _irc_positions(results, self.START, tccs)
        # b1 computable -> 1st; b2/b3 fall back to finish time:
        # b3 (10:10) before b2 (10:20) -> 2nd, 3rd
        assert pos["b1"] == 1 and pos["b3"] == 2 and pos["b2"] == 3

    def test_no_start_time_falls_back_to_finish_order(self):
        results = [
            _finished("b1", "2026-05-02T10:30:00Z"),
            _finished("b2", "2026-05-02T10:20:00Z"),
        ]
        tccs = {"b1": 1.0, "b2": 0.5}
        pos = _irc_positions(results, None, tccs)
        assert pos["b1"] == 2 and pos["b2"] == 1  # plain finish-time order


class TestIrcA7EndToEnd:
    """Equal corrected times -> shared place -> RRS A7 splits the points."""

    def test_tied_corrected_time_splits_points(self):
        import asyncio
        import types
        start = "2026-05-02T10:00:00Z"
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0}
        boats = [
            {"id": "b1", "name": "A", "sail_no": "1", "helm": "H",
             "class_id": "c1", "year": 2026, "tcc": 1.000},
            {"id": "b2", "name": "B", "sail_no": "2", "helm": "H",
             "class_id": "c1", "year": 2026, "tcc": 0.900},
            {"id": "b3", "name": "C", "sail_no": "3", "helm": "H",
             "class_id": "c1", "year": 2026, "tcc": 1.000},
        ]
        results = [
            {"boat_id": "b1", "code": "FINISHED", "finish_time": "2026-05-02T10:30:00Z",
             "position": None, "penalty_points": 0},
            {"boat_id": "b2", "code": "FINISHED", "finish_time": "2026-05-02T10:33:20Z",
             "position": None, "penalty_points": 0},
            {"boat_id": "b3", "code": "FINISHED", "finish_time": "2026-05-02T10:40:00Z",
             "position": None, "penalty_points": 0},
        ]
        tccs = {b["id"]: b["tcc"] for b in boats}
        server._resequence_finished(results, "irc", start, tccs)
        race = {
            "id": "r1", "series_id": "s1", "class_id": "c1", "year": 2026,
            "race_number": 1, "date": "2026-05-02", "status": "published",
            "entries_count": 3, "results": results,
        }
        server.db = types.SimpleNamespace(races=_Coll([race]), boats=_Coll(boats))
        st = asyncio.run(server.compute_series_standings(series))
        by_id = {r["boat_id"]: r for r in st["standings"]}
        # b1/b2 tied on corrected time -> share 1st -> (1+2)/2 = 1.5 each
        assert by_id["b1"]["net"] == 1.5
        assert by_id["b2"]["net"] == 1.5
        # b3 is placed 3rd -> 3 points
        assert by_id["b3"]["net"] == 3.0


class TestElapsedCorrection:
    """Correcting a finish by entering the elapsed time (adjust-result flow)."""

    def test_finish_time_from_elapsed(self):
        ft = server._finish_time_from_elapsed("2026-05-02T10:00:00Z", 1800)
        assert server._elapsed_seconds(ft, "2026-05-02T10:00:00Z") == 1800

    def test_elapsed_roundtrip_whole_seconds(self):
        ft = server._finish_time_from_elapsed("2026-05-02T10:00:00Z", 1865.5)
        # 1865.5 s elapsed -> finish time carries sub-second precision
        assert server._elapsed_seconds(ft, "2026-05-02T10:00:00Z") == 1865.5

    def test_unparseable_start_returns_none(self):
        assert server._finish_time_from_elapsed("not-a-date", 100) is None
        assert server._finish_time_from_elapsed(None, 100) is None
