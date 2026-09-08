import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateDbTestWiring } from "./check-db-test-wiring.mjs";

const DB_TEST = "src/routes/page-select-status-sync.db.test.ts";
const VALID_DB_COMMAND =
  "bash ../../scripts/with-validation-lock.sh tsx --test --test-concurrency=1 " +
  DB_TEST;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "db-wiring-"));
  const apiRoot = path.join(root, "artifacts", "api-server");
  const scriptsRoot = path.join(root, "scripts");
  await mkdir(path.join(apiRoot, "src", "routes"), { recursive: true });
  await mkdir(scriptsRoot, { recursive: true });

  const rootPackage = {
    scripts: {
      release:
        "pnpm run typecheck && pnpm run validate:page-select-status-sync && " +
        "pnpm --filter @workspace/db run generate",
      "validate:page-select-status-sync":
        "bash scripts/validate-page-select-status-sync.sh",
      "validate:db-test-wiring": "node scripts/check-db-test-wiring.mjs",
    },
  };
  const apiPackage = {
    scripts: {
      "test:page-select-status-db": VALID_DB_COMMAND,
    },
  };
  const wrapper = `#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

node scripts/check-db-test-wiring.mjs
corepack pnpm --filter @workspace/api-server run test:page-select-status-db
`;
  await Promise.all([
    writeFile(
      path.join(root, "package.json"),
      JSON.stringify(rootPackage, null, 2),
    ),
    writeFile(
      path.join(apiRoot, "package.json"),
      JSON.stringify(apiPackage, null, 2),
    ),
    writeFile(
      path.join(apiRoot, DB_TEST),
      "// fixture DB test\n",
    ),
    writeFile(
      path.join(scriptsRoot, "validate-page-select-status-sync.sh"),
      wrapper,
    ),
  ]);
  return { root, apiRoot, scriptsRoot, rootPackage, apiPackage, wrapper };
}

async function withFixture(run) {
  const project = await fixture();
  try {
    await run(project);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
}

async function expectFailure(root, substring) {
  await assert.rejects(
    validateDbTestWiring(root),
    (error) =>
      error instanceof Error &&
      error.message.includes("DB test wiring validation failed") &&
      error.message.includes(substring),
    `expected validation error containing ${JSON.stringify(substring)}`,
  );
}

test("valid DB test wiring passes", async () => {
  await withFixture(async ({ root }) => {
    assert.deepEqual(await validateDbTestWiring(root), { dbTestCount: 1 });
  });
});

test("release gate is required", async () => {
  await withFixture(async ({ root, rootPackage }) => {
    rootPackage.scripts.release =
      "pnpm run typecheck && pnpm --filter @workspace/db run generate";
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify(rootPackage),
    );
    await expectFailure(root, "exact safe sequence");
  });
});

test("release gate must precede schema generation", async () => {
  await withFixture(async ({ root, rootPackage }) => {
    rootPackage.scripts.release =
      "pnpm --filter @workspace/db run generate && " +
      "pnpm run validate:page-select-status-sync";
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify(rootPackage),
    );
    await expectFailure(root, "page gate before schema generation");
  });
});

test("release gate cannot be satisfied by an echo decoy", async () => {
  await withFixture(async ({ root, rootPackage }) => {
    rootPackage.scripts.release =
      "echo pnpm run validate:page-select-status-sync && " +
      "pnpm --filter @workspace/db run generate";
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify(rootPackage),
    );
    await expectFailure(root, "exact safe sequence");
  });
});

test("quoted release pipeline decoys are rejected", async () => {
  await withFixture(async ({ root, rootPackage }) => {
    rootPackage.scripts.release =
      'echo "x && pnpm run validate:page-select-status-sync && y" && ' +
      "pnpm --filter @workspace/db run generate";
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify(rootPackage),
    );
    await expectFailure(root, "page gate before schema generation");
  });
});

test("page-select wrapper cannot route to another API script", async () => {
  await withFixture(async ({ root, scriptsRoot, wrapper }) => {
    await writeFile(
      path.join(scriptsRoot, "validate-page-select-status-sync.sh"),
      wrapper.replace(
        "test:page-select-status-db",
        "test:some-other-db",
      ),
    );
    await expectFailure(root, "must delegate exactly");
  });
});

test("page-select wrapper must invoke the wiring guard", async () => {
  await withFixture(async ({ root, scriptsRoot, wrapper }) => {
    await writeFile(
      path.join(scriptsRoot, "validate-page-select-status-sync.sh"),
      wrapper.replace("node scripts/check-db-test-wiring.mjs\n", ""),
    );
    await expectFailure(root, "must invoke exactly once");
  });
});

test("a newly added DB test must be registered", async () => {
  await withFixture(async ({ root, apiRoot }) => {
    await writeFile(
      path.join(apiRoot, "src", "routes", "new-feature.db.test.ts"),
      "// new fixture test\n",
    );
    await expectFailure(root, "new-feature.db.test.ts\" is unregistered");
  });
});

test("DB commands require the shared lock runner", async () => {
  await withFixture(async ({ root, apiRoot, apiPackage }) => {
    apiPackage.scripts["test:page-select-status-db"] =
      `tsx --test --test-concurrency=1 ${DB_TEST}`;
    await writeFile(
      path.join(apiRoot, "package.json"),
      JSON.stringify(apiPackage),
    );
    await expectFailure(root, "shared validation lock before tsx");
  });
});

test("DB commands reject comment-based flag and target decoys", async () => {
  await withFixture(async ({ root, apiRoot, apiPackage }) => {
    apiPackage.scripts["test:page-select-status-db"] =
      `tsx harmless.ts # --test --test-concurrency=1 ${DB_TEST}`;
    await writeFile(
      path.join(apiRoot, "package.json"),
      JSON.stringify(apiPackage),
    );
    await expectFailure(root, "must use exact DB command format");
  });
});

test("DB commands reject extra executable targets", async () => {
  await withFixture(async ({ root, apiRoot, apiPackage }) => {
    apiPackage.scripts["test:page-select-status-db"] =
      `${VALID_DB_COMMAND} src/routes/another.db.test.ts`;
    await writeFile(
      path.join(apiRoot, "package.json"),
      JSON.stringify(apiPackage),
    );
    await expectFailure(root, "must use exact DB command format");
  });
});

test("DB commands reject duplicate lock, flag, or path tokens", async (t) => {
  for (const [name, command] of [
    [
      "lock",
      VALID_DB_COMMAND.replace(
        " tsx",
        " ../../scripts/with-validation-lock.sh tsx",
      ),
    ],
    ["flag", `${VALID_DB_COMMAND} --test-concurrency=1`],
    ["path", `${VALID_DB_COMMAND} ${DB_TEST}`],
  ]) {
    await t.test(name, async () => {
      await withFixture(async ({ root, apiRoot, apiPackage }) => {
        apiPackage.scripts["test:page-select-status-db"] = command;
        await writeFile(
          path.join(apiRoot, "package.json"),
          JSON.stringify(apiPackage),
        );
        await expectFailure(root, "must use exact DB command format");
      });
    });
  }
});

test("DB commands require exactly concurrency one", async (t) => {
  await t.test("missing concurrency", async () => {
    await withFixture(async ({ root, apiRoot, apiPackage }) => {
      apiPackage.scripts["test:page-select-status-db"] =
        `bash ../../scripts/with-validation-lock.sh tsx --test ${DB_TEST}`;
      await writeFile(
        path.join(apiRoot, "package.json"),
        JSON.stringify(apiPackage),
      );
      await expectFailure(root, "exactly --test-concurrency=1");
    });
  });

  await t.test("alternate concurrency", async () => {
    await withFixture(async ({ root, apiRoot, apiPackage }) => {
      apiPackage.scripts["test:page-select-status-db"] =
        VALID_DB_COMMAND.replace("--test-concurrency=1", "--test-concurrency=2");
      await writeFile(
        path.join(apiRoot, "package.json"),
        JSON.stringify(apiPackage),
      );
      await expectFailure(root, "exactly --test-concurrency=1");
    });
  });
});

test("DB commands require a standalone --test token", async () => {
  await withFixture(async ({ root, apiRoot, apiPackage }) => {
    apiPackage.scripts["test:page-select-status-db"] =
      VALID_DB_COMMAND.replace(" --test ", " ");
    await writeFile(
      path.join(apiRoot, "package.json"),
      JSON.stringify(apiPackage),
    );
    await expectFailure(root, "exactly one standalone --test token");
  });
});

test("root quick guard script must map exactly to the checker", async () => {
  await withFixture(async ({ root, rootPackage }) => {
    rootPackage.scripts["validate:db-test-wiring"] = "echo skipped";
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify(rootPackage),
    );
    await expectFailure(root, "validate:db-test-wiring must point exactly");
  });
});

test("page-select wrapper cannot acquire a nested validation lock", async () => {
  await withFixture(async ({ root, scriptsRoot, wrapper }) => {
    await writeFile(
      path.join(scriptsRoot, "validate-page-select-status-sync.sh"),
      wrapper.replace(
        "corepack pnpm",
        "bash scripts/with-validation-lock.sh corepack pnpm",
      ),
    );
    await expectFailure(root, "must not acquire validation lock");
  });
});

test("page-select wrapper rejects early exit before delegation", async () => {
  await withFixture(async ({ root, scriptsRoot, wrapper }) => {
    await writeFile(
      path.join(scriptsRoot, "validate-page-select-status-sync.sh"),
      wrapper.replace(
        "node scripts/check-db-test-wiring.mjs",
        "node scripts/check-db-test-wiring.mjs\nexit 0",
      ),
    );
    await expectFailure(root, "exact safe validation/delegation template");
  });
});

test("page-select wrapper rejects reversed guard and delegation", async () => {
  await withFixture(async ({ root, scriptsRoot, wrapper }) => {
    const guard = "node scripts/check-db-test-wiring.mjs";
    const delegation =
      "corepack pnpm --filter @workspace/api-server run test:page-select-status-db";
    await writeFile(
      path.join(scriptsRoot, "validate-page-select-status-sync.sh"),
      wrapper.replace(`${guard}\n${delegation}`, `${delegation}\n${guard}`),
    );
    await expectFailure(root, "must run the DB wiring guard before API delegation");
  });
});

test("page-select wrapper rejects guard inside an unreachable conditional", async () => {
  await withFixture(async ({ root, scriptsRoot, wrapper }) => {
    await writeFile(
      path.join(scriptsRoot, "validate-page-select-status-sync.sh"),
      wrapper.replace(
        "node scripts/check-db-test-wiring.mjs",
        "if false; then node scripts/check-db-test-wiring.mjs; fi",
      ),
    );
    await expectFailure(root, "exact safe validation/delegation template");
  });
});

test("a DB test cannot have duplicate script registrations", async () => {
  await withFixture(async ({ root, apiRoot, apiPackage }) => {
    apiPackage.scripts["test:page-select-status-copy-db"] = VALID_DB_COMMAND;
    await writeFile(
      path.join(apiRoot, "package.json"),
      JSON.stringify(apiPackage),
    );
    await expectFailure(root, "is multiply registered");
  });
});

test("DB scripts cannot reference unknown DB tests", async () => {
  await withFixture(async ({ root, apiRoot, apiPackage }) => {
    apiPackage.scripts["test:unknown-db"] =
      "bash ../../scripts/with-validation-lock.sh tsx --test --test-concurrency=1 " +
      "src/routes/not-in-inventory.db.test.ts";
    await writeFile(
      path.join(apiRoot, "package.json"),
      JSON.stringify(apiPackage),
    );
    await expectFailure(root, "references unknown DB test file");
  });
});