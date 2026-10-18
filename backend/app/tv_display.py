"""Clubhouse TV Results Display endpoints and aggregation logic.

Provides the public, read-only TV display payload for a club as well as the
authenticated configuration endpoints for club administrators and race
officers. All series standings, class standings, tie-breaks and discard rules
are computed exclusively by calling the existing SailScore scoring engine
(`_series_results`, `_overall_standings_payload`, `_division_tables`, etc.),
never a competing or duplicated calculation.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["TV display"])


def _main():
    """Return the live `app.main` module so tests that monkeypatch `server.db`
    or `app.main.db` are always respected."""
    return sys.modules.get("server") or sys.modules["app.main"]


class TvDisplayConfigInput(BaseModel):
    """Clubhouse TV display configuration."""
    enabled: bool = True
    active_series_ids: List[str] = Field(default_factory=list)
    active_series_id: Optional[str] = None
    active_regatta_id: Optional[str] = None
    active_year: Optional[int] = None
    display_mode: str = "full"
    rotation_seconds: int = Field(default=15, ge=5, le=120)
    include_provisional: bool = True
    show_race_officer: bool = True
    show_courses: bool = True
    show_schedule: bool = True
    show_notes: bool = True
    show_announcements: bool = True
    show_status: bool = True
    show_calendar: bool = True


class RaceDayInfoInput(BaseModel):
    """Club-level race-day information shown persistently on the TV display."""
    title: str = ""
    date: str = ""
    race_officer: str = ""
    status: str = ""
    courses: str = ""
    course_diagram: str = ""
    start_sequence: str = ""
    notes: str = ""
    announcements: str = ""


DEFAULT_TV_CONFIG: Dict[str, Any] = {
    "enabled": True,
    "active_series_ids": [],
    "active_series_id": None,
    "active_regatta_id": None,
    "active_year": None,
    "display_mode": "full",
    "rotation_seconds": 15,
    "include_provisional": True,
    "show_race_officer": True,
    "show_courses": True,
    "show_schedule": True,
    "show_notes": True,
    "show_announcements": True,
    "show_status": True,
    "show_calendar": True,
}

DEFAULT_RACE_DAY_INFO: Dict[str, Any] = {
    "title": "",
    "date": "",
    "race_officer": "",
    "status": "",
    "courses": "",
    "course_diagram": "",
    "start_sequence": "",
    "notes": "",
    "announcements": "",
    "updated_at": None,
    "updated_by": None,
}

TV_DISPLAY_MODES = ("full", "race_day")

CALENDAR_SUMMARY_DAYS = 6

SCORING_MODE_LABELS = {
    "one_design": "One-Design",
    "irc": "IRC",
    "py": "PY",
    "ytc": "YTC",
    "nhc": "NHC",
}


def normalize_tv_config(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    cfg = dict(DEFAULT_TV_CONFIG)
    if isinstance(raw, dict):
        for k in DEFAULT_TV_CONFIG:
            if k in raw and raw[k] is not None:
                cfg[k] = raw[k]
        if raw.get("active_series_id") in ("", "auto", "all"):
            cfg["active_series_id"] = None
        if raw.get("active_regatta_id") in ("", "auto", "all"):
            cfg["active_regatta_id"] = None
    try:
        rot = int(cfg.get("rotation_seconds") or 15)
    except (TypeError, ValueError):
        rot = 15
    cfg["rotation_seconds"] = max(5, min(120, rot))
    if cfg.get("display_mode") not in TV_DISPLAY_MODES:
        cfg["display_mode"] = "full"
    # Ticked series in order, without repeats. A config saved before the list
    # existed carries only active_series_id, which becomes a one-item list.
    ids = list(dict.fromkeys(str(s) for s in (cfg.get("active_series_ids") or []) if s))
    if not ids and cfg.get("active_series_id"):
        ids = [str(cfg["active_series_id"])]
    cfg["active_series_ids"] = ids
    cfg["active_series_id"] = ids[0] if ids else None
    return cfg


def normalize_race_day_info(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    info = dict(DEFAULT_RACE_DAY_INFO)
    if isinstance(raw, dict):
        for k in (
            "title", "date", "race_officer", "status", "courses",
            "course_diagram", "start_sequence", "notes", "announcements",
        ):
            val = raw.get(k)
            info[k] = str(val).strip() if val is not None else ""
        info["updated_at"] = raw.get("updated_at")
        info["updated_by"] = raw.get("updated_by")
    return info


async def _find_club_by_identifier(db, club_identifier: str) -> Optional[Dict[str, Any]]:
    ident = (club_identifier or "").strip()
    if not ident:
        return None
    club = await db.clubs.find_one({"id": ident}, {"_id": 0})
    if club:
        return club
    return await db.clubs.find_one({"slug": ident.lower()}, {"_id": 0})


def _fmt_seconds(seconds: Optional[float]) -> Optional[str]:
    if seconds is None:
        return None
    try:
        total = int(round(float(seconds)))
    except (TypeError, ValueError):
        return None
    if total < 0:
        return None
    h = total // 3600
    rem = total % 3600
    m = rem // 60
    s = rem % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _scoring_label(mode: Optional[str]) -> str:
    if not mode:
        return "One-Design"
    return SCORING_MODE_LABELS.get(str(mode).lower(), str(mode).upper())


def _standings_rows_with_completed(table: Dict[str, Any], race_count: int) -> List[Dict[str, Any]]:
    """Enrich official standings rows with `races_completed` (non-DNC/DNS count)
    without altering ranks, net points, totals, or scores."""
    out = []
    for row in table.get("standings") or []:
        scores = row.get("scores") or []
        if scores:
            sailed = sum(
                1 for s in scores
                if (s.get("code") or "") not in ("DNC", "DNS")
            )
        else:
            sailed = race_count
        enriched = dict(row)
        enriched["races_completed"] = sailed
        enriched["race_count"] = race_count
        out.append(enriched)
    return out


async def _require_officer_dep(request: Request) -> dict:
    m = _main()
    return await m.require_officer(request)


async def _require_admin_dep(request: Request) -> dict:
    m = _main()
    return await m.require_admin(request)


@router.get("/clubs/{club_identifier}/tv-config")
async def get_club_tv_config(
    club_identifier: str,
    user: dict = Depends(_require_officer_dep),
):
    """Stored TV display configuration for a club, for its staff to edit.

    Race Officers change what the clubhouse screen shows as readily as club
    admins do — it is their race day on the wall — so officers read and write
    this config too. Unlike the public /clubs list it includes unapproved
    clubs, so the settings card always shows the saved values instead of
    defaults.
    """
    m = _main()
    club = await _find_club_by_identifier(m.db, club_identifier)
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    m._ensure_club(user, club["id"])
    return {"tv_config": normalize_tv_config(club.get("tv_config"))}


@router.put("/clubs/{club_identifier}/tv-config")
async def update_club_tv_config(
    club_identifier: str,
    data: TvDisplayConfigInput,
    request: Request,
    user: dict = Depends(_require_officer_dep),
):
    """Configure a club's public Clubhouse TV Display (race officer, club admin
    or webmaster)."""
    m = _main()
    db = m.db
    club = await _find_club_by_identifier(db, club_identifier)
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    m._ensure_club(user, club["id"])
    cfg = normalize_tv_config(data.model_dump())
    # Every ticked series must exist and belong to this club
    for sid in cfg.get("active_series_ids") or []:
        ser = await db.series.find_one({"id": sid}, {"_id": 0})
        if not ser:
            raise HTTPException(status_code=400, detail="Selected series not found")
        ser_club = await m._class_club_id(ser.get("class_id"))
        if ser_club != club["id"]:
            raise HTTPException(status_code=400, detail="Selected series belongs to another club")
    if cfg.get("active_regatta_id") and hasattr(db, "regattas"):
        reg = await db.regattas.find_one({"id": cfg["active_regatta_id"]}, {"_id": 0})
        if not reg or reg.get("club_id") != club["id"]:
            raise HTTPException(status_code=400, detail="Selected event not found")
    await db.clubs.update_one({"id": club["id"]}, {"$set": {"tv_config": cfg}})
    await m._log_audit(
        request=request,
        user=user,
        action="CLUB_TV_CONFIG_UPDATED",
        description=f"Updated TV display configuration for {club.get('name')} (enabled={cfg['enabled']})",
        resource_type="club",
        resource_id=club["id"],
        club_id=club["id"],
    )
    updated = await db.clubs.find_one({"id": club["id"]}, {"_id": 0})
    return {"tv_config": normalize_tv_config((updated or {}).get("tv_config"))}


@router.put("/clubs/{club_identifier}/race-day-info")
async def update_club_race_day_info(
    club_identifier: str,
    data: RaceDayInfoInput,
    request: Request,
    user: dict = Depends(_require_officer_dep),
):
    """Update current race-day information for the Clubhouse TV Display (race officer, admin or webmaster)."""
    m = _main()
    db = m.db
    club = await _find_club_by_identifier(db, club_identifier)
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    m._ensure_club(user, club["id"])
    raw = data.model_dump()
    raw["updated_at"] = m.now_iso()
    raw["updated_by"] = user.get("name") or user.get("username") or user.get("role")
    info = normalize_race_day_info(raw)
    await db.clubs.update_one({"id": club["id"]}, {"$set": {"race_day_info": info}})
    await m._log_audit(
        request=request,
        user=user,
        action="CLUB_RACE_DAY_INFO_UPDATED",
        description=f"Updated race-day information for {club.get('name')}",
        resource_type="club",
        resource_id=club["id"],
        club_id=club["id"],
    )
    updated = await db.clubs.find_one({"id": club["id"]}, {"_id": 0})
    return {"race_day_info": normalize_race_day_info((updated or {}).get("race_day_info"))}


@router.get("/clubs/{club_identifier}/display")
async def get_club_tv_display(
    club_identifier: str,
    request: Request,
    series_id: Optional[str] = None,
    regatta_id: Optional[str] = None,
    year: Optional[int] = None,
):
    """Public read-only payload for the Clubhouse TV Results Display.

    Accepts either a club `id` or `slug` as `club_identifier`. Optional query
    parameters (`series_id`, `regatta_id`, `year`) allow URL-level overrides
    while defaulting to the club's configured TV display settings.
    """
    m = _main()
    db = m.db
    club = await _find_club_by_identifier(db, club_identifier)
    user = await m.get_current_user(request)
    if not club or not await m._club_visible_to_user(club.get("id"), user):
        raise HTTPException(status_code=404, detail="Club not found")

    club_id = club["id"]
    tv_config = normalize_tv_config(club.get("tv_config"))

    # Staff of this club or webmaster can preview even when public TV display is disabled,
    # if they pass ?preview=1; otherwise respect `tv_config.enabled`.
    preview_requested = request.query_params.get("preview") in ("1", "true", "yes")
    is_authorized_staff = bool(
        user and (user.get("role") == "webmaster" or user.get("club_id") == club_id)
    )
    if not tv_config.get("enabled", True) and not (preview_requested and is_authorized_staff):
        raise HTTPException(
            status_code=403,
            detail="Public TV display is currently disabled for this club",
        )

    today_iso = datetime.now(timezone.utc).date().isoformat()
    # Race-day mode shows only the most recent race date's results and the class
    # standings for classes that raced that day.
    race_day_mode = tv_config.get("display_mode") == "race_day"
    race_day_date: Optional[str] = None
    race_day_class_ids: set = set()
    current_year = datetime.now(timezone.utc).year

    # Load club classes
    classes = await db.classes.find({"club_id": club_id}, {"_id": 0}).sort("name", 1).to_list(500)
    class_by_id = {c["id"]: c for c in classes if c.get("id")}
    class_ids = list(class_by_id.keys())

    # Load all series for the club's classes
    all_series = (
        await db.series.find({"class_id": {"$in": class_ids}}, {"_id": 0})
        .sort([("year", -1), ("order", 1)])
        .to_list(2000)
        if class_ids
        else []
    )
    series_by_id = {s["id"]: s for s in all_series if s.get("id")}

    # Load regattas/competitions for the club
    all_regattas = (
        await db.regattas.find({"club_id": club_id}, {"_id": 0})
        .sort([("year", -1), ("start_date", -1)])
        .to_list(500)
        if hasattr(db, "regattas")
        else []
    )
    regatta_by_id = {r["id"]: r for r in all_regattas if r.get("id")}

    # Load races for the club's classes
    all_races = (
        await db.races.find({"class_id": {"$in": class_ids}}, {"_id": 0})
        .sort([("date", -1), ("race_number", -1)])
        .to_list(5000)
        if class_ids
        else []
    )

    # Determine target scope (series, regatta, or year)
    effective_series_id = series_id or tv_config.get("active_series_id")
    effective_regatta_id = regatta_id or tv_config.get("active_regatta_id")
    effective_year = year or tv_config.get("active_year")

    # Several ticked series rotate exactly as ticked; a single series keeps the sibling-series behaviour below.
    ticked_ids = [series_id] if series_id else list(tv_config.get("active_series_ids") or [])
    ticked_series = [series_by_id[sid] for sid in ticked_ids if sid in series_by_id]
    multi_series = len(ticked_series) > 1

    # Validate effective_series_id belongs to this club
    selected_series = None if multi_series else (series_by_id.get(effective_series_id) if effective_series_id else None)
    selected_regatta = regatta_by_id.get(effective_regatta_id) if effective_regatta_id else None

    if multi_series:
        effective_year = ticked_series[0].get("year") or effective_year
    elif selected_series:
        effective_year = selected_series.get("year") or effective_year
    elif selected_regatta:
        effective_year = selected_regatta.get("year") or effective_year

    if not effective_year:
        # Pick the most recent year that has published/provisional races or series
        race_years = [r.get("year") for r in all_races if isinstance(r.get("year"), int)]
        series_years = [s.get("year") for s in all_series if isinstance(s.get("year"), int)]
        if current_year in series_years or current_year in race_years:
            effective_year = current_year
        elif race_years:
            effective_year = max(race_years)
        elif series_years:
            effective_year = max(series_years)
        else:
            effective_year = current_year

    # Determine which series are in scope for the display
    if multi_series:
        scoped_series = list(ticked_series)
        active_event_title = f"Selected series ({effective_year})"
    elif selected_series:
        # If the admin picked a specific series (e.g., "Summer Series" in Sonata),
        # check if other classes also have a series with the same name & year (common club-wide series pattern),
        # or if it's linked to a regatta. We include the selected series first, plus any sibling series
        # sharing the same name+year across classes for class rotation, while keeping selected_series primary.
        same_name_series = [
            s for s in all_series
            if s.get("year") == selected_series.get("year")
            and (s.get("name") or "").strip().casefold() == (selected_series.get("name") or "").strip().casefold()
        ]
        # Put selected_series first
        scoped_series = [selected_series] + [s for s in same_name_series if s["id"] != selected_series["id"]]
        active_event_title = f"{selected_series.get('name', 'Series')} ({effective_year})"
        if len(scoped_series) == 1:
            cls_name = class_by_id.get(selected_series.get("class_id"), {}).get("name")
            if cls_name:
                active_event_title = f"{cls_name} — {selected_series.get('name', 'Series')} {effective_year}"
    elif selected_regatta:
        reg_series = await m._series_for_regatta(selected_regatta)
        scoped_series = [s for s in reg_series if s.get("class_id") in class_by_id]
        active_event_title = f"{selected_regatta.get('name', 'Event')} {effective_year}"
    else:
        scoped_series = [s for s in all_series if s.get("year") == effective_year]
        # If there are races in effective_year, prioritize series that have races or schedules
        active_event_title = f"{effective_year} Season"
        # Check if there is a single active series or today's series
        today_series_ids = {
            r.get("series_id") for r in all_races
            if r.get("date") == today_iso and r.get("series_id") in series_by_id
        }
        if len(today_series_ids) == 1:
            only_sid = next(iter(today_series_ids))
            s_doc = series_by_id[only_sid]
            active_event_title = f"{s_doc.get('name', 'Series')} ({effective_year})"
        elif len(scoped_series) == 1:
            s_doc = scoped_series[0]
            cls_name = class_by_id.get(s_doc.get("class_id"), {}).get("name")
            active_event_title = (
                f"{cls_name} · {s_doc.get('name', 'Series')} ({effective_year})"
                if cls_name else f"{s_doc.get('name', 'Series')} ({effective_year})"
            )

    scoped_series_ids = {s["id"] for s in scoped_series if s.get("id")}

    # Compute series standings for each scoped series using the official SailScore engine
    series_standings_map: Dict[str, Dict[str, Any]] = {}
    for s in scoped_series:
        try:
            payload = await m._series_results(s)
            series_standings_map[s["id"]] = payload
        except Exception:
            continue

    # Determine classes participating in the scoped series
    participating_class_ids: List[str] = []
    for s in scoped_series:
        cid = s.get("class_id")
        if cid and cid in class_by_id and cid not in participating_class_ids:
            participating_class_ids.append(cid)
    # Also include any club classes that might not have scoped series yet if no series was explicitly chosen
    if not selected_series and not selected_regatta:
        for cid in class_ids:
            if cid not in participating_class_ids:
                participating_class_ids.append(cid)

    # -----------------------------------------------------------------------
    # View A: Overall Series Standings
    # -----------------------------------------------------------------------
    overall_views: List[Dict[str, Any]] = []
    if not race_day_mode:
        if selected_series:
            # When a specific series is selected, View A shows the overall standings
            # for that selected series (across its divisions/scoring modes, or across
            # the matching series name).
            for s in scoped_series:
                payload = series_standings_map.get(s["id"])
                if not payload:
                    continue
                cls = class_by_id.get(s.get("class_id"), {})
                tables = m._division_tables(payload)
                for table in tables:
                    rows = _standings_rows_with_completed(table, int(table.get("race_count") or 0))
                    if not rows:
                        continue
                    div_name = table.get("division_name")
                    mode = table.get("division_scoring_mode") or table.get("scoring_mode") or s.get("scoring_mode") or cls.get("scoring_mode") or "one_design"
                    overall_views.append({
                        "id": f"overall-series-{s['id']}-{div_name or 'main'}",
                        "kind": "series_overall",
                        "title": s.get("name") or "Series Standings",
                        "subtitle": f"{cls.get('name', 'Class')}{f' · {div_name}' if div_name else ''}",
                        "class_id": cls.get("id"),
                        "class_name": cls.get("name", "Class"),
                        "series_id": s["id"],
                        "series_name": s.get("name"),
                        "division_name": div_name,
                        "scoring_mode": mode,
                        "scoring_label": _scoring_label(mode),
                        "year": s.get("year") or effective_year,
                        "race_count": int(table.get("race_count") or 0),
                        "planned_races": int(s.get("planned_races") or table.get("planned_races") or 0),
                        "discards": int(table.get("discards") or 0),
                        "locked": bool(payload.get("locked")),
                        "races": table.get("races") or [],
                        "standings": rows,
                    })
        else:
            # Season / Championship overall across classes for the effective year
            for cid in participating_class_ids:
                cls = class_by_id.get(cid, {})
                try:
                    ov_payload = await m._overall_standings_payload(cid, effective_year)
                except Exception:
                    ov_payload = None
                if not ov_payload:
                    continue
                tables = m._division_tables(ov_payload)
                # Count total published races in the contributing series for this class+year
                cls_series = [s for s in scoped_series if s.get("class_id") == cid]
                total_races_completed = sum(
                    int((series_standings_map.get(s["id"]) or {}).get("race_count") or 0)
                    for s in cls_series
                )
                for table in tables:
                    standings_rows = table.get("standings") or []
                    if not standings_rows:
                        continue
                    div_name = table.get("division_name")
                    mode = table.get("division_scoring_mode") or cls.get("scoring_mode") or "one_design"
                    enriched_rows = []
                    for r in standings_rows:
                        er = dict(r)
                        er["class_name"] = cls.get("name", "Class")
                        er["races_completed"] = total_races_completed
                        er["series_completed"] = len([
                            v for v in (r.get("per_series") or {}).values() if v is not None
                        ])
                        enriched_rows.append(er)
                    overall_views.append({
                        "id": f"overall-class-{cid}-{div_name or 'main'}",
                        "kind": "championship_overall",
                        "title": f"{cls.get('name', 'Class')} Overall Standings",
                        "subtitle": f"{effective_year} Championship{f' · {div_name}' if div_name else ''}",
                        "class_id": cid,
                        "class_name": cls.get("name", "Class"),
                        "division_name": div_name,
                        "scoring_mode": mode,
                        "scoring_label": _scoring_label(mode),
                        "year": effective_year,
                        "series_names": table.get("series_names") or [],
                        "race_count": total_races_completed,
                        "standings": enriched_rows,
                    })

    # -----------------------------------------------------------------------
    # View B: Individual Class / Series / Rating-Division Standings
    # -----------------------------------------------------------------------
    class_views: List[Dict[str, Any]] = []
    if class_ids:
        # Order series so each class gets fair representation
        for s in scoped_series:
            payload = series_standings_map.get(s["id"])
            if not payload:
                continue
            cls = class_by_id.get(s.get("class_id"), {})
            tables = m._division_tables(payload)
            for table in tables:
                rows = _standings_rows_with_completed(table, int(table.get("race_count") or 0))
                if not rows:
                    continue
                div_name = table.get("division_name")
                table_kind = table.get("table_kind")
                mode = (
                    table.get("division_scoring_mode")
                    or table.get("scoring_mode")
                    or s.get("scoring_mode")
                    or cls.get("scoring_mode")
                    or "one_design"
                )
                scoring_label = _scoring_label(mode)
                # Build prominent class/division heading
                class_heading = cls.get("name", "Class")
                if div_name:
                    if table_kind == "scoring_mode":
                        class_heading = f"{cls.get('name', 'Class')} ({div_name})"
                    else:
                        class_heading = f"{cls.get('name', 'Class')} — {div_name}"
                for r in rows:
                    r["class_name"] = cls.get("name", "Class")
                class_views.append({
                    "id": f"class-series-{s['id']}-{div_name or 'main'}",
                    "class_id": cls.get("id"),
                    "class_name": cls.get("name", "Class"),
                    "class_icon": cls.get("icon"),
                    "heading": class_heading,
                    "series_id": s["id"],
                    "series_name": s.get("name", "Series"),
                    "division_name": div_name,
                    "table_kind": table_kind,
                    "scoring_mode": mode,
                    "scoring_label": scoring_label,
                    "year": s.get("year") or effective_year,
                    "race_count": int(table.get("race_count") or 0),
                    "planned_races": int(s.get("planned_races") or table.get("planned_races") or 0),
                    "discards": int(table.get("discards") or 0),
                    "locked": bool(payload.get("locked")),
                    "races": table.get("races") or [],
                    "standings": rows,
                })

        # Interleave class_views by class_id so rotation cycles fairly across classes
        if len(participating_class_ids) > 1 and len(class_views) > 1:
            by_cls: Dict[str, List[Dict[str, Any]]] = {}
            for cv in class_views:
                by_cls.setdefault(cv.get("class_id") or "", []).append(cv)
            interleaved: List[Dict[str, Any]] = []
            max_len = max((len(v) for v in by_cls.values()), default=0)
            cls_keys = list(by_cls.keys())
            for i in range(max_len):
                for ck in cls_keys:
                    if i < len(by_cls[ck]):
                        interleaved.append(by_cls[ck][i])
            class_views = interleaved

    # If View A is empty (e.g. no overall championship data yet) but class_views has standings,
    # populate View A from the primary series standings so the default opening view is never blank when data exists.
    if not race_day_mode and not overall_views and class_views:
        first_cv = class_views[0]
        overall_views.append({
            **first_cv,
            "id": f"overall-fallback-{first_cv['id']}",
            "kind": "series_overall",
            "title": f"{first_cv['series_name']} Standings",
            "subtitle": first_cv["heading"],
        })

    # -----------------------------------------------------------------------
    # View C: Latest Race Results
    # -----------------------------------------------------------------------
    latest_races_views: List[Dict[str, Any]] = []
    if class_ids:
        allowed_statuses = {"published"}
        if tv_config.get("include_provisional", True):
            allowed_statuses.add("provisional")

        candidate_races = [
            r for r in all_races
            if r.get("status") in allowed_statuses
            and not r.get("abandoned")
            and (
                r.get("series_id") in scoped_series_ids
                or (not scoped_series_ids and r.get("year") == effective_year)
            )
            and any(
                res.get("code") != "DNC"
                for res in (r.get("results") or [])
            )
        ]
        candidate_races.sort(
            key=lambda r: (
                r.get("date") or "",
                1 if r.get("status") == "provisional" else 0,
                int(r.get("race_number") or 0),
                r.get("published_at") or r.get("created_at") or "",
            ),
            reverse=True,
        )

        # Pick the most recent race per class (up to 6 latest races overall) so every
        # active class's latest race is shown, starting with the newest race overall.
        selected_latest_races: List[Dict[str, Any]] = []
        seen_classes_for_latest = set()
        for r in candidate_races:
            cid = r.get("class_id")
            if cid not in seen_classes_for_latest:
                seen_classes_for_latest.add(cid)
                selected_latest_races.append(r)
            if len(selected_latest_races) >= 6:
                break
        if not selected_latest_races and candidate_races:
            selected_latest_races = candidate_races[:3]

        if race_day_mode:
            # Every race from the most recent race date, in race-number order.
            race_day_date = candidate_races[0].get("date") if candidate_races else None
            selected_latest_races = sorted(
                (r for r in candidate_races if r.get("date") == race_day_date),
                key=lambda r: int(r.get("race_number") or 0),
            )
            race_day_class_ids = {r.get("class_id") for r in selected_latest_races}

        # Decorate published races with multi-mode scoring positions
        published_subset = [r for r in selected_latest_races if r.get("status") == "published"]
        if published_subset:
            decorated = await m._decorate_races_scoring_positions(published_subset)
            dec_by_id = {d["id"]: d for d in decorated if d.get("id")}
            selected_latest_races = [dec_by_id.get(r["id"], r) for r in selected_latest_races]

        # Load boat records needed for these races
        race_class_ids = list({r.get("class_id") for r in selected_latest_races if r.get("class_id")})
        boat_docs = (
            await db.boats.find({"class_id": {"$in": race_class_ids}}, {"_id": 0}).to_list(3000)
            if race_class_ids
            else []
        )
        boats_by_id = {b["id"]: b for b in boat_docs if b.get("id")}
        club_map = await m._club_map_for_display()

        for race in selected_latest_races:
            cls = class_by_id.get(race.get("class_id"), {})
            ser = series_by_id.get(race.get("series_id"), {})
            divisions = m._class_divisions(cls)
            modes = m._series_scoring_modes(ser) if ser else [cls.get("scoring_mode") or "one_design"]
            start_time = m._race_start_time(race, cls)
            standings_payload = series_standings_map.get(race.get("series_id") or "")

            # Build per-mode or per-division tables for this race
            if divisions:
                race_tables_spec = [
                    {"division_name": d["name"], "mode": d["scoring_mode"], "filter_division": d["name"]}
                    for d in divisions
                ]
            elif len(modes) > 1:
                race_tables_spec = [
                    {"division_name": _scoring_label(mode), "mode": mode, "filter_division": None}
                    for mode in modes
                ]
            else:
                race_tables_spec = [
                    {"division_name": None, "mode": modes[0], "filter_division": None}
                ]

            for spec in race_tables_spec:
                mode = spec["mode"]
                div_filter = spec["filter_division"]
                div_label = spec["division_name"]
                mode_positions = (race.get("scoring_positions") or {}).get(mode) or {}

                # Look up official points from series standings if published
                points_by_boat: Dict[str, float] = {}
                if standings_payload:
                    for tbl in m._division_tables(standings_payload):
                        tbl_mode = tbl.get("division_scoring_mode") or tbl.get("scoring_mode") or modes[0]
                        tbl_div = tbl.get("division_name")
                        if div_filter and tbl_div != div_filter:
                            continue
                        if not div_filter and len(modes) > 1 and tbl_mode != mode:
                            continue
                        race_meta_list = tbl.get("races") or []
                        r_idx = next(
                            (i for i, rm in enumerate(race_meta_list) if rm.get("race_number") == race.get("race_number")),
                            None,
                        )
                        if r_idx is not None:
                            for st_row in tbl.get("standings") or []:
                                sc_list = st_row.get("scores") or []
                                if r_idx < len(sc_list):
                                    points_by_boat[st_row["boat_id"]] = sc_list[r_idx].get("points")

                result_rows = []
                for res in race.get("results") or []:
                    code = res.get("code") or "DNC"
                    if code == "DNC":
                        continue
                    bid = res.get("boat_id")
                    boat = boats_by_id.get(bid, {})
                    if div_filter and m._boat_division(boat, divisions) != div_filter:
                        continue
                    pos = mode_positions.get(bid, res.get("position")) if code in ("FINISHED", *m.PENALTY_CODES) else None
                    elapsed_sec = m._elapsed_seconds(res.get("finish_time"), start_time) if start_time and res.get("finish_time") else None
                    rating_field = m.RATING_FIELD.get(mode)
                    rating_val = boat.get(rating_field) if rating_field else None
                    if div_filter is None and rating_field and not rating_val:
                        # Not part of this rating table (e.g. a YTC-only boat
                        # in the IRC race): she has no place and no corrected
                        # time here, so the slide must not list her. A split
                        # class is decided by division instead — an explicit
                        # division assignment keeps her in her own table, with
                        # an empty corrected cell until her number is entered.
                        continue
                    corrected_sec = (
                        m._corrected_seconds(mode, res.get("finish_time"), start_time, rating_val)
                        if mode in m.RATING_FIELD and start_time and res.get("finish_time") and rating_val
                        else None
                    )
                    home_name, _ = m._home_club_display(boat, club.get("name", ""), club_map)
                    result_rows.append({
                        "boat_id": bid,
                        "boat_name": boat.get("name", "Boat"),
                        "sail_no": boat.get("sail_no", ""),
                        "helm": boat.get("helm", ""),
                        "class_name": cls.get("name", "Class"),
                        "home_club": home_name,
                        "position": pos,
                        "code": code,
                        "points": points_by_boat.get(bid),
                        "finish_time": res.get("finish_time"),
                        "elapsed_seconds": round(elapsed_sec) if elapsed_sec is not None else None,
                        "elapsed_formatted": _fmt_seconds(elapsed_sec),
                        "corrected_seconds": corrected_sec,
                        "corrected_formatted": _fmt_seconds(corrected_sec),
                        "rating": rating_val,
                    })

                if not result_rows:
                    continue

                result_rows.sort(
                    key=lambda r: (
                        0 if (r["code"] == "FINISHED" and r["position"] is not None) else 1,
                        r["position"] if r["position"] is not None else 9999,
                        r["corrected_seconds"] if r["corrected_seconds"] is not None else 999999,
                        r["elapsed_seconds"] if r["elapsed_seconds"] is not None else 999999,
                        r["boat_name"],
                    )
                )

                race_label = race.get("mini_group_label") or f"Race {race.get('race_number') or ''}".strip()
                latest_races_views.append({
                    "id": f"race-{race['id']}-{div_label or mode}",
                    "race_id": race["id"],
                    "race_number": race.get("race_number"),
                    "race_label": race_label,
                    "date": race.get("date"),
                    "status": "provisional" if race.get("status") != "published" else "final",
                    "raw_status": race.get("status"),
                    "is_provisional": race.get("status") != "published",
                    "class_id": cls.get("id"),
                    "class_name": cls.get("name", "Class"),
                    "series_id": ser.get("id"),
                    "series_name": ser.get("name", "Series"),
                    "division_name": div_label,
                    "scoring_mode": mode,
                    "scoring_label": _scoring_label(mode),
                    # A handicap table (IRC, PY, YTC) is scored on time, so the
                    # TV shows its elapsed and corrected columns even when a
                    # boat has no computable time yet. Points would hide the
                    # scoring basis, and made YTC look unlike IRC.
                    "shows_times": mode in m.RATING_FIELD,
                    "start_time": race.get("start_time") or cls.get("default_start_time"),
                    "course": race.get("course") or "",
                    "entries_count": len(result_rows),
                    "results": result_rows,
                })

    if race_day_mode:
        class_views = [cv for cv in class_views if cv.get("class_id") in race_day_class_ids]

    # -----------------------------------------------------------------------
    # View D: Series Progress
    # -----------------------------------------------------------------------
    series_progress_views: List[Dict[str, Any]] = []
    if not race_day_mode:
        for s in scoped_series:
            payload = series_standings_map.get(s["id"])
            if not payload:
                continue
            cls = class_by_id.get(s.get("class_id"), {})
            tables = m._division_tables(payload)
            primary_table = tables[0] if tables else payload
            rows = _standings_rows_with_completed(primary_table, int(primary_table.get("race_count") or 0))

            schedule = [str(d) for d in (s.get("schedule") or []) if d]
            sailed_races = [
                r for r in all_races
                if r.get("series_id") == s["id"] and r.get("status") == "published" and not r.get("abandoned")
            ]
            abandoned_count = int(payload.get("abandoned_race_count") or 0)
            completed_count = int(payload.get("race_count") or len(sailed_races))
            planned_raw = int(s.get("planned_races") or len(schedule) or completed_count)
            planned_count = max(completed_count, max(0, planned_raw - abandoned_count))
            remaining_count = max(0, planned_count - completed_count)

            sailed_race_numbers = {int(r.get("race_number") or 0) for r in sailed_races}
            upcoming_dates = []
            for idx, d_str in enumerate(schedule):
                rn = idx + 1
                if rn not in sailed_race_numbers and d_str >= today_iso:
                    upcoming_dates.append({"race_number": rn, "date": d_str})
            if not upcoming_dates:
                # Any future scheduled date
                for idx, d_str in enumerate(schedule):
                    if d_str >= today_iso:
                        upcoming_dates.append({"race_number": idx + 1, "date": d_str})

            next_race_date = upcoming_dates[0]["date"] if upcoming_dates else None

            if not rows and completed_count == 0 and not schedule:
                continue

            mode = primary_table.get("division_scoring_mode") or s.get("scoring_mode") or cls.get("scoring_mode") or "one_design"
            series_progress_views.append({
                "id": f"progress-{s['id']}",
                "series_id": s["id"],
                "series_name": s.get("name", "Series"),
                "class_id": cls.get("id"),
                "class_name": cls.get("name", "Class"),
                "year": s.get("year") or effective_year,
                "scoring_mode": mode,
                "scoring_label": _scoring_label(mode),
                "completed_races": completed_count,
                "planned_races": planned_count,
                "remaining_races": remaining_count,
                "abandoned_races": abandoned_count,
                "discards": int(primary_table.get("discards") or 0),
                "configured_discards": int(s.get("discards") or 0),
                "discard_policy": payload.get("discard_policy", "fixed"),
                "locked": bool(payload.get("locked")),
                "next_race_date": next_race_date,
                "upcoming_races": upcoming_dates[:5],
                "completed_race_list": [
                    {"race_number": r.get("race_number"), "date": r.get("date")}
                    for r in sorted(sailed_races, key=lambda x: (x.get("date") or "", x.get("race_number") or 0))
                ],
                "standings": rows[:10],
            })

    # -----------------------------------------------------------------------
    # Current Race-Day Information (Persistent Panel)
    # -----------------------------------------------------------------------
    configured_info = normalize_race_day_info(club.get("race_day_info"))
    target_date = configured_info.get("date") or today_iso

    # Find races on target_date (or active setup/provisional races)
    day_races = [
        r for r in all_races
        if r.get("date") == target_date or r.get("status") in ("setup", "provisional")
    ]
    # Also check scheduled races from series schedules for target_date
    scheduled_today = []
    seen_sched_keys = set()
    for r in sorted(day_races, key=lambda x: (x.get("start_time") or "99:99", x.get("race_number") or 0)):
        cls = class_by_id.get(r.get("class_id"), {})
        ser = series_by_id.get(r.get("series_id"), {})
        key = (r.get("series_id"), r.get("race_number"))
        seen_sched_keys.add(key)
        r_status = "abandoned" if r.get("abandoned") else (r.get("status") or "scheduled")
        if r_status == "setup":
            r_status = "racing" if r.get("actual_start") else "scheduled"
        elif r_status == "published":
            r_status = "completed"
        scheduled_today.append({
            "race_id": r.get("id"),
            "class_id": cls.get("id"),
            "class_name": cls.get("name", "Class"),
            "series_id": ser.get("id"),
            "series_name": ser.get("name", "Series"),
            "race_number": r.get("race_number"),
            "race_label": r.get("mini_group_label") or f"Race {r.get('race_number') or ''}".strip(),
            "date": r.get("date"),
            "start_time": r.get("start_time") or cls.get("default_start_time"),
            "actual_start": r.get("actual_start"),
            "course": r.get("course") or "",
            "special_rules": r.get("special_rules") or "",
            "life_jackets": bool(r.get("life_jackets")),
            "status": r_status,
        })

    for s in scoped_series:
        sched = s.get("schedule") or []
        cls = class_by_id.get(s.get("class_id"), {})
        for idx, d_str in enumerate(sched):
            rn = idx + 1
            if d_str == target_date and (s["id"], rn) not in seen_sched_keys:
                scheduled_today.append({
                    "race_id": None,
                    "class_id": cls.get("id"),
                    "class_name": cls.get("name", "Class"),
                    "series_id": s["id"],
                    "series_name": s.get("name", "Series"),
                    "race_number": rn,
                    "race_label": f"Race {rn}",
                    "date": d_str,
                    "start_time": cls.get("default_start_time") or "",
                    "actual_start": None,
                    "course": "",
                    "special_rules": "",
                    "life_jackets": False,
                    "status": "scheduled",
                })

    scheduled_today.sort(key=lambda x: (x.get("start_time") or "99:99", x.get("class_name") or "", x.get("race_number") or 0))

    # Derive live courses, start sequence and notes from active races when not overridden
    live_courses = []
    live_notes = []
    any_life_jackets = False
    for item in scheduled_today:
        if item.get("course"):
            entry = f"{item['class_name']}: {item['course']}"
            if entry not in live_courses:
                live_courses.append(entry)
        if item.get("special_rules"):
            note_entry = f"{item['class_name']}: {item['special_rules']}"
            if note_entry not in live_notes:
                live_notes.append(note_entry)
        if item.get("life_jackets"):
            any_life_jackets = True

    # Pull recent published race-day notices from Official Notice Board if available
    recent_announcements = []
    if hasattr(db, "notices") and club.get("official_notice_board") is not False:
        try:
            notice_docs = await db.notices.find(
                {"club_id": club_id, "status": "published"},
                {"_id": 0, "id": 1, "title": 1, "notice_type": 1, "published_at": 1, "created_at": 1, "fields": 1},
            ).sort("created_at", -1).limit(3).to_list(3)
            for nd in notice_docs:
                fields = nd.get("fields") or {}
                summary = (
                    fields.get("instruction")
                    or fields.get("new_wording")
                    or fields.get("reason")
                    or fields.get("results_status")
                    or fields.get("body")
                    or ""
                )
                recent_announcements.append({
                    "id": nd.get("id"),
                    "title": nd.get("title") or "Notice",
                    "summary": str(summary).strip()[:200],
                })
        except Exception:
            pass

    # Determine overall race-day status
    derived_status = configured_info.get("status") or ""
    if not derived_status and scheduled_today:
        statuses = {item["status"] for item in scheduled_today}
        if "racing" in statuses:
            derived_status = "racing"
        elif "provisional" in statuses:
            derived_status = "provisional"
        elif statuses == {"completed"}:
            derived_status = "completed"
        elif "abandoned" in statuses and len(statuses) == 1:
            derived_status = "abandoned"
        else:
            derived_status = "scheduled"

    # Racing calendar summary: upcoming planned race dates across the club's
    # series, grouped by date (soonest first). Only the next few dates are shown.
    calendar_by_date: Dict[str, List[Dict[str, Any]]] = {}
    for s in all_series:
        cls = class_by_id.get(s.get("class_id"), {})
        for idx, d_str in enumerate(s.get("schedule") or []):
            if not d_str or str(d_str) < today_iso:
                continue
            calendar_by_date.setdefault(str(d_str), []).append({
                "series_name": s.get("name", "Series"),
                "class_name": cls.get("name", "Class"),
                "race_number": idx + 1,
            })
    racing_calendar = [
        {
            "date": d_str,
            "races": sorted(items, key=lambda x: (x["class_name"], x["race_number"])),
        }
        for d_str, items in sorted(calendar_by_date.items())
    ][:CALENDAR_SUMMARY_DAYS]

    race_day_payload = {
        "title": configured_info.get("title") or (active_event_title if scheduled_today else ""),
        "date": configured_info.get("date") or (target_date if scheduled_today else today_iso),
        "race_officer": configured_info.get("race_officer") if tv_config.get("show_race_officer", True) else "",
        "status": derived_status if tv_config.get("show_status", True) else "",
        "courses": configured_info.get("courses") if tv_config.get("show_courses", True) else "",
        "live_courses": live_courses if tv_config.get("show_courses", True) else [],
        "course_diagram": configured_info.get("course_diagram") if tv_config.get("show_courses", True) else "",
        "start_sequence": configured_info.get("start_sequence") if tv_config.get("show_schedule", True) else "",
        "schedule": scheduled_today if tv_config.get("show_schedule", True) else [],
        "notes": configured_info.get("notes") if tv_config.get("show_notes", True) else "",
        "live_notes": live_notes if tv_config.get("show_notes", True) else [],
        "life_jackets": any_life_jackets if tv_config.get("show_notes", True) else False,
        "announcements": configured_info.get("announcements") if tv_config.get("show_announcements", True) else "",
        "onb_notices": recent_announcements if tv_config.get("show_announcements", True) else [],
        "calendar": racing_calendar if tv_config.get("show_calendar", True) else [],
        "updated_at": configured_info.get("updated_at"),
    }

    return {
        "club": {
            "id": club["id"],
            "name": club.get("name", "Sailing Club"),
            "slug": club.get("slug", ""),
            "abbr": club.get("abbr"),
            "color": club.get("color", "#0A369D"),
            "icon": club.get("icon"),
        },
        "active_event": {
            "title": active_event_title,
            "year": effective_year,
            "series_id": selected_series["id"] if selected_series else None,
            "series_name": selected_series.get("name") if selected_series else None,
            "regatta_id": selected_regatta["id"] if selected_regatta else None,
            "regatta_name": selected_regatta.get("name") if selected_regatta else None,
        },
        "config": tv_config,
        "views": {
            "overall": overall_views,
            "classes": class_views,
            "latest_races": latest_races_views,
            "series_progress": series_progress_views,
        },
        "race_day": race_day_payload,
        "results_date": race_day_date,
        "generated_at": m.now_iso(),
    }
