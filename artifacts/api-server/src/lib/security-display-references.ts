import { inArray } from "drizzle-orm";
import {
  db, usersTable, rolesTable, aiAgentsTable, inboundIntegrationsTable,
  entitiesTable, entityRecordsTable, entityFieldsTable,
} from "@workspace/db";

type Kind = "user" | "role" | "agent" | "integration" | "entity" | "record";
type Relation = "actor" | "impersonator" | "target" | "reviewer" | "agent" | "integration" | "requested_role" | "entity" | "record";
type Ref = { kind: Kind; relation: Relation; id: number; missing: boolean; nameJson?: Record<string, string> };
type Evidence = {
  actorUserId?: number | null; impersonatorUserId?: number | null; targetUserId?: number | null;
  agentId?: number | null; integrationId?: number | null; reviewedBy?: number | null;
  detailsJson: unknown;
};
function positiveId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
function names(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((pair): pair is [string, string] =>
    typeof pair[1] === "string").map(([key, value]) => [key, value.slice(0, 200)]));
}
function plainName(value: string) {
  const name = value.replace(/\s+/g, " ").trim().slice(0, 200);
  return { ru: name, en: name, he: name };
}

export function securityReferenceIds(event: Evidence): Ref[] {
  const refs: Ref[] = [];
  const add = (kind: Kind, relation: Relation, value: unknown) => {
    const id = positiveId(value);
    if (id && !refs.some(r => r.kind === kind && r.relation === relation && r.id === id)) {
      refs.push({ kind, relation, id, missing: true });
    }
  };
  add("user", "actor", event.actorUserId);
  add("user", "impersonator", event.impersonatorUserId);
  add("user", "target", event.targetUserId);
  add("user", "reviewer", event.reviewedBy);
  add("agent", "agent", event.agentId);
  add("integration", "integration", event.integrationId);
  const d = event.detailsJson && typeof event.detailsJson === "object" && !Array.isArray(event.detailsJson)
    ? event.detailsJson as Record<string, unknown> : {};
  add("role", "target", d.targetRoleId);
  add("agent", "target", d.targetAgentId);
  add("integration", "target", d.targetIntegrationId);
  add("entity", "entity", d.targetEntityId ?? d.entityId);
  add("record", "record", d.targetRecordId ?? d.recordId);
  add("role", "requested_role", d.requestedRoleId);
  if (Array.isArray(d.requestedRoleIds)) {
    for (const id of d.requestedRoleIds.slice(0, 100)) add("role", "requested_role", id);
  }
  return refs;
}

/**
 * Only called behind humanOnly + requireSuperAdmin. Never expose this resolver
 * through ordinary audit/record APIs: those need per-record and field RBAC.
 * Names are read-time hints, not evidence snapshots. Missing rows keep their IDs.
 */
export async function enrichSecurityReferences<T extends Evidence>(events: T[]) {
  const references = events.map(securityReferenceIds);
  const ids = (kind: Kind) => [...new Set(references.flat().filter(r => r.kind === kind).map(r => r.id))];
  const resolved = new Map<string, Record<string, string>>();
  const put = (kind: Kind, id: number, name: Record<string, string>) => resolved.set(`${kind}:${id}`, name);
  const [users, roles, agents, integrations, records] = await Promise.all([
    ids("user").length ? db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
      .from(usersTable).where(inArray(usersTable.id, ids("user"))) : [],
    ids("role").length ? db.select({ id: rolesTable.id, nameJson: rolesTable.nameJson })
      .from(rolesTable).where(inArray(rolesTable.id, ids("role"))) : [],
    ids("agent").length ? db.select({ id: aiAgentsTable.id, name: aiAgentsTable.name })
      .from(aiAgentsTable).where(inArray(aiAgentsTable.id, ids("agent"))) : [],
    ids("integration").length ? db.select({ id: inboundIntegrationsTable.id, name: inboundIntegrationsTable.name })
      .from(inboundIntegrationsTable).where(inArray(inboundIntegrationsTable.id, ids("integration"))) : [],
    ids("record").length ? db.select({ id: entityRecordsTable.id, entityId: entityRecordsTable.entityId, valuesJson: entityRecordsTable.valuesJson })
      .from(entityRecordsTable).where(inArray(entityRecordsTable.id, ids("record"))) : [],
  ]);
  for (const u of users) put("user", u.id, plainName(`${u.firstName} ${u.lastName}`));
  for (const r of roles) put("role", r.id, names(r.nameJson));
  for (const a of agents) put("agent", a.id, plainName(a.name));
  for (const i of integrations) put("integration", i.id, plainName(i.name));
  const entityIds = [...new Set([...ids("entity"), ...records.map(r => r.entityId)])];
  const [entities, fields] = await Promise.all([
    entityIds.length ? db.select({ id: entitiesTable.id, nameJson: entitiesTable.nameJson })
      .from(entitiesTable).where(inArray(entitiesTable.id, entityIds)) : [],
    records.length ? db.select({ entityId: entityFieldsTable.entityId, fieldKey: entityFieldsTable.fieldKey,
      fieldType: entityFieldsTable.fieldType, isKey: entityFieldsTable.isKey,
      isActive: entityFieldsTable.isActive, sortOrder: entityFieldsTable.sortOrder })
      .from(entityFieldsTable).where(inArray(entityFieldsTable.entityId, entityIds)) : [],
  ]);
  for (const e of entities) put("entity", e.id, names(e.nameJson));
  const labelFields: Pick<typeof entityFieldsTable.$inferSelect,
    "entityId" | "fieldKey" | "fieldType" | "isKey" | "isActive" | "sortOrder">[] = fields;
  for (const r of records) {
    const values = r.valuesJson as Record<string, unknown>;
    // Only simple identifying scalars: never stringify files, user IDs, formula
    // definitions or relation payloads; never return the raw values object.
    const candidates = labelFields.filter(f => f.entityId === r.entityId && f.isActive &&
      ["text", "number"].includes(f.fieldType))
      .sort((a, b) => Number(b.isKey) - Number(a.isKey) || a.sortOrder - b.sortOrder || a.fieldKey.localeCompare(b.fieldKey));
    const label = candidates.map(f => values[f.fieldKey])
      .find(v => (typeof v === "string" && v.trim().length > 0) || typeof v === "number");
    put("record", r.id, label == null ? {} : plainName(String(label)));
    for (const refs of references) {
      if (refs.some(ref => ref.kind === "record" && ref.id === r.id) &&
          !refs.some(ref => ref.kind === "entity" && ref.id === r.entityId)) {
        refs.push({ kind: "entity", relation: "entity", id: r.entityId, missing: true });
      }
    }
  }
  return events.map((event, index) => ({
    ...event,
    displayReferences: references[index]!.map(ref => {
      const nameJson = resolved.get(`${ref.kind}:${ref.id}`);
      return { ...ref, missing: nameJson === undefined, ...(nameJson ? { nameJson } : {}) };
    }),
  }));
}
