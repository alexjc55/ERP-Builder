#!/bin/bash
set -euo pipefail

# Post-merge setup runs with stdin closed. CI mode makes pnpm purge/recreate
# node_modules non-interactively when the pinned pnpm version changes.
export CI=true

PNPM_REGISTRY="https://registry.npmjs.org/"
corepack pnpm --config.registry="$PNPM_REGISTRY" install --frozen-lockfile
corepack pnpm --config.registry="$PNPM_REGISTRY" --filter db push
