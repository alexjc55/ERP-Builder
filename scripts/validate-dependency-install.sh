#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

validation_lock="/tmp/erp-validations-$(printf '%s' "$repo_root" | sha256sum | cut -d' ' -f1).lock"
exec 9>"$validation_lock"
flock 9

package_manager="$(node -p "require('./package.json').packageManager")"
case "$package_manager" in
  pnpm@*) ;;
  *)
    printf 'package.json packageManager must pin pnpm, got: %s\n' "$package_manager" >&2
    exit 1
    ;;
esac

expected_pnpm_version="${package_manager#pnpm@}"
expected_pnpm_version="${expected_pnpm_version%%+*}"
actual_pnpm_version="$(corepack pnpm --version)"
if [[ "$actual_pnpm_version" != "$expected_pnpm_version" ]]; then
  printf 'Corepack resolved pnpm %s, expected pinned version %s\n' \
    "$actual_pnpm_version" "$expected_pnpm_version" >&2
  exit 1
fi
printf 'Corepack resolved pinned pnpm %s\n' "$actual_pnpm_version"

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

checkout="$temp_dir/checkout"
pristine="$temp_dir/pristine"
tracked_files="$temp_dir/tracked-files"
mkdir -p "$checkout" "$pristine"

git ls-files -z > "$tracked_files"
tar --null --files-from="$tracked_files" -cf - \
  | tar -xf - -C "$checkout"
tar --null --files-from="$tracked_files" -cf - \
  | tar -xf - -C "$pristine"

printf 'Installing dependencies in a clean tracked-files checkout...\n'
(
  cd "$checkout"
  CI=true corepack pnpm install --frozen-lockfile
)

modified_tracked_files=()
while IFS= read -r -d '' tracked_file; do
  if ! cmp -s "$pristine/$tracked_file" "$checkout/$tracked_file"; then
    modified_tracked_files+=("$tracked_file")
  fi
done < "$tracked_files"

if ((${#modified_tracked_files[@]} > 0)); then
  printf 'Frozen install changed tracked files:\n' >&2
  printf '  %s\n' "${modified_tracked_files[@]}" >&2
  exit 1
fi
printf 'Frozen install left all tracked files unchanged\n'

printf 'Checking that esbuild is allowed and operational...\n'
(
  cd "$checkout"
  corepack pnpm --filter @workspace/api-server exec node - <<'NODE'
const esbuild = require("esbuild");
const result = esbuild.transformSync("const answer: number = 42", {
  loader: "ts",
});

if (!result.code.includes("const answer = 42")) {
  throw new Error(`Unexpected esbuild output: ${result.code}`);
}

console.log(`esbuild ${esbuild.version} transformed TypeScript successfully`);
NODE
)

fixture="$temp_dir/unknown-build-fixture"
unknown_package="$fixture/unknown-postinstall-package"
mkdir -p "$unknown_package"

cat > "$fixture/package.json" <<JSON
{
  "name": "unknown-build-fixture",
  "private": true,
  "packageManager": "$package_manager",
  "dependencies": {
    "unknown-postinstall-package": "file:./unknown-postinstall-package"
  }
}
JSON

cat > "$fixture/pnpm-workspace.yaml" <<'YAML'
allowBuilds:
  esbuild: true
YAML

cat > "$unknown_package/package.json" <<'JSON'
{
  "name": "unknown-postinstall-package",
  "version": "1.0.0",
  "scripts": {
    "postinstall": "node -e \"require('node:fs').writeFileSync('postinstall-ran', 'unexpected')\""
  }
}
JSON

printf 'Checking that an unknown postinstall package is blocked...\n'
set +e
ignored_build_output="$(
  cd "$fixture"
  CI=true corepack pnpm install 2>&1
)"
ignored_build_status=$?
set -e

if [[ "$ignored_build_status" -eq 0 ]]; then
  printf 'Unknown postinstall package was unexpectedly allowed\n%s\n' \
    "$ignored_build_output" >&2
  exit 1
fi

if [[ "$ignored_build_output" != *"[ERR_PNPM_IGNORED_BUILDS]"* ]] \
  || [[ "$ignored_build_output" != *"unknown-postinstall-package"* ]]; then
  printf 'Unknown postinstall package failed without ERR_PNPM_IGNORED_BUILDS:\n%s\n' \
    "$ignored_build_output" >&2
  exit 1
fi

if find "$fixture" -name postinstall-ran -print -quit | grep -q .; then
  printf 'Unknown package postinstall script ran despite being blocked\n' >&2
  exit 1
fi

printf 'Unknown postinstall package was blocked with ERR_PNPM_IGNORED_BUILDS\n'