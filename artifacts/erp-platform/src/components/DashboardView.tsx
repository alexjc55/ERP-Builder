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
  useGetSettings,
  getGetSettingsQueryKey,
  type DashboardWidget,
  type DashboardWidgetInput,
  type DashboardWidgetData,
  type WidgetMetric,
  type WidgetConfigFormat,
  type ChartSeriesPoint,
  type ChartConfigType,
  type ChartConfigGroupByKind,
  type ChartConfigAggregation,
  type TableColumn,
  type TableRow,
  type Entity,
  type Field,
  type Status,
  type Role,
  type MultilingualText,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LabelList,
} from "recharts";
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
import { Settings2, Plus, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight, Minus, X, LayoutDashboard } from "lucide-react";

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

const GRID_COLS = 4;
const GRID_ROWS_MAX = 4;

/** Static sample data so admins can preview each chart type while choosing it. */
const SAMPLE_CHART_SERIES: ChartSeriesPoint[] = [
  { label: "A", value: 8, color: "#2563eb" },
  { label: "B", value: 14, color: "#7c3aed" },
  { label: "C", value: 6, color: "#059669" },
  { label: "D", value: 11, color: "#f59e0b" },
];

const CHART_TYPE_OPTIONS: { value: ChartConfigType; labelKey: string; fallback: string }[] = [
  { value: "bar", labelKey: "dash.chartBar", fallback: "Столбчатый" },
  { value: "line", labelKey: "dash.chartLine", fallback: "Линейный" },
  { value: "area", labelKey: "dash.chartArea", fallback: "Область" },
  { value: "pie", labelKey: "dash.chartPie", fallback: "Круговой" },
  { value: "donut", labelKey: "dash.chartDonut", fallback: "Кольцевой" },
];

/** Map a tailwind preset bg class to a concrete hex for chart fills/strokes. */
const TAILWIND_HEX: Record<string, string> = {
  "bg-blue-600": "#2563eb",
  "bg-violet-600": "#7c3aed",
  "bg-emerald-600": "#059669",
  "bg-amber-500": "#f59e0b",
  "bg-red-500": "#ef4444",
  "bg-cyan-600": "#0891b2",
  "bg-pink-600": "#db2777",
  "bg-slate-600": "#475569",
};

/** Fallback palette for chart buckets that carry no per-point color. */
const CHART_PALETTE = [
  "#2563eb",
  "#7c3aed",
  "#059669",
  "#f59e0b",
  "#ef4444",
  "#0891b2",
  "#db2777",
  "#475569",
  "#14b8a6",
  "#a855f7",
];

/**
 * Format a computed value for display per the widget's chosen format. The
 * currency symbol is admin-configurable (Settings → "Символ валюты") and passed
 * in, so "currency" widgets render `<number> <symbol>` instead of a hardcoded ₽.
 */
function formatValue(value: number, format: string | null | undefined, currencySymbol: string): string {
  if (!Number.isFinite(value)) return "—";
  if (format === "currency") {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)} ${currencySymbol}`;
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

/** Render a chart widget's series with the chosen chart type. */
function WidgetChart({
  chartType,
  series,
  color,
  showValues = false,
  t,
}: {
  chartType: string;
  series: ChartSeriesPoint[];
  color: string;
  showValues?: boolean;
  t: (key: string, fallback: string) => string;
}) {
  const hex = TAILWIND_HEX[color] ?? "#2563eb";
  if (!series || series.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        {t("dash.noData", "Нет данных")}
      </div>
    );
  }

  if (chartType === "pie" || chartType === "donut") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={series}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            outerRadius="80%"
            innerRadius={chartType === "donut" ? "55%" : 0}
            label={showValues ? { fontSize: 11, fill: "#334155" } : undefined}
          >
            {series.map((p, i) => (
              <Cell key={i} fill={p.color ?? CHART_PALETTE[i % CHART_PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke={hex} strokeWidth={2} dot={showValues}>
            {showValues && <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: "#334155" }} />}
          </Line>
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "area") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Area type="monotone" dataKey="value" stroke={hex} fill={hex} fillOpacity={0.2} strokeWidth={2}>
            {showValues && <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: "#334155" }} />}
          </Area>
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  // default: bar
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {showValues && <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: "#334155" }} />}
          {series.map((p, i) => (
            <Cell key={i} fill={p.color ?? hex} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Render a stored record value as compact display text for a table widget cell. */
function renderTableCell(value: unknown, fieldType: string): string {
  if (value == null || value === "") return "—";
  if (fieldType === "boolean") return value ? "✓" : "—";
  if (Array.isArray(value)) return value.map((v) => renderTableCell(v, "text")).filter((s) => s !== "—").join(", ") || "—";
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
    if (typeof o.label === "string") return o.label;
    return JSON.stringify(value);
  }
  return String(value);
}

/** Render a table widget: admin-chosen columns and the entity's recent rows. */
function WidgetTable({
  columns,
  rows,
  t,
}: {
  columns: TableColumn[];
  rows: TableRow[];
  t: (key: string, fallback: string) => string;
}) {
  if (!columns || columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        {t("dash.noData", "Нет данных")}
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.fieldKey} className="border-b border-slate-200 px-2 py-1.5 text-left font-medium text-slate-500 whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-2 py-6 text-center text-slate-400">
                {t("dash.noData", "Нет данных")}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/60">
                {columns.map((c) => (
                  <td key={c.fieldKey} className="border-b border-slate-100 px-2 py-1.5 text-slate-700 whitespace-nowrap">
                    {renderTableCell((r.values ?? {})[c.fieldKey], c.fieldType)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function WidgetCard({ w, ml, currencySymbol, t }: { w: DashboardWidgetData; ml: (v: unknown) => string; currencySymbol: string; t: (key: string, fallback: string) => string }) {
  if (w.widgetType === "table") {
    return (
      <Card className="h-full border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <CardContent className="flex h-full flex-col p-4">
          <p className="text-sm font-medium text-slate-500 truncate">{ml(w.titleJson)}</p>
          <div className="flex-1 min-h-0 mt-2">
            <WidgetTable columns={w.tableColumns ?? []} rows={w.tableRows ?? []} t={t} />
          </div>
        </CardContent>
      </Card>
    );
  }
  if (w.widgetType === "chart") {
    return (
      <Card className="h-full border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <CardContent className="flex h-full flex-col p-4">
          <p className="text-sm font-medium text-slate-500 truncate">{ml(w.titleJson)}</p>
          <div className="flex-1 min-h-0 mt-2">
            <WidgetChart chartType={w.chartType ?? "bar"} series={w.series ?? []} color={w.color} showValues={w.showValues ?? false} t={t} />
          </div>
        </CardContent>
      </Card>
    );
  }

  const Icon = getIconComponent(w.icon || DEFAULT_ICON, LayoutDashboard);
  const value = resolveValue(w);
  return (
    <Card className="h-full border-slate-200 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="flex h-full items-center p-6">
        <div className="flex w-full items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500 truncate">{ml(w.titleJson)}</p>
            <p className="text-3xl font-bold text-slate-800 mt-1">{formatValue(value, w.format, currencySymbol)}</p>
          </div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${w.color || DEFAULT_COLOR}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function widgetToInput(w: DashboardWidget, patch: Partial<DashboardWidgetInput>): DashboardWidgetInput {
  return {
    titleJson: w.titleJson,
    config: w.config,
    visibleRoleIds: w.visibleRoleIds ?? null,
    icon: w.icon,
    color: w.color,
    gridW: w.gridW,
    gridH: w.gridH,
    sortOrder: w.sortOrder,
    ...patch,
  };
}

function SizeStepper({
  short,
  label,
  value,
  min,
  max,
  busy,
  onChange,
}: {
  short: string;
  label: string;
  value: number;
  min: number;
  max: number;
  busy: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1" title={label}>
      <span className="text-[10px] font-semibold text-slate-400">{short}</span>
      <Button variant="outline" size="icon" className="h-6 w-6" disabled={busy || value <= min} onClick={() => onChange(value - 1)}>
        <Minus className="w-3 h-3" />
      </Button>
      <span className="w-3 text-center text-xs font-medium text-slate-600">{value}</span>
      <Button variant="outline" size="icon" className="h-6 w-6" disabled={busy || value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="w-3 h-3" />
      </Button>
    </div>
  );
}

function EditWidgetCell({
  w,
  index,
  total,
  busy,
  ml,
  t,
  onResize,
  onMove,
  onEdit,
  onDelete,
}: {
  w: DashboardWidget;
  index: number;
  total: number;
  busy: boolean;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
  onResize: (patch: { gridW?: number; gridH?: number }) => void;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = getIconComponent(w.icon || DEFAULT_ICON, LayoutDashboard);
  const widgetType = w.config.widgetType;
  const summary =
    widgetType === "chart"
      ? `${t("dash.chartWidget", "График")} · ${w.config.chart?.type ?? ""}`
      : widgetType === "table"
        ? `${t("dash.tableWidget", "Таблица")} · ${t("dash.columnsCount", "Колонок")}: ${w.config.table?.fieldKeys?.length ?? 0}`
        : `${t("dash.metricsCount", "Метрик")}: ${w.config.metrics?.length ?? 0}${w.config.formula ? ` · ${t("dash.hasFormula", "формула")}` : ""}`;
  return (
    <div
      className="min-w-0"
      style={{
        gridColumn: `span ${Math.min(Math.max(w.gridW || 1, 1), GRID_COLS)}`,
        gridRow: `span ${Math.min(Math.max(w.gridH || 1, 1), GRID_ROWS_MAX)}`,
      }}
    >
      <Card className="h-full border-dashed border-slate-300 shadow-sm">
        <CardContent className="flex h-full flex-col justify-between gap-1.5 p-3 overflow-hidden">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${w.color || DEFAULT_COLOR}`}>
              <Icon className="w-3.5 h-3.5 text-white" />
            </div>
            <p className="flex-1 truncate text-sm font-medium text-slate-700">{ml(w.titleJson)}</p>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400" disabled={index === 0 || busy} onClick={() => onMove(-1)} title={t("dash.moveBack", "Переместить назад")}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400" disabled={index === total - 1 || busy} onClick={() => onMove(1)} title={t("dash.moveForward", "Переместить вперёд")}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
          <p className="truncate text-xs text-slate-400">
            {summary}
            {w.visibleRoleIds && w.visibleRoleIds.length > 0 ? ` · ${t("dash.roleLimited", "ограничено ролями")}` : ""}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <SizeStepper short={t("dash.gridWShort", "Ш")} label={t("dash.gridW", "Ширина (ячеек)")} value={w.gridW} min={1} max={GRID_COLS} busy={busy} onChange={(v) => onResize({ gridW: v })} />
            <SizeStepper short={t("dash.gridHShort", "В")} label={t("dash.gridH", "Высота (ячеек)")} value={w.gridH} min={1} max={GRID_ROWS_MAX} busy={busy} onChange={(v) => onResize({ gridH: v })} />
            <div className="flex-1" />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title={t("dash.editWidget", "Редактировать виджет")}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={onDelete} title={t("dash.delete", "Удалить")}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
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
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const currencySymbol = settings?.currencySymbol || "₽";

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
  const resizeMutation = useUpdateDashboardWidget({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: t("dash.saveError", "Ошибка сохранения виджета"), variant: "destructive" }),
    },
  });

  const resize = (w: DashboardWidget, patch: { gridW?: number; gridH?: number }) => {
    const gridW = Math.min(Math.max(patch.gridW ?? w.gridW, 1), GRID_COLS);
    const gridH = Math.min(Math.max(patch.gridH ?? w.gridH, 1), GRID_ROWS_MAX);
    if (gridW === w.gridW && gridH === w.gridH) return;
    resizeMutation.mutate({ wid: w.id, data: widgetToInput(w, { gridW, gridH }) });
  };

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
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 auto-rows-[8rem]">
          {sortedEdit.map((w, i) => (
            <EditWidgetCell
              key={w.id}
              w={w}
              index={i}
              total={sortedEdit.length}
              busy={resizeMutation.isPending || reorderMutation.isPending}
              ml={ml}
              t={t}
              onResize={(patch) => resize(w, patch)}
              onMove={(dir) => move(i, dir)}
              onEdit={() => openEdit(w)}
              onDelete={() => setDeleteWidget(w)}
            />
          ))}
          <button
            type="button"
            onClick={openCreate}
            className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-blue-400 hover:text-blue-500"
          >
            <Plus className="w-6 h-6" />
            <span className="text-sm font-medium">{t("dash.addWidget", "Добавить виджет")}</span>
          </button>
        </div>
      ) : sortedData.length === 0 ? (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="text-center py-16 text-slate-400">
            {t("dash.emptyViewer", "На этой панели пока нет виджетов")}
          </CardContent>
        </Card>
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 auto-rows-[8rem]"
        >
          {sortedData.map((w) => (
            <div
              key={w.id}
              className="min-w-0"
              style={{
                gridColumn: `span ${Math.min(Math.max(w.gridW || 1, 1), GRID_COLS)}`,
                gridRow: `span ${Math.min(Math.max(w.gridH || 1, 1), GRID_ROWS_MAX)}`,
              }}
            >
              <WidgetCard w={w} ml={ml} currencySymbol={currencySymbol} t={t} />
            </div>
          ))}
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

type ChartDraft = {
  type: ChartConfigType;
  entityId: number | null;
  groupByKind: ChartConfigGroupByKind;
  groupByFieldKey: string | null;
  aggregation: ChartConfigAggregation;
  fieldKey: string | null;
  statusIds: number[];
  showValues: boolean;
};

type TableDraft = {
  entityId: number | null;
  fieldKeys: string[];
  statusIds: number[];
  limit: number;
};

type WidgetTypeChoice = "metric" | "chart" | "table";

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
  onCreate: (data: DashboardWidgetInput) => void;
  onUpdate: (wid: number, data: DashboardWidgetInput) => void;
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
  const [widgetType, setWidgetType] = useState<WidgetTypeChoice>(
    widget?.config.widgetType === "chart"
      ? "chart"
      : widget?.config.widgetType === "table"
        ? "table"
        : "metric",
  );
  const [icon, setIcon] = useState(widget?.icon || DEFAULT_ICON);
  const [color, setColor] = useState(widget?.color || DEFAULT_COLOR);
  const [format, setFormat] = useState<string>(widget?.config.format || "number");
  const [formula, setFormula] = useState(widget?.config.formula || "");
  const [restrictRoles, setRestrictRoles] = useState<boolean>(
    !!(widget?.visibleRoleIds && widget.visibleRoleIds.length > 0),
  );
  const [visibleRoleIds, setVisibleRoleIds] = useState<number[]>(widget?.visibleRoleIds ?? []);
  const [metrics, setMetrics] = useState<DraftMetric[]>(() =>
    widget && widget.config.metrics && widget.config.metrics.length > 0
      ? widget.config.metrics.map((m) => ({
          key: m.key,
          entityId: m.entityId,
          aggregation: m.aggregation,
          fieldKey: m.fieldKey ?? null,
          statusIds: m.statusIds ?? [],
        }))
      : [{ key: "m1", entityId: null, aggregation: "count", fieldKey: null, statusIds: [] }],
  );
  const [chart, setChart] = useState<ChartDraft>(() => {
    const c = widget?.config.chart;
    return {
      type: c?.type ?? "bar",
      entityId: c?.entityId ?? null,
      groupByKind: c?.groupBy?.kind ?? "status",
      groupByFieldKey: c?.groupBy?.fieldKey ?? null,
      aggregation: c?.aggregation ?? "count",
      fieldKey: c?.fieldKey ?? null,
      statusIds: c?.statusIds ?? [],
      showValues: c?.showValues ?? false,
    };
  });
  const [table, setTable] = useState<TableDraft>(() => {
    const tb = widget?.config.table;
    return {
      entityId: tb?.entityId ?? null,
      fieldKeys: tb?.fieldKeys ?? [],
      statusIds: tb?.statusIds ?? [],
      limit: tb?.limit ?? 10,
    };
  });

  const updateMetric = (i: number, patch: Partial<DraftMetric>) =>
    setMetrics((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const addMetric = () =>
    setMetrics((prev) => [...prev, { key: `m${prev.length + 1}`, entityId: null, aggregation: "count", fieldKey: null, statusIds: [] }]);

  const removeMetric = (i: number) => setMetrics((prev) => prev.filter((_, idx) => idx !== i));

  const toggleRole = (roleId: number) =>
    setVisibleRoleIds((prev) => (prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]));

  const buildData = (): DashboardWidgetInput | null => {
    const base = {
      titleJson: titleJson as MultilingualText,
      visibleRoleIds: restrictRoles && visibleRoleIds.length > 0 ? visibleRoleIds : null,
      icon,
      color,
      sortOrder: widget?.sortOrder ?? nextSortOrder,
      // Size is controlled on the grid (inline resize), not in this dialog. New widgets default
      // to 1×1; for edits we omit grid dims so an in-flight inline resize is never reverted.
      ...(widget ? {} : { gridW: 1, gridH: 1 }),
    };

    if (widgetType === "chart") {
      if (chart.entityId == null) {
        toast({ title: t("dash.chartNeedsEntity", "Выберите сущность для графика"), variant: "destructive" });
        return null;
      }
      if (chart.groupByKind === "field" && !chart.groupByFieldKey) {
        toast({ title: t("dash.chartNeedsGroupField", "Выберите поле для группировки"), variant: "destructive" });
        return null;
      }
      if (chart.aggregation === "sum" && !chart.fieldKey) {
        toast({ title: t("dash.metricNeedsField", "Для суммы выберите числовое поле"), variant: "destructive" });
        return null;
      }
      return {
        ...base,
        config: {
          widgetType: "chart",
          format: format as WidgetConfigFormat,
          chart: {
            type: chart.type,
            entityId: chart.entityId,
            groupBy: {
              kind: chart.groupByKind,
              fieldKey: chart.groupByKind === "field" ? chart.groupByFieldKey : null,
            },
            aggregation: chart.aggregation,
            fieldKey: chart.aggregation === "sum" ? chart.fieldKey : null,
            statusIds: chart.statusIds.length > 0 ? chart.statusIds : null,
            showValues: chart.showValues,
          },
        },
      };
    }

    if (widgetType === "table") {
      if (table.entityId == null) {
        toast({ title: t("dash.tableNeedsEntity", "Выберите сущность для таблицы"), variant: "destructive" });
        return null;
      }
      if (table.fieldKeys.length === 0) {
        toast({ title: t("dash.tableNeedsColumns", "Выберите хотя бы одну колонку"), variant: "destructive" });
        return null;
      }
      return {
        ...base,
        config: {
          widgetType: "table",
          table: {
            entityId: table.entityId,
            fieldKeys: table.fieldKeys,
            statusIds: table.statusIds.length > 0 ? table.statusIds : null,
            limit: table.limit,
          },
        },
      };
    }

    const keys = new Set<string>();
    for (const m of metrics) {
      if (!m.key || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(m.key)) {
        toast({ title: t("dash.invalidKey", "Некорректный ключ метрики (латиница/цифры/_)"), variant: "destructive" });
        return null;
      }
      if (keys.has(m.key)) {
        toast({ title: t("dash.dupKey", "Ключи метрик должны быть уникальны"), variant: "destructive" });
        return null;
      }
      keys.add(m.key);
      if (m.entityId == null) {
        toast({ title: t("dash.metricNeedsEntity", "Выберите сущность для каждой метрики"), variant: "destructive" });
        return null;
      }
      if (m.aggregation === "sum" && !m.fieldKey) {
        toast({ title: t("dash.metricNeedsField", "Для суммы выберите числовое поле"), variant: "destructive" });
        return null;
      }
    }
    return {
      ...base,
      config: {
        widgetType: "metric",
        metrics: metrics.map<WidgetMetric>((m) => ({
          key: m.key,
          entityId: m.entityId as number,
          aggregation: m.aggregation,
          fieldKey: m.aggregation === "sum" ? m.fieldKey : null,
          statusIds: m.statusIds.length > 0 ? m.statusIds : null,
        })),
        formula: formula.trim() ? formula.trim() : null,
        format: format as WidgetConfigFormat,
      },
    };
  };

  const handleSubmit = () => {
    const data = buildData();
    if (!data) return;
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
              <Label>{t("dash.widgetType", "Тип виджета")}</Label>
              <Select value={widgetType} onValueChange={(v) => setWidgetType(v as WidgetTypeChoice)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="metric">{t("dash.typeMetric", "Показатель")}</SelectItem>
                  <SelectItem value="chart">{t("dash.typeChart", "График")}</SelectItem>
                  <SelectItem value="table">{t("dash.typeTable", "Таблица")}</SelectItem>
                </SelectContent>
              </Select>
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
            <Label>{t("dash.icon", "Иконка")}</Label>
            <IconPicker value={icon} onChange={setIcon} />
            <p className="text-xs text-slate-400">{t("dash.sizeHint", "Размер виджета настраивается прямо на сетке в режиме настройки.")}</p>
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

          {widgetType === "chart" ? (
            <ChartEditor chart={chart} entities={entities} onChange={(patch) => setChart((prev) => ({ ...prev, ...patch }))} ml={ml} t={t} />
          ) : widgetType === "table" ? (
            <TableEditor table={table} entities={entities} onChange={(patch) => setTable((prev) => ({ ...prev, ...patch }))} ml={ml} t={t} />
          ) : (
            <>
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
            </>
          )}

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

function ChartEditor({
  chart,
  entities,
  onChange,
  ml,
  t,
}: {
  chart: ChartDraft;
  entities: Entity[];
  onChange: (patch: Partial<ChartDraft>) => void;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
}) {
  const { data: fields = [] } = useListEntityFields(chart.entityId ?? 0, {
    query: { enabled: chart.entityId != null, queryKey: getListEntityFieldsQueryKey(chart.entityId ?? 0) },
  });
  const { data: statuses = [] } = useListEntityStatuses(chart.entityId ?? 0, {
    query: { enabled: chart.entityId != null, queryKey: getListEntityStatusesQueryKey(chart.entityId ?? 0) },
  });
  const numericFields = fields.filter((f: Field) => f.fieldType === "number");
  const groupableFields = fields.filter((f: Field) => f.fieldType !== "function" && f.fieldType !== "file");

  const toggleStatus = (sid: number) => {
    const next = chart.statusIds.includes(sid)
      ? chart.statusIds.filter((s) => s !== sid)
      : [...chart.statusIds, sid];
    onChange({ statusIds: next });
  };

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3">
      <Label>{t("dash.chartSettings", "Настройки графика")}</Label>
      <div className="space-y-1.5">
        <p className="text-xs text-slate-400">{t("dash.chartType", "Тип графика")}</p>
        <div className="grid grid-cols-5 gap-2">
          {CHART_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ type: opt.value })}
              className={`flex flex-col items-center gap-1 rounded-md border p-1.5 transition-colors ${
                chart.type === opt.value
                  ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-500"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="pointer-events-none h-12 w-full">
                <WidgetChart chartType={opt.value} series={SAMPLE_CHART_SERIES} color={DEFAULT_COLOR} showValues={chart.showValues} t={t} />
              </div>
              <span className="text-center text-[10px] leading-tight text-slate-500">{t(opt.labelKey, opt.fallback)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-slate-400">{t("dash.selectEntity", "Сущность")}</p>
        <Select
          value={chart.entityId != null ? String(chart.entityId) : ""}
          onValueChange={(v) => onChange({ entityId: Number(v), fieldKey: null, groupByFieldKey: null, statusIds: [] })}
        >
          <SelectTrigger className="h-8"><SelectValue placeholder={t("dash.selectEntity", "Сущность")} /></SelectTrigger>
          <SelectContent>
            {entities.filter((e) => e.isActive).map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>{ml(e.nameJson)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <p className="text-xs text-slate-400">{t("dash.groupBy", "Группировать по")}</p>
          <Select value={chart.groupByKind} onValueChange={(v) => onChange({ groupByKind: v as ChartConfigGroupByKind, groupByFieldKey: null })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="status">{t("dash.groupByStatus", "Статусу")}</SelectItem>
              <SelectItem value="field">{t("dash.groupByField", "Полю")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {chart.groupByKind === "field" && (
          <div className="space-y-1.5">
            <p className="text-xs text-slate-400">{t("dash.groupField", "Поле группировки")}</p>
            <Select
              value={chart.groupByFieldKey ?? ""}
              onValueChange={(v) => onChange({ groupByFieldKey: v })}
              disabled={chart.entityId == null}
            >
              <SelectTrigger className="h-8"><SelectValue placeholder={t("dash.selectField", "Поле")} /></SelectTrigger>
              <SelectContent>
                {groupableFields.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-slate-400">{t("dash.noFields", "Нет полей")}</div>
                ) : (
                  groupableFields.map((f: Field) => (
                    <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <p className="text-xs text-slate-400">{t("dash.aggregation", "Агрегация")}</p>
          <Select value={chart.aggregation} onValueChange={(v) => onChange({ aggregation: v as ChartConfigAggregation })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="count">{t("dash.aggCount", "Количество")}</SelectItem>
              <SelectItem value="sum">{t("dash.aggSum", "Сумма")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {chart.aggregation === "sum" && (
          <div className="space-y-1.5">
            <p className="text-xs text-slate-400">{t("dash.selectField", "Числовое поле")}</p>
            <Select
              value={chart.fieldKey ?? ""}
              onValueChange={(v) => onChange({ fieldKey: v })}
              disabled={chart.entityId == null}
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
          </div>
        )}
      </div>

      {chart.entityId != null && statuses.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-slate-400">{t("dash.statusFilter", "Статусы (пусто = все)")}</p>
          <div className="flex flex-wrap gap-1.5">
            {statuses.map((s: Status) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStatus(s.id)}
                className={chart.statusIds.includes(s.id) ? "" : "opacity-50"}
              >
                <Badge style={{ backgroundColor: s.color }} className="border-0 text-white font-normal cursor-pointer">
                  {ml(s.nameJson)}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm pt-1">
        <Checkbox checked={chart.showValues} onCheckedChange={(v) => onChange({ showValues: v === true })} />
        {t("dash.showValues", "Показывать значения на графике")}
      </label>
    </div>
  );
}

function TableEditor({
  table,
  entities,
  onChange,
  ml,
  t,
}: {
  table: TableDraft;
  entities: Entity[];
  onChange: (patch: Partial<TableDraft>) => void;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
}) {
  const { data: fields = [] } = useListEntityFields(table.entityId ?? 0, {
    query: { enabled: table.entityId != null, queryKey: getListEntityFieldsQueryKey(table.entityId ?? 0) },
  });
  const { data: statuses = [] } = useListEntityStatuses(table.entityId ?? 0, {
    query: { enabled: table.entityId != null, queryKey: getListEntityStatusesQueryKey(table.entityId ?? 0) },
  });

  const toggleColumn = (key: string) => {
    const next = table.fieldKeys.includes(key)
      ? table.fieldKeys.filter((k) => k !== key)
      : [...table.fieldKeys, key];
    onChange({ fieldKeys: next });
  };

  const toggleStatus = (sid: number) => {
    const next = table.statusIds.includes(sid)
      ? table.statusIds.filter((s) => s !== sid)
      : [...table.statusIds, sid];
    onChange({ statusIds: next });
  };

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3">
      <Label>{t("dash.tableSettings", "Настройки таблицы")}</Label>

      <div className="space-y-1.5">
        <p className="text-xs text-slate-400">{t("dash.selectEntity", "Сущность")}</p>
        <Select
          value={table.entityId != null ? String(table.entityId) : ""}
          onValueChange={(v) => onChange({ entityId: Number(v), fieldKeys: [], statusIds: [] })}
        >
          <SelectTrigger className="h-8"><SelectValue placeholder={t("dash.selectEntity", "Сущность")} /></SelectTrigger>
          <SelectContent>
            {entities.filter((e) => e.isActive).map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>{ml(e.nameJson)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-slate-400">{t("dash.tableColumns", "Колонки (порядок выбора)")}</p>
        {table.entityId == null ? (
          <p className="text-xs text-slate-400">{t("dash.tableSelectEntityFirst", "Сначала выберите сущность")}</p>
        ) : fields.length === 0 ? (
          <p className="text-xs text-slate-400">{t("dash.noFields", "Нет полей")}</p>
        ) : (
          <div className="space-y-1 max-h-44 overflow-auto rounded-md border border-slate-100 p-2">
            {fields.map((f: Field) => (
              <label key={f.fieldKey} className="flex items-center gap-2 text-sm">
                <Checkbox checked={table.fieldKeys.includes(f.fieldKey)} onCheckedChange={() => toggleColumn(f.fieldKey)} />
                {ml(f.nameJson)}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-slate-400">{t("dash.rowLimit", "Кол-во строк (1–100)")}</p>
        <Input
          type="number"
          min={1}
          max={100}
          value={table.limit}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange({ limit: Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 100) : 10 });
          }}
          className="h-8 w-28"
        />
      </div>

      {table.entityId != null && statuses.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-slate-400">{t("dash.statusFilter", "Статусы (пусто = все)")}</p>
          <div className="flex flex-wrap gap-1.5">
            {statuses.map((s: Status) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStatus(s.id)}
                className={table.statusIds.includes(s.id) ? "" : "opacity-50"}
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
