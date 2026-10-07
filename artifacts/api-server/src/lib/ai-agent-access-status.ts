import type { RolePermissions } from "@workspace/db";

/** Shared with key authorization: ANY admin capability disallows act-as. */
export function hasAgentAdministrativePermissions(p: RolePermissions): boolean {
  return p.superAdmin === true || Object.values(p.admin ?? {}).some(Boolean);
}

type Agent = { id: number; userId: number; isActive: boolean; actsAsUserId: number | null };
type Account = { id: number; roleId: number; isActive: boolean };
type Role = { id: number; permissionsJson: RolePermissions };
type Membership = { userId: number; roleId: number };
type AccessIssue = "module_disabled" | "agent_disabled" | "account_disabled"
  | "linked_user_unavailable" | "linked_user_privileged";

/** Pure, batched configuration diagnostics; never looks up or returns keys. */
export function getAiAgentAccessStatuses(
  agents: Agent[], accounts: Account[], roles: Role[], memberships: Membership[], moduleEnabled: boolean,
) {
  const users = new Map(accounts.map(u => [u.id, u]));
  const privileged = new Set(roles.filter(r => hasAgentAdministrativePermissions(r.permissionsJson)).map(r => r.id));
  const extras = new Map<number, number[]>();
  for (const m of memberships) {
    const ids = extras.get(m.userId) ?? [];
    ids.push(m.roleId);
    extras.set(m.userId, ids);
  }
  return new Map(agents.map(a => {
    const accessIssues: AccessIssue[] = [];
    if (!moduleEnabled) accessIssues.push("module_disabled");
    if (!a.isActive) accessIssues.push("agent_disabled");
    if (!users.get(a.userId)?.isActive) accessIssues.push("account_disabled");
    let accessBlockingRoleIds: number[] = [];
    if (a.actsAsUserId != null) {
      const linked = users.get(a.actsAsUserId);
      if (!linked?.isActive) accessIssues.push("linked_user_unavailable");
      if (linked) {
        accessBlockingRoleIds = [...new Set([linked.roleId, ...(extras.get(linked.id) ?? [])])]
          .filter(id => privileged.has(id));
        if (accessBlockingRoleIds.length) accessIssues.push("linked_user_privileged");
      }
    }
    return [a.id, { accessIssues, accessBlockingRoleIds }] as const;
  }));
}
