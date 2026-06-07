import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useListEntityViews,
  useCreateEntityView,
  useUpdateView,
  useDeleteView,
  useReorderViews,
  useListEntities,
  useListEntityFields,
  type View,
  type ViewConfig,
  type FilterCondition,
  type FilterOperator,
  type SortSpec,
  type SortSpecDirection,
  type Entity,
  type Field,
  type MultilingualText,
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
import { Plus, Pencil, Trash2, Loader2, ArrowLeft, LayoutList, Star, Filter, ArrowDownUp, X, ChevronUp, ChevronDown, Check } from "lucide-react";
import { useML, useT } from "@/lib/i18n";

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

function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object" && "response" in err) {
    const resp = (err as { response?: { data?: { error?: string } } }).response;
    return resp?.data?.error;
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

/**
 * Adaptive value editor for a filter condition: a select field offers an option
 * picker (multi when the operator is "one of"), every other field type keeps a
 * plain text input. Operators that take no value render a dash.
 */
function FilterValueEditor({
  field,
  operator,
  valueText,
  onChange,
  t,
}: {
  field: Field | undefined;
  operator: FilterOperator;
  valueText: string;
  onChange: (text: string) => void;
  t: (key: string, def: string) => string;
}) {
  if (!operatorNeedsValue(operator)) {
    return <div className="flex h-8 flex-1 items-center px-2 text-xs text-slate-400">—</div>;
  }
  const options = field && Array.isArray(field.optionsJson) ? (field.optionsJson as string[]) : [];
  const isArray = operatorIsArray(operator);
  if (field?.fieldType === "select" && options.length > 0) {
    return <OptionPicker options={options} valueText={valueText} onChange={onChange} multiple={isArray} t={t} />;
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
    setDialogOpen(true);
  };

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

  const buildConfig = (): ViewConfig => {
    const builtFilters: FilterCondition[] = filters.map((f) => {
      const cond: FilterCondition = { field: f.field, operator: f.operator };
      const value = textToFilterValue(f.operator, f.valueText);
      if (value !== undefined) cond.value = value;
      return cond;
    });
    const builtSorts: SortSpec[] = sorts.map((s) => ({ field: s.field, direction: s.direction }));
    return {
      filters: builtFilters,
      filterConjunction,
      sorts: builtSorts,
      search: search.trim() || undefined,
    };
  };

  const handleSubmit = () => {
    const configJson = buildConfig();
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        data: { viewKey: viewKey.trim(), nameJson: nameJson as MultilingualText, configJson, isDefault },
      });
    } else {
      createMutation.mutate({
        entityId,
        data: { viewKey: viewKey.trim(), nameJson: nameJson as MultilingualText, configJson, isDefault },
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
                placeholder="active_orders"
                className="font-mono"
              />
              <p className="text-xs text-slate-400">
                {t("views.keyHint", "Только строчные латинские буквы, цифры и подчёркивания. Уникален в пределах сущности.")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
              <Label className="cursor-pointer">{t("views.defaultView", "Вид по умолчанию")}</Label>
            </div>

            <div className="space-y-1.5">
              <Label>{t("views.textSearch", "Поиск по тексту")}</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("views.searchPlaceholder", "Подстрока по текстовым полям")} />
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <Filter className="w-4 h-4 text-blue-600" />
                  {t("views.filters", "Фильтры")}
                </div>
                <div className="flex items-center gap-2">
                  {filters.length > 1 && (
                    <Select value={filterConjunction} onValueChange={(v) => setFilterConjunction(v as "and" | "or")}>
                      <SelectTrigger className="h-8 w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="and">{t("views.condAll", "Все условия (И)")}</SelectItem>
                        <SelectItem value="or">{t("views.condAny", "Любое (ИЛИ)")}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={addFilter}>
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
                      <Select value={f.field} onValueChange={(v) => updateFilter(idx, { field: v })}>
                        <SelectTrigger className="h-8 text-sm flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {fields.map((fld: Field) => (
                            <SelectItem key={fld.fieldKey} value={fld.fieldKey}>{ml(fld.nameJson)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={f.operator} onValueChange={(v) => updateFilter(idx, { operator: v as FilterOperator })}>
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
                        onChange={(text) => updateFilter(idx, { valueText: text })}
                        t={t}
                      />
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 shrink-0" onClick={() => removeFilter(idx)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("views.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? t("views.save", "Сохранить") : t("views.create", "Создать")}
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
