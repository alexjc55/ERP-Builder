#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
helper="$repo_root/scripts/with-validation-lock.sh"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

events="$temp_dir/executable-events"
critical_section='
  printf "start %s\n" "$1" >> "$2"
  sleep 0.2
  printf "end %s\n" "$1" >> "$2"
'

bash "$helper" bash -c "$critical_section" bash first "$events" &
first_pid=$!
ERP_VALIDATION_LOCK_HELD=1 bash "$helper" bash -c "$critical_section" bash spoofed "$events" &
second_pid=$!
wait "$first_pid"
wait "$second_pid"

assert_no_overlap() {
  awk '
  $1 == "start" {
    if (active) exit 1
    active = 1
    count += 1
    next
  }
  $1 == "end" {
    if (!active) exit 1
    active = 0
    count += 1
    next
  }
  { exit 1 }
  END { exit active || count != 4 }
' "$1"
}

assert_no_overlap "$events"

source_events="$temp_dir/source-events"
bash -c '
  source "$1"
  acquire_validation_lock
  printf "start source\n" >> "$2"
  sleep 0.2
  printf "end source\n" >> "$2"
' bash "$helper" "$source_events" &
source_pid=$!
bash "$helper" bash -c "$critical_section" bash executable "$source_events" &
executable_pid=$!
wait "$source_pid"
wait "$executable_pid"
assert_no_overlap "$source_events"

set +e
bash "$helper" bash -c 'exit 37'
status=$?
set -e
if [[ "$status" -ne 37 ]]; then
  printf 'Expected child exit status 37, got %s\n' "$status" >&2
  exit 1
fi

set +e
bash "$helper" bash -c 'kill -TERM "$$"'
signal_status=$?
set -e
if [[ "$signal_status" -ne 143 ]]; then
  printf 'Expected termination signal status 143, got %s\n' "$signal_status" >&2
  exit 1
fi

printf 'Validation lock helper regression checks passed\n'