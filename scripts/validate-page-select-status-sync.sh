#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

node scripts/check-db-test-wiring.mjs
corepack pnpm --filter @workspace/api-server run test:page-select-status-db
