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


class TestFinishersOption:
    """RYA/Sailwave convention: non-finish codes score finishers + 1 (DNC
    still scores series entries + 1). Takes precedence over use_a5_3."""

    def test_dnc_still_series_plus_1(self):
        assert server.result_points(_res("DNC"), 6, 3, False, True, 2) == 7.0

    def test_non_finish_codes_score_finishers_plus_1(self):
        # 6 entered, 3 came to the start area, 2 finished -> DNF = 3.0
        for code in ("DNF", "RET", "DSQ", "OCS", "UFD", "DNS"):
            assert server.result_points(_res(code), 6, 3, False, True, 2) == 3.0, code

    def test_finishers_takes_precedence_over_a5_3(self):
        assert server.result_points(_res("DNF"), 6, 3, True, True, 2) == 3.0

    def test_finished_without_position_falls_back_to_finishers_plus_1(self):
        assert server.result_points(_res("FINISHED"), 6, 3, False, True, 2) == 3.0


def _standings(use_a5_3, use_finishers=False):
    """Compute series standings with the DB layer faked out.

    4 boats entered; race: b1 1st, b2 2nd, b3 DNS (came to the start area),
    b4 DNC (did not come). Start area = 3 boats, finishers = 2.
    """
    import asyncio
    import types
    series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0,
              "use_a5_3": use_a5_3, "use_finishers": use_finishers}
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


class TestFinishersEndToEnd:
    """The finishers+1 series flag must change how DNS (start-area codes)
    score, while DNC keeps the series total."""

    def test_dns_scores_finishers_plus_1_dnc_series_plus_1(self):
        st = _standings(False, True)
        assert st["use_finishers"] is True
        by_id = {r["boat_id"]: r for r in st["standings"]}
        # 2 boats finished -> DNS = 3; DNC = series (4) + 1 = 5
        assert by_id["b3"]["net"] == 3.0
        assert by_id["b4"]["net"] == 5.0


class TestFinishersLateSummerHandicap:
    """Reproduces the Bough Beech Late Summer PM Handicap: 6 entries, 4 races,
    1 discard. R9's DNF scores finishers + 1 (3.0) while DNC scores 7.0, and
    the nett totals match the Sailwave file exactly."""

    def _run(self):
        import asyncio
        import types
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 1,
                  "use_a5_3": False, "use_finishers": True}
        boats = [
            {"id": "b1", "name": "21003", "sail_no": "21003", "helm": "Rory Moppett / Sarah Seddon",
             "class_id": "c1", "year": 2026, "py": 1122, "boat_type": "2000"},
            {"id": "b2", "name": "32083", "sail_no": "32083", "helm": "Richard Smith / Peter Wolstenholme",
             "class_id": "c1", "year": 2026, "py": 1104, "boat_type": "SNIPE"},
            {"id": "b3", "name": "9611", "sail_no": "9611", "helm": "Peter Wolstenholme / Matt Wolstenholme",
             "class_id": "c1", "year": 2026, "py": 1104, "boat_type": "SNIPE"},
            {"id": "b4", "name": "28541", "sail_no": "28541", "helm": "Matthew Wolstenholme / Eiichi Higuchi",
             "class_id": "c1", "year": 2026, "py": 1104, "boat_type": "SNIPE"},
            {"id": "b5", "name": "29408", "sail_no": "29408", "helm": "John Reed / Emma Reed",
             "class_id": "c1", "year": 2026, "py": 1104, "boat_type": "SNIPE"},
            {"id": "b6", "name": "434", "sail_no": "434", "helm": "Leigh Clark",
             "class_id": "c1", "year": 2026, "py": 1112, "boat_type": "SOLUTION"},
        ]

        def fin(bid, pos=None, code="FINISHED"):
            return {"boat_id": bid, "code": code, "position": pos,
                    "finish_time": None, "penalty_points": 0}

        dnc = lambda bid: fin(bid, code="DNC")  # noqa: E731
        races = [
            {"id": "r7", "series_id": "s1", "class_id": "c1", "year": 2026, "race_number": 7,
             "date": "2026-07-19", "status": "published", "entries_count": 6,
             "results": [fin("b1", 3), fin("b2", 2), fin("b4", 1), fin("b5", 4), fin("b6", 5), dnc("b3")]},
            {"id": "r8", "series_id": "s1", "class_id": "c1", "year": 2026, "race_number": 8,
             "date": "2026-07-19", "status": "published", "entries_count": 6,
             "results": [dnc(b) for b in ("b1", "b2", "b3", "b4", "b5", "b6")]},
            {"id": "r9", "series_id": "s1", "class_id": "c1", "year": 2026, "race_number": 9,
             "date": "2026-07-26", "status": "published", "entries_count": 6,
             "results": [fin("b3", 1), fin("b1", 2), fin("b2", code="DNF"),
                          dnc("b4"), dnc("b5"), dnc("b6")]},
            {"id": "r10", "series_id": "s1", "class_id": "c1", "year": 2026, "race_number": 10,
             "date": "2026-07-26", "status": "published", "entries_count": 6,
             "results": [fin("b3", 1), fin("b1", 2), fin("b2", 3), dnc("b4"), dnc("b5"), dnc("b6")]},
        ]
        server.db = types.SimpleNamespace(races=_Coll(races), boats=_Coll(boats))
        st = asyncio.run(server.compute_series_standings(series))
        return {r["boat_id"]: r for r in st["standings"]}

    def test_nett_and_total_match_sailwave(self):
        by_id = self._run()
        assert by_id["b1"]["net"] == 7.0 and by_id["b1"]["total"] == 14.0
        assert by_id["b2"]["net"] == 8.0 and by_id["b2"]["total"] == 15.0
        assert by_id["b3"]["net"] == 9.0 and by_id["b3"]["total"] == 16.0
        assert by_id["b4"]["net"] == 15.0 and by_id["b4"]["total"] == 22.0
        assert by_id["b5"]["net"] == 18.0 and by_id["b5"]["total"] == 25.0
        assert by_id["b6"]["net"] == 19.0 and by_id["b6"]["total"] == 26.0

    def test_ranking_matches_sailwave(self):
        by_id = self._run()
        order = [r["boat_id"] for r in sorted(by_id.values(), key=lambda r: r["rank"])]
        assert order == ["b1", "b2", "b3", "b4", "b5", "b6"]

    def test_r9_dnf_scored_finishers_plus_1(self):
        by_id = self._run()
        # R9 has 2 finishers -> DNF = 3.0; the discard (7.0 DNC from R8) is dropped
        assert by_id["b2"]["scores"][2]["points"] == 3.0
        assert by_id["b2"]["scores"][2]["code"] == "DNF"
        assert by_id["b2"]["scores"][1]["discarded"] is True


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


# PY: Portsmouth Yardstick (corrected = elapsed x 1000 / PY)
# ---------------------------------------------------------------------------

class TestPyCorrectedTime:
    START = "2026-05-02T10:00:00Z"

    def test_elapsed_times_py(self):
        # 1800 s elapsed x 1000 / 1013 = 1776.9... -> 1777 s
        assert server._py_corrected_sec("2026-05-02T10:30:00Z", self.START, 1013) == 1777

    def test_lower_py_is_faster(self):
        # Same elapsed time, faster boat (lower PY) gets the smaller corrected
        # time.
        assert server._py_corrected_sec("2026-05-02T10:30:00Z", self.START, 1000) == 1800
        assert server._py_corrected_sec("2026-05-02T10:30:00Z", self.START, 1200) == 1500

    def test_rounds_half_up(self):
        # 10 s x 1000 / 800 = 12.5 -> rounds up to 13
        assert server._py_corrected_sec("2026-05-02T10:00:10Z", self.START, 800) == 13
        # 10 s x 1000 / 801 = 12.48... -> rounds down to 12
        assert server._py_corrected_sec("2026-05-02T10:00:10Z", self.START, 801) == 12

    def test_missing_start_or_py_returns_none(self):
        assert server._py_corrected_sec("2026-05-02T10:30:00Z", None, 1013) is None
        assert server._py_corrected_sec("2026-05-02T10:30:00Z", self.START, None) is None
        assert server._py_corrected_sec(None, self.START, 1013) is None


def _py_positions(results, start, pys):
    """Run the PY re-sequencer and return {boat_id: position}."""
    import copy
    rs = copy.deepcopy(results)
    server._resequence_finished(rs, "py", start, pys)
    return {r["boat_id"]: r["position"] for r in rs if r["code"] == "FINISHED"}


class TestPyResequence:
    """Finishing places under PY are determined by corrected time."""

    START = "2026-05-02T10:00:00Z"

    def test_orders_by_corrected_time_not_elapsed(self):
        results = [
            _finished("b1", "2026-05-02T10:30:00Z"),  # elapsed 1800
            _finished("b2", "2026-05-02T10:29:30Z"),  # elapsed 1770
            _finished("b3", "2026-05-02T10:20:00Z"),  # elapsed 1200
        ]
        pys = {"b1": 1100, "b2": 1100, "b3": 850}
        pos = _py_positions(results, self.START, pys)
        # corrected: b3 1412, b2 1609, b1 1636 -> order b3, b2, b1
        assert pos["b3"] == 1 and pos["b2"] == 2 and pos["b1"] == 3

    def test_equal_corrected_time_shares_place_and_next_jumps(self):
        results = [
            _finished("b1", "2026-05-02T10:30:00Z"),   # 1800 x 1000/1000 = 1800
            _finished("b2", "2026-05-02T10:36:00Z"),   # 2160 x 1000/1200 = 1800
            _finished("b3", "2026-05-02T10:40:00Z"),   # 2400 x 1000/1000 = 2400
        ]
        pys = {"b1": 1000, "b2": 1200, "b3": 1000}
        pos = _py_positions(results, self.START, pys)
        # b1 and b2 tie for 1st; b3 is 3rd (place 2 is occupied by the tie)
        assert pos["b1"] == 1 and pos["b2"] == 1 and pos["b3"] == 3

    def test_missing_py_falls_back_after_computable(self):
        results = [
            _finished("b1", "2026-05-02T10:30:00Z"),  # has PY
            _finished("b2", "2026-05-02T10:20:00Z"),  # no PY
            _finished("b3", "2026-05-02T10:10:00Z"),  # no PY
        ]
        pys = {"b1": 1000}
        pos = _py_positions(results, self.START, pys)
        assert pos["b1"] == 1 and pos["b3"] == 2 and pos["b2"] == 3

    def test_no_start_time_falls_back_to_finish_order(self):
        results = [
            _finished("b1", "2026-05-02T10:30:00Z"),
            _finished("b2", "2026-05-02T10:20:00Z"),
        ]
        pys = {"b1": 1000, "b2": 1200}
        pos = _py_positions(results, None, pys)
        assert pos["b1"] == 2 and pos["b2"] == 1  # plain finish-time order


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


class TestScheduledStartFallback:
    """_race_start_time: the gun first, then the race's own scheduled start
    (anchored to the officer's device UTC offset), then the class default."""

    RACE = {"date": "2026-08-21", "start_time": "22:00"}
    CLS = {"default_start_time": "10:30"}

    def test_gun_wins(self):
        r = {**self.RACE, "actual_start": "2026-08-21T21:00:00+00:00"}
        assert server._race_start_time(r, self.CLS) == "2026-08-21T21:00:00+00:00"

    def test_race_start_time_beats_class_default(self):
        assert server._race_start_time(self.RACE, self.CLS) == "2026-08-21T22:00:00+00:00"

    def test_class_default_when_race_has_none(self):
        assert server._race_start_time({"date": "2026-08-21"}, self.CLS) == "2026-08-21T10:30:00+00:00"

    def test_missing_date_or_start_returns_none(self):
        assert server._race_start_time({}) is None
        assert server._race_start_time({"date": "2026-08-21"}) is None

    def test_utc_offset_applied(self):
        r = {**self.RACE, "start_tz_offset_minutes": 60}
        assert server._race_start_time(r, self.CLS) == "2026-08-21T22:00:00+01:00"

    def test_negative_utc_offset_applied(self):
        r = {**self.RACE, "start_tz_offset_minutes": -240}
        assert server._race_start_time(r, self.CLS) == "2026-08-21T22:00:00-04:00"

    def test_offset_makes_device_finish_elapsed_positive(self):
        # Officer's device on BST: a scheduled 22:00 local start == 21:00Z.
        # A finish tapped at 21:06:30Z is a real 6m30s elapsed — previously the
        # offset-less anchor made it negative and the results showed "—".
        start = server._race_start_time({**self.RACE, "start_tz_offset_minutes": 60}, self.CLS)
        assert server._elapsed_seconds("2026-08-21T21:06:30+00:00", start) == 390
        assert server._py_corrected_sec("2026-08-21T21:06:30+00:00", start, 1104) == 353

    def test_finish_before_start_is_unknown_not_negative(self):
        # A stray tap recorded before the start must not produce a negative
        # elapsed that outranks every real finisher.
        start = server._race_start_time({**self.RACE, "start_tz_offset_minutes": 60}, self.CLS)
        assert server._elapsed_seconds("2026-08-21T10:31:06+00:00", start) is None
        assert server._py_corrected_sec("2026-08-21T10:31:06+00:00", start, 1104) is None

    def test_elapsed_ignores_offsets_in_epoch_terms(self):
        start = server._race_start_time({**self.RACE, "start_tz_offset_minutes": 60}, self.CLS)
        assert server._elapsed_seconds("2026-08-21T22:06:30+01:00", start) == 390


# ---------------------------------------------------------------------------
# Multi-club: slug generation, club-scoped tokens, access guards
# ---------------------------------------------------------------------------

class TestMultiClub:
    def test_slugify(self):
        assert server.slugify("Seafarers Sailing Club") == "seafarers-sailing-club"
        assert server.slugify("  A.P. & Co  ") == "a-p-co"
        assert server.slugify("!!!") == "club"
        assert server.slugify("Dragon") == "dragon"

    def test_token_carries_club_id(self):
        payload = server.jwt.decode(server.create_token("admin", "club-1"),
                                    server.JWT_SECRET, algorithms=["HS256"],
                                    issuer=server.JWT_ISSUER, audience=server.JWT_AUDIENCE)
        assert payload["role"] == "admin"
        assert payload["club_id"] == "club-1"

    def test_officer_and_admin_tokens_keep_their_club(self):
        payload = server.jwt.decode(server.create_token("officer", "club-b"),
                                    server.JWT_SECRET, algorithms=["HS256"],
                                    issuer=server.JWT_ISSUER, audience=server.JWT_AUDIENCE)
        assert payload["role"] == "officer"
        assert payload["club_id"] == "club-b"

    def test_ensure_club_allows_own_club_only(self):
        import pytest
        # Same club: no exception.
        server._ensure_club({"role": "admin", "club_id": "a"}, "a")
        # Another club: blocked.
        with pytest.raises(Exception):
            server._ensure_club({"role": "admin", "club_id": "a"}, "b")
        # A user without a club is blocked.
        with pytest.raises(Exception):
            server._ensure_club(None, "a")

    def test_club_public_strips_pins(self):
        club = {"id": "c1", "name": "X", "slug": "x",
                "officer_pin": "1234", "admin_pin": "5678"}
        pub = server._club_public(club)
        assert "officer_pin" not in pub and "admin_pin" not in pub
        assert pub["name"] == "X"


class TestLegacyTokenRevocation:
    """Tokens minted by the old shared-PIN login carry no user account. The
    legacy shared-PIN authentication scheme has been removed entirely, so ALL
    such tokens — officer, admin and webmaster — are rejected outright: there
    is no fallback mechanism, and no claim in a legacy token can grant access.
    """

    def _request(self, token):
        from fastapi import Request
        scope = {
            "type": "http", "method": "GET", "path": "/",
            "headers": [(b"authorization", b"Bearer " + token.encode())],
            "query_string": b"", "scheme": "http", "server": ("test", 80),
            "client": ("test", 1), "root_path": "", "state": {},
        }
        return Request(scope)

    def _legacy_token(self, role, club_id):
        import asyncio
        import jwt as pyjwt
        from datetime import datetime, timezone, timedelta
        return pyjwt.encode(
            {"role": role, "club_id": club_id, "type": "access",
             "exp": datetime.now(timezone.utc) + timedelta(days=1)},
            server.JWT_SECRET, algorithm="HS256")

    def test_legacy_webmaster_token_rejected(self):
        import asyncio
        user = asyncio.run(server.get_current_user(self._request(self._legacy_token("webmaster", None))))
        assert user is None

    def test_legacy_admin_token_rejected(self):
        import asyncio
        user = asyncio.run(server.get_current_user(self._request(self._legacy_token("admin", "club-a"))))
        assert user is None

    def test_legacy_officer_token_rejected(self):
        import asyncio
        user = asyncio.run(server.get_current_user(self._request(self._legacy_token("officer", "club-a"))))
        assert user is None

    def test_garbage_token_rejected(self):
        import asyncio
        user = asyncio.run(server.get_current_user(self._request("not.a.token")))
        assert user is None


class TestMiniSeries:
    """A long series split into named mini series: each group picks which
    races it contains and has its own discard count, while the full series
    keeps its own standings and discards."""

    def _run(self, race_numbers=None, discards=None):
        import asyncio
        import types
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": 0,
                  "use_a5_3": False, "use_finishers": False,
                  "mini_series": True,
                  "mini_series_groups": [
                      {"name": "Spring", "race_numbers": [1, 2], "discards": 1},
                      {"name": "Autumn", "race_numbers": [5, 6], "discards": 0},
                  ]}
        boats = [{"id": f"b{i}", "name": f"Boat {i}", "sail_no": str(i),
                  "helm": "H", "class_id": "c1", "year": 2026} for i in range(1, 4)]

        def fin(bid, pos):
            return {"boat_id": bid, "code": "FINISHED", "position": pos,
                    "finish_time": None, "penalty_points": 0}

        def dnc(bid):
            return {"boat_id": bid, "code": "DNC", "position": None,
                    "finish_time": None, "penalty_points": 0}

        # 6 races: races 1-2 b1 dominant, 3-4 b2 dominant, 5-6 b3 dominant.
        plan = [("b1", "b2", "b3"), ("b1", "b2", "b3"),
                ("b2", "b1", "b3"), ("b2", "b1", "b3"),
                ("b3", "b1", "b2"), ("b3", "b1", "b2")]
        races = []
        for rn, (w, s, third) in enumerate(plan, start=1):
            races.append({
                "id": f"r{rn}", "series_id": "s1", "class_id": "c1", "year": 2026,
                "race_number": rn, "date": f"2026-05-{rn:02d}", "status": "published",
                "entries_count": 3,
                "results": [fin(w, 1), fin(s, 2), dnc(third)],
            })
        server.db = types.SimpleNamespace(races=_Coll(races), boats=_Coll(boats))
        return asyncio.run(server.compute_series_standings(series, race_numbers=race_numbers,
                                                           discards=discards))

    def test_groups_layout(self):
        st = self._run()
        assert st["race_count"] == 6
        # Full series keeps its own discards (0), not any group's discards.
        assert st["discards"] == 0
        assert st["mini_series"]["enabled"] is True
        assert st["mini_series"]["groups"] == [
            {"name": "Spring", "race_numbers": [1, 2], "discards": 1, "scoring": "additional", "race_count": 2},
            {"name": "Autumn", "race_numbers": [5, 6], "discards": 0, "scoring": "additional", "race_count": 2},
        ]

    def test_group_uses_only_its_races_and_its_own_discards(self):
        st = self._run(race_numbers=[1, 2], discards=1)  # Spring group
        assert st["race_count"] == 2
        assert st["discards"] == 1
        assert st["configured_discards"] == 1
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert len(by_id) == 3
        assert all(len(r["scores"]) == 2 for r in st["standings"])
        # b1 won both Spring races; with 1 discard the net is the best race (1).
        # b3 DNC'd both (4 + 4, discard one -> 4).
        assert by_id["b1"]["rank"] == 1 and by_id["b1"]["net"] == 1.0
        assert by_id["b3"]["net"] == 4.0

    def test_group_race_selection_is_explicit(self):
        # Only race 3 (of b2's 3-4 run) selected -> b2 wins with a single 1.0.
        st = self._run(race_numbers=[3], discards=0)
        assert st["race_count"] == 1
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b2"]["rank"] == 1 and by_id["b2"]["net"] == 1.0

    def test_normalize_mini_groups(self):
        races = [{"race_number": 1}, {"race_number": 2}, {"race_number": 3},
                 {"race_number": 4}, {"race_number": 5}, {"race_number": 6}]
        series = {"mini_series": True, "mini_series_groups": [
            {"name": "First half", "race_numbers": [1, 2, 3], "discards": 1},
            {"name": "", "race_numbers": [4, 5, 6]},
        ]}
        groups = server._normalize_mini_groups(series, races)
        assert groups == [
            {"name": "First half", "race_numbers": [1, 2, 3], "discards": 1, "scoring": "additional", "race_count": 3},
            {"name": "Mini 2", "race_numbers": [4, 5, 6], "discards": 0, "scoring": "additional", "race_count": 3},
        ]
        # A group can opt into the combined daily-result treatment.
        groups3 = server._normalize_mini_groups({"mini_series": True, "mini_series_groups": [
            {"name": "Day", "race_numbers": [2, 3], "scoring": "combined"}]}, races)
        assert groups3[0]["scoring"] == "combined"
        # A group referencing races that have not been published reports 0.
        groups2 = server._normalize_mini_groups({"mini_series": True, "mini_series_groups": [
            {"name": "Later", "race_numbers": [9, 10]}]}, races)
        assert groups2[0]["race_count"] == 0
        # Legacy stored shape (mini_series_size) falls back to consecutive chunks.
        legacy = server._normalize_mini_groups(
            {"mini_series": True, "mini_series_size": 2, "mini_series_discards": 1}, races)
        assert [g["name"] for g in legacy] == ["Mini 1", "Mini 2", "Mini 3"]
        assert legacy[0]["race_numbers"] == [1, 2] and legacy[0]["discards"] == 1

    def test_group_race_numbers_are_deduplicated_and_sorted(self):
        groups = server._normalize_mini_groups({"mini_series": True, "mini_series_groups": [
            {"name": "Mix", "race_numbers": [3, 1, 3, 0, -2]}]},
            [{"race_number": 1}, {"race_number": 3}])
        assert groups[0]["race_numbers"] == [1, 3]
        assert groups[0]["race_count"] == 2


class TestMiniSeriesCombined:
    """Mini-series scoring treatment: "additional" (each mini race counts
    individually in the main series) vs "combined" (the mini races aggregate
    into ONE daily result — group discards first, then the average of the
    counting races becomes a single main-series score)."""

    def _series(self, groups, discards=0):
        return {"id": "s1", "class_id": "c1", "year": 2026, "discards": discards,
                "use_a5_3": False, "use_finishers": False,
                "mini_series": True, "mini_series_groups": groups}

    def _run(self, groups, races, discards=0, race_numbers=None, group_discards=None):
        import asyncio
        import types
        series = self._series(groups, discards)
        boats = [{"id": f"b{i}", "name": f"Boat {i}", "sail_no": str(i),
                  "helm": "H", "class_id": "c1", "year": 2026} for i in range(1, 4)]
        server.db = types.SimpleNamespace(races=_Coll(races), boats=_Coll(boats))
        return asyncio.run(server.compute_series_standings(
            series, race_numbers=race_numbers, discards=group_discards))

    def _race(self, rn, results, entries=None, date=None):
        return {"id": f"r{rn}", "series_id": "s1", "class_id": "c1", "year": 2026,
                "race_number": rn, "date": date or f"2026-05-{rn:02d}", "status": "published",
                "entries_count": entries or len(results), "results": results}

    def _res(self, bid, code, pos=None):
        return {"boat_id": bid, "code": code, "position": pos,
                "finish_time": None, "penalty_points": 0}

    # 5-race series: race 3 is a normal race, races 2-4 form the "Day" mini
    # series. b1 sails everything; b2 and b3 vary per test (absent = DNC).
    def _five_races(self, b1_positions, extra=None):
        # extra: race_number -> list of extra result dicts to append
        races = []
        for rn, pos in enumerate(b1_positions, start=1):
            results = [self._res("b1", "FINISHED", pos)]
            results += (extra or {}).get(rn, [])
            races.append(self._race(rn, results))
        return races

    def test_additional_mode_counts_each_mini_race_individually(self):
        # Mode A: mini races are individual main-series races, discardable
        # separately under the main series' discard rules.
        races = self._five_races([1, 2, 5, 9, 3])
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1,
                   "scoring": "additional"}]
        st = self._run(groups, races, discards=1)
        assert st["race_count"] == 5
        by_id = {r["boat_id"]: r for r in st["standings"]}
        scores = by_id["b1"]["scores"]
        assert [s["code"] for s in scores] == ["FINISHED"] * 5
        # the mini races appear individually and the worst one (9) is discarded
        assert scores[3]["points"] == 9.0 and scores[3]["discarded"] is True
        assert by_id["b1"]["net"] == 1 + 2 + 5 + 3

    def test_combined_mode_folds_group_into_single_daily_result(self):
        # Mode B (the canonical example): 2, 5, 9 with 1 discard -> discard 9
        # -> (2 + 5) / 2 = 3.5, ONE score in the main series.
        races = self._five_races([1, 2, 5, 9, 3])
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1,
                   "scoring": "combined"}]
        st = self._run(groups, races)
        assert st["race_count"] == 3
        by_id = {r["boat_id"]: r for r in st["standings"]}
        scores = by_id["b1"]["scores"]
        assert [(s["code"], s["points"]) for s in scores] == \
            [("FINISHED", 1.0), ("MINI", 3.5), ("FINISHED", 3.0)]
        assert by_id["b1"]["net"] == 7.5
        # the underlying mini races must NOT appear as extra main-series races
        assert len(scores) == 3
        # the combined unit's meta names the mini series
        combined_meta = st["races"][1]
        assert combined_meta["combined"] is True and combined_meta["mini_name"] == "Day"

    def test_combined_average_is_average_not_sum(self):
        # 2 + 5 + 9 = 16 summed, but the daily result is the AVERAGE 3.5.
        races = self._five_races([1, 2, 5, 9, 3])
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1,
                   "scoring": "combined"}]
        st = self._run(groups, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b1"]["scores"][1]["points"] == 3.5
        assert by_id["b1"]["total"] == 7.5  # 1 + 3.5 + 3, not 1 + 7 + 3

    def test_combined_with_two_races(self):
        # Smallest meaningful mini series: two races, one discard -> the worse
        # race drops and the remaining one is the day's result.
        races = self._five_races([1, 2, 5, 3, 4])
        groups = [{"name": "Sprint", "race_numbers": [2, 3], "discards": 1,
                   "scoring": "combined"}]
        st = self._run(groups, races)
        assert st["race_count"] == 4
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b1"]["scores"][1]["code"] == "MINI" and by_id["b1"]["scores"][1]["points"] == 2.0
        assert by_id["b1"]["net"] == 10.0  # 1 + 2 + 3 + 4

    def test_combined_with_all_races_counting(self):
        # No group discards: the daily result averages every mini race.
        races = self._five_races([1, 2, 4, 6, 3])
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 0,
                   "scoring": "combined"}]
        st = self._run(groups, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b1"]["scores"][1]["points"] == 4.0  # (2 + 4 + 6) / 3
        assert by_id["b1"]["net"] == 8.0

    def test_combined_with_multiple_discards(self):
        # Two group discards: 2, 5, 9 -> drop 9 and 5 -> average = 2.0.
        races = self._five_races([1, 2, 5, 9, 3])
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 2,
                   "scoring": "combined"}]
        st = self._run(groups, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b1"]["scores"][1]["points"] == 2.0
        assert by_id["b1"]["net"] == 6.0  # 1 + 2 + 3

    def test_combined_containing_dnc(self):
        # 2, DNC(4), 9 with 1 discard -> the DNC is a real score (4) and 9 is
        # the worst -> (2 + 4) / 2 = 3.0.
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1)], entries=3),
            self._race(2, [self._res("b1", "FINISHED", 2), self._res("b2", "FINISHED", 1)], entries=3),
            self._race(3, [self._res("b1", "DNC"), self._res("b2", "FINISHED", 1)], entries=3),
            self._race(4, [self._res("b1", "FINISHED", 9), self._res("b2", "FINISHED", 1)], entries=3),
            self._race(5, [self._res("b1", "FINISHED", 3)], entries=3),
        ]
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1,
                   "scoring": "combined"}]
        st = self._run(groups, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b1"]["scores"][1]["points"] == 3.0

    def test_combined_containing_dns_and_dsq(self):
        # 2, DNS(4), DSQ(4), 1 discard -> drop one of the 4s -> (2 + 4) / 2 = 3.
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1)], entries=3),
            self._race(2, [self._res("b1", "FINISHED", 2), self._res("b2", "FINISHED", 1)], entries=3),
            self._race(3, [self._res("b1", "DNS"), self._res("b2", "FINISHED", 1)], entries=3),
            self._race(4, [self._res("b1", "DSQ"), self._res("b2", "FINISHED", 1)], entries=3),
            self._race(5, [self._res("b1", "FINISHED", 4)], entries=3),
        ]
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1,
                   "scoring": "combined"}]
        st = self._run(groups, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b1"]["scores"][1]["code"] == "MINI"
        assert by_id["b1"]["scores"][1]["points"] == 3.0

    def test_sailor_misses_one_mini_race(self):
        # b2 is absent from race 3 (DNC = 4 with 3 boats): 5, DNC(4), 9,
        # 1 discard -> 9 dropped -> (5 + 4) / 2 = 4.5.
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1)], entries=3),
            self._race(2, [self._res("b1", "FINISHED", 2), self._res("b2", "FINISHED", 5), self._res("b3", "DNC")], entries=3),
            self._race(3, [self._res("b1", "FINISHED", 5), self._res("b3", "DNC")], entries=3),
            self._race(4, [self._res("b1", "FINISHED", 9), self._res("b2", "FINISHED", 9), self._res("b3", "DNC")], entries=3),
            self._race(5, [self._res("b1", "FINISHED", 3), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")], entries=3),
        ]
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1,
                   "scoring": "combined"}]
        st = self._run(groups, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b2"]["scores"][1]["code"] == "MINI"
        assert by_id["b2"]["scores"][1]["points"] == 4.5

    def test_sailor_misses_entire_mini_series(self):
        # b3 DNCs every mini race (4 each, 3 boats) -> 1 discard -> average
        # 4.0; the combined day is still a single score in the main series.
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b3", "DNC")], entries=3),
            self._race(2, [self._res("b1", "FINISHED", 2), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")], entries=3),
            self._race(3, [self._res("b1", "FINISHED", 5), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")], entries=3),
            self._race(4, [self._res("b1", "FINISHED", 9), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")], entries=3),
            self._race(5, [self._res("b1", "FINISHED", 3), self._res("b3", "DNC")], entries=3),
        ]
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1,
                   "scoring": "combined"}]
        st = self._run(groups, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        scores = by_id["b3"]["scores"]
        assert len(scores) == 3 and scores[1]["code"] == "MINI" and scores[1]["points"] == 4.0
        assert by_id["b3"]["net"] == 12.0  # DNC(4) + day(4) + DNC(4)

    def test_different_entries_between_mini_races(self):
        # Each mini race has its own fleet size, so its DNC scores differ:
        # race 2: 4 boats -> DNC 5; race 3: 5 boats -> DNC 6; race 4: 6 boats
        # -> DNC 7. b2 misses all three -> 1 discard -> (5 + 6) / 2 = 5.5.
        races = self._five_races([1, 2, 5, 9, 3], extra={5: [self._res("b2", "FINISHED", 1)]})
        races[1] = self._race(2, [self._res("b1", "FINISHED", 2), self._res("b2", "DNC")], entries=4)
        races[2] = self._race(3, [self._res("b1", "FINISHED", 5), self._res("b2", "DNC")], entries=5)
        races[3] = self._race(4, [self._res("b1", "FINISHED", 9), self._res("b2", "DNC")], entries=6)
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1,
                   "scoring": "combined"}]
        st = self._run(groups, races)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        assert by_id["b2"]["scores"][1]["points"] == 5.5

    def test_multiple_mini_series_in_one_main_series(self):
        # Two combined groups + one normal race: each group folds independently
        # and the units stay in chronological order.
        races = self._five_races([1, 2, 3, 4, 8])
        groups = [
            {"name": "Morning", "race_numbers": [1, 2], "discards": 0, "scoring": "combined"},
            {"name": "Afternoon", "race_numbers": [4, 5], "discards": 1, "scoring": "combined"},
        ]
        st = self._run(groups, races)
        assert st["race_count"] == 3
        by_id = {r["boat_id"]: r for r in st["standings"]}
        scores = by_id["b1"]["scores"]
        assert [(s["code"], s["points"]) for s in scores] == \
            [("MINI", 1.5), ("FINISHED", 3.0), ("MINI", 4.0)]  # (1+2)/2, 3, (4+8)/2 w/ discard
        assert by_id["b1"]["net"] == 8.5
        assert [m.get("mini_name") for m in st["races"]] == ["Morning", None, "Afternoon"]

    def test_combined_day_discardable_by_main_series(self):
        # The folded day is one discardable unit: the main series discards it
        # when it is the worst result.
        races = self._five_races([1, 2, 5, 9, 2])
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1,
                   "scoring": "combined"}]
        st = self._run(groups, races, discards=1)
        by_id = {r["boat_id"]: r for r in st["standings"]}
        scores = by_id["b1"]["scores"]
        assert scores[1]["code"] == "MINI" and scores[1]["points"] == 3.5
        # worst unit (3.5 > 1 and 3.5 > 2) is discarded
        assert scores[1]["discarded"] is True
        assert by_id["b1"]["net"] == 3.0  # 1 + 2

    def test_combined_mini_view_reports_daily_average(self):
        # The detailed mini view still shows the individual races, marks the
        # group-discarded race, and reports the daily average per boat.
        races = self._five_races([1, 2, 5, 9, 3])
        groups = [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1,
                   "scoring": "combined"}]
        st = self._run(groups, races, race_numbers=[2, 3, 4], group_discards=1)
        assert st["race_count"] == 3 and st["mini_combined"]["name"] == "Day"
        by_id = {r["boat_id"]: r for r in st["standings"]}
        row = by_id["b1"]
        # individual races shown, the worst (9) marked discarded
        assert [(s["code"], s["points"]) for s in row["scores"]] == \
            [("FINISHED", 2.0), ("FINISHED", 5.0), ("FINISHED", 9.0)]
        assert row["scores"][2]["discarded"] is True
        # the daily average that feeds the main series
        assert row["combined_average"] == 3.5

    def test_changing_treatment_recalculates_the_series(self):
        # Same races, same group — only the treatment differs: the combined
        # series scores the day as one result and must NOT match the
        # additional-mode result.
        races = self._five_races([1, 2, 5, 9, 3])
        additional = self._run(
            [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1, "scoring": "additional"}],
            races)
        combined = self._run(
            [{"name": "Day", "race_numbers": [2, 3, 4], "discards": 1, "scoring": "combined"}],
            races)
        a = {r["boat_id"]: r for r in additional["standings"]}
        c = {r["boat_id"]: r for r in combined["standings"]}
        assert additional["race_count"] == 5 and combined["race_count"] == 3
        assert a["b1"]["net"] == 20.0  # 1 + 2 + 5 + 9 + 3
        assert c["b1"]["net"] == 7.5   # 1 + 3.5 + 3
        assert a["b1"]["net"] != c["b1"]["net"]

    def test_combined_group_on_different_days(self):
        # Races sort by (date, race_number), so the group's races (10th-12th)
        # sit after races 1 and 5. The combined unit carries the group's first
        # race's date and is placed where the group sits chronologically.
        races = self._five_races([1, 2, 5, 9, 3])
        races[1]["date"] = "2026-05-10"
        races[2]["date"] = "2026-05-11"
        races[3]["date"] = "2026-05-12"
        groups = [{"name": "May Day", "race_numbers": [2, 3, 4], "discards": 1,
                   "scoring": "combined"}]
        st = self._run(groups, races)
        meta = st["races"]
        # order: r1 (05-01), r5 (05-05), then the combined group
        assert [m.get("race_number") for m in meta] == [1, 5, None]
        assert meta[2]["combined"] is True and meta[2]["date"] == "2026-05-10"
        assert meta[2]["mini_races"] == 3 and meta[2]["mini_name"] == "May Day"


class TestDutyPoints:
    """OOD (Officer of the Day) duty races score the boat's own average of
    its scores across EVERY race in the series before discards — DNC (and
    every other scoring code) included, at its existing numerical value.
    Only other duty races are excluded from the average."""

    def _run(self, races, use_a5_3=False, discards=0):
        import asyncio
        import types
        series = {"id": "s1", "class_id": "c1", "year": 2026, "discards": discards,
                  "use_a5_3": use_a5_3, "use_finishers": False}
        boats = [{"id": f"b{i}", "name": f"Boat {i}", "sail_no": str(i),
                  "helm": "H", "class_id": "c1", "year": 2026} for i in range(1, 4)]
        server.db = types.SimpleNamespace(races=_Coll(races), boats=_Coll(boats))
        st = asyncio.run(server.compute_series_standings(series))
        return {r["boat_id"]: r for r in st["standings"]}

    def _race(self, rn, results):
        return {"id": f"r{rn}", "series_id": "s1", "class_id": "c1", "year": 2026,
                "race_number": rn, "date": f"2026-05-{rn:02d}", "status": "published",
                "entries_count": 3, "results": results}

    def _res(self, bid, code, pos=None):
        return {"boat_id": bid, "code": code, "position": pos,
                "finish_time": None, "penalty_points": 0}

    def test_ood_scores_average_of_own_races_with_no_dnc(self):
        # b1: 1st, 2nd, then OOD (no DNC for b1) -> OOD = (1 + 2) / 2 = 1.5
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "FINISHED", 2), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(3, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races)
        scores = by_id["b1"]["scores"]
        assert [(s["code"], s["points"]) for s in scores] == [("FINISHED", 1.0), ("FINISHED", 2.0), ("OOD", 1.5)]
        # OOD is discardable like any other scored race
        assert scores[2]["discarded"] is False and scores[2]["points"] == 1.5

    def test_ood_includes_dnc_in_the_average(self):
        # b1: 1st, DNC, OOD -> the DNC scores series entries + 1 = 4 (3 boats)
        # and MUST feed the average: OOD = (1 + 4) / 2 = 2.5
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "DNC"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(3, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races)
        ood_score = by_id["b1"]["scores"][2]
        assert ood_score["code"] == "OOD" and ood_score["points"] == 2.5

    def test_ood_with_multiple_dncs(self):
        # b1: 1st, DNC, OOD, DNC -> OOD = (1 + 4 + 4) / 3 = 3.0
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "DNC"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(3, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(4, [self._res("b1", "DNC"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races)
        assert by_id["b1"]["scores"][2]["code"] == "OOD" and by_id["b1"]["scores"][2]["points"] == 3.0

    def test_ood_average_uses_complete_pre_discard_series(self):
        # The canonical case: every race counts, DNC converted to its existing
        # numerical score, nothing removed before the average.
        # b1: 3, 5, DNC, 8, 10, 12 -> DNC = 4 -> OOD = (3+5+4+8+10+12) / 6 = 7.0
        races = [
            self._race(1, [self._res("b1", "FINISHED", 3), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "FINISHED", 5), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(3, [self._res("b1", "DNC"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(4, [self._res("b1", "FINISHED", 8), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(5, [self._res("b1", "FINISHED", 10), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(6, [self._res("b1", "FINISHED", 12), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(7, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races)
        scores = by_id["b1"]["scores"]
        assert len(scores) == 7 and scores[6]["code"] == "OOD" and scores[6]["points"] == 7.0
        # no race was removed for the average: the DNC and all six results are
        # still in the series, and none is flagged discarded (discards = 0)
        assert [s["discarded"] for s in scores] == [False] * 7
        assert scores[2]["code"] == "DNC" and scores[2]["points"] == 4.0

    def test_ood_with_only_dnc_and_duty_scores_dnc_value(self):
        # b3 never sails: only DNC + OOD -> the DNC (series entries + 1 = 4)
        # feeds the average, so OOD = 4.0 — duty never scores better than DNC
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "OOD")]),
        ]
        by_id = self._run(races)
        assert by_id["b3"]["scores"][1]["code"] == "OOD" and by_id["b3"]["scores"][1]["points"] == 4.0

    def test_ood_falls_back_to_dnc_score_when_every_race_is_duty(self):
        # b1 is on duty every race -> no non-duty races to average -> each OOD
        # falls back to that race's DNC score (series entries + 1 = 4)
        races = [
            self._race(1, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races)
        assert [(s["code"], s["points"]) for s in by_id["b1"]["scores"]] == [("OOD", 4.0), ("OOD", 4.0)]

    def test_ood_in_one_race_series(self):
        # smallest possible series: a single race, the boat on duty -> DNC score
        races = [
            self._race(1, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races)
        assert by_id["b1"]["scores"][0]["code"] == "OOD" and by_id["b1"]["scores"][0]["points"] == 4.0

    def test_multiple_oods_do_not_average_each_other(self):
        # b1: 1st, OOD, OOD -> both OODs average the non-duty races only = [1]
        # (each OOD cannot average itself) -> 1.0
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(3, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races)
        assert [(s["code"], s["points"]) for s in by_id["b1"]["scores"]] == [
            ("FINISHED", 1.0), ("OOD", 1.0), ("OOD", 1.0)]

    def test_ood_not_counted_as_start_area_under_a5_3(self):
        # r3: b1 OOD, b2 finished, b3 DNS. Start area = b2 + b3 = 2 (b1 on duty
        # is NOT on the line) -> DNS scores start-area + 1 = 3, not 4.
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNS")]),
            self._race(2, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNS")]),
            self._race(3, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNS")]),
        ]
        by_id = self._run(races, use_a5_3=True)
        assert by_id["b3"]["scores"][2]["points"] == 3.0

    def test_ood_average_keeps_precision_to_two_decimals(self):
        # Directly on the helper: avg of 1, 1, 2 = 1.3333 -> 1.33 (the standings
        # display rounds to one decimal later, like every other score).
        agg = {"b1": [{"code": "FINISHED", "points": 1.0},
                      {"code": "FINISHED", "points": 1.0},
                      {"code": "FINISHED", "points": 2.0},
                      {"code": "OOD", "points": 99.0}]}
        server._apply_duty_points(agg, [3, 3, 3, 3])
        assert agg["b1"][3]["points"] == 1.33
        # a boat whose only non-duty race is a DNC scores the DNC value — the
        # DNC feeds the average (4.0), it is not skipped
        agg2 = {"b2": [{"code": "DNC", "points": 4.0}, {"code": "OOD", "points": 99.0}]}
        server._apply_duty_points(agg2, [3, 3])
        assert agg2["b2"][1]["points"] == 4.0
        # a boat on duty every race has nothing to average -> falls back to
        # that race's DNC score (entries + 1)
        agg3 = {"b3": [{"code": "OOD", "points": 99.0}, {"code": "OOD", "points": 99.0}]}
        server._apply_duty_points(agg3, [3, 3])
        assert [e["points"] for e in agg3["b3"]] == [4.0, 4.0]

    def test_ood_dnc_is_discarded_from_net_but_still_counts_in_average(self):
        # b1: 1st, 2nd, DNC, OOD with 1 discard. The DNC (4) feeds the OOD
        # average: OOD = (1 + 2 + 4) / 3 = 2.33. The DNC is the worst race and
        # is then discarded from the net: net = 1 + 2 + 2.33 = 5.33.
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "FINISHED", 2), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(3, [self._res("b1", "DNC"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(4, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races, discards=1)
        scores = by_id["b1"]["scores"]
        assert scores[2]["code"] == "DNC" and scores[2]["discarded"] is True
        assert scores[3]["code"] == "OOD" and scores[3]["points"] == 2.3
        assert by_id["b1"]["net"] == 5.3

    def test_ood_worst_sailed_race_discarded(self):
        # b1: 1st, 5th, OOD with 1 discard (no DNCs) -> OOD = 3.0; the 5th is
        # the worst race and is discarded: net = 1 + 3 = 4.
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "FINISHED", 5), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(3, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races, discards=1)
        scores = by_id["b1"]["scores"]
        assert scores[1]["discarded"] is True and scores[2]["code"] == "OOD"
        assert scores[2]["points"] == 3.0 and by_id["b1"]["net"] == 4.0

    def test_ood_multiple_discards(self):
        # b1: 1st, 3rd, DNC, OOD, DNC with 2 discards -> OOD = (1+3+4+4)/4 = 3.0;
        # both DNCs are discarded: net = 1 + 3 + 3 = 7.
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "FINISHED", 3), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(3, [self._res("b1", "DNC"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(4, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(5, [self._res("b1", "DNC"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races, discards=2)
        scores = by_id["b1"]["scores"]
        assert [s["discarded"] for s in scores] == [False, False, True, False, True]
        assert scores[3]["code"] == "OOD" and scores[3]["points"] == 3.0
        assert by_id["b1"]["net"] == 7.0

    def test_ood_early_in_series(self):
        # duty on race 1: the OOD average is computed over the WHOLE series
        # (races 2-3), not just the races after the duty
        # b1: OOD, 1st, 2nd -> OOD = (1 + 2) / 2 = 1.5
        races = [
            self._race(1, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")]),
            self._race(3, [self._res("b1", "FINISHED", 2), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races)
        assert by_id["b1"]["scores"][0]["code"] == "OOD" and by_id["b1"]["scores"][0]["points"] == 1.5

    def test_ood_late_in_series_with_dnc(self):
        # b1: 1st, DNC, 2nd, OOD -> OOD = (1 + 4 + 2) / 3 = 2.33
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "DNC"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(3, [self._res("b1", "FINISHED", 2), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(4, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races)
        ood_score = by_id["b1"]["scores"][3]
        assert ood_score["code"] == "OOD" and ood_score["points"] == 2.3

    def test_multiple_ood_sailors(self):
        # b2 and b3 each do one duty; every boat sails the other two races
        # b2: 2nd, OOD, 3rd -> OOD = (2 + 3) / 2 = 2.5
        # b3: OOD, 2nd, 1st -> OOD = (2 + 1) / 2 = 1.5
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "OOD")]),
            self._race(2, [self._res("b1", "FINISHED", 3), self._res("b2", "OOD"), self._res("b3", "FINISHED", 2)]),
            self._race(3, [self._res("b1", "FINISHED", 2), self._res("b2", "FINISHED", 3), self._res("b3", "FINISHED", 1)]),
        ]
        by_id = self._run(races)
        assert by_id["b2"]["scores"][1]["code"] == "OOD" and by_id["b2"]["scores"][1]["points"] == 2.5
        assert by_id["b3"]["scores"][0]["code"] == "OOD" and by_id["b3"]["scores"][0]["points"] == 1.5

    def test_ood_with_other_scoring_codes(self):
        # b1: 1st, DNF, RET, DSQ, DNC, OOD. Under A5.2 every non-finish scores
        # series entries + 1 = 4 -> OOD = (1 + 4 + 4 + 4 + 4) / 5 = 3.4
        races = [
            self._race(1, [self._res("b1", "FINISHED", 1), self._res("b2", "FINISHED", 2), self._res("b3", "DNC")]),
            self._race(2, [self._res("b1", "DNF"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(3, [self._res("b1", "RET"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(4, [self._res("b1", "DSQ"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(5, [self._res("b1", "DNC"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
            self._race(6, [self._res("b1", "OOD"), self._res("b2", "FINISHED", 1), self._res("b3", "DNC")]),
        ]
        by_id = self._run(races)
        ood_score = by_id["b1"]["scores"][5]
        assert ood_score["code"] == "OOD" and ood_score["points"] == 3.4

    def test_non_mini_series_has_no_metadata(self):
        import asyncio
        import types
        series = {"id": "s2", "class_id": "c1", "year": 2026, "discards": 0}
        boats = [{"id": "b1", "name": "Boat 1", "sail_no": "1", "helm": "H",
                  "class_id": "c1", "year": 2026}]
        race = {"id": "r1", "series_id": "s2", "class_id": "c1", "year": 2026,
                "race_number": 1, "date": "2026-05-01", "status": "published",
                "entries_count": 1, "results": []}
        server.db = types.SimpleNamespace(races=_Coll([race]), boats=_Coll(boats))
        st = asyncio.run(server.compute_series_standings(series))
        assert st["mini_series"] is None
