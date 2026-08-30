#!/usr/bin/env bash
#
# deploy.sh — SailScore production deployment (GitHub → production, one command)
#
# Run it from the production checkout:
#     cd /opt/regatta-results && ./deploy.sh
#
# What it does, in order:
#   1. Verifies it is running from /opt/regatta-results, that Git is available,
#      that the branch is `main`, and that the working tree is clean.
#   2. Fetches `origin`, stops if production is already up to date, otherwise
#      shows the commits to be deployed.
#   3. Pulls with `git pull --ff-only`, validates the Docker Compose config
#      (including the `127.0.0.1:8080:80` frontend bind and that no host
#      port 80 is bound), builds images and recreates the services.
#   4. Checks container health and runs the internal and public website checks.
#
# Safety: this script NEVER discards local work, never runs
# `docker compose down -v`, never deletes the MongoDB volume, never exposes
# MongoDB/backend to the host or Internet, and never touches Caddy, the
# domain, the frontend port, or .env. If the working tree is dirty it stops
# and leaves your changes intact. If anything fails it stops and names the
# failed step.
#
set -euo pipefail

APP_DIR="/opt/regatta-results"
DOMAIN="www.sailscore.co.uk"
INTERNAL_URL="http://127.0.0.1:8080/"
PUBLIC_URL="https://www.sailscore.co.uk/"
PUBLIC_PORT="8080"
CONTAINER_MONGO="sailscore-mongodb"
CONTAINER_BACKEND="sailscore-backend"
CONTAINER_FRONTEND="sailscore-frontend"

# Colours (gracefully degrade when not a terminal / NO_COLOR set).
if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
    C_GREEN=""; C_RED=""; C_YELLOW=""; C_BOLD=""; C_RESET=""
else
    C_GREEN="\033[0;32m"; C_RED="\033[0;31m"; C_YELLOW="\033[0;33m"; C_BOLD="\033[1m"; C_RESET="\033[0m"
fi

CURRENT_STEP=""
fail() { echo -e "${C_RED}[deploy] ABORTED:${C_RESET} $*" >&2; exit 1; }

# Any unhandled error stops the deployment and identifies the failing step.
on_error() {
    if [ -n "$CURRENT_STEP" ]; then
        echo -e "${C_RED}$CURRENT_STEP FAILED — deployment stopped.${C_RESET}" >&2
    else
        echo -e "${C_RED}Deployment stopped unexpectedly.${C_RESET}" >&2
    fi
    exit 1
}
trap on_error ERR

step() {  # step <label> <message>
    CURRENT_STEP="$1"
    echo
    echo "─────────────────────────────────────────────────────────────"
    echo -e "${C_BOLD}[$1] $2${C_RESET}"
}

ok() { echo -e "${C_GREEN}  ✓ $*${C_RESET}"; }
warn() { echo -e "${C_YELLOW}  ! $*${C_RESET}"; }

############################################
# [1/10] Checking repository
############################################
step "1/10" "Checking repository..."
if [ "$(pwd)" != "$APP_DIR" ]; then
    fail "This script must be run from $APP_DIR (you are in $(pwd))."
fi
ok "Running from $APP_DIR"

if ! command -v git >/dev/null 2>&1; then
    fail "Git is not installed or not on PATH."
fi
ok "Git is available"

############################################
# [2/10] Checking Git status
############################################
step "2/10" "Checking Git status..."
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ "$BRANCH" != "main" ]; then
    fail "Current branch is '$BRANCH', but deployment requires 'main'."
fi
ok "On branch: main"

DIRTY="$(git status --porcelain 2>/dev/null || true)"
if [ -n "$DIRTY" ]; then
    echo -e "${C_RED}Uncommitted local changes exist:$C_RESET"
    printf '%s\n' "$DIRTY"
    fail "Deployment cancelled — the working tree is not clean. No changes were discarded or overwritten; commit or stash them first, then re-run."
fi
ok "Working tree is clean (no uncommitted changes)"

############################################
# [3/10] Fetching GitHub
############################################
step "3/10" "Fetching GitHub..."
git fetch origin

############################################
# Determine whether origin/main has new commits
############################################
LOCAL_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
REMOTE_SHA="$(git rev-parse origin/main 2>/dev/null || true)"
if [ -z "$LOCAL_SHA" ] || [ -z "$REMOTE_SHA" ]; then
    fail "Could not resolve local/remote HEAD (origin/main). Check the 'origin' remote."
fi
if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
    echo -e "${C_GREEN}No new commits on origin/main — production is already up to date at ${LOCAL_SHA}.${C_RESET}"
    echo "Nothing to deploy. Exiting safely."
    exit 0
fi
BEHIND="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")"
COMMITS="$(git log --oneline HEAD..origin/main 2>/dev/null || true)"
echo "origin/main is $BEHIND commit(s) ahead of local HEAD."
echo "Commits that will be deployed:"
printf '%s\n' "$COMMITS" | sed 's/^/   /'

############################################
# [4/10] Pulling latest code
############################################
step "4/10" "Pulling latest code..."
git pull --ff-only origin main
ok "Pulled origin/main"

############################################
# [5/10] Validating Docker configuration
############################################
step "5/10" "Validating Docker configuration..."
# Fail fast if the compose file/.env is invalid (missing required vars etc.).
docker compose config --quiet
ok "docker compose config validates"

# Verify the frontend production port mapping and that host port 80 is NOT
# bound anywhere in the stack.
cfgjson="$(docker compose config --format json)"
if ! printf '%s' "$cfgjson" | python3 -c '
import json, sys
cfg = json.load(sys.stdin)
front = (cfg.get("services") or {}).get("frontend", {})
ports = front.get("ports") or []
def norm(entry):
    if isinstance(entry, str):  # e.g. "127.0.0.1:8080:80"
        host_ip, _, rest = entry.partition(":")
        if ":" in rest:
            pub, _, tgt = rest.partition(":")
            return (host_ip, pub, tgt)
        return ("", entry, "")
    return (
        str(entry.get("host_ip") or entry.get("published_ip") or ""),
        str(entry.get("published") or entry.get("host_port") or ""),
        str(entry.get("target") or ""),
    )
normed = [norm(p) for p in ports]
has_loopback_8080 = any(h == "127.0.0.1" and p == "8080" and t == "80" for h, p, t in normed)
binds_host_80 = any(p == "80" for _, p, _ in normed)
if not has_loopback_8080:
    print("ERROR: production frontend must bind 127.0.0.1:8080:80; got", normed, file=sys.stderr)
    sys.exit(1)
if binds_host_80:
    print("ERROR: frontend must NOT bind host port 80; got", normed, file=sys.stderr)
    sys.exit(1)
print("frontend mapping OK: 127.0.0.1:8080:80 (loopback only, no host port 80)")
'; then
    fail "Production port guard failed — refusing to continue."
fi
ok "Frontend port mapping is 127.0.0.1:8080:80 and does not bind host port 80"

############################################
# [6/10] Building containers
############################################
step "6/10" "Building containers..."
docker compose build
ok "Images built"

############################################
# [7/10] Starting containers
############################################
step "7/10" "Starting containers..."
# Intentionally NOT `down -v` and NOT recreating the MongoDB volume.
docker compose up -d
ok "Services (re)created and started"

############################################
# [8/10] Checking container health
############################################
step "8/10" "Checking container health..."
docker compose ps

wait_healthy() {
    local c="$1"
    local i st=""
    for i in $(seq 1 60); do
        st="$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null || echo '')"
        if [ "$st" = "healthy" ]; then
            ok "$c healthy"
            return 0
        fi
        if [ "$st" = "unhealthy" ]; then
            echo -e "${C_RED}  ✗ $c is unhealthy${C_RESET}" >&2
            return 1
        fi
        sleep 2
    done
    echo -e "${C_RED}  ✗ $c not healthy within 120s (status: '$st')${C_RESET}" >&2
    return 1
}
wait_healthy "$CONTAINER_MONGO"
wait_healthy "$CONTAINER_BACKEND"
wait_healthy "$CONTAINER_FRONTEND"
ok "All containers healthy"

############################################
# [9/10] Testing internal website
############################################
step "9/10" "Testing internal website..."
INTERNAL_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$INTERNAL_URL" 2>/dev/null || echo '000')"
echo "  Internal frontend ($INTERNAL_URL) returned HTTP $INTERNAL_CODE"
if [ "$INTERNAL_CODE" != "200" ]; then
    fail "Internal website did NOT return HTTP 200 (got $INTERNAL_CODE)."
fi
ok "Internal website returns HTTP 200"

############################################
# [10/10] Testing public website
############################################
step "10/10" "Testing public website..."
PUBLIC_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$PUBLIC_URL" 2>/dev/null || echo '000')"
echo "  Public website ($PUBLIC_URL) returned HTTP $PUBLIC_CODE"
if [ "$PUBLIC_CODE" != "200" ]; then
    fail "Public website did NOT return HTTP 200 (got $PUBLIC_CODE)."
fi
ok "Public website returns HTTP 200"

############################################
# Success
############################################
DEPLOYED_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo
echo "===================================="
echo "Sailscore deployment successful"
echo "Commit: $DEPLOYED_COMMIT"
echo "Website: https://$DOMAIN"
echo "===================================="
exit 0