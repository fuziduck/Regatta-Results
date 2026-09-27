"""Public SEO metadata and sitemap support for SailScore's client-rendered app.

Normal browsers receive the existing React SPA and update route metadata through
``/api/seo-meta``. Search and social crawlers that do not execute JavaScript are
served a small, route-specific HTML summary by nginx via ``/api/seo-html``.
Only public club, class, boat, event, series and published-race data is read.
"""

from __future__ import annotations

import html
import json
import os
import re
import unicodedata
from datetime import date
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, Response

router = APIRouter(prefix="/api", tags=["public SEO"])

SITE_NAME = "SailScore"
DEFAULT_DESCRIPTION = "Club sailing race results, standings and race history from clubs across the UK."
SITEMAP_LIMIT = 50_000


def _public_base(request: Request) -> str:
    environment = os.environ.get("ENV", "development").strip().lower()
    configured = (os.environ.get("PUBLIC_APP_BASE_URL") or "").strip()
    if not configured and environment != "production":
        configured = (os.environ.get("APP_BASE_URL") or "").strip()
    parsed = urlsplit(configured) if configured else None
    if (
        parsed
        and parsed.scheme in ("https", "http")
        and parsed.netloc
        and not parsed.username
        and not parsed.password
    ):
        return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    # In production, APP_BASE_URL is used for password-reset emails and must
    # not silently determine canonical SEO URLs. Never trust arbitrary Host.
    if environment == "production":
        return "https://www.sailscore.co.uk"
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    scheme = scheme.split(",", 1)[0].strip().lower()
    if scheme not in ("https", "http"):
        scheme = "http"
    host = request.headers.get(
        "x-forwarded-host", request.headers.get("host", "localhost:3000")
    ).split(",", 1)[0]
    if not re.fullmatch(r"[A-Za-z0-9.\-:\[\]]+", host):
        host = "localhost:3000"
    return f"{scheme}://{host}".rstrip("/")


def _slug(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").lower())
    text = re.sub(r"[\u0300-\u036f]", "", text)
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-") or "results"


def _class_group_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _boat_path(fleet_id: str, name: str) -> str:
    return f"/boat/{quote(str(fleet_id), safe='')}/{_slug(name)}"


def _class_path(class_id: str, name: str) -> str:
    return f"/class/{quote(str(class_id), safe='')}/{_slug(name)}"


def _group_class_path(name: str) -> str:
    return f"/class/group/{quote(_class_group_key(name), safe='')}/{_slug(name)}"


def _series_path(club_slug: str, series: dict) -> str:
    label = _slug(f"{series.get('name', '')} {series.get('year', '')}")
    params = _query_string({"class": series.get("class_id"), "year": series.get("year")})
    series_id = quote(str(series.get("id", "")), safe="")
    return f"/club/{quote(str(club_slug), safe='')}/series/{series_id}/{label}{params}"


def _competition_path(club_slug: str, event: dict) -> str:
    kind = "competition" if event.get("competition_type") == "championship" else "regatta"
    label = _slug(f"{event.get('name', '')} {event.get('year', '')}")
    event_id = quote(str(event.get("id", "")), safe="")
    return f"/club/{quote(str(club_slug), safe='')}/{kind}/{event_id}/{label}"


def _race_path(club_slug: str, race: dict, class_name: str, series_name: str) -> str:
    label = _slug(
        f"{class_name} {series_name} race {race.get('race_number', '')} {race.get('year', '')}"
    )
    race_id = quote(str(race.get("id", "")), safe="")
    return f"/club/{quote(str(club_slug), safe='')}/race/{race_id}/{label}"


def _absolute(base: str, path: str) -> str:
    return f"{base}{path if path.startswith('/') else f'/{path}'}"


def _clean_description(value: Any, fallback: str = DEFAULT_DESCRIPTION) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip() or fallback
    return text[:300]


def _external_image(value: Any) -> str | None:
    image = str(value or "").strip()
    return image if image.startswith(("https://", "http://")) else None


def _organization(name: str, url: str, logo: str | None = None) -> dict:
    organization = {"@type": "SportsOrganization", "name": name, "url": url}
    safe_logo = _external_image(logo)
    if safe_logo:
        organization["logo"] = safe_logo
    return organization


def _page(
    base: str,
    path: str,
    title: str,
    description: str,
    *,
    image: str | None = None,
    kind: str = "website",
    robots: str = "index,follow",
    schema: Any = None,
    body: str | None = None,
    status: int = 200,
) -> dict:
    return {
        "base": base,
        "path": path,
        "canonical": _absolute(base, path),
        "title": str(title)[:180],
        "description": _clean_description(description),
        "image": _external_image(image) or _absolute(base, "/sailscore-logo.png"),
        "kind": kind,
        "robots": robots,
        "schema": schema,
        "body": body or description,
        "status": status,
    }


def _not_found(
    base: str,
    path: str,
    description: str = "This public SailScore page could not be found.",
) -> dict:
    return _page(
        base,
        path,
        "Page not found | SailScore",
        description,
        robots="noindex,nofollow",
        status=404,
    )


def _noindex_page(base: str, path: str, title: str, description: str) -> dict:
    return _page(base, path, title, description, robots="noindex,nofollow")


def _render_html(page: dict) -> str:
    def esc(value: Any) -> str:
        return html.escape(str(value or ""), quote=True)

    tags = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f'<meta name="description" content="{esc(page["description"])}">',
        f'<meta name="robots" content="{esc(page["robots"])}">',
        f'<link rel="canonical" href="{esc(page["canonical"])}">',
        f'<meta property="og:type" content="{esc(page["kind"])}">',
        f'<meta property="og:site_name" content="{SITE_NAME}">',
        f'<meta property="og:title" content="{esc(page["title"])}">',
        f'<meta property="og:description" content="{esc(page["description"])}">',
        f'<meta property="og:url" content="{esc(page["canonical"])}">',
        f'<meta property="og:image" content="{esc(page["image"])}">',
        f'<meta property="og:image:alt" content="{SITE_NAME} sailing results">',
        '<meta property="og:locale" content="en_GB">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{esc(page["title"])}">',
        f'<meta name="twitter:description" content="{esc(page["description"])}">',
        f'<meta name="twitter:image" content="{esc(page["image"])}">',
        '<meta name="theme-color" content="#0A369D">',
    ]
    if page.get("schema"):
        schema = json.dumps(page["schema"], ensure_ascii=False, separators=(",", ":"))
        # Data-controlled strings cannot terminate the JSON-LD script element.
        schema = (
            schema.replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("&", "\\u0026")
        )
        tags.append(f'<script type="application/ld+json">{schema}</script>')
    title = esc(page["title"])
    body = esc(page.get("body") or page["description"])
    canonical = esc(page["canonical"])
    return (
        '<!doctype html><html lang="en"><head>'
        + "".join(tags)
        + f"<title>{title}</title></head><body><main><h1>{title}</h1>"
        + f'<p>{body}</p><p><a href="{canonical}">{title}</a></p>'
        + f'<a href="{esc(page["base"])}/">SailScore home</a>'
        + "</main></body></html>"
    )


async def _find_one(db, collection: str, query: dict, projection: dict | None = None):
    coll = getattr(db, collection, None)
    if coll is None:
        return None
    return await coll.find_one(query, projection or {"_id": 0})


async def _to_list(
    db,
    collection: str,
    query: dict,
    limit: int = 5000,
    projection: dict | None = None,
) -> list[dict]:
    coll = getattr(db, collection, None)
    if coll is None:
        return []
    return await coll.find(query, projection or {"_id": 0}).to_list(limit)


async def _published_count(db, series_id: str) -> int:
    coll = getattr(db, "races", None)
    if coll is None:
        return 0
    return await coll.count_documents(
        {
            "series_id": series_id,
            "status": "published",
            "abandoned": {"$ne": True},
        }
    )


async def _published_counts(db, series_ids: list[Any]) -> dict[str, int]:
    ids = list({str(value) for value in series_ids if value})
    coll = getattr(db, "races", None)
    if not ids or coll is None:
        return {}
    rows = await coll.find(
        {
            "series_id": {"$in": ids},
            "status": "published",
            "abandoned": {"$ne": True},
        },
        {"_id": 0, "series_id": 1},
    ).to_list(50_000)
    counts: dict[str, int] = {}
    for row in rows:
        key = str(row.get("series_id"))
        counts[key] = counts.get(key, 0) + 1
    return counts


async def _published_class_count(db, class_id: Any, year: int | None = None) -> int:
    series_rows = await _to_list(
        db,
        "series",
        {"class_id": class_id},
        5000,
        {"_id": 0, "id": 1},
    )
    series_ids = [item.get("id") for item in series_rows if item.get("id")]
    if not series_ids:
        return 0
    query = {
        "class_id": class_id,
        "series_id": {"$in": series_ids},
        "status": "published",
        "abandoned": {"$ne": True},
    }
    if year is not None:
        query["year"] = year
    return await db.races.count_documents(query)


def _query_string(values: dict) -> str:
    clean = {key: str(value) for key, value in values.items() if value not in (None, "")}
    return f"?{urlencode(sorted(clean.items()))}" if clean else ""


def _event_datetime(day: Any, time: Any = None) -> str | None:
    value = str(day or "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    if time and re.fullmatch(r"\d{1,2}:\d{2}", str(time)):
        hour, minute = map(int, str(time).split(":"))
        if hour < 24 and minute < 60:
            return f"{value}T{hour:02d}:{minute:02d}:00"
    return value


def _is_public_club(club: dict | None) -> bool:
    """Legacy clubs remain public; applicant-created clubs require approval."""
    return bool(club and club.get("approval_status", "approved") == "approved")


def _private_path(path: str) -> bool:
    private_prefixes = (
        r"^/(?:admin|officer|webmaster)(?:/|$)",
        r"^/notice/new(?:/|$)",
        r"^/(?:login|forgot-password|reset-password|club-registration)(?:/|$)",
        r"^/subscriptions(?:/|$)",
    )
    return any(re.match(pattern, path) for pattern in private_prefixes)


def _valid_year(value: str | None) -> int | None:
    try:
        year = int(value) if value else None
    except (TypeError, ValueError):
        return None
    return year if year and 2000 < year <= 2200 else None


def _has_upcoming_schedule(series_rows: list[dict], today: str | None = None) -> bool:
    current_date = today or date.today().isoformat()
    return any(
        str(scheduled) >= current_date
        for series in series_rows
        for scheduled in (series.get("schedule") or [])
        if scheduled
    )


async def _series_for_event(db, event: dict, club_id: str) -> list[dict]:
    """Match linked series plus the API's read-only legacy-name fallback."""
    event_id = event.get("id")
    direct = await _to_list(db, "series", {"regatta_id": event_id}, 5000)
    if not event.get("year") or not event.get("name"):
        return direct
    candidates = await _to_list(db, "series", {
        "year": event.get("year"),
        "regatta_id": {"$exists": True},
    }, 5000)
    class_ids = list({item.get("class_id") for item in candidates if item.get("class_id")})
    classes = (
        await _to_list(
            db,
            "classes",
            {"id": {"$in": class_ids}},
            5000,
            {"_id": 0, "id": 1, "club_id": 1},
        )
        if class_ids
        else []
    )
    class_clubs = {item.get("id"): item.get("club_id") for item in classes}
    name = str(event.get("name") or "").strip().casefold()
    prefix = f"{name} "
    direct_ids = {item.get("id") for item in direct}
    legacy = [
        item
        for item in candidates
        if item.get("id") not in direct_ids
        and class_clubs.get(item.get("class_id")) == club_id
        and (
            str(item.get("name") or "").strip().casefold() == name
            or str(item.get("name") or "").strip().casefold().startswith(prefix)
        )
    ]
    return direct + legacy


async def _metadata_for_uri(request: Request, original_uri: str | None = None) -> dict:
    db = request.app.state.db
    base = _public_base(request)
    raw_uri = original_uri or request.headers.get("x-original-uri") or request.url.path
    parsed = urlsplit(raw_uri)
    path = parsed.path or "/"
    parts = [unquote(part) for part in path.split("/") if part]
    if any(part in (".", "..") or "\\" in part for part in parts):
        return _not_found(base, path)
    query = parse_qs(parsed.query)
    logo = _absolute(base, "/sailscore-logo.png")

    if path == "/":
        title = "Club Sailing Results & Standings | SailScore"
        description = "Browse sailing clubs, live race results, regattas and championship standings on SailScore."
        schema = {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": SITE_NAME,
            "url": _absolute(base, "/"),
            "publisher": {"@type": "Organization", "name": SITE_NAME, "url": _absolute(base, "/")},
        }
        return _page(
            base,
            "/",
            title,
            description,
            image=logo,
            schema=schema,
            body="Browse club sailing results, standings, classes and upcoming races.",
        )

    if path == "/boats":
        return _noindex_page(
            base,
            path,
            "Find a Boat | SailScore",
            "Search public boat profiles and sailing results on SailScore.",
        )

    if _private_path(path):
        return _noindex_page(
            base,
            path,
            "Private SailScore workspace",
            "This SailScore account or authenticated workspace is not available for public search indexing.",
        )

    if len(parts) == 3 and parts[0] == "club" and parts[2] in ("calendar", "notice-board"):
        club = await _find_one(db, "clubs", {"slug": parts[1]})
        if not club or not _is_public_club(club):
            return _not_found(base, path)
        club_name = club.get("name") or "Sailing Club"
        club_path = f"/club/{quote(str(club.get('slug')), safe='')}"
        if parts[2] == "calendar":
            path_out = f"{club_path}/calendar"
            classes = await _to_list(db, "classes", {"club_id": club.get("id")}, 5000,
                                     {"_id": 0, "id": 1})
            class_ids = [item.get("id") for item in classes]
            series_rows = await _to_list(db, "series", {"class_id": {"$in": class_ids}}, 5000) if class_ids else []
            has_upcoming = _has_upcoming_schedule(series_rows)
            if not has_upcoming:
                return _noindex_page(base, path_out, f"{club_name} Race Calendar | SailScore",
                                     f"Upcoming sailing races for {club_name} will appear here when scheduled.")
            title = f"{club_name} Race Calendar | SailScore"
            description = f"See upcoming sailing races and scheduled events at {club_name}."
            return _page(base, path_out, title, description, image=club.get("icon") or logo,
                         schema={"@context": "https://schema.org", "@type": "CollectionPage",
                                 "name": title, "url": _absolute(base, path_out),
                                 "about": _organization(club_name, _absolute(base, club_path), club.get("icon"))})
        path_out = f"{club_path}/notice-board"
        if club.get("official_notice_board") is False:
            return _noindex_page(base, path_out, f"{club_name} Notice Board | SailScore",
                                 "This club is not currently using the Official Notice Board.")
        title = f"{club_name} Official Notice Board | SailScore"
        description = f"Official sailing notices, instructions, hearings and club information from {club_name}."
        return _noindex_page(base, path_out, title, description)

    if len(parts) == 2 and parts[0] == "club":
        club = await _find_one(db, "clubs", {"slug": parts[1]})
        if not club or not _is_public_club(club):
            return _not_found(base, path)
        club_name = club.get("name") or "Sailing Club"
        year = _valid_year(query.get("year", [None])[0])
        class_id = query.get("class", [None])[0]
        series_id = query.get("series", [None])[0]
        series_page = bool(class_id or series_id or query.get("year"))
        class_doc = await _find_one(db, "classes", {"id": class_id, "club_id": club.get("id")}) if class_id else None
        series = await _find_one(db, "series", {"id": series_id}) if series_id else None
        if series:
            candidate_class = await _find_one(db, "classes", {
                "id": series.get("class_id"), "club_id": club.get("id"),
            })
            if candidate_class and (not class_doc or candidate_class.get("id") == class_doc.get("id")):
                class_doc = candidate_class
            else:
                series = None
        if series and await _published_count(db, str(series.get("id"))) == 0:
            series = None
        values = {}
        if class_doc:
            values["class"] = class_doc.get("id")
        if series:
            values["series"] = series.get("id")
        if year:
            values["year"] = year
        canonical_path = f"/club/{quote(str(club.get('slug')), safe='')}" + _query_string(values)

        if series and class_doc:
            count = await _published_count(db, str(series.get("id")))
            display_year = series.get("year") or year or ""
            title = f"{series.get('name') or 'Series'} {display_year} Results – {class_doc.get('name')} | {club_name} | SailScore"
            description = f"{series.get('name') or 'Series'} {display_year} sailing results and standings for {class_doc.get('name')} at {club_name}, with {count} published race{'s' if count != 1 else ''}."
            canonical_path = _series_path(str(club.get("slug")), series)
            schema = {
                "@context": "https://schema.org", "@type": "CollectionPage", "name": title,
                "url": _absolute(base, canonical_path),
                "about": {"@type": "Thing", "name": series.get("name"), "sport": "Sailing"},
                "publisher": _organization(club_name, _absolute(base, f"/club/{club['slug']}")),
            }
            return _page(base, canonical_path, title, description, image=club.get("icon") or logo,
                         schema=schema, body=f"{description} {class_doc.get('name')} class at {club_name}.")

        if class_id and not class_doc:
            return _not_found(base, path, "Sailing class could not be found for this club.")
        if series_id and not series:
            return _not_found(base, path, "Published series results could not be found for this class.")
        if class_doc:
            display_year = year or date.today().year
            count = await _published_class_count(db, class_doc.get("id"), year)
            title = f"{class_doc.get('name')} {display_year} Overall Standings – {club_name} | SailScore"
            description = f"View {class_doc.get('name')} sailing results, overall standings and published race history for {club_name}{f' in {display_year}' if display_year else ''}."
            if count <= 0:
                return _noindex_page(base, canonical_path, title,
                                     "Published class and series results will appear here when available.")
            schema = {
                "@context": "https://schema.org", "@type": "CollectionPage", "name": title,
                "url": _absolute(base, canonical_path),
                "about": _organization(club_name, _absolute(base, f"/club/{club['slug']}")),
            }
            return _page(base, canonical_path, title, description, image=club.get("icon") or logo,
                         schema=schema, body=f"{description} {count} published races.")

        if not series_page:
            club_classes = await _to_list(db, "classes", {"club_id": club.get("id")}, 5000,
                                          {"_id": 0, "id": 1})
            club_class_ids = [item.get("id") for item in club_classes]
            club_series = await _to_list(db, "series", {"class_id": {"$in": club_class_ids}}, 5000) if club_class_ids else []
            live_series_ids = [item.get("id") for item in club_series if item.get("id")]
            has_results = bool(club_class_ids and live_series_ids and await db.races.count_documents({
                "class_id": {"$in": club_class_ids}, "series_id": {"$in": live_series_ids},
                "status": "published", "abandoned": {"$ne": True},
            }))
            has_schedule = _has_upcoming_schedule(club_series)
            if not (has_results or has_schedule):
                return _noindex_page(base, path, f"{club_name} Sailing Results | SailScore",
                                     f"Published sailing results for {club_name} will appear here when available.")
        title = f"{club_name}{f' {year}' if year else ''} Sailing Results & Standings | SailScore"
        description = f"{club_name} sailing results, championship standings, regattas, upcoming races and class results on SailScore."
        if series_page:
            club_classes = await _to_list(db, "classes", {"club_id": club.get("id")}, 5000,
                                          {"_id": 0, "id": 1})
            class_ids = [item.get("id") for item in club_classes]
            club_series = await _to_list(db, "series", {"class_id": {"$in": class_ids}}, 5000) if class_ids else []
            series_ids = [item.get("id") for item in club_series if item.get("id")]
            race_query = {
                "class_id": {"$in": class_ids}, "series_id": {"$in": series_ids},
                "status": "published", "abandoned": {"$ne": True},
            }
            if year:
                race_query["year"] = year
            count = await db.races.count_documents(race_query) if class_ids and series_ids else 0
            if (class_id and not class_doc) or (series_id and not series):
                return _not_found(base, path, "Published class or series results could not be found.")
            if count <= 0:
                return _noindex_page(base, canonical_path, title, description)
        schema = {
            "@context": "https://schema.org", "@type": "CollectionPage", "name": title,
            "url": _absolute(base, canonical_path),
            "about": _organization(club_name, _absolute(base, f"/club/{club['slug']}"), club.get("icon")),
        }
        return _page(base, canonical_path, title, description, image=club.get("icon") or logo,
                     schema=schema, body=description)

    if len(parts) in (4, 5) and parts[0] == "club" and parts[2] == "series":
        club = await _find_one(db, "clubs", {"slug": parts[1]})
        series = await _find_one(db, "series", {"id": parts[3]})
        class_doc = await _find_one(db, "classes", {"id": (series or {}).get("class_id")})
        if (not club or not _is_public_club(club) or not series or not class_doc
                or class_doc.get("club_id") != club.get("id")):
            return _not_found(base, path)
        count = await _published_count(db, str(series.get("id")))
        if count <= 0:
            return _noindex_page(base, path, "Series Results | SailScore",
                                 "Published series results will appear here when available.")
        canonical_path = _series_path(str(club.get("slug")), series)
        year = series.get("year") or ""
        query = {key: values[0] for key, values in parse_qs(parsed.query).items() if key in ("class", "year") and values}
        if query.get("class") and query["class"] != str(series.get("class_id")):
            return _not_found(base, path, "Published series results could not be found for this class.")
        if query.get("year") and query["year"] != str(series.get("year")):
            return _not_found(base, path, "Published series results could not be found for this year.")
        title = f"{series.get('name') or 'Series'} {year} Results – {class_doc.get('name')} | {club.get('name')} | SailScore"
        description = f"{series.get('name') or 'Series'} {year} sailing results and standings for {class_doc.get('name')} at {club.get('name')}, with {count} published race{'s' if count != 1 else ''}."
        schema = {
            "@context": "https://schema.org", "@type": "CollectionPage", "name": title,
            "url": _absolute(base, canonical_path),
            "about": {"@type": "Thing", "name": series.get("name"), "sport": "Sailing"},
            "publisher": _organization(club.get("name") or "Sailing Club", _absolute(base, f"/club/{club['slug']}")),
        }
        return _page(base, canonical_path, title, description, image=club.get("icon") or logo,
                     schema=schema, body=f"{description} {count} published races.")

    if len(parts) in (4, 5) and parts[0] == "club" and parts[2] in ("regatta", "competition"):
        club = await _find_one(db, "clubs", {"slug": parts[1]})
        event = await _find_one(db, "regattas", {"id": parts[3]})
        if not club or not _is_public_club(club) or not event or event.get("club_id") != club.get("id"):
            return _not_found(base, path)
        canonical_path = _competition_path(str(club.get("slug")), event)
        event_type = event.get("competition_type") or "regatta"
        label = "Championship" if event_type == "championship" else "Regatta"
        year = event.get("year")
        year_label = f" {year}" if year else ""
        title = f"{event.get('name')}{year_label} Results | SailScore"
        host_club = event.get("host_club") or club.get("name") or "the host club"
        description = f"{event.get('name')}{year_label} sailing results, standings and race results from {host_club}."
        if event.get("description"):
            description = f"{description} {event['description']}"
        schema_event = {
            "@type": "SportsEvent",
            "name": event.get("name"),
            "url": _absolute(base, canonical_path),
            "description": description,
            "sport": "Sailing",
            "organizer": _organization(
                club.get("name") or "Sailing Club",
                _absolute(base, f"/club/{club['slug']}"),
                club.get("icon"),
            ),
        }
        start = _event_datetime(event.get("start_date"))
        end = _event_datetime(event.get("end_date"))
        if start:
            schema_event["startDate"] = start
        if end:
            schema_event["endDate"] = end
        status = str(event.get("status") or "").strip().lower().replace(" ", "_")
        schema_status = {
            "upcoming": "EventScheduled",
            "scheduled": "EventScheduled",
            "in_progress": "EventInProgress",
            "complete": "EventCompleted",
            "completed": "EventCompleted",
            "cancelled": "EventCancelled",
            "postponed": "EventPostponed",
        }.get(status)
        if schema_status:
            schema_event["eventStatus"] = f"https://schema.org/{schema_status}"
        image = _external_image(event.get("thumbnail")) or _external_image(club.get("icon")) or logo
        schema_event["image"] = image
        event_series = await _series_for_event(db, event, str(club.get("id")))
        class_ids = list({item.get("class_id") for item in event_series if item.get("class_id")})
        event_classes = await _to_list(
            db,
            "classes",
            {"id": {"$in": class_ids}, "club_id": club.get("id")},
            5000,
            {"_id": 0, "id": 1},
        ) if class_ids else []
        valid_class_ids = {item.get("id") for item in event_classes}
        event_series = [item for item in event_series if item.get("class_id") in valid_class_ids]
        race_count = sum(
            [await _published_count(db, str(item.get("id"))) for item in event_series]
        )
        has_event_details = any(
            event.get(field)
            for field in ("start_date", "end_date", "description", "date_label", "host_club")
        )
        if race_count <= 0 and not has_event_details:
            return _noindex_page(
                base,
                canonical_path,
                f"{event.get('name')} | SailScore",
                "Published event results will appear here when available.",
            )
        details = [
            str(item)
            for item in (year, event.get("date_label"), host_club)
            if item
        ]
        summary = (
            f"{event.get('name')} · {label} · {' · '.join(details)} · "
            f"{race_count} published race{'s' if race_count != 1 else ''}."
        )
        return _page(
            base,
            canonical_path,
            title,
            description,
            image=image,
            kind="article",
            schema={"@context": "https://schema.org", **schema_event},
            body=summary,
        )

    if len(parts) in (4, 5) and parts[0] == "club" and parts[2] == "race":
        race = await _find_one(
            db,
            "races",
            {"id": parts[3], "status": "published", "abandoned": {"$ne": True}},
        )
        if not race:
            return _not_found(base, path, "Published race results could not be found.")
        class_doc = await _find_one(db, "classes", {"id": race.get("class_id")})
        club = await _find_one(db, "clubs", {"id": (class_doc or {}).get("club_id")})
        series = (
            await _find_one(db, "series", {"id": race.get("series_id")})
            if race.get("series_id")
            else None
        )
        if not class_doc or not _is_public_club(club) or club.get("slug") != parts[1]:
            return _not_found(base, path, "Published race results could not be found for this club.")
        if race.get("series_id") and (
            not series or series.get("class_id") != class_doc.get("id")
        ):
            return _not_found(base, path, "Published race series could not be found.")
        class_name = class_doc.get("name") or "Sailing"
        series_name = (series or {}).get("name") or "Race Results"
        canonical_path = _race_path(str(club.get("slug")), race, class_name, series_name)
        race_no = race.get("race_number")
        title = f"{class_name} Race {race_no} Results – {club.get('name')} | SailScore"
        description = (
            f"Race {race_no} sailing results for {class_name} at {club.get('name')}, "
            f"sailed {race.get('date') or 'during the season'}. "
            "View finishing positions and points on SailScore."
        )
        schema_event = {
            "@context": "https://schema.org",
            "@type": "SportsEvent",
            "name": title,
            "url": _absolute(base, canonical_path),
            "description": description,
            "sport": "Sailing",
            "eventStatus": "https://schema.org/EventCompleted",
            "organizer": _organization(
                club.get("name") or "Sailing Club",
                _absolute(base, f"/club/{club['slug']}"),
                club.get("icon"),
            ),
        }
        start = _event_datetime(race.get("date"), race.get("start_time"))
        if start:
            schema_event["startDate"] = start
        results = race.get("results") or []
        boat_ids = list({str(item.get("boat_id")) for item in results if item.get("boat_id")})
        boats = await _to_list(
            db,
            "boats",
            {"id": {"$in": boat_ids}},
            1000,
            {"_id": 0, "id": 1, "name": 1, "sail_no": 1},
        ) if boat_ids else []
        boats_by_id = {str(item.get("id")): item for item in boats}
        finished = sorted(
            (item for item in results if item.get("code") == "FINISHED"),
            key=lambda item: (
                item.get("position") is None,
                item.get("position") if item.get("position") is not None else 10**9,
            ),
        )
        leaders = []
        for result in finished:
            if len(leaders) >= 5:
                break
            boat = boats_by_id.get(str(result.get("boat_id")), {})
            if not boat.get("name"):
                continue
            sail_no = f" ({boat['sail_no']})" if boat.get("sail_no") else ""
            position = f"{result['position']}. " if result.get("position") is not None else ""
            leaders.append(f"{position}{boat['name']}{sail_no}")
        leaderboard = f" Top published finishers: {'; '.join(leaders)}." if leaders else ""
        body = (
            f"{description} {len(results)} published entries in {series_name}."
            f"{leaderboard}"
        )
        return _page(
            base,
            canonical_path,
            title,
            description,
            kind="article",
            schema=schema_event,
            image=_external_image(club.get("icon")) or logo,
            body=body,
        )

    if len(parts) in (2, 3) and parts[0] == "boat":
        requested_id = parts[1]
        members = await _to_list(
            db,
            "boats",
            {"$or": [{"fleet_id": requested_id}, {"id": requested_id}]},
            2000,
        )
        if not members:
            return _not_found(base, path, "Boat profile could not be found.")
        fleet_keys = list({item.get("fleet_key") for item in members if item.get("fleet_key")})
        if fleet_keys:
            linked = await _to_list(db, "boats", {"fleet_key": {"$in": fleet_keys}}, 2000)
            known_ids = {str(item.get("id")) for item in members if item.get("id")}
            members.extend(item for item in linked if str(item.get("id")) not in known_ids)
        member_ids = [str(item.get("id")) for item in members if item.get("id")]
        member_ids_by_class: dict[str, set[str]] = {}
        for item in members:
            if item.get("class_id") and item.get("id"):
                member_ids_by_class.setdefault(str(item["class_id"]), set()).add(str(item["id"]))
        member_class_ids = list(member_ids_by_class)
        class_rows = await _to_list(
            db,
            "classes",
            {"id": {"$in": member_class_ids}},
            5000,
            {"_id": 0, "id": 1, "club_id": 1},
        ) if member_class_ids else []
        public_club_ids = {
            str(item.get("id"))
            for item in await _to_list(db, "clubs", {}, 10000, {"_id": 0, "id": 1, "approval_status": 1})
            if item.get("id") and _is_public_club(item)
        }
        public_class_ids = {
            str(item.get("id")) for item in class_rows
            if item.get("id") and str(item.get("club_id")) in public_club_ids
        }
        members = [item for item in members if str(item.get("class_id")) in public_class_ids]
        if not members:
            return _not_found(base, path, "Boat profile could not be found.")
        member_ids = [str(item.get("id")) for item in members if item.get("id")]
        member_ids_by_class = {}
        for item in members:
            if item.get("class_id") and item.get("id"):
                member_ids_by_class.setdefault(str(item["class_id"]), set()).add(str(item["id"]))
        member_class_ids = list(public_class_ids)
        member_series = await _to_list(
            db,
            "series",
            {"class_id": {"$in": member_class_ids}},
            5000,
            {"_id": 0, "id": 1, "class_id": 1},
        ) if member_class_ids else []
        series_by_id = {str(item.get("id")): item for item in member_series if item.get("id")}
        races = await _to_list(
            db,
            "races",
            {
                "class_id": {"$in": member_class_ids},
                "series_id": {"$in": list(series_by_id)},
                "status": "published",
                "abandoned": {"$ne": True},
                "results.boat_id": {"$in": member_ids},
            },
            5000,
            {"_id": 0, "class_id": 1, "series_id": 1, "results": 1},
        ) if series_by_id else []
        raced = any(
            series_by_id.get(str(race.get("series_id")), {}).get("class_id") == race.get("class_id")
            and str(result.get("boat_id")) in member_ids_by_class.get(str(race.get("class_id")), set())
            and result.get("code") not in ("DNC", "DNS")
            for race in races
            for result in (race.get("results") or [])
        )
        if not raced:
            return _noindex_page(
                base,
                path,
                "Boat Profile | SailScore",
                "Published race results for this boat will appear here when available.",
            )
        boat = min(members, key=lambda item: item.get("created_at") or "")
        name = boat.get("name") or "Boat"
        sail_no = boat.get("sail_no")
        canonical_fleet_id = boat.get("fleet_id") or boat.get("id") or requested_id
        canonical_members = [
            item for item in await _to_list(
                db,
                "boats",
                {"$or": [{"fleet_id": str(canonical_fleet_id)}, {"id": str(canonical_fleet_id)}]},
                2000,
            )
            if str(item.get("class_id")) in public_class_ids
        ]
        if canonical_members:
            boat = min(canonical_members, key=lambda item: item.get("created_at") or "")
            name = boat.get("name") or name
            sail_no = boat.get("sail_no") or sail_no
            canonical_fleet_id = boat.get("fleet_id") or boat.get("id") or canonical_fleet_id
        canonical_path = _boat_path(str(canonical_fleet_id), name)
        title = f"{name} – SailScore Sailing Results"
        description = f"View {name}'s sailing results, race history and series standings on SailScore."
        schema = {
            "@context": "https://schema.org",
            "@type": "Vehicle",
            "name": name,
            "url": _absolute(base, canonical_path),
            "vehicleType": "Sailboat",
        }
        if sail_no:
            schema["identifier"] = str(sail_no)
        body = f"{name}{f' · Sail No. {sail_no}' if sail_no else ''}. {description}"
        return _page(base, canonical_path, title, description, image=logo, schema=schema, body=body)

    if len(parts) == 4 and parts[:2] == ["class", "group"]:
        public_club_ids = {
            str(item.get("id"))
            for item in await _to_list(db, "clubs", {}, 10000, {"_id": 0, "id": 1, "approval_status": 1})
            if item.get("id") and _is_public_club(item)
        }
        grouped_classes = await _to_list(
            db, "classes", {"scoring_mode": "one_design", "club_id": {"$in": list(public_club_ids)}}, 5000
        ) if public_club_ids else []
        matching_ids = [
            item.get("id") for item in grouped_classes
            if not item.get("divisions")
            and _class_group_key(item.get("name")) == _class_group_key(parts[2])
        ]
        if not matching_ids or await _published_class_count(db, matching_ids[0]) == 0:
            return _not_found(base, path, "Sailing class could not be found.")

    if parts and parts[0] == "class" and len(parts) in (2, 3, 4):
        grouped = parts[1] == "group" and len(parts) in (3, 4)
        if grouped:
            class_key = parts[2]
            public_club_ids = {
                str(item.get("id"))
                for item in await _to_list(db, "clubs", {}, 10000, {"_id": 0, "id": 1, "approval_status": 1})
                if item.get("id") and _is_public_club(item)
            }
            classes = await _to_list(
                db, "classes",
                {"scoring_mode": "one_design", "club_id": {"$in": list(public_club_ids)}},
                5000,
            ) if public_club_ids else []
            matching = [
                item for item in classes
                if _class_group_key(item.get("name")) == _class_group_key(class_key)
                and not item.get("divisions")
            ]
            if not matching:
                return _not_found(base, path, "Sailing class could not be found.")
            class_name = matching[0].get("name") or "Sailing Class"
            class_ids = [item.get("id") for item in matching if item.get("id")]
            series_rows = await _to_list(db, "series", {"class_id": {"$in": class_ids}}, 5000)
            series_race_counts = await _published_counts(db, [item.get("id") for item in series_rows])
            public_series = [
                item for item in series_rows
                if series_race_counts.get(str(item.get("id")), 0) > 0
            ]
            canonical_path = _group_class_path(class_name)
            club_phrase = f"across {len(matching)} clubs"
        else:
            class_id = parts[1]
            class_doc = await _find_one(db, "classes", {"id": class_id})
            if not class_doc:
                return _not_found(base, path, "Sailing class could not be found.")
            class_club = await _find_one(db, "clubs", {"id": class_doc.get("club_id")})
            if not _is_public_club(class_club):
                return _not_found(base, path, "Sailing class could not be found.")
            class_name = class_doc.get("name") or "Sailing Class"
            canonical_path = _class_path(class_id, class_name)
            series_rows = await _to_list(db, "series", {"class_id": class_id}, 5000)
            series_race_counts = await _published_counts(db, [item.get("id") for item in series_rows])
            public_series = [
                item for item in series_rows
                if series_race_counts.get(str(item.get("id")), 0) > 0
            ]
            club = class_club
            club_phrase = f"at {club.get('name')}" if club else ""
        if not public_series:
            return _noindex_page(
                base,
                canonical_path,
                f"{class_name} Results | SailScore",
                f"Published results for {class_name} will appear here when available.",
            )
        title = f"{class_name} Sailing Results, Series & Championships | SailScore"
        description = (
            f"Browse {class_name} sailing results, series, championships and "
            f"published race history {club_phrase} on SailScore."
        )
        schema = {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": title,
            "url": _absolute(base, canonical_path),
            "about": {"@type": "Thing", "name": class_name},
        }
        return _page(base, canonical_path, title, description, image=logo, schema=schema, body=description)

    return _not_found(base, path, "This SailScore route is not a public results page.")


@router.get("/seo-meta", include_in_schema=False)
async def seo_meta(request: Request):
    page = await _metadata_for_uri(request, request.query_params.get("uri"))
    return {
        key: page[key]
        for key in ("title", "description", "canonical", "image", "kind", "robots", "schema")
    }


@router.get("/seo-html", response_class=HTMLResponse, include_in_schema=False)
async def seo_html(request: Request):
    page = await _metadata_for_uri(request, request.query_params.get("uri"))
    return HTMLResponse(_render_html(page), status_code=page.get("status", 200))


@router.get("/robots.txt", include_in_schema=False)
async def robots_txt(request: Request):
    base = _public_base(request)
    content = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/\n"
        "Disallow: /admin\n"
        "Disallow: /officer\n"
        "Disallow: /webmaster\n"
        "Disallow: /login\n"
        "Disallow: /forgot-password\n"
        "Disallow: /reset-password\n"
        "Disallow: /club-registration\n"
        "Disallow: /subscriptions/\n"
        "Disallow: /notice/new\n"
        f"Sitemap: {base}/sitemap.xml\n"
    )
    return Response(content, media_type="text/plain; charset=utf-8")


@router.get("/sitemap.xml", include_in_schema=False)
async def sitemap_xml(request: Request):
    db = request.app.state.db
    base = _public_base(request)
    urls: dict[str, str | None] = {}

    def add(path: str, lastmod: Any = None):
        if len(urls) >= SITEMAP_LIMIT:
            return
        absolute = _absolute(base, path)
        modified = None
        if lastmod:
            try:
                modified = date.fromisoformat(str(lastmod)[:10]).isoformat()
            except ValueError:
                modified = None
        if absolute not in urls or (modified and (not urls[absolute] or modified > urls[absolute])):
            urls[absolute] = modified

    add("/")
    clubs = [
        item for item in await _to_list(db, "clubs", {}, 10000)
        if _is_public_club(item)
    ]
    public_club_ids = {item.get("id") for item in clubs if item.get("id")}
    classes = [
        item for item in await _to_list(db, "classes", {}, 10000)
        if item.get("club_id") in public_club_ids
    ]
    public_class_ids = {item.get("id") for item in classes if item.get("id")}
    series_rows = [
        item for item in await _to_list(db, "series", {}, 50000)
        if item.get("class_id") in public_class_ids
    ]
    live_class_ids = [item.get("id") for item in classes if item.get("id")]
    live_series_ids = [item.get("id") for item in series_rows if item.get("id")]
    races = await _to_list(
        db,
        "races",
        {
            "class_id": {"$in": live_class_ids},
            "series_id": {"$in": live_series_ids},
            "status": "published",
            "abandoned": {"$ne": True},
        },
        50000,
        {
            "_id": 0,
            "id": 1,
            "class_id": 1,
            "series_id": 1,
            "year": 1,
            "race_number": 1,
            "date": 1,
            "published_at": 1,
            "status": 1,
            "abandoned": 1,
            "results.boat_id": 1,
            "results.code": 1,
        },
    )
    club_by_id = {item.get("id"): item for item in clubs}
    class_by_id = {item.get("id"): item for item in classes}
    series_by_id = {item.get("id"): item for item in series_rows}

    # Query membership alone is insufficient: a corrupt race can point at a
    # live series owned by a different class. Exclude such rows from every
    # sitemap count and entity link, just as the individual race page does.
    races = [
        race
        for race in races
        if (class_doc := class_by_id.get(race.get("class_id")))
        and club_by_id.get(class_doc.get("club_id"))
        and (series := series_by_id.get(race.get("series_id")))
        and str(series.get("class_id")) == str(race.get("class_id"))
    ]

    race_count_by_series: dict[str, int] = {}
    race_count_by_class: dict[str, int] = {}
    race_count_by_class_year: dict[tuple[str, int], int] = {}
    boat_ids: set[str] = set()

    for race in races:
        series_id = race.get("series_id")
        if series_id:
            race_count_by_series[str(series_id)] = race_count_by_series.get(str(series_id), 0) + 1
        class_id, race_year = race.get("class_id"), race.get("year")
        if class_id:
            class_key = str(class_id)
            race_count_by_class[class_key] = race_count_by_class.get(class_key, 0) + 1
        if class_id and race_year:
            try:
                key = (str(class_id), int(race_year))
            except (TypeError, ValueError):
                key = None
            if key:
                race_count_by_class_year[key] = race_count_by_class_year.get(key, 0) + 1
        for result in race.get("results") or []:
            if result.get("boat_id") and result.get("code") not in ("DNC", "DNS"):
                boat_ids.add(str(result["boat_id"]))

    for club in clubs:
        slug = club.get("slug")
        if not slug:
            continue
        path = f"/club/{quote(str(slug), safe='')}"
        club_class_ids = [item.get("id") for item in classes if item.get("club_id") == club.get("id")]
        has_results = any(race_count_by_class.get(str(class_id), 0) for class_id in club_class_ids)
        today = date.today().isoformat()
        has_schedule = _has_upcoming_schedule(
            [series for series in series_rows if series.get("class_id") in club_class_ids],
            today,
        )
        if not (has_results or has_schedule):
            continue
        add(path, club.get("updated_at"))
        if has_schedule:
            add(f"{path}/calendar", club.get("updated_at"))

    class_series: dict[str, list[dict]] = {}
    for series in series_rows:
        class_id = series.get("class_id")
        if class_id:
            class_series.setdefault(str(class_id), []).append(series)
        if not series.get("id") or not race_count_by_series.get(str(series["id"])):
            continue
        cls = class_by_id.get(class_id) or {}
        club = club_by_id.get(cls.get("club_id")) or {}
        if club.get("slug"):
            add(
                _series_path(str(club["slug"]), series),
                series.get("updated_at") or series.get("year"),
            )

    for (class_id, year), count in race_count_by_class_year.items():
        cls = class_by_id.get(class_id) or {}
        club = club_by_id.get(cls.get("club_id")) or {}
        if count and club.get("slug"):
            path = f"/club/{quote(str(club['slug']), safe='')}" + _query_string(
                {"class": class_id, "year": year}
            )
            add(path, year)

    seen_class_urls = set()
    for cls in classes:
        class_id = str(cls.get("id") or "")
        rows = class_series.get(class_id, [])
        if not any(race_count_by_series.get(str(item.get("id"))) for item in rows):
            continue
        path = (
            _group_class_path(cls.get("name"))
            if cls.get("scoring_mode") == "one_design" and not cls.get("divisions")
            else _class_path(class_id, cls.get("name"))
        )
        if path not in seen_class_urls:
            add(path, cls.get("updated_at"))
            seen_class_urls.add(path)

    for event in await _to_list(db, "regattas", {}, 10000):
        club = club_by_id.get(event.get("club_id")) or {}
        if not club.get("slug"):
            continue
        event_series = await _series_for_event(db, event, str(club.get("id")))
        event_series = [
            item for item in event_series
            if (class_by_id.get(item.get("class_id")) or {}).get("club_id") == club.get("id")
        ]
        has_event_details = any(
            event.get(field)
            for field in ("start_date", "end_date", "description", "date_label", "host_club")
        )
        published_races = sum(
            race_count_by_series.get(str(item.get("id")), 0) for item in event_series
        )
        if published_races or has_event_details:
            add(
                _competition_path(str(club["slug"]), event),
                event.get("updated_at") or event.get("end_date"),
            )

    raced_boats = await _to_list(
        db,
        "boats",
        {"id": {"$in": list(boat_ids)}},
        50000,
        {"_id": 0, "id": 1, "class_id": 1, "fleet_id": 1, "fleet_key": 1, "name": 1, "created_at": 1},
    ) if boat_ids else []
    raced_boats = [boat for boat in raced_boats if str(boat.get("class_id")) in public_class_ids]
    identities: dict[str, dict] = {}
    for boat in raced_boats:
        identity = str(boat.get("fleet_key") or boat.get("fleet_id") or boat.get("id") or "")
        if not identity:
            continue
        prior = identities.get(identity)
        if prior is None or str(boat.get("created_at") or "") < str(prior.get("created_at") or ""):
            identities[identity] = boat
    for boat in identities.values():
        fleet_id = boat.get("fleet_id") or boat.get("id")
        if fleet_id:
            add(_boat_path(str(fleet_id), boat.get("name")), boat.get("created_at"))

    race_paths = set()
    for race in races:
        cls = class_by_id.get(race.get("class_id")) or {}
        club = club_by_id.get(cls.get("club_id")) or {}
        if not club.get("slug") or not race.get("id"):
            continue
        series = series_by_id.get(race.get("series_id")) or {}
        race_path = _race_path(
            str(club["slug"]),
            race,
            cls.get("name") or "Sailing",
            series.get("name") or "Race Results",
        )
        if race_path not in race_paths:
            add(race_path, race.get("published_at") or race.get("date"))
            race_paths.add(race_path)

    entries = []
    for location, lastmod in sorted(urls.items()):
        timestamp = f"<lastmod>{html.escape(lastmod)}</lastmod>" if lastmod else ""
        entries.append(f"<url><loc>{html.escape(location)}</loc>{timestamp}</url>")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(entries)
        + "</urlset>"
    )
    return Response(xml, media_type="application/xml; charset=utf-8")
