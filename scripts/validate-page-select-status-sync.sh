#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

# Serialize PostgreSQL fixture tests with the destructive dependency-install
# check and timing-sensitive collaboration validations.
validation_lock="/tmp/erp-validations-$(printf '%s' "$repo_root" | sha256sum | cut -d' ' -f1).lock"
exec 9>"$validation_lock"
flock 9

corepack pnpm --filter @workspace/api-server run test:page-select-status-db