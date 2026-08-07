# PRD — Sailing Club Racing Results App

## Original Problem Statement
Club-level sailing web app with 3 users. Spectator (public landing page, results in easy-access folders). Race Officer (race-day console: publish notices — course/start time/special rules/life jackets — that clear once results are published; select boats racing from a predefined list, unselected = DNC; auto-populated editable start times; big buttons to record finish time & position; provisional results; RRS penalty adjustments; confirm/publish). Race Admin (manage boats, classes with ability to add new, series schedules with per-series discards, overall championship per class summing sub-series except Summer; correct historic results). RRS Low Point scoring. Simple, phone-friendly, big buttons.

## Architecture
- **Backend**: FastAPI + MongoDB (motor). uuid string ids. JWT role tokens (PIN-per-role auth). Endpoints under `/api`.
- **Frontend**: React + Tailwind + shadcn/ui. Oswald/Manrope/JetBrains Mono. react-fast-marquee for notice banner. Nautical theme (Oceanic Cobalt + Safety Orange).
- **Auth**: shared PIN per role (Race Officer `sail2026`, Race Admin `admin2026`) in backend/.env. Spectator = no login.

## User Personas
- Spectator — public viewer of results/standings.
- Race Officer — runs race day on a phone/tablet.
- Race Admin — sets up season, fleet, corrects history (superset of officer).

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

## Backlog / Remaining
- P1: Percentage scoring penalties (ZFP/SCP with % points), RRS A8 full tie-break refinement.
- P2: Multi-year season switcher on landing; per-boat finish elapsed times/handicap (PY) scoring.
- P2: `login-error` data-testid; split server.py into routers.

## Next Tasks
- Await user feedback on scoring nuances and any club-specific rules.
