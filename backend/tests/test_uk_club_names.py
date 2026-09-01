"""Unit tests for the UK club-name matcher (app.uk_club_names)."""
from app.uk_club_names import match_club

CLUBS = [
    {"id": "medway", "name": "Medway Yacht Club", "slug": "medway-yacht-club", "abbr": ""},
    {"id": "sonata", "name": "Sonata Nationals", "slug": "sonata-nationals-association", "abbr": "SN"},
    {"id": "ccsc", "name": "Cowes Corinthian Sailing Club", "slug": "cowes-corinthian", "abbr": ""},
    {"id": "bfyc", "name": "Blackpool & Fleetwood Yacht Club", "slug": "blackpool-fleetwood", "abbr": ""},
    {"id": "cc", "name": "Castle Cove Sailing Club", "slug": "castle-cove", "abbr": ""},
    {"id": "isc", "name": "Itchenor Sailing Club", "slug": "itchenor", "abbr": ""},
]


def pick(club_id):
    return next(c for c in CLUBS if c["id"] == club_id)


def test_initials_resolve():
    assert match_club("MYC", CLUBS)["id"] == "medway"
    assert match_club("ISC", CLUBS)["id"] == "isc"
    assert match_club("BFYC", CLUBS)["id"] == "bfyc"  # stop words skipped


def test_suffix_abbreviation_resolves():
    assert match_club("Medway YC", CLUBS)["id"] == "medway"
    assert match_club("Medway Y.C.", CLUBS)["id"] == "medway"
    assert match_club("Itchenor SC", CLUBS)["id"] == "isc"
    assert match_club("Itchenor Sailing Club", CLUBS)["id"] == "isc"  # full form too


def test_suffix_dropped_form():
    assert match_club("Cowes Corinthian", CLUBS)["id"] == "ccsc"
    assert match_club("Blackpool & Fleetwood", CLUBS)["id"] == "bfyc"
    assert match_club("Castle Cove", CLUBS)["id"] == "cc"  # via the dropped suffix


def test_explicit_abbr_has_priority():
    # "SN" is Sonata's configured abbreviation, not its initials ("SN" is the
    # same here, but the abbr tier is checked first).
    assert match_club("SN", CLUBS)["id"] == "sonata"
    assert match_club("SN", CLUBS)["matched_by"] == "abbr"


def test_full_name():
    assert match_club("Medway Yacht Club", CLUBS)["id"] == "medway"
    assert match_club("castle cove sailing club", CLUBS)["id"] == "cc"


def test_prefix_match():
    # "Castle" alone is a leading-word prefix, not a full dropped suffix.
    assert match_club("Castle", CLUBS)["id"] == "cc"
    assert match_club("Castle", CLUBS)["matched_by"] == "prefix"


def test_shared_initials_are_ambiguous():
    # "CCSC" names both Cowes Corinthian SC and Castle Cove SC.
    assert match_club("CCSC", CLUBS) is None
    assert match_club("CCSC", CLUBS, context_club_id="ccsc")["id"] == "ccsc"
    assert match_club("CCSC", CLUBS, context_club_id="cc")["id"] == "cc"


def test_ambiguous_initials_need_context():
    # Both "Medway Yacht Club" and "Mumbles Yacht Club" would be MYC — here
    # only Medway exists, so it resolves; add a second MYC and it must not.
    with_myc = CLUBS + [{"id": "mumbles", "name": "Mumbles Yacht Club", "slug": "mumbles", "abbr": ""}]
    assert match_club("MYC", with_myc) is None
    # ...but racing at Mumbles breaks the tie.
    assert match_club("MYC", with_myc, context_club_id="mumbles")["id"] == "mumbles"
    assert match_club("MYC", with_myc, context_club_id="medway")["id"] == "medway"


def test_no_match():
    assert match_club("", CLUBS) is None
    assert match_club("Some Random Harbour", CLUBS) is None
    assert match_club("   ", CLUBS) is None
