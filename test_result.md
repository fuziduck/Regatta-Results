#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## 2026-08-20 — Live timing + day-level flows + ZFP (main agent)
## user_problem_statement: "Add live timer/clock to Race Officer finish screen (device-time capture at tap); day-level boat selection & confirm-full-day results; RRS ZFP penalty."
## backend:
##   - task: "POST /api/races/{id}/start — set/clear actual_start (gun)"
##     implemented: true
##     working: "NA"   # code verified by import + scoring unit checks; NOT deployed to preview yet
##     file: "backend/server.py"
##     stuck_count: 0
##     priority: "high"
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "Verified server.py imports cleanly; StartRaceInput accepts ISO string or null."
##   - task: "ZFP / UFD / BFD RRS codes + ZFP 20% scoring (A5.2)"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     stuck_count: 0
##     priority: "high"
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "Unit-checked zfp_points + result_points via venv import: ZFP(9)=2, DSQ=DNC=entries+1, RDG=manual, FINISHED=place."
## frontend:
##   - task: "Officer console timing strip (live clock, count-up/countdown, start gun, per-boat elapsed)"
##     implemented: true
##     working: true
##     file: "frontend/src/pages/Officer.jsx"
##     stuck_count: 0
##     priority: "high"
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "Production build passes; all new data-testids present in bundle (timing-strip, start-gun-btn, clear-gun-btn). Visual check not possible in this env (no persistent dev server)."
##   - task: "Apply boat selection to all races on the day + confirm full day results"
##     implemented: true
##     working: true
##     file: "frontend/src/pages/Officer.jsx"
##     stuck_count: 0
##     priority: "medium"
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "apply-day-btn and confirm-day-btn in bundle; apply-to-day guards against overwriting races with finishes."
## metadata:
##   created_by: "main_agent"
##   test_sequence: 1
##   run_ui: false
## test_plan:
##   current_focus:
##     - "Live timing strip (gun, reset, countdown, elapsed per finish)"
##     - "Apply day selection / confirm full day"
##     - "ZFP scoring in standings"
##   stuck_tasks: []
##   test_all: false
##   test_priority: "high_first"
## agent_communication:
##     -agent: "main"
##     -message: "New features implemented and compile-verified. Existing suite: 19 pass / 3 fail against live preview — failures are DATA DRIFT (live DB has 10 series not 15; Wayfarer has no series), pre-existing on old code. Need deploy of updated backend before end-to-end testing of start endpoint + ZFP."

## 2026-08-20 — RRS Low Point scoring engine audit & fixes (main agent)
## user_problem_statement: "Check the RRS low point scoring rules and update the scoring engine as it currently is not correct."
## backend:
##   - task: "A8 series-tie break (score lists best-to-worst, excluded scores excluded; last-race fallback)"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     stuck_count: 0
##     priority: "high"
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "Verified against RRS 2025-2028 Appendix A text. Old code compared raw finish positions (DNCs ignored; empty position list sorted first). Applied to series + overall."
##   - task: "ZFP/SCP per rule 44.3(c) (place + 20% of DNF, rounded half-up, capped at DNF); add SCP/NSC/DPI codes"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     stuck_count: 0
##     priority: "high"
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "Old '20% of fleet' formula was outdated. New formula matches 44.3(c). Unit tested."
##   - task: "A6.1 re-sequencing when a finisher becomes DSQ/RET/DNE etc."
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     stuck_count: 0
##     priority: "high"
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "select-boats + adjust-result re-sequence by finish_time; ZFP/SCP/RDG/DPI keep their finishing place."
##   - task: "Optional RRS A5.3 scoring mode (per-series flag)"
##     implemented: true
##     working: true
##     file: "backend/server.py, frontend/src/pages/Admin.jsx"
##     stuck_count: 0
##     priority: "medium"
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "Admin Series form toggle + table switch; standings echo use_a5_3; public table footer notes it. Verified in live preview UI."
## frontend:
##   - task: "A5.3 admin toggle, new CODE_COLORS, standings footer note"
##     implemented: true
##     working: true
##     file: "frontend/src/pages/Admin.jsx, frontend/src/lib/helpers.js, frontend/src/components/StandingsTable.jsx"
##     stuck_count: 0
##     priority: "medium"
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "Production build passes; verified in live preview (admin login, Series tab, edit dialog)."
## metadata:
##   created_by: "main_agent"
##   test_sequence: 2
##   run_ui: false
## test_plan:
##   current_focus:
##     - "A8 tie-break with real tied data (needs DB / deploy)"
##     - "ZFP/SCP values in published standings"
##     - "A6.1 re-sequencing on DSQ in the Officer console"
##   stuck_tasks: []
##   test_all: false
##   test_priority: "high_first"
## agent_communication:
##     -agent: "main"
##     -message: "Scoring engine rewritten per RRS 2025-2028 (A5.2/A5.3, 44.3(c), A6.1, A7, A8). 19 new pure unit tests pass. Deployed backend still runs old code — needs deploy before live end-to-end verification."

## 2026-08-20 — User feedback on A5.3 toggle (main agent)
## agent_communication:
##     -agent: "user"
##     -message: "Toggle doesn't change results; label should say 'boats that came to the start area score as starters + 1'."
##     -agent: "main"
##     -message: "Root cause: the DEPLOYED backend (fleet-timer-1.preview) runs pre-change code — /rrs-codes lacks UFD/BFD/ZFP/SCP, series docs have no use_a5_3, standings never echo it — so it silently drops the field. Local engine is correct: added end-to-end tests (fake DB layer) proving the same race scores DNS=5 under A5.2 vs DNS=4 under A5.3 (4 boats entered, 3 in start area). Label fixed to 'RRS A5.3 — boats that came to the start area score as starters + 1' and verified in preview. Needs backend deploy before the toggle can affect results."

## 2026-08-20 — Frontend docker image rebuilt against local backend

- Rebuilt `regatta-frontend` image: added `frontend/.dockerignore` (node_modules/build/.env* excluded — 443MB mac node_modules was breaking Linux images) and changed Dockerfile to `npm install --legacy-peer-deps --no-audit --no-fund` (react 19 + CRA 5 peer conflict would fail a plain install).
- Recreated container with `-e REACT_APP_BACKEND_URL=http://127.0.0.1:8000` (same network `regatta-network`, port 3000:3000, wget healthcheck). api.js has no default — env is required.
- Root cause of "bundle showed deployed preview URL": the earlier static preview server (`python3 -m http.server` serving `frontend/build`, built against the deployed preview) was still bound to 127.0.0.1:3000 and shadowed the container. Killed pid; container now serves.
- Verified end-to-end: container dev bundle inlines 127.0.0.1:8000, new A5.3 label + timing strip present, preview URL absent; Dragon Overall table in preview shows fractional scores (11.1/17.7/29.2) from new ZFP/SCP engine on local backend. No console errors.

## 2026-08-20 — docker-compose.yml added (full stack, /tmp fragility eliminated)

- Created `docker-compose.yml` at project root: mongo (mongo:7 + named volume), backend (python:3.11-slim + `./backend:/app` mount + `--reload`), frontend (node:20 + `REACT_APP_BACKEND_URL=http://127.0.0.1:8000`). All on `regatta-network` (external). Healthcheck chain: mongo → backend → frontend.
- Created `backend/.dockerignore` (excludes .venv, __pycache__, tests/ — keeps build context ~50KB instead of ~50MB).
- Removed dead `emergentintegrations==0.2.0` from `requirements.txt` (private package, never imported, blocked image build).
- Verified end-to-end: `docker compose up --build -d` starts all three containers healthy; API returns 15 RRS codes; frontend bundle inlines `127.0.0.1:8000` and contains new A5.3/timing-strip UI; `--reload` confirmed (uvicorn restarts on server.py edit); mongo data persists in named volume `mongo-data`.
- Gotcha resolved: the old `/tmp/regatta/backend` mount (fragile — wiped by macOS reboot and tooling) is replaced by `./backend:/app` (workspace mount — survives reboots). System site-packages live outside /app so the mount only shadows source code, not pip-installed packages.

## 2026-08-20 — Data restored: compose now uses the real mongo volume

- Symptom: after switching to docker compose, races/results vanished (0 races).
- Cause: compose created a fresh volume `regatta-results_mongo-data`; the real
  2026 data (14 series, 23 races, 18 boats) was in the pre-compose named volume
  `regatta_mongodb_data`, which survives container removal.
- Fix: docker-compose.yml now marks `mongo-data` external with
  `name: regatta_mongodb_data`. Verified live: Dragon Overall standings render
  (OCD 7, Repeat Offender 19, Taniwha 19.1, Tempest 24.7, …).
- Note: the empty `regatta-results_mongo-data` volume is now orphaned (sample
  seed only) — safe to `docker volume rm regatta-results_mongo-data`.

## 2026-08-20 — IRC scoring implemented (TCC + corrected time + A7 ties)

- Backend: `ClassInput.scoring_mode` (Literal one_design|irc, default one_design) persisted on classes;
  `BoatInput.tcc` (Optional float) persisted on boats.
- `_corrected_time_sec`: elapsed x TCC rounded to nearest second, 0.5 up (IRC Rule 12.2).
  `_parse_iso` handles fractional seconds on Python 3.9 (drops fraction, keeping tz) and full precision on 3.11+.
- `_resequence_finished(results, scoring_mode, start_time, boat_tccs)`: one-design sorts by finish time;
  IRC sorts by corrected time, groups equal corrected times so tied boats share a place and the next
  distinct place jumps by the tie size (RRS A7 semantics: 1,1,3 not 1,1,2). Boats without TCC/start
  fall back to finish time after computable boats.
- `_resequence_race(race)` (async) fetches class + boat TCCs; wired into record_finish (re-sequences
  after every finish), select_boats, undo_finish, adjust_result. Start time = actual_start (start gun),
  else race date + class default_start_time.
- Standings need no change: they use stored positions and the existing A7 split.
- Tests: 10 new (TestIrcCorrectedTime, TestIrcResequence, TestIrcA7EndToEnd) — 29 total, all pass.
- Live-verified via API on the compose stack with scratch data (created + deleted):
  - IRC class, TCCs on boats; finish order B(10:40), A(10:50), C(11:00) with TCCs 2.0/1.0/0.6 →
    positions 2,2,1 (C wins corrected 1080; A,B tie at 1200) — reordered vs elapsed, ties share place.
  - Published standings with a 2-boat tie scenario: winner net 1.0, loser 2.0 (corrected ordering).
- Frontend: Classes tab — Scoring system select (One-design/IRC) in add/edit dialog + Scoring column
  with IRC/One-design badges; Boats tab — TCC number input (step 0.001) + TCC column (3 decimals).
  Verified in the live preview (admin → Classes shows Cruiser=IRC; edit dialog pre-fills IRC).
- NOTE: existing races keep their stored positions; only new finishes / result edits trigger
  corrected-time re-sequencing. Historic IRC races can be re-touched (edit a result) to re-sequence.

## 2026-08-20 — Editable elapsed time (Officer + Admin Historic)

- Backend: `ResultAdjustInput.elapsed_seconds` (float, seconds). `adjust_result` resolves the
  race start (start gun `actual_start`, else scheduled class start anchored to UTC) and converts
  elapsed -> finish_time via new `_finish_time_from_elapsed`, marks the boat FINISHED, clears
  position, and re-sequences the race (one-design by finish time, IRC by corrected time).
  400 if no start time is resolvable. `_race_start_time` now returns explicit `+00:00` for the
  scheduled fallback so elapsed math is TZ-deterministic.
- Frontend: new helpers `raceStart(race)` and `elapsedSecondsOf(finishTime, race)` (client treats
  the scheduled-start fallback as UTC to match the backend). Officer "Provisional results &
  penalties" table and Admin "Historic Results" table both gained an **Elapsed** column with a
  seconds input (prefilled from finish - start) that submits `elapsed_seconds` on blur.
- Tests: 3 new (TestElapsedCorrection) — 32 total, all pass. Frontend builds.
- Live-verified: API scratch race — start gun 10:30Z, finishes 10:50/10:55; correcting B1 to
  elapsed 1380s moved its finish to 10:53:00+00:00 exactly and kept positions. UI verified in
  preview (Officer Dragon race: Elapsed 3660/3720/3780/3840; Admin Historic Cruiser R1 shows the
  Elapsed column). Note: Cruiser R1's finish times were button-tap captures from Aug 20 vs race
  date Apr 18, so its prefills (~10750705s) surface exactly the wrong durations this feature exists
  to fix.

## H:M:S elapsed input (Aug 20)
- Replaced the seconds-only elapsed input with a 3-field hours:minutes:seconds component (`frontend/src/components/ElapsedInput.jsx`), used in both the Race Officer console and the Admin Historic Results tab. Commits the whole H:M:S as seconds on blur; prefills from recorded finish − race start.
- Verified live in preview: Officer console shows `2986 : 18 : 25`, Admin Historic shows the same 3-field input; editing hours committed the change and the backend re-sequenced. Restored the demo race's original finish afterwards via direct mongo patch.
- Frontend image rebuilt (`docker compose up -d --build frontend`); 32/32 scoring tests pass.

## Landing page: Elapsed + Corrected columns (Aug 20)
- Replaced the Finish column in the published-race results table with Elapsed and Corrected.
- `frontend/src/lib/helpers.js`: added `correctedSecondsOf` (IRC Rule 12.2: elapsed x TCC, rounded half-up — mirrors backend `_corrected_time_sec`) and `fmtSeconds` (H:MM:SS).
- `frontend/src/pages/Landing.jsx`: fetches the class scoring_mode; IRC classes show elapsed x TCC, one-design classes show elapsed as corrected. Non-finished boats show "—".
- Verified live: Dragon (one-design) shows equal Elapsed/Corrected; Cruiser (IRC) shows real corrected times — Aquila 2:11:03, Countdown 2:11:37, Zephyros 2:11:52, ordered by corrected time (Zephyros beat Countdown on elapsed but places 3rd). Frontend image rebuilt.
- Follow-up: Elapsed/Corrected columns now render only for IRC classes; one-design race tables show Pos/Boat/Helm/Code only (verified live on Dragon vs Cruiser).
- Added `boat_type` end-to-end: backend BoatInput, Admin boat form + Type column, and a Type column on the landing race table shown only for IRC classes (cruisers). Populated types for the 5 demo cruisers (Bavaria 34, Hanse 315, Jeanneau Sun Odyssey 32, Beneteau First 31.7, Dehler 34). One-design tables unchanged (Pos/Boat/Helm/Code).
