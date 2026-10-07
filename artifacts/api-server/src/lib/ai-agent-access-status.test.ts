import assert from "node:assert/strict";
import { test } from "node:test";
import { getAiAgentAccessStatuses, hasAgentAdministrativePermissions } from "./ai-agent-access-status";

type Permissions = Parameters<typeof hasAgentAdministrativePermissions>[0];
const basic = { superAdmin: false, admin: {} } as Permissions;
const admin = { superAdmin: false, admin: { users: true } } as Permissions;
const superAdmin = { superAdmin: true, admin: {} } as Permissions;
const agent = { id: 1, userId: 10, isActive: true, actsAsUserId: 20 as number | null };
const accounts = [{ id: 10, roleId: 1, isActive: true }, { id: 20, roleId: 2, isActive: true }];
const roles = [
  { id: 1, permissionsJson: superAdmin },
  { id: 2, permissionsJson: basic },
  { id: 3, permissionsJson: admin },
];

test("ordinary linked user is allowed even when backing role is privileged", () => {
  assert.deepEqual(getAiAgentAccessStatuses([agent], accounts, roles, [], true).get(1), {
    accessIssues: [], accessBlockingRoleIds: [],
  });
});
test("primary superAdmin blocks act-as", () => {
  const status = getAiAgentAccessStatuses([agent], accounts, [
    ...roles.filter(r => r.id !== 2), { id: 2, permissionsJson: superAdmin },
  ], [], true).get(1)!;
  assert.deepEqual(status.accessIssues, ["linked_user_privileged"]);
  assert.deepEqual(status.accessBlockingRoleIds, [2]);
});
test("one additional administrative permission blocks act-as, without superAdmin", () => {
  const status = getAiAgentAccessStatuses([agent], accounts, roles, [
    { userId: 20, roleId: 3 }, { userId: 20, roleId: 3 },
    { userId: 10, roleId: 1 },
  ], true).get(1)!;
  assert.deepEqual(status.accessIssues, ["linked_user_privileged"]);
  assert.deepEqual(status.accessBlockingRoleIds, [3]);
});
test("disabled administrative flags do not block", () => {
  assert.equal(hasAgentAdministrativePermissions({
    superAdmin: false, admin: { roles: false, users: false },
  } as Permissions), false);
});
test("module, agent and technical account blockers are reported together", () => {
  assert.deepEqual(getAiAgentAccessStatuses(
    [{ ...agent, isActive: false }], accounts.filter(u => u.id !== 10), roles, [], false,
  ).get(1)?.accessIssues, ["module_disabled", "agent_disabled", "account_disabled"]);
});
test("blocked technical account blocks an otherwise valid linked user", () => {
  assert.deepEqual(getAiAgentAccessStatuses(
    [agent], accounts.map(u => u.id === 10 ? { ...u, isActive: false } : u), roles, [], true,
  ).get(1)?.accessIssues, ["account_disabled"]);
});
test("missing or blocked linked users do not silently fall back to technical account", () => {
  for (const users of [
    accounts.filter(u => u.id !== 20),
    accounts.map(u => u.id === 20 ? { ...u, isActive: false } : u),
  ]) {
    assert.deepEqual(getAiAgentAccessStatuses([agent], users, roles, [], true).get(1)?.accessIssues,
      ["linked_user_unavailable"]);
  }
});
test("standalone privileged agent is not falsely flagged by the act-as-only rule", () => {
  assert.deepEqual(getAiAgentAccessStatuses(
    [{ ...agent, actsAsUserId: null }], accounts, roles, [{ userId: 10, roleId: 3 }], true,
  ).get(1)?.accessIssues, []);
});
test("new role permissions are evaluated on every diagnostic read", () => {
  const promoted = roles.map(r => r.id === 2 ? { ...r, permissionsJson: admin } : r);
  assert.deepEqual(getAiAgentAccessStatuses([agent], accounts, promoted, [], true).get(1)?.accessIssues,
    ["linked_user_privileged"]);
  assert.deepEqual(getAiAgentAccessStatuses([agent], accounts, roles, [], true).get(1)?.accessIssues, []);
});
test("empty agent list and multiple agents keep diagnostics isolated", () => {
  assert.equal(getAiAgentAccessStatuses([], [], [], [], false).size, 0);
  const statuses = getAiAgentAccessStatuses([agent, { ...agent, id: 2, actsAsUserId: null }], accounts, roles,
    [{ userId: 20, roleId: 3 }], true);
  assert.deepEqual(statuses.get(1)?.accessIssues, ["linked_user_privileged"]);
  assert.deepEqual(statuses.get(2)?.accessIssues, []);
});
