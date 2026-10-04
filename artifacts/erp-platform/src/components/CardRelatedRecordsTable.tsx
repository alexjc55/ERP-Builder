import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getRecord,
  getEntityRelatedValues,
  useListEntityFields,
  useListEntityRelations,
  getListEntityFieldsQueryKey,
  type EntityRecord,
  type Field,
  type PageRelatedValue,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useML, useT } from "@/lib/i18n";

/**
 * Embedded related-records table for a card "relatedTable" block. Records are
 * fetched one by one through getRecord, so the server's record-level
 * authorization decides what is shown; denied records are counted, never
 * rendered. Columns are limited to fields the viewer may see on the related
 * entity. Linking/creating is done by the relation field's own picker above.
 */
export function CardRelatedRecordsTable({ entityId, field, relatedEntityIdHint, ids, columns, renderValue, refreshKey = 0 }: {
  entityId: number;
  field: Field;
  relatedEntityIdHint?: number;
  ids: number[];
  columns: string[];
  /** Bumped by the form after link changes / linked-record saves to reload values. */
  refreshKey?: number;
  renderValue: (field: Field, value: unknown) => ReactNode;
}) {
  const t = useT();
  const ml = useML();
  const { fieldAccess } = useAuth();
  const { data: relations = [] } = useListEntityRelations(entityId);
  const relationId = field.relationConfigJson?.relationId;
  const relation = relations.find(r => r.id === relationId);
  const relatedEntityId = relatedEntityIdHint
    ?? (relation ? (relation.sourceEntityId === entityId ? relation.targetEntityId : relation.sourceEntityId) : undefined);
  const { data: relFields = [], isLoading: fieldsLoading } = useListEntityFields(relatedEntityId ?? 0, {
    query: { enabled: relatedEntityId != null, queryKey: getListEntityFieldsQueryKey(relatedEntityId ?? 0) },
  });
  const visible = relFields.filter(f => f.isActive && fieldAccess(f, relatedEntityId as number) !== "hidden");
  const cols: Field[] = (columns.length
    ? columns.map(k => visible.find(f => f.fieldKey === k)).filter((f): f is Field => !!f)
    : [...visible].sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 4));
  const needsProjection = cols.some(c => c.fieldType === "relation" || c.fieldType === "lookup");
  const idsKey = [...ids].sort((a, b) => a - b).join(",");

  const query = useQuery({
    queryKey: ["card-related-table", relatedEntityId, idsKey, needsProjection, refreshKey],
    enabled: relatedEntityId != null && ids.length > 0,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const settled = await Promise.allSettled(ids.map(id => getRecord(id)));
      const records: EntityRecord[] = [];
      let denied = 0;
      for (const r of settled) {
        if (r.status === "fulfilled") { records.push(r.value as EntityRecord); continue; }
        const status = (r.reason as { status?: number } | null)?.status;
        // Only authorization/absence is an expected outcome; anything else fails loudly.
        if (status === 403 || status === 404) denied += 1;
        else throw r.reason;
      }
      const projections = new Map<string, PageRelatedValue>();
      const projectedTypes = new Map<string, { type: string; options: unknown }>();
      if (needsProjection && records.length && relatedEntityId != null) {
        const res = await getEntityRelatedValues(relatedEntityId, { recordIds: records.map(r => r.id) });
        for (const c of res.columns) projectedTypes.set(c.fieldKey, { type: c.relatedFieldType ?? "text", options: c.optionsJson ?? [] });
        for (const v of res.values) projections.set(`${v.recordId}:${v.fieldKey}`, v);
      }
      return { records, denied, projections, projectedTypes };
    },
  });

  if (relatedEntityId == null) return null;
  const loading = fieldsLoading || (ids.length > 0 && query.isLoading);
  const cell = (rec: EntityRecord, c: Field): ReactNode => {
    if (c.fieldType === "relation" || c.fieldType === "lookup") {
      const p = query.data?.projections.get(`${rec.id}:${c.fieldKey}`);
      const meta = query.data?.projectedTypes.get(c.fieldKey);
      if (!p || (p.linkedRecordId == null && !p.linkedRecordIds?.length)) return renderValue(c, null);
      if (p.linkedRecordIds && p.linkedRecordIds.length > 1) return String(p.linkedRecordIds.length);
      return renderValue({ ...c, fieldType: (meta?.type ?? "text") as Field["fieldType"], optionsJson: meta?.options ?? [] } as Field, p.value);
    }
    return renderValue(c, (rec.valuesJson as Record<string, unknown> | undefined)?.[c.fieldKey]);
  };

  return (
    <div className="min-w-0 overflow-x-auto rounded-md border border-slate-200" data-testid={`table-related-${field.fieldKey}`}>
      <table className="w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            {cols.map(c => (
              <th key={c.id} className="whitespace-nowrap px-3 py-2 text-start text-xs font-semibold text-slate-500">{ml(c.nameJson)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            [0, 1].map(i => (
              <tr key={i} className="border-t border-slate-100">
                {cols.map(c => <td key={c.id} className="px-3 py-2"><Skeleton className="h-4 w-full" /></td>)}
              </tr>
            ))
          ) : query.isError ? (
            <tr><td colSpan={Math.max(1, cols.length)} className="px-3 py-3 text-sm text-red-600">
              {t("cards.relatedLoadError", "Не удалось загрузить связанные записи.")}{" "}
              {query.error instanceof Error ? <span className="text-xs text-red-500">{query.error.message} </span> : null}
              <button type="button" className="underline" onClick={() => void query.refetch()} data-testid={`button-retry-related-${field.fieldKey}`}>
                {t("common.retry", "Повторить")}
              </button>
            </td></tr>
          ) : (query.data?.records.length ?? 0) === 0 ? (
            <tr><td colSpan={Math.max(1, cols.length)} className="px-3 py-4 text-center text-xs text-slate-400">
              {t("cards.relatedEmpty", "Связанных записей нет")}
            </td></tr>
          ) : (
            query.data!.records.map(rec => (
              <tr key={rec.id} className="border-t border-slate-100" data-testid={`row-related-${field.fieldKey}-${rec.id}`}>
                {cols.map(c => <td key={c.id} className="max-w-[260px] px-3 py-2 align-top break-words">{cell(rec, c)}</td>)}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {!!query.data?.denied && (
        <p className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-400" data-testid={`text-related-denied-${field.fieldKey}`}>
          {t("cards.relatedDenied", "Записей без доступа")}: {query.data.denied}
        </p>
      )}
    </div>
  );
}
