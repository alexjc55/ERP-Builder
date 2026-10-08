import { db, rolesTable, usersTable, userRolesTable, modulesTable, inboundMappingVersionsTable,
  type RolePermissions } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { validateInboundMapping, type InboundMapping } from "./inbound-mapping";

export function inboundRoleIsPrivileged(perms: RolePermissions | null | undefined): boolean {
  return !perms || perms.superAdmin === true || Object.values(perms.admin ?? {}).some(Boolean);
}

/** A guest role is defined by effective capabilities, not a renameable label. */
export function isInboundGuestRole(perms: RolePermissions | null | undefined): boolean {
  return !!perms && !inboundRoleIsPrivileged(perms) &&
    Object.values(perms.records ?? {}).every((r) => !r.create && !r.update && !r.delete);
}

export function inboundEventPolicyValid(mapping: InboundMapping): boolean {
  return Array.isArray(mapping.allowedEvents) && mapping.allowedEvents.length > 0 &&
    mapping.allowedEvents.length <= 30 &&
    mapping.allowedEvents.every((event) => typeof event === "string" &&
      event.length > 0 && event.length <= 120 && event.trim() === event && event !== "*");
}

export function inboundEventAllowed(mapping: InboundMapping, payload: unknown): boolean {
  if (!inboundEventPolicyValid(mapping) || !payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const event = (payload as Record<string, unknown>).event;
  return typeof event === "string" && mapping.allowedEvents!.includes(event);
}

type Executor = Pick<typeof db, "select">;
export async function inboundSafetyIssues(
  integration: { userId: number; roleId: number; publishedMappingVersionId?: number | null },
  exec: Executor = db,
  draft?: InboundMapping,
): Promise<string[]> {
  const issues: string[] = [];
  const [module] = await exec.select().from(modulesTable).where(eq(modulesTable.moduleKey, "inbound_integrations")).for("share");
  if (!module?.isEnabled) issues.push("Модуль входящих интеграций выключен");
  const [user] = await exec.select().from(usersTable).where(eq(usersTable.id, integration.userId)).for("share");
  if (!user?.isActive) issues.push("Технический пользователь отключён");
  const extras = await exec.select().from(userRolesTable).where(eq(userRolesTable.userId, integration.userId));
  const ids = [...new Set([integration.roleId, user?.roleId, ...extras.map((r) => r.roleId)].filter((id): id is number => !!id))];
  const roles = await exec.select().from(rolesTable).where(inArray(rolesTable.id, ids)).for("share");
  if (roles.length !== ids.length || roles.some((r) => inboundRoleIsPrivileged(r.permissionsJson)))
    issues.push("У интеграции есть административная роль. Выберите роль без административных прав");
  let mapping = draft;
  if (!mapping && integration.publishedMappingVersionId) {
    const [version] = await exec.select().from(inboundMappingVersionsTable)
      .where(eq(inboundMappingVersionsTable.id, integration.publishedMappingVersionId));
    const checked = validateInboundMapping(version?.mappingJson);
    if (checked.ok) mapping = checked.mapping;
  }
  if (!mapping) return [...issues, "Нет безопасного опубликованного сценария"];
  if (!inboundEventPolicyValid(mapping)) issues.push("Укажите разрешённые события и опубликуйте сценарий заново");
  const userSteps = mapping.steps.filter((step) => step.target.kind === "user" &&
    (step.operation === "create" || step.operation === "upsert"));
  for (const step of userSteps) {
    if (step.target.kind !== "user") continue;
    const [role] = await exec.select().from(rolesTable).where(eq(rolesTable.id, step.target.roleId)).for("share");
    if (!isInboundGuestRole(role?.permissionsJson))
      issues.push(`Шаг ${step.key}: создание разрешено только с гостевой ролью без прав записи и администрирования`);
  }
  return issues;
}
