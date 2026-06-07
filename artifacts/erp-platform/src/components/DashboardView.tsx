import { useState } from "react";
import {
  useGetDashboardData,
  useListDashboardWidgets,
  useCreateDashboardWidget,
  useUpdateDashboardWidget,
  useDeleteDashboardWidget,
  useReorderDashboardWidgets,
  getListDashboardWidgetsQueryKey,
  getListEntityFieldsQueryKey,
  getListEntityStatusesQueryKey,
  useListEntities,
  useListEntityFields,
  useListEntityStatuses,
  useListRoles,
  type DashboardWidget,
  type DashboardWidgetData,
  type WidgetMetric,
  type WidgetConfigFormat,
  type Entity,
  type Field,
  type Status,
  type Role,
  type MultilingualText,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultilingualInput } from "@/components/MultilingualInput";
import { IconPicker } from "@/components/IconPicker";
import { getIconComponent } from "@/lib/icons";
import { evaluateFormula } from "@/lib/formula";
import { useAuth } from "@/lib/auth";
import { useML, useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Settings2, Plus, Pencil, Trash2, Loader2, ChevronUp, ChevronDown, X, LayoutDashboard } from "lucide-react";

type MLValue = { ru?: string; en?: string; he?: string };

const COLOR_PRESETS = [
  "bg-blue-600",
  "bg-violet-600",
  "bg-emerald-600",
  "bg-amber-500",
  "bg-red-500",
  "bg-cyan-600",
  "bg-pink-600",
  "bg-slate-600",
];

const DEFAULT_COLOR = "bg-blue-600";
const DEFAULT_ICON = "TrendingUp";

/** Format a computed value for display per the widget's chosen format. */
function formatValue(value: number, format: string | null | undefined): string {
  if (!Number.isFinite(value)) return "—";
  if (format === "currency") {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(value);
  }
  if (format === "percent") {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)}%`;
  }
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

/**
 * Resolve a widget's primary display value. If a formula is set it is evaluated
 * client-side against the server-computed metric values (referenced as {key});
 * otherwise the first metric's value is shown.
 */
function resolveValue(w: DashboardWidgetData): number {
  const metrics = w.metrics ?? {};
  if (w.formula && w.formula.trim()) {
    try {
      const result = evaluateFormula(w.formula, metrics);
      return typeof result === "number" ? result : Number(result) || 0;
    } catch {
      return NaN;
    }
  }
  const keys = Object.keys(metrics);
  return keys.length > 0 ? metrics[keys[0]] : 0;
}

function WidgetCard({ w, ml }: { w: DashboardWidgetData; ml: (v: unknown) => string }) {
  const Icon = getIconComponent(w.icon || DEFAULT_ICON, LayoutDashboard);
  const value = resolveValue(w);
  return (
    <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500 truncate">{ml(w.titleJson)}</p>
            <p className="text-3xl font-bold text-slate-800 mt-1">{formatValue(value, w.format)}</p>
          </div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${w.color || DEFAULT_COLOR}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardView({ pageId }: { pageId: number }) {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canAdmin } = useAuth();
  const isEditor = canAdmin("pages");

  const [editMode, setEditMode] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(null);
  const [deleteWidget, setDeleteWidget] = useState<DashboardWidget | null>(null);

  const { data: widgetData = [], isLoading } = useGetDashboardData(pageId);
  const { data: editWidgets = [] } = useListDashboardWidgets(pageId, {
    query: { enabled: isEditor && editMode, queryKey: getListDashboardWidgetsQueryKey(pageId) },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      predicate: (q) => JSON.stringify(q.queryKey).includes("/dashboard/"),
    });

  const createMutation = useCreateDashboardWidget({
    mutation: {
      onSuccess: () => { toast({ title: t("dash.created", "Виджет создан") }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: t("dash.saveError", "Ошибка сохранения виджета"), variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateDashboardWidget({
    mutation: {
      onSuccess: () => { toast({ title: t("dash.updated", "Виджет обновлён") }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: t("dash.saveError", "Ошибка сохранения виджета"), variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteDashboardWidget({
    mutation: {
      onSuccess: () => { toast({ title: t("dash.deleted", "Виджет удалён") }); setDeleteWidget(null); invalidate(); },
    },
  });
  const reorderMutation = useReorderDashboardWidgets({
    mutation: { onSuccess: () => invalidate() },
  });

  const sortedEdit = [...editWidgets].sort((a, b) => a.sortOrder - b.sortOrder);
  const sortedData = [...widgetData].sort((a, b) => a.sortOrder - b.sortOrder);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sortedEdit.length) return;
    const a = sortedEdit[index];
    const b = sortedEdit[target];
    reorderMutation.mutate({
      data: { items: [{ id: a.id, sortOrder: b.sortOrder }, { id: b.id, sortOrder: a.sortOrder }] },
    });
  };

  const openCreate = () => { setEditingWidget(null); setDialogOpen(true); };
  const openEdit = (w: DashboardWidget) => { setEditingWidget(w); setDialogOpen(true); };

  return (
    <div className="space-y-4">
      {isEditor && (
        <div className="flex items-center justify-end gap-2">
          {editMode && (
            <Button onClick={openCreate} size="sm" className="bg-blue-600 hover:bg-blue-700 gap-2">
              <Plus className="w-4 h-4" />
              {t("dash.addWidget", "Добавить виджет")}
            </Button>
          )}
          <Button
            onClick={() => setEditMode((v) => !v)}
            size="sm"
            variant={editMode ? "default" : "outline"}
            className="gap-2"
          >
            <Settings2 className="w-4 h-4" />
            {editMode ? t("dash.done", "Готово") : t("dash.configure", "Настроить")}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : editMode ? (
        sortedEdit.length === 0 ? (
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="text-center py-16 text-slate-400">
              {t("dash.empty", "Виджеты ещё не добавлены")}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {sortedEdit.map((w, i) => {
              const Icon = getIconComponent(w.icon || DEFAULT_ICON, LayoutDashboard);
              return (
                <Card key={w.id} className="border-slate-200 shadow-sm">
                  <CardContent className="flex items-center gap-3 p-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${w.color || DEFAULT_COLOR}`}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-700 truncate">{ml(w.titleJson)}</p>
                      <p className="text-xs text-slate-400">
                        {t("dash.metricsCount", "Метрик")}: {w.config.metrics.length}
                        {w.config.formula ? ` · ${t("dash.hasFormula", "формула")}` : ""}
                        {w.visibleRoleIds && w.visibleRoleIds.length > 0 ? ` · ${t("dash.roleLimited", "ограничено ролями")}` : ""}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={i === 0 || reorderMutation.isPending} onClick={() => move(i, -1)}>
                      <ChevronUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={i === sortedEdit.length - 1 || reorderMutation.isPending} onClick={() => move(i, 1)}>
                      <ChevronDown className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(w)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeleteWidget(w)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      ) : sortedData.length === 0 ? (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="text-center py-16 text-slate-400">
            {t("dash.emptyViewer", "На этой панели пока нет виджетов")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedData.map((w) => <WidgetCard key={w.id} w={w} ml={ml} />)}
        </div>
      )}

      {dialogOpen && (
        <WidgetEditorDialog
          pageId={pageId}
          widget={editingWidget}
          nextSortOrder={sortedEdit.length + 1}
          onClose={() => setDialogOpen(false)}
          onCreate={(data) => createMutation.mutate({ id: pageId, data })}
          onUpdate={(wid, data) => updateMutation.mutate({ wid, data })}
          isPending={createMutation.isPending || updateMutation.isPending}
          ml={ml}
          t={t}
        />
      )}

      <AlertDialog open={!!deleteWidget} onOpenChange={(o) => !o && setDeleteWidget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dash.deleteTitle", "Удалить виджет?")}</AlertDialogTitle>
            <AlertDialogDescription>
              "{ml(deleteWidget?.titleJson)}" {t("dash.deleteConfirm", "будет удалён безвозвратно.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("dash.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteWidget && deleteMutation.mutate({ wid: deleteWidget.id })}>
              {t("dash.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type DraftMetric = {
  key: string;
  entityId: number | null;
  aggregation: "count" | "sum";
  fieldKey: string | null;
  statusIds: number[];
};

function WidgetEditorDialog({
  pageId: _pageId,
  widget,
  nextSortOrder,
  onClose,
  onCreate,
  onUpdate,
  isPending,
  ml,
  t,
}: {
  pageId: number;
  widget: DashboardWidget | null;
  nextSortOrder: number;
  onClose: () => void;
  onCreate: (data: { titleJson: MultilingualText; config: { metrics: WidgetMetric[]; formula?: string | null; format?: WidgetConfigFormat }; visibleRoleIds?: number[] | null; icon?: string; color?: string; sortOrder?: number }) => void;
  onUpdate: (wid: number, data: { titleJson: MultilingualText; config: { metrics: WidgetMetric[]; formula?: string | null; format?: WidgetConfigFormat }; visibleRoleIds?: number[] | null; icon?: string; color?: string; sortOrder?: number }) => void;
  isPending: boolean;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
}) {
  const { toast } = useToast();
  const { data: entities = [] } = useListEntities();
  const { data: roles = [] } = useListRoles();

  const [titleJson, setTitleJson] = useState<MLValue>(() => {
    const tj = widget?.titleJson;
    return typeof tj === "object" && tj ? { ru: tj.ru, en: tj.en, he: tj.he } : {};
  });
  const [icon, setIcon] = useState(widget?.icon || DEFAULT_ICON);
  const [color, setColor] = useState(widget?.color || DEFAULT_COLOR);
  const [format, setFormat] = useState<string>(widget?.config.format || "number");
  const [formula, setFormula] = useState(widget?.config.formula || "");
  const [restrictRoles, setRestrictRoles] = useState<boolean>(
    !!(widget?.visibleRoleIds && widget.visibleRoleIds.length > 0),
  );
  const [visibleRoleIds, setVisibleRoleIds] = useState<number[]>(widget?.visibleRoleIds ?? []);
  const [metrics, setMetrics] = useState<DraftMetric[]>(() =>
    widget
      ? widget.config.metrics.map((m) => ({
          key: m.key,
          entityId: m.entityId,
          aggregation: m.aggregation,
          fieldKey: m.fieldKey ?? null,
          statusIds: m.statusIds ?? [],
        }))
      : [{ key: "m1", entityId: null, aggregation: "count", fieldKey: null, statusIds: [] }],
  );

  const updateMetric = (i: number, patch: Partial<DraftMetric>) =>
    setMetrics((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const addMetric = () =>
    setMetrics((prev) => [...prev, { key: `m${prev.length + 1}`, entityId: null, aggregation: "count", fieldKey: null, statusIds: [] }]);

  const removeMetric = (i: number) => setMetrics((prev) => prev.filter((_, idx) => idx !== i));

  const toggleRole = (roleId: number) =>
    setVisibleRoleIds((prev) => (prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]));

  const handleSubmit = () => {
    const keys = new Set<string>();
    for (const m of metrics) {
      if (!m.key || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(m.key)) {
        toast({ title: t("dash.invalidKey", "Некорректный ключ метрики (латиница/цифры/_)"), variant: "destructive" });
        return;
      }
      if (keys.has(m.key)) {
        toast({ title: t("dash.dupKey", "Ключи метрик должны быть уникальны"), variant: "destructive" });
        return;
      }
      keys.add(m.key);
      if (m.entityId == null) {
        toast({ title: t("dash.metricNeedsEntity", "Выберите сущность для каждой метрики"), variant: "destructive" });
        return;
      }
      if (m.aggregation === "sum" && !m.fieldKey) {
        toast({ title: t("dash.metricNeedsField", "Для суммы выберите числовое поле"), variant: "destructive" });
        return;
      }
    }
    const config = {
      metrics: metrics.map<WidgetMetric>((m) => ({
        key: m.key,
        entityId: m.entityId as number,
        aggregation: m.aggregation,
        fieldKey: m.aggregation === "sum" ? m.fieldKey : null,
        statusIds: m.statusIds.length > 0 ? m.statusIds : null,
      })),
      formula: formula.trim() ? formula.trim() : null,
      format: format as WidgetConfigFormat,
    };
    const data = {
      titleJson: titleJson as MultilingualText,
      config,
      visibleRoleIds: restrictRoles && visibleRoleIds.length > 0 ? visibleRoleIds : null,
      icon,
      color,
      sortOrder: widget?.sortOrder ?? nextSortOrder,
    };
    if (widget) onUpdate(widget.id, data);
    else onCreate(data);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{widget ? t("dash.editWidget", "Редактировать виджет") : t("dash.newWidget", "Новый виджет")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <MultilingualInput label={t("dash.widgetTitle", "Заголовок")} value={titleJson} onChange={setTitleJson} required />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("dash.icon", "Иконка")}</Label>
              <IconPicker value={icon} onChange={setIcon} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("dash.format", "Формат")}</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">{t("dash.formatNumber", "Число")}</SelectItem>
                  <SelectItem value="currency">{t("dash.formatCurrency", "Валюта")}</SelectItem>
                  <SelectItem value="percent">{t("dash.formatPercent", "Процент")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("dash.color", "Цвет")}</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-lg ${c} ${color === c ? "ring-2 ring-offset-2 ring-slate-800" : ""}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <Label>{t("dash.metrics", "Метрики")}</Label>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addMetric}>
                <Plus className="w-3.5 h-3.5" />
                {t("dash.addMetric", "Метрика")}
              </Button>
            </div>
            {metrics.map((m, i) => (
              <MetricEditor
                key={i}
                metric={m}
                index={i}
                entities={entities}
                canRemove={metrics.length > 1}
                onChange={(patch) => updateMetric(i, patch)}
                onRemove={() => removeMetric(i)}
                ml={ml}
                t={t}
              />
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>{t("dash.formula", "Формула (необязательно)")}</Label>
            <Input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="{m1} / {m2} * 100" />
            <p className="text-xs text-slate-400">
              {t("dash.formulaHint", "Комбинируйте метрики по ключу: {m1}. Без формулы показывается первая метрика.")}
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="flex items-center gap-2">
              <Checkbox id="restrict-roles" checked={restrictRoles} onCheckedChange={(c) => setRestrictRoles(!!c)} />
              <Label htmlFor="restrict-roles">{t("dash.restrictRoles", "Ограничить видимость по ролям")}</Label>
            </div>
            {restrictRoles ? (
              <div className="space-y-1.5">
                {roles.map((r: Role) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={visibleRoleIds.includes(r.id)} onCheckedChange={() => toggleRole(r.id)} />
                    {ml(r.nameJson)}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">{t("dash.allRoles", "Виден всем ролям с доступом к странице.")}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("dash.cancel", "Отмена")}</Button>
          <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("dash.save", "Сохранить")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetricEditor({
  metric,
  index,
  entities,
  canRemove,
  onChange,
  onRemove,
  ml,
  t,
}: {
  metric: DraftMetric;
  index: number;
  entities: Entity[];
  canRemove: boolean;
  onChange: (patch: Partial<DraftMetric>) => void;
  onRemove: () => void;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
}) {
  const { data: fields = [] } = useListEntityFields(metric.entityId ?? 0, {
    query: { enabled: metric.entityId != null, queryKey: getListEntityFieldsQueryKey(metric.entityId ?? 0) },
  });
  const { data: statuses = [] } = useListEntityStatuses(metric.entityId ?? 0, {
    query: { enabled: metric.entityId != null, queryKey: getListEntityStatusesQueryKey(metric.entityId ?? 0) },
  });
  const numericFields = fields.filter((f: Field) => f.fieldType === "number");

  const toggleStatus = (sid: number) => {
    const next = metric.statusIds.includes(sid)
      ? metric.statusIds.filter((s) => s !== sid)
      : [...metric.statusIds, sid];
    onChange({ statusIds: next });
  };

  return (
    <div className="rounded-md bg-slate-50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">#{index + 1}</span>
        <Input
          value={metric.key}
          onChange={(e) => onChange({ key: e.target.value })}
          placeholder={t("dash.metricKey", "ключ")}
          className="h-8 w-28 font-mono text-xs"
        />
        <div className="flex-1" />
        {canRemove && (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={onRemove}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={metric.entityId != null ? String(metric.entityId) : ""}
          onValueChange={(v) => onChange({ entityId: Number(v), fieldKey: null, statusIds: [] })}
        >
          <SelectTrigger className="h-8"><SelectValue placeholder={t("dash.selectEntity", "Сущность")} /></SelectTrigger>
          <SelectContent>
            {entities.filter((e) => e.isActive).map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>{ml(e.nameJson)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={metric.aggregation} onValueChange={(v) => onChange({ aggregation: v as "count" | "sum" })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="count">{t("dash.aggCount", "Количество")}</SelectItem>
            <SelectItem value="sum">{t("dash.aggSum", "Сумма")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {metric.aggregation === "sum" && (
        <Select
          value={metric.fieldKey ?? ""}
          onValueChange={(v) => onChange({ fieldKey: v })}
          disabled={metric.entityId == null}
        >
          <SelectTrigger className="h-8"><SelectValue placeholder={t("dash.selectField", "Числовое поле")} /></SelectTrigger>
          <SelectContent>
            {numericFields.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-slate-400">{t("dash.noNumericFields", "Нет числовых полей")}</div>
            ) : (
              numericFields.map((f: Field) => (
                <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      )}
      {metric.entityId != null && statuses.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-slate-400">{t("dash.statusFilter", "Статусы (пусто = все)")}</p>
          <div className="flex flex-wrap gap-1.5">
            {statuses.map((s: Status) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStatus(s.id)}
                className={metric.statusIds.includes(s.id) ? "" : "opacity-50"}
              >
                <Badge style={{ backgroundColor: s.color }} className="border-0 text-white font-normal cursor-pointer">
                  {ml(s.nameJson)}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
