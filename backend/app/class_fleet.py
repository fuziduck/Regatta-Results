"""Which classes are single one-design fleets.

A class is one fleet under one scoring system — and may share its cross-club
public class page — when it fields no rating divisions and none of its series
is scored under a handicap system. Scoring is owned by the series, so the
class's legacy ``scoring_mode`` (now only the default a new series starts
from) must not decide this: an IRC class left on the old one-design default
is still an IRC fleet, and a class with no series yet is still treated as a
one-design fleet, exactly as a newly created class always was.

Both the API class listing and the public SEO routes use this rule, so it has
one owner here rather than one copy per caller.
"""

SCORING_MODES = ("one_design", "irc", "py", "ytc")


def series_scoring_modes(series) -> list:
    """Canonical ordered scoring modes for a series, including legacy records."""
    series = series or {}
    modes = series.get("scoring_modes") or [series.get("scoring_mode") or "one_design"]
    clean = list(dict.fromkeys(mode for mode in modes if mode in SCORING_MODES))
    return clean or [series.get("scoring_mode") or "one_design"]


def division_names(cls) -> list:
    """The named rating divisions of a class, in order, without blanks or duplicates."""
    clean, seen = [], set()
    for division in (cls or {}).get("divisions") or []:
        name = str((division or {}).get("name") or "").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        clean.append(name)
    return clean


def has_rating_divisions(cls) -> bool:
    """True when the class fields two or more rating divisions.

    A single (or unnamed) division row is not a split — the same threshold
    ``_class_divisions`` scores by.
    """
    return len(division_names(cls)) >= 2


def one_design_fleet(cls, series_docs) -> bool:
    """Whether this class is a single one-design fleet (see the module docstring)."""
    if has_rating_divisions(cls):
        return False
    return not any(
        mode != "one_design"
        for series in series_docs
        for mode in series_scoring_modes(series)
    )


def one_design_fleet_class_ids(classes, series_docs) -> set:
    """The ids of the classes that are single one-design fleets."""
    series_by_class = {}
    for series in series_docs:
        class_id = (series or {}).get("class_id")
        if class_id:
            series_by_class.setdefault(str(class_id), []).append(series)
    return {
        str(cls.get("id"))
        for cls in classes
        if cls.get("id") and one_design_fleet(cls, series_by_class.get(str(cls.get("id")), []))
    }
