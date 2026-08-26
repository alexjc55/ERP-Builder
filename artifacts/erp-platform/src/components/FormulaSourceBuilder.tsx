import { useMemo, useState } from "react";
import {
  getListEntityFieldsQueryOptions,
  getListEntityFieldsQueryKey,
  getListPageFieldsQueryOptions,
  getListPageFieldsQueryKey,
  useListEntities,
  useListEntityFields,
  useListEntityRelations,
  useListPageFields,
  useListPages,
} from "@workspace/api-client-react";
import { useQueries } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useML, useT } from "@/lib/i18n";
import { usePagePathLabel } from "@/lib/pagePath";
import type { FormulaFieldRef } from "@/components/FormulaEditor";

export type FormulaSource =
  | { kind: "pageLocal"; key: string; pageId: number; fieldKey: string }
  | {
      kind: "aggregate";
      key: string;
      targetEntityId: number;
      targetPageId?: number;
      join:
        | { kind: "relation"; relationId: number; baseSide: "source" | "target" }
        | { kind: "equality"; on: Array<{
            base: { scope: "entity"; fieldKey: string } | { scope: "page"; pageId: number; fieldKey: string };
            target: { scope: "entity"; fieldKey: string } | { scope: "page"; pageId: number; fieldKey: string };
          }> };
      value: { scope: "entity"; fieldKey: string } | { scope: "page"; pageId: number; fieldKey: string };
      aggregate: "sum" | "average" | "min" | "max" | "count" | "uniqueJoin";
      separator?: string;
    };

const AGGREGATE_LABELS: Record<Extract<FormulaSource, { kind: "aggregate" }>["aggregate"], string> = {
  sum: "sum",
  average: "average",
  min: "min",
  max: "max",
  count: "count",
  uniqueJoin: "uniqueJoin",
};

/**
 * Resolve persisted source identifiers to current localized page/entity/field
 * names. Labels are deliberately derived at render time rather than stored in
 * formulaConfigJson, so renaming a page or field updates every formula picker.
 */
export function useFormulaSourceRefs(value: FormulaSource[]): FormulaFieldRef[] {
  const ml = useML();
  const pageLabel = usePagePathLabel();
  const { data: entities = [] } = useListEntities();
  const pageIds = useMemo(
    () => [...new Set(value.flatMap((source) => {
      if (source.kind === "pageLocal") return [source.pageId];
      const valuePageId = source.targetPageId ??
        (source.value.scope === "page" ? source.value.pageId : null);
      return valuePageId == null ? [] : [valuePageId];
    }))],
    [value],
  );
  const entityIds = useMemo(
    () => [...new Set(value.flatMap((source) => source.kind === "aggregate" ? [source.targetEntityId] : []))],
    [value],
  );
  const pageFieldQueries = useQueries({
    queries: pageIds.map((pageId) => getListPageFieldsQueryOptions(pageId)),
  });
  const entityFieldQueries = useQueries({
    queries: entityIds.map((entityId) => getListEntityFieldsQueryOptions(entityId)),
  });
  const pageFieldsById = new Map(pageIds.map((pageId, index) => [pageId, pageFieldQueries[index]?.data ?? []]));
  const entityFieldsById = new Map(entityIds.map((entityId, index) => [entityId, entityFieldQueries[index]?.data ?? []]));

  return value.map((source) => {
    if (source.kind === "pageLocal") {
      const pageName = pageLabel(source.pageId);
      const field = pageFieldsById.get(source.pageId)?.find((item) => item.fieldKey === source.fieldKey);
      const fieldName = ml(field?.nameJson) || source.fieldKey;
      return {
        key: source.key,
        token: source.key,
        label: `${pageName} · ${fieldName}`,
        sourceKind: "page" as const,
      };
    }

    const entityName = ml(entities.find((entity) => entity.id === source.targetEntityId)?.nameJson) || `#${source.targetEntityId}`;
    const valuePageId = source.value.scope === "page" ? source.value.pageId : source.targetPageId;
    const valueField = valuePageId != null
      ? pageFieldsById.get(valuePageId)?.find((item) => item.fieldKey === source.value.fieldKey)
      : entityFieldsById.get(source.targetEntityId)?.find((item) => item.fieldKey === source.value.fieldKey);
    const fieldName = ml(valueField?.nameJson) || source.value.fieldKey;
    const pageName = valuePageId != null ? pageLabel(valuePageId) : "";
    return {
      key: source.key,
      token: source.key,
      label: [entityName, pageName, `${AGGREGATE_LABELS[source.aggregate]}(${fieldName})`].filter(Boolean).join(" · "),
      sourceKind: "linked" as const,
    };
  });
}

type Draft = {
  entityId: number | null;
  pageId: number | null;
  joinKind: "relation" | "equality";
  relationId: number | null;
  localFieldKey: string;
  externalFieldKey: string;
  additionalConditions: Array<{ localFieldKey: string; externalFieldKey: string }>;
  valueFieldKey: string;
  aggregate: "sum" | "average" | "min" | "max" | "count" | "uniqueJoin";
  separator: string;
};

const EMPTY: Draft = {
  entityId: null, pageId: null, joinKind: "relation", relationId: null,
  localFieldKey: "", externalFieldKey: "", additionalConditions: [], valueFieldKey: "", aggregate: "sum", separator: ", ",
};

export function FormulaSourceBuilder({
  currentEntityId,
  currentFields,
  value,
  onChange,
}: {
  currentEntityId: number;
  currentFields: FormulaFieldRef[];
  value: FormulaSource[];
  onChange: (value: FormulaSource[]) => void;
}) {
  const t = useT();
  const ml = useML();
  const pageLabel = usePagePathLabel();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pageSourcePageId, setPageSourcePageId] = useState<number | null>(null);
  const [pageSourceFieldKey, setPageSourceFieldKey] = useState("");
  const { data: entities = [] } = useListEntities();
  const { data: pages = [] } = useListPages();
  const { data: relations = [] } = useListEntityRelations(currentEntityId);
  const { data: targetFields = [] } = useListEntityFields(draft.entityId ?? 0, {
    query: { enabled: draft.entityId != null, queryKey: getListEntityFieldsQueryKey(draft.entityId ?? 0) },
  });
  const { data: targetPageFields = [] } = useListPageFields(draft.pageId ?? 0, {
    query: { enabled: draft.pageId != null, queryKey: getListPageFieldsQueryKey(draft.pageId ?? 0) },
  });
  const { data: pageSourceFields = [] } = useListPageFields(pageSourcePageId ?? 0, {
    query: { enabled: pageSourcePageId != null, queryKey: getListPageFieldsQueryKey(pageSourcePageId ?? 0) },
  });
  const resolvedSourceRefs = useFormulaSourceRefs(value);
  const resolvedSourceLabel = new Map(resolvedSourceRefs.map((ref) => [ref.key, ref.label]));

  const entityName = (id: number) => ml(entities.find((entity) => entity.id === id)?.nameJson) || `#${id}`;
  const targetPages = useMemo(() => {
    if (draft.entityId == null) return [];
    const boundPage = entities.find((entity) => entity.id === draft.entityId)?.pageId;
    return pages.filter((page) => page.mirrorEntityId === draft.entityId || page.id === boundPage);
  }, [draft.entityId, entities, pages]);
  const currentPages = useMemo(() => {
    const boundPage = entities.find((entity) => entity.id === currentEntityId)?.pageId;
    return pages.filter((page) => page.mirrorEntityId === currentEntityId || page.id === boundPage);
  }, [currentEntityId, entities, pages]);
  const eligibleRelations = relations.filter((relation) =>
    relation.sourceEntityId === draft.entityId || relation.targetEntityId === draft.entityId);
  const projectedFields = draft.pageId == null ? targetFields : targetPageFields;

  const patch = (next: Partial<Draft>) => setDraft((old) => ({ ...old, ...next }));
  const baseReference = (token: string) => {
    const page = /^page:(\d+)\.(.+)$/.exec(token);
    return page
      ? { scope: "page" as const, pageId: Number(page[1]), fieldKey: page[2] }
      : { scope: "entity" as const, fieldKey: token.replace(/^entity:\d+\./, "") };
  };
  const add = () => {
    if (draft.entityId == null) return;
    const tokenBase = `source:${draft.aggregate}_${draft.entityId}`;
    let token = tokenBase;
    let suffix = 2;
    while (value.some((source) => source.key === token)) token = `${tokenBase}_${suffix++}`;
    const join = draft.joinKind === "relation"
      ? draft.relationId != null
        ? { kind: "relation" as const, relationId: draft.relationId,
            baseSide: relations.find((r) => r.id === draft.relationId)?.targetEntityId === currentEntityId
              ? "target" as const : "source" as const }
        : null
      : draft.localFieldKey && draft.externalFieldKey
        ? {
            kind: "equality" as const,
            on: [{ localFieldKey: draft.localFieldKey, externalFieldKey: draft.externalFieldKey }, ...draft.additionalConditions]
              .filter((condition) => condition.localFieldKey && condition.externalFieldKey)
              .map((condition) => ({
                base: baseReference(condition.localFieldKey),
                target: draft.pageId == null
                  ? { scope: "entity" as const, fieldKey: condition.externalFieldKey }
                  : { scope: "page" as const, pageId: draft.pageId, fieldKey: condition.externalFieldKey },
              })),
          }
        : null;
    if (!join || !draft.valueFieldKey) return;
    const source: FormulaSource = {
      kind: "aggregate", key: token, targetEntityId: draft.entityId, join,
      ...(draft.pageId != null ? { targetPageId: draft.pageId } : {}),
      value: draft.pageId == null
        ? { scope: "entity", fieldKey: draft.valueFieldKey }
        : { scope: "page", pageId: draft.pageId, fieldKey: draft.valueFieldKey },
      aggregate: draft.aggregate,
      ...(draft.aggregate === "uniqueJoin" ? { separator: draft.separator } : {}),
    };
    onChange([...value, source]);
    setDraft(EMPTY);
  };
  const canAdd = draft.entityId != null &&
    (draft.joinKind === "relation" ? draft.relationId != null : !!draft.localFieldKey && !!draft.externalFieldKey) &&
    !!draft.valueFieldKey;

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/50 p-3">
      <div>
        <p className="text-sm font-medium">{t("fields.formulaLinkedSources", "Связанные источники")}</p>
        <p className="text-xs text-slate-400">{t("fields.formulaLinkedSourcesHint",
          "Сервер агрегирует только доступные вам записи и передаёт в формулу готовое значение.")}</p>
      </div>
      {value.filter((source) => source.kind === "aggregate").map((source) => (
        <div key={source.key} className="flex items-center justify-between gap-2 rounded border bg-white px-2 py-1.5 text-xs">
          <div className="min-w-0">
            <span className="font-medium">{resolvedSourceLabel.get(source.key) ?? `${entityName(source.targetEntityId)} · ${source.aggregate}`}</span>
            <code className="ml-2 text-slate-400">{`{${source.key}}`}</code>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => onChange(value.filter((item) => item !== source))}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      <div className="space-y-2 border-b border-slate-200 pb-3">
        <p className="text-xs font-medium text-slate-600">{t("fields.formulaPageSources", "Поле другой страницы той же записи")}</p>
      {value.filter((source) => source.kind === "pageLocal").map((source) => (
          <div key={source.key} className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs">
            <span>
              <span className="font-medium">{resolvedSourceLabel.get(source.key) ?? source.fieldKey}</span>
              <code className="ml-2 text-slate-400">{`{${source.key}}`}</code>
            </span>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
              onClick={() => onChange(value.filter((item) => item !== source))}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Select value={pageSourcePageId == null ? "" : String(pageSourcePageId)}
            onValueChange={(v) => { setPageSourcePageId(Number(v)); setPageSourceFieldKey(""); }}>
            <SelectTrigger className="h-8"><SelectValue placeholder={t("fields.formulaPage", "Страница")} /></SelectTrigger>
            <SelectContent>{currentPages.map((page) =>
              <SelectItem key={page.id} value={String(page.id)}>{pageLabel(page)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={pageSourceFieldKey} onValueChange={setPageSourceFieldKey}>
            <SelectTrigger className="h-8"><SelectValue placeholder={t("fields.formulaValueField", "Поле значения")} /></SelectTrigger>
            <SelectContent>{pageSourceFields.map((field) =>
              <SelectItem key={field.fieldKey} value={field.fieldKey}>{ml(field.nameJson) || field.fieldKey}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" disabled={pageSourcePageId == null || !pageSourceFieldKey}
            onClick={() => {
              if (pageSourcePageId == null || !pageSourceFieldKey) return;
              const token = `page:${pageSourcePageId}.${pageSourceFieldKey}`;
              if (!value.some((source) => source.key === token)) {
                onChange([...value, { kind: "pageLocal", key: token, pageId: pageSourcePageId, fieldKey: pageSourceFieldKey }]);
              }
              setPageSourceFieldKey("");
            }}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">{t("fields.formulaTargetEntity", "Целевая сущность")}</Label>
          <Select value={draft.entityId == null ? "" : String(draft.entityId)}
            onValueChange={(v) => patch({ entityId: Number(v), pageId: null, relationId: null, externalFieldKey: "", valueFieldKey: "" })}>
            <SelectTrigger className="h-8"><SelectValue placeholder={t("common.select", "Выберите")} /></SelectTrigger>
            <SelectContent>{entities.filter((entity) => entity.id !== currentEntityId).map((entity) =>
              <SelectItem key={entity.id} value={String(entity.id)}>{ml(entity.nameJson) || `#${entity.id}`}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("fields.formulaValueSource", "Источник значения")}</Label>
          <Select value={draft.pageId == null ? "__entity__" : String(draft.pageId)}
            onValueChange={(v) => patch({ pageId: v === "__entity__" ? null : Number(v), valueFieldKey: "" })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__entity__">{t("fields.formulaEntityFields", "Поля сущности")}</SelectItem>
              {targetPages.map((page) => <SelectItem key={page.id} value={String(page.id)}>{pageLabel(page)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("fields.formulaJoinMethod", "Способ связи")}</Label>
          <Select value={draft.joinKind} onValueChange={(v) => patch({ joinKind: v as Draft["joinKind"] })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="relation">{t("fields.formulaJoinRelation", "Настроенная связь")}</SelectItem>
              <SelectItem value="equality">{t("fields.formulaJoinEquality", "Совпадение полей")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {draft.joinKind === "relation" ? (
          <div className="space-y-1">
            <Label className="text-xs">{t("fields.relation", "Связь")}</Label>
            <Select value={draft.relationId == null ? "" : String(draft.relationId)} onValueChange={(v) => patch({ relationId: Number(v) })}>
              <SelectTrigger className="h-8"><SelectValue placeholder={t("common.select", "Выберите")} /></SelectTrigger>
              <SelectContent>{eligibleRelations.map((relation) =>
                <SelectItem key={relation.id} value={String(relation.id)}>{ml(relation.nameJson) || `#${relation.id}`}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-xs">{t("fields.formulaLocalMatchField", "Поле текущей записи")}</Label>
              <Select value={draft.localFieldKey} onValueChange={(v) => patch({ localFieldKey: v })}>
                <SelectTrigger className="h-8"><SelectValue placeholder={t("common.select", "Выберите")} /></SelectTrigger>
                <SelectContent>{currentFields.map((field) =>
                  <SelectItem key={field.token ?? field.key} value={field.token ?? field.key}>{field.sourceLabel ? `${field.sourceLabel} · ` : ""}{field.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("fields.formulaExternalMatchField", "Поле целевой сущности")}</Label>
              <Select value={draft.externalFieldKey} onValueChange={(v) => patch({ externalFieldKey: v })}>
                <SelectTrigger className="h-8"><SelectValue placeholder={t("common.select", "Выберите")} /></SelectTrigger>
                <SelectContent>{projectedFields.map((field) =>
                  <SelectItem key={field.fieldKey} value={field.fieldKey}>{ml(field.nameJson) || field.fieldKey}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {draft.additionalConditions.map((condition, index) => (
              <div key={index} className="col-span-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                <Select value={condition.localFieldKey} onValueChange={(v) => patch({
                  additionalConditions: draft.additionalConditions.map((item, i) =>
                    i === index ? { ...item, localFieldKey: v } : item),
                })}>
                  <SelectTrigger className="h-8"><SelectValue placeholder={t("fields.formulaLocalMatchField", "Поле текущей записи")} /></SelectTrigger>
                  <SelectContent>{currentFields.map((field) =>
                    <SelectItem key={field.token ?? field.key} value={field.token ?? field.key}>{field.sourceLabel ? `${field.sourceLabel} · ` : ""}{field.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={condition.externalFieldKey} onValueChange={(v) => patch({
                  additionalConditions: draft.additionalConditions.map((item, i) =>
                    i === index ? { ...item, externalFieldKey: v } : item),
                })}>
                  <SelectTrigger className="h-8"><SelectValue placeholder={t("fields.formulaExternalMatchField", "Поле целевой сущности")} /></SelectTrigger>
                  <SelectContent>{projectedFields.map((field) =>
                    <SelectItem key={field.fieldKey} value={field.fieldKey}>{ml(field.nameJson) || field.fieldKey}</SelectItem>)}</SelectContent>
                </Select>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8"
                  onClick={() => patch({ additionalConditions: draft.additionalConditions.filter((_, i) => i !== index) })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" className="col-span-2 justify-self-start"
              disabled={draft.additionalConditions.length >= 7}
              onClick={() => patch({ additionalConditions: [...draft.additionalConditions, { localFieldKey: "", externalFieldKey: "" }] })}>
              <Plus className="mr-1 h-3.5 w-3.5" />{t("fields.formulaAddCondition", "Добавить условие")}
            </Button>
          </>
        )}
        <div className="space-y-1">
          <Label className="text-xs">{t("fields.formulaAggregate", "Агрегат")}</Label>
          <Select value={draft.aggregate} onValueChange={(v) => patch({ aggregate: v as Draft["aggregate"] })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{["sum", "average", "min", "max", "count", "uniqueJoin"].map((op) =>
              <SelectItem key={op} value={op}>{op}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("fields.formulaValueField", "Поле значения")}</Label>
          <Select value={draft.valueFieldKey} onValueChange={(v) => patch({ valueFieldKey: v })}>
            <SelectTrigger className="h-8"><SelectValue placeholder={t("common.select", "Выберите")} /></SelectTrigger>
            <SelectContent>{projectedFields.map((field) => {
              const key = "fieldKey" in field ? field.fieldKey : "";
              return <SelectItem key={key} value={key}>{ml(field.nameJson) || key}</SelectItem>;
            })}</SelectContent>
          </Select>
        </div>
        {draft.aggregate === "uniqueJoin" && (
          <div className="space-y-1">
            <Label className="text-xs">{t("fields.formulaSeparator", "Разделитель")}</Label>
            <Input className="h-8" maxLength={100} value={draft.separator} onChange={(e) => patch({ separator: e.target.value })} />
          </div>
        )}
      </div>
      <Button type="button" size="sm" variant="outline" disabled={!canAdd || value.length >= 32} onClick={add}>
        <Plus className="mr-1 h-3.5 w-3.5" />{t("fields.formulaAddSource", "Добавить источник")}
      </Button>
    </div>
  );
}