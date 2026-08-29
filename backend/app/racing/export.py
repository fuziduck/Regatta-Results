"""Canonical result-export data structures.

This module is deliberately framework-independent. It normalizes the public
standings response so every server-side renderer can consume the same shape.
"""
from typing import Any, Dict, Iterable, List


def normalize_series_export(standings: Dict[str, Any]) -> Dict[str, Any]:
    """Return a stable export payload from a series standings response."""
    return {
        "kind": "series",
        "club_name": standings.get("club_name") or "SailScore club",
        "class_name": standings.get("class_name") or "Class",
        "series_name": standings.get("series_name") or "Series",
        "year": standings.get("year"),
        "races": list(standings.get("races") or []),
        "race_count": standings.get("race_count") or len(standings.get("races") or []),
        "discards": standings.get("discards") or 0,
        "standings": list(standings.get("standings") or []),
    }


def result_export_lines(payload: Dict[str, Any]) -> List[str]:
    """Create deterministic plain-text rows for attachments and diagnostics."""
    lines = [
        payload["club_name"],
        payload["class_name"],
        payload["series_name"],
        f"{payload['year'] or ''} season",
        "",
    ]
    for row in payload["standings"]:
        scores = " | ".join(str(score.get("points", "")) for score in row.get("scores") or [])
        lines.append(f"{row.get('rank', '')} | {row.get('boat_name', '')} | {row.get('sail_no', '')} | {scores} | {row.get('net', '')}")
    return lines
