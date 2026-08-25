import assert from "node:assert/strict";
import test from "node:test";
import { and, or, sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { EntityField } from "@workspace/db";

// Importing the API's db package constructs a lazy Pool, but these tests never
// connect to it. A deterministic dummy URL keeps the pure regression suite
// runnable outside a provisioned Replit database.
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";

const {
  canAccessAuthoritativePage,
  combineAuthoritativeAndViewerWhere,
  isAuthoritativeViewSelectable,
  mirrorViewSelectionRequired,
} = await import("./authoritative-view");
const {
  buildPageLocalCondition,
  buildRecordQuery,
} = await import("../routes/record-query");

const dialect = new PgDialect();

function compile(fragment: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(fragment);
  return { sql: query.sql.toLowerCase(), params: query.params };
}

const baseView = {
  entityId: 7,
  targetPageId: 11,
  isActive: true,
  visibleRoleIdsJson: [3],
  configJson: { viewType: "pivot", pivot: { rows: [] } },
};

test("selected authoritative view must match every non-role boundary", () => {
  const args = {
    entityId: 7,
    pageId: 11,
    roleIds: [3],
    superAdmin: false,
    requirePivot: true,
  };
  assert.equal(isAuthoritativeViewSelectable(baseView, args), true);
  assert.equal(isAuthoritativeViewSelectable({ ...baseView, entityId: 8 }, args), false);
  assert.equal(isAuthoritativeViewSelectable({ ...baseView, targetPageId: 12 }, args), false);
  assert.equal(isAuthoritativeViewSelectable({ ...baseView, isActive: false }, args), false);
  assert.equal(
    isAuthoritativeViewSelectable({ ...baseView, configJson: { viewType: "table", pivot: {} } }, args),
    false,
  );
  assert.equal(
    isAuthoritativeViewSelectable({ ...baseView, configJson: { viewType: "pivot" } }, args),
    false,
  );
});

test("superAdmin bypasses role visibility only", () => {
  const hidden = { ...baseView, visibleRoleIdsJson: [99] };
  const args = {
    entityId: 7,
    pageId: 11,
    roleIds: [3],
    superAdmin: false,
    requirePivot: true,
  };
  assert.equal(isAuthoritativeViewSelectable(hidden, args), false);
  assert.equal(isAuthoritativeViewSelectable(hidden, { ...args, superAdmin: true }), true);
  assert.equal(
    isAuthoritativeViewSelectable({ ...hidden, entityId: 8 }, { ...args, superAdmin: true }),
    false,
  );
  assert.equal(
    isAuthoritativeViewSelectable({ ...hidden, targetPageId: 12 }, { ...args, superAdmin: true }),
    false,
  );
  assert.equal(
    isAuthoritativeViewSelectable({ ...hidden, isActive: false }, { ...args, superAdmin: true }),
    false,
  );
  assert.equal(
    isAuthoritativeViewSelectable(
      { ...hidden, configJson: { viewType: "table" } },
      { ...args, superAdmin: true },
    ),
    false,
  );
});

test("omitting mirror viewId requires selection iff an active visible candidate exists", () => {
  const inactiveVisible = { ...baseView, isActive: false, visibleRoleIdsJson: [3] };
  const activeHidden = { ...baseView, visibleRoleIdsJson: [99] };
  assert.equal(mirrorViewSelectionRequired([], [3], false), false);
  assert.equal(mirrorViewSelectionRequired([inactiveVisible, activeHidden], [3], false), false);
  assert.equal(
    mirrorViewSelectionRequired([inactiveVisible, activeHidden, baseView], [3], false),
    true,
  );
  assert.equal(mirrorViewSelectionRequired([activeHidden], [3], true), true);
});

test("concrete mirror page context requires explicit page access", () => {
  assert.equal(canAccessAuthoritativePage(undefined, [], false), true);
  assert.equal(canAccessAuthoritativePage(11, [11], false), true);
  assert.equal(canAccessAuthoritativePage(11, [12], false), false);
  assert.equal(canAccessAuthoritativePage(11, [], true), true);
});

test("entity text empty operators use missing/null/empty-string semantics, not a sentinel", () => {
  const fields = [{ fieldKey: "name", fieldType: "text" }] as EntityField[];
  const empty = buildRecordQuery(fields, {
    filters: [{ field: "name", operator: "is_empty" }],
  });
  const notEmpty = buildRecordQuery(fields, {
    filters: [{ field: "name", operator: "is_not_empty" }],
  });
  assert.ok(!("error" in empty) && empty.where);
  assert.ok(!("error" in notEmpty) && notEmpty.where);

  const emptyQuery = compile(empty.where);
  const notEmptyQuery = compile(notEmpty.where);
  assert.match(emptyQuery.sql, /values_json.*->>.*is null.*or.*values_json.*->>.*= ''/);
  assert.match(notEmptyQuery.sql, /values_json.*->>.*is not null.*and.*values_json.*->>.*<> ''/);
  assert.ok(!emptyQuery.params.includes("__empty__"));
  assert.ok(!notEmptyQuery.params.includes("__empty__"));
});

test("page-local empty operators use page-record missing/null/empty-string semantics", () => {
  const empty = buildPageLocalCondition({ field: "note", operator: "is_empty" }, "text", 11);
  const notEmpty = buildPageLocalCondition({ field: "note", operator: "is_not_empty" }, "text", 11);
  assert.ok(!("error" in empty));
  assert.ok(!("error" in notEmpty));

  const emptyQuery = compile(empty.sql);
  const notEmptyQuery = compile(notEmpty.sql);
  for (const query of [emptyQuery, notEmptyQuery]) {
    assert.match(query.sql, /page_record_values/);
    assert.match(query.sql, /page_id/);
    assert.match(query.sql, /record_id/);
    assert.ok(query.params.includes(11));
    assert.ok(query.params.includes("note"));
    assert.ok(!query.params.includes("__empty__"));
  }
  assert.match(emptyQuery.sql, /is null.*or.*= /);
  assert.match(notEmptyQuery.sql, /is not null.*and.*<>/);
});

test("an internal authoritative OR remains grouped under top-level AND viewer filters", () => {
  const hardGroup = or(sql`hard_one`, sql`hard_two`)!;
  const combined = combineAuthoritativeAndViewerWhere(hardGroup, [
    and(sql`viewer_role`, sql`viewer_scope`)!,
  ]);
  assert.ok(combined);
  const query = compile(combined);
  assert.match(
    query.sql.replace(/\s+/g, " ").trim(),
    /^\(\(hard_one or hard_two\) and \(viewer_role and viewer_scope\)\)$/,
  );
});