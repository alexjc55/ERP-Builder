import { useState, type ReactElement } from "react";
import { useParams, useLocation } from "wouter";
import {
  useListEntityCustomFilters,
  useCreateEntityCustomFilter,
  useUpdateCustomFilter,
  useDeleteCustomFilter,
  useReorderCustomFilters,
  useListEntityFields,
  useListEntities,
  useListPages,
  useListPageFields,
  getListPageFieldsQueryKey,
  type CustomFilter,
  type CustomFilterOperator,
  type CustomFilterInputType,
  type CustomFilterCondition,
  type CustomFilterGroup,
  type CustomFilterInput,
  type Field,
  type Entity,
  type Page,
  type PageField,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  Filter,
  X,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { useML, useT } from "@/lib/i18n";
import { normalizeSelectOptions } from "@/lib/selectOptions";

type MLValue = { ru?: string; en?: string; he?: string };

function extractError(err: unknown): string {
  if (err && typeof err === "object" && "response" in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return String(err);
}

const OPERATORS: { value: CustomFilterOperator; label: string }[] = [
  { value: "eq", label: "равно" },
  { value: "neq", label: "не равно" },
  { value: "contains", label: "содержит" },
  { value: "notContains", label: "не содержит" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "between", label: "между" },
  { value: "empty", label: "пусто" },
  { value: "notEmpty", label: "не пусто" },
];

const INPUT_TYPES: { value: CustomFilterInputType; label: string }[] = [
  { value: "text", label: "Текст" },
  { value: "number", label: "Число" },
  { value: "date", label: "Дата" },
  { value: "datetime", label: "Дата и время" },
  { value: "dateRange", label: "Период (даты)" },
  { value: "numberRange", label: "Диапазон чисел" },
  { value: "select", label: "Список" },
  { value: "boolean", label: "Да / Нет" },
];

const noValueOp = (op: CustomFilterOperator) => op === "empty" || op === "notEmpty";
const isBetween = (op: CustomFilterOperator) => op === "between";

type CondDraft = {
  fieldSource: "entity" | "page";
  pageId: string;
  fieldKey: string;
  operator: CustomFilterOperator;
  valueSource: "static" | "input";
  value: string;
  value2: string;
  inputId: string;
};

type GroupDraft = { conjunction: "and" | "or"; conditions: CondDraft[] };
type InputDraft = { id: string; type: CustomFilterInputType; labelJson: MLValue };

function emptyCond(fields: Field[]): CondDraft {
  return {
    fieldSource: "entity",
    pageId: "",
    fieldKey: fields[0]?.fieldKey ?? "",
    operator: "eq",
    valueSource: "static",
    value: "",
    value2: "",
    inputId: "",
  };
}

/** A page-local field <Select> that lazily fetches the page's fields. */
function PageFieldSelect({
  pageId,
  value,
  onChange,
  ml,
  placeholder,
  className,
}: {
  pageId: number;
  value: string;
  onChange: (v: string) => void;
  ml: (v: unknown) => string;
  placeholder: string;
  className?: string;
}): ReactElement {
  const { data: pageFields = [] } = useListPageFields(pageId, {
    query: { enabled: pageId > 0, queryKey: getListPageFieldsQueryKey(pageId) },
  });
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {(pageFields as PageField[]).map((f) => (
          <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function EntityCustomFiltersPage() {
  const params = useParams();
  const entityId = Number(params.entityId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ml = useML();
  const t = useT();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFilter | null>(null);
  const [toDelete, setToDelete] = useState<CustomFilter | null>(null);

  const [nameJson, setNameJson] = useState<MLValue>({});
  const [isActive, setIsActive] = useState(true);
  const [conjunction, setConjunction] = useState<"and" | "or">("and");
  const [groups, setGroups] = useState<GroupDraft[]>([]);
  const [inputs, setInputs] = useState<InputDraft[]>([]);

  const { data: entities = [] } = useListEntities();
  const entity = entities.find((e: Entity) => e.id === entityId);

  const { data: allPages = [] } = useListPages();
  const mirrorPages = (allPages as Page[]).filter((p) => p.mirrorEntityId === entityId);

  const { data: filters = [], isLoading } = useListEntityCustomFilters(entityId);
  const { data: allFields = [] } = useListEntityFields(entityId);

  const fields = [...allFields]
    .filter((f: Field) => f.isActive)
    .sort((a: Field, b: Field) => a.sortOrder - b.sortOrder);
  const fieldByKey = new Map(fields.map((f: Field) => [f.fieldKey, f] as const));

  const sorted = [...filters].sort((a, b) => a.sortOrder - b.sortOrder);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/custom-filters`] });
  };

  const createMutation = useCreateEntityCustomFilter({
    mutation: {
      onSuccess: () => { toast({ title: t("cf.created", "Фильтр создан") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("cf.createError", "Ошибка создания"), description: extractError(err), variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateCustomFilter({
    mutation: {
      onSuccess: () => { toast({ title: t("cf.updated", "Фильтр обновлён") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("cf.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteCustomFilter({
    mutation: {
      onSuccess: () => { toast({ title: t("cf.deleted", "Фильтр удалён") }); setToDelete(null); invalidate(); },
      onError: () => toast({ title: t("cf.deleteError", "Ошибка удаления"), variant: "destructive" }),
    },
  });
  const reorderMutation = useReorderCustomFilters({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: t("cf.reorderError", "Ошибка изменения порядка"), variant: "destructive" }),
    },
  });

  const toggleActive = (f: CustomFilter) => {
    updateMutation.mutate({ id: f.id, data: { isActive: !f.isActive } });
  };

  const move = (list: CustomFilter[], index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    reorderMutation.mutate({
      data: { entityId, items: [{ id: a.id, sortOrder: b.sortOrder }, { id: b.id, sortOrder: a.sortOrder }] },
    });
  };

  const openCreate = () => {
    setEditing(null);
    setNameJson({});
    setIsActive(true);
    setConjunction("and");
    setGroups([{ conjunction: "and", conditions: [emptyCond(fields)] }]);
    setInputs([]);
    setDialogOpen(true);
  };

  const conditionToDraft = (c: CustomFilterCondition): CondDraft => {
    const isArr = Array.isArray(c.value);
    const arr = (c.value as unknown[]) ?? [];
    return {
      fieldSource: c.fieldSource === "page" ? "page" : "entity",
      pageId: c.pageId == null ? "" : String(c.pageId),
      fieldKey: c.fieldKey,
      operator: c.operator,
      valueSource: c.valueSource === "input" ? "input" : "static",
      value: isArr ? (arr[0] == null ? "" : String(arr[0])) : (c.value == null ? "" : String(c.value)),
      value2: isArr ? (arr[1] == null ? "" : String(arr[1])) : "",
      inputId: c.inputId ?? "",
    };
  };

  const openEdit = (f: CustomFilter) => {
    setEditing(f);
    const n = f.nameJson;
    setNameJson(typeof n === "object" && n ? { ru: n.ru, en: n.en, he: n.he } : {});
    setIsActive(f.isActive);
    setConjunction(f.conjunction === "or" ? "or" : "and");
    const gs = (f.groupsJson ?? []) as CustomFilterGroup[];
    setGroups(
      gs.length === 0
        ? [{ conjunction: "and", conditions: [emptyCond(fields)] }]
        : gs.map((g) => ({
            conjunction: g.conjunction === "or" ? "or" : "and",
            conditions: (g.conditions ?? []).map(conditionToDraft),
          })),
    );
    setInputs(
      ((f.inputsJson ?? []) as CustomFilterInput[]).map((i) => ({
        id: i.id,
        type: i.type,
        labelJson: (i.labelJson as MLValue) ?? {},
      })),
    );
    setDialogOpen(true);
  };

  // ── group / condition mutation helpers ──
  const updateGroup = (gi: number, patch: Partial<GroupDraft>) =>
    setGroups((prev) => prev.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const addGroup = () =>
    setGroups((prev) => [...prev, { conjunction: "and", conditions: [emptyCond(fields)] }]);
  const removeGroup = (gi: number) => setGroups((prev) => prev.filter((_, i) => i !== gi));
  const updateCond = (gi: number, ci: number, patch: Partial<CondDraft>) =>
    setGroups((prev) =>
      prev.map((g, i) =>
        i === gi ? { ...g, conditions: g.conditions.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : g,
      ),
    );
  const addCond = (gi: number) =>
    setGroups((prev) => prev.map((g, i) => (i === gi ? { ...g, conditions: [...g.conditions, emptyCond(fields)] } : g)));
  const removeCond = (gi: number, ci: number) =>
    setGroups((prev) =>
      prev.map((g, i) => (i === gi ? { ...g, conditions: g.conditions.filter((_, j) => j !== ci) } : g)),
    );

  // ── inputs helpers ──
  const genInputId = () => `in_${Math.random().toString(36).slice(2, 8)}`;
  const addInput = () => setInputs((prev) => [...prev, { id: genInputId(), type: "text", labelJson: {} }]);
  const updateInput = (i: number, patch: Partial<InputDraft>) =>
    setInputs((prev) => prev.map((inp, idx) => (idx === i ? { ...inp, ...patch } : inp)));
  const removeInput = (i: number) => setInputs((prev) => prev.filter((_, idx) => idx !== i));

  const draftToCondition = (c: CondDraft): CustomFilterCondition => {
    const base: CustomFilterCondition = {
      fieldSource: c.fieldSource,
      fieldKey: c.fieldKey,
      operator: c.operator,
    };
    if (c.fieldSource === "page" && c.pageId) base.pageId = Number(c.pageId);
    if (noValueOp(c.operator)) return base;
    if (c.valueSource === "input") {
      base.valueSource = "input";
      base.inputId = c.inputId;
      return base;
    }
    base.valueSource = "static";
    base.value = isBetween(c.operator) ? [c.value, c.value2] : c.value;
    return base;
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = () => {
    if (!nameJson.ru && !nameJson.en && !nameJson.he) {
      toast({ title: t("cf.nameRequired", "Введите название"), variant: "destructive" });
      return;
    }
    const cleanGroups = groups
      .map((g) => ({ conjunction: g.conjunction, conditions: g.conditions }))
      .filter((g) => g.conditions.length > 0);
    if (cleanGroups.length === 0) {
      toast({ title: t("cf.noConditions", "Добавьте хотя бы одно условие"), variant: "destructive" });
      return;
    }
    // Validate input-sourced conditions reference a declared input.
    for (const g of cleanGroups) {
      for (const c of g.conditions) {
        if (!noValueOp(c.operator) && c.valueSource === "input" && !c.inputId) {
          toast({ title: t("cf.inputMissing", "Выберите пользовательский ввод для условия"), variant: "destructive" });
          return;
        }
        if (c.fieldSource === "page" && (!c.pageId || !c.fieldKey)) {
          toast({ title: t("cf.pageFieldMissing", "Выберите страницу и поле"), variant: "destructive" });
          return;
        }
        if (c.fieldSource === "entity" && !c.fieldKey) {
          toast({ title: t("cf.fieldMissing", "Выберите поле"), variant: "destructive" });
          return;
        }
      }
    }

    const groupsJson: CustomFilterGroup[] = cleanGroups.map((g) => ({
      conjunction: g.conjunction,
      conditions: g.conditions.map(draftToCondition),
    }));
    const inputsJson: CustomFilterInput[] = inputs
      .filter((i) => i.id)
      .map((i) => ({ id: i.id, type: i.type, labelJson: i.labelJson }));

    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        data: { nameJson, isActive, conjunction, groupsJson, inputsJson },
      });
    } else {
      createMutation.mutate({
        entityId,
        data: { entityId, nameJson, isActive, conjunction, groupsJson, inputsJson },
      });
    }
  };

  const conditionSummary = (f: CustomFilter): string => {
    const gs = (f.groupsJson ?? []) as CustomFilterGroup[];
    const total = gs.reduce((n, g) => n + (g.conditions?.length ?? 0), 0);
    if (total === 0) return "—";
    return t("cf.condCount", "условий: {n}").replace("{n}", String(total));
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="gap-1.5 text-slate-500 -ml-2" onClick={() => navigate("/admin/entities")}>
          <ArrowLeft className="w-4 h-4" />{t("cf.back", "К сущностям")}
        </Button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Filter className="w-6 h-6 text-blue-600" />
              {t("cf.title", "Кастомные фильтры")}{entity ? `: ${ml(entity.nameJson)}` : ""}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {t("cf.subtitle", "Гибкие фильтры по любым полям сущности. Каждый фильтр — одна кнопка на панели фильтров в таблице, сводной и календаре.")}
            </p>
          </div>
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
            <Plus className="w-4 h-4" />{t("cf.add", "Добавить фильтр")}
          </Button>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => (<Skeleton key={i} className="h-12 w-full" />))}</div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-16 text-slate-400">{t("cf.empty", "Фильтров пока нет.")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("cf.colName", "Название")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("cf.colConditions", "Условия")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("cf.colInputs", "Ввод")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("cf.colActive", "Активен")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((f: CustomFilter, idx: number) => (
                  <tr key={f.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700 font-medium">{ml(f.nameJson) || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{conditionSummary(f)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{(f.inputsJson?.length ?? 0) === 0 ? "—" : String(f.inputsJson.length)}</td>
                    <td className="px-4 py-3">
                      <Switch checked={f.isActive} onCheckedChange={() => toggleActive(f)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={idx === 0 || reorderMutation.isPending} onClick={() => move(sorted, idx, -1)}>
                          <ChevronUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={idx === sorted.length - 1 || reorderMutation.isPending} onClick={() => move(sorted, idx, 1)}>
                          <ChevronDown className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(f)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setToDelete(f)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("cf.edit", "Редактировать фильтр") : t("cf.new", "Новый фильтр")}</DialogTitle>
            <DialogDescription>{t("cf.dialogDesc", "Соберите условие из групп. Группы объединяются логикой верхнего уровня, условия внутри группы — логикой группы: (A И B) ИЛИ (C И D).")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <MultilingualInput label={t("cf.nameLabel", "Название")} value={nameJson} onChange={setNameJson} required />

            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>{t("cf.activeLabel", "Активен")}</Label>
            </div>

            {/* User inputs */}
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">{t("cf.inputs", "Пользовательский ввод")}</Label>
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addInput}>
                  <Plus className="w-3.5 h-3.5" />{t("cf.addInput", "Добавить ввод")}
                </Button>
              </div>
              <p className="text-xs text-slate-500">{t("cf.inputsHint", "Значения, которые пользователь вводит при применении фильтра. Один ввод можно использовать в нескольких условиях (например, один период на две даты).")}</p>
              {inputs.length === 0 ? (
                <p className="text-xs text-slate-400">{t("cf.noInputs", "Вводов нет — все условия сравнивают с фиксированными значениями.")}</p>
              ) : (
                inputs.map((inp, i) => (
                  <div key={inp.id} className="flex items-center gap-1.5">
                    <Select value={inp.type} onValueChange={(v) => updateInput(i, { type: v as CustomFilterInputType })}>
                      <SelectTrigger className="w-44 shrink-0"><SelectValue /></SelectTrigger>
                      <SelectContent>{INPUT_TYPES.map((it) => (<SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>))}</SelectContent>
                    </Select>
                    <Input
                      className="flex-1"
                      value={inp.labelJson.ru ?? ""}
                      onChange={(e) => updateInput(i, { labelJson: { ...inp.labelJson, ru: e.target.value } })}
                      placeholder={t("cf.inputLabel", "Подпись (напр. «Период»)")}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-400 shrink-0" onClick={() => removeInput(i)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Top-level conjunction */}
            {groups.length > 1 && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{t("cf.topMatch", "Группы объединяются:")}</span>
                <Select value={conjunction} onValueChange={(v) => setConjunction(v as "and" | "or")}>
                  <SelectTrigger className="h-7 w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="and">{t("cf.matchAll", "все группы (И)")}</SelectItem>
                    <SelectItem value="or">{t("cf.matchAny", "любая группа (ИЛИ)")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Groups */}
            <div className="space-y-3">
              {groups.map((g, gi) => (
                <div key={gi} className="space-y-2 rounded-md border border-slate-200 p-3 bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-600">{t("cf.group", "Группа")} {gi + 1}</span>
                      {g.conditions.length > 1 && (
                        <Select value={g.conjunction} onValueChange={(v) => updateGroup(gi, { conjunction: v as "and" | "or" })}>
                          <SelectTrigger className="h-7 w-44"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="and">{t("cf.condAll", "все условия (И)")}</SelectItem>
                            <SelectItem value="or">{t("cf.condAny", "любое условие (ИЛИ)")}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    {groups.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-slate-400" onClick={() => removeGroup(gi)}>
                        <X className="w-3.5 h-3.5" />{t("cf.removeGroup", "Удалить группу")}
                      </Button>
                    )}
                  </div>

                  {g.conditions.map((c, ci) => (
                    <div key={ci} className="flex flex-wrap items-center gap-1.5">
                      {mirrorPages.length > 0 && (
                        <Select value={c.fieldSource} onValueChange={(v) => updateCond(gi, ci, { fieldSource: v as "entity" | "page", fieldKey: v === "page" ? "" : (fields[0]?.fieldKey ?? ""), pageId: "", value: "", value2: "" })}>
                          <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="entity">{t("cf.srcEntity", "Поле")}</SelectItem>
                            <SelectItem value="page">{t("cf.srcPage", "Страница")}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      {c.fieldSource === "page" ? (
                        <>
                          <Select value={c.pageId} onValueChange={(v) => updateCond(gi, ci, { pageId: v, fieldKey: "" })}>
                            <SelectTrigger className="w-40"><SelectValue placeholder={t("cf.page", "Страница")} /></SelectTrigger>
                            <SelectContent>{mirrorPages.map((p) => (<SelectItem key={p.id} value={String(p.id)}>{ml(p.nameJson) || `#${p.id}`}</SelectItem>))}</SelectContent>
                          </Select>
                          {c.pageId && (
                            <PageFieldSelect pageId={Number(c.pageId)} value={c.fieldKey} onChange={(v) => updateCond(gi, ci, { fieldKey: v })} ml={ml} className="w-40" placeholder={t("cf.pageField", "Поле страницы")} />
                          )}
                        </>
                      ) : (
                        <Select value={c.fieldKey} onValueChange={(v) => updateCond(gi, ci, { fieldKey: v, value: "", value2: "" })}>
                          <SelectTrigger className="w-44"><SelectValue placeholder={t("cf.field", "Поле")} /></SelectTrigger>
                          <SelectContent>
                            {fields.map((f) => (<SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      )}

                      <Select value={c.operator} onValueChange={(v) => updateCond(gi, ci, { operator: v as CustomFilterOperator })}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>{OPERATORS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent>
                      </Select>

                      {!noValueOp(c.operator) && (
                        <>
                          <Select value={c.valueSource} onValueChange={(v) => updateCond(gi, ci, { valueSource: v as "static" | "input", value: "", value2: "", inputId: "" })}>
                            <SelectTrigger className="w-32 shrink-0"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="static">{t("cf.static", "Значение")}</SelectItem>
                              <SelectItem value="input">{t("cf.fromInput", "Ввод пользователя")}</SelectItem>
                            </SelectContent>
                          </Select>
                          {c.valueSource === "input" ? (
                            <Select value={c.inputId} onValueChange={(v) => updateCond(gi, ci, { inputId: v })}>
                              <SelectTrigger className="flex-1"><SelectValue placeholder={t("cf.pickInput", "Выберите ввод")} /></SelectTrigger>
                              <SelectContent>
                                {inputs.length === 0 ? (
                                  <div className="px-2 py-1.5 text-xs text-slate-400">{t("cf.noInputsShort", "Сначала добавьте ввод")}</div>
                                ) : inputs.map((inp) => (
                                  <SelectItem key={inp.id} value={inp.id}>{inp.labelJson.ru || inp.id}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <StaticValueControl
                              field={c.fieldSource === "entity" ? fieldByKey.get(c.fieldKey) : undefined}
                              op={c.operator}
                              value={c.value}
                              value2={c.value2}
                              onChange={(v) => updateCond(gi, ci, { value: v })}
                              onChange2={(v) => updateCond(gi, ci, { value2: v })}
                              ml={ml}
                              t={t}
                            />
                          )}
                        </>
                      )}

                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-400 shrink-0" onClick={() => removeCond(gi, ci)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}

                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => addCond(gi)}>
                    <Plus className="w-3.5 h-3.5" />{t("cf.addCondition", "Добавить условие")}
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addGroup}>
                <Plus className="w-3.5 h-3.5" />{t("cf.addGroup", "Добавить группу (ИЛИ)")}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {editing ? t("common.save", "Сохранить") : t("common.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cf.deleteTitle", "Удалить фильтр?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cf.deleteDesc", "Действие необратимо.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => toDelete && deleteMutation.mutate({ id: toDelete.id })}>
              {t("common.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Static comparison-value control, adapted to the (entity) field type. */
function StaticValueControl({
  field,
  op,
  value,
  value2,
  onChange,
  onChange2,
  ml,
  t,
}: {
  field: Field | undefined;
  op: CustomFilterOperator;
  value: string;
  value2: string;
  onChange: (v: string) => void;
  onChange2: (v: string) => void;
  ml: (v: unknown) => string;
  t: (k: string, d: string) => string;
}): ReactElement {
  const ph = t("cf.valuePlaceholder", "значение");
  const type = field?.fieldType;

  if (isBetween(op)) {
    const inputType = type === "number" || type === "percent" ? "number" : type === "datetime" ? "datetime-local" : type === "date" ? "date" : "text";
    return (
      <div className="flex items-center gap-1.5 flex-1">
        <Input type={inputType} className="flex-1" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("cf.from", "от")} />
        <span className="text-slate-400 text-xs">—</span>
        <Input type={inputType} className="flex-1" value={value2} onChange={(e) => onChange2(e.target.value)} placeholder={t("cf.to", "до")} />
      </div>
    );
  }

  if (type === "select") {
    const options = normalizeSelectOptions(field?.optionsJson);
    return (
      <Select value={value || ""} onValueChange={onChange}>
        <SelectTrigger className="flex-1"><SelectValue placeholder={ph} /></SelectTrigger>
        <SelectContent>{options.map((o) => (<SelectItem key={o.value} value={o.value}>{ml(o.labelJson) || o.value}</SelectItem>))}</SelectContent>
      </Select>
    );
  }
  if (type === "boolean") {
    return (
      <Select value={value || ""} onValueChange={onChange}>
        <SelectTrigger className="flex-1"><SelectValue placeholder={ph} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{t("cf.yes", "Да")}</SelectItem>
          <SelectItem value="false">{t("cf.no", "Нет")}</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (type === "number" || type === "percent") return <Input type="number" className="flex-1" value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} />;
  if (type === "date") return <Input type="date" className="flex-1" value={value} onChange={(e) => onChange(e.target.value)} />;
  if (type === "datetime") return <Input type="datetime-local" className="flex-1" value={value} onChange={(e) => onChange(e.target.value)} />;
  return <Input className="flex-1" value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} />;
}
