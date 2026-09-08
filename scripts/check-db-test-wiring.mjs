#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_DIR = path.join("artifacts", "api-server");
const LOCK_RUNNER = "../../scripts/with-validation-lock.sh";
const PAGE_TEST = "src/routes/page-select-status-sync.db.test.ts";
const RELEASE_SCRIPT =
  "pnpm run typecheck && pnpm run validate:page-select-status-sync && pnpm --filter @workspace/db run generate";
const DB_COMMAND_FORMAT =
  /^bash \.\.\/\.\.\/scripts\/with-validation-lock\.sh tsx --test --test-concurrency=1 (src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.db\.test\.ts)$/;
const PAGE_SELECT_WRAPPER = `#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

node scripts/check-db-test-wiring.mjs
corepack pnpm --filter @workspace/api-server run test:page-select-status-db
`;

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function findDbTests(directory, relativeTo) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findDbTests(absolute, relativeTo)));
    } else if (entry.isFile() && entry.name.endsWith(".db.test.ts")) {
      found.push(path.relative(relativeTo, absolute).split(path.sep).join("/"));
    }
  }
  return found.sort();
}

function dbTestReferences(command) {
  return (
    command.match(/[^\s"';&|()]+\.db\.test\.ts\b/g)?.map((value) =>
      value.replace(/^\.\//, ""),
    ) ?? []
  );
}

function validateDbCommand(scriptName, command, errors) {
  const label = `API script "${scriptName}"`;
  const references = dbTestReferences(command);
  const exactMatch = command.match(DB_COMMAND_FORMAT);
  if (!exactMatch) {
    errors.push(
      `${label} must use exact DB command format: bash ${LOCK_RUNNER} tsx --test --test-concurrency=1 src/<safe-path>.db.test.ts`,
    );
  }
  if (references.length !== 1) {
    errors.push(
      `${label} must reference exactly one .db.test.ts file (found ${references.length})`,
    );
  }

  const tokens = command.trim().split(/\s+/);
  const lockIndexes = tokens.flatMap((token, index) =>
    token === LOCK_RUNNER ? [index] : [],
  );
  const tsxIndexes = tokens.flatMap((token, index) =>
    token === "tsx" ? [index] : [],
  );
  if (
    tokens[0] !== "bash" ||
    lockIndexes.length !== 1 ||
    lockIndexes[0] !== 1 ||
    tsxIndexes.length !== 1 ||
    tsxIndexes[0] !== 2
  ) {
    errors.push(
      `${label} must safely invoke "bash ${LOCK_RUNNER} tsx" with the shared validation lock before tsx`,
    );
  }
  if (/[;&|]/.test(command)) {
    errors.push(`${label} contains unsafe shell control operators`);
  }

  const concurrency = tokens.filter((token) =>
    token.startsWith("--test-concurrency"),
  );
  if (concurrency.length !== 1 || concurrency[0] !== "--test-concurrency=1") {
    errors.push(
      `${label} must contain exactly --test-concurrency=1 (no missing or alternate concurrency)`,
    );
  }
  if (tokens.filter((token) => token === "--test").length !== 1) {
    errors.push(`${label} must contain exactly one standalone --test token`);
  }
  return exactMatch ? [exactMatch[1]] : references;
}

export async function validateDbTestWiring(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const apiRoot = path.join(root, API_DIR);
  const [rootPackage, apiPackage, wrapper, dbTests] = await Promise.all([
    readJson(path.join(root, "package.json")),
    readJson(path.join(apiRoot, "package.json")),
    readFile(
      path.join(root, "scripts", "validate-page-select-status-sync.sh"),
      "utf8",
    ),
    findDbTests(path.join(apiRoot, "src"), apiRoot),
  ]);
  const errors = [];
  const registrations = new Map(dbTests.map((file) => [file, []]));

  for (const [name, value] of Object.entries(apiPackage.scripts ?? {})) {
    if (typeof value !== "string" || !value.includes(".db.test.ts")) continue;
    const references = validateDbCommand(name, value, errors);
    for (const reference of references) {
      if (!registrations.has(reference)) {
        errors.push(
          `API script "${name}" references unknown DB test file "${reference}"`,
        );
      } else {
        registrations.get(reference).push(name);
      }
    }
  }

  for (const [file, scripts] of registrations) {
    if (scripts.length === 0) {
      errors.push(`DB test "${file}" is unregistered in API package scripts`);
    } else if (scripts.length > 1) {
      errors.push(
        `DB test "${file}" is multiply registered by API scripts: ${scripts.join(", ")}`,
      );
    }
  }

  if (rootPackage.scripts?.release !== RELEASE_SCRIPT) {
    errors.push(
      `root release script must run the exact safe sequence (page gate before schema generation): "${RELEASE_SCRIPT}"`,
    );
  }

  const rootGate = rootPackage.scripts?.["validate:page-select-status-sync"];
  if (rootGate !== "bash scripts/validate-page-select-status-sync.sh") {
    errors.push(
      `root validate:page-select-status-sync must point to "bash scripts/validate-page-select-status-sync.sh"`,
    );
  }
  if (
    rootPackage.scripts?.["validate:db-test-wiring"] !==
    "node scripts/check-db-test-wiring.mjs"
  ) {
    errors.push(
      'root validate:db-test-wiring must point exactly to "node scripts/check-db-test-wiring.mjs"',
    );
  }

  if (/with-validation-lock\.sh/.test(wrapper)) {
    errors.push(
      "page-select validation wrapper must not acquire validation lock; the API DB command owns the single lock",
    );
  }
  if (wrapper !== PAGE_SELECT_WRAPPER) {
    errors.push(
      "page-select validation wrapper must match the exact safe validation/delegation template",
    );
  }
  const wrapperLines = wrapper.split(/\r?\n/).map((line) => line.trim());
  const delegationLineMatches = wrapperLines.flatMap((line, index) => {
    const match = line.match(
      /^(?:corepack\s+)?pnpm\s+--filter\s+@workspace\/api-server\s+run\s+([^\s]+)$/,
    );
    return match ? [{ index, script: match[1] }] : [];
  });
  const delegatedScripts = delegationLineMatches.map((match) => match.script);
  if (
    delegatedScripts.length !== 1 ||
    delegatedScripts[0] !== "test:page-select-status-db"
  ) {
    errors.push(
      'page-select validation wrapper must delegate exactly to API script "test:page-select-status-db"',
    );
  }
  const guard = "node scripts/check-db-test-wiring.mjs";
  const guardLineIndexes = wrapperLines.flatMap((line, index) =>
    line === guard ? [index] : [],
  );
  const delegationLineIndex = delegationLineMatches.find(
    (match) => match.script === "test:page-select-status-db",
  )?.index;
  if (guardLineIndexes.length !== 1) {
    errors.push(
      `page-select validation wrapper must invoke exactly once "${guard}" (found ${guardLineIndexes.length})`,
    );
  } else if (
    delegationLineIndex !== undefined &&
    guardLineIndexes[0] > delegationLineIndex
  ) {
    errors.push(
      "page-select validation wrapper must run the DB wiring guard before API delegation",
    );
  }

  const pageScript = apiPackage.scripts?.["test:page-select-status-db"];
  const pageReferences =
    typeof pageScript === "string" ? dbTestReferences(pageScript) : [];
  if (
    pageReferences.length !== 1 ||
    pageReferences[0] !== PAGE_TEST
  ) {
    errors.push(
      `API script "test:page-select-status-db" must map exactly to "${PAGE_TEST}"`,
    );
  }

  if (errors.length) {
    throw new Error(
      `DB test wiring validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
  return { dbTestCount: dbTests.length };
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  try {
    const result = await validateDbTestWiring();
    console.log(`DB test wiring is valid (${result.dbTestCount} tests).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}