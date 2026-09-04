import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.competition import (
    class_group_key,
    normalize_championship_scope,
    normalize_competition_type,
    normalize_series_type,
    series_type_for,
)


def test_normalizers_keep_the_public_type_contract():
    assert normalize_series_type(None) == "championship"
    assert normalize_series_type(" CLUB_CHAMPIONSHIP ") == "club_championship"
    assert normalize_series_type("unknown") == "championship"
    assert normalize_competition_type(" CHAMPIONSHIP ") == "championship"
    assert normalize_competition_type("unknown") == "regatta"
    assert normalize_championship_scope(" CLUB ", "championship") == "club"
    assert normalize_championship_scope("club", "regatta") is None


def test_linked_competition_owns_public_series_category():
    series = {"series_type": "regatta"}
    assert series_type_for(series, {"competition_type": "regatta"}) == "regatta"
    assert series_type_for(series, {"competition_type": "championship", "championship_scope": "club"}) == "club_championship"
    assert series_type_for(series, {"competition_type": "championship", "championship_scope": "class"}) == "championship"


def test_standalone_legacy_series_defaults_to_championship():
    assert series_type_for({}) == "championship"
    assert series_type_for({"series_type": "regatta"}) == "regatta"


def test_one_design_group_key_is_stable_across_punctuation():
    assert class_group_key(" Sonata One-Design ") == "sonata one design"
    assert class_group_key("SONATA.ONE DESIGN") == "sonata one design"
