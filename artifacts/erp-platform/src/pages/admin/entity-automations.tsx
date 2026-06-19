import { useState, useEffect, useCallback, type ReactElement } from "react";
import { useParams, useLocation } from "wouter";
import {
  useListEntityAutomations,
  useCreateEntityAutomation,
  useUpdateAutomation,
  useDeleteAutomation,
  useReorderAutomations,
  useListEntityAutomationRuns,
  getListEntityAutomationRunsQueryKey,
  useListEntityStatuses,
  getListEntityStatusesQueryKey,
  useListEntityFields,
  getListEntityFieldsQueryKey,
  useListEntities,
  useListUserOptions,
  useGetEntityRelatedCandidates,
  type Automation,
  type AutomationTrigger,
  type AutomationCondition,
  type AutomationAction,
  type AutomationMapping,
  type AutomationConditionOperator,
  type AutomationTriggerType,
  type AutomationActionType,
  type Status,
  type Field,
  type Entity,
  type UserOption,
  type MultilingualText,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { MultilingualInput } from "@/components/MultilingualInput";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  Zap,
  X,
  ChevronUp,
  ChevronDown,
  History,
  CheckCircle2,
  XCircle,
  MinusCircle,
  ChevronsUpDown,
} from "lucide-react";
import { useML, useT } from "@/lib/i18n";
import { filterUserOptionsByRoles } from "@/lib/userFieldRoles";

type MLValue = { ru?: string; en?: string; he?: string };

/** Sentinel for the record's status pseudo-field in conditions. */
const STATUS_KEY = "__status__";
/** Sentinel for the "any" status wildcard in status_changed trigger selects. */
const ANY = "__any__";

type ConditionDraft = { fieldKey: string; operator: AutomationConditionOperator; value: string };
type MappingDraft = { targetFieldKey: string; sourceType: "literal" | "field"; value: string; sourceFieldKey: string };
type ActionDraft = {
  type: AutomationActionType;
  fieldKey: string;
  value: string;
  statusId: string;
  targetEntityId: string;
  mapping: MappingDraft[];
  match: ConditionDraft[];
  url: string;
  includeRecord: boolean;
};

function extractError(err: unknown): string {
  if (err && typeof err === "object" && "response" in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return String(err);
}

const OPERATORS: { value: AutomationConditionOperator; label: string }[] = [
  { value: "eq", label: "равно" },
  { value: "neq", label: "не равно" },
  { value: "contains", label: "содержит" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "empty", label: "пусто" },
  { value: "notEmpty", label: "не пусто" },
];

const TRIGGER_TYPES: { value: AutomationTriggerType; labelKey: string; label: string }[] = [
  { value: "record_created", labelKey: "auto.trig.record_created", label: "Создание записи" },
  { value: "record_updated", labelKey: "auto.trig.record_updated", label: "Изменение записи" },
  { value: "field_changed", labelKey: "auto.trig.field_changed", label: "Изменение поля" },
  { value: "status_changed", labelKey: "auto.trig.status_changed", label: "Смена статуса" },
  { value: "date_reached", labelKey: "auto.trig.date_reached", label: "Наступление даты" },
];

const ACTION_TYPES: { value: AutomationActionType; labelKey: string; label: string }[] = [
  { value: "set_field", labelKey: "auto.act.set_field", label: "Установить поле" },
  { value: "change_status", labelKey: "auto.act.change_status", label: "Сменить статус" },
  { value: "create_record", labelKey: "auto.act.create_record", label: "Создать запись" },
  { value: "update_records_where", labelKey: "auto.act.update_records_where", label: "Обновить записи (по условию)" },
  { value: "webhook", labelKey: "auto.act.webhook", label: "Webhook" },
];

function noValueOp(op: AutomationConditionOperator): boolean {
  return op === "empty" || op === "notEmpty";
}

function emptyAction(defaultFieldKey: string): ActionDraft {
  return {
    type: "set_field",
    fieldKey: defaultFieldKey,
    value: "",
    statusId: "",
    targetEntityId: "",
    mapping: [],
    match: [],
    url: "",
    includeRecord: true,
  };
}

/**
 * Value control for a `relation`/`lookup` condition field. A relation condition
 * compares against the LINKED record's projected value (`relatedFieldKey`) — the
 * same value the records-query relation filter matches on — not a record id. So
 * this offers a searchable dropdown of the available linked values (candidate
 * labels) for the owning entity's relation field, while still letting the admin
 * commit a free-typed value (needed for `contains`/`starts_with`-style matches).
 */
function RelationValueControl({
  entityId,
  fieldKey,
  value,
  onChange,
  t,
}: {
  entityId: number;
  fieldKey: string;
  value: string;
  onChange: (v: string) => void;
  t: (k: string, d: string) => string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<{ id: number; label: string }[]>([]);
  const fetchCandidates = useGetEntityRelatedCandidates().mutateAsync;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const h = setTimeout(() => {
      fetchCandidates({ entityId, data: { fieldKey, q: search.trim() || undefined, ignoreDependency: true } })
        .then((res) => {
          if (!cancelled) setCandidates(res.candidates ?? []);
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [open, search, entityId, fieldKey, fetchCandidates]);

  const labels = [...new Set(candidates.map((c) => c.label).filter((l) => l !== ""))];
  const trimmed = search.trim();
  const showFreeValue = trimmed !== "" && !labels.some((l) => l.toLowerCase() === trimmed.toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="flex-1 justify-between font-normal min-w-0"
        >
          <span className="truncate">{value || t("auto.pickValue", "Выберите значение")}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[260px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t("auto.searchValue", "Поиск значения…")}
          />
          <CommandList>
            <CommandEmpty>{t("auto.noValues", "Значения не найдены")}</CommandEmpty>
            {showFreeValue && (
              <CommandGroup>
                <CommandItem
                  value={`__free__${trimmed}`}
                  onSelect={() => {
                    onChange(trimmed);
                    setOpen(false);
                  }}
                >
                  {t("auto.useTyped", "Использовать")}: «{trimmed}»
                </CommandItem>
              </CommandGroup>
            )}
            {labels.length > 0 && (
              <CommandGroup>
                {labels.map((l) => (
                  <CommandItem
                    key={l}
                    value={l}
                    onSelect={() => {
                      onChange(l);
                      setOpen(false);
                    }}
                  >
                    {l}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function EntityAutomationsPage() {
  const params = useParams();
  const entityId = Number(params.entityId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ml = useML();
  const t = useT();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [toDelete, setToDelete] = useState<Automation | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [nameJson, setNameJson] = useState<MLValue>({});
  const [isActive, setIsActive] = useState(true);
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>("record_created");
  const [trigFieldKey, setTrigFieldKey] = useState("");
  const [trigFrom, setTrigFrom] = useState<string>(ANY);
  const [trigTo, setTrigTo] = useState<string>(ANY);
  const [trigOffset, setTrigOffset] = useState("0");
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [conditionConjunction, setConditionConjunction] = useState<"and" | "or">("and");
  const [actions, setActions] = useState<ActionDraft[]>([]);

  const { data: entities = [] } = useListEntities();
  const entity = entities.find((e: Entity) => e.id === entityId);

  const { data: automations = [], isLoading } = useListEntityAutomations(entityId);
  const { data: statuses = [] } = useListEntityStatuses(entityId);
  const { data: allFields = [] } = useListEntityFields(entityId);
  const { data: userOptions = [] } = useListUserOptions();
  const { data: runs = [] } = useListEntityAutomationRuns(entityId, {
    query: { enabled: historyOpen, queryKey: getListEntityAutomationRunsQueryKey(entityId) },
  });

  const fields = [...allFields]
    .filter((f: Field) => f.isActive)
    .sort((a: Field, b: Field) => a.sortOrder - b.sortOrder);
  const fieldByKey = new Map(fields.map((f: Field) => [f.fieldKey, f]));
  const statusById = new Map(statuses.map((s: Status) => [s.id, s]));
  const dateFields = fields.filter((f: Field) => f.fieldType === "date" || f.fieldType === "datetime");

  // Target entity fields are fetched per-ActionCard; cache them here so the
  // submit handler can coerce literal mapping values + match conditions by the
  // target field's type (server validates real number/boolean, not strings).
  const [targetFieldsCache, setTargetFieldsCache] = useState<Record<number, Field[]>>({});
  const cacheTargetFields = useCallback((eid: number, flds: Field[]) => {
    setTargetFieldsCache((prev) => {
      const existing = prev[eid];
      if (existing && existing.length === flds.length && existing.every((f, i) => f.fieldKey === flds[i].fieldKey && f.fieldType === flds[i].fieldType)) return prev;
      return { ...prev, [eid]: flds };
    });
  }, []);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/automations`] });
  };

  const createMutation = useCreateEntityAutomation({
    mutation: {
      onSuccess: () => { toast({ title: t("auto.created", "Автоматизация создана") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("auto.createError", "Ошибка создания"), description: extractError(err), variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateAutomation({
    mutation: {
      onSuccess: () => { toast({ title: t("auto.updated", "Автоматизация обновлена") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("auto.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteAutomation({
    mutation: {
      onSuccess: () => { toast({ title: t("auto.deleted", "Автоматизация удалена") }); setToDelete(null); invalidate(); },
      onError: () => toast({ title: t("auto.deleteError", "Ошибка удаления"), variant: "destructive" }),
    },
  });
  const reorderMutation = useReorderAutomations({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: t("auto.reorderError", "Ошибка изменения порядка"), variant: "destructive" }),
    },
  });

  const toggleActive = (a: Automation) => {
    updateMutation.mutate({ id: a.id, data: { isActive: !a.isActive } });
  };

  const move = (list: Automation[], index: number, direction: -1 | 1) => {
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
    setTriggerType("record_created");
    setTrigFieldKey(fields[0]?.fieldKey ?? "");
    setTrigFrom(ANY);
    setTrigTo(ANY);
    setTrigOffset("0");
    setConditions([]);
    setConditionConjunction("and");
    setActions([emptyAction(fields[0]?.fieldKey ?? "")]);
    setDialogOpen(true);
  };

  const openEdit = (a: Automation) => {
    setEditing(a);
    const n = a.nameJson;
    setNameJson(typeof n === "object" && n ? { ru: n.ru, en: n.en, he: n.he } : {});
    setIsActive(a.isActive);
    const trig = a.triggerJson;
    setTriggerType(trig.type);
    setTrigFieldKey(trig.fieldKey ?? fields[0]?.fieldKey ?? "");
    setTrigFrom(trig.fromStatusId == null ? ANY : String(trig.fromStatusId));
    setTrigTo(trig.toStatusId == null ? ANY : String(trig.toStatusId));
    setTrigOffset(String(trig.offsetDays ?? 0));
    setConditions((a.conditionsJson ?? []).map((c) => ({ fieldKey: c.fieldKey, operator: c.operator, value: c.value == null ? "" : String(c.value) })));
    setConditionConjunction(a.conditionConjunction === "or" ? "or" : "and");
    setActions((a.actionsJson ?? []).map(actionToDraft));
    setDialogOpen(true);
  };

  const actionToDraft = (a: AutomationAction): ActionDraft => ({
    type: a.type,
    fieldKey: a.fieldKey ?? "",
    value: a.value == null ? "" : String(a.value),
    statusId: a.statusId == null ? "" : String(a.statusId),
    targetEntityId: a.targetEntityId == null ? "" : String(a.targetEntityId),
    mapping: (a.mapping ?? []).map((m) => ({
      targetFieldKey: m.targetFieldKey,
      sourceType: m.sourceType,
      value: m.value == null ? "" : String(m.value),
      sourceFieldKey: m.sourceFieldKey ?? "",
    })),
    match: (a.match ?? []).map((c) => ({ fieldKey: c.fieldKey, operator: c.operator, value: c.value == null ? "" : String(c.value) })),
    url: a.url ?? "",
    includeRecord: a.includeRecord ?? true,
  });

  /** Coerce a string to a field's stored type for conditions/values. */
  const coerce = (key: string, raw: string, fmap: Map<string, Field>, isStatus: boolean): unknown => {
    if (raw === "") return null;
    if (isStatus) return Number(raw);
    const f = fmap.get(key);
    if (!f) return raw;
    switch (f.fieldType) {
      case "number":
      case "user":
        return Number(raw);
      case "boolean":
        return raw === "true";
      default:
        return raw;
    }
  };

  const buildConditions = (list: ConditionDraft[], fmap: Map<string, Field>): AutomationCondition[] =>
    list
      .filter((c) => c.fieldKey)
      .map((c) => {
        const isStatus = c.fieldKey === STATUS_KEY;
        const out: AutomationCondition = { fieldKey: c.fieldKey, operator: c.operator };
        if (!noValueOp(c.operator)) out.value = coerce(c.fieldKey, c.value, fmap, isStatus);
        return out;
      });

  const handleSubmit = () => {
    // Build trigger.
    const trigger: AutomationTrigger = { type: triggerType };
    if (triggerType === "field_changed" || triggerType === "date_reached") {
      if (!trigFieldKey) { toast({ title: t("auto.specifyField", "Укажите поле триггера"), variant: "destructive" }); return; }
      trigger.fieldKey = trigFieldKey;
    }
    if (triggerType === "date_reached") trigger.offsetDays = Number(trigOffset) || 0;
    if (triggerType === "status_changed") {
      trigger.fromStatusId = trigFrom === ANY ? null : Number(trigFrom);
      trigger.toStatusId = trigTo === ANY ? null : Number(trigTo);
    }

    // Build actions.
    const builtActions: AutomationAction[] = [];
    for (const a of actions) {
      if (a.type === "set_field") {
        if (!a.fieldKey) { toast({ title: t("auto.specifyActionField", "Укажите поле действия"), variant: "destructive" }); return; }
        builtActions.push({ type: "set_field", fieldKey: a.fieldKey, value: coerce(a.fieldKey, a.value, fieldByKey, false) });
      } else if (a.type === "change_status") {
        if (!a.statusId) { toast({ title: t("auto.specifyStatus", "Укажите статус"), variant: "destructive" }); return; }
        builtActions.push({ type: "change_status", statusId: Number(a.statusId) });
      } else if (a.type === "create_record" || a.type === "update_records_where") {
        if (!a.targetEntityId) { toast({ title: t("auto.specifyTarget", "Укажите целевую сущность"), variant: "destructive" }); return; }
        const targetId = Number(a.targetEntityId);
        const tMap = new Map((targetFieldsCache[targetId] ?? []).map((f) => [f.fieldKey, f] as const));
        const mapping: AutomationMapping[] = a.mapping
          .filter((m) => m.targetFieldKey)
          .map((m) =>
            m.sourceType === "field"
              ? { targetFieldKey: m.targetFieldKey, sourceType: "field", sourceFieldKey: m.sourceFieldKey }
              : { targetFieldKey: m.targetFieldKey, sourceType: "literal", value: coerce(m.targetFieldKey, m.value, tMap, false) },
          );
        if (a.type === "create_record") {
          const action: AutomationAction = { type: "create_record", targetEntityId: targetId, mapping };
          if (a.statusId) action.statusId = Number(a.statusId);
          builtActions.push(action);
        } else {
          builtActions.push({ type: "update_records_where", targetEntityId: targetId, mapping, match: buildConditions(a.match, tMap) });
        }
      } else if (a.type === "webhook") {
        if (!a.url) { toast({ title: t("auto.specifyUrl", "Укажите URL"), variant: "destructive" }); return; }
        builtActions.push({ type: "webhook", url: a.url, includeRecord: a.includeRecord });
      }
    }
    if (builtActions.length === 0) { toast({ title: t("auto.noActions", "Добавьте хотя бы одно действие"), variant: "destructive" }); return; }

    const payload = {
      nameJson: nameJson as MultilingualText,
      isActive,
      triggerJson: trigger,
      conditionsJson: buildConditions(conditions, fieldByKey),
      conditionConjunction,
      actionsJson: builtActions,
    };
    if (editing) updateMutation.mutate({ id: editing.id, data: payload });
    else createMutation.mutate({ entityId, data: { ...payload, sortOrder: automations.length + 1 } });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const sorted = [...automations].sort((a: Automation, b: Automation) => a.sortOrder - b.sortOrder);

  const triggerLabel = (trig: AutomationTrigger): string => {
    const base = t(TRIGGER_TYPES.find((x) => x.value === trig.type)?.labelKey ?? "", TRIGGER_TYPES.find((x) => x.value === trig.type)?.label ?? trig.type);
    if (trig.type === "field_changed" && trig.fieldKey) return `${base}: ${trig.fieldKey}`;
    if (trig.type === "date_reached" && trig.fieldKey) return `${base}: ${trig.fieldKey}${trig.offsetDays ? ` ${trig.offsetDays > 0 ? "+" : ""}${trig.offsetDays}д` : ""}`;
    if (trig.type === "status_changed") {
      const f = trig.fromStatusId == null ? "*" : ml(statusById.get(trig.fromStatusId)?.nameJson) || `#${trig.fromStatusId}`;
      const to = trig.toStatusId == null ? "*" : ml(statusById.get(trig.toStatusId)?.nameJson) || `#${trig.toStatusId}`;
      return `${base}: ${f} → ${to}`;
    }
    return base;
  };

  const actionSummary = (a: AutomationAction): string => {
    const base = t(ACTION_TYPES.find((x) => x.value === a.type)?.labelKey ?? "", ACTION_TYPES.find((x) => x.value === a.type)?.label ?? a.type);
    if (a.type === "set_field") return `${base} ${a.fieldKey}`;
    if (a.type === "change_status") return `${base} → ${ml(statusById.get(a.statusId ?? -1)?.nameJson) || `#${a.statusId}`}`;
    if (a.type === "create_record" || a.type === "update_records_where") {
      const te = entities.find((e: Entity) => e.id === a.targetEntityId);
      return `${base} → ${te ? ml(te.nameJson) : `#${a.targetEntityId}`}`;
    }
    if (a.type === "webhook") return `${base}`;
    return base;
  };

  /** Render a type-aware value control shared by conditions and set_field. */
  const ValueControl = ({
    fieldKey,
    raw,
    onChange,
    fmap,
    sts,
    statusKey,
    ownerEntityId,
  }: {
    fieldKey: string;
    raw: string;
    onChange: (v: string) => void;
    fmap: Map<string, Field>;
    sts: Status[];
    statusKey: boolean;
    ownerEntityId?: number;
  }): ReactElement => {
    const ph = t("auto.valuePlaceholder", "значение");
    if (statusKey) {
      return (
        <Select value={raw || ""} onValueChange={onChange}>
          <SelectTrigger className="flex-1"><SelectValue placeholder={t("auto.status", "Статус")} /></SelectTrigger>
          <SelectContent>
            {sts.map((s) => (<SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>))}
          </SelectContent>
        </Select>
      );
    }
    const f = fmap.get(fieldKey);
    const type = f?.fieldType;
    if ((type === "relation" || type === "lookup") && ownerEntityId) {
      return <RelationValueControl entityId={ownerEntityId} fieldKey={fieldKey} value={raw} onChange={onChange} t={t} />;
    }
    if (type === "select") {
      const options = Array.isArray(f?.optionsJson) ? (f!.optionsJson as string[]) : [];
      return (
        <Select value={raw || ""} onValueChange={onChange}>
          <SelectTrigger className="flex-1"><SelectValue placeholder={ph} /></SelectTrigger>
          <SelectContent>{options.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}</SelectContent>
        </Select>
      );
    }
    if (type === "boolean") {
      return (
        <Select value={raw || ""} onValueChange={onChange}>
          <SelectTrigger className="flex-1"><SelectValue placeholder={ph} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="true">{t("auto.yes", "Да")}</SelectItem>
            <SelectItem value="false">{t("auto.no", "Нет")}</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    if (type === "user") {
      const allowedUsers = f ? filterUserOptionsByRoles(f, userOptions) : userOptions;
      return (
        <Select value={raw || ""} onValueChange={onChange}>
          <SelectTrigger className="flex-1"><SelectValue placeholder={t("auto.selectUser", "Пользователь")} /></SelectTrigger>
          <SelectContent>{allowedUsers.map((u: UserOption) => (<SelectItem key={u.id} value={String(u.id)}>{u.name || `#${u.id}`}</SelectItem>))}</SelectContent>
        </Select>
      );
    }
    if (type === "number") return <Input type="number" className="flex-1" value={raw} onChange={(e) => onChange(e.target.value)} placeholder={ph} />;
    if (type === "date") return <Input type="date" className="flex-1" value={raw} onChange={(e) => onChange(e.target.value)} />;
    if (type === "datetime") return <Input type="datetime-local" className="flex-1" value={raw} onChange={(e) => onChange(e.target.value)} />;
    return <Input className="flex-1" value={raw} onChange={(e) => onChange(e.target.value)} placeholder={ph} />;
  };

  /** Conditions editor (used for top-level conditions and update-match). */
  const ConditionsEditor = ({
    list,
    onChange,
    fopts,
    fmap,
    sts,
    allowStatus,
    conjunction,
    onConjunctionChange,
    ownerEntityId,
  }: {
    list: ConditionDraft[];
    onChange: (next: ConditionDraft[]) => void;
    fopts: Field[];
    fmap: Map<string, Field>;
    sts: Status[];
    allowStatus: boolean;
    conjunction?: "and" | "or";
    onConjunctionChange?: (next: "and" | "or") => void;
    ownerEntityId?: number;
  }): ReactElement => {
    const upd = (i: number, patch: Partial<ConditionDraft>) => onChange(list.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
    const add = () => onChange([...list, { fieldKey: allowStatus ? STATUS_KEY : fopts[0]?.fieldKey ?? "", operator: "eq", value: "" }]);
    const rm = (i: number) => onChange(list.filter((_, idx) => idx !== i));
    return (
      <div className="space-y-2">
        {onConjunctionChange && list.length > 1 && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>{t("auto.matchLabel", "Срабатывает, когда выполняется")}</span>
            <Select value={conjunction ?? "and"} onValueChange={(v) => onConjunctionChange(v as "and" | "or")}>
              <SelectTrigger className="h-7 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="and">{t("auto.matchAll", "все условия (И)")}</SelectItem>
                <SelectItem value="or">{t("auto.matchAny", "любое условие (ИЛИ)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {list.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Select value={c.fieldKey} onValueChange={(v) => upd(i, { fieldKey: v, value: "" })}>
              <SelectTrigger className="w-40"><SelectValue placeholder={t("auto.field", "Поле")} /></SelectTrigger>
              <SelectContent>
                {allowStatus && <SelectItem value={STATUS_KEY}>{t("auto.recordStatus", "Статус записи")}</SelectItem>}
                {fopts.map((f) => (<SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={c.operator} onValueChange={(v) => upd(i, { operator: v as AutomationConditionOperator })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{OPERATORS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent>
            </Select>
            {!noValueOp(c.operator) && (
              <ValueControl fieldKey={c.fieldKey} raw={c.value} onChange={(v) => upd(i, { value: v })} fmap={fmap} sts={sts} statusKey={c.fieldKey === STATUS_KEY} ownerEntityId={ownerEntityId} />
            )}
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-400 shrink-0" onClick={() => rm(i)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add}>
          <Plus className="w-3.5 h-3.5" />{t("auto.addCondition", "Добавить условие")}
        </Button>
      </div>
    );
  };

  const setAction = (i: number, patch: Partial<ActionDraft>) => setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const removeAction = (i: number) => setActions((prev) => prev.filter((_, idx) => idx !== i));
  const addAction = () => setActions((prev) => [...prev, emptyAction(fields[0]?.fieldKey ?? "")]);
  const moveAction = (i: number, dir: -1 | 1) => {
    const tgt = i + dir;
    if (tgt < 0 || tgt >= actions.length) return;
    setActions((prev) => {
      const next = [...prev];
      const tmp = next[i];
      next[i] = next[tgt];
      next[tgt] = tmp;
      return next;
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          onClick={() => { if (window.history.length > 1) window.history.back(); else navigate("/admin/entities"); }}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("auto.backToEntities", "К списку сущностей")}
        </button>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Zap className="w-6 h-6 text-blue-600" />
              {t("auto.title", "Автоматизации")}{entity ? `: ${ml(entity.nameJson)}` : ""}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {t("auto.subtitle", "Триггер → условия → действия. Действия выполняются от имени системы и могут менять статус в обход «Процессов».")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setHistoryOpen(true)}>
              <History className="w-4 h-4" />{t("auto.history", "История")}
            </Button>
            <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
              <Plus className="w-4 h-4" />{t("auto.add", "Добавить автоматизацию")}
            </Button>
          </div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => (<Skeleton key={i} className="h-12 w-full" />))}</div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-16 text-slate-400">{t("auto.empty", "Автоматизаций пока нет.")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("auto.colName", "Название")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("auto.colTrigger", "Триггер")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("auto.colActions", "Действия")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("auto.colActive", "Активна")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((a: Automation, idx: number) => (
                  <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700 font-medium">{ml(a.nameJson) || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{triggerLabel(a.triggerJson)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {(a.actionsJson?.length ?? 0) === 0 ? <span className="text-slate-300">—</span> : a.actionsJson.map(actionSummary).join("; ")}
                    </td>
                    <td className="px-4 py-3">
                      <Switch checked={a.isActive} onCheckedChange={() => toggleActive(a)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={idx === 0 || reorderMutation.isPending} onClick={() => move(sorted, idx, -1)}>
                          <ChevronUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={idx === sorted.length - 1 || reorderMutation.isPending} onClick={() => move(sorted, idx, 1)}>
                          <ChevronDown className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(a)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setToDelete(a)}>
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
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("auto.edit", "Редактировать автоматизацию") : t("auto.new", "Новая автоматизация")}</DialogTitle>
            <DialogDescription>{t("auto.dialogDesc", "Когда срабатывает триггер и выполняются условия — по порядку запускаются действия.")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <MultilingualInput label={t("auto.nameOptional", "Название (необязательно)")} value={nameJson} onChange={setNameJson} />

            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>{t("auto.activeLabel", "Активна")}</Label>
            </div>

            {/* Trigger */}
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <Label className="text-sm font-semibold">{t("auto.trigger", "Триггер")}</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                <Select value={triggerType} onValueChange={(v) => setTriggerType(v as AutomationTriggerType)}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>{TRIGGER_TYPES.map((tt) => (<SelectItem key={tt.value} value={tt.value}>{t(tt.labelKey, tt.label)}</SelectItem>))}</SelectContent>
                </Select>
                {(triggerType === "field_changed" || triggerType === "date_reached") && (
                  <Select value={trigFieldKey} onValueChange={setTrigFieldKey}>
                    <SelectTrigger className="w-44"><SelectValue placeholder={t("auto.field", "Поле")} /></SelectTrigger>
                    <SelectContent>
                      {(triggerType === "date_reached" ? dateFields : fields).map((f) => (<SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>))}
                    </SelectContent>
                  </Select>
                )}
                {triggerType === "date_reached" && (
                  <div className="flex items-center gap-1.5">
                    <Input type="number" className="w-20" value={trigOffset} onChange={(e) => setTrigOffset(e.target.value)} />
                    <span className="text-xs text-slate-500">{t("auto.offsetDays", "дней (− до / + после)")}</span>
                  </div>
                )}
                {triggerType === "status_changed" && (
                  <>
                    <Select value={trigFrom} onValueChange={setTrigFrom}>
                      <SelectTrigger className="w-36"><SelectValue placeholder={t("auto.fromStatus", "Из статуса")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY}>{t("auto.anyStatus", "Любой")}</SelectItem>
                        {statuses.map((s: Status) => (<SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <span className="text-slate-400">→</span>
                    <Select value={trigTo} onValueChange={setTrigTo}>
                      <SelectTrigger className="w-36"><SelectValue placeholder={t("auto.toStatus", "В статус")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY}>{t("auto.anyStatus", "Любой")}</SelectItem>
                        {statuses.map((s: Status) => (<SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>
            </div>

            {/* Conditions */}
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <Label className="text-sm font-semibold">{t("auto.conditions", "Условия")}</Label>
              <ConditionsEditor list={conditions} onChange={setConditions} fopts={fields} fmap={fieldByKey} sts={statuses} allowStatus conjunction={conditionConjunction} onConjunctionChange={setConditionConjunction} ownerEntityId={entityId} />
            </div>

            {/* Actions */}
            <div className="space-y-3 rounded-md border border-slate-200 p-3">
              <Label className="text-sm font-semibold">{t("auto.actions", "Действия (по порядку)")}</Label>
              {actions.map((a, i) => (
                <ActionCard
                  key={i}
                  index={i}
                  total={actions.length}
                  draft={a}
                  currentFields={fields}
                  currentFieldByKey={fieldByKey}
                  currentStatuses={statuses}
                  entities={entities}
                  ml={ml}
                  t={t}
                  ValueControl={ValueControl}
                  ConditionsEditor={ConditionsEditor}
                  onChange={(patch) => setAction(i, patch)}
                  onRemove={() => removeAction(i)}
                  onMove={(dir) => moveAction(i, dir)}
                  onTargetFieldsLoaded={cacheTargetFields}
                />
              ))}
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addAction}>
                <Plus className="w-3.5 h-3.5" />{t("auto.addAction", "Добавить действие")}
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

      {/* Run history */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("auto.historyTitle", "История запусков")}</DialogTitle>
            <DialogDescription>{t("auto.historyDesc", "Последние запуски автоматизаций этой сущности.")}</DialogDescription>
          </DialogHeader>
          {runs.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">{t("auto.noRuns", "Запусков пока нет.")}</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left py-2 px-2">{t("auto.runTime", "Время")}</th>
                  <th className="text-left py-2 px-2">{t("auto.runAuto", "Автоматизация")}</th>
                  <th className="text-left py-2 px-2">{t("auto.runTrigger", "Триггер")}</th>
                  <th className="text-left py-2 px-2">{t("auto.runRecord", "Запись")}</th>
                  <th className="text-left py-2 px-2">{t("auto.runStatus", "Статус")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const a = automations.find((x: Automation) => x.id === r.automationId);
                  return (
                    <tr key={r.id} className="border-b border-slate-50">
                      <td className="py-1.5 px-2 text-slate-500">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="py-1.5 px-2 text-slate-700">{a ? ml(a.nameJson) || `#${r.automationId}` : `#${r.automationId}`}</td>
                      <td className="py-1.5 px-2 text-slate-500">{r.triggerName ?? "—"}</td>
                      <td className="py-1.5 px-2 text-slate-500">{r.recordId == null ? "—" : `#${r.recordId}`}</td>
                      <td className="py-1.5 px-2">
                        <RunStatusBadge status={r.status} t={t} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("auto.deleteTitle", "Удалить автоматизацию?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("auto.deleteDesc", "Действие необратимо.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => toDelete && deleteMutation.mutate({ id: toDelete.id })}
            >
              {t("common.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RunStatusBadge({ status, t }: { status: string; t: (k: string, d: string) => string }): ReactElement {
  if (status === "success") return <Badge className="bg-green-100 text-green-700 gap-1"><CheckCircle2 className="w-3 h-3" />{t("auto.success", "Успешно")}</Badge>;
  if (status === "error") return <Badge className="bg-red-100 text-red-700 gap-1"><XCircle className="w-3 h-3" />{t("auto.error", "Ошибка")}</Badge>;
  return <Badge className="bg-slate-100 text-slate-600 gap-1"><MinusCircle className="w-3 h-3" />{t("auto.skipped", "Пропущено")}</Badge>;
}

type ValueControlComp = (props: {
  fieldKey: string;
  raw: string;
  onChange: (v: string) => void;
  fmap: Map<string, Field>;
  sts: Status[];
  statusKey: boolean;
  ownerEntityId?: number;
}) => ReactElement;

type ConditionsEditorComp = (props: {
  list: ConditionDraft[];
  onChange: (next: ConditionDraft[]) => void;
  fopts: Field[];
  fmap: Map<string, Field>;
  sts: Status[];
  allowStatus: boolean;
  conjunction?: "and" | "or";
  onConjunctionChange?: (next: "and" | "or") => void;
  ownerEntityId?: number;
}) => ReactElement;

/**
 * One action editor card. Rendered once per action so cross-entity hooks
 * (target entity fields/statuses) keep a stable order. Mapping and match
 * editors operate against the action's target entity.
 */
function ActionCard({
  index,
  total,
  draft,
  currentFields,
  currentFieldByKey,
  currentStatuses,
  entities,
  ml,
  t,
  ValueControl,
  ConditionsEditor,
  onChange,
  onRemove,
  onMove,
  onTargetFieldsLoaded,
}: {
  index: number;
  total: number;
  draft: ActionDraft;
  currentFields: Field[];
  currentFieldByKey: Map<string, Field>;
  currentStatuses: Status[];
  entities: Entity[];
  ml: (val: MultilingualText | string | undefined | null) => string;
  t: (k: string, d: string) => string;
  ValueControl: ValueControlComp;
  ConditionsEditor: ConditionsEditorComp;
  onChange: (patch: Partial<ActionDraft>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onTargetFieldsLoaded: (entityId: number, fields: Field[]) => void;
}): ReactElement {
  const targetId = draft.targetEntityId ? Number(draft.targetEntityId) : 0;
  const crossEntity = draft.type === "create_record" || draft.type === "update_records_where";
  const { data: targetFieldsRaw = [] } = useListEntityFields(targetId, { query: { enabled: crossEntity && targetId > 0, queryKey: getListEntityFieldsQueryKey(targetId) } });
  const { data: targetStatuses = [] } = useListEntityStatuses(targetId, { query: { enabled: draft.type === "create_record" && targetId > 0, queryKey: getListEntityStatusesQueryKey(targetId) } });
  const targetFields = [...targetFieldsRaw].filter((f: Field) => f.isActive).sort((a: Field, b: Field) => a.sortOrder - b.sortOrder);
  const targetFieldByKey = new Map(targetFields.map((f: Field) => [f.fieldKey, f]));
  const targetFieldsKey = targetFields.map((f: Field) => `${f.fieldKey}:${f.fieldType}`).join(",");

  useEffect(() => {
    if (targetId > 0 && targetFields.length > 0) onTargetFieldsLoaded(targetId, targetFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, targetFieldsKey, onTargetFieldsLoaded]);

  const updMapping = (i: number, patch: Partial<MappingDraft>) => onChange({ mapping: draft.mapping.map((m, idx) => (idx === i ? { ...m, ...patch } : m)) });
  const addMapping = () => onChange({ mapping: [...draft.mapping, { targetFieldKey: targetFields[0]?.fieldKey ?? "", sourceType: "literal", value: "", sourceFieldKey: currentFields[0]?.fieldKey ?? "" }] });
  const rmMapping = (i: number) => onChange({ mapping: draft.mapping.filter((_, idx) => idx !== i) });

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/50 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono text-slate-400 w-5">{index + 1}.</span>
        <Select value={draft.type} onValueChange={(v) => onChange({ type: v as AutomationActionType })}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>{ACTION_TYPES.map((at) => (<SelectItem key={at.value} value={at.value}>{t(at.labelKey, at.label)}</SelectItem>))}</SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-slate-400" disabled={index === 0} onClick={() => onMove(-1)}><ChevronUp className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-slate-400" disabled={index === total - 1} onClick={() => onMove(1)}><ChevronDown className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={onRemove}><Trash2 className="w-3.5 h-3.5" /></Button>
        </div>
      </div>

      {draft.type === "set_field" && (
        <div className="flex items-center gap-1.5 pl-7">
          <Select value={draft.fieldKey} onValueChange={(v) => onChange({ fieldKey: v, value: "" })}>
            <SelectTrigger className="w-44"><SelectValue placeholder={t("auto.field", "Поле")} /></SelectTrigger>
            <SelectContent>{currentFields.map((f) => (<SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>))}</SelectContent>
          </Select>
          <span className="text-slate-400">=</span>
          <ValueControl fieldKey={draft.fieldKey} raw={draft.value} onChange={(v) => onChange({ value: v })} fmap={currentFieldByKey} sts={currentStatuses} statusKey={false} />
        </div>
      )}

      {draft.type === "change_status" && (
        <div className="flex items-center gap-1.5 pl-7">
          <span className="text-xs text-slate-500">{t("auto.toStatus", "В статус")}</span>
          <Select value={draft.statusId} onValueChange={(v) => onChange({ statusId: v })}>
            <SelectTrigger className="w-44"><SelectValue placeholder={t("auto.status", "Статус")} /></SelectTrigger>
            <SelectContent>{currentStatuses.map((s) => (<SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>))}</SelectContent>
          </Select>
        </div>
      )}

      {crossEntity && (
        <div className="space-y-2 pl-7">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">{t("auto.targetEntity", "Сущность")}</span>
            <Select value={draft.targetEntityId} onValueChange={(v) => onChange({ targetEntityId: v, mapping: [], match: [] })}>
              <SelectTrigger className="w-52"><SelectValue placeholder={t("auto.selectEntity", "Выберите сущность")} /></SelectTrigger>
              <SelectContent>{entities.map((e) => (<SelectItem key={e.id} value={String(e.id)}>{ml(e.nameJson)}</SelectItem>))}</SelectContent>
            </Select>
            {draft.type === "create_record" && targetId > 0 && (
              <>
                <span className="text-xs text-slate-500">{t("auto.statusOptional", "статус")}</span>
                <Select value={draft.statusId || ANY} onValueChange={(v) => onChange({ statusId: v === ANY ? "" : v })}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>{t("auto.defaultStatus", "По умолчанию")}</SelectItem>
                    {targetStatuses.map((s: Status) => (<SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          {draft.type === "update_records_where" && targetId > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">{t("auto.matchConditions", "Условия выбора записей")}</Label>
              <ConditionsEditor list={draft.match} onChange={(next) => onChange({ match: next })} fopts={targetFields} fmap={targetFieldByKey} sts={targetStatuses} allowStatus ownerEntityId={targetId} />
            </div>
          )}

          {targetId > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">{t("auto.fieldMapping", "Значения полей")}</Label>
              {draft.mapping.map((m, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Select value={m.targetFieldKey} onValueChange={(v) => updMapping(i, { targetFieldKey: v })}>
                    <SelectTrigger className="w-40"><SelectValue placeholder={t("auto.targetField", "Поле")} /></SelectTrigger>
                    <SelectContent>{targetFields.map((f) => (<SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>))}</SelectContent>
                  </Select>
                  <span className="text-slate-400">=</span>
                  <Select value={m.sourceType} onValueChange={(v) => updMapping(i, { sourceType: v as "literal" | "field" })}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="literal">{t("auto.literal", "Значение")}</SelectItem>
                      <SelectItem value="field">{t("auto.fromField", "Из поля")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {m.sourceType === "field" ? (
                    <Select value={m.sourceFieldKey} onValueChange={(v) => updMapping(i, { sourceFieldKey: v })}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder={t("auto.sourceField", "Поле-источник")} /></SelectTrigger>
                      <SelectContent>{currentFields.map((f) => (<SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>))}</SelectContent>
                    </Select>
                  ) : (
                    <ValueControl fieldKey={m.targetFieldKey} raw={m.value} onChange={(v) => updMapping(i, { value: v })} fmap={targetFieldByKey} sts={targetStatuses} statusKey={false} />
                  )}
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-400 shrink-0" onClick={() => rmMapping(i)}><X className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addMapping}><Plus className="w-3.5 h-3.5" />{t("auto.addMapping", "Добавить поле")}</Button>
            </div>
          )}
        </div>
      )}

      {draft.type === "webhook" && (
        <div className="space-y-2 pl-7">
          <Input value={draft.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://example.com/hook" />
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <Checkbox checked={draft.includeRecord} onCheckedChange={(v) => onChange({ includeRecord: v === true })} />
            {t("auto.includeRecord", "Передавать данные записи")}
          </label>
        </div>
      )}
    </div>
  );
}
