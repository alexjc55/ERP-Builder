#!/usr/bin/env bash
#
# Production deploy script — run this ON YOUR REMOTE SERVER (not on Replit).
#
# It updates code and database in the safe order:
#   backup DB -> git pull -> install deps -> run DB migrations -> build -> restart
#
# Prerequisites on the server:
#   - git, node 24, pnpm, postgresql-client (for pg_dump)
#   - DATABASE_URL exported in the environment (same var Drizzle reads)
#   - the app already bootstrapped once (see FIRST-TIME SETUP at the bottom)
#
# Usage:
#   ./deploy.sh
#
set -euo pipefail

# ------------------------------------------------------------------ config ---
# Directory where the repo lives on the server. Defaults to this script's dir.
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
# Git branch to deploy.
BRANCH="${BRANCH:-main}"
# Where to keep pre-migration database backups.
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/.db-backups}"
# Command that restarts your running API service. Override for your setup, e.g.:
#   RESTART_CMD="pm2 restart api-server"
#   RESTART_CMD="sudo systemctl restart erp-api"
RESTART_CMD="${RESTART_CMD:-}"
# ---------------------------------------------------------------------------

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set. Export it before running deploy." >&2
  exit 1
fi

cd "$APP_DIR"

echo "==> [1/6] Backing up the database (pre-migration snapshot)"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/pre_deploy_${STAMP}.sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"
echo "    backup written: $BACKUP_FILE"

echo "==> [2/6] Pulling latest code (branch: $BRANCH)"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> [3/6] Installing dependencies"
pnpm install --frozen-lockfile

echo "==> [4/6] Applying database migrations"
# Applies ONLY migrations not yet recorded in the __drizzle_migrations table.
pnpm --filter @workspace/db run migrate

echo "==> [5/6] Building"
# Build only what the server needs (the root build includes dev-only packages
# such as mockup-sandbox that are not meant for production servers).
pnpm --filter @workspace/api-server run build
PORT="${FRONTEND_PORT:-10000}" BASE_PATH="${FRONTEND_BASE_PATH:-/}" \
  pnpm --filter @workspace/erp-platform run build

echo "==> [6/6] Restarting the service"
if [[ -n "$RESTART_CMD" ]]; then
  eval "$RESTART_CMD"
  echo "    ran: $RESTART_CMD"
else
  echo "    RESTART_CMD is empty — restart your service manually,"
  echo "    or set RESTART_CMD (e.g. 'pm2 restart api-server')."
fi

echo "==> Deploy complete. If something is wrong, restore with:"
echo "    gunzip -c \"$BACKUP_FILE\" | psql \"\$DATABASE_URL\""

# =============================================================================
# FIRST-TIME SETUP (run once, by hand — NOT part of the normal deploy loop)
# =============================================================================
# On Replit (source), export data only (schema comes from the migration):
#     pg_dump --data-only --disable-triggers "$DATABASE_URL" | gzip > seed.sql.gz
#
# On the server (fresh, empty database):
#     git clone <repo> && cd <repo> && pnpm install --frozen-lockfile
#     pnpm --filter @workspace/db run migrate     # builds schema + records 0000
#     gunzip -c seed.sql.gz | psql "$DATABASE_URL" # loads the data
#     pnpm run build && <start your service>
#
# After that, every future update is just: ./deploy.sh
# =============================================================================
