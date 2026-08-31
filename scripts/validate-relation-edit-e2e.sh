#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
validation_lock="/tmp/erp-validations-$(printf '%s' "$repo_root" | sha256sum | cut -d' ' -f1).lock"
exec 9>"$validation_lock"
flock 9

wait_for_service() {
  local name="$1"
  local url="$2"
  local attempts=30

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl --fail --silent --show-error --output /dev/null "$url"; then
      printf '%s workflow is ready (%s)\n' "$name" "$url"
      return 0
    fi
    sleep 1
  done

  printf '%s workflow did not become ready at %s after %ss\n' \
    "$name" "$url" "$attempts" >&2
  printf 'Start the managed ERP and API workflows before retrying this validation.\n' >&2
  return 1
}

wait_for_service "ERP" "http://localhost:80/login"
wait_for_service "API" "http://localhost:80/api/healthz"

pnpm run test:e2e:relation-edit