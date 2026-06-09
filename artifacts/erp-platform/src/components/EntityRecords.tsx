import { useState, useEffect, useMemo, useRef, useCallback, type CSSProperties } from "react";
import {
  useListEntityRecords,
  useGetRecord,
  getGetRecordQueryKey,
  useCreateEntityRecord,
  useUpdateRecord,
  useDeleteRecord,
  useListEntityFields,
  useReorderFields,
  useListEntityStatuses,
  useListEntityTransitions,
  useListEntityRelations,
  useListEntityViews,
  useQueryEntityRecords,
  useGetEntityFilterValues,
  useArchiveRecord,
  useUnarchiveRecord,
  useListRecordLinks,
  useCreateRecordLink,
  useDeleteRecordLink,
  useListUserOptions,
  useListRecordAuditLogs,
  useListPageFields,
  useListPageRecordValues,
  getListPageFieldsQueryKey,
  getListPageRecordValuesQueryKey,
  useSetPageRecordValues,
  useReorderPageFields,
  useGetPageRelatedValues,
  useGetPageRelatedCandidates,
  useSetPageRelatedLink,
  type PageField,
  type PageRelatedColumn,
  type PageRelatedValue,
  type PageRelatedCandidate,
  type ArchiveFilter,
  type AuditLogEntry,
  type EntityRecord,
  type Field,
  type Status,
  type Relation,
  type View,
  type ViewConfig,
  type Transition,
  type RecordQuery,
  type LinkedRecord,
  type UserOption,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  uploadFile,
  openObjectInNewTab,
  openGDriveInNewTab,
  fetchObjectBlobUrl,
  fetchGDriveBlobUrl,
  fetchGDriveThumbnailBlobUrl,
  detectUrlPreview,
  contentTypeKind,
  isFileValue,
  isGDriveFile,
  isLinkFile,
  fileAllowedSources,
  uploadToGoogleDrive,
  type FileValue,
  type FileSource,
} from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useML, useT } from "@/lib/i18n";
import { useGoogleDriveReady } from "@/lib/googleDrive";
import { FieldConfigDialog } from "@/components/FieldConfigDialog";
import { PageFieldConfigDialog } from "@/components/PageFieldConfigDialog";
import { formatFormulaResult, evaluateFormula } from "@/lib/formula";
import { computeRowFormatting, type FormatField } from "@/lib/formatRules";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, Inbox, Link2, X, Search, LayoutList, ChevronLeft, ChevronRight, ChevronDown, Star, ShieldAlert, Archive, ArchiveRestore, History, Settings2, Check, Filter, Upload, FileText, FileQuestion, Columns3, CircleDot, Share2, Workflow, Calendar as CalendarIcon, Cloud, ExternalLink } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import {
  format as formatDate,
  parseISO,
  addDays,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  endOfYear,
} from "date-fns";

const NO_STATUS = "__none__";
const NO_VIEW = "__all__";
const PAGE_SIZE = 50;

function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object" && "response" in err) {
    const resp = (err as { response?: { data?: { error?: string } } }).response;
    return resp?.data?.error;
  }
  return undefined;
}

type CellValue = string | number | boolean | FileValue;
type FormState = Record<string, CellValue>;

function emptyForField(field: Field): CellValue {
  if (field.fieldType === "boolean") return false;
  if (field.fieldType === "number") return "";
  return "";
}

function valueToForm(field: Field, value: unknown): CellValue {
  if (field.fieldType === "boolean") return value === true;
  if (field.fieldType === "number") return typeof value === "number" ? value : "";
  if (field.fieldType === "file") return isFileValue(value) ? value : "";
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** Build the payload values object from form state, dropping empty optional values. */
function formToValues(fields: Field[], form: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = form[field.fieldKey];
    if (field.fieldType === "boolean") {
      out[field.fieldKey] = Boolean(raw);
      continue;
    }
    if (raw === "" || raw === undefined || raw === null) continue;
    if (field.fieldType === "number") {
      out[field.fieldKey] = Number(raw);
    } else {
      out[field.fieldKey] = raw;
    }
  }
  return out;
}

function renderCellValue(field: Field, value: unknown, t: (key: string, def: string) => string, userNames?: Map<number, string>, textColor?: string): React.ReactNode {
  const colorStyle = textColor ? { color: textColor } : undefined;
  if (value === undefined || value === null || value === "")
    return <span className="text-slate-300" style={colorStyle}>—</span>;
  if (field.fieldType === "boolean") {
    return value ? (
      <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">{t("fields.yes", "Да")}</Badge>
    ) : (
      <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">{t("fields.no", "Нет")}</Badge>
    );
  }
  if (field.fieldType === "user") {
    const id = typeof value === "number" ? value : Number(value);
    const name = userNames?.get(id);
    return <span className="text-slate-700" style={colorStyle}>{name ?? `#${value}`}</span>;
  }
  if (field.fieldType === "url") {
    return <UrlPreviewCell url={String(value)} />;
  }
  if (field.fieldType === "file") {
    if (!isFileValue(value)) return <span className="text-slate-300" style={colorStyle}>—</span>;
    return <FileCell value={value} />;
  }
  return <span className="text-slate-700" style={colorStyle}>{String(value)}</span>;
}

/**
 * Auth-gated preview of a file fetched as a blob (image inline, pdf in an
 * iframe). `load` fetches a blob object URL (server object or proxied Drive
 * file); the loaded URL is revoked on cleanup.
 */
function BlobPreview({
  load,
  loadKey,
  contentType,
  name,
}: {
  load: () => Promise<string>;
  loadKey: string;
  contentType?: string;
  name: string;
}) {
  const t = useT();
  const kind = contentTypeKind(contentType, name);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (kind === "other") return;
    let active = true;
    let made: string | null = null;
    setUrl(null);
    setError(false);
    load()
      .then((u) => {
        if (active) {
          made = u;
          setUrl(u);
        } else {
          URL.revokeObjectURL(u);
        }
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, kind]);

  if (kind === "other") {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-slate-600">
        <FileQuestion className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="truncate">{name}</span>
      </div>
    );
  }
  if (error) {
    return <div className="py-3 text-sm text-red-500">{t("records.filePreviewError", "Не удалось загрузить предпросмотр")}</div>;
  }
  if (!url) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }
  if (kind === "image") {
    return <img src={url} alt={name} className="max-h-64 w-full rounded object-contain" />;
  }
  return <iframe src={`${url}#toolbar=0&navpanes=0&view=FitH`} title={name} className="h-80 w-full rounded border-0" />;
}

/**
 * Hover preview for a managed Google Drive file. Loads Google's fast thumbnail
 * first (a small rendered image, even for PDFs); if the file has no thumbnail,
 * falls back to the full-content proxy preview (image inline / pdf iframe).
 */
function GDrivePreview({ fileId, contentType, name }: { fileId: string; contentType?: string; name: string }) {
  const kind = contentTypeKind(contentType, name);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);

  useEffect(() => {
    if (kind === "other") return;
    let active = true;
    let made: string | null = null;
    setThumbUrl(null);
    setThumbFailed(false);
    fetchGDriveThumbnailBlobUrl(fileId)
      .then((u) => {
        if (active) {
          made = u;
          setThumbUrl(u);
        } else {
          URL.revokeObjectURL(u);
        }
      })
      .catch(() => active && setThumbFailed(true));
    return () => {
      active = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [fileId, kind]);

  if (kind === "other" || thumbFailed) {
    return (
      <BlobPreview
        load={() => fetchGDriveBlobUrl(fileId)}
        loadKey={`gdrive-full:${fileId}`}
        contentType={contentType}
        name={name}
      />
    );
  }
  if (!thumbUrl) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }
  return (
    <img
      src={thumbUrl}
      alt={name}
      className="max-h-64 w-full rounded object-contain"
      onError={() => {
        URL.revokeObjectURL(thumbUrl);
        setThumbUrl(null);
        setThumbFailed(true);
      }}
    />
  );
}

/** A filled file cell, rendered per source (server / Google Drive / link). */
function FileCell({ value }: { value: FileValue }) {
  const t = useT();
  if (isLinkFile(value)) {
    return <UrlPreviewCell url={value.url} label={value.name && value.name.trim() ? value.name : value.url} />;
  }

  const isGDrive = isGDriveFile(value);
  const open = () =>
    isGDrive ? openGDriveInNewTab(value.fileId) : openObjectInNewTab(value.path);
  const driveLink = isGDrive ? value.webViewLink : undefined;

  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <HoverCard openDelay={200}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void open();
            }}
            className="inline-flex max-w-full items-center gap-1.5 text-blue-600 hover:underline"
          >
            {isGDrive ? (
              <Cloud className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{value.name}</span>
          </button>
        </HoverCardTrigger>
        <HoverCardContent className="w-80 p-2" onClick={(e) => e.stopPropagation()}>
          {isGDrive && (
            <div className="mb-1.5 inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
              <Cloud className="h-3 w-3" />
              Google Drive
            </div>
          )}
          {isGDrive ? (
            <GDrivePreview fileId={value.fileId} contentType={value.contentType} name={value.name} />
          ) : (
            <BlobPreview
              load={() => fetchObjectBlobUrl(value.path)}
              loadKey={`server:${value.path}`}
              contentType={value.contentType}
              name={value.name}
            />
          )}
        </HoverCardContent>
      </HoverCard>
      {driveLink && (
        <a
          href={driveLink}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-slate-400 hover:text-emerald-600"
          title={t("records.openInDrive", "Открыть в Google Drive")}
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}

/** A url cell: a link, plus a hover preview when it points to an image, pdf, or Google Drive file. */
function UrlPreviewCell({ url, label }: { url: string; label?: string }) {
  const preview = detectUrlPreview(url);
  const link = (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {label ?? url}
    </a>
  );
  if (preview.kind === null) return link;
  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <span className="inline-block max-w-full truncate align-bottom">{link}</span>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 p-2" onClick={(e) => e.stopPropagation()}>
        {preview.kind === "image" ? (
          <img src={preview.src} alt={url} className="max-h-64 w-full rounded object-contain" />
        ) : (
          <iframe
            src={preview.kind === "pdf" ? `${preview.src}#toolbar=0&navpanes=0&view=FitH` : preview.src}
            title={url}
            className="h-80 w-full rounded border-0"
          />
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

// A dependent-filter dropdown for one opt-in field. Options are fetched lazily on open
// (so the list reflects the records matching the OTHER active filters) and picked as an `in` set.
function FieldFilterPopover({
  field,
  selected,
  onChange,
  getOptions,
  ml,
  t,
  userNames,
  triggerClassName,
}: {
  field: Field;
  selected: string[];
  onChange: (values: string[]) => void;
  getOptions: (fieldKey: string) => Promise<string[]>;
  ml: (v: unknown) => string;
  t: (key: string, def: string) => string;
  userNames: Map<number, string>;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [optSearch, setOptSearch] = useState("");

  const labelFor = (v: string): string => {
    if (field.fieldType === "user") return userNames.get(Number(v)) ?? `#${v}`;
    if (field.fieldType === "boolean") return v === "true" ? t("common.yes", "Да") : t("common.no", "Нет");
    return v;
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getOptions(field.fieldKey)
      .then((vals) => { if (!cancelled) setOptions(vals); })
      .catch(() => { if (!cancelled) setOptions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, getOptions, field.fieldKey]);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const q = optSearch.toLowerCase();
  const filtered = options.filter((v) => labelFor(v).toLowerCase().includes(q));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`h-9 gap-1.5 text-sm ${triggerClassName ?? ""} ${selected.length > 0 ? "border-blue-400 text-blue-700" : ""}`}
        >
          <span className="truncate">{ml(field.nameJson)}</span>
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-0.5 px-1.5">{selected.length}</Badge>
          )}
          <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0 sm:ml-0 ml-auto" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="p-2 border-b border-slate-100">
          <Input
            value={optSearch}
            onChange={(e) => setOptSearch(e.target.value)}
            placeholder={t("records.filterSearchValues", "Поиск значений…")}
            className="h-8 text-sm"
          />
        </div>
        <ScrollArea className="max-h-64">
          <div className="p-1">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-slate-400">
                {t("records.filterNoValues", "Нет значений")}
              </p>
            ) : (
              filtered.map((v) => (
                <label
                  key={v}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-sm"
                >
                  <Checkbox checked={selected.includes(v)} onCheckedChange={() => toggle(v)} />
                  <span className="truncate">{labelFor(v)}</span>
                </label>
              ))
            )}
          </div>
        </ScrollArea>
        {selected.length > 0 && (
          <div className="p-1.5 border-t border-slate-100">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs text-slate-500"
              onClick={() => onChange([])}
            >
              {t("records.filterClearField", "Очистить")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Inclusive day-string range stored per date field: { from, to } as "yyyy-MM-dd". */
export interface DateRangeFilter {
  from: string;
  to: string;
}

const DAY_FMT = "yyyy-MM-dd";

/** Filter popover for date/datetime fields: a range calendar plus quick presets. */
function DateFilterPopover({
  field,
  value,
  onChange,
  ml,
  t,
  triggerClassName,
}: {
  field: Field;
  value: DateRangeFilter | undefined;
  onChange: (value: DateRangeFilter | undefined) => void;
  ml: (v: unknown) => string;
  t: (key: string, def: string) => string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  // Local in-progress range so the user can build a range across two calendar clicks before it
  // commits to the parent (and triggers a query). Synced from the committed value on open.
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setDraft(value ? { from: parseISO(value.from), to: parseISO(value.to) } : undefined);
    }
  }, [open, value]);

  const commit = (from: Date, to: Date) => {
    setDraft({ from, to });
    onChange({ from: formatDate(from, DAY_FMT), to: formatDate(to, DAY_FMT) });
  };

  const clear = () => {
    setDraft(undefined);
    onChange(undefined);
  };

  const onSelect = (range: DateRange | undefined) => {
    setDraft(range);
    // Only commit (and run the query) once both ends are picked — clicking the same day twice
    // yields from===to (a single-day filter).
    if (range?.from && range?.to) {
      onChange({ from: formatDate(range.from, DAY_FMT), to: formatDate(range.to, DAY_FMT) });
    }
  };

  const presets: { label: string; run: () => void }[] = (() => {
    const today = new Date();
    return [
      { label: t("records.dateFilterToday", "Сегодня"), run: () => commit(today, today) },
      { label: t("records.dateFilter7days", "7 дней"), run: () => commit(subDays(today, 6), today) },
      { label: t("records.dateFilter30days", "30 дней"), run: () => commit(subDays(today, 29), today) },
      { label: t("records.dateFilterThisMonth", "Этот месяц"), run: () => commit(startOfMonth(today), endOfMonth(today)) },
      {
        label: t("records.dateFilterLastMonth", "Прошлый месяц"),
        run: () => {
          const prev = subMonths(today, 1);
          commit(startOfMonth(prev), endOfMonth(prev));
        },
      },
      { label: t("records.dateFilterThisYear", "Этот год"), run: () => commit(startOfYear(today), endOfYear(today)) },
      { label: t("records.dateFilterMax", "Максимум"), run: clear },
    ];
  })();

  const buttonLabel = (() => {
    if (!value) return null;
    const from = formatDate(parseISO(value.from), "dd.MM.yyyy");
    if (value.from === value.to) return from;
    return `${from} – ${formatDate(parseISO(value.to), "dd.MM.yyyy")}`;
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`h-9 gap-1.5 text-sm ${triggerClassName ?? ""} ${value ? "border-blue-400 text-blue-700" : ""}`}
        >
          <CalendarIcon className="w-3.5 h-3.5 opacity-70 shrink-0" />
          <span className="truncate">{ml(field.nameJson)}</span>
          {buttonLabel && (
            <Badge variant="secondary" className="ml-0.5 px-1.5 font-normal">{buttonLabel}</Badge>
          )}
          <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0 sm:ml-0 ml-auto" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-col gap-1 border-b border-slate-100 p-2 sm:border-b-0 sm:border-r">
            {presets.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 justify-start text-sm font-normal"
                onClick={p.run}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            numberOfMonths={1}
            defaultMonth={draft?.from}
            selected={draft}
            onSelect={onSelect}
          />
        </div>
        {value && (
          <div className="border-t border-slate-100 p-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-full text-xs text-slate-500"
              onClick={clear}
            >
              {t("records.filterClearField", "Очистить")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function EntityRecords({
  entityId,
  visibleFieldKeys,
  pageId,
  isMirror = false,
}: {
  entityId: number;
  /**
   * Display-level projection (used by mirror pages): when provided, only these
   * field keys are shown in the table and record dialog. This is purely cosmetic
   * — real per-field/per-row security is still enforced server-side by RBAC on
   * this entity. Null/empty means "all visible fields".
   */
  visibleFieldKeys?: string[];
  /**
   * Page id. When set, this records table is rendered inside a page (regular or
   * mirror) and may carry page-local fields and related columns: extra columns
   * whose definitions live on the page (not on the source entity). Adding a
   * column via "+ Поле страницы" in setup mode here creates a page field.
   */
  pageId?: number;
  /**
   * Whether this is a true mirror page (showing another entity's live records).
   * Mirror pages suppress entity-column management (the columns belong to the
   * source entity); regular entity pages keep it. Decoupled from {@link pageId}
   * so a regular entity page can still own page fields and related columns.
   */
  isMirror?: boolean;
}) {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canRecord, canAdmin, fieldAccess, user } = useAuth();

  // On a mirror page, record permissions and field access are resolved against
  // the mirror page's override (key `mirror:<pageId>`); on a regular entity page
  // there is no override so this stays undefined and entity rights apply. The
  // same id is sent in every record write/query payload so the server applies
  // the matching boundary.
  const permPageId = isMirror ? pageId : undefined;

  const canView = canRecord(entityId, "view", permPageId);
  const canCreate = canRecord(entityId, "create", permPageId);
  const canUpdate = canRecord(entityId, "update", permPageId);
  const canDelete = canRecord(entityId, "delete", permPageId);
  // Field/column management (setup mode) is gated exactly like the fields builder.
  const canConfigureColumns = canAdmin("entities");

  const { data: allFields = [], isLoading: fieldsLoading } = useListEntityFields(entityId);
  const { data: statuses = [] } = useListEntityStatuses(entityId);
  const { data: transitions = [] } = useListEntityTransitions(entityId);
  const { data: views = [] } = useListEntityViews(entityId);
  const { data: userOptions = [] } = useListUserOptions();

  const userNames = useMemo(
    () => new Map(userOptions.map((u: UserOption) => [u.id, u.name])),
    [userOptions],
  );

  // Page fields: extra columns that live on a page rather than on the source
  // entity. Available on any page (regular or mirror), loaded only when this
  // table is rendered inside a page (pageId set).
  const hasPage = pageId != null;
  const { data: allPageFields = [] } = useListPageFields(pageId ?? 0, {
    query: { enabled: hasPage, queryKey: getListPageFieldsQueryKey(pageId ?? 0) },
  });
  const { data: pageRecordValues = [] } = useListPageRecordValues(pageId ?? 0, {
    query: { enabled: hasPage, queryKey: getListPageRecordValuesQueryKey(pageId ?? 0) },
  });
  const pageFields = useMemo(
    () =>
      [...allPageFields]
        .filter((f: PageField) => f.isActive)
        .sort((a: PageField, b: PageField) => a.sortOrder - b.sortOrder),
    [allPageFields],
  );
  const pageValuesByRecord = useMemo(() => {
    const m = new Map<number, Record<string, unknown>>();
    for (const row of pageRecordValues) {
      m.set(row.recordId, (row.valuesJson ?? {}) as Record<string, unknown>);
    }
    return m;
  }, [pageRecordValues]);

  const setPageValuesMutation = useSetPageRecordValues({
    mutation: {
      onSuccess: () => {
        if (pageId != null) {
          queryClient.invalidateQueries({ queryKey: [`/api/pages/${pageId}/record-values`] });
        }
      },
      onError: () =>
        toast({ title: t("records.saveError", "Не удалось сохранить значение"), variant: "destructive" }),
    },
  });

  // Relation page-fields surface one field of a single linked record. Their
  // values are NOT stored on the page (unlike page-local fields) — they are
  // resolved live from the linked record via a dedicated endpoint that re-applies
  // the related entity's field/row boundary plus this page's per-field role perms.
  const hasRelationFields = pageFields.some((pf: PageField) => pf.fieldType === "relation");
  const [relatedColumns, setRelatedColumns] = useState<PageRelatedColumn[]>([]);
  const [relatedByRecord, setRelatedByRecord] = useState<Map<number, Map<string, PageRelatedValue>>>(
    new Map(),
  );
  const relatedColMeta = useMemo(() => {
    const m = new Map<string, PageRelatedColumn>();
    for (const c of relatedColumns) m.set(c.fieldKey, c);
    return m;
  }, [relatedColumns]);
  const relatedValuesMutation = useGetPageRelatedValues();
  const fetchRelatedValues = relatedValuesMutation.mutateAsync;

  // Optional mirror-page projection: restrict to a chosen subset of field keys.
  const mirrorKeySet =
    visibleFieldKeys && visibleFieldKeys.length > 0 ? new Set(visibleFieldKeys) : null;
  const fields = [...allFields]
    .filter((f: Field) => f.isActive)
    .filter((f: Field) => !mirrorKeySet || mirrorKeySet.has(f.fieldKey))
    .sort((a: Field, b: Field) => a.sortOrder - b.sortOrder);
  // Fields the current user is allowed to see (not hidden by field-level perms).
  const visibleFormFields = fields.filter((f: Field) => fieldAccess(f, entityId, permPageId) !== "hidden");
  // Columns shown in the records table. A field explicitly marked "hidden" for the
  // current role drops its whole column even for a superAdmin (display-only — the
  // field stays editable in the record dialog and the server bypass is unchanged).
  const currentRoleId = user?.roleId;
  const tableFields = visibleFormFields.filter(
    (f: Field) =>
      currentRoleId == null ||
      f.permissionsJson?.[String(currentRoleId)] !== "hidden",
  );
  // Fields opted-in to filtering (the "участвует в фильтре" flag), restricted to fields the
  // role may see — a hidden field must never surface as a filter.
  const filterableFields = visibleFormFields.filter((f: Field) => f.isFilterable);
  const statusById = new Map(statuses.map((s: Status) => [s.id, s]));
  const isSuperAdmin = user?.permissions?.superAdmin === true;

  // Cosmetic mirror of the server's per-role status visibility (entity-level, like
  // row scope). superAdmin sees everything. `hidden` = not offered in picker/quick
  // filter; `hiddenRows` = rows never shown (also drops the quick-filter chip).
  // Badge rendering still uses the full `statuses` list so labels always resolve.
  const toIdSet = (v: unknown): Set<number> =>
    new Set<number>(Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)) : []);
  const statusEntityPerm = isSuperAdmin ? undefined : user?.permissions?.records?.[String(entityId)];
  const hiddenStatusIds = toIdSet(statusEntityPerm?.hiddenStatusIds);
  const hiddenRowStatusIds = toIdSet(statusEntityPerm?.hiddenRowStatusIds);
  // Drop hidden-picker statuses but always keep `keepId` (a record's current
  // status) so its Select still renders the value it's actually set to.
  const dropHidden = (list: Status[], keepId?: number | null): Status[] =>
    list.filter((s: Status) => !hiddenStatusIds.has(s.id) || s.id === keepId);
  // Quick-filter chips: a role can neither filter by hidden-picker statuses nor by
  // hidden-row statuses (the latter have no rows to surface anyway).
  const filterableStatuses = statuses.filter(
    (s: Status) => !hiddenStatusIds.has(s.id) && !hiddenRowStatusIds.has(s.id),
  );
  // When the entity's default status is hidden from this role's picker, the create
  // form falls back to NO_STATUS. The server only assigns the (hidden) default
  // when statusId is OMITTED — a null value is stored as an explicit no-status —
  // so in that case the create payload must drop statusId entirely.
  const defaultStatusObj = statuses.find((s: Status) => s.isDefault);
  const defaultStatusHidden = defaultStatusObj != null && hiddenStatusIds.has(defaultStatusObj.id);
  const buildCreateData = (
    valuesJson: Record<string, unknown>,
    statusValue: number | null,
  ): { valuesJson: Record<string, unknown>; statusId?: number | null; pageId?: number } =>
    statusValue === null && defaultStatusHidden
      ? { valuesJson, pageId: permPageId }
      : { valuesJson, statusId: statusValue, pageId: permPageId };

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [toDelete, setToDelete] = useState<EntityRecord | null>(null);
  const [historyFor, setHistoryFor] = useState<EntityRecord | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [statusId, setStatusId] = useState<string>(NO_STATUS);

  // Google-Sheets-style inline editing: which cell is currently being edited.
  const [editingCell, setEditingCell] = useState<{ recordId: number; fieldKey: string | "__status__" } | null>(null);
  // Inline "add row" draft state (an alternative to the modal create dialog).
  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState<FormState>({});
  const [newPageRow, setNewPageRow] = useState<FormState>({});
  const [newRowStatus, setNewRowStatus] = useState<string>(NO_STATUS);
  // Admin-only setup mode: clicking a column header configures it; "+" adds a column.
  const [setupMode, setSetupMode] = useState(false);
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [columnField, setColumnField] = useState<Field | null>(null);
  // Page-local field config (mirror pages only).
  const [pageColumnDialogOpen, setPageColumnDialogOpen] = useState(false);
  const [pageColumnField, setPageColumnField] = useState<PageField | null>(null);

  // Leaving an entity resets the transient table-editing UI so it can't leak across entities.
  useEffect(() => {
    setEditingCell(null);
    setAddingRow(false);
    setSetupMode(false);
  }, [entityId]);

  // ── Resizable table columns ──────────────────────────────────────────────
  // Per-column widths are a viewer-local preference (no server contract): we
  // persist them in localStorage keyed by entity+page so each table remembers
  // its layout. Columns without a stored width keep their natural auto width.
  const widthsStorageKey = `erp:colwidths:${entityId}:${pageId ?? 0}`;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(widthsStorageKey);
      setColumnWidths(raw ? (JSON.parse(raw) as Record<string, number>) : {});
    } catch {
      setColumnWidths({});
    }
  }, [widthsStorageKey]);
  // A fixed width on a cell must also clamp min/max so an auto-layout table
  // actually honours it (the widest unconstrained cell would otherwise win).
  const colWidthStyle = (key: string): CSSProperties | undefined => {
    const w = columnWidths[key];
    return w ? { width: w, minWidth: w, maxWidth: w } : undefined;
  };
  // Holds the teardown for an in-flight drag so it can be forcibly run on
  // unmount / entity switch (a drag that never sees pointerup must not leak
  // window listeners or leave body cursor/userSelect stuck).
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  const startResize = (key: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // A previous drag should never still be live, but be defensive.
    dragCleanupRef.current?.();
    const th = (e.currentTarget.closest("th") as HTMLElement | null) ?? null;
    const startW = columnWidths[key] ?? th?.offsetWidth ?? 160;
    const startX = e.clientX;
    let latest: Record<string, number> = columnWidths;
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(60, Math.round(startW + (ev.clientX - startX)));
      latest = { ...columnWidths, [key]: w };
      setColumnWidths(latest);
    };
    // Idempotent teardown: removes listeners and restores body styles. Persists
    // only on a real pointerup (persist=true), not on an unmount-forced abort.
    const cleanup = (persist: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onAbort);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      dragCleanupRef.current = null;
      if (persist) {
        try {
          localStorage.setItem(widthsStorageKey, JSON.stringify(latest));
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
    // Fail-safe: if focus leaves the window mid-drag we may never get pointerup.
    window.addEventListener("blur", onAbort);
  };
  // Drag handle pinned to a header cell's right edge. Double-click resets the
  // column back to its natural (auto) width.
  const ResizeHandle = ({ colKey }: { colKey: string }) => (
    <div
      onPointerDown={startResize(colKey)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setColumnWidths((prev) => {
          const next = { ...prev };
          delete next[colKey];
          try {
            localStorage.setItem(widthsStorageKey, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        });
      }}
      title={t("records.resizeColumn", "Потяните, чтобы изменить ширину (двойной клик — сбросить)")}
      className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none bg-transparent hover:bg-blue-400/60"
    />
  );

  // Statuses the user may move the record to, mirroring the server's workflow boundary.
  // Free choice when: creating, no transitions defined, current status is null, or superAdmin.
  // Otherwise: current status + targets of transitions allowed for the user's role.
  const currentEditStatusId = editing?.statusId ?? null;
  const workflowActive =
    !!editing && transitions.length > 0 && currentEditStatusId != null && !isSuperAdmin;
  const allowedStatusIds: Set<number> | null = workflowActive
    ? new Set<number>([
        currentEditStatusId as number,
        ...transitions
          .filter(
            (t: Transition) =>
              t.fromStatusId === currentEditStatusId &&
              ((t.allowedRoleIds?.length ?? 0) === 0 ||
                (user?.roleId != null && t.allowedRoleIds.includes(user.roleId))),
          )
          .map((t: Transition) => t.toStatusId),
      ])
    : null;
  const selectableStatuses = dropHidden(
    allowedStatusIds ? statuses.filter((s: Status) => allowedStatusIds.has(s.id)) : statuses,
    currentEditStatusId,
  );

  // View / filter / search / pagination state for the server-side query endpoint.
  const [selectedViewId, setSelectedViewId] = useState<string>(NO_VIEW);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState<ArchiveFilter>("active");
  const [statusFilter, setStatusFilter] = useState<number[]>([]);
  const [fieldFilters, setFieldFilters] = useState<Record<string, string[]>>({});
  const [dateFilters, setDateFilters] = useState<Record<string, DateRangeFilter>>({});
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<EntityRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [numericTotals, setNumericTotals] = useState<Record<string, number>>({});
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const selectedView: View | undefined =
    selectedViewId === NO_VIEW ? undefined : views.find((v: View) => String(v.id) === selectedViewId);
  const selectedConfig = (selectedView?.configJson ?? {}) as ViewConfig;

  // Reset all view/query state when switching entities so prior state never leaks.
  const [viewInitialized, setViewInitialized] = useState(false);
  useEffect(() => {
    setSelectedViewId(NO_VIEW);
    setSearch("");
    setArchived("active");
    setStatusFilter([]);
    setFieldFilters({});
    setDateFilters({});
    setPage(1);
    setViewInitialized(false);
  }, [entityId]);

  // Auto-select the entity's default view once its views load (only on first arrival).
  useEffect(() => {
    if (viewInitialized || views.length === 0) return;
    const def = views.find((v: View) => v.isDefault);
    if (def) {
      setSelectedViewId(String(def.id));
      setSearch(((def.configJson ?? {}) as ViewConfig).search ?? "");
    }
    setViewInitialized(true);
  }, [views, viewInitialized]);

  const queryMutation = useQueryEntityRecords();
  const runQuery = queryMutation.mutateAsync;

  // Ad-hoc per-field filters (the opt-in "участвует в фильтре" dropdowns) combine with the
  // view's saved filters as AND. Each picked field becomes an `in` condition.
  const adHocFilters = useMemo(
    () =>
      Object.entries(fieldFilters)
        .filter(([, vals]) => vals.length > 0)
        .map(([field, vals]) => ({ field, operator: "in" as const, value: vals })),
    [fieldFilters],
  );
  const adHocKey = JSON.stringify(adHocFilters);
  const statusKey = JSON.stringify(statusFilter);

  // Date-field filters become a single half-open `between` interval: [from, day AFTER to).
  // Using one condition (internally AND) keeps the range correct regardless of the view's
  // filterConjunction. The server casts both the stored value and the bounds to timestamptz in
  // the same session tz, so day-level comparison stays consistent for date and datetime fields.
  const dateFilterConditions = useMemo(
    () =>
      Object.entries(dateFilters).map(([field, range]) => ({
        field,
        operator: "between" as const,
        value: [range.from, formatDate(addDays(parseISO(range.to), 1), DAY_FMT)],
      })),
    [dateFilters],
  );
  const dateKey = JSON.stringify(dateFilters);

  const recordQuery: RecordQuery = useMemo(
    () => ({
      filters: [...(selectedConfig.filters ?? []), ...adHocFilters, ...dateFilterConditions],
      filterConjunction: selectedConfig.filterConjunction ?? "and",
      statusIds: statusFilter.length > 0 ? statusFilter : undefined,
      sorts: selectedConfig.sorts ?? [],
      search: search.trim() || undefined,
      archived,
      page,
      pageSize: PAGE_SIZE,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedConfig.filters, selectedConfig.filterConjunction, selectedConfig.sorts, adHocKey, dateKey, statusKey, search, archived, page],
  );

  // Dependent filters: when fetching the option list for a field, we run a query against the
  // records matching the OTHER active filters (this field's own picks excluded) so co-occurring
  // values narrow each other (e.g. pick «Отдел» ⇒ «Сотрудник» lists only that department's staff).
  const filterValuesMutation = useGetEntityFilterValues();
  const fetchFilterOptions = filterValuesMutation.mutateAsync;
  const getFilterOptions = useCallback(
    async (fieldKey: string): Promise<string[]> => {
      // Self-exclude the target field from BOTH the value filters and the date filters so the
      // option list reflects what the OTHER active filters (incl. date ranges) narrow to.
      const others = adHocFilters.filter((c) => c.field !== fieldKey);
      const dateOthers = dateFilterConditions.filter((c) => c.field !== fieldKey);
      const res = await fetchFilterOptions({
        entityId,
        data: {
          pageId: permPageId,
          field: fieldKey,
          filters: [...(selectedConfig.filters ?? []), ...others, ...dateOthers],
          // Mirror the records query's conjunction so option lists stay consistent with the
          // rows actually shown (a view may be configured with OR logic).
          filterConjunction: selectedConfig.filterConjunction ?? "and",
          statusIds: statusFilter.length > 0 ? statusFilter : undefined,
          search: search.trim() || undefined,
          archived,
        },
      });
      return res.values ?? [];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entityId, adHocKey, dateKey, statusKey, search, archived, selectedConfig.filters, selectedConfig.filterConjunction, fetchFilterOptions],
  );

  const setFieldFilter = useCallback((fieldKey: string, values: string[]) => {
    setFieldFilters((prev) => {
      const next = { ...prev };
      if (values.length === 0) delete next[fieldKey];
      else next[fieldKey] = values;
      return next;
    });
    setPage(1);
  }, []);

  const setDateFilter = useCallback((fieldKey: string, range: DateRangeFilter | undefined) => {
    setDateFilters((prev) => {
      const next = { ...prev };
      if (!range) delete next[fieldKey];
      else next[fieldKey] = range;
      return next;
    });
    setPage(1);
  }, []);

  const toggleStatus = useCallback((id: number) => {
    setStatusFilter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPage(1);
  }, []);

  const hasActiveFilters =
    adHocFilters.length > 0 || statusFilter.length > 0 || Object.keys(dateFilters).length > 0;
  const resetFilters = useCallback(() => {
    setFieldFilters({});
    setDateFilters({});
    setStatusFilter([]);
    setPage(1);
  }, []);

  const queryKey = JSON.stringify(recordQuery);
  useEffect(() => {
    if (!canView) {
      setRecordsLoading(false);
      return;
    }
    let cancelled = false;
    setRecordsLoading(true);
    runQuery({ entityId, data: { ...recordQuery, pageId: permPageId } })
      .then((res) => {
        if (cancelled) return;
        setRecords(res.data);
        setTotal(res.total);
        setNumericTotals(res.numericTotals ?? {});
      })
      .catch((err) => {
        if (cancelled) return;
        setRecords([]);
        setTotal(0);
        setNumericTotals({});
        toast({ title: t("records.loadError", "Ошибка загрузки записей"), description: extractError(err), variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setRecordsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, queryKey, refreshTick]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/records`] });
    setRefreshTick((t) => t + 1);
  };
  const invalidateFields = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/fields`] });
  };
  const invalidatePageFields = () => {
    if (pageId != null) {
      queryClient.invalidateQueries({ queryKey: [`/api/pages/${pageId}/fields`] });
    }
  };

  // Resolve related-column values for the currently visible records. Re-runs when
  // the visible record set, the relation field config, or a write (refreshTick)
  // changes. The server applies the full RBAC boundary, so values here are safe
  // to render as-is.
  const recordIdsKey = records.map((r: EntityRecord) => r.id).join(",");
  const relationFieldsKey = useMemo(
    () =>
      JSON.stringify(
        pageFields
          .filter((pf: PageField) => pf.fieldType === "relation")
          .map((pf: PageField) => [pf.fieldKey, pf.relationConfigJson?.relationId, pf.relationConfigJson?.relatedFieldKey]),
      ),
    [pageFields],
  );
  useEffect(() => {
    if (pageId == null || !hasRelationFields || records.length === 0) {
      setRelatedColumns([]);
      setRelatedByRecord(new Map());
      return;
    }
    let cancelled = false;
    const recordIds = records.map((r: EntityRecord) => r.id);
    fetchRelatedValues({ pageId, data: { recordIds } })
      .then((res) => {
        if (cancelled) return;
        setRelatedColumns(res.columns);
        const m = new Map<number, Map<string, PageRelatedValue>>();
        for (const v of res.values) {
          let inner = m.get(v.recordId);
          if (!inner) {
            inner = new Map();
            m.set(v.recordId, inner);
          }
          inner.set(v.fieldKey, v);
        }
        setRelatedByRecord(m);
      })
      .catch(() => {
        if (cancelled) return;
        setRelatedColumns([]);
        setRelatedByRecord(new Map());
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, hasRelationFields, recordIdsKey, relationFieldsKey, refreshTick]);

  const reorderFieldsMutation = useReorderFields({
    mutation: {
      onSuccess: () => invalidateFields(),
      onError: () => toast({ title: t("records.reorderColumnError", "Ошибка изменения порядка колонок"), variant: "destructive" }),
    },
  });

  const moveColumn = (list: Field[], index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    reorderFieldsMutation.mutate({
      data: {
        entityId,
        items: [
          { id: a.id, sortOrder: b.sortOrder },
          { id: b.id, sortOrder: a.sortOrder },
        ],
      },
    });
  };

  const reorderPageFieldsMutation = useReorderPageFields({
    mutation: {
      onSuccess: () => {
        if (pageId != null) queryClient.invalidateQueries({ queryKey: getListPageFieldsQueryKey(pageId) });
      },
      onError: () => toast({ title: t("records.reorderColumnError", "Ошибка изменения порядка колонок"), variant: "destructive" }),
    },
  });

  const movePageColumn = (list: PageField[], index: number, direction: -1 | 1) => {
    if (pageId == null) return;
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    reorderPageFieldsMutation.mutate({
      data: {
        pageId,
        items: [
          { id: a.id, sortOrder: b.sortOrder },
          { id: b.id, sortOrder: a.sortOrder },
        ],
      },
    });
  };

  const handleViewChange = (value: string) => {
    setSelectedViewId(value);
    setPage(1);
    const cfg = value === NO_VIEW ? undefined : (views.find((v: View) => String(v.id) === value)?.configJson as ViewConfig | undefined);
    setSearch(cfg?.search ?? "");
  };

  const createMutation = useCreateEntityRecord({
    mutation: {
      onSuccess: () => { toast({ title: t("records.created", "Запись создана") }); setDialogOpen(false); setAddingRow(false); invalidate(); },
      onError: (err) => toast({ title: t("records.createError", "Ошибка создания записи"), description: extractError(err), variant: "destructive" }),
    },
  });
  // Dedicated mutation for inline cell/status edits — quietly refreshes (no success toast spam).
  const cellUpdateMutation = useUpdateRecord({
    mutation: {
      onSuccess: () => { setEditingCell(null); invalidate(); },
      onError: (err) => { setEditingCell(null); toast({ title: t("records.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }); },
    },
  });
  const updateMutation = useUpdateRecord({
    mutation: {
      onSuccess: () => { toast({ title: t("records.updated", "Запись обновлена") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("records.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteRecord({
    mutation: {
      onSuccess: () => { toast({ title: t("records.deleted", "Запись удалена") }); setToDelete(null); invalidate(); },
      onError: () => toast({ title: t("records.deleteError", "Ошибка удаления записи"), variant: "destructive" }),
    },
  });
  const archiveMutation = useArchiveRecord({
    mutation: {
      onSuccess: () => { toast({ title: t("records.archived", "Запись отправлена в архив") }); invalidate(); },
      onError: (err) => toast({ title: t("records.archiveError", "Ошибка архивации"), description: extractError(err), variant: "destructive" }),
    },
  });
  const unarchiveMutation = useUnarchiveRecord({
    mutation: {
      onSuccess: () => { toast({ title: t("records.unarchived", "Запись восстановлена из архива") }); invalidate(); },
      onError: (err) => toast({ title: t("records.unarchiveError", "Ошибка восстановления"), description: extractError(err), variant: "destructive" }),
    },
  });

  const openCreate = () => {
    setEditing(null);
    const initial: FormState = {};
    for (const f of fields) initial[f.fieldKey] = emptyForField(f);
    setForm(initial);
    // Preselect the default status — but if it is hidden from this role's picker,
    // leave it unset so the server assigns the (hidden) default itself instead of
    // rejecting an explicit forbidden statusId.
    const def = statuses.find((s: Status) => s.isDefault);
    setStatusId(def && !hiddenStatusIds.has(def.id) ? String(def.id) : NO_STATUS);
    setDialogOpen(true);
  };

  const openEdit = (record: EntityRecord) => {
    setEditing(record);
    const initial: FormState = {};
    const values = (record.valuesJson ?? {}) as Record<string, unknown>;
    for (const f of fields) initial[f.fieldKey] = valueToForm(f, values[f.fieldKey]);
    setForm(initial);
    setStatusId(record.statusId != null ? String(record.statusId) : NO_STATUS);
    setDialogOpen(true);
  };

  // Deep-link support: a `?record=<id>` query param (e.g. from a dashboard
  // table widget) opens that record's edit dialog, then is stripped so a
  // refresh/back doesn't reopen it.
  const deepLinkSearch = useSearch();
  const [location, navigate] = useLocation();
  const deepLinkId = useMemo(() => {
    const raw = new URLSearchParams(deepLinkSearch).get("record");
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [deepLinkSearch]);
  const { data: deepLinkRecord } = useGetRecord(deepLinkId ?? 0, {
    query: { enabled: deepLinkId != null && canView, queryKey: getGetRecordQueryKey(deepLinkId ?? 0) },
  });
  const handledDeepLinkRef = useRef<number | null>(null);
  useEffect(() => {
    if (deepLinkId == null) {
      handledDeepLinkRef.current = null;
      return;
    }
    if (handledDeepLinkRef.current === deepLinkId) return;
    // Wait for field metadata before opening: openEdit() seeds the form from
    // `fields`, so opening too early would produce an empty/mis-initialized form.
    if (fieldsLoading || fields.length === 0) return;
    if (deepLinkRecord && deepLinkRecord.id === deepLinkId) {
      handledDeepLinkRef.current = deepLinkId;
      openEdit(deepLinkRecord);
      // Strip only the `record` param, preserving any other query params.
      const params = new URLSearchParams(deepLinkSearch);
      params.delete("record");
      const qs = params.toString();
      navigate(qs ? `${location}?${qs}` : location, { replace: true });
    }
  }, [deepLinkId, deepLinkRecord, deepLinkSearch, fieldsLoading, fields, location, navigate]);

  const handleSubmit = () => {
    // Only send fields the user can see; hidden/view-only are preserved server-side.
    const valuesJson = formToValues(visibleFormFields, form);
    const statusValue = statusId === NO_STATUS ? null : Number(statusId);
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: { valuesJson, statusId: statusValue, pageId: permPageId } });
    } else {
      createMutation.mutate({ entityId, data: buildCreateData(valuesJson, statusValue) });
    }
  };

  // Inline editing is available outside setup mode for users who can update records.
  const inlineEditEnabled = canUpdate && !setupMode;

  // Coerce a raw form value into the JSON shape the API expects for one field.
  // Empty string is sent verbatim to clear an optional field (server drops empties).
  const cellValueForPayload = (field: Field, raw: CellValue): unknown => {
    if (field.fieldType === "boolean") return Boolean(raw);
    if (raw === "" || raw === undefined || raw === null) return "";
    if (field.fieldType === "number") return Number(raw);
    if (field.fieldType === "user") return Number(raw);
    return raw;
  };

  const commitCell = (record: EntityRecord, field: Field, raw: CellValue) => {
    const stored = (record.valuesJson ?? {})[field.fieldKey];
    const next = cellValueForPayload(field, raw);
    const normalizedStored =
      field.fieldType === "boolean" ? Boolean(stored) : stored === undefined || stored === null ? "" : stored;
    if (next === normalizedStored) { setEditingCell(null); return; }
    cellUpdateMutation.mutate({ id: record.id, data: { valuesJson: { [field.fieldKey]: next }, pageId: permPageId } });
  };

  const commitStatus = (record: EntityRecord, value: string) => {
    const next = value === NO_STATUS ? null : Number(value);
    if (next === (record.statusId ?? null)) { setEditingCell(null); return; }
    cellUpdateMutation.mutate({ id: record.id, data: { statusId: next, pageId: permPageId } });
  };

  // Inline commit for a page-local field value. Page values are stored as a
  // whole JSONB map per (page, record), so we merge the existing values with the
  // single edited key before writing.
  const commitPageCell = (record: EntityRecord, field: PageField, raw: CellValue) => {
    if (pageId == null) { setEditingCell(null); return; }
    const existing = pageValuesByRecord.get(record.id) ?? {};
    const stored = existing[field.fieldKey];
    const next = cellValueForPayload(field as unknown as Field, raw);
    const normalizedStored =
      field.fieldType === "boolean" ? Boolean(stored) : stored === undefined || stored === null ? "" : stored;
    if (next === normalizedStored) { setEditingCell(null); return; }
    const merged: Record<string, unknown> = { ...existing };
    if (next === "" || next === undefined || next === null) delete merged[field.fieldKey];
    else merged[field.fieldKey] = next;
    setEditingCell(null);
    setPageValuesMutation.mutate({ pageId, recordId: record.id, data: { valuesJson: merged } });
  };

  // Build a synthetic Field for a relation page-field so it can reuse the same
  // cell renderers/editors. The render type and select options come from the
  // related entity field (resolved server-side); a hidden related field reports
  // a null type and renders as plain (uneditable) text.
  const relationAsField = (pf: PageField, meta?: PageRelatedColumn): Field =>
    ({
      ...pf,
      fieldType: (meta?.relatedFieldType ?? "text") as Field["fieldType"],
      optionsJson: meta?.optionsJson ?? [],
      permissionsJson: {},
      entityId: 0,
    }) as unknown as Field;

  // Whether workflow enforcement applies to a given row (mirrors the server boundary).
  // When active the status cannot be cleared and only allowed transitions are offered.
  const workflowActiveForRecord = (record: EntityRecord): boolean =>
    transitions.length > 0 && record.statusId != null && !isSuperAdmin;

  // Statuses a given row may move to, mirroring the server workflow boundary (per-row).
  const allowedStatusesForRecord = (record: EntityRecord): Status[] => {
    const cur = record.statusId ?? null;
    if (!workflowActiveForRecord(record)) return dropHidden(statuses, cur);
    const ids = new Set<number>([
      cur as number,
      ...transitions
        .filter(
          (tr: Transition) =>
            tr.fromStatusId === cur &&
            ((tr.allowedRoleIds?.length ?? 0) === 0 ||
              (user?.roleId != null && tr.allowedRoleIds.includes(user.roleId))),
        )
        .map((tr: Transition) => tr.toStatusId),
    ]);
    return dropHidden(statuses.filter((s: Status) => ids.has(s.id)), cur);
  };

  const startAddRow = () => {
    const initial: FormState = {};
    for (const f of fields) initial[f.fieldKey] = emptyForField(f);
    setNewRow(initial);
    const pageInitial: FormState = {};
    for (const pf of pageFields) {
      if (pf.fieldType === "relation") continue;
      pageInitial[pf.fieldKey] = emptyForField({ ...pf, permissionsJson: {}, entityId: 0 } as unknown as Field);
    }
    setNewPageRow(pageInitial);
    // Preselect the default status — but if it is hidden from this role's picker,
    // leave it unset so the server assigns the (hidden) default itself instead of
    // rejecting an explicit forbidden statusId.
    const def = statuses.find((s: Status) => s.isDefault);
    setNewRowStatus(def && !hiddenStatusIds.has(def.id) ? String(def.id) : NO_STATUS);
    setEditingCell(null);
    setAddingRow(true);
  };

  const cancelAddRow = () => {
    setAddingRow(false);
    setNewRow({});
    setNewPageRow({});
  };

  const commitNewRow = () => {
    const valuesJson = formToValues(
      visibleFormFields.filter((f: Field) => fieldAccess(f, entityId, permPageId) === "edit"),
      newRow,
    );
    const statusValue = newRowStatus === NO_STATUS ? null : Number(newRowStatus);
    if (hasPage && pageId != null) {
      const pageValuesJson: Record<string, unknown> = {};
      for (const pf of pageFields) {
        if (pf.fieldType === "function" || pf.fieldType === "relation") continue;
        const val = cellValueForPayload({ ...pf, permissionsJson: {}, entityId: 0 } as unknown as Field, newPageRow[pf.fieldKey] as CellValue);
        if (val !== "" && val !== undefined && val !== null) pageValuesJson[pf.fieldKey] = val;
      }
      void (async () => {
        try {
          const created = await createMutation.mutateAsync({ entityId, data: buildCreateData(valuesJson, statusValue) });
          if (created?.id != null && Object.keys(pageValuesJson).length > 0) {
            await setPageValuesMutation.mutateAsync({ pageId, recordId: created.id, data: { valuesJson: pageValuesJson } });
          }
          setNewPageRow({});
        } catch {
          // errors surfaced via mutation onError toasts
        }
      })();
      return;
    }
    createMutation.mutate({ entityId, data: buildCreateData(valuesJson, statusValue) });
  };

  const openColumnConfig = (field: Field | null) => {
    setColumnField(field);
    setColumnDialogOpen(true);
  };
  const openPageColumnConfig = (field: PageField | null) => {
    setPageColumnField(field);
    setPageColumnDialogOpen(true);
  };

  // Merge an entity record's stored values with its page-local values so formula
  // fields (entity- or page-defined) can reference either set by field key.
  const allValuesFor = (record: EntityRecord): Record<string, unknown> => ({
    ...((record.valuesJson ?? {}) as Record<string, unknown>),
    ...(pageValuesByRecord.get(record.id) ?? {}),
  });
  // Raw value of a field for one record: evaluated for formula fields, stored
  // otherwise. Used both for rendering and for conditional-format matching.
  const fieldRawValue = (
    field: { fieldKey: string; fieldType: string; formulaConfigJson?: { expression?: string } | null },
    allValues: Record<string, unknown>,
  ): unknown => {
    if (field.fieldType === "function") {
      return evaluateFormula(field.formulaConfigJson?.expression ?? "", allValues);
    }
    return allValues[field.fieldKey];
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  // Columns are governed solely by each field's per-page "Показывать в таблице"
  // flag (and field-level role perms, already applied in `tableFields`) — NOT by
  // the selected view. A view carries only sort/filter/search; it must never hide
  // a column the field settings say should appear. Column order follows field
  // sortOrder. In setup mode the admin manages every column (incl. table-hidden).
  const displayFields = setupMode
    ? tableFields
    : tableFields.filter((f: Field) => f.showInTable !== false);
  // Page-local columns are appended after the entity columns. In setup mode the
  // admin sees them all; otherwise only those opted-in via "Показывать в таблице".
  const displayedPageFields = setupMode
    ? pageFields
    : pageFields.filter((f: PageField) => f.showInTable !== false);
  const extraColCount = displayedPageFields.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!canView) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-slate-700 font-medium">{t("records.noAccess", "Нет доступа к записям")}</p>
          <p className="text-sm text-slate-400 max-w-md">
            {t("records.noAccessDesc", "У вашей роли нет прав на просмотр данных этой сущности.")}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (fieldsLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
          <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
            <Inbox className="w-6 h-6 text-amber-500" />
          </div>
          <p className="text-slate-700 font-medium">{t("records.noFields", "У этой сущности ещё нет полей")}</p>
          <p className="text-sm text-slate-400 max-w-md">
            {t("records.noFieldsDesc", "Сначала настройте поля в конструкторе полей — без них нельзя создавать записи.")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {views.length > 0 && (
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <LayoutList className="w-4 h-4 text-slate-400 shrink-0" />
              <Select value={selectedViewId} onValueChange={handleViewChange}>
                <SelectTrigger className="h-9 w-full sm:w-56 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VIEW}>{t("records.allRecords", "Все записи")}</SelectItem>
                  {views.map((v: View) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      <span className="inline-flex items-center gap-1.5">
                        {v.isDefault && <Star className="w-3 h-3 text-amber-500 fill-amber-400" />}
                        {ml(v.nameJson)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="relative w-full sm:w-auto">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={t("records.searchPlaceholder", "Поиск…")}
              className="h-9 w-full sm:w-56 pl-8 text-sm"
            />
          </div>
          <div className="flex items-center justify-center w-full sm:w-auto rounded-md border border-slate-200 p-0.5 bg-white">
            {([
              ["active", t("records.filterActive", "Активные")],
              ["archived", t("records.filterArchived", "Архив")],
              ["all", t("records.filterAll", "Все")],
            ] as [ArchiveFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => { setArchived(value); setPage(1); }}
                className={`px-2.5 h-8 text-xs rounded-[5px] transition ${
                  archived === value
                    ? "bg-slate-800 text-white"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          {canConfigureColumns && (
            <Button
              type="button"
              variant={setupMode ? "default" : "outline"}
              onClick={() => { setSetupMode((s) => !s); setEditingCell(null); setAddingRow(false); }}
              className={`w-full sm:w-auto justify-center gap-2 ${setupMode ? "bg-amber-500 hover:bg-amber-600" : ""}`}
            >
              <Settings2 className="w-4 h-4 shrink-0" />
              {t("records.setupMode", "Режим настройки")}
            </Button>
          )}
          {canCreate && !setupMode && (
            <Button onClick={openCreate} className="w-full sm:w-auto justify-center gap-2 bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 shrink-0" />
              {t("records.add", "Добавить запись")}
            </Button>
          )}
        </div>
      </div>

      {!setupMode && (statuses.length > 0 || filterableFields.length > 0) && (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Filter className="hidden sm:block w-4 h-4 text-slate-400 shrink-0" />
          {filterableStatuses.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={`h-9 gap-1.5 text-sm w-full justify-between sm:w-auto sm:justify-center ${statusFilter.length > 0 ? "border-blue-400 text-blue-700" : ""}`}
                >
                  <span className="truncate">{t("records.status", "Статус")}</span>
                  {statusFilter.length > 0 && (
                    <Badge variant="secondary" className="ml-0.5 px-1.5">{statusFilter.length}</Badge>
                  )}
                  <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0 ml-auto sm:ml-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-0">
                <ScrollArea className="max-h-64">
                  <div className="p-1">
                    {filterableStatuses.map((s: Status) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-sm"
                      >
                        <Checkbox checked={statusFilter.includes(s.id)} onCheckedChange={() => toggleStatus(s.id)} />
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                        <span className="truncate">{ml(s.nameJson)}</span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
                {statusFilter.length > 0 && (
                  <div className="p-1.5 border-t border-slate-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full h-7 text-xs text-slate-500"
                      onClick={() => { setStatusFilter([]); setPage(1); }}
                    >
                      {t("records.filterClearField", "Очистить")}
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}
          {filterableFields.map((f: Field) =>
            f.fieldType === "date" || f.fieldType === "datetime" ? (
              <DateFilterPopover
                key={f.id}
                field={f}
                value={dateFilters[f.fieldKey]}
                onChange={(range) => setDateFilter(f.fieldKey, range)}
                ml={ml}
                t={t}
                triggerClassName="w-full justify-start sm:w-auto sm:justify-center"
              />
            ) : (
              <FieldFilterPopover
                key={f.id}
                field={f}
                selected={fieldFilters[f.fieldKey] ?? []}
                onChange={(vals) => setFieldFilter(f.fieldKey, vals)}
                getOptions={getFilterOptions}
                ml={ml}
                t={t}
                userNames={userNames}
                triggerClassName="w-full justify-between sm:w-auto sm:justify-center"
              />
            ),
          )}
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 gap-1 text-slate-500 col-span-2 w-full justify-center sm:col-span-1 sm:w-auto"
              onClick={resetFilters}
            >
              <X className="w-3.5 h-3.5" />
              {t("records.filterReset", "Сбросить фильтры")}
            </Button>
          )}
        </div>
      )}

      {setupMode && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <Settings2 className="w-4 h-4" />
            {t("records.setupHint", "Режим настройки включён. Нажмите на заголовок колонки, чтобы изменить её свойства и права, или «+», чтобы добавить новую колонку.")}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-400 mr-1">{t("records.manageEntity", "Управление сущностью")}:</span>
            {[
              { to: `/admin/entities/${entityId}/fields`, icon: Columns3, label: t("records.manageFields", "Поля") },
              { to: `/admin/entities/${entityId}/statuses`, icon: CircleDot, label: t("records.manageStatuses", "Статусы") },
              { to: `/admin/entities/${entityId}/relations`, icon: Share2, label: t("records.manageRelations", "Связи") },
              { to: `/admin/entities/${entityId}/views`, icon: LayoutList, label: t("records.manageViews", "Виды") },
              { to: `/admin/entities/${entityId}/workflow`, icon: Workflow, label: t("records.manageProcesses", "Процессы") },
            ].map(({ to, icon: Icon, label }) => (
              <Button key={to} asChild variant="outline" size="sm" className="h-8 gap-1.5">
                <Link href={to}>
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </Link>
              </Button>
            ))}
          </div>
        </div>
      )}

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {recordsLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  {Object.keys(numericTotals).length > 0 && (
                    <tr>
                      {displayFields.map((f: Field) => {
                        const hasTotal = numericTotals[f.fieldKey] !== undefined;
                        return (
                          <th
                            key={`tot-${f.id}`}
                            className={cn("px-4 py-3 text-left", hasTotal && !f.totalFillColor && "bg-emerald-50")}
                            style={{
                              ...(hasTotal && f.totalFillColor ? { backgroundColor: f.totalFillColor } : undefined),
                              ...colWidthStyle(`f:${f.id}`),
                            }}
                          >
                            {hasTotal ? (
                              <span
                                className={cn("text-sm font-bold whitespace-nowrap", !f.totalTextColor && "text-emerald-700")}
                                style={f.totalTextColor ? { color: f.totalTextColor } : undefined}
                              >
                                {numericTotals[f.fieldKey].toLocaleString("ru-RU")}
                              </span>
                            ) : null}
                          </th>
                        );
                      })}
                      {displayedPageFields.map((pf: PageField) => {
                        const hasTotal = numericTotals[pf.fieldKey] !== undefined;
                        return (
                          <th
                            key={`tot-pf-${pf.id}`}
                            className={cn("px-4 py-3 text-left", hasTotal && !pf.totalFillColor && "bg-emerald-50")}
                            style={{
                              ...(hasTotal && pf.totalFillColor ? { backgroundColor: pf.totalFillColor } : undefined),
                              ...colWidthStyle(`pf:${pf.id}`),
                            }}
                          >
                            {hasTotal ? (
                              <span
                                className={cn("text-sm font-bold whitespace-nowrap", !pf.totalTextColor && "text-emerald-700")}
                                style={pf.totalTextColor ? { color: pf.totalTextColor } : undefined}
                              >
                                {numericTotals[pf.fieldKey].toLocaleString("ru-RU")}
                              </span>
                            ) : null}
                          </th>
                        );
                      })}
                      {statuses.length > 0 && <th className="px-4 py-1.5" style={colWidthStyle("__status__")} />}
                      <th className="px-4 py-1.5" />
                    </tr>
                  )}
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {displayFields.map((f: Field, ci: number) => (
                      <th
                        key={f.id}
                        className="relative align-top text-center px-4 py-3 font-medium text-slate-600 break-words"
                        style={colWidthStyle(`f:${f.id}`)}
                      >
                        {setupMode && !isMirror ? (
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-400"
                              disabled={ci === 0 || reorderFieldsMutation.isPending}
                              onClick={() => moveColumn(displayFields, ci, -1)}
                              title={t("records.moveColumnLeft", "Левее")}
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-400"
                              disabled={ci === displayFields.length - 1 || reorderFieldsMutation.isPending}
                              onClick={() => moveColumn(displayFields, ci, 1)}
                              title={t("records.moveColumnRight", "Правее")}
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </Button>
                            <button
                              type="button"
                              onClick={() => openColumnConfig(f)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-1 text-amber-700 hover:bg-amber-100 transition"
                              title={t("records.configureColumn", "Настроить колонку")}
                            >
                              {ml(f.nameJson)}
                              <Settings2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          ml(f.nameJson)
                        )}
                        <ResizeHandle colKey={`f:${f.id}`} />
                      </th>
                    ))}
                    {displayedPageFields.map((pf: PageField, pi: number) => (
                      <th
                        key={`pf-${pf.id}`}
                        className="relative align-top text-center px-4 py-3 font-medium text-slate-600 break-words"
                        style={colWidthStyle(`pf:${pf.id}`)}
                      >
                        {setupMode ? (
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-400"
                              disabled={pi === 0 || reorderPageFieldsMutation.isPending}
                              onClick={() => movePageColumn(displayedPageFields, pi, -1)}
                              title={t("records.moveColumnLeft", "Левее")}
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-400"
                              disabled={pi === displayedPageFields.length - 1 || reorderPageFieldsMutation.isPending}
                              onClick={() => movePageColumn(displayedPageFields, pi, 1)}
                              title={t("records.moveColumnRight", "Правее")}
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </Button>
                            <button
                              type="button"
                              onClick={() => openPageColumnConfig(pf)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-1 text-amber-700 hover:bg-amber-100 transition"
                              title={t("pageFields.configureColumn", "Настроить поле страницы")}
                            >
                              {ml(pf.nameJson)}
                              <Settings2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          ml(pf.nameJson)
                        )}
                        <ResizeHandle colKey={`pf:${pf.id}`} />
                      </th>
                    ))}
                    {statuses.length > 0 && (
                      <th
                        className="relative align-top text-center px-4 py-3 font-medium text-slate-600"
                        style={colWidthStyle("__status__")}
                      >
                        {t("records.status", "Статус")}
                        <ResizeHandle colKey="__status__" />
                      </th>
                    )}
                    {setupMode ? (
                      <th className="align-top text-center px-4 py-3 font-medium text-slate-600">
                        <div className="inline-flex items-center gap-2">
                          {!isMirror && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => openColumnConfig(null)}
                              className="gap-1.5 h-8 bg-amber-500 hover:bg-amber-600"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              {t("records.addColumn", "Колонка")}
                            </Button>
                          )}
                          {hasPage && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openPageColumnConfig(null)}
                              className="gap-1.5 h-8 border-amber-300 text-amber-700 hover:bg-amber-50"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              {t("pageFields.addColumn", "Поле страницы")}
                            </Button>
                          )}
                        </div>
                      </th>
                    ) : (
                      <th className="align-top text-center px-4 py-3 font-medium text-slate-600">{t("records.actions", "Действия")}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {records.length === 0 && (
                    <tr>
                      <td
                        colSpan={displayFields.length + extraColCount + (statuses.length > 0 ? 1 : 0) + 1}
                        className="text-center py-12 text-slate-400"
                      >
                        {total === 0 && (search.trim() || (selectedConfig.filters?.length ?? 0) > 0)
                          ? t("records.emptyFiltered", "Нет записей, удовлетворяющих условиям.")
                          : t("records.emptyNone", "Записей пока нет. Нажмите «Добавить запись», чтобы создать первую.")}
                      </td>
                    </tr>
                  )}
                  {canCreate && !setupMode && addingRow && (
                    <tr className="border-b border-blue-100 bg-blue-50/40">
                      {displayFields.map((f: Field) => {
                        const editable = fieldAccess(f, entityId, permPageId) === "edit" && f.fieldType !== "function";
                        return (
                          <td key={f.id} className="px-2 py-1.5 align-top max-w-[260px]" style={colWidthStyle(`f:${f.id}`)}>
                            {editable ? (
                              <FieldInput
                                field={f}
                                value={newRow[f.fieldKey]}
                                onChange={(v) => setNewRow((prev) => ({ ...prev, [f.fieldKey]: v }))}
                                userOptions={userOptions}
                              />
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                        );
                      })}
                      {displayedPageFields.map((pf: PageField) => {
                        const pageFieldAsField = { ...pf, permissionsJson: {}, entityId: 0 } as unknown as Field;
                        const editable = pf.fieldType !== "function" && pf.fieldType !== "relation";
                        return (
                          <td key={`pf-${pf.id}`} className="px-2 py-1.5 align-top max-w-[260px]" style={colWidthStyle(`pf:${pf.id}`)}>
                            {editable ? (
                              <FieldInput
                                field={pageFieldAsField}
                                value={newPageRow[pf.fieldKey]}
                                onChange={(v) => setNewPageRow((prev) => ({ ...prev, [pf.fieldKey]: v }))}
                                userOptions={userOptions}
                              />
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                        );
                      })}
                      {statuses.length > 0 && (
                        <td className="px-2 py-1.5 align-top" style={colWidthStyle("__status__")}>
                          <Select value={newRowStatus} onValueChange={setNewRowStatus}>
                            <SelectTrigger className="h-8 w-44 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_STATUS}>{t("records.noStatus", "Без статуса")}</SelectItem>
                              {dropHidden(statuses).map((s: Status) => (
                                <SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      )}
                      <td className="px-2 py-1.5 align-top">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            className="h-8 w-8 bg-blue-600 hover:bg-blue-700"
                            title={t("records.saveRow", "Сохранить строку")}
                            disabled={createMutation.isPending || setPageValuesMutation.isPending}
                            onClick={commitNewRow}
                          >
                            {createMutation.isPending || setPageValuesMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500"
                            title={t("records.cancel", "Отмена")}
                            onClick={cancelAddRow}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {canCreate && !setupMode && !addingRow && (
                    <tr className="border-b border-slate-100">
                      <td colSpan={displayFields.length + extraColCount + (statuses.length > 0 ? 1 : 0) + 1} className="px-2 py-2">
                        <button
                          type="button"
                          onClick={startAddRow}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 transition"
                        >
                          <Plus className="w-4 h-4" />
                          {t("records.addRow", "Добавить строку")}
                        </button>
                      </td>
                    </tr>
                  )}
                  {records.map((record: EntityRecord) => {
                    const values = (record.valuesJson ?? {}) as Record<string, unknown>;
                    const pageValues = pageValuesByRecord.get(record.id) ?? {};
                    const allValues = { ...values, ...pageValues };
                    const status = record.statusId != null ? statusById.get(record.statusId) : undefined;
                    // Conditional formatting across both entity and page columns.
                    const formatFields: FormatField[] = [
                      ...displayFields.map((f: Field) => ({ fieldKey: f.fieldKey, formatRulesJson: f.formatRulesJson })),
                      ...displayedPageFields.map((pf: PageField) => ({ fieldKey: pf.fieldKey, formatRulesJson: pf.formatRulesJson })),
                    ];
                    const formatFieldByKey = new Map<string, { fieldType: string; formulaConfigJson?: { expression?: string } | null }>([
                      ...displayFields.map((f: Field) => [f.fieldKey, { fieldType: f.fieldType, formulaConfigJson: f.formulaConfigJson }] as const),
                      ...displayedPageFields.map((pf: PageField) => [pf.fieldKey, { fieldType: pf.fieldType, formulaConfigJson: pf.formulaConfigJson }] as const),
                    ]);
                    const formatting = computeRowFormatting(formatFields, (key) => {
                      const def = formatFieldByKey.get(key);
                      return def ? fieldRawValue({ fieldKey: key, ...def }, allValues) : allValues[key];
                    });
                    return (
                      <tr
                        key={record.id}
                        className="border-b border-slate-100 hover:bg-slate-50"
                        style={formatting.rowColor ? { backgroundColor: formatting.rowColor } : undefined}
                      >
                        {displayFields.map((f: Field) => {
                          const access = fieldAccess(f, entityId, permPageId);
                          const isFunction = f.fieldType === "function";
                          const cellEditable = inlineEditEnabled && access === "edit" && !isFunction;
                          const cellBg = formatting.cellColors[f.fieldKey];
                          const cellText = formatting.cellTextColors[f.fieldKey];
                          const cellStyle = cellBg || cellText ? { backgroundColor: cellBg || undefined, color: cellText || undefined } : undefined;
                          const isEditingThis =
                            editingCell?.recordId === record.id && editingCell?.fieldKey === f.fieldKey;
                          if (isEditingThis) {
                            return (
                              <td key={f.id} className="px-4 py-3 max-w-[240px]" style={colWidthStyle(`f:${f.id}`)}>
                                <InlineCellEditor
                                  field={f}
                                  initial={valueToForm(f, values[f.fieldKey])}
                                  userOptions={userOptions}
                                  onCommit={(raw) => commitCell(record, f, raw)}
                                  onCancel={() => setEditingCell(null)}
                                />
                              </td>
                            );
                          }
                          if (f.fieldType === "boolean" && cellEditable) {
                            return (
                              <td key={f.id} className="px-4 py-3 max-w-[240px]" style={{ ...cellStyle, ...colWidthStyle(`f:${f.id}`) }}>
                                <Switch
                                  checked={values[f.fieldKey] === true}
                                  onCheckedChange={(v) => commitCell(record, f, v)}
                                />
                              </td>
                            );
                          }
                          if (isFunction) {
                            const computed = formatFormulaResult(f.formulaConfigJson?.expression ?? "", allValues);
                            return (
                              <td key={f.id} className="px-4 py-3 max-w-[240px] truncate" style={{ ...cellStyle, ...colWidthStyle(`f:${f.id}`) }}>
                                {computed.error ? (
                                  <span className="text-red-400 text-xs" title={t("fields.formulaError", "Ошибка формулы")}>{t("fields.formulaError", "Ошибка формулы")}</span>
                                ) : computed.text === "" ? (
                                  <span className="text-slate-300" style={cellText ? { color: cellText } : undefined}>—</span>
                                ) : (
                                  <span className="text-slate-700" style={cellText ? { color: cellText } : undefined}>{computed.bool !== undefined ? t(computed.bool ? "fields.yes" : "fields.no", computed.bool ? "Да" : "Нет") : computed.text}</span>
                                )}
                              </td>
                            );
                          }
                          return (
                            <td
                              key={f.id}
                              onClick={cellEditable ? () => setEditingCell({ recordId: record.id, fieldKey: f.fieldKey }) : undefined}
                              className={`px-4 py-3 max-w-[240px] truncate ${cellEditable ? "cursor-text hover:bg-blue-50/60 rounded" : ""}`}
                              style={{ ...cellStyle, ...colWidthStyle(`f:${f.id}`) }}
                              title={cellEditable ? t("records.clickToEdit", "Нажмите, чтобы изменить") : undefined}
                            >
                              {renderCellValue(f, values[f.fieldKey], t, userNames, cellText)}
                            </td>
                          );
                        })}
                        {displayedPageFields.map((pf: PageField) => {
                          const isFunction = pf.fieldType === "function";
                          const cellBg = formatting.cellColors[pf.fieldKey];
                          const cellText = formatting.cellTextColors[pf.fieldKey];
                          const cellStyle = cellBg || cellText ? { backgroundColor: cellBg || undefined, color: cellText || undefined } : undefined;
                          const pfKey = `pf:${pf.fieldKey}`;
                          const isEditingThis =
                            editingCell?.recordId === record.id && editingCell?.fieldKey === pfKey;
                          if (pf.fieldType === "relation") {
                            const meta = relatedColMeta.get(pf.fieldKey);
                            const rel = relatedByRecord.get(record.id)?.get(pf.fieldKey);
                            const relField = relationAsField(pf, meta);
                            // The relation column now ASSIGNS the link: clicking a cell opens a
                            // searchable picker of related-entity records. A cell is assignable
                            // column-wide (server-reported editable) regardless of whether a link
                            // already exists, so empty ("—") cells are clickable too.
                            const relAssignable =
                              inlineEditEnabled && !!meta?.editableColumn && !!rel?.editable;
                            const display =
                              rel?.linkedRecordId == null ? (
                                <span className="text-slate-300">—</span>
                              ) : (
                                renderCellValue(relField, rel?.value, t, userNames, cellText)
                              );
                            return (
                              <td key={`pf-${pf.id}`} className="px-4 py-3 max-w-[240px] truncate" style={{ ...cellStyle, ...colWidthStyle(`pf:${pf.id}`) }}>
                                {relAssignable && pageId != null ? (
                                  <RelationLinkPicker
                                    pageId={pageId}
                                    fieldKey={pf.fieldKey}
                                    recordId={record.id}
                                    currentLinkedId={rel?.linkedRecordId ?? null}
                                    display={display}
                                    onChanged={() => setRefreshTick((x) => x + 1)}
                                  />
                                ) : (
                                  <div className="truncate">{display}</div>
                                )}
                              </td>
                            );
                          }
                          const cellEditable = inlineEditEnabled && !isFunction;
                          const pageFieldAsField = { ...pf, permissionsJson: {}, entityId: 0 } as unknown as Field;
                          if (isEditingThis) {
                            return (
                              <td key={`pf-${pf.id}`} className="px-4 py-3 max-w-[240px]" style={colWidthStyle(`pf:${pf.id}`)}>
                                <InlineCellEditor
                                  field={pageFieldAsField}
                                  initial={valueToForm(pageFieldAsField, pageValues[pf.fieldKey])}
                                  userOptions={userOptions}
                                  onCommit={(raw) => commitPageCell(record, pf, raw)}
                                  onCancel={() => setEditingCell(null)}
                                />
                              </td>
                            );
                          }
                          if (pf.fieldType === "boolean" && cellEditable) {
                            return (
                              <td key={`pf-${pf.id}`} className="px-4 py-3 max-w-[240px]" style={{ ...cellStyle, ...colWidthStyle(`pf:${pf.id}`) }}>
                                <Switch
                                  checked={pageValues[pf.fieldKey] === true}
                                  onCheckedChange={(v) => commitPageCell(record, pf, v)}
                                />
                              </td>
                            );
                          }
                          if (isFunction) {
                            const computed = formatFormulaResult(pf.formulaConfigJson?.expression ?? "", allValues);
                            return (
                              <td key={`pf-${pf.id}`} className="px-4 py-3 max-w-[240px] truncate" style={{ ...cellStyle, ...colWidthStyle(`pf:${pf.id}`) }}>
                                {computed.error ? (
                                  <span className="text-red-400 text-xs" title={t("fields.formulaError", "Ошибка формулы")}>{t("fields.formulaError", "Ошибка формулы")}</span>
                                ) : computed.text === "" ? (
                                  <span className="text-slate-300" style={cellText ? { color: cellText } : undefined}>—</span>
                                ) : (
                                  <span className="text-slate-700" style={cellText ? { color: cellText } : undefined}>{computed.bool !== undefined ? t(computed.bool ? "fields.yes" : "fields.no", computed.bool ? "Да" : "Нет") : computed.text}</span>
                                )}
                              </td>
                            );
                          }
                          return (
                            <td
                              key={`pf-${pf.id}`}
                              onClick={cellEditable ? () => setEditingCell({ recordId: record.id, fieldKey: pfKey }) : undefined}
                              className={`px-4 py-3 max-w-[240px] truncate ${cellEditable ? "cursor-text hover:bg-blue-50/60 rounded" : ""}`}
                              style={{ ...cellStyle, ...colWidthStyle(`pf:${pf.id}`) }}
                              title={cellEditable ? t("records.clickToEdit", "Нажмите, чтобы изменить") : undefined}
                            >
                              {renderCellValue(pageFieldAsField, pageValues[pf.fieldKey], t, userNames, cellText)}
                            </td>
                          );
                        })}
                        {statuses.length > 0 && (
                          <td className="px-4 py-3" style={colWidthStyle("__status__")}>
                            {editingCell?.recordId === record.id && editingCell?.fieldKey === "__status__" ? (
                              <Select
                                defaultOpen
                                value={record.statusId != null ? String(record.statusId) : NO_STATUS}
                                onValueChange={(v) => commitStatus(record, v)}
                                onOpenChange={(o) => { if (!o) setEditingCell(null); }}
                              >
                                <SelectTrigger className="h-8 w-44 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {!workflowActiveForRecord(record) && (
                                    <SelectItem value={NO_STATUS}>{t("records.noStatus", "Без статуса")}</SelectItem>
                                  )}
                                  {allowedStatusesForRecord(record).map((s: Status) => (
                                    <SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                            <div
                              className={`flex items-center gap-2 ${inlineEditEnabled ? "cursor-pointer rounded hover:bg-blue-50/60 -mx-1 px-1" : ""}`}
                              onClick={inlineEditEnabled ? () => setEditingCell({ recordId: record.id, fieldKey: "__status__" }) : undefined}
                              title={inlineEditEnabled ? t("records.clickToEdit", "Нажмите, чтобы изменить") : undefined}
                            >
                              {status ? (
                                <span
                                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={{ backgroundColor: `${status.color}20`, color: status.color }}
                                >
                                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: status.color }} />
                                  {ml(status.nameJson)}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                              {record.archivedAt && (
                                <span className="inline-flex items-center gap-1 text-indigo-500 text-xs">
                                  <Archive className="w-3 h-3" /> {t("records.inArchive", "В архиве")}
                                </span>
                              )}
                            </div>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canUpdate && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(record)}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-500"
                              title={t("records.history", "История изменений")}
                              onClick={() => setHistoryFor(record)}
                            >
                              <History className="w-3.5 h-3.5" />
                            </Button>
                            {canUpdate && (
                              record.archivedAt ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-indigo-500"
                                  title={t("records.restoreFromArchive", "Восстановить из архива")}
                                  disabled={unarchiveMutation.isPending}
                                  onClick={() => unarchiveMutation.mutate({ id: record.id })}
                                >
                                  <ArchiveRestore className="w-3.5 h-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-500"
                                  title={t("records.toArchive", "В архив")}
                                  disabled={archiveMutation.isPending}
                                  onClick={() => archiveMutation.mutate({ id: record.id })}
                                >
                                  <Archive className="w-3.5 h-3.5" />
                                </Button>
                              )
                            )}
                            {canDelete && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setToDelete(record)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {!canUpdate && !canDelete && <span className="text-slate-300 text-xs">—</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {t("records.shown", "Показано")} {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} {t("records.of", "из")} {total}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={page <= 1 || recordsLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-3.5 h-3.5" /> {t("records.prev", "Назад")}
              </Button>
              <span className="text-xs text-slate-400">
                {t("records.page", "Стр.")} {page} {t("records.of", "из")} {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={page >= totalPages || recordsLoading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t("records.next", "Вперёд")} <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("records.editTitle", "Редактировать запись") : t("records.newTitle", "Новая запись")}</DialogTitle>
            <DialogDescription>
              {t("records.dialogDesc", "Заполните поля записи. Обязательные поля помечены звёздочкой.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {visibleFormFields.map((field: Field) => {
              const access = fieldAccess(field, entityId, permPageId);
              const readOnly = access === "view";
              return (
                <div key={field.id} className="space-y-1.5">
                  <Label>
                    {ml(field.nameJson)}
                    {field.isRequired && <span className="text-red-500 ml-0.5">*</span>}
                    {readOnly && <span className="ml-1.5 text-xs font-normal text-slate-400">{t("records.readOnly", "(только чтение)")}</span>}
                  </Label>
                  <FieldInput
                    field={field}
                    value={form[field.fieldKey]}
                    onChange={(v) => setForm((prev) => ({ ...prev, [field.fieldKey]: v }))}
                    disabled={readOnly}
                    userOptions={userOptions}
                  />
                  {ml(field.descriptionJson) && (
                    <p className="text-xs text-slate-400">{ml(field.descriptionJson)}</p>
                  )}
                </div>
              );
            })}

            {statuses.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t("records.status", "Статус")}</Label>
                <Select value={statusId} onValueChange={setStatusId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("records.noStatus", "Без статуса")} />
                  </SelectTrigger>
                  <SelectContent>
                    {!workflowActive && <SelectItem value={NO_STATUS}>{t("records.noStatus", "Без статуса")}</SelectItem>}
                    {selectableStatuses.map((s: Status) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {ml(s.nameJson)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {workflowActive && (
                  <p className="text-xs text-slate-400">
                    {t("records.workflowHint", "Доступны только разрешённые процессом переходы из текущего статуса.")}
                  </p>
                )}
                {(() => {
                  if (!workflowActive) return null;
                  const targetId = statusId === NO_STATUS ? null : Number(statusId);
                  if (targetId == null || targetId === currentEditStatusId) return null;
                  const matchedTransition = transitions.find(
                    (tr: Transition) =>
                      tr.fromStatusId === currentEditStatusId && tr.toStatusId === targetId,
                  );
                  const req = matchedTransition?.requiredFieldKeys ?? [];
                  if (req.length === 0) return null;
                  return (
                    <p className="text-xs text-amber-600">
                      {t("records.transitionRequired", "Для перехода нужно заполнить:")}{" "}
                      {req
                        .map((k) => ml(fields.find((f: Field) => f.fieldKey === k)?.nameJson) || k)
                        .join(", ")}
                    </p>
                  );
                })()}
              </div>
            )}

            {editing && <RecordLinkManager entityId={entityId} recordId={editing.id} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("records.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? t("records.save", "Сохранить") : t("records.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.deleteTitle", "Удалить запись?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("records.deleteConfirm", "Запись будет удалена безвозвратно.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("records.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => toDelete && deleteMutation.mutate({ id: toDelete.id, data: { pageId: permPageId } })}
            >
              {t("records.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RecordHistoryDialog
        record={historyFor}
        onClose={() => setHistoryFor(null)}
        fieldNameByKey={new Map(allFields.map((f: Field) => [f.fieldKey, ml(f.nameJson)]))}
        statusById={statusById}
      />

      {canConfigureColumns && (
        <FieldConfigDialog
          open={columnDialogOpen}
          onOpenChange={setColumnDialogOpen}
          entityId={entityId}
          field={columnField}
          nextSortOrder={allFields.length + 1}
          onSaved={() => { invalidateFields(); }}
        />
      )}
      {canConfigureColumns && hasPage && pageId != null && (
        <PageFieldConfigDialog
          open={pageColumnDialogOpen}
          onOpenChange={setPageColumnDialogOpen}
          pageId={pageId}
          entityId={entityId}
          field={pageColumnField}
          nextSortOrder={allPageFields.length + 1}
          sourceFields={allFields
            .filter((f: Field) => f.fieldType !== "function")
            .map((f: Field) => ({ key: f.fieldKey, label: ml(f.nameJson) || f.fieldKey }))}
          onSaved={() => { invalidatePageFields(); }}
        />
      )}
    </div>
  );
}

const AUDIT_RESERVED: Record<string, { key: string; def: string }> = {
  __status__: { key: "records.auditStatus", def: "Статус" },
  __archived__: { key: "records.auditArchived", def: "Архив" },
  __created__: { key: "records.auditCreated", def: "Запись создана" },
  __deleted__: { key: "records.auditDeleted", def: "Запись удалена" },
};

function RecordHistoryDialog({
  record,
  onClose,
  fieldNameByKey,
  statusById,
}: {
  record: EntityRecord | null;
  onClose: () => void;
  fieldNameByKey: Map<string, string>;
  statusById: Map<number, Status>;
}) {
  const t = useT();
  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("records.history", "История изменений")}</DialogTitle>
          <DialogDescription>{t("records.historyDesc", "Кто, когда и что изменил: прежнее значение → новое.")}</DialogDescription>
        </DialogHeader>
        {record && (
          <RecordHistoryList recordId={record.id} fieldNameByKey={fieldNameByKey} statusById={statusById} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecordHistoryList({
  recordId,
  fieldNameByKey,
  statusById,
}: {
  recordId: number;
  fieldNameByKey: Map<string, string>;
  statusById: Map<number, Status>;
}) {
  const ml = useML();
  const t = useT();
  const { data: entries = [], isLoading } = useListRecordAuditLogs(recordId);

  const fieldLabel = (key: string | null): string => {
    if (!key) return "—";
    if (AUDIT_RESERVED[key]) return t(AUDIT_RESERVED[key].key, AUDIT_RESERVED[key].def);
    return fieldNameByKey.get(key) || key;
  };

  const renderValue = (key: string | null, value: string | null): string => {
    if (value === null) return "∅";
    if (key === "__status__") {
      const s = statusById.get(Number(value));
      return s ? ml(s.nameJson) : value;
    }
    if (key === "__archived__") return value === "true" ? t("records.yes", "Да") : t("records.no", "Нет");
    return value;
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
        <Inbox className="w-8 h-8" />
        <p className="text-sm">{t("records.historyEmpty", "Изменений пока нет")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400 border-b">
            <th className="px-3 py-2 font-medium">{t("records.when", "Когда")}</th>
            <th className="px-3 py-2 font-medium">{t("records.who", "Кто")}</th>
            <th className="px-3 py-2 font-medium">{t("records.field", "Поле")}</th>
            <th className="px-3 py-2 font-medium">{t("records.change", "Изменение")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e: AuditLogEntry) => (
            <tr key={e.id} className="border-b last:border-0 align-top">
              <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                {new Date(e.createdAt).toLocaleString("ru-RU")}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{e.userName || "—"}</td>
              <td className="px-3 py-2">{fieldLabel(e.fieldKey)}</td>
              <td className="px-3 py-2">
                {e.fieldKey === "__created__" || e.fieldKey === "__deleted__" ? (
                  <span className="text-slate-500">
                    {e.fieldKey === "__deleted__" && e.oldValue ? e.oldValue : "—"}
                  </span>
                ) : (
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-400 line-through">{renderValue(e.fieldKey, e.oldValue)}</span>
                    <span className="text-slate-300">→</span>
                    <span className="text-slate-700 font-medium">{renderValue(e.fieldKey, e.newValue)}</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Restrict user options to a `user`-field's allowed roles (empty/unset = all). */
function filterUserOptionsByRoles(field: Field, options: UserOption[]): UserOption[] {
  const allowed = field.userConfigJson?.allowedRoleIds;
  if (!Array.isArray(allowed) || allowed.length === 0) return options;
  return options.filter((u) => allowed.includes(u.roleId));
}

/**
 * Searchable picker that ASSIGNS / CHANGES / CLEARS the single link backing a
 * relation page-field cell. Opening it lazily fetches RBAC-filtered candidates
 * from the related entity (server-side, debounced search); selecting one calls
 * the related-link endpoint and bumps the caller's refresh tick. Server-side
 * filtering means the cmdk client filter is disabled (`shouldFilter={false}`).
 */
function RelationLinkPicker({
  pageId,
  fieldKey,
  recordId,
  currentLinkedId,
  display,
  onChanged,
}: {
  pageId: number;
  fieldKey: string;
  recordId: number;
  currentLinkedId: number | null;
  display: React.ReactNode;
  onChanged: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<PageRelatedCandidate[]>([]);
  const fetchCandidates = useGetPageRelatedCandidates().mutateAsync;
  const linkMutation = useSetPageRelatedLink();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      fetchCandidates({ pageId, data: { fieldKey, q: search.trim() || undefined } })
        .then((res) => {
          if (!cancelled) setCandidates(res.candidates);
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, search, pageId, fieldKey, fetchCandidates]);

  const choose = async (linkedRecordId: number | null) => {
    try {
      await linkMutation.mutateAsync({ pageId, data: { fieldKey, recordId, linkedRecordId } });
      setOpen(false);
      setSearch("");
      onChanged();
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("records.linkFailed", "Не удалось изменить связь"),
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 -mx-1 rounded px-1 text-left hover:bg-blue-50/60"
          title={t("records.clickToAssign", "Нажмите, чтобы назначить связь")}
        >
          <span className="truncate">{display}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-40" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t("records.relatedSearch", "Поиск записи...")}
          />
          <CommandList>
            <CommandEmpty>{t("records.relatedNotFound", "Записи не найдены")}</CommandEmpty>
            {currentLinkedId != null && (
              <CommandGroup>
                <CommandItem value="__clear__" onSelect={() => choose(null)} className="text-rose-600">
                  <X className="mr-2 h-4 w-4" />
                  {t("records.clearLink", "Очистить связь")}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {candidates.map((c) => (
                <CommandItem key={c.id} value={`${c.label} #${c.id}`} onSelect={() => choose(c.id)}>
                  <Check
                    className={cn("mr-2 h-4 w-4", currentLinkedId === c.id ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{c.label || `#${c.id}`}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Searchable single-select for `user`-type field values (Command + Popover). */
function UserCombobox({
  options,
  value,
  onChange,
  placeholder,
  triggerClassName,
  autoOpen = false,
  onClose,
  disabled = false,
}: {
  options: UserOption[];
  value: number | null;
  onChange: (id: number) => void;
  placeholder: string;
  triggerClassName?: string;
  autoOpen?: boolean;
  onClose?: (committed: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(autoOpen);
  const committedRef = useRef(false);
  const selected = options.find((u) => u.id === value) ?? null;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) onClose?.(committedRef.current);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn("justify-between font-normal", triggerClassName)}
        >
          <span className={cn("truncate", !selected && "text-slate-400")}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0">
        <Command>
          <CommandInput placeholder={t("records.userSearch", "Поиск пользователя...")} />
          <CommandList>
            <CommandEmpty>{t("records.userNotFound", "Пользователи не найдены")}</CommandEmpty>
            <CommandGroup>
              {options.map((u) => (
                <CommandItem
                  key={u.id}
                  value={`${u.name} #${u.id}`}
                  onSelect={() => {
                    committedRef.current = true;
                    onChange(u.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === u.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{u.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Inline (in-cell) editor used by the Google-Sheets-style records table.
 * Text-like inputs commit on Enter/blur and cancel on Escape; select/user
 * commit on choice. Boolean is handled by the table itself (toggles in place).
 */
function InlineCellEditor({
  field,
  initial,
  userOptions,
  onCommit,
  onCancel,
}: {
  field: Field;
  initial: CellValue;
  userOptions: UserOption[];
  onCommit: (raw: CellValue) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<CellValue>(initial);
  const cancelRef = useRef(false);
  const committedRef = useRef(false);

  const commitOnce = (raw: CellValue) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(raw);
  };

  if (field.fieldType === "file") {
    return (
      <InlineFileEditor
        initial={initial}
        allowedSources={fileAllowedSources(field.fileConfigJson)}
        driveFolderId={field.fileConfigJson?.driveFolderId}
        onCommit={commitOnce}
        onCancel={onCancel}
      />
    );
  }

  if (field.fieldType === "user") {
    return (
      <UserCombobox
        options={filterUserOptionsByRoles(field, userOptions)}
        value={draft != null && draft !== "" ? Number(draft) : null}
        onChange={(id) => commitOnce(id)}
        placeholder={t("records.selectUser", "Выберите пользователя")}
        triggerClassName="h-8 w-full text-sm"
        autoOpen
        onClose={(committed) => { if (!committed && !committedRef.current) onCancel(); }}
      />
    );
  }

  if (field.fieldType === "select") {
    const options = (Array.isArray(field.optionsJson) ? (field.optionsJson as string[]) : []).map((o) => ({ value: o, label: o }));
    return (
      <Select
        defaultOpen
        value={draft ? String(draft) : ""}
        onValueChange={(v) => commitOnce(v)}
        onOpenChange={(o) => { if (!o && !committedRef.current) onCancel(); }}
      >
        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("records.selectValue", "Выберите значение")} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.fieldType === "textarea") {
    return (
      <Textarea
        autoFocus
        rows={2}
        className="min-h-0 w-full resize-none rounded-sm border-0 bg-transparent p-0 text-sm leading-snug shadow-none focus-visible:ring-1 focus-visible:ring-blue-400"
        value={String(draft ?? "")}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { cancelRef.current = true; (e.target as HTMLTextAreaElement).blur(); } }}
        onBlur={() => { if (cancelRef.current) onCancel(); else commitOnce(draft); }}
      />
    );
  }

  const inputType =
    field.fieldType === "number" ? "number"
    : field.fieldType === "date" ? "date"
    : field.fieldType === "datetime" ? "datetime-local"
    : field.fieldType === "email" ? "email"
    : field.fieldType === "url" ? "url"
    : field.fieldType === "phone" ? "tel"
    : "text";

  return (
    <Input
      autoFocus
      type={inputType}
      className="h-auto w-full rounded-sm border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-blue-400"
      value={draft === "" || draft === undefined ? "" : String(draft)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
        else if (e.key === "Escape") { cancelRef.current = true; (e.target as HTMLInputElement).blur(); }
      }}
      onBlur={() => { if (cancelRef.current) onCancel(); else commitOnce(draft); }}
    />
  );
}

function FieldInput({
  field,
  value,
  onChange,
  disabled = false,
  userOptions = [],
}: {
  field: Field;
  value: CellValue | undefined;
  onChange: (v: CellValue) => void;
  disabled?: boolean;
  userOptions?: UserOption[];
}) {
  const t = useT();
  switch (field.fieldType) {
    case "file":
      return (
        <FileFieldInput
          value={value}
          onChange={onChange}
          disabled={disabled}
          allowedSources={fileAllowedSources(field.fileConfigJson)}
          driveFolderId={field.fileConfigJson?.driveFolderId}
        />
      );
    case "textarea":
      return <Textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />
          <span className="text-sm text-slate-500">{value ? t("records.yes", "Да") : t("records.no", "Нет")}</span>
        </div>
      );
    case "number":
      return (
        <Input
          type="number"
          value={value === "" || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
    case "date":
      return <Input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "datetime":
      return <Input type="datetime-local" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "email":
      return <Input type="email" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "url":
      return <Input type="url" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder="https://" disabled={disabled} />;
    case "phone":
      return <Input type="tel" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "user": {
      return (
        <UserCombobox
          options={filterUserOptionsByRoles(field, userOptions)}
          value={value != null && value !== "" ? Number(value) : null}
          onChange={(id) => onChange(id)}
          placeholder={t("records.selectUser", "Выберите пользователя")}
          triggerClassName="w-full"
          disabled={disabled}
        />
      );
    }
    case "select": {
      const options = Array.isArray(field.optionsJson) ? (field.optionsJson as string[]) : [];
      return (
        <Select value={value ? String(value) : ""} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger>
            <SelectValue placeholder={t("records.selectValue", "Выберите значение")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    default:
      return <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
  }
}

function sourceLabel(t: (k: string, d: string) => string, source: FileSource): string {
  if (source === "server") return t("records.fileSource.server", "Сервер");
  if (source === "gdrive") return t("records.fileSource.gdrive", "Google Drive");
  return t("records.fileSource.link", "Ссылка");
}

/**
 * Multi-source picker for a `file`-type field. Offers the sources allowed by the
 * field config (server upload, Google Drive, external link) and keeps an editable
 * display name. The committed value is the polymorphic FileValue. Used in the
 * record dialog/add-row (via FieldInput) and inside the inline editor.
 */
function FileFieldInput({
  value,
  onChange,
  disabled = false,
  compact = false,
  allowedSources = ["server"],
  driveFolderId,
}: {
  value: unknown;
  onChange: (v: FileValue | "") => void;
  disabled?: boolean;
  compact?: boolean;
  allowedSources?: FileSource[];
  driveFolderId?: string;
}) {
  const t = useT();
  const { toast } = useToast();
  const gdriveReady = useGoogleDriveReady();
  const fileValue = isFileValue(value) ? value : null;
  const currentKind: FileSource = fileValue
    ? isLinkFile(fileValue)
      ? "link"
      : isGDriveFile(fileValue)
        ? "gdrive"
        : "server"
    : allowedSources[0] ?? "server";
  const [source, setSource] = useState<FileSource>(
    allowedSources.includes(currentKind) ? currentKind : allowedSources[0] ?? "server",
  );
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const showName = source === fileValueSourceOf(fileValue);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadFile(file);
      onChange({
        kind: "server",
        path: res.path,
        name: source === "server" && fileValue && !isLinkFile(fileValue) && fileValue.name?.trim() ? fileValue.name : file.name,
        contentType: res.contentType,
        size: res.size,
      });
    } catch {
      toast({ title: t("records.fileUploadError", "Не удалось загрузить файл"), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDriveUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadToGoogleDrive(file, driveFolderId);
      onChange({
        kind: "gdrive",
        fileId: res.fileId,
        name: res.name,
        contentType: res.contentType,
        size: res.size,
        webViewLink: res.webViewLink,
      });
    } catch {
      toast({ title: t("records.driveUploadError", "Не удалось загрузить в Google Drive"), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      {allowedSources.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {allowedSources.map((s) => (
            <Button
              key={s}
              type="button"
              variant={s === source ? "default" : "outline"}
              size="sm"
              className={`h-7 px-2.5 text-xs ${s === source ? "bg-blue-600 hover:bg-blue-700" : ""}`}
              disabled={disabled || uploading}
              onClick={() => setSource(s)}
            >
              {sourceLabel(t, s)}
            </Button>
          ))}
        </div>
      )}

      {source === "server" && (
        <div className="flex items-center gap-2">
          <input ref={inputRef} type="file" className="hidden" onChange={handlePick} disabled={disabled || uploading} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={compact ? "h-8" : undefined}
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            <span className="ml-1.5">
              {showName ? t("records.fileReplace", "Заменить файл") : t("records.fileUpload", "Загрузить файл")}
            </span>
          </Button>
          {fileValue && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-500"
              disabled={disabled}
              title={t("records.fileRemove", "Удалить файл")}
              onClick={() => setConfirmRemove(true)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {source === "gdrive" && (
        <div className="flex items-center gap-2">
          <input ref={inputRef} type="file" className="hidden" onChange={handleDriveUpload} disabled={disabled || uploading || !gdriveReady} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={compact ? "h-8" : undefined}
            disabled={disabled || uploading || !gdriveReady}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            <span className="ml-1.5">
              {showName ? t("records.driveReplace", "Заменить в Google Drive") : t("records.driveUpload", "Загрузить в Google Drive")}
            </span>
          </Button>
          {fileValue && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-500"
              disabled={disabled}
              title={t("records.fileRemove", "Удалить файл")}
              onClick={() => setConfirmRemove(true)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {source === "gdrive" && !gdriveReady && (
        <p className="text-xs text-amber-600">
          {t("records.driveNotConnected", "Google Drive не подключён. Подключите его в настройках.")}
        </p>
      )}

      {source === "link" && (
        <Input
          type="url"
          value={fileValue && isLinkFile(fileValue) ? fileValue.url : ""}
          onChange={(e) => {
            const url = e.target.value;
            if (!url) {
              onChange("");
              return;
            }
            const prevName = fileValue && isLinkFile(fileValue) ? fileValue.name : undefined;
            onChange({ kind: "link", url, ...(prevName ? { name: prevName } : {}) });
          }}
          placeholder="https://"
          disabled={disabled}
          className={compact ? "h-8 text-sm" : undefined}
        />
      )}

      {showName && fileValue && (
        <Input
          value={isLinkFile(fileValue) ? (fileValue.name ?? "") : fileValue.name}
          onChange={(e) => onChange({ ...fileValue, name: e.target.value } as FileValue)}
          placeholder={t("records.fileDisplayName", "Отображаемое имя")}
          disabled={disabled}
          className={compact ? "h-8 text-sm" : undefined}
        />
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.fileRemoveConfirmTitle", "Удалить файл из поля?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {fileValue && isGDriveFile(fileValue)
                ? t(
                    "records.fileRemoveConfirmGdrive",
                    "Ссылка на файл будет удалена из этого поля. Сам файл в Google Drive останется без изменений.",
                  )
                : t(
                    "records.fileRemoveConfirmServer",
                    "Файл будет откреплён от этого поля и перемещён в корзину файлов — его можно будет восстановить.",
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("records.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                onChange("");
                setConfirmRemove(false);
              }}
            >
              {t("records.fileRemove", "Удалить файл")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The source of the current value, or null when empty. */
function fileValueSourceOf(value: FileValue | null): FileSource | null {
  if (!value) return null;
  if (isLinkFile(value)) return "link";
  if (isGDriveFile(value)) return "gdrive";
  return "server";
}

/** Inline (in-cell) file editor with a draft + explicit Save, so renaming does not
 *  commit on every keystroke. */
function InlineFileEditor({
  initial,
  allowedSources = ["server"],
  driveFolderId,
  onCommit,
  onCancel,
}: {
  initial: CellValue;
  allowedSources?: FileSource[];
  driveFolderId?: string;
  onCommit: (v: CellValue) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<FileValue | "">(isFileValue(initial) ? initial : "");
  return (
    <div className="min-w-[220px] space-y-2 rounded-md border border-blue-200 bg-white p-2 shadow-sm">
      <FileFieldInput value={draft} onChange={setDraft} allowedSources={allowedSources} driveFolderId={driveFolderId} compact />
      <div className="flex items-center gap-1">
        <Button size="sm" className="h-7 bg-blue-600 hover:bg-blue-700" onClick={() => onCommit(draft)}>
          {t("records.save", "Сохранить")}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-slate-500" onClick={onCancel}>
          {t("records.cancel", "Отмена")}
        </Button>
      </div>
    </div>
  );
}

/** Best-effort human label for a record: first non-empty field value, else `#id`. */
function recordLabel(record: EntityRecord): string {
  const values = (record.valuesJson ?? {}) as Record<string, unknown>;
  for (const v of Object.values(values)) {
    if (v !== undefined && v !== null && v !== "" && typeof v !== "object") {
      return String(v);
    }
  }
  return `#${record.id}`;
}

/** Link manager shown inside the record edit dialog. Lists each outgoing relation
 *  with its currently linked records and lets the user add/remove links. */
function RecordLinkManager({ entityId, recordId }: { entityId: number; recordId: number }) {
  const t = useT();
  const { data: relations = [], isLoading: relationsLoading } = useListEntityRelations(entityId);
  const { data: links = [], isLoading: linksLoading } = useListRecordLinks(recordId);

  if (relationsLoading) {
    return <Skeleton className="h-10 w-full" />;
  }
  if (relations.length === 0) {
    return null;
  }

  const linksByRelation = new Map<number, LinkedRecord[]>();
  for (const link of links) {
    const arr = linksByRelation.get(link.relationId) ?? [];
    arr.push(link);
    linksByRelation.set(link.relationId, arr);
  }

  return (
    <div className="space-y-4 border-t border-slate-100 pt-4">
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <Link2 className="w-4 h-4 text-blue-600" />
        {t("records.links", "Связи")}
      </div>
      {relations.map((relation: Relation) => (
        <RelationLinkSection
          key={relation.id}
          relation={relation}
          recordId={recordId}
          existingLinks={linksByRelation.get(relation.id) ?? []}
          linksLoading={linksLoading}
        />
      ))}
    </div>
  );
}

const PICK_PLACEHOLDER = "__pick__";

function RelationLinkSection({
  relation,
  recordId,
  existingLinks,
  linksLoading,
}: {
  relation: Relation;
  recordId: number;
  existingLinks: LinkedRecord[];
  linksLoading: boolean;
}) {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pick, setPick] = useState<string>(PICK_PLACEHOLDER);

  const { data: targetRecords = [], isLoading: targetLoading } = useListEntityRecords(
    relation.targetEntityId,
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/records/${recordId}/links`] });

  const createLink = useCreateRecordLink({
    mutation: {
      onSuccess: () => { setPick(PICK_PLACEHOLDER); invalidate(); },
      onError: (err) => toast({ title: t("records.linkAddError", "Не удалось добавить связь"), description: extractError(err), variant: "destructive" }),
    },
  });
  const deleteLink = useDeleteRecordLink({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (err) => toast({ title: t("records.linkDeleteError", "Не удалось удалить связь"), description: extractError(err), variant: "destructive" }),
    },
  });

  const linkedIds = new Set(existingLinks.map((l) => l.record.id));
  const available = targetRecords.filter((r: EntityRecord) => !linkedIds.has(r.id));
  const busy = createLink.isPending || deleteLink.isPending;

  const handleAdd = () => {
    if (pick === PICK_PLACEHOLDER) return;
    createLink.mutate({ recordId, data: { relationId: relation.id, targetRecordId: Number(pick) } });
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-100 p-3">
      <div className="text-sm font-medium text-slate-600">{ml(relation.nameJson)}</div>
      {linksLoading ? (
        <Skeleton className="h-6 w-full" />
      ) : existingLinks.length === 0 ? (
        <p className="text-xs text-slate-400">{t("records.noLinks", "Связанных записей нет.")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {existingLinks.map((link) => (
            <span
              key={link.linkId}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 text-xs px-2 py-1"
            >
              {recordLabel(link.record)}
              <button
                type="button"
                className="hover:text-blue-900 disabled:opacity-50"
                disabled={busy}
                onClick={() => deleteLink.mutate({ id: link.linkId })}
                aria-label={t("records.deleteLink", "Удалить связь")}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Select value={pick} onValueChange={setPick} disabled={targetLoading || available.length === 0}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={available.length === 0 ? t("records.noAvailable", "Нет доступных записей") : t("records.selectRecord", "Выберите запись")} />
          </SelectTrigger>
          <SelectContent>
            {available.map((r: EntityRecord) => (
              <SelectItem key={r.id} value={String(r.id)}>{recordLabel(r)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          disabled={pick === PICK_PLACEHOLDER || busy}
          onClick={handleAdd}
        >
          {createLink.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {t("records.link", "Связать")}
        </Button>
      </div>
    </div>
  );
}
