#!/bin/bash
set -e
PNPM_REGISTRY="https://registry.npmjs.org/"
corepack pnpm --config.registry="$PNPM_REGISTRY" install --frozen-lockfile
corepack pnpm --config.registry="$PNPM_REGISTRY" --filter db push
