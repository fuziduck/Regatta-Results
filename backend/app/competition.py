"""Canonical competition and class-directory policy.

The database keeps the legacy ``regattas`` collection and ``regatta_id``
field for compatibility. These helpers make the meaning of those fields
explicit at the API boundary without changing stored race or result data.
"""

import re
from typing import Optional

SERIES_TYPES = ("championship", "club_championship", "regatta")
COMPETITION_TYPES = ("regatta", "championship")
CHAMPIONSHIP_SCOPES = ("club", "class", "open")


def normalize_series_type(value: Optional[str]) -> str:
    value = (value or "").strip().lower()
    return value if value in SERIES_TYPES else "championship"


def normalize_competition_type(value: Optional[str]) -> str:
    value = (value or "").strip().lower()
    return value if value in COMPETITION_TYPES else "regatta"


def normalize_championship_scope(value: Optional[str], competition_type: str) -> Optional[str]:
    scope = (value or "").strip().lower()
    return scope if competition_type == "championship" and scope in CHAMPIONSHIP_SCOPES else None


def series_type_for(series: dict, competition: Optional[dict] = None) -> str:
    """Resolve the public category for a series.

    A linked Competition owns the category of its participating series. The
    standalone ``series_type`` field remains the source for legacy/unlinked
    series and is still editable without touching scoring data.
    """
    if competition:
        competition_type = normalize_competition_type(competition.get("competition_type"))
        if competition_type == "championship":
            scope = normalize_championship_scope(competition.get("championship_scope"), competition_type)
            return "club_championship" if scope == "club" else "championship"
        return "regatta"
    return normalize_series_type((series or {}).get("series_type"))


def class_group_key(name: Optional[str]) -> str:
    """Stable identity for one-design classes with the same display name."""
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()
