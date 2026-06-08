import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  useGetDashboardData,
  useListDashboardWidgets,
  useCreateDashboardWidget,
  useUpdateDashboardWidget,
  useDeleteDashboardWidget,
  useReorderDashboardWidgets,
  useUpdateNotesContent,
  getListDashboardWidgetsQueryKey,
  getListEntityFieldsQueryKey,
  getListEntityStatusesQueryKey,
  useListEntities,
  useListEntityFields,
  useListEntityStatuses,
  useGetEntityRelationOptions,
  getGetEntityRelationOptionsQueryKey,
  useQueryEntityRecords,
  useListRoles,
  useListPages,
  useUpdatePage,
  getListPagesQueryKey,
  useGetSettings,
  getGetSettingsQueryKey,
  type Page,
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
  type NotesData,
  type NoteCellData,
  type NotesConfig,
  type NotesContentInput,
  type NoteCell,
  type NoteCellSource,
  type NoteCellFormat,
  type EntityRecord,
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
import { Textarea } from "@/components/ui/textarea";
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
import { cn } from "@/lib/utils";
import { evaluateFormula } from "@/lib/formula";
import DOMPurify from "dompurify";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import { TextAlign } from "@tiptap/extension-text-align";
import { useAuth } from "@/lib/auth";
import { useML, useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Settings2, Plus, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ArrowRight, Minus, X, LayoutDashboard, GripVertical, Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered, Link2, AlignLeft, AlignCenter, AlignRight, Heading1, Heading2, Heading3, Star } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HexColorPicker } from "react-colorful";
import { addColorPreset, loadColorPresets, removeColorPreset } from "@/lib/colorPresets";
import { useLocation } from "wouter";

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

// Sentinel column key for the synthetic status column in table widgets. Must
// match STATUS_COLUMN_KEY in artifacts/api-server/src/routes/dashboard.ts.
const STATUS_COLUMN_KEY = "__status";

/**
 * Border class per preset bg class, used by the "border" color style. Kept as
 * literal strings (not derived via string replace) so Tailwind's content scanner
 * keeps them in the build instead of purging dynamically-built class names.
 */
const COLOR_BORDER: Record<string, string> = {
  "bg-blue-600": "border-blue-600",
  "bg-violet-600": "border-violet-600",
  "bg-emerald-600": "border-emerald-600",
  "bg-amber-500": "border-amber-500",
  "bg-red-500": "border-red-500",
  "bg-cyan-600": "border-cyan-600",
  "bg-pink-600": "border-pink-600",
  "bg-slate-600": "border-slate-600",
};

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

/**
 * Resolve a notes-table dynamic cell to display text. The server ships per-source
 * values (admin-authoritative); the formula (if any) is evaluated client-side
 * against them as {key}, consistent with metric widgets. Numeric results honor
 * the cell's number/currency/percent format.
 */
function renderNoteCellValue(cell: NoteCellData, currencySymbol: string): string {
  if (cell.kind === "static") return cell.text ?? "";
  const values = (cell.values ?? {}) as Record<string, unknown>;
  let result: unknown;
  if (cell.formula && cell.formula.trim()) {
    try {
      result = evaluateFormula(cell.formula, values);
    } catch {
      return "Ошибка формулы";
    }
  } else {
    const keys = Object.keys(values);
    result = keys.length > 0 ? values[keys[0]] : null;
  }
  if (result == null || result === "") return "—";
  if (typeof result === "number" && Number.isFinite(result)) {
    return formatValue(result, cell.format, currencySymbol);
  }
  return String(result);
}

/** Render a rich-text notes widget: server-sanitized HTML, re-sanitized client-side. */
function NotesRichText({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html ?? "", { USE_PROFILES: { html: true } });
  return (
    <div
      className="notes-prose h-full overflow-auto text-sm text-slate-700 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-1.5 [&_h3]:mb-1 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_a]:text-blue-600 [&_a]:underline [&_strong]:font-semibold"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

/**
 * Per-user, per-widget column widths for a notes table, persisted in localStorage
 * (mirrors the records table's resize behavior). The notes table has no header
 * keys, so columns are positional and widths are keyed by column index.
 */
function useNotesColResize(widgetId: number) {
  const storageKey = `erp:notescolwidths:${widgetId}`;
  const [widths, setWidths] = useState<Record<number, number>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setWidths(raw ? (JSON.parse(raw) as Record<number, number>) : {});
    } catch {
      setWidths({});
    }
  }, [storageKey]);
  // Forcibly tear down an in-flight drag on unmount so a drag that never sees
  // pointerup can't leak window listeners or leave body cursor/userSelect stuck.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  const startResize = (ci: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCleanupRef.current?.();
    const cell = (e.currentTarget as HTMLElement).closest("td,th") as HTMLElement | null;
    const startW = widths[ci] ?? cell?.offsetWidth ?? 120;
    const startX = e.clientX;
    let latest = widths;
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(48, Math.round(startW + (ev.clientX - startX)));
      latest = { ...widths, [ci]: w };
      setWidths(latest);
    };
    const cleanup = (persist: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onAbort);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      dragCleanupRef.current = null;
      if (persist) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(latest));
        } catch {
          /* ignore quota / disabled storage */
        }
      }
    };
    const onUp = () => cleanup(true);
    const onAbort = () => cleanup(true);
    dragCleanupRef.current = () => cleanup(false);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("blur", onAbort);
  };
  const reset = (ci: number) => {
    setWidths((prev) => {
      const next = { ...prev };
      delete next[ci];
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  return { widths, startResize, reset };
}

/** Fixed width for a resized notes-table column (auto-layout needs min+max to honour it). */
function notesColStyle(widths: Record<number, number>, ci: number): CSSProperties | undefined {
  const w = widths[ci];
  return w ? { width: w, minWidth: w, maxWidth: w } : undefined;
}

/** Drag handle pinned to a notes-table column's right edge; double-click resets the width. */
function NotesResizeGrip({ onResizeStart, onReset }: { onResizeStart: (e: ReactPointerEvent) => void; onReset: () => void }) {
  return (
    <span
      onPointerDown={onResizeStart}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
      title="Потяните, чтобы изменить ширину колонки (двойной клик — сбросить)"
      className="absolute -right-px top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-blue-400/70"
    />
  );
}

/** Render a free-form notes table: each cell is static text or a computed value. */
function NotesTable({ cells, currencySymbol, widgetId }: { cells: NoteCellData[][]; currencySymbol: string; widgetId: number }) {
  const { widths, startResize, reset } = useNotesColResize(widgetId);
  if (!cells || cells.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">Нет данных</div>;
  }
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {cells.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={notesColStyle(widths, ci)}
                  className={cn(
                    "relative border border-slate-200 px-2 py-1.5 align-top",
                    cell.kind === "dynamic" ? "font-medium text-slate-800 tabular-nums" : "text-slate-600 whitespace-pre-wrap",
                  )}
                >
                  {renderNoteCellValue(cell, currencySymbol)}
                  {ri === 0 && <NotesResizeGrip onResizeStart={startResize(ci)} onReset={() => reset(ci)} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Notes content router: renders richtext or table, with inline editing when allowed. */
function EditableNotesContent({
  notes,
  canEdit,
  currencySymbol,
  widgetId,
  onSave,
  saving,
  t,
}: {
  notes: NotesData;
  canEdit: boolean;
  currencySymbol: string;
  widgetId: number;
  onSave: (data: NotesContentInput) => void;
  saving: boolean;
  t: (key: string, fallback: string) => string;
}) {
  if (notes.kind === "table") {
    return (
      <EditableNotesTable
        cells={notes.cells ?? []}
        canEdit={canEdit}
        currencySymbol={currencySymbol}
        widgetId={widgetId}
        onSave={onSave}
        t={t}
      />
    );
  }
  return <EditableNotesRichText html={notes.html ?? ""} canEdit={canEdit} onSave={onSave} saving={saving} t={t} />;
}

/** Rich-text notes with hover-to-edit affordance and an inline editor. */
function EditableNotesRichText({
  html,
  canEdit,
  onSave,
  saving,
  t,
}: {
  html: string;
  canEdit: boolean;
  onSave: (data: NotesContentInput) => void;
  saving: boolean;
  t: (key: string, fallback: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(html);
  useEffect(() => {
    if (!editing) setDraft(html);
  }, [html, editing]);

  if (!canEdit) return <NotesRichText html={html} />;

  if (editing) {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="min-h-0 flex-1 overflow-auto">
          <RichTextEditor html={draft} onChange={setDraft} t={t} />
        </div>
        <div className="flex shrink-0 justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(html);
              setEditing(false);
            }}
          >
            {t("dash.cancel", "Отмена")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => {
              onSave({ kind: "richtext", html: draft });
              setEditing(false);
            }}
          >
            {t("dash.save", "Сохранить")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative h-full">
      <button
        type="button"
        onClick={() => {
          setDraft(html);
          setEditing(true);
        }}
        title={t("dash.edit", "Редактировать")}
        className="absolute right-0 top-0 z-10 rounded p-1 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <NotesRichText html={html} />
    </div>
  );
}

/** Free-form notes table where static cells become editable inputs on click. */
function EditableNotesTable({
  cells,
  canEdit,
  currencySymbol,
  widgetId,
  onSave,
  t,
}: {
  cells: NoteCellData[][];
  canEdit: boolean;
  currencySymbol: string;
  widgetId: number;
  onSave: (data: NotesContentInput) => void;
  t: (key: string, fallback: string) => string;
}) {
  const [editing, setEditing] = useState<{ ri: number; ci: number } | null>(null);
  const [draft, setDraft] = useState("");
  const { widths, startResize, reset } = useNotesColResize(widgetId);

  if (!canEdit) return <NotesTable cells={cells} currencySymbol={currencySymbol} widgetId={widgetId} />;
  if (!cells || cells.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">{t("dash.noData", "Нет данных")}</div>;
  }

  const commit = (ri: number, ci: number, original: string) => {
    setEditing(null);
    if (draft !== original) onSave({ kind: "table", cells: [{ row: ri, col: ci, text: draft }] });
  };

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {cells.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => {
                const editableCell = cell.kind === "static";
                const isEditing = editing?.ri === ri && editing?.ci === ci;
                if (isEditing) {
                  return (
                    <td key={ci} style={notesColStyle(widths, ci)} className="relative border border-slate-200 p-0 align-top">
                      <textarea
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commit(ri, ci, cell.text ?? "")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            commit(ri, ci, cell.text ?? "");
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setEditing(null);
                          }
                        }}
                        rows={1}
                        className="w-full resize-none bg-blue-50/40 px-2 py-1.5 text-sm text-slate-700 outline-none focus:ring-1 focus:ring-blue-300"
                      />
                    </td>
                  );
                }
                return (
                  <td
                    key={ci}
                    style={notesColStyle(widths, ci)}
                    onClick={
                      editableCell
                        ? () => {
                            setDraft(cell.text ?? "");
                            setEditing({ ri, ci });
                          }
                        : undefined
                    }
                    className={cn(
                      "relative border border-slate-200 px-2 py-1.5 align-top",
                      cell.kind === "dynamic" ? "font-medium text-slate-800 tabular-nums" : "whitespace-pre-wrap text-slate-600",
                      editableCell && "cursor-text hover:bg-blue-50/40",
                    )}
                  >
                    {renderNoteCellValue(cell, currencySymbol)}
                    {ri === 0 && <NotesResizeGrip onResizeStart={startResize(ci)} onReset={() => reset(ci)} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

/** Render a single status-column cell as a colored badge (value = {name,color}). */
function StatusCell({ value }: { value: unknown }) {
  if (value == null || typeof value !== "object") return <span className="text-slate-400">—</span>;
  const s = value as { name?: string; color?: string };
  if (!s.name) return <span className="text-slate-400">—</span>;
  return (
    <Badge style={{ backgroundColor: s.color || undefined }} className="border-0 text-white font-normal">
      {s.name}
    </Badge>
  );
}

/** Render a table widget: admin-chosen columns and the entity's recent rows. */
function WidgetTable({
  columns,
  rows,
  onRowClick,
  t,
}: {
  columns: TableColumn[];
  rows: TableRow[];
  onRowClick?: (id: number) => void;
  t: (key: string, fallback: string) => string;
}) {
  if (!columns || columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        {t("dash.noData", "Нет данных")}
      </div>
    );
  }
  const clickable = typeof onRowClick === "function";
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.fieldKey} className="border-b border-slate-200 px-2 py-1.5 text-left font-medium text-slate-500 whitespace-nowrap">
                {c.fieldType === "status" ? t("dash.statusColumn", "Статус") : c.label}
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
              <tr
                key={r.id}
                className={cn("hover:bg-slate-50/60", clickable && "cursor-pointer")}
                onClick={clickable ? () => onRowClick!(r.id) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.fieldKey} className="border-b border-slate-100 px-2 py-1.5 text-slate-700 whitespace-nowrap">
                    {c.fieldType === "status" ? (
                      <StatusCell value={(r.values ?? {})[c.fieldKey]} />
                    ) : (
                      renderTableCell((r.values ?? {})[c.fieldKey], c.fieldType)
                    )}
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

function WidgetCard({
  w,
  ml,
  currencySymbol,
  t,
  onOpenRecord,
  onViewAll,
  onSaveNotesContent,
  savingNotesContent,
}: {
  w: DashboardWidgetData;
  ml: (v: unknown) => string;
  currencySymbol: string;
  t: (key: string, fallback: string) => string;
  onOpenRecord?: (id: number) => void;
  onViewAll?: () => void;
  onSaveNotesContent?: (wid: number, data: NotesContentInput) => void;
  savingNotesContent?: boolean;
}) {
  if (w.widgetType === "table") {
    return (
      <Card className="h-full border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <CardContent className="flex h-full flex-col p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-500 truncate">{ml(w.titleJson)}</p>
            {onViewAll && (
              <button
                type="button"
                onClick={onViewAll}
                className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
              >
                {t("dash.viewAll", "Смотреть все")}
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0 mt-2">
            <WidgetTable columns={w.tableColumns ?? []} rows={w.tableRows ?? []} onRowClick={onOpenRecord} t={t} />
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
  if (w.widgetType === "notes") {
    const notes = w.notes;
    const title = ml(w.titleJson);
    return (
      <Card className="h-full border-slate-200 shadow-sm hover:shadow-md transition-shadow">
        <CardContent className="flex h-full flex-col p-4">
          {title && <p className="text-sm font-medium text-slate-500 truncate">{title}</p>}
          <div className={cn("flex-1 min-h-0", title && "mt-2")}>
            {notes ? (
              <EditableNotesContent
                notes={notes}
                canEdit={!!w.canEditNotes && !!onSaveNotesContent}
                currencySymbol={currencySymbol}
                widgetId={w.id}
                onSave={(data) => onSaveNotesContent?.(w.id, data)}
                saving={!!savingNotesContent}
                t={t}
              />
            ) : (
              <NotesRichText html="" />
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const Icon = w.icon ? getIconComponent(w.icon, LayoutDashboard) : null;
  const value = resolveValue(w);
  const colorClass = w.color || DEFAULT_COLOR;
  const colorStyle = w.colorStyle ?? "icon";
  const isFill = colorStyle === "fill";
  const isBorder = colorStyle === "border";
  const fillDark = (w.textColor ?? "light") === "dark";
  const fillText = fillDark ? "text-slate-900" : "text-white";
  return (
    <Card
      className={cn(
        "h-full shadow-sm hover:shadow-md transition-shadow",
        isFill
          ? `${colorClass} border-transparent`
          : isBorder
            ? `bg-white border-2 ${COLOR_BORDER[colorClass] ?? "border-blue-600"}`
            : "border-slate-200",
      )}
    >
      <CardContent className="flex h-full items-center p-6">
        <div className="flex w-full items-center justify-between">
          <div className="min-w-0">
            <p className={cn("text-sm font-medium truncate", isFill ? `${fillText} opacity-90` : "text-slate-500")}>{ml(w.titleJson)}</p>
            <p className={cn("text-3xl font-bold mt-1", isFill ? fillText : "text-slate-800")}>{formatValue(value, w.format, currencySymbol)}</p>
          </div>
          {Icon && (
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                isFill ? (fillDark ? "bg-black/10" : "bg-white/20") : colorClass,
              )}
            >
              <Icon className={cn("w-6 h-6", isFill ? fillText : "text-white")} />
            </div>
          )}
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
  isDragSource,
  isDropTarget,
  ml,
  t,
  onResize,
  onMove,
  onEdit,
  onDelete,
  onDragStartCell,
  onDragEnterCell,
  onDropCell,
  onDragEndCell,
}: {
  w: DashboardWidget;
  index: number;
  total: number;
  busy: boolean;
  isDragSource: boolean;
  isDropTarget: boolean;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
  onResize: (patch: { gridW?: number; gridH?: number }) => void;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStartCell: () => void;
  onDragEnterCell: () => void;
  onDropCell: () => void;
  onDragEndCell: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const Icon = w.icon ? getIconComponent(w.icon, LayoutDashboard) : null;
  const widgetType = w.config.widgetType;
  const summary =
    widgetType === "chart"
      ? `${t("dash.chartWidget", "График")} · ${w.config.chart?.type ?? ""}`
      : widgetType === "table"
        ? `${t("dash.tableWidget", "Таблица")} · ${t("dash.columnsCount", "Колонок")}: ${w.config.table?.fieldKeys?.length ?? 0}`
        : `${t("dash.metricsCount", "Метрик")}: ${w.config.metrics?.length ?? 0}${w.config.formula ? ` · ${t("dash.hasFormula", "формула")}` : ""}`;
  return (
    <div
      className={cn("min-w-0", isDragSource && "opacity-40")}
      style={{
        gridColumn: `span ${Math.min(Math.max(w.gridW || 1, 1), GRID_COLS)}`,
        gridRow: `span ${Math.min(Math.max(w.gridH || 1, 1), GRID_ROWS_MAX)}`,
      }}
      draggable={armed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStartCell();
      }}
      onDragEnter={onDragEnterCell}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropCell();
        setArmed(false);
      }}
      onDragEnd={() => {
        setArmed(false);
        onDragEndCell();
      }}
    >
      <Card
        className={cn(
          "h-full border-dashed border-slate-300 shadow-sm transition-colors",
          isDropTarget && "border-solid border-blue-500 ring-2 ring-blue-400",
        )}
      >
        <CardContent className="flex h-full flex-col justify-between gap-1.5 p-3 overflow-hidden">
          <div className="flex items-center gap-2">
            <span
              className="shrink-0 cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
              title={t("dash.dragHint", "Перетащите, чтобы изменить порядок")}
              onMouseDown={() => setArmed(true)}
              onMouseUp={() => setArmed(false)}
            >
              <GripVertical className="w-4 h-4" />
            </span>
            {Icon && (
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${w.color || DEFAULT_COLOR}`}>
                <Icon className="w-3.5 h-3.5 text-white" />
              </div>
            )}
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

export default function DashboardView({ pageId, embedded = false }: { pageId: number; embedded?: boolean }) {
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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const { data: widgetData = [], isLoading } = useGetDashboardData(pageId);
  const { data: editWidgets = [] } = useListDashboardWidgets(pageId, {
    query: { enabled: isEditor && editMode, queryKey: getListDashboardWidgetsQueryKey(pageId) },
  });
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const currencySymbol = settings?.currencySymbol || "₽";

  const [, setLocation] = useLocation();
  const { data: pages = [] } = useListPages();
  const { data: navEntities = [] } = useListEntities();
  const thisPage = pages.find((p) => p.id === pageId);

  // Resolve the records page path bound to a table widget's entity (if any), so
  // rows can deep-link to the record and the footer can link to the full table.
  const tableNavPath = (w: DashboardWidgetData): string | null => {
    if (w.widgetType !== "table" || w.tableEntityId == null) return null;
    const ent = navEntities.find((e) => e.id === w.tableEntityId);
    if (!ent || ent.pageId == null) return null;
    const pg = pages.find((p) => p.id === ent.pageId);
    return pg?.path ?? null;
  };

  // Collapse/expand for the embedded analytics block. null = no stored user
  // preference yet; once the page loads we fall back to its admin default.
  const collapseStorageKey = `erp.widgets.collapsed.${pageId}`;
  const [collapsed, setCollapsed] = useState<boolean | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(`erp.widgets.collapsed.${pageId}`);
    return raw === "1" ? true : raw === "0" ? false : null;
  });
  // Rehydrate per page: when pageId changes, reload this page's stored override
  // (or null so the admin default is re-applied) instead of leaking prior state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(`erp.widgets.collapsed.${pageId}`);
    setCollapsed(raw === "1" ? true : raw === "0" ? false : null);
  }, [pageId]);
  useEffect(() => {
    if (collapsed === null && thisPage) {
      setCollapsed(thisPage.widgetsCollapsedDefault ?? false);
    }
  }, [collapsed, thisPage]);
  const isCollapsed = embedded && collapsed === true;
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const base = prev ?? (thisPage?.widgetsCollapsedDefault ?? false);
      const next = !base;
      try {
        window.localStorage.setItem(collapseStorageKey, next ? "1" : "0");
      } catch {
        /* localStorage unavailable */
      }
      return next;
    });
  };

  const updatePageMutation = useUpdatePage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPagesQueryKey() });
        toast({ title: t("dash.saved", "Сохранено") });
      },
      onError: () => toast({ title: t("dash.saveError", "Ошибка сохранения"), variant: "destructive" }),
    },
  });
  const setDefaultCollapsed = (v: boolean) => {
    if (!thisPage) return;
    updatePageMutation.mutate({ id: pageId, data: { widgetsCollapsedDefault: v } });
  };

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
  const notesContentMutation = useUpdateNotesContent({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: t("dash.saveError", "Ошибка сохранения виджета"), variant: "destructive" }),
    },
  });
  const saveNotesContent = (wid: number, data: NotesContentInput) => notesContentMutation.mutate({ wid, data });

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

  // Drag-to-reorder: splice the dragged widget into its drop position, then
  // re-assign the existing sortOrder pool (sorted ascending) to the new
  // sequence so only the affected widgets change. Persists via the same
  // transactional reorder endpoint the arrows use — no parallel ordering field.
  const reorderByDrag = (from: number, to: number) => {
    if (from === to) return;
    const arr = [...sortedEdit];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    const orders = sortedEdit.map((w) => w.sortOrder).sort((a, b) => a - b);
    const items = arr
      .map((w, i) => ({ id: w.id, sortOrder: orders[i], prev: w.sortOrder }))
      .filter((it) => it.sortOrder !== it.prev)
      .map(({ id, sortOrder }) => ({ id, sortOrder }));
    if (items.length === 0) return;
    reorderMutation.mutate({ data: { items } });
  };

  const handleDrop = (to: number) => {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from == null) return;
    reorderByDrag(from, to);
  };

  const openCreate = () => { setEditingWidget(null); setDialogOpen(true); };
  const openEdit = (w: DashboardWidget) => { setEditingWidget(w); setDialogOpen(true); };

  // Embedded above a records table: stay invisible (no empty card, no skeleton
  // flash) for viewers without widgets. Editors still see the toggle so they can
  // add the first widget.
  if (embedded && !isEditor && sortedData.length === 0) return null;

  return (
    <div className="space-y-4">
      {(isEditor || embedded) && (
        <div className={cn("flex items-center gap-2", embedded ? "justify-between" : "justify-end")}>
          {embedded ? (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-800"
              title={isCollapsed ? t("dash.expand", "Развернуть") : t("dash.collapse", "Свернуть")}
            >
              {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              {t("dash.analyticsSection", "Аналитика")}
            </button>
          ) : null}
          {isEditor && (
            <div className="flex items-center gap-2">
              {editMode && embedded && (
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                  <Checkbox
                    checked={thisPage?.widgetsCollapsedDefault ?? false}
                    onCheckedChange={(v) => setDefaultCollapsed(v === true)}
                    disabled={updatePageMutation.isPending}
                  />
                  {t("dash.collapsedDefault", "Свёрнуто по умолчанию")}
                </label>
              )}
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
        </div>
      )}

      {(!isCollapsed || editMode) && (
      isLoading ? (
        embedded ? null : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
        )
      ) : editMode ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 auto-rows-[8rem]">
          {sortedEdit.map((w, i) => (
            <EditWidgetCell
              key={w.id}
              w={w}
              index={i}
              total={sortedEdit.length}
              busy={resizeMutation.isPending || reorderMutation.isPending}
              isDragSource={dragIndex === i}
              isDropTarget={overIndex === i && dragIndex !== null && dragIndex !== i}
              ml={ml}
              t={t}
              onResize={(patch) => resize(w, patch)}
              onMove={(dir) => move(i, dir)}
              onEdit={() => openEdit(w)}
              onDelete={() => setDeleteWidget(w)}
              onDragStartCell={() => setDragIndex(i)}
              onDragEnterCell={() => setOverIndex(i)}
              onDropCell={() => handleDrop(i)}
              onDragEndCell={() => { setDragIndex(null); setOverIndex(null); }}
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
        embedded ? null : (
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="text-center py-16 text-slate-400">
              {t("dash.emptyViewer", "На этой панели пока нет виджетов")}
            </CardContent>
          </Card>
        )
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 auto-rows-[8rem]"
        >
          {sortedData.map((w) => {
            const navPath = tableNavPath(w);
            return (
              <div
                key={w.id}
                className="min-w-0"
                style={{
                  gridColumn: `span ${Math.min(Math.max(w.gridW || 1, 1), GRID_COLS)}`,
                  gridRow: `span ${Math.min(Math.max(w.gridH || 1, 1), GRID_ROWS_MAX)}`,
                }}
              >
                <WidgetCard
                  w={w}
                  ml={ml}
                  currencySymbol={currencySymbol}
                  t={t}
                  onOpenRecord={navPath ? (id) => setLocation(`${navPath}?record=${id}`) : undefined}
                  onViewAll={navPath ? () => setLocation(navPath) : undefined}
                  onSaveNotesContent={saveNotesContent}
                  savingNotesContent={notesContentMutation.isPending}
                />
              </div>
            );
          })}
        </div>
      )
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
  relationId: number | null;
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

type TableRelatedColumnDraft = { relationId: number; relatedFieldKey: string };

type TableDraft = {
  entityId: number | null;
  fieldKeys: string[];
  statusIds: number[];
  limit: number;
  relatedColumns: TableRelatedColumnDraft[];
};

type WidgetTypeChoice = "metric" | "chart" | "table" | "notes";

type NoteSourceDraft = {
  key: string;
  sourceKind: "metric" | "record";
  entityId: number | null;
  aggregation: "count" | "sum";
  fieldKey: string | null;
  relationId: number | null;
  statusIds: number[];
  recordId: number | null;
};

type NoteCellDraft = {
  kind: "static" | "dynamic";
  text: string;
  sources: NoteSourceDraft[];
  formula: string;
  format: string;
};

type NotesDraft = {
  mode: "richtext" | "table";
  html: string;
  cols: number;
  cells: NoteCellDraft[][];
  editableRoleIds: number[];
};

function emptyStaticCell(): NoteCellDraft {
  return { kind: "static", text: "", sources: [], formula: "", format: "number" };
}

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
        : widget?.config.widgetType === "notes"
          ? "notes"
          : "metric",
  );
  const [icon, setIcon] = useState(widget ? (widget.icon ?? "") : "");
  const [color, setColor] = useState(widget?.color || DEFAULT_COLOR);
  const [colorStyle, setColorStyle] = useState<"icon" | "border" | "fill">(widget?.config.colorStyle ?? "icon");
  const [textColor, setTextColor] = useState<"light" | "dark">(widget?.config.textColor ?? "light");
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
          relationId: m.relationId ?? null,
        }))
      : [{ key: "m1", entityId: null, aggregation: "count", fieldKey: null, statusIds: [], relationId: null }],
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
      relatedColumns: (tb?.relatedColumns ?? []).map((rc) => ({ relationId: rc.relationId, relatedFieldKey: rc.relatedFieldKey })),
    };
  });

  const [notes, setNotes] = useState<NotesDraft>(() => {
    const nt = widget?.config.notes;
    if (nt?.kind === "table") {
      const cells: NoteCellDraft[][] = (nt.cells ?? []).map((row) =>
        (row ?? []).map((c): NoteCellDraft => ({
          kind: c.kind === "dynamic" ? "dynamic" : "static",
          text: c.text ?? "",
          formula: c.formula ?? "",
          format: c.format ?? "number",
          sources: (c.sources ?? []).map((s, si): NoteSourceDraft => ({
            key: s.key || `s${si + 1}`,
            sourceKind: s.sourceKind === "record" ? "record" : "metric",
            entityId: s.entityId ?? null,
            aggregation: s.aggregation === "sum" ? "sum" : "count",
            fieldKey: s.fieldKey ?? null,
            relationId: s.relationId ?? null,
            statusIds: s.statusIds ?? [],
            recordId: s.recordId ?? null,
          })),
        })),
      );
      const cols = nt.cols ?? (cells[0]?.length ?? 2);
      return {
        mode: "table",
        html: "",
        cols,
        cells: cells.length > 0 ? cells : [[emptyStaticCell(), emptyStaticCell()]],
        editableRoleIds: nt.editableRoleIds ?? [],
      };
    }
    return {
      mode: "richtext",
      html: nt?.html ?? "",
      cols: 2,
      cells: [[emptyStaticCell(), emptyStaticCell()]],
      editableRoleIds: nt?.editableRoleIds ?? [],
    };
  });

  const updateMetric = (i: number, patch: Partial<DraftMetric>) =>
    setMetrics((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const addMetric = () =>
    setMetrics((prev) => [...prev, { key: `m${prev.length + 1}`, entityId: null, aggregation: "count", fieldKey: null, statusIds: [], relationId: null }]);

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

    if (widgetType === "notes") {
      if (notes.mode === "table") {
        const cells: NoteCell[][] = [];
        for (const row of notes.cells) {
          const outRow: NoteCell[] = [];
          for (const cell of row) {
            if (cell.kind === "static") {
              outRow.push({ kind: "static", text: cell.text });
              continue;
            }
            const keys = new Set<string>();
            const sources: NoteCellSource[] = [];
            for (const s of cell.sources) {
              if (!s.key || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s.key)) {
                toast({ title: t("dash.invalidKey", "Некорректный ключ метрики (латиница/цифры/_)"), variant: "destructive" });
                return null;
              }
              if (keys.has(s.key)) {
                toast({ title: t("dash.dupKey", "Ключи метрик должны быть уникальны"), variant: "destructive" });
                return null;
              }
              keys.add(s.key);
              if (s.entityId == null) {
                toast({ title: t("dash.notesSourceNeedsEntity", "Выберите сущность для значения"), variant: "destructive" });
                return null;
              }
              if (s.sourceKind === "record") {
                if (s.recordId == null || !s.fieldKey) {
                  toast({ title: t("dash.notesRecordNeedsField", "Выберите запись и поле"), variant: "destructive" });
                  return null;
                }
                sources.push({
                  key: s.key,
                  sourceKind: "record",
                  entityId: s.entityId,
                  recordId: s.recordId,
                  fieldKey: s.fieldKey,
                });
              } else {
                if (s.aggregation === "sum" && !s.fieldKey) {
                  toast({ title: t("dash.metricNeedsField", "Для суммы выберите числовое поле"), variant: "destructive" });
                  return null;
                }
                sources.push({
                  key: s.key,
                  sourceKind: "metric",
                  entityId: s.entityId,
                  aggregation: s.aggregation,
                  fieldKey: s.aggregation === "sum" ? s.fieldKey : null,
                  relationId: s.relationId,
                  statusIds: s.statusIds.length > 0 ? s.statusIds : null,
                });
              }
            }
            if (sources.length === 0) {
              toast({ title: t("dash.notesCellNeedsSource", "Добавьте хотя бы одно значение в ячейку"), variant: "destructive" });
              return null;
            }
            outRow.push({
              kind: "dynamic",
              sources,
              formula: cell.formula.trim() || null,
              format: cell.format as NoteCellFormat,
            });
          }
          cells.push(outRow);
        }
        return {
          ...base,
          config: {
            widgetType: "notes",
            colorStyle,
            textColor,
            notes: {
              kind: "table",
              cols: notes.cols,
              cells,
              editableRoleIds: notes.editableRoleIds.length > 0 ? notes.editableRoleIds : null,
            },
          },
        };
      }
      return {
        ...base,
        config: {
          widgetType: "notes",
          colorStyle,
          textColor,
          notes: {
            kind: "richtext",
            html: notes.html,
            editableRoleIds: notes.editableRoleIds.length > 0 ? notes.editableRoleIds : null,
          },
        },
      };
    }

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
          colorStyle,
          textColor,
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
      if (table.fieldKeys.length === 0 && table.relatedColumns.length === 0) {
        toast({ title: t("dash.tableNeedsColumns", "Выберите хотя бы одну колонку"), variant: "destructive" });
        return null;
      }
      return {
        ...base,
        config: {
          widgetType: "table",
          colorStyle,
          textColor,
          table: {
            entityId: table.entityId,
            fieldKeys: table.fieldKeys,
            statusIds: table.statusIds.length > 0 ? table.statusIds : null,
            limit: table.limit,
            relatedColumns: table.relatedColumns.length > 0 ? table.relatedColumns : null,
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
        colorStyle,
        textColor,
        metrics: metrics.map<WidgetMetric>((m) => ({
          key: m.key,
          entityId: m.entityId as number,
          aggregation: m.aggregation,
          // For related metrics, fieldKey targets the related entity's numeric
          // field (sum); count keeps no fieldKey. For direct metrics it is the
          // base entity's numeric field on sum only.
          fieldKey: m.aggregation === "sum" ? m.fieldKey : null,
          statusIds: m.statusIds.length > 0 ? m.statusIds : null,
          relationId: m.relationId ?? null,
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
                  <SelectItem value="notes">{t("dash.typeNotes", "Заметки")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {widgetType !== "notes" && (
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
            )}
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

          {widgetType === "metric" && (
            <div className="space-y-1.5">
              <Label>{t("dash.colorStyle", "Применение цвета")}</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["icon", t("dash.colorStyleIcon", "Иконка")],
                  ["border", t("dash.colorStyleBorder", "Обводка")],
                  ["fill", t("dash.colorStyleFill", "Заливка")],
                ] as const).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setColorStyle(val)}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-sm transition-colors",
                      colorStyle === val
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {colorStyle === "fill" && (
                <div className="pt-1">
                  <Label className="text-xs text-slate-500">{t("dash.textColor", "Цвет шрифта")}</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {([
                      ["light", t("dash.textColorLight", "Светлый")],
                      ["dark", t("dash.textColorDark", "Тёмный")],
                    ] as const).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setTextColor(val)}
                        className={cn(
                          "rounded-md border px-2 py-1.5 text-sm transition-colors",
                          textColor === val
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {widgetType === "notes" ? (
            <NotesEditor notes={notes} entities={entities} roles={roles} onChange={setNotes} ml={ml} t={t} />
          ) : widgetType === "chart" ? (
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
  const { data: relationOptions } = useGetEntityRelationOptions(table.entityId ?? 0, {
    query: { enabled: table.entityId != null, queryKey: getGetEntityRelationOptionsQueryKey(table.entityId ?? 0) },
  });
  const relations = relationOptions?.options ?? [];

  const toggleColumn = (key: string) => {
    const next = table.fieldKeys.includes(key)
      ? table.fieldKeys.filter((k) => k !== key)
      : [...table.fieldKeys, key];
    onChange({ fieldKeys: next });
  };

  const isRelatedSelected = (relationId: number, relatedFieldKey: string) =>
    table.relatedColumns.some((rc) => rc.relationId === relationId && rc.relatedFieldKey === relatedFieldKey);

  const toggleRelatedColumn = (relationId: number, relatedFieldKey: string) => {
    const next = isRelatedSelected(relationId, relatedFieldKey)
      ? table.relatedColumns.filter((rc) => !(rc.relationId === relationId && rc.relatedFieldKey === relatedFieldKey))
      : [...table.relatedColumns, { relationId, relatedFieldKey }];
    onChange({ relatedColumns: next });
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
          onValueChange={(v) => onChange({ entityId: Number(v), fieldKeys: [], statusIds: [], relatedColumns: [] })}
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
            <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
              <Checkbox checked={table.fieldKeys.includes(STATUS_COLUMN_KEY)} onCheckedChange={() => toggleColumn(STATUS_COLUMN_KEY)} />
              {t("dash.statusColumn", "Статус")}
            </label>
          </div>
        )}
      </div>

      {table.entityId != null && relations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-400">{t("dash.tableRelatedColumns", "Связанные колонки")}</p>
          <div className="space-y-2 max-h-44 overflow-auto rounded-md border border-slate-100 p-2">
            {relations.map((r) => (
              <div key={r.relationId} className="space-y-1">
                <p className="text-xs font-medium text-slate-500">{ml(r.label)} → {ml(r.relatedEntityLabel)}</p>
                {r.fields.length === 0 ? (
                  <p className="pl-2 text-[11px] text-slate-400">{t("dash.noFields", "Нет полей")}</p>
                ) : (
                  r.fields.map((f) => (
                    <label key={`${r.relationId}_${f.key}`} className="flex items-center gap-2 pl-2 text-sm">
                      <Checkbox
                        checked={isRelatedSelected(r.relationId, f.key)}
                        onCheckedChange={() => toggleRelatedColumn(r.relationId, f.key)}
                      />
                      {ml(f.label)}
                    </label>
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
  const { data: relationOptions } = useGetEntityRelationOptions(metric.entityId ?? 0, {
    query: { enabled: metric.entityId != null, queryKey: getGetEntityRelationOptionsQueryKey(metric.entityId ?? 0) },
  });
  const relations = relationOptions?.options ?? [];
  const selectedRelation = relations.find((r) => r.relationId === metric.relationId);
  // For sum: when a relation is chosen, numeric fields come from the related
  // entity; otherwise from the base entity. Normalize both to {key,label}.
  const numericFields: { key: string; label: unknown }[] =
    metric.relationId != null
      ? (selectedRelation?.fields ?? [])
          .filter((f) => f.fieldType === "number")
          .map((f) => ({ key: f.key, label: f.label }))
      : fields
          .filter((f: Field) => f.fieldType === "number")
          .map((f: Field) => ({ key: f.fieldKey, label: f.nameJson }));

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
          onValueChange={(v) => onChange({ entityId: Number(v), fieldKey: null, statusIds: [], relationId: null })}
        >
          <SelectTrigger className="h-8"><SelectValue placeholder={t("dash.selectEntity", "Сущность")} /></SelectTrigger>
          <SelectContent>
            {entities.filter((e) => e.isActive).map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>{ml(e.nameJson)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={metric.aggregation} onValueChange={(v) => onChange({ aggregation: v as "count" | "sum", fieldKey: null })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="count">{t("dash.aggCount", "Количество")}</SelectItem>
            <SelectItem value="sum">{t("dash.aggSum", "Сумма")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {metric.entityId != null && relations.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-slate-400">{t("dash.metricRelation", "Связь (необязательно)")}</p>
          <Select
            value={metric.relationId != null ? String(metric.relationId) : "__none__"}
            onValueChange={(v) => onChange({ relationId: v === "__none__" ? null : Number(v), fieldKey: null })}
          >
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("dash.metricNoRelation", "Без связи (по самой сущности)")}</SelectItem>
              {relations.map((r) => (
                <SelectItem key={r.relationId} value={String(r.relationId)}>
                  {ml(r.label)} → {ml(r.relatedEntityLabel)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {metric.relationId != null && (
            <p className="text-[11px] text-slate-400">
              {metric.aggregation === "count"
                ? t("dash.metricRelationCountHint", "Считает связанные записи")
                : t("dash.metricRelationSumHint", "Суммирует поле связанной записи")}
            </p>
          )}
        </div>
      )}
      {metric.aggregation === "sum" && (
        <Select
          value={metric.fieldKey ?? ""}
          onValueChange={(v) => onChange({ fieldKey: v })}
          disabled={metric.entityId == null || (metric.relationId != null && !selectedRelation)}
        >
          <SelectTrigger className="h-8">
            <SelectValue placeholder={metric.relationId != null ? t("dash.selectRelatedField", "Поле связанной записи") : t("dash.selectField", "Числовое поле")} />
          </SelectTrigger>
          <SelectContent>
            {numericFields.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-slate-400">{t("dash.noNumericFields", "Нет числовых полей")}</div>
            ) : (
              numericFields.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {ml(f.label)}
                </SelectItem>
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

/**
 * Toolbar text-color picker for the notes rich-text editor. Uses the same
 * react-colorful picker + shared saved-colors palette as conditional formatting
 * (NOT the native OS color dialog) so picked colors can be saved and reused.
 */
function NotesColorButton({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (hex: string) => void;
  t: (key: string, fallback: string) => string;
}) {
  const [presets, setPresets] = useState<string[]>(() => loadColorPresets());
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  const current = valid ? value : "#111827";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("dash.notesColor", "Цвет текста")}
          onMouseDown={(e) => e.preventDefault()}
          className="flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100"
        >
          <span className="h-3.5 w-3.5 rounded-sm border border-slate-300" style={{ backgroundColor: current }} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="format-color-picker">
          <HexColorPicker color={current} onChange={onChange} />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Input
            className="h-7 w-[150px] font-mono text-xs"
            value={value}
            onChange={(e) => {
              const v = e.target.value.trim();
              onChange(v === "" ? "" : v.startsWith("#") ? v : `#${v}`);
            }}
            placeholder="#RRGGBB"
            spellCheck={false}
          />
          <button
            type="button"
            disabled={!valid}
            onClick={() => setPresets((prev) => addColorPreset(prev, value.toUpperCase()))}
            className="flex h-7 items-center gap-1 rounded border border-slate-200 px-2 text-xs text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            title={t("fields.savePreset", "Сохранить цвет в палитру")}
          >
            <Star className="h-3.5 w-3.5" />
            {t("fields.savePreset", "Сохранить")}
          </button>
        </div>
        <div className="mt-3 w-[200px]">
          <p className="mb-1 text-xs text-slate-500">{t("fields.savedColors", "Сохранённые цвета")}</p>
          {presets.length === 0 ? (
            <p className="text-xs text-slate-400">{t("fields.noSavedColors", "Пока пусто — сохраните цвет кнопкой ★")}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <div key={p} className="group relative">
                  <button
                    type="button"
                    onClick={() => onChange(p)}
                    className="h-6 w-6 shrink-0 rounded border border-slate-200"
                    style={{ backgroundColor: p }}
                    title={p}
                    aria-label={`${t("fields.useColor", "Использовать цвет")} ${p}`}
                  />
                  <button
                    type="button"
                    onClick={() => setPresets((prev) => removeColorPreset(prev, p))}
                    className="absolute -right-1.5 -top-1.5 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-600 text-white group-hover:flex"
                    title={t("fields.removePreset", "Удалить из палитры")}
                    aria-label={`${t("fields.removePreset", "Удалить из палитры")} ${p}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RtBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100",
        active && "bg-blue-100 text-blue-700",
      )}
    >
      {children}
    </button>
  );
}

/** Tiptap-based rich-text editor with an extended formatting toolbar. */
function RichTextEditor({
  html,
  onChange,
  t,
}: {
  html: string;
  onChange: (html: string) => void;
  t: (key: string, fallback: string) => string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: html || "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "notes-prose min-h-[140px] max-h-[300px] overflow-auto rounded-b-md border border-t-0 border-slate-200 px-3 py-2 text-sm focus:outline-none [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-blue-600 [&_a]:underline",
      },
    },
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
  });

  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt(t("dash.notesLinkPrompt", "Адрес ссылки (пусто — убрать)"), prev ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-md border border-slate-200 bg-slate-50 p-1">
        <RtBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title={t("dash.notesBold", "Жирный")}>
          <Bold className="h-3.5 w-3.5" />
        </RtBtn>
        <RtBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title={t("dash.notesItalic", "Курсив")}>
          <Italic className="h-3.5 w-3.5" />
        </RtBtn>
        <RtBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title={t("dash.notesUnderline", "Подчёркнутый")}>
          <UnderlineIcon className="h-3.5 w-3.5" />
        </RtBtn>
        <RtBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title={t("dash.notesStrike", "Зачёркнутый")}>
          <Strikethrough className="h-3.5 w-3.5" />
        </RtBtn>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <RtBtn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="H1">
          <Heading1 className="h-3.5 w-3.5" />
        </RtBtn>
        <RtBtn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="H2">
          <Heading2 className="h-3.5 w-3.5" />
        </RtBtn>
        <RtBtn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="H3">
          <Heading3 className="h-3.5 w-3.5" />
        </RtBtn>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <RtBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t("dash.notesBullet", "Маркированный список")}>
          <List className="h-3.5 w-3.5" />
        </RtBtn>
        <RtBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t("dash.notesOrdered", "Нумерованный список")}>
          <ListOrdered className="h-3.5 w-3.5" />
        </RtBtn>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <RtBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title={t("dash.notesAlignLeft", "По левому краю")}>
          <AlignLeft className="h-3.5 w-3.5" />
        </RtBtn>
        <RtBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title={t("dash.notesAlignCenter", "По центру")}>
          <AlignCenter className="h-3.5 w-3.5" />
        </RtBtn>
        <RtBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title={t("dash.notesAlignRight", "По правому краю")}>
          <AlignRight className="h-3.5 w-3.5" />
        </RtBtn>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <RtBtn active={editor.isActive("link")} onClick={setLink} title={t("dash.notesLink", "Ссылка")}>
          <Link2 className="h-3.5 w-3.5" />
        </RtBtn>
        <NotesColorButton
          value={(editor.getAttributes("textStyle").color as string) || ""}
          onChange={(hex) => editor.chain().focus().setColor(hex).run()}
          t={t}
        />
        <RtBtn onClick={() => editor.chain().focus().unsetColor().run()} title={t("dash.notesColorReset", "Сбросить цвет")}>
          <span className="text-[10px] font-bold">A×</span>
        </RtBtn>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

/** Loads records for an entity and lets the user pick one (for record-source cells). */
function RecordPicker({
  entityId,
  value,
  onChange,
  ml,
  t,
}: {
  entityId: number;
  value: number | null;
  onChange: (recordId: number | null) => void;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
}) {
  const [records, setRecords] = useState<EntityRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const queryRecords = useQueryEntityRecords();
  const { data: fields = [] } = useListEntityFields(entityId, {
    query: { enabled: entityId > 0, queryKey: getListEntityFieldsQueryKey(entityId) },
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    queryRecords
      .mutateAsync({ entityId, data: { pageSize: 200, page: 1 } })
      .then((res) => {
        if (!cancelled) setRecords(res.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  const labelFor = (rec: EntityRecord): string => {
    const vals = (rec.valuesJson ?? {}) as Record<string, unknown>;
    for (const f of fields) {
      const v = vals[f.fieldKey];
      if (typeof v === "string" && v.trim()) return v;
      if (typeof v === "number") return String(v);
    }
    return `#${rec.id}`;
  };

  return (
    <Select
      value={value != null ? String(value) : ""}
      onValueChange={(v) => onChange(Number(v))}
      disabled={loading}
    >
      <SelectTrigger className="h-8">
        <SelectValue placeholder={loading ? t("dash.loading", "Загрузка…") : t("dash.notesSelectRecord", "Запись")} />
      </SelectTrigger>
      <SelectContent>
        {records.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-slate-400">{t("dash.notesNoRecords", "Нет записей")}</div>
        ) : (
          records.map((r) => (
            <SelectItem key={r.id} value={String(r.id)}>
              {labelFor(r)}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

/** Editor for a single live-value source inside a dynamic notes cell. */
function NoteSourceEditor({
  source,
  index,
  entities,
  canRemove,
  onChange,
  onRemove,
  ml,
  t,
}: {
  source: NoteSourceDraft;
  index: number;
  entities: Entity[];
  canRemove: boolean;
  onChange: (patch: Partial<NoteSourceDraft>) => void;
  onRemove: () => void;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
}) {
  const { data: fields = [] } = useListEntityFields(source.entityId ?? 0, {
    query: { enabled: source.entityId != null, queryKey: getListEntityFieldsQueryKey(source.entityId ?? 0) },
  });
  const { data: statuses = [] } = useListEntityStatuses(source.entityId ?? 0, {
    query: { enabled: source.entityId != null, queryKey: getListEntityStatusesQueryKey(source.entityId ?? 0) },
  });
  const { data: relationOptions } = useGetEntityRelationOptions(source.entityId ?? 0, {
    query: { enabled: source.entityId != null && source.sourceKind === "metric", queryKey: getGetEntityRelationOptionsQueryKey(source.entityId ?? 0) },
  });
  const relations = relationOptions?.options ?? [];
  const selectedRelation = relations.find((r) => r.relationId === source.relationId);
  const numericFields: { key: string; label: unknown }[] =
    source.relationId != null
      ? (selectedRelation?.fields ?? []).filter((f) => f.fieldType === "number").map((f) => ({ key: f.key, label: f.label }))
      : fields.filter((f: Field) => f.fieldType === "number").map((f: Field) => ({ key: f.fieldKey, label: f.nameJson }));
  const allFields = fields.map((f: Field) => ({ key: f.fieldKey, label: f.nameJson }));

  const toggleStatus = (sid: number) => {
    const next = source.statusIds.includes(sid) ? source.statusIds.filter((s) => s !== sid) : [...source.statusIds, sid];
    onChange({ statusIds: next });
  };

  return (
    <div className="rounded-md bg-slate-50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">#{index + 1}</span>
        <Input
          value={source.key}
          onChange={(e) => onChange({ key: e.target.value })}
          placeholder={t("dash.metricKey", "ключ")}
          className="h-8 w-24 font-mono text-xs"
        />
        <Select value={source.sourceKind} onValueChange={(v) => onChange({ sourceKind: v as "metric" | "record", fieldKey: null, recordId: null, relationId: null, statusIds: [] })}>
          <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="metric">{t("dash.notesSourceMetric", "Агрегат сущности")}</SelectItem>
            <SelectItem value="record">{t("dash.notesSourceRecord", "Значение записи")}</SelectItem>
          </SelectContent>
        </Select>
        {canRemove && (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={onRemove}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <Select
        value={source.entityId != null ? String(source.entityId) : ""}
        onValueChange={(v) => onChange({ entityId: Number(v), fieldKey: null, recordId: null, relationId: null, statusIds: [] })}
      >
        <SelectTrigger className="h-8"><SelectValue placeholder={t("dash.selectEntity", "Сущность")} /></SelectTrigger>
        <SelectContent>
          {entities.filter((e) => e.isActive).map((e) => (
            <SelectItem key={e.id} value={String(e.id)}>{ml(e.nameJson)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {source.sourceKind === "record" ? (
        source.entityId != null && (
          <div className="grid grid-cols-2 gap-2">
            <RecordPicker entityId={source.entityId} value={source.recordId} onChange={(rid) => onChange({ recordId: rid })} ml={ml} t={t} />
            <Select value={source.fieldKey ?? ""} onValueChange={(v) => onChange({ fieldKey: v })}>
              <SelectTrigger className="h-8"><SelectValue placeholder={t("dash.selectField", "Поле")} /></SelectTrigger>
              <SelectContent>
                {allFields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>{ml(f.label)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Select value={source.aggregation} onValueChange={(v) => onChange({ aggregation: v as "count" | "sum", fieldKey: null })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="count">{t("dash.aggCount", "Количество")}</SelectItem>
                <SelectItem value="sum">{t("dash.aggSum", "Сумма")}</SelectItem>
              </SelectContent>
            </Select>
            {relations.length > 0 && (
              <Select
                value={source.relationId != null ? String(source.relationId) : "__none__"}
                onValueChange={(v) => onChange({ relationId: v === "__none__" ? null : Number(v), fieldKey: null })}
              >
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("dash.metricNoRelation", "Без связи (по самой сущности)")}</SelectItem>
                  {relations.map((r) => (
                    <SelectItem key={r.relationId} value={String(r.relationId)}>{ml(r.label)} → {ml(r.relatedEntityLabel)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {source.aggregation === "sum" && (
            <Select value={source.fieldKey ?? ""} onValueChange={(v) => onChange({ fieldKey: v })} disabled={source.entityId == null || (source.relationId != null && !selectedRelation)}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder={source.relationId != null ? t("dash.selectRelatedField", "Поле связанной записи") : t("dash.selectField", "Числовое поле")} />
              </SelectTrigger>
              <SelectContent>
                {numericFields.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-slate-400">{t("dash.noNumericFields", "Нет числовых полей")}</div>
                ) : (
                  numericFields.map((f) => (
                    <SelectItem key={f.key} value={f.key}>{ml(f.label)}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          )}
          {source.entityId != null && statuses.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-slate-400">{t("dash.statusFilter", "Статусы (пусто = все)")}</p>
              <div className="flex flex-wrap gap-1.5">
                {statuses.map((s: Status) => (
                  <button key={s.id} type="button" onClick={() => toggleStatus(s.id)} className={source.statusIds.includes(s.id) ? "" : "opacity-50"}>
                    <Badge style={{ backgroundColor: s.color }} className="border-0 text-white font-normal cursor-pointer">{ml(s.nameJson)}</Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Dialog to edit a single notes-table cell (static text or dynamic live value). */
function NoteCellDialog({
  cell,
  entities,
  onSave,
  onClose,
  ml,
  t,
}: {
  cell: NoteCellDraft;
  entities: Entity[];
  onSave: (cell: NoteCellDraft) => void;
  onClose: () => void;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
}) {
  const [draft, setDraft] = useState<NoteCellDraft>(cell);

  const addSource = () =>
    setDraft((p) => ({
      ...p,
      sources: [...p.sources, { key: `s${p.sources.length + 1}`, sourceKind: "metric", entityId: null, aggregation: "count", fieldKey: null, relationId: null, statusIds: [], recordId: null }],
    }));
  const updateSource = (i: number, patch: Partial<NoteSourceDraft>) =>
    setDraft((p) => ({ ...p, sources: p.sources.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  const removeSource = (i: number) => setDraft((p) => ({ ...p, sources: p.sources.filter((_, idx) => idx !== i) }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("dash.notesEditCell", "Ячейка")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            {([
              ["static", t("dash.notesCellStatic", "Текст")],
              ["dynamic", t("dash.notesCellDynamic", "Живое значение")],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setDraft((p) => ({ ...p, kind: val }))}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-sm transition-colors",
                  draft.kind === val ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {draft.kind === "static" ? (
            <div className="space-y-1.5">
              <Label>{t("dash.notesCellText", "Текст ячейки")}</Label>
              <Textarea value={draft.text} onChange={(e) => setDraft((p) => ({ ...p, text: e.target.value }))} rows={3} />
            </div>
          ) : (
            <>
              <div className="space-y-2 rounded-md border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <Label>{t("dash.notesSources", "Значения")}</Label>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addSource}>
                    <Plus className="w-3.5 h-3.5" />
                    {t("dash.notesAddSource", "Значение")}
                  </Button>
                </div>
                {draft.sources.length === 0 && (
                  <p className="text-xs text-slate-400">{t("dash.notesCellNeedsSource", "Добавьте хотя бы одно значение в ячейку")}</p>
                )}
                {draft.sources.map((s, i) => (
                  <NoteSourceEditor
                    key={i}
                    source={s}
                    index={i}
                    entities={entities}
                    canRemove
                    onChange={(patch) => updateSource(i, patch)}
                    onRemove={() => removeSource(i)}
                    ml={ml}
                    t={t}
                  />
                ))}
              </div>
              <div className="space-y-1.5">
                <Label>{t("dash.formula", "Формула (необязательно)")}</Label>
                <Input value={draft.formula} onChange={(e) => setDraft((p) => ({ ...p, formula: e.target.value }))} placeholder="{s1} / {s2} * 100" />
                <p className="text-xs text-slate-400">{t("dash.notesFormulaHint", "Комбинируйте значения по ключу: {s1}. Без формулы показывается первое значение.")}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{t("dash.format", "Формат")}</Label>
                <Select value={draft.format} onValueChange={(v) => setDraft((p) => ({ ...p, format: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="number">{t("dash.formatNumber", "Число")}</SelectItem>
                    <SelectItem value="currency">{t("dash.formatCurrency", "Валюта")}</SelectItem>
                    <SelectItem value="percent">{t("dash.formatPercent", "Процент")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("dash.cancel", "Отмена")}</Button>
          <Button onClick={() => onSave(draft)} className="bg-blue-600 hover:bg-blue-700">{t("dash.save", "Сохранить")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Editor for the notes widget: mode toggle (rich-text vs free-form table). */
function NotesEditor({
  notes,
  entities,
  roles,
  onChange,
  ml,
  t,
}: {
  notes: NotesDraft;
  entities: Entity[];
  roles: Role[];
  onChange: (next: NotesDraft) => void;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
}) {
  const [editing, setEditing] = useState<{ ri: number; ci: number } | null>(null);
  const toggleEditableRole = (roleId: number) =>
    onChange({
      ...notes,
      editableRoleIds: notes.editableRoleIds.includes(roleId)
        ? notes.editableRoleIds.filter((r) => r !== roleId)
        : [...notes.editableRoleIds, roleId],
    });

  const addRow = () => {
    const row: NoteCellDraft[] = Array.from({ length: notes.cols }, () => emptyStaticCell());
    onChange({ ...notes, cells: [...notes.cells, row] });
  };
  const removeRow = (ri: number) => onChange({ ...notes, cells: notes.cells.filter((_, idx) => idx !== ri) });
  const addCol = () =>
    onChange({ ...notes, cols: notes.cols + 1, cells: notes.cells.map((r) => [...r, emptyStaticCell()]) });
  const removeCol = (ci: number) => {
    if (notes.cols <= 1) return;
    onChange({ ...notes, cols: notes.cols - 1, cells: notes.cells.map((r) => r.filter((_, idx) => idx !== ci)) });
  };
  const updateCell = (ri: number, ci: number, cell: NoteCellDraft) =>
    onChange({ ...notes, cells: notes.cells.map((r, rIdx) => (rIdx === ri ? r.map((c, cIdx) => (cIdx === ci ? cell : c)) : r)) });

  const cellPreview = (c: NoteCellDraft): string => {
    if (c.kind === "static") return c.text?.trim() || t("dash.notesEmptyCell", "(пусто)");
    if (c.sources.length === 0) return t("dash.notesCellNeedsSourceShort", "значение…");
    return c.formula?.trim() ? c.formula : `{${c.sources[0].key}}`;
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {([
          ["richtext", t("dash.notesModeRich", "Форматированный текст")],
          ["table", t("dash.notesModeTable", "Таблица значений")],
        ] as const).map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => onChange({ ...notes, mode: val })}
            className={cn(
              "rounded-md border px-2 py-1.5 text-sm transition-colors",
              notes.mode === val ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {notes.mode === "richtext" ? (
        <RichTextEditor html={notes.html} onChange={(html) => onChange({ ...notes, html })} t={t} />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addRow}>
              <Plus className="w-3.5 h-3.5" />
              {t("dash.notesAddRow", "Строка")}
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addCol}>
              <Plus className="w-3.5 h-3.5" />
              {t("dash.notesAddCol", "Колонка")}
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {Array.from({ length: notes.cols }, (_, ci) => (
                    <th key={ci} className="border-b border-r border-slate-200 bg-slate-50 p-1 last:border-r-0">
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => removeCol(ci)} disabled={notes.cols <= 1} title={t("dash.notesRemoveCol", "Удалить колонку")}>
                        <Minus className="w-3.5 h-3.5" />
                      </Button>
                    </th>
                  ))}
                  <th className="border-b border-slate-200 bg-slate-50 p-1 w-8" />
                </tr>
              </thead>
              <tbody>
                {notes.cells.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((c, ci) => (
                      <td key={ci} className="border-b border-r border-slate-200 p-1 last:border-r-0 align-top">
                        <button
                          type="button"
                          onClick={() => setEditing({ ri, ci })}
                          className={cn(
                            "w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50",
                            c.kind === "dynamic" ? "font-mono text-blue-700" : "text-slate-600",
                          )}
                          title={cellPreview(c)}
                        >
                          {cellPreview(c)}
                        </button>
                      </td>
                    ))}
                    <td className="border-b border-slate-200 p-1 text-center align-middle">
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => removeRow(ri)} title={t("dash.notesRemoveRow", "Удалить строку")}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {notes.cells.length === 0 && (
            <p className="text-xs text-slate-400">{t("dash.notesTableEmpty", "Добавьте строки и колонки, затем нажмите на ячейку для настройки.")}</p>
          )}
        </div>
      )}

      <div className="space-y-1.5 rounded-md border border-slate-200 p-3">
        <p className="text-sm font-medium text-slate-700">
          {t("dash.notesEditableRoles", "Кто может редактировать содержимое")}
        </p>
        <p className="text-xs text-slate-400">
          {t("dash.notesEditableRolesHint", "Администраторы могут редактировать всегда. Отметьте роли, которым тоже разрешено менять содержимое прямо на странице.")}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {roles.length === 0 ? (
            <span className="text-xs text-slate-400">{t("dash.noRoles", "Нет ролей")}</span>
          ) : (
            roles.map((r: Role) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                <Checkbox
                  checked={notes.editableRoleIds.includes(r.id)}
                  onCheckedChange={() => toggleEditableRole(r.id)}
                />
                {ml(r.nameJson)}
              </label>
            ))
          )}
        </div>
      </div>

      {editing && (
        <NoteCellDialog
          cell={notes.cells[editing.ri][editing.ci]}
          entities={entities}
          onSave={(cell) => {
            updateCell(editing.ri, editing.ci, cell);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
          ml={ml}
          t={t}
        />
      )}
    </div>
  );
}
