#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
# Obtain this value independently via the platform executeSql development
# query documented in the spec. Do not derive it from DATABASE_URL here.
: "${DELIVERY_E2E_DEV_FINGERPRINT:?Provide independently verified development metadata fingerprint}"
export NODE_PATH="$repo_root/artifacts/api-server/node_modules${NODE_PATH:+:$NODE_PATH}"
# Exactly one lock; invoke Playwright directly, never recurse into this script.
exec bash scripts/with-validation-lock.sh node node_modules/@playwright/test/cli.js test tests/e2e/delivery-workflow.spec.ts "$@"