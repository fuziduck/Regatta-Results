"""UK club-name recognition.

Yacht and sailing clubs across the UK name themselves from a small
vocabulary of patterns — "Medway Yacht Club", "Cowes Corinthian Sailing
Club", "Blackpool & Fleetwood YC", "Itchenor SC" — and in practice get
written as initials ("MYC"), trimmed forms ("Medway YC", "Cowes
Corinthian") or the full name. This module embeds that vocabulary so a
free-text club label can be linked to a club actually registered in the
system:

    >>> match_club("MYC", [Medway Yacht Club, Sonata Nationals])
    → {"name": "Medway Yacht Club", ...}

Matching is always against the registered clubs; the vocabulary here only
describes how UK club names are built, so both the suffix abbreviations
("YC" == "Yacht Club", "SC" == "Sailing Club", ...) and the initials of a
registered name ("Medway Yacht Club" -> "MYC") are understood. When an
input could name several clubs ("MYC" might be Mumbles Yacht Club too),
the club the boat actually races at is preferred; a genuinely ambiguous
input matches nothing rather than guessing.
"""

import re

# ---------------------------------------------------------------------------
# The UK club-name vocabulary
# ---------------------------------------------------------------------------
# Full suffix -> the abbreviations people actually write (longest first, so
# "corinthian yacht club" outranks "yacht club" when both could apply).
SUFFIX_FORMS = [
    ("corinthian yacht club", ["cyc", "corinthian yc"]),
    ("cruising yacht club", ["cyc"]),
    ("motor yacht club", ["myc"]),
    ("amateur sailing club", ["asc"]),
    ("sailing & boating club", ["sbc"]),
    ("sailing and boating club", ["sbc"]),
    ("yacht & sailing club", ["ysc"]),
    ("yacht and sailing club", ["ysc"]),
    ("dinghy sailing club", ["dsc"]),
    ("sailing & canoeing club", ["scc"]),
    ("sailing and canoeing club", ["scc"]),
    ("water sports club", ["wsc"]),
    ("watersports club", ["wsc"]),
    ("watersports centre", ["wsc"]),
    ("powerboat club", ["pbc"]),
    ("power boat club", ["pbc"]),
    ("cruising association", ["ca"]),
    ("cruising club", ["cc"]),
    ("sailing association", ["sa", "sailing assoc"]),
    ("sailing academy", ["sa"]),
    ("sailing school", ["ss"]),
    ("sports and social club", ["ssc"]),
    ("sports & social club", ["ssc"]),
    ("sports club", ["sc"]),
    ("rowing club", ["rc"]),
    ("rowing association", ["ra"]),
    ("boat club", ["bc"]),
    ("harbour club", ["hc"]),
    ("marina club", ["mc"]),
    ("marine club", ["mc"]),
    ("marine activities", ["ma"]),
    ("model yacht club", ["myc"]),
    ("model boat club", ["mbc"]),
    ("swimming club", ["sc"]),
    ("anglers club", ["ac"]),
    ("angling club", ["ac"]),
    ("fishing club", ["fc"]),
    ("sub aqua club", ["sac"]),
    ("yacht club", ["yc", "y.c."]),
    ("sailing club", ["sc", "s.c."]),
    ("club", ["c"]),
    ("association", ["a"]),
    ("society", ["s"]),
    ("institute", ["i"]),
]

# Connective / stop words that are skipped when forming initials, so
# "Blackpool & Fleetwood Yacht Club" -> "BFYC" and "Royal Ocean Racing
# Club" -> "RORC".
STOP_WORDS = {"the", "of", "and", "&", "at", "on", "for", "by", "in", "to", "a", "an"}

_WORD_RE = re.compile(r"[a-z0-9]+")


def _words(s):
    """Lowercased alphanumeric words of a label ('Medway Y.C.' -> [medway, yc])."""
    s = (s or "").lower()
    # 'y.c.' -> 'yc' (dots between single letters are punctuation, not words)
    s = re.sub(r"(?<=[a-z0-9])\.(?=[a-z0-9])", "", s)
    return _WORD_RE.findall(s)


def _norm(s):
    return " ".join(_words(s))


def _initials(words):
    return "".join(w[0] for w in words if w and w[0].isalnum() and w not in STOP_WORDS)


def _suffix_forms(words):
    """Every way a registered club name can be trimmed: the full name with a
    recognised UK suffix replaced by its abbreviations, or dropped entirely
    ('Blackpool & Fleetwood Yacht Club' -> 'blackpool & fleetwood yc',
    'blackpool & fleetwood y.c.', 'blackpool & fleetwood')."""
    forms = set()
    for full, abbrs in SUFFIX_FORMS:
        full_words = full.split()
        if len(words) <= len(full_words) or words[-len(full_words):] != full_words:
            continue
        head = " ".join(words[:-len(full_words)])
        forms.add(head)  # suffix dropped: "Cowes Corinthian"
        for a in abbrs:
            forms.add(f"{head} {a}")
    return forms


def _input_variants(inp):
    """An input label, plus its suffix expansions: 'itchenor sc' also means
    'itchenor sailing club', and 'medway yacht club' also means 'medway yc'."""
    out = {inp}
    if not inp:
        return out
    for full, abbrs in SUFFIX_FORMS:
        if inp.endswith(" " + full):
            for a in abbrs:
                out.add(inp[:-len(full)].rstrip() + " " + a)
        for a in abbrs:
            if inp.endswith(" " + a):
                out.add(inp[:-len(a)].rstrip() + " " + full)
    return out


def match_club(raw, clubs, context_club_id=None):
    """Link a free-text club label to a registered club.

    ``clubs`` is an iterable of dicts with at least ``id``, ``name``, and
    optionally ``slug`` / ``abbr``. Returns the matched club dict enriched
    with ``matched_by`` ("abbr" | "name" | "initials" | "suffix" |
    "prefix"), or ``None`` when nothing matches or the input is ambiguous.

    Priority order: an explicitly configured abbreviation, the exact full
    name, the name's initials, a trimmed suffix form, then a leading-word
    prefix ("Castle Cove" -> "Castle Cove Sailing Club"). When several
    clubs match at the same tier, the club the boat races at
    (``context_club_id``) wins; otherwise the input is treated as
    ambiguous and nothing is linked.
    """
    inp = _norm(raw)
    if not inp:
        return None
    variants = _input_variants(inp)
    entries = []
    for c in clubs or []:
        words = _words(c.get("name"))
        entries.append({
            "club": c,
            "tiers": {
                "abbr": {_norm(c.get("abbr"))} if c.get("abbr") else set(),
                "name": {" ".join(words)} if words else set(),
                "initials": {_initials(words)} if words else set(),
                "suffix": _suffix_forms(words),
            },
        })
    for tier in ("abbr", "name", "initials", "suffix"):
        hits = [e for e in entries if any(v in e["tiers"][tier] for v in variants)]
        if not hits:
            continue
        if len(hits) == 1:
            return {**hits[0]["club"], "matched_by": tier}
        if context_club_id:
            ctx = [e for e in hits if e["club"].get("id") == context_club_id]
            if len(ctx) == 1:
                return {**ctx[0]["club"], "matched_by": tier}
        return None
    # Leading-word prefix: "Castle Cove" for "Castle Cove Sailing Club".
    in_words = inp.split()
    if in_words:
        pref = [e for e in entries
                if len(_words(e["club"].get("name"))) > len(in_words)
                and _words(e["club"].get("name"))[:len(in_words)] == in_words]
        if pref:
            if len(pref) == 1:
                return {**pref[0]["club"], "matched_by": "prefix"}
            if context_club_id:
                ctx = [e for e in pref if e["club"].get("id") == context_club_id]
                if len(ctx) == 1:
                    return {**ctx[0]["club"], "matched_by": "prefix"}
    return None
