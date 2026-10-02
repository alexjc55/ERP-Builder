# Static DB-test wiring guard

Run these checks without connecting to a database:

```sh
node --test scripts/check-db-test-wiring.test.mjs
node scripts/check-db-test-wiring.mjs
```

The scanner reads source, package scripts, and wrapper files. It never imports or
executes inspected tests/helpers, launches inspected commands, or sends SQL.
The existing exact page-select release gate and exact locked/sequential API
`.db.test.ts` registration format remain mandatory.

## Lock ownership (consolidated task 113)

Every root `validate:*` and `test:*` script seeds a bounded command graph.
The graph follows root/API package-script aliases, literal local shell wrappers,
`source`/`.` wrappers, `bash`/`sh -c`, and literal Node subprocess launches.
It understands `corepack`, `env`, environment assignments, `exec`, API
`--filter`/`-F`/`--filter=`, and package-directory `--dir`/`-C`/`--prefix`.
Repository-root `cd` and `$repo_root` wrapper paths are recognized.

The lock runner holds the lock only across its delegated command; sequential
lock-owning commands are permitted. A sourced `acquire_validation_lock` retains
ownership in the caller. A second acquisition anywhere below an owner fails
with a command-chain diagnostic. Graph cycles terminate using path-local
command/ownership/cwd states. Shell comments, quoted `echo` decoys, and heredoc
bodies do not create executable command edges.

Limits: 4,000 graph visits and 64 chain entries, with explicit failures on
exhaustion or unreadable wrappers. Node launchers support string executable and
literal string-array arguments to conventional `spawn`/`spawnSync`,
`execFile`/`execFileSync`, and `exec`/`execSync` calls. Opaque recognized
process launches **under a held lock fail closed**.

This is not a general shell/JavaScript interpreter. Dynamic wrapper paths,
shell `eval`, arbitrary shell functions/subshells, command substitutions,
arbitrary workspace selectors, aliased/custom process-launch APIs, dynamic JS
launcher chains, subprocess `cwd` options, and custom lock acquisition APIs
are not comprehensively resolved. Keep validation delegation literal and
explicit. Shell branches and recognized JS launches are considered
potentially reachable; dead branches can conservatively produce failures.
The graph does not establish fixture cleanup or database identity.

## Local helper taint (consolidated task 125)

TypeScript source is loaded using a local-only compiler host: no package code
or TypeScript libraries are loaded. Relative `.ts`/`.tsx`/`.mts`, index modules,
and `.js`-specifier-to-`.ts` source imports are followed inside the repository.
Symbol identity distinguishes lexical shadowing.

Authentic `@workspace/db` named/namespace imports and dynamic workspace-DB
imports seed DB/pool receivers. Aliases, destructured DB methods, connected
clients, transaction parameters, and block-bodied helper connection returns
propagate taint. Statically callable local function/arrow helpers, namespace
and default imports, reexports, callable object properties, function aliases,
and helper-to-helper arguments are followed to a fixed point. Imported
top-level code is considered, but unused helper functions and imported route
registration callbacks are not automatically treated as executed tests.
Active test/helper callbacks are conservatively considered executable.

`helper(realDb)` writes require DB registration. The same helper called only
with a DB-shaped mock does not. Read-only helper operations remain allowed.
An unresolved imported helper given a known real connection fails closed.
Mutation diagnostics include both the test path and the helper source location.
Import and helper-call cycles terminate.

Limits: 160 source files, 120,000 active AST nodes, 200 propagation passes,
and 64 symbolic-resolution levels. Exhaustion and source parse errors produce
explicit analysis failures rather than an approving result.

This is intentionally not full interprocedural execution. Taint is a
conservative union across calls within each test analysis, not path-sensitive.
Computed/dynamic dispatch, reflective APIs, arbitrary object-container taint,
dynamic local-helper imports, dependency-injection registries, external
package helpers, DB reexports through arbitrary facade packages, async
background scheduling, and arbitrary function-return factories are not fully
modeled. Runtime monkey-patching of a real imported DB is not accepted as
proof that writes are mock-only. Use genuine mock receivers and explicit
isolated mock runners. A passing guard is not a sandbox or permission to run
unguarded fixture code.

## SQL resolution (consolidated task 126)

Real DB `execute`/pool-client `query` calls and their tracked method aliases
resolve string literals, local/imported immutable const aliases, exact string
concatenation, bounded template expressions, Drizzle-style tagged SQL/raw,
and PostgreSQL `{ text, values }` configs (including shorthand text and
const/alias config chains). Symbol resolution respects shadowing.
Recognized direct/property/alias assignments, unary writes, deletes, and
`Object.assign` invalidate const-object read-only proofs.

Missing SQL, unresolved runtime SQL, mutable bindings, cycles, exhausted
resolution depth, opaque config text, spreads/computed config keys, duplicate
text keys, and commandless SQL **fail closed**: the test requires the protected
DB suffix/registration. This is intentionally conservative, not an assertion
that every such expression actually writes.

SQL tokenization ignores comments, quoted strings/identifiers and dollar
strings. It recognizes write commands, multiple statements, data-modifying
CTEs, `SELECT INTO`, and `EXPLAIN ANALYZE` writes. Ordinary SELECTs and mutation
words in their labels/values remain read-only. Plain templates require all
text pieces to resolve. Conventional tagged scalar interpolations are treated
as value placeholders, not SQL command text; recognizable SQL fragments and
runtime fragment calls must resolve or fail closed.

Remaining limits: SQL dialect/function semantics are not interpreted. A
SELECT can invoke a mutating stored function, and opaque externally supplied
tagged SQL fragments cannot always be distinguished from scalar parameters.
Arbitrary setters/getters, cross-module object mutation/escape, spread-based
config construction, custom tags/query builders, generated SQL, and advanced
SQL procedural statements are not read-only proofs. Keep mutating tests
explicitly registered even when their writes fall outside these patterns.