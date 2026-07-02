import { useState } from "react";
import { useML } from "@/lib/i18n";
import {
  type UserOption,
  type FilterOperator,
  type SortSpecDirection,
  type Field,
  type MultilingualText,
  type PivotDimension,
  type PivotDimensionSource,
  type PivotDimensionDatePeriod,
  type CalendarConfig,
  type CalendarConfigColorBy,
  type CalendarConfigDefaultMode,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Filter, X, ChevronDown, Check, CalendarDays } from "lucide-react";
import { CALENDAR_STATUS_KEY } from "@/components/CalendarView";
import { ValueChecklistPicker } from "@/components/FilterValuePicker";
import { normalizeSelectOptions, type SelectOption } from "@/lib/selectOptions";

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

export function operatorLabel(op: FilterOperator): string {
  return FILTER_OPERATORS.find((o) => o.value === op)?.label ?? op;
}

export function operatorNeedsValue(op: FilterOperator): boolean {
  return FILTER_OPERATORS.find((o) => o.value === op)?.needsValue ?? true;
}

export function operatorIsArray(op: FilterOperator): boolean {
  return FILTER_OPERATORS.find((o) => o.value === op)?.arrayValue ?? false;
}

// Operators whose value is one or more discrete equality matches (not a substring
// or numeric range). For these the editor offers the same searchable existing-values
// checklist as the live records bar; substring/range operators keep a free text input.
const DISCRETE_OPERATORS = new Set<FilterOperator>(["eq", "neq", "in"]);

// Which operators make sense for a given EFFECTIVE field type. Closed / equality-only
// types (user, select, boolean) must NOT offer substring or numeric-range operators
// — "Производитель больше Hamada" is nonsense. Numeric/date types offer ranges but
// not substring; text-like types (and anything unmapped) offer the full set.
const TEXT_OPERATORS: FilterOperator[] = [
  "eq", "neq", "contains", "not_contains", "starts_with", "ends_with", "in", "is_empty", "is_not_empty",
];
const OPERATORS_BY_TYPE: Record<string, FilterOperator[]> = {
  user: ["eq", "neq", "in", "is_empty", "is_not_empty"],
  select: ["eq", "neq", "in", "is_empty", "is_not_empty"],
  boolean: ["eq", "neq", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "is_empty", "is_not_empty"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  datetime: ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
};
export function operatorsForType(type?: string): typeof FILTER_OPERATORS {
  const allowed = (type && OPERATORS_BY_TYPE[type]) ?? TEXT_OPERATORS;
  return FILTER_OPERATORS.filter((o) => allowed.includes(o.value));
}

/** Convert a stored filter value to a text field for editing. */
export function filterValueToText(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (value === undefined || value === null) return "";
  return String(value);
}

/** Parse the edited text back into the stored value form for the given operator. */
export function textToFilterValue(op: FilterOperator, text: string): unknown {
  if (!operatorNeedsValue(op)) return undefined;
  if (operatorIsArray(op)) {
    return text
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return text;
}

export type DraftFilter = { field: string; operator: FilterOperator; valueText: string };
export type DraftSort = { field: string; direction: SortSpecDirection };
// Pivot dimension draft. Entity-views editors only use entity|status; the "page"
// source is available where the editor has a page context (pivot PAGE custom config).
export type DraftDim = { source: "entity" | "page" | "status"; fieldKey: string; datePeriod: PivotDimensionDatePeriod };

// Field types eligible as a pivot grouping dimension (discrete-ish values).
export const PIVOT_DIM_TYPES = new Set(["text", "textarea", "number", "boolean", "date", "datetime", "select", "email", "url", "phone", "user", "relation", "lookup"]);
export const isDateLikeType = (t: string) => t === "date" || t === "datetime";

/** Minimal page-local field shape offered as a pivot dim (namespaced "p:" in selects). */
export type PageDimField = { fieldKey: string; nameJson: unknown; fieldType: string };

/** Stored pivot dimension → editor draft. */
export function dimToDraft(d: PivotDimension | undefined): DraftDim {
  if (!d || d.source === "status") return { source: "status", fieldKey: "", datePeriod: null };
  return {
    source: d.source === "page" ? "page" : "entity",
    fieldKey: d.fieldKey ?? "",
    datePeriod: d.datePeriod ?? null,
  };
}

/**
 * Editor draft → stored pivot dimension. When `dimFields` is supplied, the date
 * bucketing period is only kept for date-like fields (mirrors the entity default
 * pivot editor's save path); otherwise the draft's datePeriod passes through.
 * Page-source dims pass datePeriod through as-is (the editor already keeps it
 * non-null only for date-like page fields).
 */
export function draftToDim(d: DraftDim, dimFields?: Field[]): PivotDimension {
  if (d.source === "status") return { source: "status" as PivotDimensionSource };
  if (d.source === "page") {
    return { source: "page" as PivotDimensionSource, fieldKey: d.fieldKey, datePeriod: d.datePeriod };
  }
  const isDate = dimFields
    ? isDateLikeType(dimFields.find((f) => f.fieldKey === d.fieldKey)?.fieldType ?? "")
    : true;
  return {
    source: "entity" as PivotDimensionSource,
    fieldKey: d.fieldKey,
    datePeriod: isDate ? d.datePeriod : null,
  };
}

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
  options: SelectOption[];
  valueText: string;
  onChange: (text: string) => void;
  multiple: boolean;
  t: (key: string, def: string) => string;
}) {
  const ml = useML();
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
  const optionValues = options.map((o) => o.value);
  const labelOf = (value: string) =>
    ml(options.find((o) => o.value === value)?.labelJson) || value;
  const allOptions = [...optionValues, ...selected.filter((s) => !optionValues.includes(s))];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-8 flex-1 justify-between text-sm font-normal">
          <span className="truncate text-left">
            {selected.length === 0 ? (
              <span className="text-slate-400">{t("views.selectValue", "выберите значение")}</span>
            ) : (
              selected.map(labelOf).join(", ")
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
                  <span className="truncate">{labelOf(opt)}</span>
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

/**
 * Adaptive value editor for a filter condition, keyed by the field type:
 * - select → option checklist picker (static field options)
 * - boolean→ yes/no dropdown
 * - date / datetime → native date pickers (single-value operators only)
 * - user / relation / lookup / everything else (discrete operator) → the SAME
 *   searchable existing-values checklist as the live records bar, with labels
 *   resolved by the EFFECTIVE type (relation/lookup surface a linked field, so
 *   `projectedType` carries that field's type): user ids → names, booleans → Да/Нет.
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
  projectedType,
  projectedField,
}: {
  field: Field | undefined;
  operator: FilterOperator;
  valueText: string;
  onChange: (text: string) => void;
  t: (key: string, def: string) => string;
  userOptions: UserOption[];
  getOptions?: (fieldKey: string) => Promise<string[]>;
  /** For relation/lookup fields: the type of the linked field they surface. */
  projectedType?: Field["fieldType"];
  /** For relation/lookup fields: the linked field itself (e.g. its select options). */
  projectedField?: Field;
}) {
  const ml = useML();
  if (!operatorNeedsValue(operator)) {
    return <div className="flex h-8 flex-1 items-center px-2 text-xs text-slate-400">—</div>;
  }
  const options = normalizeSelectOptions(field?.optionsJson);
  const isArray = operatorIsArray(operator);
  const ft = field?.fieldType;
  // A relation/lookup field's raw values ARE the linked field's values, so labels
  // must be resolved by that linked field's type, not "relation"/"lookup".
  const effectiveType: Field["fieldType"] | undefined =
    ft === "relation" || ft === "lookup" ? (projectedType ?? "text") : ft;
  if (ft === "select" && options.length > 0) {
    return <OptionPicker options={options} valueText={valueText} onChange={onChange} multiple={isArray} t={t} />;
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
  // user / relation / lookup / any remaining field type under a discrete operator:
  // offer the SAME searchable checklist as the live records bar (shared component).
  // Options come from getOptions, which for CLOSED-domain effective types (user /
  // select / boolean) returns the FULL domain — not just values present in existing
  // records — so a view filter can target a value no record uses YET. Labels resolve
  // by the EFFECTIVE type so user ids show as names and booleans read as Да/Нет.
  if (field && getOptions && DISCRETE_OPERATORS.has(operator)) {
    const selectedVals = isArray
      ? valueText.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : valueText.trim()
        ? [valueText.trim()]
        : [];
    const commit = (vals: string[]) => onChange(isArray ? vals.join(", ") : vals[0] ?? "");
    const userNameById = new Map(userOptions.map((u) => [String(u.id), u.name] as const));
    // For a relation/lookup field projecting onto a select, resolve labels from the
    // LINKED field's options; for a direct select the picker above already handled it.
    const projectedSelectOptions =
      effectiveType === "select" ? normalizeSelectOptions((projectedField ?? field)?.optionsJson) : [];
    const labelFor =
      effectiveType === "user"
        ? (v: string) => userNameById.get(v) ?? `#${v}`
        : effectiveType === "boolean"
          ? (v: string) => (v === "true" ? t("views.boolTrue", "Да") : t("views.boolFalse", "Нет"))
          : effectiveType === "select"
            ? (v: string) => ml(projectedSelectOptions.find((o) => o.value === v)?.labelJson) || v
            : undefined;
    // Closed-domain values (user ids, booleans, select options) must be picked from
    // the full resolved list — typing one by hand is meaningless. Open-domain
    // (text-like) values keep manual entry so authors can target a value not yet
    // present in the data.
    const allowManual = !(
      effectiveType === "user" || effectiveType === "boolean" || effectiveType === "select"
    );
    return (
      <ValueChecklistPicker
        fieldKey={field.fieldKey}
        selected={selectedVals}
        onChange={commit}
        getOptions={getOptions}
        labelFor={labelFor}
        multiple={isArray}
        allowManual={allowManual}
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
export function FilterRowsEditor({
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
  projectedTypeByField,
  projectedFieldByField,
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
  projectedTypeByField?: Map<string, Field["fieldType"]>;
  projectedFieldByField?: Map<string, Field>;
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
          {filters.map((f, idx) => {
            const rowField = fields.find((x: Field) => x.fieldKey === f.field);
            const rowFt = rowField?.fieldType;
            const rowEff =
              rowFt === "relation" || rowFt === "lookup"
                ? (projectedTypeByField?.get(f.field) ?? "text")
                : rowFt;
            const rowOps = operatorsForType(rowEff);
            return (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  value={f.field}
                  onValueChange={(v) => {
                    const nf = fields.find((x: Field) => x.fieldKey === v);
                    const nft = nf?.fieldType;
                    const neff =
                      nft === "relation" || nft === "lookup"
                        ? (projectedTypeByField?.get(v) ?? "text")
                        : nft;
                    const allowed = operatorsForType(neff).map((o) => o.value);
                    // Reset to "равно" if the current operator is meaningless for the new
                    // field type (e.g. switching a "содержит" text filter to a user field).
                    onUpdate(idx, {
                      field: v,
                      valueText: "",
                      ...(allowed.includes(f.operator) ? {} : { operator: "eq" as FilterOperator }),
                    });
                  }}
                >
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
                    {rowOps.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{t(`views.op_${o.value}`, o.label)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FilterValueEditor
                  field={rowField}
                  operator={f.operator}
                  valueText={f.valueText}
                  onChange={(text) => onUpdate(idx, { valueText: text })}
                  t={t}
                  userOptions={userOptions}
                  getOptions={getOptions}
                  projectedType={projectedTypeByField?.get(f.field)}
                  projectedField={projectedFieldByField?.get(f.field)}
                />
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 shrink-0" onClick={() => onRemove(idx)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
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
export function PivotDimEditor({
  label,
  dim,
  onChange,
  dimFields,
  pageDimFields = [],
  ml,
  t,
}: {
  label: string;
  dim: DraftDim;
  onChange: (d: DraftDim) => void;
  dimFields: Field[];
  /** Page-local fields offered as dims (only where the editor has a page context). */
  pageDimFields?: PageDimField[];
  ml: (val: MultilingualText | string | undefined | null) => string;
  t: (key: string, def: string) => string;
}) {
  const selectedField =
    dim.source === "entity"
      ? dimFields.find((f) => f.fieldKey === dim.fieldKey)
      : dim.source === "page"
        ? pageDimFields.find((f) => f.fieldKey === dim.fieldKey)
        : undefined;
  const isDate = selectedField ? isDateLikeType(selectedField.fieldType) : false;
  const selectValue =
    dim.source === "status" ? "__status__" : dim.source === "page" ? (dim.fieldKey ? `p:${dim.fieldKey}` : "") : dim.fieldKey;
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <div className="flex items-center gap-2">
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (v === "__status__") {
              onChange({ source: "status", fieldKey: "", datePeriod: null });
            } else if (v.startsWith("p:")) {
              const key = v.slice(2);
              const f = pageDimFields.find((x) => x.fieldKey === key);
              onChange({ source: "page", fieldKey: key, datePeriod: f && isDateLikeType(f.fieldType) ? (dim.datePeriod ?? "month") : null });
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
            {pageDimFields.map((f) => (
              <SelectItem key={`p:${f.fieldKey}`} value={`p:${f.fieldKey}`}>
                {ml(f.nameJson as MultilingualText)} · {t("pivot.pageFieldSuffix", "поле страницы")}
              </SelectItem>
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

const CALENDAR_DATE_TYPES = new Set(["date", "datetime"]);
const NONE_VALUE = "__none__";

/**
 * Editor for a calendar view's configuration. The admin picks the date field that
 * anchors records on the calendar, an optional end-date field (multi-day spans),
 * the chip's title field, any extra fields shown on the chip, how chips are
 * colored (record status / a field value / none), and the initial layout mode.
 * The calendar reuses the SAME viewer-scoped records query as the table — this is
 * purely layout config, no permission logic lives here.
 */
export function CalendarConfigEditor({
  value,
  onChange,
  fields,
  ml,
  t,
}: {
  value: CalendarConfig;
  onChange: (c: CalendarConfig) => void;
  fields: Field[];
  ml: (val: MultilingualText | string | undefined | null) => string;
  t: (key: string, def: string) => string;
}) {
  const [cardOpen, setCardOpen] = useState(false);
  const dateFields = fields.filter((f) => CALENDAR_DATE_TYPES.has(f.fieldType));
  const cardKeys = value.cardFieldKeys ?? [];
  const colorBy = value.colorBy ?? null;

  const toggleCardField = (key: string) => {
    const next = cardKeys.includes(key)
      ? cardKeys.filter((k) => k !== key)
      : [...cardKeys, key];
    onChange({ ...value, cardFieldKeys: next });
  };

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <CalendarDays className="w-4 h-4 text-blue-600" />
        {t("calendar.configTitle", "Конфигурация календаря")}
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">{t("calendar.dateField", "Поле даты")}</Label>
        {dateFields.length === 0 ? (
          <p className="text-xs text-rose-500">{t("calendar.noDateFields", "У сущности нет полей типа «дата». Добавьте поле даты, чтобы использовать календарь.")}</p>
        ) : (
          <Select value={value.dateFieldKey || ""} onValueChange={(v) => onChange({ ...value, dateFieldKey: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("calendar.selectDateField", "выберите поле даты…")} /></SelectTrigger>
            <SelectContent>
              {dateFields.map((f) => (
                <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">{t("calendar.endDateField", "Поле даты окончания")}</Label>
        <Select
          value={value.endDateFieldKey ?? NONE_VALUE}
          onValueChange={(v) => onChange({ ...value, endDateFieldKey: v === NONE_VALUE ? null : v })}
        >
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>{t("calendar.endDateNone", "Без диапазона (один день)")}</SelectItem>
            {dateFields.filter((f) => f.fieldKey !== value.dateFieldKey).map((f) => (
              <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">{t("calendar.titleField", "Поле заголовка")}</Label>
        <Select
          value={value.titleFieldKey ?? NONE_VALUE}
          onValueChange={(v) => onChange({ ...value, titleFieldKey: v === NONE_VALUE ? null : v })}
        >
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>{t("calendar.titleAuto", "Автоматически (первое текстовое поле)")}</SelectItem>
            {fields.map((f) => (
              <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">{t("calendar.cardFields", "Данные на плашке")}</Label>
        <Popover open={cardOpen} onOpenChange={setCardOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="h-8 w-full justify-between text-sm font-normal">
              <span className="truncate text-left">
                {cardKeys.length === 0 ? (
                  <span className="text-slate-400">{t("calendar.cardFieldsNone", "только заголовок")}</span>
                ) : (
                  cardKeys
                    .map((k) =>
                      k === CALENDAR_STATUS_KEY
                        ? t("calendar.statusLabel", "Статус")
                        : ml(fields.find((f) => f.fieldKey === k)?.nameJson) || k,
                    )
                    .join(", ")
                )}
              </span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <div className="max-h-60 overflow-y-auto p-1">
              {(() => {
                const statusSel = cardKeys.includes(CALENDAR_STATUS_KEY);
                return (
                  <>
                    <button
                      key={CALENDAR_STATUS_KEY}
                      type="button"
                      onClick={() => toggleCardField(CALENDAR_STATUS_KEY)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded border ${statusSel ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>
                        {statusSel && <Check className="w-3 h-3" />}
                      </span>
                      <span className="truncate">{t("calendar.statusLabel", "Статус")}</span>
                    </button>
                    {fields.map((f) => {
                      const isSel = cardKeys.includes(f.fieldKey);
                      return (
                        <button
                          key={f.fieldKey}
                          type="button"
                          onClick={() => toggleCardField(f.fieldKey)}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"
                        >
                          <span className={`flex h-4 w-4 items-center justify-center rounded border ${isSel ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>
                            {isSel && <Check className="w-3 h-3" />}
                          </span>
                          <span className="truncate">{ml(f.nameJson)}</span>
                        </button>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </PopoverContent>
        </Popover>
        <p className="text-xs text-slate-400">{t("calendar.cardFieldsHint", "Дополнительные поля записи, показываемые на плашке события под заголовком.")}</p>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label className="text-sm">{t("calendar.colorBy", "Цвет плашки")}</Label>
          <Select
            value={colorBy ?? NONE_VALUE}
            onValueChange={(v) => onChange({ ...value, colorBy: v === NONE_VALUE ? null : (v as CalendarConfigColorBy), colorFieldKey: v === "field" ? value.colorFieldKey : null })}
          >
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>{t("calendar.colorNone", "Без цвета")}</SelectItem>
              <SelectItem value="status">{t("calendar.colorStatus", "По статусу")}</SelectItem>
              <SelectItem value="field">{t("calendar.colorField", "По полю")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {colorBy === "field" && (
          <div className="flex-1 space-y-1.5">
            <Label className="text-sm">{t("calendar.colorField", "По полю")}</Label>
            <Select value={value.colorFieldKey ?? ""} onValueChange={(v) => onChange({ ...value, colorFieldKey: v })}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("calendar.selectField", "поле…")} /></SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">{t("calendar.defaultMode", "Режим по умолчанию")}</Label>
        <Select
          value={value.defaultMode ?? "month"}
          onValueChange={(v) => onChange({ ...value, defaultMode: v as CalendarConfigDefaultMode })}
        >
          <SelectTrigger className="h-8 text-sm w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="month">{t("calendar.modeMonth", "Месяц")}</SelectItem>
            <SelectItem value="week">{t("calendar.modeWeek", "Неделя")}</SelectItem>
            <SelectItem value="day">{t("calendar.modeDay", "День")}</SelectItem>
            <SelectItem value="agenda">{t("calendar.modeAgenda", "Повестка")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
