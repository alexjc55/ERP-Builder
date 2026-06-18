import { useState, useCallback } from "react";
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
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, ArrowLeft, LayoutList, Star, Filter, ArrowDownUp, X, ChevronUp, ChevronDown, Check, Table2, Shield } from "lucide-react";
import { useML, useT } from "@/lib/i18n";
import { slugifyKey, uniqueKey } from "@/lib/keys";
import { ValueChecklistPicker } from "@/components/FilterValuePicker";

type MLValue = { ru?: string; en?: string; he?: string };

export const FILTER_OPERATORS: { value: FilterOperator; label: string; needsValue: boolean; arrayValue?: boolean }[] = [
  { value: "eq", label: "равно", needsValue: true },
  { value: "neq", label: "не равно", needsValue: true },
  { value: "contains", label: "содержит", needsValue: true },
  { value: "not_contains", label: "не содержит", needsValue: true },
  { value: "starts_with", label: "начинается с", needsValue: true },
  { value: "ends_with", label: "заканчивается на", needsValue: true },
  { value: "gt", label: "больше", needsValue: true },
  { value: "gte", label: "больше или равно", needsValue: true },
  { value: "lt", label: "меньше", needsValue: true },
  { value: "lte", label: "меньше или равно", needsValue: true },
  { value: "in", label: "один из (через запятую)", needsValue: true, arrayValue: true },
  { value: "is_empty", label: "пусто", needsValue: false },
  { value: "is_not_empty", label: "не пусто", needsValue: false },
];

function operatorLabel(op: FilterOperator): string {
  return FILTER_OPERATORS.find((o) => o.value === op)?.label ?? op;
}

function operatorNeedsValue(op: FilterOperator): boolean {
  return FILTER_OPERATORS.find((o) => o.value === op)?.needsValue ?? true;
}

function operatorIsArray(op: FilterOperator): boolean {
  return FILTER_OPERATORS.find((o) => o.value === op)?.arrayValue ?? false;
}

// Operators whose value is one or more discrete equality matches (not a substring
// or numeric range). For these the editor offers the same searchable existing-values
// checklist as the live records bar; substring/range operators keep a free text input.
const DISCRETE_OPERATORS = new Set<FilterOperator>(["eq", "neq", "in"]);

function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const data = (err as { data?: { error?: unknown } }).data;
    if (data && typeof data.error === "string" && data.error.trim()) return data.error;
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return undefined;
}

/** Convert a stored filter value to a text field for editing. */
function filterValueToText(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (value === undefined || value === null) return "";
  return String(value);
}

/** Parse the edited text back into the stored value form for the given operator. */
function textToFilterValue(op: FilterOperator, text: string): unknown {
  if (!operatorNeedsValue(op)) return undefined;
  if (operatorIsArray(op)) {
    return text
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return text;
}

type DraftFilter = { field: string; operator: FilterOperator; valueText: string };
type DraftSort = { field: string; direction: SortSpecDirection };
// Pivot dimension draft (entity-scoped editor: only entity fields or record status —
// page-local dims are an engine capability but have no page context in this admin screen).
type DraftDim = { source: "entity" | "status"; fieldKey: string; datePeriod: PivotDimensionDatePeriod };

// Field types eligible as a pivot grouping dimension (discrete-ish values).
const PIVOT_DIM_TYPES = new Set(["text", "textarea", "number", "boolean", "date", "datetime", "select", "email", "url", "phone", "user", "relation", "lookup"]);
const isDateLikeType = (t: string) => t === "date" || t === "datetime";

// Reserved sort keys mapping to the record's system columns (creation date / id).
// They are sortable but never shown as table columns; kept in lockstep with the
// server sort builder (record-query.ts) and EntityRecords.tsx.
const SYSTEM_SORT_CREATED_AT = "__created_at__";
const SYSTEM_SORT_RECORD_ID = "__record_id__";

/**
 * Value picker for a select ("список") field's filter condition. Offers the
 * field's options as a checklist (single-select for scalar operators,
 * multi-select for "one of") while still allowing a manual value to be typed.
 * The committed value stays a comma-joined string in `valueText`, matching the
 * text representation the rest of the editor uses.
 */
function OptionPicker({
  options,
  valueText,
  onChange,
  multiple,
  t,
}: {
  options: string[];
  valueText: string;
  onChange: (text: string) => void;
  multiple: boolean;
  t: (key: string, def: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState("");
  const selected = multiple
    ? valueText.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    : valueText.trim()
      ? [valueText.trim()]
      : [];
  const commit = (vals: string[]) => onChange(multiple ? vals.join(", ") : vals[0] ?? "");
  const toggle = (opt: string) => {
    if (multiple) {
      commit(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
    } else {
      commit([opt]);
      setOpen(false);
    }
  };
  const addManual = () => {
    const v = manual.trim();
    if (!v) return;
    if (multiple) {
      if (!selected.includes(v)) commit([...selected, v]);
    } else {
      commit([v]);
      setOpen(false);
    }
    setManual("");
  };
  const allOptions = [...options, ...selected.filter((s) => !options.includes(s))];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-8 flex-1 justify-between text-sm font-normal">
          <span className="truncate text-left">
            {selected.length === 0 ? (
              <span className="text-slate-400">{t("views.selectValue", "выберите значение")}</span>
            ) : (
              selected.join(", ")
            )}
          </span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="max-h-52 overflow-y-auto p-1">
          {allOptions.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-slate-400">{t("views.noOptions", "Нет вариантов")}</p>
          ) : (
            allOptions.map((opt) => {
              const isSel = selected.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${isSel ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>
                    {isSel && <Check className="w-3 h-3" />}
                  </span>
                  <span className="truncate">{opt}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-1.5 border-t border-slate-100 p-2">
          <Input
            className="h-7 text-xs"
            value={manual}
            placeholder={t("views.manualValue", "вручную…")}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManual();
              }
            }}
          />
          <Button type="button" size="sm" variant="outline" className="h-7 px-2" onClick={addManual} disabled={!manual.trim()}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Restrict user options to a `user`-field's allowed roles (empty/unset = all).
 * Matches on the user's FULL role set (primary + additional), mirroring the
 * records value picker so a user holding the role as a secondary role appears. */
function filterUserOptionsByRoles(field: Field, options: UserOption[]): UserOption[] {
  const allowed = field.userConfigJson?.allowedRoleIds;
  if (!Array.isArray(allowed) || allowed.length === 0) return options;
  const allowedSet = new Set(allowed);
  return options.filter((u) => {
    const userRoles = u.roleIds && u.roleIds.length > 0 ? u.roleIds : [u.roleId];
    return userRoles.some((rid) => allowedSet.has(rid));
  });
}

/**
 * Value picker for a `user` field's filter condition. The committed value is the
 * user id (comma-joined ids for the "one of" operator), matching how user values
 * are stored on records; display shows the user names.
 */
function UserFilterPicker({
  options,
  valueText,
  onChange,
  multiple,
  t,
}: {
  options: UserOption[];
  valueText: string;
  onChange: (text: string) => void;
  multiple: boolean;
  t: (key: string, def: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const selectedIds = valueText.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const nameById = new Map(options.map((u) => [String(u.id), u.name]));
  const commit = (ids: string[]) => onChange(multiple ? ids.join(", ") : ids[0] ?? "");
  const toggle = (id: string) => {
    if (multiple) {
      commit(selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]);
    } else {
      commit([id]);
      setOpen(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-8 flex-1 justify-between text-sm font-normal">
          <span className="truncate text-left">
            {selectedIds.length === 0 ? (
              <span className="text-slate-400">{t("views.selectUser", "выберите пользователя")}</span>
            ) : (
              selectedIds.map((id) => nameById.get(id) ?? `#${id}`).join(", ")
            )}
          </span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="max-h-52 overflow-y-auto p-1">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-slate-400">{t("views.noUsers", "Нет пользователей")}</p>
          ) : (
            options.map((u) => {
              const id = String(u.id);
              const isSel = selectedIds.includes(id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggle(id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${isSel ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>
                    {isSel && <Check className="w-3 h-3" />}
                  </span>
                  <span className="truncate">{u.name}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Adaptive value editor for a filter condition, keyed by the field type:
 * - select → option checklist picker
 * - user   → user picker (RBAC-filtered, stores user ids)
 * - boolean→ yes/no dropdown
 * - date / datetime → native date pickers (single-value operators only)
 * - everything else → plain text input.
 * Operators that take no value render a dash; "one of" switches pickers to multi.
 */
function FilterValueEditor({
  field,
  operator,
  valueText,
  onChange,
  t,
  userOptions,
  getOptions,
}: {
  field: Field | undefined;
  operator: FilterOperator;
  valueText: string;
  onChange: (text: string) => void;
  t: (key: string, def: string) => string;
  userOptions: UserOption[];
  getOptions?: (fieldKey: string) => Promise<string[]>;
}) {
  if (!operatorNeedsValue(operator)) {
    return <div className="flex h-8 flex-1 items-center px-2 text-xs text-slate-400">—</div>;
  }
  const options = field && Array.isArray(field.optionsJson) ? (field.optionsJson as string[]) : [];
  const isArray = operatorIsArray(operator);
  const ft = field?.fieldType;
  if (ft === "select" && options.length > 0) {
    return <OptionPicker options={options} valueText={valueText} onChange={onChange} multiple={isArray} t={t} />;
  }
  if (ft === "user") {
    const opts = field ? filterUserOptionsByRoles(field, userOptions) : userOptions;
    return <UserFilterPicker options={opts} valueText={valueText} onChange={onChange} multiple={isArray} t={t} />;
  }
  if (ft === "boolean" && !isArray) {
    return (
      <Select value={valueText} onValueChange={onChange}>
        <SelectTrigger className="h-8 flex-1 text-sm">
          <SelectValue placeholder={t("views.selectValue", "выберите значение")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{t("views.boolTrue", "Да")}</SelectItem>
          <SelectItem value="false">{t("views.boolFalse", "Нет")}</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (ft === "date" && !isArray) {
    return <Input type="date" className="h-8 flex-1 text-sm" value={valueText} onChange={(e) => onChange(e.target.value)} />;
  }
  if (ft === "datetime" && !isArray) {
    return <Input type="datetime-local" className="h-8 flex-1 text-sm" value={valueText} onChange={(e) => onChange(e.target.value)} />;
  }
  // Discrete equality operators on any remaining field type: offer the SAME
  // searchable existing-values checklist as the live records bar (shared component).
  // Manual entry stays allowed so authors can target a value not yet present.
  if (field && getOptions && DISCRETE_OPERATORS.has(operator)) {
    const selectedVals = isArray
      ? valueText.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : valueText.trim()
        ? [valueText.trim()]
        : [];
    const commit = (vals: string[]) => onChange(isArray ? vals.join(", ") : vals[0] ?? "");
    const labelFor =
      ft === "boolean"
        ? (v: string) => (v === "true" ? t("views.boolTrue", "Да") : t("views.boolFalse", "Нет"))
        : undefined;
    return (
      <ValueChecklistPicker
        fieldKey={field.fieldKey}
        selected={selectedVals}
        onChange={commit}
        getOptions={getOptions}
        labelFor={labelFor}
        multiple={isArray}
        allowManual
        t={t}
        trigger={
          <Button type="button" variant="outline" className="h-8 flex-1 justify-between text-sm font-normal">
            <span className="truncate text-left">
              {selectedVals.length === 0 ? (
                <span className="text-slate-400">{t("views.selectValue", "выберите значение")}</span>
              ) : (
                selectedVals.map((v) => (labelFor ? labelFor(v) : v)).join(", ")
              )}
            </span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
          </Button>
        }
      />
    );
  }
  return (
    <Input
      className="h-8 flex-1 text-sm"
      value={valueText}
      placeholder={isArray ? "a, b, c" : t("views.value", "значение")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Reusable "Фильтры" section: a list of filter-condition rows (field / operator /
 * type-aware value) shared by the view editor dialog and the default-view dialog.
 * Changing a row's field clears its value (value editors are type-specific). The
 * AND/OR conjunction selector renders only when both conjunction props are given.
 */
function FilterRowsEditor({
  filters,
  fields,
  userOptions,
  ml,
  t,
  onAdd,
  onUpdate,
  onRemove,
  conjunction,
  onConjunctionChange,
  getOptions,
}: {
  filters: DraftFilter[];
  fields: Field[];
  userOptions: UserOption[];
  ml: (val: MultilingualText | string | undefined | null) => string;
  t: (key: string, def: string) => string;
  onAdd: () => void;
  onUpdate: (idx: number, patch: Partial<DraftFilter>) => void;
  onRemove: (idx: number) => void;
  conjunction?: "and" | "or";
  onConjunctionChange?: (v: "and" | "or") => void;
  getOptions?: (fieldKey: string) => Promise<string[]>;
}) {
  return (
    <div className="space-y-2 border-t border-slate-100 pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <Filter className="w-4 h-4 text-blue-600" />
          {t("views.filters", "Фильтры")}
        </div>
        <div className="flex items-center gap-2">
          {conjunction && onConjunctionChange && filters.length > 1 && (
            <Select value={conjunction} onValueChange={(v) => onConjunctionChange(v as "and" | "or")}>
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="and">{t("views.condAll", "Все условия (И)")}</SelectItem>
                <SelectItem value="or">{t("views.condAny", "Любое (ИЛИ)")}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={onAdd}>
            <Plus className="w-3.5 h-3.5" /> {t("views.condition", "Условие")}
          </Button>
        </div>
      </div>
      {filters.length === 0 ? (
        <p className="text-xs text-slate-400">{t("views.noFiltersHint", "Без фильтров показываются все записи.")}</p>
      ) : (
        <div className="space-y-2">
          {filters.map((f, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Select value={f.field} onValueChange={(v) => onUpdate(idx, { field: v, valueText: "" })}>
                <SelectTrigger className="h-8 text-sm flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {fields.map((fld: Field) => (
                    <SelectItem key={fld.fieldKey} value={fld.fieldKey}>{ml(fld.nameJson)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={f.operator} onValueChange={(v) => onUpdate(idx, { operator: v as FilterOperator })}>
                <SelectTrigger className="h-8 text-sm w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FILTER_OPERATORS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{t(`views.op_${o.value}`, o.label)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FilterValueEditor
                field={fields.find((x: Field) => x.fieldKey === f.field)}
                operator={f.operator}
                valueText={f.valueText}
                onChange={(text) => onUpdate(idx, { valueText: text })}
                t={t}
                userOptions={userOptions}
                getOptions={getOptions}
              />
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 shrink-0" onClick={() => onRemove(idx)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Editor for a single pivot grouping dimension (rows or cols). The admin picks
 * either the record status or an opted-in entity field; date/datetime fields
 * additionally expose a bucketing period (year/quarter/month/day).
 */
function PivotDimEditor({
  label,
  dim,
  onChange,
  dimFields,
  ml,
  t,
}: {
  label: string;
  dim: DraftDim;
  onChange: (d: DraftDim) => void;
  dimFields: Field[];
  ml: (val: MultilingualText | string | undefined | null) => string;
  t: (key: string, def: string) => string;
}) {
  const selectedField = dim.source === "entity" ? dimFields.find((f) => f.fieldKey === dim.fieldKey) : undefined;
  const isDate = selectedField ? isDateLikeType(selectedField.fieldType) : false;
  const selectValue = dim.source === "status" ? "__status__" : dim.fieldKey;
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <div className="flex items-center gap-2">
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (v === "__status__") {
              onChange({ source: "status", fieldKey: "", datePeriod: null });
            } else {
              const f = dimFields.find((x) => x.fieldKey === v);
              onChange({ source: "entity", fieldKey: v, datePeriod: f && isDateLikeType(f.fieldType) ? (dim.datePeriod ?? "month") : null });
            }
          }}
        >
          <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder={t("pivot.selectDim", "поле…")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__status__">{t("pivot.dimStatus", "Статус записи")}</SelectItem>
            {dimFields.map((f) => (
              <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isDate && (
          <Select value={dim.datePeriod ?? "month"} onValueChange={(v) => onChange({ ...dim, datePeriod: v as PivotDimensionDatePeriod })}>
            <SelectTrigger className="h-8 text-sm w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="year">{t("pivot.periodYear", "Год")}</SelectItem>
              <SelectItem value="quarter">{t("pivot.periodQuarter", "Квартал")}</SelectItem>
              <SelectItem value="month">{t("pivot.periodMonth", "Месяц")}</SelectItem>
              <SelectItem value="day">{t("pivot.periodDay", "День")}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

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
  // Searchable existing-values lookup for filter editors — same endpoint the live
  // records bar uses, so the value picker is consistent. No active-filter context
  // here (admin authoring), so it lists distinct values across all records.
  const filterValuesMutation = useGetEntityFilterValues();
  const getFilterOptions = useCallback(
    async (fieldKey: string): Promise<string[]> => {
      const res = await filterValuesMutation.mutateAsync({
        entityId,
        data: { field: fieldKey, filters: [] },
      });
      return res.values ?? [];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entityId],
  );
  // Fields the admin has opted into as pivot dims/measures.
  const pivotDimFields = fields.filter((f: Field) => f.pivotEnabled && PIVOT_DIM_TYPES.has(f.fieldType));
  const pivotSumFields = fields.filter((f: Field) => f.pivotEnabled && f.fieldType === "number");

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
  const [viewType, setViewType] = useState<"table" | "pivot">("table");
  const [pivotRows, setPivotRows] = useState<DraftDim>({ source: "status", fieldKey: "", datePeriod: null });
  const [pivotColsOn, setPivotColsOn] = useState(false);
  const [pivotCols, setPivotCols] = useState<DraftDim>({ source: "status", fieldKey: "", datePeriod: null });
  const [pivotAgg, setPivotAgg] = useState<"count" | "sum">("count");
  const [pivotMeasureField, setPivotMeasureField] = useState<string>("");
  // Per-view role visibility (empty = visible to everyone with record access).
  const [visibleRoleIds, setVisibleRoleIds] = useState<number[]>([]);

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
  const [defaultPivotAgg, setDefaultPivotAgg] = useState<"count" | "sum">("count");
  const [defaultPivotMeasureField, setDefaultPivotMeasureField] = useState<string>("");
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
    setPivotAgg("count");
    setPivotMeasureField(pivotSumFields[0]?.fieldKey ?? "");
    setVisibleRoleIds([]);
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
    const isPivot = cfg.viewType === "pivot" && !!cfg.pivot;
    setViewType(isPivot ? "pivot" : "table");
    const dimToDraft = (d: PivotDimension | undefined): DraftDim =>
      d && d.source !== "status"
        ? { source: "entity", fieldKey: d.fieldKey ?? "", datePeriod: d.datePeriod ?? null }
        : { source: "status", fieldKey: "", datePeriod: null };
    const p = cfg.pivot;
    setPivotRows(p ? dimToDraft(p.rows) : { source: pivotDimFields[0] ? "entity" : "status", fieldKey: pivotDimFields[0]?.fieldKey ?? "", datePeriod: null });
    setPivotColsOn(!!p?.cols);
    setPivotCols(p?.cols ? dimToDraft(p.cols) : { source: "status", fieldKey: "", datePeriod: null });
    setPivotAgg(p?.measure?.agg === "sum" ? "sum" : "count");
    setPivotMeasureField(p?.measure?.fieldKey ?? pivotSumFields[0]?.fieldKey ?? "");
    setDialogOpen(true);
  };

  const toggleVisibleRole = (roleId: number) =>
    setVisibleRoleIds((prev) => (prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]));

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
    setDefaultPivotOn(!!dp);
    setDefaultPivotRows(dp ? dimToDraft(dp.rows) : { source: pivotDimFields[0] ? "entity" : "status", fieldKey: pivotDimFields[0]?.fieldKey ?? "", datePeriod: null });
    setDefaultPivotColsOn(!!dp?.cols);
    setDefaultPivotCols(dp?.cols ? dimToDraft(dp.cols) : { source: "status", fieldKey: "", datePeriod: null });
    setDefaultPivotAgg(dp?.measure?.agg === "sum" ? "sum" : "count");
    setDefaultPivotMeasureField(dp?.measure?.fieldKey ?? pivotSumFields[0]?.fieldKey ?? "");
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
      if (defaultPivotColsOn && defaultPivotCols.source === "entity" && !defaultPivotCols.fieldKey) {
        toast({ title: t("pivot.needColField", "Выберите поле столбцов сводной таблицы"), variant: "destructive" });
        return;
      }
      if (defaultPivotAgg === "sum" && !defaultPivotMeasureField) {
        toast({ title: t("pivot.needMeasureField", "Выберите числовое поле для суммы"), variant: "destructive" });
        return;
      }
      const measure: PivotMeasure =
        defaultPivotAgg === "sum"
          ? { agg: "sum", source: "entity", fieldKey: defaultPivotMeasureField }
          : { agg: "count" };
      const pivot: PivotConfig = { rows: draftToDim(defaultPivotRows), measure };
      if (defaultPivotColsOn) pivot.cols = draftToDim(defaultPivotCols);
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
    if (viewType !== "pivot") return base;

    const draftToDim = (d: DraftDim): PivotDimension =>
      d.source === "status"
        ? { source: "status" as PivotDimensionSource }
        : {
            source: "entity" as PivotDimensionSource,
            fieldKey: d.fieldKey,
            datePeriod: isDateLikeType(fields.find((f: Field) => f.fieldKey === d.fieldKey)?.fieldType ?? "") ? d.datePeriod : null,
          };
    const measure: PivotMeasure =
      pivotAgg === "sum"
        ? { agg: "sum", source: "entity", fieldKey: pivotMeasureField }
        : { agg: "count" };
    const pivot: PivotConfig = { rows: draftToDim(pivotRows), measure };
    if (pivotColsOn) pivot.cols = draftToDim(pivotCols);
    return { ...base, viewType: "pivot", pivot };
  };

  const handleSubmit = () => {
    const configJson = buildConfig();
    const existingKeys = new Set(
      views.filter((v: View) => v.id !== editing?.id).map((v: View) => v.viewKey),
    );
    if (viewType === "pivot") {
      if (configJson.pivot?.rows.source === "entity" && !configJson.pivot.rows.fieldKey) {
        toast({ title: t("pivot.needRowField", "Выберите поле строк сводной таблицы"), variant: "destructive" });
        return;
      }
      if (pivotColsOn && configJson.pivot?.cols?.source === "entity" && !configJson.pivot.cols.fieldKey) {
        toast({ title: t("pivot.needColField", "Выберите поле столбцов сводной таблицы"), variant: "destructive" });
        return;
      }
      if (pivotAgg === "sum" && !pivotMeasureField) {
        toast({ title: t("pivot.needMeasureField", "Выберите числовое поле для суммы"), variant: "destructive" });
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

            {entity?.pivotEnabled && (
              <div className="space-y-1.5">
                <Label>{t("pivot.viewMode", "Тип отображения")}</Label>
                <div className="inline-flex items-center rounded-md border border-slate-200 p-0.5">
                  {([
                    ["table", t("pivot.modeTable", "Таблица")],
                    ["pivot", t("pivot.modePivot", "Сводная")],
                  ] as ["table" | "pivot", string][]).map(([value, label]) => (
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
            )}

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
              getOptions={getFilterOptions}
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
                <div className="space-y-1.5">
                  <Label className="text-sm">{t("pivot.measure", "Мера (значение в ячейках)")}</Label>
                  <div className="flex items-center gap-2">
                    <Select value={pivotAgg} onValueChange={(v) => setPivotAgg(v as "count" | "sum")}>
                      <SelectTrigger className="h-8 text-sm w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="count">{t("pivot.aggCount", "Количество записей")}</SelectItem>
                        <SelectItem value="sum">{t("pivot.aggSum", "Сумма поля")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {pivotAgg === "sum" && (
                      <Select value={pivotMeasureField} onValueChange={setPivotMeasureField}>
                        <SelectTrigger className="h-8 text-sm flex-1">
                          <SelectValue placeholder={t("pivot.selectNumberField", "числовое поле…")} />
                        </SelectTrigger>
                        <SelectContent>
                          {pivotSumFields.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-slate-400">{t("pivot.noNumberFields", "Нет числовых полей в сводных")}</div>
                          ) : (
                            pivotSumFields.map((f: Field) => (
                              <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
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
              getOptions={getFilterOptions}
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
                  <div className="space-y-1.5">
                    <Label className="text-sm">{t("pivot.measure", "Мера (значение в ячейках)")}</Label>
                    <div className="flex items-center gap-2">
                      <Select value={defaultPivotAgg} onValueChange={(v) => setDefaultPivotAgg(v as "count" | "sum")}>
                        <SelectTrigger className="h-8 text-sm w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="count">{t("pivot.aggCount", "Количество записей")}</SelectItem>
                          <SelectItem value="sum">{t("pivot.aggSum", "Сумма поля")}</SelectItem>
                        </SelectContent>
                      </Select>
                      {defaultPivotAgg === "sum" && (
                        <Select value={defaultPivotMeasureField} onValueChange={setDefaultPivotMeasureField}>
                          <SelectTrigger className="h-8 text-sm flex-1">
                            <SelectValue placeholder={t("pivot.selectNumberField", "числовое поле…")} />
                          </SelectTrigger>
                          <SelectContent>
                            {pivotSumFields.length === 0 ? (
                              <div className="px-2 py-1.5 text-xs text-slate-400">{t("pivot.noNumberFields", "Нет числовых полей в сводных")}</div>
                            ) : (
                              pivotSumFields.map((f: Field) => (
                                <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
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
