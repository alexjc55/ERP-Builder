#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
# Obtain via executeSql(environment:"development") before invoking this gate.
# No self-approving fingerprint and no default opt-in / skipped success.
: "${KANBAN_E2E_DEV_FINGERPRINT:?Provide independently verified development metadata fingerprint}"
export NODE_PATH="$repo_root/artifacts/api-server/node_modules${NODE_PATH:+:$NODE_PATH}"
# One shared lock, owned here only. Do not call a second locked package command.
exec bash scripts/with-validation-lock.sh node node_modules/@playwright/test/cli.js test tests/e2e/kanban-collaboration.spec.ts "$@"