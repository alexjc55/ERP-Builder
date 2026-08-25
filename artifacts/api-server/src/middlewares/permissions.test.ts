import assert from "node:assert/strict";
import test from "node:test";
import type { RoleAdminCaps, RolePermissions } from "@workspace/db";

// Importing the API's db package constructs a lazy Pool, but these pure tests
// never connect to it.
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";

const {
  mergePermissions,
  primaryFirstRoleIds,
} = await import("./permissions");

const noAdmin: RoleAdminCaps = {
  pages: false,
  entities: false,
  roles: false,
  users: false,
  translations: false,
  events: false,
  modules: false,
  automations: false,
  customFilters: false,
  columnGroups: false,
  googleDrive: false,
  settings: false,
  dataImport: false,
};

test("primaryFirstRoleIds always puts the primary role first", () => {
  assert.deepEqual(primaryFirstRoleIds([7, 1], 1), [1, 7]);
  assert.deepEqual(primaryFirstRoleIds([7], 1), [1, 7]);
  assert.deepEqual(primaryFirstRoleIds([7, 1, 7, 1], 1), [1, 7]);
});

test("an additional restricted role cannot override administrator access", () => {
  const administrator: RolePermissions = {
    superAdmin: true,
    admin: noAdmin,
    pageIds: [10],
    records: {},
  };
  const projectManager: RolePermissions = {
    superAdmin: false,
    admin: noAdmin,
    dashboard: false,
    pageIds: [20],
    homePageId: 20,
    records: {},
  };

  const merged = mergePermissions([administrator, projectManager]);

  assert.equal(merged.superAdmin, true);
  assert.notEqual(merged.dashboard, false);
  assert.deepEqual(merged.pageIds, [10, 20]);
  assert.equal(merged.homePageId, undefined);
});

test("only the primary role controls the merged start page", () => {
  const primary: RolePermissions = {
    superAdmin: false,
    admin: noAdmin,
    pageIds: [10],
    homePageId: 10,
    records: {},
  };
  const additional: RolePermissions = {
    superAdmin: false,
    admin: noAdmin,
    pageIds: [20],
    homePageId: 20,
    records: {},
  };

  assert.equal(mergePermissions([primary, additional]).homePageId, 10);
  assert.equal(mergePermissions([{ ...primary, homePageId: null }, additional]).homePageId, undefined);
});

test("dashboard is denied only when every assigned role denies it", () => {
  const denied: RolePermissions = {
    superAdmin: false,
    admin: noAdmin,
    dashboard: false,
    pageIds: [],
    records: {},
  };
  const allowed: RolePermissions = {
    superAdmin: false,
    admin: noAdmin,
    pageIds: [],
    records: {},
  };

  assert.equal(mergePermissions([denied, denied]).dashboard, false);
  assert.notEqual(mergePermissions([denied, allowed]).dashboard, false);
});