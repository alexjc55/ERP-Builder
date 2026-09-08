#!/usr/bin/env bash
set -euo pipefail

acquire_validation_lock() {
  local repo_root
  local validation_lock

  repo_root="$(git rev-parse --show-toplevel)"
  validation_lock="/tmp/erp-validations-$(printf '%s' "$repo_root" | sha256sum | cut -d' ' -f1).lock"
  exec 9>"$validation_lock"
  flock 9
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if (($# == 0)); then
    printf 'Usage: %s <command> [arguments...]\n' "$0" >&2
    exit 64
  fi

  acquire_validation_lock
  exec "$@"
fi