import { useState, useCallback, useMemo, useRef } from "react";
import { useParams, useLocation } from "wouter";
import {
  useListEntityViews,
  useCreateEntityView,
  useUpdateView,
  useDeleteView,
  useReorderViews,
  useListEntities,
  useUpdateEntity,
  useGetEntityFilterValues,
  useListEntityFields,
  useUpdateField,
  useListRoles,
  useListUserOptions,
  useListEntityRelations,
  getListEntityFieldsQueryOptions,
  type UserOption,
  type View,
  type ViewConfig,
  type FilterCondition,
  type FilterOperator,
  type SortSpec,
  type SortSpecDirection,
  type Entity,
  type Field,
  type Role,
  type MultilingualText,
  type PivotConfig,
  type PivotDimension,
  type PivotMeasure,
  type PivotDimensionSource,
  type PivotDimensionDatePeriod,
  type CalendarConfig,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormulaEditor, type FormulaFieldRef } from "@/components/FormulaEditor";
import {
  PivotMeasuresEditor,
  type DraftMeasure,
  newDraftMeasure,
  measuresFromConfig,
  buildMeasureConfig,
} from "@/components/PivotMeasuresEditor";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { MultilingualInput } from "@/components/MultilingualInput";
import { useToast } from "@/hooks/use-toast";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, ArrowLeft, LayoutList, Star, Filter, ArrowDownUp, X, ChevronUp, ChevronDown, ChevronRight, Check, Table2, Shield, Columns3 } from "lucide-react";
import { useML, useT } from "@/lib/i18n";
import { normalizeSelectOptions } from "@/lib/selectOptions";
import { slugifyKey, uniqueKey } from "@/lib/keys";
import { filterUserOptionsByRoles } from "@/lib/userFieldRoles";
import {
  FILTER_OPERATORS,
  operatorLabel,
  operatorNeedsValue,
  operatorIsArray,
  operatorsForType,
  filterValueToText,
  textToFilterValue,
  PIVOT_DIM_TYPES,
  isDateLikeType,
  FilterRowsEditor,
  PivotDimEditor,
  CalendarConfigEditor,
  type DraftFilter,
  type DraftSort,
  type DraftDim,
} from "@/components/ViewConfigEditors";

type MLValue = { ru?: string; en?: string; he?: string };

// Trim a multilingual value, dropping empty strings. Returns null when no locale
// has content so an empty formula name is stored as null (→ server "Формула" fallback).
function cleanML(v: MLValue): MultilingualText | null {
  const out: MLValue = {};
  for (const lang of ["ru", "en", "he"] as const) {
    const s = (v[lang] ?? "").trim();
    if (s) out[lang] = s;
  }
  return Object.keys(out).length > 0 ? (out as MultilingualText) : null;
}


function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const data = (err as { data?: { error?: unknown } }).data;
    if (data && typeof data.error === "string" && data.error.trim()) return data.error;
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return undefined;
}


// Reserved sort keys mapping to the record's system columns (creation date / id).
// They are sortable but never shown as table columns; kept in lockstep with the
// server sort builder (record-query.ts) and EntityRecords.tsx.
const SYSTEM_SORT_CREATED_AT = "__created_at__";
const SYSTEM_SORT_RECORD_ID = "__record_id__";


export default function EntityViewsPage() {
  const params = useParams();
  const entityId = Number(params.entityId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ml = useML();
  const t = useT();

  const { data: entities = [] } = useListEntities();
  const entity = entities.find((e: Entity) => e.id === entityId);
  const { data: allFields = [] } = useListEntityFields(entityId);
  const fields = [...allFields]
    .filter((f: Field) => f.isActive)
    .sort((a: Field, b: Field) => a.sortOrder - b.sortOrder);
  const fieldLabel = (key: string): string => {
    const f = fields.find((x: Field) => x.fieldKey === key);
    return f ? ml(f.nameJson) : key;
  };

  const { data: roles = [] } = useListRoles();
  const { data: userOptions = [] } = useListUserOptions();
  // Distinct EXISTING values lookup (the live records bar's endpoint). Used only as
  // *suggestions* for open-domain fields; closed-domain fields use their full domain
  // (see getDomainOptions below).
  const filterValuesMutation = useGetEntityFilterValues();
  // Projected field TYPE for relation/lookup fields (the linked field whose values
  // they surface). The raw filter values of a relation/lookup field ARE the linked
  // field's values, so the EFFECTIVE type for labeling is the linked field's type.
  // This lets the value picker resolve user ids → names and booleans → Да/Нет the
  // same way the live records bar does, instead of showing raw ids.
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
      const lf = fieldsByEntity
        .get(eid)
        ?.find((x) => x.fieldKey === f.relationConfigJson!.relatedFieldKey);
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
  // Value-picker domain for the view filter editors. A saved view filter is a RULE
  // that must also match records created LATER, so for CLOSED-domain types
  // (user / select / boolean) we offer the FULL set of possible values — not just
  // the values already present in the data. OPEN-domain types (text, numbers,
  // relation/lookup → text …) list the distinct EXISTING values as suggestions,
  // with manual entry still enabled so an author can target a not-yet-present value.
  // Mutable inputs read by getDomainOptions are kept in a ref so the callback can
  // stay referentially STABLE (deps [entityId] only). `fields` is rebuilt every
  // render ([...allFields].filter().sort()) and the projection maps churn too, so
  // depending on them directly would change getDomainOptions each render and make
  // ValueChecklistPicker's getOptions-keyed fetch effect re-run in a loop while open.
  const domainDataRef = useRef({ fields, userOptions, projectedTypeByField, projectedFieldByField });
  domainDataRef.current = { fields, userOptions, projectedTypeByField, projectedFieldByField };
  const getDomainOptions = useCallback(
    async (fieldKey: string): Promise<string[]> => {
      const d = domainDataRef.current;
      const f = d.fields.find((x: Field) => x.fieldKey === fieldKey);
      const ft = f?.fieldType;
      const eff = ft === "relation" || ft === "lookup" ? (d.projectedTypeByField.get(fieldKey) ?? "text") : ft;
      if (eff === "user") {
        // Only offer users whose roles satisfy the field's allowedRoleIds (full role
        // set, not just primary) — for relation/lookup the config lives on the linked
        // field, so resolve via the projected field. Empty/unset = all users.
        const src = ft === "relation" || ft === "lookup" ? d.projectedFieldByField.get(fieldKey) : f;
        const users = src ? filterUserOptionsByRoles(src, d.userOptions) : d.userOptions;
        return users.map((u) => String(u.id));
      }
      if (eff === "boolean") return ["true", "false"];
      if (eff === "select") {
        const src = ft === "relation" || ft === "lookup" ? d.projectedFieldByField.get(fieldKey) : f;
        const opts = normalizeSelectOptions(src?.optionsJson).map((o) => o.value);
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
  // Date/datetime fields available to anchor records on a calendar view.
  const calendarDateFields = fields.filter((f: Field) => f.fieldType === "date" || f.fieldType === "datetime");
  // Fields offered as clickable chips inside a pivot formula measure. Numeric
  // pivot-enabled fields match the cost use case (metres × price); the server
  // restricts the formula to ALL pivot-enabled keys regardless.
  const pivotFormulaRefs: FormulaFieldRef[] = pivotSumFields.map((f: Field) => ({ key: f.fieldKey, label: ml(f.nameJson) }));

  const { data: views = [], isLoading } = useListEntityViews(entityId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<View | null>(null);
  const [toDelete, setToDelete] = useState<View | null>(null);

  const [viewKey, setViewKey] = useState("");
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [isDefault, setIsDefault] = useState(false);
  const [filterConjunction, setFilterConjunction] = useState<"and" | "or">("and");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<DraftFilter[]>([]);
  const [sorts, setSorts] = useState<DraftSort[]>([]);
  // Pivot view editor state.
  const [viewType, setViewType] = useState<"table" | "pivot" | "calendar">("table");
  // Calendar view editor state.
  const [calendarConfig, setCalendarConfig] = useState<CalendarConfig>({ dateFieldKey: "" });
  const [pivotRows, setPivotRows] = useState<DraftDim>({ source: "status", fieldKey: "", datePeriod: null });
  const [pivotColsOn, setPivotColsOn] = useState(false);
  const [pivotCols, setPivotCols] = useState<DraftDim>({ source: "status", fieldKey: "", datePeriod: null });
  const [pivotMeasures, setPivotMeasures] = useState<DraftMeasure[]>([newDraftMeasure()]);
  // Per-view role visibility (empty = visible to everyone with record access).
  const [visibleRoleIds, setVisibleRoleIds] = useState<number[]>([]);
  // Per-view visible columns (table view). Empty = no override (show all default
  // columns). A non-empty set only NARROWS within the already-permitted columns —
  // it can never reveal a field hidden by role/field perms (enforced in the table).
  const [visibleFields, setVisibleFields] = useState<string[]>([]);
  // Collapsed by default so the (potentially long) column list doesn't take space.
  const [columnsExpanded, setColumnsExpanded] = useState(false);

  // Default sort: the row ordering applied when no view is selected (the implicit
  // "По умолчанию"). Stored on the entity itself, configured via its own dialog.
  const [defaultSortDialogOpen, setDefaultSortDialogOpen] = useState(false);
  const [defaultSorts, setDefaultSorts] = useState<DraftSort[]>([]);
  const [defaultFilters, setDefaultFilters] = useState<DraftFilter[]>([]);
  // Default pivot (Сводная таблица): the pivot config used on the records page when
  // no view is selected. Stored on the entity (defaultPivotJson), gated on pivotEnabled.
  const [defaultPivotOn, setDefaultPivotOn] = useState(false);
  const [defaultPivotRows, setDefaultPivotRows] = useState<DraftDim>({ source: "status", fieldKey: "", datePeriod: null });
  const [defaultPivotColsOn, setDefaultPivotColsOn] = useState(false);
  const [defaultPivotCols, setDefaultPivotCols] = useState<DraftDim>({ source: "status", fieldKey: "", datePeriod: null });
  const [defaultPivotMeasures, setDefaultPivotMeasures] = useState<DraftMeasure[]>([newDraftMeasure()]);
  // Roles allowed to use the DEFAULT pivot (the Таблица/Сводная toggle on the
  // records page when no view is selected). Empty = everyone with record access.
  const [defaultPivotRoleIds, setDefaultPivotRoleIds] = useState<number[]>([]);
  const entityDefaultSorts: SortSpec[] = Array.isArray(entity?.defaultSortJson)
    ? (entity.defaultSortJson as SortSpec[])
    : [];
  const entityDefaultFilters: FilterCondition[] = Array.isArray(entity?.defaultFilterJson)
    ? (entity.defaultFilterJson as FilterCondition[])
    : [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/views`] });

  const createMutation = useCreateEntityView({
    mutation: {
      onSuccess: () => { toast({ title: t("views.created", "Вид создан") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("views.createError", "Ошибка создания вида"), description: extractError(err), variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateView({
    mutation: {
      onSuccess: () => { toast({ title: t("views.updated", "Вид обновлён") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("views.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteView({
    mutation: {
      onSuccess: () => { toast({ title: t("views.deleted", "Вид удалён") }); setToDelete(null); invalidate(); },
      onError: (err) => toast({ title: t("views.deleteError", "Ошибка удаления вида"), description: extractError(err), variant: "destructive" }),
    },
  });
  const reorderMutation = useReorderViews({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: t("views.reorderError", "Ошибка изменения порядка"), variant: "destructive" }),
    },
  });
  const updateEntityMutation = useUpdateEntity({
    mutation: {
      onSuccess: () => {
        toast({ title: t("views.defaultSortSaved", "Сортировка по умолчанию сохранена") });
        setDefaultSortDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/entities`] });
      },
      onError: (err) => toast({ title: t("views.defaultSortError", "Ошибка сохранения сортировки"), description: extractError(err), variant: "destructive" }),
    },
  });

  // Per-entity pivot opt-in and per-field allowed toggles.
  const pivotEntityMutation = useUpdateEntity({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/entities`] });
      },
      onError: (err) => toast({ title: t("pivot.settingsError", "Ошибка настройки сводных"), description: extractError(err), variant: "destructive" }),
    },
  });
  const pivotFieldMutation = useUpdateField({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/fields`] }),
      onError: (err) => toast({ title: t("pivot.fieldError", "Ошибка настройки поля"), description: extractError(err), variant: "destructive" }),
    },
  });

  const move = (list: View[], index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    reorderMutation.mutate({
      entityId,
      data: {
        entityId,
        items: [
          { id: a.id, sortOrder: b.sortOrder },
          { id: b.id, sortOrder: a.sortOrder },
        ],
      },
    });
  };

  const openCreate = () => {
    setEditing(null);
    setViewKey("");
    setNameJson({});
    setIsDefault(false);
    setFilterConjunction("and");
    setSearch("");
    setFilters([]);
    setSorts([]);
    setViewType("table");
    setPivotRows({ source: pivotDimFields[0] ? "entity" : "status", fieldKey: pivotDimFields[0]?.fieldKey ?? "", datePeriod: null });
    setPivotColsOn(false);
    setPivotCols({ source: "status", fieldKey: "", datePeriod: null });
    setPivotMeasures([newDraftMeasure(pivotSumFields[0]?.fieldKey ?? "")]);
    setCalendarConfig({ dateFieldKey: calendarDateFields[0]?.fieldKey ?? "" });
    setVisibleRoleIds([]);
    setVisibleFields([]);
    setColumnsExpanded(false);
    setDialogOpen(true);
  };

  const openEdit = (view: View) => {
    setEditing(view);
    setViewKey(view.viewKey);
    const n = view.nameJson;
    setNameJson(typeof n === "object" && n ? { ru: n.ru, en: n.en, he: n.he } : {});
    setIsDefault(view.isDefault);
    const cfg = (view.configJson ?? {}) as ViewConfig;
    setFilterConjunction(cfg.filterConjunction === "or" ? "or" : "and");
    setSearch(cfg.search ?? "");
    setFilters(
      (cfg.filters ?? []).map((f) => ({
        field: f.field,
        operator: f.operator,
        valueText: filterValueToText(f.value),
      })),
    );
    setSorts((cfg.sorts ?? []).map((s) => ({ field: s.field, direction: s.direction ?? "asc" })));
    setVisibleRoleIds(Array.isArray(view.visibleRoleIds) ? view.visibleRoleIds : []);
    setVisibleFields(Array.isArray(cfg.visibleFields) ? cfg.visibleFields : []);
    setColumnsExpanded(false);
    const isPivot = cfg.viewType === "pivot" && !!cfg.pivot;
    const isCalendar = cfg.viewType === "calendar";
    setViewType(isCalendar ? "calendar" : isPivot ? "pivot" : "table");
    setCalendarConfig(
      isCalendar && cfg.calendar
        ? cfg.calendar
        : { dateFieldKey: calendarDateFields[0]?.fieldKey ?? "" },
    );
    const dimToDraft = (d: PivotDimension | undefined): DraftDim =>
      d && d.source !== "status"
        ? { source: "entity", fieldKey: d.fieldKey ?? "", datePeriod: d.datePeriod ?? null }
        : { source: "status", fieldKey: "", datePeriod: null };
    const p = cfg.pivot;
    setPivotRows(p ? dimToDraft(p.rows) : { source: pivotDimFields[0] ? "entity" : "status", fieldKey: pivotDimFields[0]?.fieldKey ?? "", datePeriod: null });
    // cols is only honored in single-measure mode; in multi-measure mode the
    // measures ARE the columns, so don't restore a stale cols toggle.
    const hasMulti = !!p?.measures && p.measures.length > 1;
    setPivotColsOn(!!p?.cols && !hasMulti);
    setPivotCols(p?.cols ? dimToDraft(p.cols) : { source: "status", fieldKey: "", datePeriod: null });
    setPivotMeasures(p ? measuresFromConfig(p) : [newDraftMeasure(pivotSumFields[0]?.fieldKey ?? "")]);
    setDialogOpen(true);
  };

  const toggleVisibleRole = (roleId: number) =>
    setVisibleRoleIds((prev) => (prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]));

  const toggleDefaultPivotRole = (roleId: number) =>
    setDefaultPivotRoleIds((prev) => (prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]));

  const addFilter = () => {
    const field = fields[0]?.fieldKey ?? "";
    setFilters((prev) => [...prev, { field, operator: "eq", valueText: "" }]);
  };
  const updateFilter = (idx: number, patch: Partial<DraftFilter>) => {
    setFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };
  const removeFilter = (idx: number) => setFilters((prev) => prev.filter((_, i) => i !== idx));

  const addSort = () => {
    const field = fields[0]?.fieldKey ?? "";
    setSorts((prev) => [...prev, { field, direction: "asc" }]);
  };
  const updateSort = (idx: number, patch: Partial<DraftSort>) => {
    setSorts((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const removeSort = (idx: number) => setSorts((prev) => prev.filter((_, i) => i !== idx));

  const openDefaultSort = () => {
    setDefaultSorts(entityDefaultSorts.map((s) => ({ field: s.field, direction: s.direction ?? "asc" })));
    setDefaultFilters(
      entityDefaultFilters.map((f) => ({
        field: f.field,
        operator: f.operator,
        valueText: filterValueToText(f.value),
      })),
    );
    const dp = (entity?.defaultPivotJson ?? null) as PivotConfig | null;
    const dimToDraft = (d: PivotDimension | undefined): DraftDim =>
      d && d.source !== "status"
        ? { source: "entity", fieldKey: d.fieldKey ?? "", datePeriod: d.datePeriod ?? null }
        : { source: "status", fieldKey: "", datePeriod: null };
    const dpMulti = !!dp?.measures && dp.measures.length > 1;
    setDefaultPivotOn(!!dp);
    setDefaultPivotRows(dp ? dimToDraft(dp.rows) : { source: pivotDimFields[0] ? "entity" : "status", fieldKey: pivotDimFields[0]?.fieldKey ?? "", datePeriod: null });
    setDefaultPivotColsOn(!!dp?.cols && !dpMulti);
    setDefaultPivotCols(dp?.cols ? dimToDraft(dp.cols) : { source: "status", fieldKey: "", datePeriod: null });
    setDefaultPivotMeasures(dp ? measuresFromConfig(dp) : [newDraftMeasure(pivotSumFields[0]?.fieldKey ?? "")]);
    setDefaultPivotRoleIds(Array.isArray(dp?.visibleRoleIds) ? dp.visibleRoleIds : []);
    setDefaultSortDialogOpen(true);
  };
  const addDefaultSort = () => {
    const field = fields[0]?.fieldKey ?? "";
    setDefaultSorts((prev) => [...prev, { field, direction: "asc" }]);
  };
  const updateDefaultSort = (idx: number, patch: Partial<DraftSort>) => {
    setDefaultSorts((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const removeDefaultSort = (idx: number) => setDefaultSorts((prev) => prev.filter((_, i) => i !== idx));
  const addDefaultFilter = () => {
    const field = fields[0]?.fieldKey ?? "";
    setDefaultFilters((prev) => [...prev, { field, operator: "eq", valueText: "" }]);
  };
  const updateDefaultFilter = (idx: number, patch: Partial<DraftFilter>) => {
    setDefaultFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };
  const removeDefaultFilter = (idx: number) => setDefaultFilters((prev) => prev.filter((_, i) => i !== idx));
  const saveDefaultSort = () => {
    const builtSorts: SortSpec[] = defaultSorts.map((s) => ({ field: s.field, direction: s.direction }));
    const builtFilters: FilterCondition[] = defaultFilters.map((f) => {
      const cond: FilterCondition = { field: f.field, operator: f.operator };
      const value = textToFilterValue(f.operator, f.valueText);
      if (value !== undefined) cond.value = value;
      return cond;
    });
    let defaultPivotJson: PivotConfig | null = null;
    if (entity?.pivotEnabled && defaultPivotOn) {
      const draftToDim = (d: DraftDim): PivotDimension =>
        d.source === "status"
          ? { source: "status" as PivotDimensionSource }
          : {
              source: "entity" as PivotDimensionSource,
              fieldKey: d.fieldKey,
              datePeriod: isDateLikeType(fields.find((f: Field) => f.fieldKey === d.fieldKey)?.fieldType ?? "") ? d.datePeriod : null,
            };
      if (defaultPivotRows.source === "entity" && !defaultPivotRows.fieldKey) {
        toast({ title: t("pivot.needRowField", "Выберите поле строк сводной таблицы"), variant: "destructive" });
        return;
      }
      const dpMulti = defaultPivotMeasures.length > 1;
      if (defaultPivotColsOn && !dpMulti && defaultPivotCols.source === "entity" && !defaultPivotCols.fieldKey) {
        toast({ title: t("pivot.needColField", "Выберите поле столбцов сводной таблицы"), variant: "destructive" });
        return;
      }
      const built = buildMeasureConfig(defaultPivotMeasures, t);
      if ("error" in built) {
        toast({ title: built.error, variant: "destructive" });
        return;
      }
      const pivot: PivotConfig = { rows: draftToDim(defaultPivotRows), ...built };
      // cols and multiple measures are mutually exclusive.
      if (defaultPivotColsOn && !built.measures) pivot.cols = draftToDim(defaultPivotCols);
      if (defaultPivotRoleIds.length > 0) pivot.visibleRoleIds = defaultPivotRoleIds;
      defaultPivotJson = pivot;
    }
    updateEntityMutation.mutate({
      id: entityId,
      data: { defaultSortJson: builtSorts, defaultFilterJson: builtFilters, defaultPivotJson },
    });
  };

  const buildConfig = (): ViewConfig => {
    const builtFilters: FilterCondition[] = filters.map((f) => {
      const cond: FilterCondition = { field: f.field, operator: f.operator };
      const value = textToFilterValue(f.operator, f.valueText);
      if (value !== undefined) cond.value = value;
      return cond;
    });
    const builtSorts: SortSpec[] = sorts.map((s) => ({ field: s.field, direction: s.direction }));
    const base: ViewConfig = {
      filters: builtFilters,
      filterConjunction,
      sorts: builtSorts,
      search: search.trim() || undefined,
    };
    // Column visibility override is only meaningful for the table view. Keep only
    // keys that still map to an existing field; empty = no override.
    if (viewType === "table") {
      const activeKeys = new Set(fields.map((f: Field) => f.fieldKey));
      const cleaned = visibleFields.filter((k) => activeKeys.has(k));
      if (cleaned.length > 0) base.visibleFields = cleaned;
    }
    if (viewType === "calendar") {
      const cal: CalendarConfig = {
        dateFieldKey: calendarConfig.dateFieldKey,
        endDateFieldKey: calendarConfig.endDateFieldKey ?? null,
        titleFieldKey: calendarConfig.titleFieldKey ?? null,
        cardFieldKeys: calendarConfig.cardFieldKeys ?? [],
        colorBy: calendarConfig.colorBy ?? null,
        colorFieldKey: calendarConfig.colorBy === "field" ? (calendarConfig.colorFieldKey ?? null) : null,
        defaultMode: calendarConfig.defaultMode ?? "month",
      };
      return { ...base, viewType: "calendar", calendar: cal };
    }
    if (viewType !== "pivot") return base;

    const draftToDim = (d: DraftDim): PivotDimension =>
      d.source === "status"
        ? { source: "status" as PivotDimensionSource }
        : {
            source: "entity" as PivotDimensionSource,
            fieldKey: d.fieldKey,
            datePeriod: isDateLikeType(fields.find((f: Field) => f.fieldKey === d.fieldKey)?.fieldType ?? "") ? d.datePeriod : null,
          };
    const built = buildMeasureConfig(pivotMeasures, t);
    if ("error" in built) {
      // Surface via handleSubmit's validation; build a placeholder so the type is
      // satisfied (handleSubmit re-runs the same check and toasts before saving).
      const pivot: PivotConfig = { rows: draftToDim(pivotRows), measure: { agg: "count" } };
      if (pivotColsOn) pivot.cols = draftToDim(pivotCols);
      return { ...base, viewType: "pivot", pivot };
    }
    const pivot: PivotConfig = { rows: draftToDim(pivotRows), ...built };
    // cols and multiple measures are mutually exclusive.
    if (pivotColsOn && !built.measures) pivot.cols = draftToDim(pivotCols);
    return { ...base, viewType: "pivot", pivot };
  };

  const handleSubmit = () => {
    const configJson = buildConfig();
    const existingKeys = new Set(
      views.filter((v: View) => v.id !== editing?.id).map((v: View) => v.viewKey),
    );
    if (viewType === "calendar" && !configJson.calendar?.dateFieldKey) {
      toast({ title: t("calendar.needDateField", "Выберите поле даты для календаря"), variant: "destructive" });
      return;
    }
    if (viewType === "pivot") {
      if (configJson.pivot?.rows.source === "entity" && !configJson.pivot.rows.fieldKey) {
        toast({ title: t("pivot.needRowField", "Выберите поле строк сводной таблицы"), variant: "destructive" });
        return;
      }
      if (pivotColsOn && configJson.pivot?.cols?.source === "entity" && !configJson.pivot.cols.fieldKey) {
        toast({ title: t("pivot.needColField", "Выберите поле столбцов сводной таблицы"), variant: "destructive" });
        return;
      }
      const builtMeasures = buildMeasureConfig(pivotMeasures, t);
      if ("error" in builtMeasures) {
        toast({ title: builtMeasures.error, variant: "destructive" });
        return;
      }
    }
    const nameForKey = (nameJson.en || nameJson.ru || nameJson.he || "").toString();
    const resolvedKey = viewKey.trim() || uniqueKey(slugifyKey(nameForKey) || "view", existingKeys);
    const roleVisibility = visibleRoleIds.length > 0 ? visibleRoleIds : null;
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        data: { viewKey: resolvedKey, nameJson: nameJson as MultilingualText, configJson, isDefault, visibleRoleIds: roleVisibility },
      });
    } else {
      createMutation.mutate({
        entityId,
        data: { viewKey: resolvedKey, nameJson: nameJson as MultilingualText, configJson, isDefault, visibleRoleIds: roleVisibility },
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const noFields = fields.length === 0;
  const sortedViews = [...views].sort((a: View, b: View) => a.sortOrder - b.sortOrder);

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          onClick={() => { if (window.history.length > 1) window.history.back(); else navigate("/admin/entities"); }}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("views.backToEntities", "К списку сущностей")}
        </button>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <LayoutList className="w-6 h-6 text-blue-600" />
              {`${t("views.title", "Виды")}${entity ? `: ${ml(entity.nameJson)}` : ""}`}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {t("views.subtitle", "Сохранённые виды записей: фильтры, сортировка и поиск")}{entity ? <> <code className="text-xs">{entity.entityKey}</code></> : null}
            </p>
          </div>
          <Button onClick={openCreate} disabled={noFields} className="bg-blue-600 hover:bg-blue-700 gap-2">
            <Plus className="w-4 h-4" />
            {t("views.add", "Добавить вид")}
          </Button>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <ArrowDownUp className="w-4 h-4 text-blue-600" />
                {t("views.defaultViewCardTitle", "Фильтры и сортировка по умолчанию")}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {t("views.defaultViewCardDesc", "Применяются, когда вид не выбран. Без настройки — все записи по дате создания (сначала новые).")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {entityDefaultFilters.length === 0 ? (
                  <span className="text-xs text-slate-400">{t("views.defaultFiltersNone", "Без фильтров")}</span>
                ) : (
                  entityDefaultFilters.map((f, i) => (
                    <Badge key={`f${i}`} className="bg-blue-50 text-blue-700 border-0 font-normal">
                      <Filter className="w-3 h-3 mr-1" />
                      {fieldLabel(f.field)}
                    </Badge>
                  ))
                )}
                {entityDefaultSorts.length === 0 ? (
                  <span className="text-xs text-slate-400">{t("views.defaultSortNone", "По дате создания (сначала новые)")}</span>
                ) : (
                  entityDefaultSorts.map((s, i) => (
                    <Badge key={`s${i}`} className="bg-slate-100 text-slate-600 border-0 font-normal">
                      {fieldLabel(s.field)} · {s.direction === "desc" ? t("views.descShort", "↓") : t("views.ascShort", "↑")}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <Button type="button" variant="outline" className="gap-2 shrink-0" disabled={noFields} onClick={openDefaultSort}>
              <Pencil className="w-3.5 h-3.5" />
              {t("views.configure", "Настроить")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Table2 className="w-4 h-4 text-blue-600" />
                {t("pivot.entitySettingsTitle", "Сводные таблицы")}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {t("pivot.entitySettingsDesc", "Разрешите режим сводной таблицы для этой сущности и выберите поля, доступные как измерения и меры.")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                checked={!!entity?.pivotEnabled}
                disabled={!entity || pivotEntityMutation.isPending}
                onCheckedChange={(checked) => entity && pivotEntityMutation.mutate({ id: entityId, data: { pivotEnabled: checked } })}
              />
              <Label className="cursor-pointer text-sm">{t("pivot.entityEnable", "Включить сводные")}</Label>
            </div>
          </div>
          {entity?.pivotEnabled && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-600 mb-2">{t("pivot.allowedFields", "Поля, доступные в сводных")}</p>
              {fields.filter((f: Field) => PIVOT_DIM_TYPES.has(f.fieldType)).length === 0 ? (
                <p className="text-xs text-slate-400">{t("pivot.noEligibleFields", "Нет подходящих полей (текст, число, дата, список, логическое).")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {fields
                    .filter((f: Field) => PIVOT_DIM_TYPES.has(f.fieldType))
                    .map((f: Field) => {
                      const on = !!f.pivotEnabled;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          disabled={pivotFieldMutation.isPending}
                          onClick={() => pivotFieldMutation.mutate({ id: f.id, data: { pivotEnabled: !on } })}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition disabled:opacity-50 ${
                            on ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"
                          }`}
                        >
                          <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>
                            {on && <Check className="w-2.5 h-2.5" />}
                          </span>
                          {ml(f.nameJson)}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : noFields ? (
            <div className="text-center py-16 text-slate-400">
              {t("views.noFields", "Сначала настройте поля сущности — виды фильтруют и сортируют записи по полям.")}
            </div>
          ) : views.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              {t("views.empty", "У этой сущности ещё нет видов. Нажмите «Добавить вид», чтобы создать первый.")}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("views.name", "Название")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("views.key", "Ключ")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("views.filters", "Фильтры")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("views.sorting", "Сортировка")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">{t("views.actions", "Действия")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedViews.map((view: View, idx: number) => {
                  const cfg = (view.configJson ?? {}) as ViewConfig;
                  const fCount = cfg.filters?.length ?? 0;
                  const sCount = cfg.sorts?.length ?? 0;
                  return (
                    <tr key={view.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-700">
                        <span className="inline-flex items-center gap-1.5">
                          {view.isDefault && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />}
                          {ml(view.nameJson)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{view.viewKey}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {fCount > 0 ? <Badge className="bg-slate-100 text-slate-600 border-0 font-normal">{fCount}</Badge> : <span className="text-slate-300">—</span>}
                        {cfg.search ? <Badge className="ml-1 bg-blue-50 text-blue-600 border-0 font-normal">{t("views.searchBadge", "поиск")}</Badge> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {sCount > 0 ? <Badge className="bg-slate-100 text-slate-600 border-0 font-normal">{sCount}</Badge> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={idx === 0 || reorderMutation.isPending} onClick={() => move(sortedViews, idx, -1)}>
                            <ChevronUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={idx === sortedViews.length - 1 || reorderMutation.isPending} onClick={() => move(sortedViews, idx, 1)}>
                            <ChevronDown className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(view)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setToDelete(view)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("views.editTitle", "Редактировать вид") : t("views.newTitle", "Новый вид")}</DialogTitle>
            <DialogDescription>
              {t("views.dialogDesc", "Вид — это сохранённый набор фильтров, сортировки и поиска для записей сущности.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label={t("views.name", "Название")} value={nameJson} onChange={setNameJson} required />
            <div className="space-y-1.5">
              <Label>{t("views.systemKey", "Системный ключ")}</Label>
              <Input
                value={viewKey}
                onChange={(e) => setViewKey(e.target.value)}
                placeholder={t("views.keyAutoPlaceholder", "Сгенерируется автоматически")}
                className="font-mono"
              />
              <p className="text-xs text-slate-400">
                {t("views.keyHintAuto", "Необязательно. Если оставить пустым, ключ будет создан автоматически из названия. Только строчные латинские буквы, цифры и подчёркивания. Уникален в пределах сущности.")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
              <Label className="cursor-pointer">{t("views.defaultView", "Вид по умолчанию")}</Label>
            </div>

            <div className="space-y-1.5">
              <Label>{t("pivot.viewMode", "Тип отображения")}</Label>
              <div className="inline-flex items-center rounded-md border border-slate-200 p-0.5">
                {(([
                  ["table", t("pivot.modeTable", "Таблица")],
                  ...(entity?.pivotEnabled ? [["pivot", t("pivot.modePivot", "Сводная")]] : []),
                  ["calendar", t("calendar.modeCalendar", "Календарь")],
                ]) as ["table" | "pivot" | "calendar", string][]).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setViewType(value)}
                    className={`px-3 h-8 text-xs rounded-[5px] transition ${
                      viewType === value ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("views.textSearch", "Поиск по тексту")}</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("views.searchPlaceholder", "Подстрока по текстовым полям")} />
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Shield className="w-4 h-4 text-blue-600" />
                {t("pivot.roleVisibility", "Видимость по ролям")}
              </div>
              <p className="text-xs text-slate-400">
                {t("pivot.roleVisibilityHint", "Если роли не выбраны, вид виден всем, у кого есть доступ к записям. Иначе — только выбранным ролям (суперадмин видит всегда).")}
              </p>
              {roles.length === 0 ? (
                <p className="text-xs text-slate-400">{t("pivot.noRoles", "Роли не настроены.")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((r: Role) => {
                    const on = visibleRoleIds.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => toggleVisibleRole(r.id)}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition ${
                          on ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"
                        }`}
                      >
                        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>
                          {on && <Check className="w-2.5 h-2.5" />}
                        </span>
                        {ml(r.nameJson)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

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
              projectedFieldByField={projectedFieldByField}
              projectedTypeByField={projectedTypeByField}
            />

            {viewType === "pivot" && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
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

            {viewType === "calendar" && (
              <CalendarConfigEditor
                value={calendarConfig}
                onChange={setCalendarConfig}
                fields={fields}
                ml={ml}
                t={t}
              />
            )}

            {viewType === "table" && (
            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setColumnsExpanded((v) => !v)}
                  className="flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
                >
                  {columnsExpanded ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  )}
                  <Columns3 className="w-4 h-4 text-blue-600" />
                  {t("views.columns", "Отображаемые столбцы")}
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    {visibleFields.length > 0
                      ? t("views.columnsSelectedCount", "выбрано: {n}").replace("{n}", String(visibleFields.length))
                      : t("views.columnsAll", "все")}
                  </span>
                </button>
                {visibleFields.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 text-slate-500"
                    onClick={() => setVisibleFields([])}
                  >
                    {t("views.columnsShowAll", "Показать все")}
                  </Button>
                )}
              </div>
              {columnsExpanded && (
                <>
                  <p className="text-xs text-slate-400">
                    {t(
                      "views.columnsHint",
                      "Не выбрано ни одного — показываются все столбцы по умолчанию. Выбор только сужает набор в пределах доступных вам столбцов.",
                    )}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {fields.map((fld: Field) => {
                      const active = visibleFields.includes(fld.fieldKey);
                      return (
                        <button
                          key={fld.fieldKey}
                          type="button"
                          onClick={() =>
                            setVisibleFields((prev) =>
                              prev.includes(fld.fieldKey)
                                ? prev.filter((k) => k !== fld.fieldKey)
                                : [...prev, fld.fieldKey],
                            )
                          }
                          className={
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors " +
                            (active
                              ? "border-blue-500 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")
                          }
                        >
                          {active && <Check className="w-3 h-3" />}
                          {ml(fld.nameJson)}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            )}

            {viewType === "table" && (
            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <ArrowDownUp className="w-4 h-4 text-blue-600" />
                  {t("views.sorting", "Сортировка")}
                </div>
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={addSort}>
                  <Plus className="w-3.5 h-3.5" /> {t("views.field", "Поле")}
                </Button>
              </div>
              {sorts.length === 0 ? (
                <p className="text-xs text-slate-400">{t("views.noSortsHint", "По умолчанию — по дате создания (сначала новые).")}</p>
              ) : (
                <div className="space-y-2">
                  {sorts.map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Select value={s.field} onValueChange={(v) => updateSort(idx, { field: v })}>
                        <SelectTrigger className="h-8 text-sm flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {fields.map((fld: Field) => (
                            <SelectItem key={fld.fieldKey} value={fld.fieldKey}>{ml(fld.nameJson)}</SelectItem>
                          ))}
                          <SelectItem value={SYSTEM_SORT_CREATED_AT}>{t("views.sortSysCreatedAt", "Дата добавления (системная)")}</SelectItem>
                          <SelectItem value={SYSTEM_SORT_RECORD_ID}>{t("views.sortSysId", "ID записи (системный)")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={s.direction} onValueChange={(v) => updateSort(idx, { direction: v as SortSpecDirection })}>
                        <SelectTrigger className="h-8 text-sm w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="asc">{t("views.asc", "По возрастанию")}</SelectItem>
                          <SelectItem value="desc">{t("views.desc", "По убыванию")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 shrink-0" onClick={() => removeSort(idx)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("views.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? t("views.save", "Сохранить") : t("views.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={defaultSortDialogOpen} onOpenChange={setDefaultSortDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("views.defaultViewTitle", "Настройки по умолчанию")}</DialogTitle>
            <DialogDescription>
              {t("views.defaultViewDialogDesc", "Эти фильтры и сортировка применяются к записям, когда вид не выбран. Выбранный вид использует свои собственные настройки.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FilterRowsEditor
              filters={defaultFilters}
              fields={fields}
              userOptions={userOptions}
              ml={ml}
              t={t}
              onAdd={addDefaultFilter}
              onUpdate={updateDefaultFilter}
              onRemove={removeDefaultFilter}
              getOptions={getDomainOptions}
              projectedTypeByField={projectedTypeByField}
              projectedFieldByField={projectedFieldByField}
            />
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <ArrowDownUp className="w-4 h-4 text-blue-600" />
                {t("views.sorting", "Сортировка")}
              </div>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={addDefaultSort}>
                <Plus className="w-3.5 h-3.5" /> {t("views.field", "Поле")}
              </Button>
            </div>
            {defaultSorts.length === 0 ? (
              <p className="text-xs text-slate-400">{t("views.noSortsHint", "По умолчанию — по дате создания (сначала новые).")}</p>
            ) : (
              <div className="space-y-2">
                {defaultSorts.map((s, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select value={s.field} onValueChange={(v) => updateDefaultSort(idx, { field: v })}>
                      <SelectTrigger className="h-8 text-sm flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {fields.map((fld: Field) => (
                          <SelectItem key={fld.fieldKey} value={fld.fieldKey}>{ml(fld.nameJson)}</SelectItem>
                        ))}
                        <SelectItem value={SYSTEM_SORT_CREATED_AT}>{t("views.sortSysCreatedAt", "Дата добавления (системная)")}</SelectItem>
                        <SelectItem value={SYSTEM_SORT_RECORD_ID}>{t("views.sortSysId", "ID записи (системный)")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={s.direction} onValueChange={(v) => updateDefaultSort(idx, { direction: v as SortSpecDirection })}>
                      <SelectTrigger className="h-8 text-sm w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">{t("views.asc", "По возрастанию")}</SelectItem>
                        <SelectItem value="desc">{t("views.desc", "По убыванию")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 shrink-0" onClick={() => removeDefaultSort(idx)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {entity?.pivotEnabled && (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <div className="flex items-center gap-2">
                <Switch checked={defaultPivotOn} onCheckedChange={setDefaultPivotOn} />
                <Label className="cursor-pointer text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <Table2 className="w-4 h-4 text-blue-600" />
                  {t("pivot.defaultEnable", "Сводная таблица по умолчанию")}
                </Label>
              </div>
              <p className="text-xs text-slate-400 -mt-1">
                {t("pivot.defaultHint", "Добавляет переключатель «Таблица/Сводная» на странице записей, когда вид не выбран.")}
              </p>
              {defaultPivotOn && (
                <div className="space-y-3">
                  <PivotDimEditor
                    label={t("pivot.rows", "Строки")}
                    dim={defaultPivotRows}
                    onChange={setDefaultPivotRows}
                    dimFields={pivotDimFields}
                    ml={ml}
                    t={t}
                  />
                  {defaultPivotMeasures.length === 1 && (
                    <>
                      <div className="flex items-center gap-2">
                        <Switch checked={defaultPivotColsOn} onCheckedChange={setDefaultPivotColsOn} />
                        <Label className="cursor-pointer text-sm">{t("pivot.enableCols", "Добавить измерение столбцов")}</Label>
                      </div>
                      {defaultPivotColsOn && (
                        <PivotDimEditor
                          label={t("pivot.cols", "Столбцы")}
                          dim={defaultPivotCols}
                          onChange={setDefaultPivotCols}
                          dimFields={pivotDimFields}
                          ml={ml}
                          t={t}
                        />
                      )}
                    </>
                  )}
                  <PivotMeasuresEditor
                    measures={defaultPivotMeasures}
                    onChange={setDefaultPivotMeasures}
                    sumFields={pivotSumFields.map((f: Field) => ({ fieldKey: f.fieldKey, nameJson: f.nameJson }))}
                    formulaRefs={pivotFormulaRefs}
                    ml={ml}
                    t={t}
                  />
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      <Shield className="w-4 h-4 text-blue-600" />
                      {t("pivot.defaultRoleVisibility", "Видимость сводной по ролям")}
                    </div>
                    <p className="text-xs text-slate-400">
                      {t("pivot.defaultRoleVisibilityHint", "Если роли не выбраны, переключатель «Сводная» виден всем, у кого есть доступ к записям. Иначе — только выбранным ролям (суперадмин видит всегда). Обычная таблица остаётся доступна по правам на записи.")}
                    </p>
                    {roles.length === 0 ? (
                      <p className="text-xs text-slate-400">{t("pivot.noRoles", "Роли не настроены.")}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {roles.map((r: Role) => {
                          const on = defaultPivotRoleIds.includes(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => toggleDefaultPivotRole(r.id)}
                              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition ${
                                on ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"
                              }`}
                            >
                              <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>
                                {on && <Check className="w-2.5 h-2.5" />}
                              </span>
                              {ml(r.nameJson)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDefaultSortDialogOpen(false)}>{t("views.cancel", "Отмена")}</Button>
            <Button onClick={saveDefaultSort} disabled={updateEntityMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
              {updateEntityMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("views.save", "Сохранить")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("views.deleteTitle", "Удалить вид?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${ml(toDelete?.nameJson)}" ${t("views.deleteConfirm", "будет удалён. Записи не затрагиваются.")}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("views.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => toDelete && deleteMutation.mutate({ id: toDelete.id })}
            >
              {t("views.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export { operatorLabel };
