# PRD — Sailing Club Racing Results App

## Original Problem Statement
Club-level sailing web app with 3 users. Spectator (public landing page, results in easy-access folders). Race Officer (race-day console: publish notices — course/start time/special rules/life jackets — that clear once results are published; select boats racing from a predefined list, unselected = DNC; auto-populated editable start times; big buttons to record finish time & position; provisional results; RRS penalty adjustments; confirm/publish). Race Admin (manage boats, classes with ability to add new, series schedules with per-series discards, overall championship per class summing sub-series except Summer; correct historic results). RRS Low Point scoring. Simple, phone-friendly, big buttons.

## Architecture
- **Backend**: FastAPI + MongoDB (motor). uuid string ids. JWT role tokens (PIN-per-role auth). Endpoints under `/api`.
- **Frontend**: React + Tailwind + shadcn/ui. Oswald/Manrope/JetBrains Mono. react-fast-marquee for notice banner. Nautical theme (Oceanic Cobalt + Safety Orange).
- **Auth**: shared PIN per role (Race Officer `sail2026`, Race Admin `admin2026`, Webmaster `WEBMASTER_PIN` env, default `9999`) in backend/.env. Spectator = no login.
- **Multi-club**: each club stores its own officer/admin PINs and its own classes/boats/series/races. Officer & Admin tokens carry the club id and are hard-scoped to it — a `club_id` query param can never widen access. The Webmaster token carries no club and may manage clubs and enter any club's consoles.

## User Personas
- Spectator — public viewer of results/standings (no login; club directory + per-club landing pages).
- Race Officer — runs race day on a phone/tablet (own club only).
- Race Admin — sets up season, fleet, corrects history (own club only).
- Webmaster — adds/removes/edits clubs and their passcodes, and has full Officer + Admin access to every club via per-club console launcher (`/webmaster`, then pick club).

## Core Requirements (static)
- Public results by Class > Series (Overall + sub-series), folders per race.
- Race-day notices banner that clears on publish.
- Officer: create race, boat selection (unselected=DNC), auto start time, device-time finish capture, provisional → publish, RRS penalty codes.
- Admin: CRUD classes/boats/series, discards, overall inclusion, historic correction.
- RRS Low Point scoring; DNC/non-finish = entries+1; discards (capped so ≥1 race counts); overall = sum of included series net points (Summer excluded).

## Implemented (2026-06)
- Full backend: auth, classes/boats/series CRUD, race lifecycle (create/select/finish/undo/adjust/status/delete), notifications, series & overall standings, rrs-codes, auto-seed (3 classes, 15 series, 10 boats).
- Full frontend: Landing (public, marquee, class/series tabs, standings, race folders), Login (role PIN), Officer console (big finish buttons, notices, provisional editing, publish), Admin (Boats/Classes/Series/Historic tabs).
- Verified end-to-end by testing agent: backend 16/16 pass, all frontend flows pass.

## Implemented (2026-08)
- **Live timing (Race Officer)**: timing strip in the race console with a running clock, count-up/countdown vs the race start, a one-tap **Start race** gun (`POST /api/races/{id}/start` sets `actual_start`, device time), Reset, and per-boat **elapsed time** shown beside each recorded finish. Finish capture still uses device time at tap.
- **Day-level flows**: "Apply selection to all races on {date}" (skips races that already have finishes so results are never clobbered) and "Confirm full day results" which publishes every unconfirmed race for the selected race day at once.
- **RRS scoring engine rewrite** (verified against the 2025-2028 rulebook text):
  - **A8 series ties**: tie-break now compares each boat's counting race *scores* best-to-worst (excluded/discarded scores not used), then last race backwards (excluded scores used). The old position-list tie-break ignored non-finish codes and let a boat with no finishes (empty list) sort first. Overall championship gets the same A8 treatment over its series results.
  - **ZFP/SCP per rule 44.3(c)**: score = her finishing place + 20% of the DNF score, rounded half-up, never worse than DNF. Replaces the outdated "20% of the fleet" formula. New SCP, NSC and DPI codes added; ZFP keeps its finishing place.
  - **A6.1**: a boat that finished and is later scored DNC/DNS/OCS/UFD/BFD/DNF/RET/DSQ/DNE/NSC moves the boats behind her up one place (positions re-sequenced by finish time in `select-boats` and `adjust-result`).
  - **A5.3 SI option**: per-series `use_a5_3` flag (admin Series form) — when set, boats that came to the starting area but did not finish score start-area entries + 1 (better than DNC). Default remains A5.2 (all non-finish codes = series entries + 1).
  - **A7**: boats tied on an equal stored position split the points of the tied places and the places immediately below.
  - `use_a5_3` is echoed in standings responses and shown on the public standings table footer.
- **IRC scoring** (per-class `scoring_mode`, default one-design): boats carry a TCC
  (rating certificate); corrected time = elapsed × TCC rounded to the nearest second
  with 0.5 s rounding up (IRC Rule 12.2). Finishes are re-sequenced by corrected time
  on every finish/edit (start = start gun, else scheduled class start); equal corrected
  times share a place and RRS A7 splits the points (e.g. two tied for 1st → 1.5 each,
  next boat 3rd). Boats without TCC/start fall back to finish order. Admin UI: class
  scoring-mode selector + boat TCC field.
- Unit tests: `backend/tests/test_scoring_rrs.py` — 19 tests covering A4/A5.2/A5.3/A6.1/A7/A8/44.3(c) math (pure functions, no DB). All pass.

## Implemented (2026-08, multi-club + webmaster)
- **Webmaster role**: third login (`role: "webmaster"` vs `WEBMASTER_PIN` env, default `9999`; docker-compose sets `master2026`). Token carries no club. New `require_webmaster` gates club CRUD (`/clubs`, `/clubs/manage` returns clubs incl. passcodes — the public `/clubs` never leaks PINs). Webmaster passes `require_admin`/`require_officer` and bypasses `_ensure_club`, so it can run any club's consoles.
- **Club isolation**: `_resolve_club_id` now forces Officer/Admin to their token's club regardless of any `club_id` query param (previously spoofable); `get_race` 404s staff from other clubs; `create_class` takes an explicit `club_id` (required for webmaster, enforced to the caller's own club otherwise); `me()` now returns `club_name`.
- **Frontend**: Webmaster page (`/webmaster`) — club cards with add/edit/delete (name, colour, officer & admin passcodes) and per-club **Officer console** / **Admin console** launchers; Officer/Admin pages accept `?club=` (webmaster) and show a club picker when none is chosen; Admin's Clubs tab is webmaster-only.
- Frontend builds cleanly with `ajv@^8` added to deps (schema-utils@4 requires ajv 8 at top level; without it the CRA build fails).

## Backlog / Remaining
- P1: SCP place-based 20% is done; remaining: none outstanding for low-point. Consider A9 redress default (average of other races) instead of DNF fallback for RDG.
- P2: Multi-year season switcher on landing; per-boat handicap (PY) scoring.
- P2: `login-error` data-testid; split server.py into routers.
- NOTE: existing backend tests (backend_test.py) assume the demo seed (≥15 series, Wayfarer series exist). The live 2026 DB has drifted (10 series, Wayfarer has none) — 3 tests fail on data, not code.

## Next Tasks
- Deploy updated backend (start endpoint, ZFP/SCP, A8 tie-break, A5.3, A6.1) and re-run suite.
- Await user feedback on scoring nuances and any club-specific rules.
