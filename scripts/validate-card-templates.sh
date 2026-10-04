#!/usr/bin/env bash
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
: "${CARD_E2E_DEV_FINGERPRINT:?Provide independently verified development metadata fingerprint}"
export NODE_PATH="$repo_root/artifacts/api-server/node_modules${NODE_PATH:+:$NODE_PATH}"
exec bash scripts/with-validation-lock.sh node node_modules/@playwright/test/cli.js test tests/e2e/card-template-api.spec.ts "$@"