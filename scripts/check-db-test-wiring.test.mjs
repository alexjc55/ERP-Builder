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

test("a mutating test cannot evade wiring with a plain .test.ts suffix", async () => {
  await withFixture(async ({ root, apiRoot }) => {
    await writeFile(
      path.join(apiRoot, "src", "routes", "misnamed.test.ts"),
      `import { db } from "@workspace/db";
await db.insert(usersTable).values({ name: "unsafe" });
`,
    );
    await expectFailure(root, "must use the .db.test.ts suffix");
  });
});

test("read-only DB use and unrelated mutations do not require DB wiring", async () => {
  await withFixture(async ({ root, apiRoot }) => {
    await writeFile(
      path.join(apiRoot, "src", "routes", "read-only.test.ts"),
      `import { db } from "@workspace/db";
const rows = await db.select().from(usersTable);
const unrelated = { delete() {}, update() {} };
unrelated.delete();
unrelated.update();
`,
    );
    assert.deepEqual(await validateDbTestWiring(root), { dbTestCount: 1 });
  });
});

test("mock-only DB-shaped objects do not require DB wiring", async () => {
  await withFixture(async ({ root, apiRoot }) => {
    await writeFile(
      path.join(apiRoot, "src", "routes", "mock-only.test.ts"),
      `import type { User } from "@workspace/db";
const mockDb = {
  insert: () => ({ values: () => undefined }),
  delete: () => ({ where: () => undefined }),
};
mockDb.insert();
mockDb.delete();
`,
    );
    assert.deepEqual(await validateDbTestWiring(root), { dbTestCount: 1 });
  });
});

test("DB aliases, destructuring, and namespace imports are recognized", async (t) => {
  for (const [name, source] of [
    [
      "named import alias",
      `import { db as database } from "@workspace/db";
const connection = database;
connection.update(usersTable).set({ name: "unsafe" });
`,
    ],
    [
      "method destructuring",
      `import { db } from "@workspace/db";
const { delete: remove } = db;
remove(usersTable);
`,
    ],
    [
      "namespace destructuring",
      `import * as workspaceDb from "@workspace/db";
const { db: database } = workspaceDb;
database.insert(usersTable);
`,
    ],
    [
      "namespace alias",
      `import * as workspaceDb from "@workspace/db";
const storage = workspaceDb;
storage.db.update(usersTable);
`,
    ],
    [
      "dynamic import destructuring",
      `const { db: database } = await import("@workspace/db");
database.delete(usersTable);
`,
    ],
    [
      "dynamic namespace import",
      `const storage = await import("@workspace/db");
storage.db.insert(usersTable);
`,
    ],
  ]) {
    await t.test(name, async () => {
      await withFixture(async ({ root, apiRoot }) => {
        await writeFile(
          path.join(apiRoot, "src", "routes", `${name.replaceAll(" ", "-")}.test.ts`),
          source,
        );
        await expectFailure(root, "must use the .db.test.ts suffix");
      });
    });
  }
});

test("transaction callback mutations are recognized", async () => {
  await withFixture(async ({ root, apiRoot }) => {
    await writeFile(
      path.join(apiRoot, "src", "routes", "transaction.test.ts"),
      `import { db } from "@workspace/db";
await db.transaction(async (tx) => {
  const transaction = tx;
  await transaction.delete(usersTable);
});
`,
    );
    await expectFailure(root, "must use the .db.test.ts suffix");
  });
});

test("named transaction callbacks retain real transaction taint", async (t) => {
  for (const kind of ["local", "imported", "local alias", "imported alias"]) {
    for (const writes of [true, false]) {
      await t.test(`${kind} ${writes ? "mutation" : "read-only"}`, () =>
        withFixture(async ({ root, apiRoot }) => {
          const callback = `async function namedTransaction(tx) {
  const connection = tx;
  await connection.${writes ? "delete(usersTable)" : "select().from(usersTable)"};
}`;
          const imported = kind.startsWith("imported");
          if (imported) {
            await writeFile(path.join(apiRoot, "src/routes/named-transaction.ts"),
              `export ${callback}\n`);
          }
          const declaration = imported ?
            'import { namedTransaction } from "./named-transaction";' : callback;
          const alias = kind.endsWith("alias") ?
            "const firstAlias = namedTransaction; const callbackAlias = firstAlias;" : "";
          await writeFile(path.join(apiRoot, "src/routes/named-transaction.test.ts"),
            `import { db } from "@workspace/db";
${declaration}
${alias}
await db.transaction(${alias ? "callbackAlias" : "namedTransaction"});
`);
          if (writes) await expectFailure(root, "must use the .db.test.ts suffix");
          else assert.deepEqual(await validateDbTestWiring(root), { dbTestCount: 1 });
        }));
    }
  }
});

test("raw SQL detects writes but permits SELECT and mutation words in literals", async (t) => {
  await t.test("mutating SQL", async () => {
    await withFixture(async ({ root, apiRoot }) => {
      await writeFile(
        path.join(apiRoot, "src", "routes", "raw-write.test.ts"),
        `import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
await db.execute(sql\`DELETE FROM users WHERE id = \${userId}\`);
`,
      );
      await expectFailure(root, "must use the .db.test.ts suffix");
    });
  });

  await t.test("read-only SQL", async () => {
    await withFixture(async ({ root, apiRoot }) => {
      await writeFile(
        path.join(apiRoot, "src", "routes", "raw-read.test.ts"),
        `import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
await db.execute(sql\`SELECT 'delete is a label' AS label, update FROM audit_log\`);
`,
      );
      assert.deepEqual(await validateDbTestWiring(root), { dbTestCount: 1 });
    });
  });

  await t.test("data-modifying CTE", async () => {
    await withFixture(async ({ root, apiRoot }) => {
      await writeFile(
        path.join(apiRoot, "src", "routes", "raw-cte-write.test.ts"),
        `import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
await db.execute(sql\`
  WITH changed AS (DELETE FROM users WHERE id = \${userId} RETURNING id)
  SELECT id FROM changed
\`);
`,
      );
      await expectFailure(root, "must use the .db.test.ts suffix");
    });
  });

  await t.test("comment markers and commands inside quoted SQL stay read-only", async () => {
    await withFixture(async ({ root, apiRoot }) => {
      await writeFile(
        path.join(apiRoot, "src", "routes", "raw-quoted-read.test.ts"),
        `import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
await db.execute(sql\`
  SELECT '-- delete is text', $$/* update users */ DELETE FROM decoy$$,
         "update", update(id), 'it''s still -- select text'
  FROM audit_log
\`);
`,
      );
      assert.deepEqual(await validateDbTestWiring(root), { dbTestCount: 1 });
    });
  });
});

test("workspace pool and connected-client SQL mutations are recognized", async (t) => {
  for (const [name, source] of [
    [
      "named pool alias",
      `import { pool as databasePool } from "@workspace/db";
await databasePool.query("UPDATE users SET active = false");
`,
    ],
    [
      "namespace pool",
      `import * as storage from "@workspace/db";
import { sql } from "drizzle-orm";
await storage.pool.query(sql\`DELETE FROM users WHERE id = \${userId}\`);
`,
    ],
    [
      "dynamic pool destructuring",
      `const { pool: databasePool } = await import("@workspace/db");
await databasePool.query("INSERT INTO users(id) VALUES (1)");
`,
    ],
    [
      "connected client alias",
      `import { pool } from "@workspace/db";
const client = await pool.connect();
const connection = client;
await connection.query("TRUNCATE users");
`,
    ],
  ]) {
    await t.test(name, async () => {
      await withFixture(async ({ root, apiRoot }) => {
        await writeFile(
          path.join(apiRoot, "src", "routes", `${name.replaceAll(" ", "-")}.test.ts`),
          source,
        );
        await expectFailure(root, "must use the .db.test.ts suffix");
      });
    });
  }
});

test("read-only workspace pool use and unrelated mock pools remain allowed", async () => {
  await withFixture(async ({ root, apiRoot }) => {
    await writeFile(
      path.join(apiRoot, "src", "routes", "pool-read-only.test.ts"),
      `import { pool } from "@workspace/db";
await pool.query("SELECT update(id), 'delete' FROM audit_log");
await pool.query("SELECT 1 /* outer DELETE /* nested UPDATE */ still comment */");
await pool.end();
const mockPool = { query: async () => undefined };
await mockPool.query("DELETE FROM decoy");
`,
    );
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

test("transitive root/package/shell lock ownership is checked", async (t) => {
  for (const [name, command, wrapper, fails] of [
    ["direct", "bash scripts/with-validation-lock.sh pnpm --filter @workspace/api-server run test:page-select-status-db", "", true],
    ["root alias", "bash scripts/with-validation-lock.sh pnpm run validate:inner", "", true],
    ["shell chain", "bash scripts/outer.sh", "bash scripts/with-validation-lock.sh bash scripts/inner.sh", true],
    ["sourced owner", "bash scripts/outer.sh", 'source "$repo_root/scripts/with-validation-lock.sh"\nacquire_validation_lock\nbash scripts/inner.sh', true],
    ["sourced child owner", "source scripts/owner.sh && pnpm run validate:inner", "", true],
    ["conditional delegation", "bash scripts/outer.sh", "acquire_validation_lock\nif true; then pnpm run validate:inner; fi", true],
    ["unlocked delegation", "bash scripts/outer.sh", "bash scripts/inner.sh", false],
    ["sequential owners", "bash scripts/with-validation-lock.sh echo ok && pnpm run validate:inner", "", false],
    ["quoted/comment decoy", "echo 'bash scripts/with-validation-lock.sh pnpm run validate:inner' # acquire_validation_lock", "", false],
    ["package cycle", "pnpm run validate:cycle", "", false],
  ]) {
    await t.test(name, () => withFixture(async ({ root, scriptsRoot, rootPackage }) => {
      rootPackage.scripts["validate:new"] = command;
      rootPackage.scripts["validate:inner"] = "pnpm --filter @workspace/api-server run test:page-select-status-db";
      rootPackage.scripts["validate:cycle"] = "pnpm run validate:new";
      await writeFile(path.join(root, "package.json"), JSON.stringify(rootPackage));
      await writeFile(path.join(scriptsRoot, "outer.sh"), wrapper);
      await writeFile(path.join(scriptsRoot, "inner.sh"), "pnpm run validate:inner");
      await writeFile(path.join(scriptsRoot, "owner.sh"),
        'source scripts/with-validation-lock.sh\nacquire_validation_lock');
      if (fails) await expectFailure(root, "double validation lock");
      else assert.deepEqual(await validateDbTestWiring(root), { dbTestCount: 1 });
    }));
  }
});

test("local imported helpers propagate only authentic real DB receivers", async (t) => {
  for (const [name, helper, body, fails] of [
    ["closed-over real DB", 'import { db } from "@workspace/db"; export function run() { db.delete(table); }', "run()", true],
    ["real parameter", "export function run(connection) { connection.update(table); }", "run(db)", true],
    ["pool parameter", 'export function run(connection) { connection.query("DELETE FROM t"); }', "run(pool)", true],
    ["transaction parameter", "export function run(connection) { connection.insert(table); }", "db.transaction(tx => run(tx))", true],
    ["helper return", "export function run(connection) { return connection; }", "const connection=run(db); connection.delete(table)", true],
    ["mock parameter", "export function run(connection) { connection.delete(table); }", "run({ delete() {} })", false],
    ["read-only parameter", "export function run(connection) { connection.select().from(table); }", "run(db)", false],
    ["read-only pool", 'export function run(connection) { connection.query("SELECT 1"); }', "run(pool)", false],
    ["unused writer", 'import { db } from "@workspace/db"; export function unused() { db.delete(table); } export function run() {}', "run()", false],
    ["lexical receiver shadow", "export function run(connection) { function unused(connection) { connection.delete(table); } connection.select(); }", "run(db)", false],
  ]) {
    await t.test(name, () => withFixture(async ({ root, apiRoot }) => {
      await writeFile(path.join(apiRoot, "src/routes/helper.ts"), helper);
      await writeFile(path.join(apiRoot, "src/routes/helper-use.test.ts"),
        `import { db, pool } from "@workspace/db"; import { run as invoke } from "./helper"; const run = invoke; ${body};`);
      if (fails) await expectFailure(root, "must use the .db.test.ts suffix");
      else assert.deepEqual(await validateDbTestWiring(root), { dbTestCount: 1 });
    }));
  }
});

test("cyclic local imports and helper call chains terminate and find writes", () =>
  withFixture(async ({ root, apiRoot }) => {
    await writeFile(path.join(apiRoot, "src/routes/a.ts"),
      'import { next } from "./b"; export function run(connection) { next(connection); }');
    await writeFile(path.join(apiRoot, "src/routes/b.ts"),
      'import { run } from "./a"; export function next(connection) { run(connection); connection.delete(table); }');
    await writeFile(path.join(apiRoot, "src/routes/cycle.test.ts"),
      'import { db } from "@workspace/db"; import * as helpers from "./a"; helpers.run(db);');
    await expectFailure(root, "must use the .db.test.ts suffix");
  }));

test("bounded SQL const/alias/config resolution is fail-closed", async (t) => {
  for (const [name, body, fails] of [
    ["const write", 'const text = "DELETE FROM users"; pool.query(text)', true],
    ["alias write", 'const a = "UPDATE users SET x=1"; const b=a; const c=b; pool.query(c)', true],
    ["concatenation write", 'const verb="DEL"; const text=verb+"ETE FROM users"; pool.query(text)', true],
    ["config write", 'const text="INSERT INTO users VALUES(1)"; const config={ text: text + " RETURNING id", values: [] }; pool.query(config)', true],
    ["shorthand config write", 'const text="DROP TABLE users"; pool.query({text})', true],
    ["config read", 'const a="SELECT "; const text=a+"1"; const config={text, values:[]}; const alias=config; pool.query(alias)', false],
    ["SQL shadow read", 'const text="DELETE FROM users"; function read(){const text="SELECT 1"; pool.query(text)} read()', false],
    ["SQL shadow write", 'const text="SELECT 1"; function write(){const text="DELETE FROM users"; pool.query(text)} write()', true],
    ["SQL cycle", 'const a=b; const b=a; pool.query(a)', true],
    ["mutable SQL", 'let text="SELECT 1"; text="DELETE FROM users"; pool.query(text)', true],
    ["unknown SQL", "pool.query(makeSql())", true],
    ["unknown config", "pool.query({text: makeSql()})", true],
    ["unknown interpolation", "pool.query(`SELECT ${makeSql()}`)", true],
    ["mutable const config", 'const config={text:"SELECT 1"}; config.text="DELETE FROM users"; pool.query(config)', true],
    ["mutated config alias", 'const config={text:"SELECT 1"}; const alias=config; alias.text="DELETE FROM users"; pool.query(config)', true],
    ["config spread", 'pool.query({text:"SELECT 1", ...unknown})', true],
    ["duplicate config text", 'pool.query({text:"SELECT 1", text:"DELETE FROM users"})', true],
    ["explain analyze write", 'pool.query("EXPLAIN ANALYZE UPDATE users SET active=false")', true],
    ["explain option write", 'pool.query("EXPLAIN (ANALYZE true, VERBOSE true) UPDATE users SET active=false")', true],
    ["select into", 'pool.query("SELECT id INTO copied_users FROM users")', true],
    ["no SQL", "pool.query()", true],
    ["mock unknown SQL", "const mock={query(){}}; mock.query(makeSql())", false],
  ]) {
    await t.test(name, () => withFixture(async ({ root, apiRoot }) => {
      await writeFile(path.join(apiRoot, "src/routes/sql.test.ts"),
        `import { pool } from "@workspace/db"; ${body};`);
      if (fails) await expectFailure(root, "must use the .db.test.ts suffix");
      else assert.deepEqual(await validateDbTestWiring(root), { dbTestCount: 1 });
    }));
  }
});

test("shell -c and literal JS process launchers preserve transitive lock ownership", async (t) => {
  for (const [name, command, js] of [
    ["shell", `bash scripts/with-validation-lock.sh bash -c 'pnpm run validate:inner'`, ""],
    ["node", "bash scripts/with-validation-lock.sh node scripts/launcher.mjs",
      `import { spawnSync } from "node:child_process"; spawnSync("pnpm", ["--filter", "@workspace/api-server", "run", "test:page-select-status-db"]);`],
    ["opaque node", "bash scripts/with-validation-lock.sh node scripts/launcher.mjs",
      `import { spawnSync } from "node:child_process"; spawnSync(executable, args);`],
  ]) {
    await t.test(name, () => withFixture(async ({ root, scriptsRoot, rootPackage }) => {
      rootPackage.scripts["validate:new"] = command;
      rootPackage.scripts["validate:inner"] = "pnpm --filter @workspace/api-server run test:page-select-status-db";
      await writeFile(path.join(root, "package.json"), JSON.stringify(rootPackage));
      await writeFile(path.join(scriptsRoot, "launcher.mjs"), js);
      await expectFailure(root, name === "opaque node" ? "opaque process launch" : "double validation lock");
    }));
  }
});

test("reexports/default imports and callable object helpers are analyzed", async (t) => {
  for (const [name, helper, bridge, body] of [
    ["reexport", "export function write(connection) { connection.delete(table); }", 'export { write as run } from "./helper";', 'import {run} from "./bridge"; run(db);'],
    ["default", "export default function run(connection) { connection.delete(table); }", "", 'import run from "./helper"; run(db);'],
    ["object", "export const helpers = { run(connection) { connection.delete(table); } };", "", 'import {helpers} from "./helper"; helpers.run(db);'],
    ["arrow property", "export const helpers = { run: connection => connection.delete(table) };", "", 'import {helpers} from "./helper"; helpers.run(db);'],
  ]) {
    await t.test(name, () => withFixture(async ({ root, apiRoot }) => {
      await writeFile(path.join(apiRoot, "src/routes/helper.ts"), helper);
      await writeFile(path.join(apiRoot, "src/routes/bridge.ts"), bridge);
      await writeFile(path.join(apiRoot, "src/routes/imports.test.ts"),
        `import { db } from "@workspace/db"; ${body}`);
      await expectFailure(root, "must use the .db.test.ts suffix");
    }));
  }
});

test("SQL depth exhaustion and opaque imported helpers fail closed", async (t) => {
  await t.test("SQL depth", () => withFixture(async ({ root, apiRoot }) => {
    const aliases = Array.from({ length: 70 }, (_, i) => `const s${i + 1}=s${i};`).join("\n");
    await writeFile(path.join(apiRoot, "src/routes/deep.test.ts"),
      `import { pool } from "@workspace/db"; const s0="SELECT 1"; ${aliases} pool.query(s70);`);
    await expectFailure(root, "must use the .db.test.ts suffix");
  }));
  await t.test("opaque helper", () => withFixture(async ({ root, apiRoot }) => {
    await writeFile(path.join(apiRoot, "src/routes/opaque.test.ts"),
      'import { db } from "@workspace/db"; import { write } from "./missing"; write(db);');
    await expectFailure(root, "must use the .db.test.ts suffix");
  }));
});

test("SQL imported constants and tagged fragments are resolved safely", async (t) => {
  for (const [name, constants, body, fails] of [
    ["imported write", 'export const text="DELETE FROM users";', "pool.query({text})", true],
    ["imported read", 'export const text="SELECT 1";', "pool.query({text})", false],
    ["tagged scalar label", 'export const text="delete is a label";', "pool.query(sql`SELECT ${text} AS label`)", false],
    ["opaque raw fragment", 'export const text=sql.raw(runtimeSql);', "pool.query(sql`SELECT 1 ${text}`)", true],
    ["known CTE fragment", 'export const text=sql`DELETE FROM users RETURNING id`;', "pool.query(sql`WITH changed AS (${text}) SELECT id FROM changed`)", true],
  ]) {
    await t.test(name, () => withFixture(async ({ root, apiRoot }) => {
      await writeFile(path.join(apiRoot, "src/routes/constants.ts"),
        `import {sql} from "drizzle-orm"; ${constants}`);
      await writeFile(path.join(apiRoot, "src/routes/constants.test.ts"),
        `import {pool} from "@workspace/db"; import {sql} from "drizzle-orm"; import {text} from "./constants"; ${body}`);
      if (fails) await expectFailure(root, "must use the .db.test.ts suffix");
      else assert.deepEqual(await validateDbTestWiring(root), { dbTestCount: 1 });
    }));
  }
});

test("invalid helper source and excessive import graphs explicitly fail closed", async (t) => {
  await t.test("syntax", () => withFixture(async ({ root, apiRoot }) => {
    await writeFile(path.join(apiRoot, "src/routes/invalid.ts"), "export function broken( {");
    await writeFile(path.join(apiRoot, "src/routes/invalid.test.ts"), 'import "./invalid";');
    await expectFailure(root, "failed closed: cannot parse local source");
  }));
  await t.test("file limit", () => withFixture(async ({ root, apiRoot }) => {
    await Promise.all(Array.from({ length: 162 }, (_, i) =>
      writeFile(path.join(apiRoot, `src/routes/file${i}.ts`), "export const n=1;")));
    await writeFile(path.join(apiRoot, "src/routes/limit.test.ts"),
      Array.from({ length: 162 }, (_, i) => `import "./file${i}";`).join("\n"));
    await expectFailure(root, "failed closed: local DB analysis file limit exceeded");
  }));
});