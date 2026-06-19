import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useListEntityFields,
  useListEntityViews,
  useListEntityStatuses,
  useListUserOptions,
  useListEntityRelations,
  useGetEntityFilterValues,
  getListEntityFieldsQueryOptions,
  type Field,
  type View,
  type Status,
  type MultilingualText,
  type FilterCondition,
  type FilterOperator,
  type PivotConfig,
  type PivotDimension,
} from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table2, Search } from "lucide-react";
import { filterUserOptionsByRoles } from "@/lib/userFieldRoles";
import {
  PivotMeasuresEditor,
  type DraftMeasure,
  newDraftMeasure,
  measuresFromConfig,
  buildMeasureConfig,
} from "@/components/PivotMeasuresEditor";
import { type FormulaFieldRef } from "@/components/FormulaEditor";
import {
  FilterRowsEditor,
  PivotDimEditor,
  PIVOT_DIM_TYPES,
  isDateLikeType,
  filterValueToText,
  textToFilterValue,
  dimToDraft,
  draftToDim,
  type DraftFilter,
  type DraftDim,
} from "@/components/ViewConfigEditors";

/** The stored shape of pages.pivotConfigJson. */
export type PivotPageConfigValue = {
  source: "entity" | "view" | "custom";
  viewId?: number | null;
  pivot?: PivotConfig | null;
  filters?: FilterCondition[];
  filterConjunction?: "and" | "or";
  statusIds?: number[];
  search?: string | null;
};

/**
 * Entity-scoped editor for a PIVOT PAGE's configuration. Manages the pivot
 * source (entity default / a named pivot view / a custom inline pivot), an
 * admin-authoritative filter set (filters + search + status quick-filter), and —
 * for the custom source — the full rows/cols/measures pivot editor. Reports the
 * fully-built {@link PivotPageConfigValue} up via `onChange` whenever it changes.
 *
 * Keyed by entityId at the call site so it remounts (and re-initialises from
 * `initial`) when the target entity changes.
 */
export function PivotPageConfig({
  entityId,
  initial,
  onChange,
  ml,
  t,
}: {
  entityId: number;
  initial: PivotPageConfigValue | null;
  onChange: (cfg: PivotPageConfigValue) => void;
  ml: (val: MultilingualText | string | undefined | null) => string;
  t: (key: string, def: string) => string;
}) {
  const { data: allFields = [], isLoading: fieldsLoading } = useListEntityFields(entityId);
  const fields = useMemo(
    () => [...allFields].filter((f: Field) => f.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [allFields],
  );
  const { data: views = [] } = useListEntityViews(entityId);
  const { data: statuses = [] } = useListEntityStatuses(entityId);
  const { data: userOptions = [] } = useListUserOptions();
  const filterValuesMutation = useGetEntityFilterValues();

  // Pivot views available as the "view" source.
  const pivotViews = views.filter((v: View) => {
    const cfg = v.configJson as { viewType?: string; pivot?: unknown } | null | undefined;
    return cfg?.viewType === "pivot" && cfg.pivot != null;
  });

  // --- relation/lookup projected-type resolution (for filter value labels) ---
  const { data: entityRelations = [] } = useListEntityRelations(entityId);
  const linkedEntityIdByRelationId = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of entityRelations) {
      m.set(r.id, r.sourceEntityId === entityId ? r.targetEntityId : r.sourceEntityId);
    }
    return m;
  }, [entityRelations, entityId]);
  const relLookupFields = fields.filter(
    (f: Field) =>
      (f.fieldType === "relation" || f.fieldType === "lookup") &&
      f.relationConfigJson?.relationId != null &&
      !!f.relationConfigJson?.relatedFieldKey,
  );
  const linkedEntityIds = useMemo(() => {
    const s = new Set<number>();
    for (const f of relLookupFields) {
      const eid = linkedEntityIdByRelationId.get(f.relationConfigJson!.relationId!);
      if (eid != null) s.add(eid);
    }
    return [...s];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFields, linkedEntityIdByRelationId]);
  const linkedFieldQueries = useQueries({
    queries: linkedEntityIds.map((eid) => getListEntityFieldsQueryOptions(eid)),
  });
  const projectedFieldByField = useMemo(() => {
    const fieldsByEntity = new Map<number, Field[]>();
    linkedEntityIds.forEach((eid, i) => {
      const d = linkedFieldQueries[i]?.data as Field[] | undefined;
      if (d) fieldsByEntity.set(eid, d);
    });
    const m = new Map<string, Field>();
    for (const f of relLookupFields) {
      const eid = linkedEntityIdByRelationId.get(f.relationConfigJson!.relationId!);
      if (eid == null) continue;
      const lf = fieldsByEntity.get(eid)?.find((x) => x.fieldKey === f.relationConfigJson!.relatedFieldKey);
      if (lf) m.set(f.fieldKey, lf);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedEntityIds, linkedFieldQueries, linkedEntityIdByRelationId, allFields]);
  const projectedTypeByField = useMemo(() => {
    const m = new Map<string, Field["fieldType"]>();
    for (const [k, lf] of projectedFieldByField) m.set(k, lf.fieldType);
    return m;
  }, [projectedFieldByField]);

  const domainDataRef = useRef({ fields, userOptions, projectedTypeByField, projectedFieldByField });
  domainDataRef.current = { fields, userOptions, projectedTypeByField, projectedFieldByField };
  const getDomainOptions = useCallback(
    async (fieldKey: string): Promise<string[]> => {
      const d = domainDataRef.current;
      const f = d.fields.find((x: Field) => x.fieldKey === fieldKey);
      const ft = f?.fieldType;
      const eff = ft === "relation" || ft === "lookup" ? (d.projectedTypeByField.get(fieldKey) ?? "text") : ft;
      if (eff === "user") {
        const src = ft === "relation" || ft === "lookup" ? d.projectedFieldByField.get(fieldKey) : f;
        const users = src ? filterUserOptionsByRoles(src, d.userOptions) : d.userOptions;
        return users.map((u) => String(u.id));
      }
      if (eff === "boolean") return ["true", "false"];
      if (eff === "select") {
        const src = ft === "relation" || ft === "lookup" ? d.projectedFieldByField.get(fieldKey) : f;
        const opts = src && Array.isArray(src.optionsJson) ? (src.optionsJson as string[]) : [];
        if (opts.length > 0) return opts;
      }
      const res = await filterValuesMutation.mutateAsync({ entityId, data: { field: fieldKey, filters: [] } });
      return res.values ?? [];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entityId],
  );

  // Fields the admin has opted into as pivot dims/measures.
  const pivotDimFields = fields.filter((f: Field) => f.pivotEnabled && PIVOT_DIM_TYPES.has(f.fieldType));
  const pivotSumFields = fields.filter((f: Field) => f.pivotEnabled && f.fieldType === "number");
  const pivotFormulaRefs: FormulaFieldRef[] = pivotSumFields.map((f: Field) => ({ key: f.fieldKey, label: ml(f.nameJson) }));

  // --- editor state ---
  const [source, setSource] = useState<"entity" | "view" | "custom">(initial?.source ?? "entity");
  const [viewId, setViewId] = useState<string>(initial?.viewId != null ? String(initial.viewId) : "none");
  const [filterConjunction, setFilterConjunction] = useState<"and" | "or">(initial?.filterConjunction ?? "and");
  const [search, setSearch] = useState(initial?.search ?? "");
  const [statusIds, setStatusIds] = useState<number[]>(initial?.statusIds ?? []);
  const [filters, setFilters] = useState<DraftFilter[]>(
    (initial?.filters ?? []).map((f) => ({
      field: f.field,
      operator: f.operator as FilterOperator,
      valueText: filterValueToText(f.value),
    })),
  );
  const initPivot = initial?.source === "custom" ? (initial?.pivot ?? null) : null;
  const [pivotRows, setPivotRows] = useState<DraftDim>(
    initPivot?.rows ? dimToDraft(initPivot.rows) : { source: "status", fieldKey: "", datePeriod: null },
  );
  const [pivotColsOn, setPivotColsOn] = useState<boolean>(!!initPivot?.cols && !((initPivot?.measures?.length ?? 0) > 1));
  const [pivotCols, setPivotCols] = useState<DraftDim>(
    initPivot?.cols ? dimToDraft(initPivot.cols) : { source: "status", fieldKey: "", datePeriod: null },
  );
  const [pivotMeasures, setPivotMeasures] = useState<DraftMeasure[]>(
    initPivot ? measuresFromConfig(initPivot) : [newDraftMeasure(pivotSumFields[0]?.fieldKey ?? "")],
  );

  const addFilter = () =>
    setFilters((prev) => [...prev, { field: fields[0]?.fieldKey ?? "", operator: "eq" as FilterOperator, valueText: "" }]);
  const updateFilter = (idx: number, patch: Partial<DraftFilter>) =>
    setFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  const removeFilter = (idx: number) => setFilters((prev) => prev.filter((_, i) => i !== idx));

  // Build the stored config and report it up whenever any input changes.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dimFieldsForBuild = useMemo(() => fields, [fields]);
  useEffect(() => {
    const storedFilters: FilterCondition[] = filters
      .filter((f) => f.field)
      .map((f) => ({
        field: f.field,
        operator: f.operator,
        value: textToFilterValue(f.operator, f.valueText),
      }));
    const cfg: PivotPageConfigValue = {
      source,
      viewId: source === "view" && viewId !== "none" ? Number(viewId) : null,
      filters: storedFilters,
      filterConjunction,
      statusIds,
      search: search.trim() || null,
    };
    if (source === "custom") {
      const measures = pivotMeasures.length > 1;
      const built = buildMeasureConfig(pivotMeasures, t);
      if (built) {
        const pivot: PivotConfig = {
          rows: draftToDim(pivotRows, dimFieldsForBuild),
          ...(pivotColsOn && !measures ? { cols: draftToDim(pivotCols, dimFieldsForBuild) } : {}),
          ...built,
        };
        cfg.pivot = pivot;
      }
    }
    onChangeRef.current(cfg);
  }, [
    source,
    viewId,
    filters,
    filterConjunction,
    statusIds,
    search,
    pivotRows,
    pivotCols,
    pivotColsOn,
    pivotMeasures,
    dimFieldsForBuild,
    t,
  ]);

  if (fieldsLoading) return <Skeleton className="h-24 w-full" />;

  return (
    <div className="space-y-4">
      {/* Pivot source */}
      <div className="space-y-1.5">
        <Label>{t("pages.pivotSource", "Источник конфигурации")}</Label>
        <Select value={source} onValueChange={(v) => setSource(v as "entity" | "view" | "custom")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="entity">{t("pages.pivotSourceEntity", "Сводная по умолчанию (сущности)")}</SelectItem>
            <SelectItem value="view">{t("pages.pivotSourceView", "Из сохранённого представления")}</SelectItem>
            <SelectItem value="custom">{t("pages.pivotSourceCustom", "Своя настройка")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {source === "view" && (
        <div className="space-y-1.5">
          <Label>{t("pages.pivotView", "Представление со сводной")}</Label>
          <Select value={viewId} onValueChange={setViewId}>
            <SelectTrigger><SelectValue placeholder={t("pages.pivotViewSelect", "— Выберите представление —")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("pages.pivotViewSelect", "— Выберите представление —")}</SelectItem>
              {pivotViews.map((v: View) => (
                <SelectItem key={v.id} value={String(v.id)}>{ml(v.nameJson)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pivotViews.length === 0 && (
            <p className="text-xs text-amber-600">{t("pages.pivotNoViews", "У сущности нет представлений типа «Сводная таблица».")}</p>
          )}
        </div>
      )}

      {source === "custom" && (
        <div className="space-y-3 rounded-md border border-slate-200 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Table2 className="w-4 h-4 text-blue-600" />
            {t("pivot.configTitle", "Конфигурация сводной таблицы")}
          </div>
          <PivotDimEditor
            label={t("pivot.rows", "Строки")}
            dim={pivotRows}
            onChange={setPivotRows}
            dimFields={pivotDimFields}
            ml={ml}
            t={t}
          />
          {pivotMeasures.length === 1 && (
            <>
              <div className="flex items-center gap-2">
                <Switch checked={pivotColsOn} onCheckedChange={setPivotColsOn} />
                <Label className="cursor-pointer text-sm">{t("pivot.enableCols", "Добавить измерение столбцов")}</Label>
              </div>
              {pivotColsOn && (
                <PivotDimEditor
                  label={t("pivot.cols", "Столбцы")}
                  dim={pivotCols}
                  onChange={setPivotCols}
                  dimFields={pivotDimFields}
                  ml={ml}
                  t={t}
                />
              )}
            </>
          )}
          <PivotMeasuresEditor
            measures={pivotMeasures}
            onChange={setPivotMeasures}
            sumFields={pivotSumFields.map((f: Field) => ({ fieldKey: f.fieldKey, nameJson: f.nameJson }))}
            formulaRefs={pivotFormulaRefs}
            ml={ml}
            t={t}
          />
        </div>
      )}

      {/* Admin-authoritative filters */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <Search className="w-3.5 h-3.5 text-blue-600" />
          {t("pages.pivotSearch", "Поиск по записям")}
        </Label>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("pages.pivotSearchPlaceholder", "необязательно")} />
      </div>

      {statuses.length > 0 && (
        <div className="space-y-1.5">
          <Label>{t("pages.pivotStatuses", "Только статусы (пусто = все)")}</Label>
          <div className="flex flex-wrap gap-1.5">
            {statuses.map((s: Status) => {
              const on = statusIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatusIds((prev) => (on ? prev.filter((x) => x !== s.id) : [...prev, s.id]))}
                  className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}
                >
                  {ml(s.nameJson)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <FilterRowsEditor
        filters={filters}
        fields={fields}
        userOptions={userOptions}
        ml={ml}
        t={t}
        onAdd={addFilter}
        onUpdate={updateFilter}
        onRemove={removeFilter}
        conjunction={filterConjunction}
        onConjunctionChange={setFilterConjunction}
        getOptions={getDomainOptions}
        projectedTypeByField={projectedTypeByField}
      />

      <p className="text-xs text-slate-400">
        {t("pages.pivotAuthHint", "Итоги считаются по всем записям сущности (с учётом этих фильтров) одинаково для всех, у кого есть доступ к странице.")}
      </p>
    </div>
  );
}
