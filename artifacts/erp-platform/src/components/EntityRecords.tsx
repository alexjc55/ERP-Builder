import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, type CSSProperties } from "react";
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
  useGetEntity,
  useQueryEntityRecords,
  useGetEntityFilterValues,
  useGetFieldDependentValues,
  useRenameFieldValue,
  useArchiveRecord,
  useUnarchiveRecord,
  useListUserOptions,
  useListRecordAuditLogs,
  useListRoles,
  getListRolesQueryKey,
  useUpdatePage,
  getListPagesQueryKey,
  useListPageFields,
  useListPageRecordValues,
  getListPageFieldsQueryKey,
  getListPageRecordValuesQueryKey,
  useSetPageRecordValues,
  useReorderPageFields,
  useGetPageRelatedValues,
  useGetPageRelatedCandidates,
  useSetPageRelatedLink,
  useGetEntityRelatedValues,
  useGetEntityRelatedCandidates,
  useSetEntityRelatedLink,
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
  type SortSpec,
  type UserOption,
  type Role,
  type FieldAccess,
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
import { useML, useT, useLang } from "@/lib/i18n";
import { useGoogleDriveReady } from "@/lib/googleDrive";
import { FieldConfigDialog } from "@/components/FieldConfigDialog";
import { MultilingualInput } from "@/components/MultilingualInput";
import { CreateUserDialog } from "@/components/CreateUserDialog";
import { PageFieldConfigDialog } from "@/components/PageFieldConfigDialog";
import { formatFormulaResult, evaluateFormula } from "@workspace/formula";
import { computeRowFormatting, type FormatField } from "@/lib/formatRules";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, Inbox, X, Search, LayoutList, ChevronLeft, ChevronRight, ChevronDown, Star, ShieldAlert, Archive, ArchiveRestore, History, Settings2, Check, Filter, Upload, FileText, FileQuestion, Columns3, CircleDot, Share2, Workflow, Calendar as CalendarIcon, Cloud, ExternalLink, UserPlus } from "lucide-react";
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
// Reserved sort keys mapping to the record's system columns (creation date / id).
// Never rendered as table columns; kept in lockstep with the server sort builder.
const SYSTEM_SORT_CREATED_AT = "__created_at__";
const SYSTEM_SORT_RECORD_ID = "__record_id__";
const SYSTEM_SORT_KEYS = new Set<string>([SYSTEM_SORT_CREATED_AT, SYSTEM_SORT_RECORD_ID]);

function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const data = (err as { data?: { error?: unknown } }).data;
    if (data && typeof data.error === "string" && data.error.trim()) return data.error;
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
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

/** True when a value counts as "set" (mirrors the server's isEmpty boundary). */
function valueIsSet(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
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
    // Derived/read-only field types never carry a stored value in valuesJson:
    // function (computed), relation (linked record) and lookup (projected from a
    // linked record). The server drops them anyway, but we must not let the UI
    // even attempt to send them.
    if (field.fieldType === "function" || field.fieldType === "relation" || field.fieldType === "lookup") {
      continue;
    }
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
    // URLs are inherently LTR; force LTR + left align so in an RTL (Hebrew) UI the
    // link reads from its start and truncates at the end, not the other way round.
    return (
      <span dir="ltr" className="block max-w-full truncate text-left">
        <UrlPreviewCell url={String(value)} />
      </span>
    );
  }
  if (field.fieldType === "file") {
    if (!isFileValue(value)) return <span className="text-slate-300" style={colorStyle}>—</span>;
    return (
      <span dir="ltr" className="block max-w-full truncate text-left">
        <FileCell value={value} />
      </span>
    );
  }
  return <span className="text-slate-700" style={colorStyle}>{String(value)}</span>;
}

/**
 * Live preview of a lookup field's projected value during a CREATE flow, before
 * the base record (and thus its relation link) exists. We already know which
 * related record the user picked, so we fetch that record directly and project
 * its `relatedFieldKey`. The fetch re-applies the related entity's view / own /
 * hidden-status / field-hidden boundary server-side (GET /records/:id), so the
 * value shown here matches what the saved row will resolve via related-values.
 */
function LookupCreatePreview({
  linkedRecordId,
  relatedFieldKey,
  fallbackField,
  userNames,
}: {
  linkedRecordId: number;
  relatedFieldKey: string;
  fallbackField: Field;
  userNames: Map<number, string>;
}): React.ReactNode {
  const t = useT();
  const { data: record } = useGetRecord(linkedRecordId, {
    query: {
      enabled: linkedRecordId > 0 && relatedFieldKey !== "",
      queryKey: getGetRecordQueryKey(linkedRecordId),
    },
  });
  if (!record) return <span className="text-slate-300 text-xs">—</span>;
  const value = ((record.valuesJson ?? {}) as Record<string, unknown>)[relatedFieldKey];
  // `fallbackField` carries the correct related field type from
  // entityRelatedColMeta, but that map is empty until the page has ≥1 saved row,
  // so on a first-record create it falls back to "text". The only field type
  // that stores an OBJECT value is `file` — under the text fallback it would
  // render as "[object Object]". Detect a file value by shape and render it
  // properly; every other type is a primitive and renders fine as text. We do
  // NOT fetch the related entity's field schema here (that endpoint isn't view-
  // scoped); the value itself already passed the GET /records/:id boundary.
  const relField = isFileValue(value)
    ? ({ ...fallbackField, fieldType: "file" } as Field)
    : fallbackField;
  return renderCellValue(relField, value, t, userNames);
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
  effectiveType,
  triggerClassName,
}: {
  field: Field;
  selected: string[];
  onChange: (values: string[]) => void;
  getOptions: (fieldKey: string) => Promise<string[]>;
  ml: (v: unknown) => string;
  t: (key: string, def: string) => string;
  userNames: Map<number, string>;
  // For relation/lookup fields the filter values are the LINKED record's
  // projected field, so labels must resolve by that field's render type
  // (e.g. a projected `user` field stores ids → show names), not the
  // relation/lookup type itself.
  effectiveType?: Field["fieldType"];
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [optSearch, setOptSearch] = useState("");

  const ft = effectiveType ?? field.fieldType;
  const labelFor = (v: string): string => {
    if (ft === "user") return userNames.get(Number(v)) ?? `#${v}`;
    if (ft === "boolean") return v === "true" ? t("common.yes", "Да") : t("common.no", "Нет");
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

/**
 * Apply per-mirror-page display-only label overrides to a field list. When an
 * override for a field's `fieldKey` carries any non-empty localized value, the
 * field's `nameJson` is REPLACED by the override object (so `ml()` falls back
 * ru→en→he WITHIN the override and never leaks the source name in any language).
 * Fields with no/empty override are returned untouched. No-op when `overrides`
 * is undefined (regular non-mirror pages).
 */
function applyFieldLabelOverrides(
  fields: Field[],
  overrides: Record<string, Field["nameJson"]> | undefined,
): Field[] {
  if (!overrides) return fields;
  return fields.map((f) => {
    const ov = overrides[f.fieldKey];
    if (ov && (ov.ru?.trim() || ov.en?.trim() || ov.he?.trim())) {
      return { ...f, nameJson: ov };
    }
    return f;
  });
}

export function EntityRecords({
  entityId,
  visibleFieldKeys,
  pageId,
  isMirror = false,
  fieldLabelOverrides,
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
  /**
   * Per-mirror-page display-only label overrides, keyed by source-entity
   * `fieldKey`. When an override yields a non-empty localized string it REPLACES
   * the field's displayed name everywhere on this view (table header, filter bar,
   * sort/view config, record form). This is cosmetic only — it does NOT hide the
   * field or change any security boundary (real hiding stays via field-permission
   * "hidden" RBAC on the source entity). Only supplied on mirror pages, where
   * entity-column setup is suppressed, so the raw source field is never edited
   * through the (replaced) label.
   */
  fieldLabelOverrides?: Record<string, Field["nameJson"]>;
}) {
  const ml = useML();
  const t = useT();
  const { lang } = useLang();
  // Hebrew renders the whole table right-to-left, which flips the geometry of
  // column resizing: the handle's logical "end" edge is on the LEFT, and a
  // rightward pointer move must SHRINK (not grow) the column.
  const isRtl = lang === "he";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canRecord, canAdmin, fieldAccess, user } = useAuth();
  const userRoleIds: number[] =
    user?.roleIds && user.roleIds.length > 0
      ? user.roleIds
      : user?.roleId != null
        ? [user.roleId]
        : [];

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
  // Mirror pages let a "pages" admin rename a field's DISPLAYED label for this
  // page only (display-only override, NOT a security boundary — real hiding stays
  // via field "hidden" RBAC). Saving writes page.mirrorFieldLabelsJson via the
  // page update endpoint, which itself requires the "pages" cap server-side.
  const canEditMirrorLabels = isMirror && pageId != null && canAdmin("pages");
  const updateMirrorLabelsMutation = useUpdatePage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPagesQueryKey() });
        toast({ title: t("records.mirrorLabelSaved", "Заголовок обновлён") });
      },
      onError: () =>
        toast({
          title: t("records.mirrorLabelSaveError", "Не удалось сохранить заголовок"),
          variant: "destructive",
        }),
    },
  });
  const saveMirrorLabel = (fieldKey: string, value: { ru?: string; en?: string; he?: string }) => {
    if (pageId == null) return;
    const ru = value.ru?.trim() || undefined;
    const en = value.en?.trim() || undefined;
    const he = value.he?.trim() || undefined;
    const current: Record<string, { ru?: string; en?: string; he?: string }> = {
      ...(fieldLabelOverrides ?? {}),
    };
    if (ru || en || he) current[fieldKey] = { ru, en, he };
    else delete current[fieldKey];
    const next = Object.keys(current).length > 0 ? current : null;
    updateMirrorLabelsMutation.mutate({
      id: pageId,
      data: { mirrorFieldLabelsJson: next as Record<string, Field["nameJson"]> | null },
    });
    setMirrorLabelField(null);
  };

  const { data: rawAllFields = [], isLoading: fieldsLoading } = useListEntityFields(entityId);
  // On a mirror page, apply display-only per-field label overrides at the source
  // so every downstream consumer (table header, filter bar, sort/view config,
  // record form, dependent pickers) shows the renamed label automatically. No-op
  // on regular pages (no overrides supplied). The raw source field is never
  // mutated server-side; this only rewrites the displayed `nameJson`.
  const allFields = useMemo(
    () => applyFieldLabelOverrides(rawAllFields, fieldLabelOverrides),
    [rawAllFields, fieldLabelOverrides],
  );
  const { data: statuses = [] } = useListEntityStatuses(entityId);
  const { data: transitions = [] } = useListEntityTransitions(entityId);
  const { data: views = [] } = useListEntityViews(entityId);
  const { data: entity } = useGetEntity(entityId);
  const { data: userOptions = [] } = useListUserOptions();
  // Roles are only needed to label per-field permission overrides in setup mode.
  const { data: rolesList = [] } = useListRoles({
    query: { enabled: canConfigureColumns, queryKey: getListRolesQueryKey() },
  });

  const userNames = useMemo(
    () => new Map(userOptions.map((u: UserOption) => [u.id, u.name])),
    [userOptions],
  );

  const roleNameById = useMemo(
    () => new Map(rolesList.map((r: Role) => [String(r.id), ml(r.nameJson) || `#${r.id}`])),
    [rolesList, ml],
  );
  const fieldAccessLabel = (a: FieldAccess) =>
    a === "edit"
      ? t("fields.access.edit", "Редактирование")
      : a === "view"
        ? t("fields.access.view", "Просмотр")
        : t("fields.access.hidden", "Скрыто");
  // Explicit per-role overrides set on a field (anything other than the default
  // "inherit from the role's record perms"). Empty ⇒ the column uses defaults.
  const fieldRoleOverrides = (f: Field) =>
    Object.entries((f.permissionsJson ?? {}) as Record<string, FieldAccess>).map(
      ([roleId, access]) => ({
        roleId,
        name: roleNameById.get(roleId) ?? `#${roleId}`,
        access,
        label: fieldAccessLabel(access),
      }),
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

  // Keys of all `user`-type fields (entity + page). A formula that references a
  // user field should show the user's NAME, not the raw stored id, so we
  // substitute id → name in the values map before evaluating.
  const userFormulaFieldKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const f of allFields) if (f.fieldType === "user") keys.add(f.fieldKey);
    for (const pf of pageFields) if (pf.fieldType === "user") keys.add(pf.fieldKey);
    return keys;
  }, [allFields, pageFields]);

  const resolveFormulaValues = useCallback(
    (vals: Record<string, unknown>): Record<string, unknown> => {
      if (userFormulaFieldKeys.size === 0) return vals;
      const out: Record<string, unknown> = { ...vals };
      for (const k of userFormulaFieldKeys) {
        const v = out[k];
        if (v == null || v === "") continue;
        if (Array.isArray(v)) {
          out[k] = v.map((id) => userNames.get(Number(id)) ?? String(id)).join(", ");
        } else {
          out[k] = userNames.get(Number(v)) ?? v;
        }
      }
      return out;
    },
    [userFormulaFieldKeys, userNames],
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

  // Entity-level relation FIELDS mirror the page-field relation mechanism, but the
  // config lives on the entity field (relationConfigJson) and values resolve via
  // the entity-keyed related-values endpoint (the relation field's OWN field perms
  // apply — there is no page-field role-visibility layer here).
  const hasEntityRelationFields = allFields.some(
    (f: Field) => f.fieldType === "relation" || f.fieldType === "lookup",
  );
  const [entityRelatedColumns, setEntityRelatedColumns] = useState<PageRelatedColumn[]>([]);
  const [entityRelatedByRecord, setEntityRelatedByRecord] = useState<
    Map<number, Map<string, PageRelatedValue>>
  >(new Map());
  const entityRelatedColMeta = useMemo(() => {
    const m = new Map<string, PageRelatedColumn>();
    for (const c of entityRelatedColumns) m.set(c.fieldKey, c);
    return m;
  }, [entityRelatedColumns]);
  const fetchEntityRelatedValues = useGetEntityRelatedValues().mutateAsync;

  // Optional mirror-page projection: restrict to a chosen subset of field keys.
  const mirrorKeySet =
    visibleFieldKeys && visibleFieldKeys.length > 0 ? new Set(visibleFieldKeys) : null;
  const fields = [...allFields]
    .filter((f: Field) => f.isActive)
    .filter((f: Field) => !mirrorKeySet || mirrorKeySet.has(f.fieldKey))
    .sort((a: Field, b: Field) => a.sortOrder - b.sortOrder);
  // Fields the current user is allowed to see (not hidden by field-level perms).
  const visibleFormFields = fields.filter((f: Field) => fieldAccess(f, entityId, permPageId) !== "hidden");
  // Map relationId → the relation FIELD key that carries the chosen linked record.
  // A lookup field projects from the SAME relation, so during a CREATE flow (no
  // base record yet) we resolve which linked record id was picked to preview its
  // value before the record is saved.
  const relationFieldKeyByRelationId = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of fields) {
      const rid = f.relationConfigJson?.relationId;
      if (f.fieldType === "relation" && rid != null && !m.has(rid)) m.set(rid, f.fieldKey);
    }
    return m;
  }, [fields]);
  // Resolve the linked record id feeding a lookup field from the current form
  // state (inline add-row or create modal). Null when the relation isn't picked.
  const lookupLinkedId = (f: Field, rowValues: FormState): number | null => {
    const rid = f.relationConfigJson?.relationId;
    if (rid == null) return null;
    const relKey = relationFieldKeyByRelationId.get(rid);
    if (!relKey) return null;
    const v = rowValues[relKey];
    return typeof v === "number" && v > 0 ? v : null;
  };
  // Columns shown in the records table. A field is dropped from the table only
  // when EVERY assigned role hides it (most-permissive multi-role union). A role
  // with no explicit per-field entry inherits view/edit (i.e. not hidden), so its
  // presence keeps the column — matching `fieldAccess`'s effective decision. This
  // display-only hide still applies even to superAdmin because it reads the
  // per-role config directly (not `fieldAccess`, which gives super a pass) — the
  // field stays editable in the record dialog and the server bypass is unchanged.
  const tableFields = visibleFormFields.filter((f: Field) => {
    if (userRoleIds.length === 0) return true;
    return userRoleIds.some((rid) => f.permissionsJson?.[String(rid)] !== "hidden");
  });
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
  // Write-through lookup: the linked record (in the related entity) currently open
  // for full editing from a lookup cell.
  const [writeThroughEdit, setWriteThroughEdit] = useState<{ entityId: number; recordId: number } | null>(null);
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
  // Mirror-page display-only label override editor: in setup mode, clicking a
  // column header on a mirror page opens this dialog to rename just that field's
  // displayed label for this page (writes page.mirrorFieldLabelsJson). Editing
  // never touches the source entity field.
  const [mirrorLabelField, setMirrorLabelField] = useState<Field | null>(null);

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
    // In setup mode the headers carry extra controls (move arrows, sort number,
    // permission badge, config button). Honoring the manually-saved widths there
    // squeezes those controls and makes columns overlap, so we ignore the saved
    // widths and let the table auto-size to fit one line. The saved widths stay
    // in state/localStorage and reapply automatically once setup mode is off.
    if (setupMode) return undefined;
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
      // In RTL the resize handle is on the column's left edge, so a leftward
      // (decreasing clientX) move must grow the column — invert the delta.
      const delta = isRtl ? startX - ev.clientX : ev.clientX - startX;
      const w = Math.max(60, Math.round(startW + delta));
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
      className={`absolute top-0 ${isRtl ? "left-0" : "right-0"} z-10 h-full w-1.5 cursor-col-resize touch-none select-none bg-transparent hover:bg-blue-400/60`}
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
                t.allowedRoleIds.some((rid) => userRoleIds.includes(rid))),
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

  // With no view selected, fall back to the entity's configured default sort
  // (set in the views screen). A selected view's own sorts always take priority.
  // Drop any sort whose field no longer exists on the entity so a deleted field
  // can't break the default table with a server "Unknown sort field" error.
  const entityDefaultSorts = useMemo(() => {
    const raw = Array.isArray(entity?.defaultSortJson) ? (entity.defaultSortJson as SortSpec[]) : [];
    const known = new Set(allFields.filter((f: Field) => f.isActive).map((f: Field) => f.fieldKey));
    return raw.filter((s) => known.has(s.field) || SYSTEM_SORT_KEYS.has(s.field));
  }, [entity?.defaultSortJson, allFields]);
  const effectiveSorts = selectedView ? (selectedConfig.sorts ?? []) : entityDefaultSorts;
  const sortsKey = JSON.stringify(effectiveSorts);

  const recordQuery: RecordQuery = useMemo(
    () => ({
      filters: [...(selectedConfig.filters ?? []), ...adHocFilters, ...dateFilterConditions],
      filterConjunction: selectedConfig.filterConjunction ?? "and",
      statusIds: statusFilter.length > 0 ? statusFilter : undefined,
      sorts: effectiveSorts,
      search: search.trim() || undefined,
      archived,
      page,
      pageSize: PAGE_SIZE,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedConfig.filters, selectedConfig.filterConjunction, sortsKey, adHocKey, dateKey, statusKey, search, archived, page],
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

  // Entity relation FIELDS: resolve their live values via the entity-keyed
  // endpoint (independent of the page-field relation fetch above).
  const entityRelationFieldsKey = useMemo(
    () =>
      JSON.stringify(
        allFields
          .filter((f: Field) => f.fieldType === "relation" || f.fieldType === "lookup")
          .map((f: Field) => [f.fieldKey, f.relationConfigJson?.relationId, f.relationConfigJson?.relatedFieldKey]),
      ),
    [allFields],
  );
  useEffect(() => {
    if (!hasEntityRelationFields || records.length === 0) {
      setEntityRelatedColumns([]);
      setEntityRelatedByRecord(new Map());
      return;
    }
    let cancelled = false;
    const recordIds = records.map((r: EntityRecord) => r.id);
    fetchEntityRelatedValues({ entityId, data: { recordIds, pageId: permPageId } })
      .then((res) => {
        if (cancelled) return;
        setEntityRelatedColumns(res.columns);
        const m = new Map<number, Map<string, PageRelatedValue>>();
        for (const v of res.values) {
          let inner = m.get(v.recordId);
          if (!inner) {
            inner = new Map();
            m.set(v.recordId, inner);
          }
          inner.set(v.fieldKey, v);
        }
        setEntityRelatedByRecord(m);
      })
      .catch(() => {
        if (cancelled) return;
        setEntityRelatedColumns([]);
        setEntityRelatedByRecord(new Map());
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, hasEntityRelationFields, recordIdsKey, entityRelationFieldsKey, refreshTick]);

  const reorderFieldsMutation = useReorderFields({
    mutation: {
      onSuccess: () => invalidateFields(),
      onError: () => toast({ title: t("records.reorderColumnError", "Ошибка изменения порядка колонок"), variant: "destructive" }),
    },
  });

  const moveColumn = (list: Field[], index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const reordered = [...list];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    reorderFieldsMutation.mutate({
      data: {
        entityId,
        items: reordered.map((f, i) => ({ id: f.id, sortOrder: i + 1 })),
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
    const reordered = [...list];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    reorderPageFieldsMutation.mutate({
      data: {
        pageId,
        items: reordered.map((f, i) => ({ id: f.id, sortOrder: i + 1 })),
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
  // Used to persist relation-field links chosen during a CREATE flow, once the
  // base record exists (a link cannot be written before the record id is known).
  const setEntityLinkMutation = useSetEntityRelatedLink();

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

  // Resolve a relation field's dependent (cascading) gating from a draft form
  // (modal `form` or inline `newRow`): a relation parent contributes its selected
  // linked record id, any other parent its scalar value (both as a string).
  const relCreateDepInfo = (
    field: Field,
    src: FormState,
    recordId?: number,
  ): { dependent: boolean; parentValue: string | null; relatedFilterFieldKey: string | null } => {
    const dep = field.dependencyConfigJson;
    const dependent = !!(dep?.dependsOnFieldKey && dep?.relatedFilterFieldKey);
    let parentValue: string | null = null;
    if (dependent && dep?.dependsOnFieldKey) {
      const raw = src[dep.dependsOnFieldKey];
      if (raw != null && raw !== "") {
        // CREATE flow keeps a relation parent's picked id (and scalar parents) in
        // the form snapshot.
        parentValue = String(raw);
      } else {
        // EDIT flow: a relation parent's link is not part of valuesJson/form — read
        // it from the loaded per-record relation links.
        const parentField = fields.find((x) => x.fieldKey === dep.dependsOnFieldKey);
        if (parentField?.fieldType === "relation" && recordId != null) {
          const pid = entityRelatedByRecord.get(recordId)?.get(dep.dependsOnFieldKey)?.linkedRecordId;
          parentValue = pid == null ? null : String(pid);
        }
      }
    }
    return { dependent, parentValue, relatedFilterFieldKey: dep?.relatedFilterFieldKey ?? null };
  };

  // After a base record is created, persist any relation-field selections made in
  // a CREATE flow (modal or inline add-row). A relation link needs the new record
  // id, so it cannot be written before create — we defer it to here. Best-effort
  // per field; a failure is surfaced but does not undo the created record.
  const persistPendingRelationLinks = async (recordId: number, src: FormState) => {
    for (const rf of fields) {
      if (rf.fieldType !== "relation") continue;
      if (fieldAccess(rf, entityId, permPageId) !== "edit") continue;
      const v = src[rf.fieldKey];
      const linkedRecordId = typeof v === "number" ? v : v != null && v !== "" ? Number(v) : null;
      if (linkedRecordId == null || !Number.isFinite(linkedRecordId)) continue;
      try {
        await setEntityLinkMutation.mutateAsync({ entityId, data: { fieldKey: rf.fieldKey, recordId, linkedRecordId } });
      } catch (e) {
        toast({
          variant: "destructive",
          title: t("records.linkFailed", "Не удалось изменить связь"),
          description: e instanceof Error ? e.message : undefined,
        });
      }
    }
    setRefreshTick((x) => x + 1);
  };

  const handleSubmit = () => {
    // Only send fields the user can see; hidden/view-only are preserved server-side.
    const valuesJson = formToValues(visibleFormFields, form);
    const statusValue = statusId === NO_STATUS ? null : Number(statusId);
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: { valuesJson, statusId: statusValue, pageId: permPageId } });
    } else {
      void (async () => {
        try {
          const created = await createMutation.mutateAsync({ entityId, data: buildCreateData(valuesJson, statusValue) });
          if (created?.id != null) await persistPendingRelationLinks(created.id, form);
        } catch {
          // errors surfaced via mutation onError toasts
        }
      })();
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
    // Changing a parent field invalidates its dependent children: clear them in
    // the same write so stale child values don't persist (mirrors add-row/dialog).
    const current = (record.valuesJson ?? {}) as Record<string, unknown>;
    const cleared = clearDependentDescendants({ ...current, [field.fieldKey]: next }, field.fieldKey, fields);
    const payload: Record<string, unknown> = { [field.fieldKey]: next };
    for (const f of fields) {
      if (isDependentField(f) && current[f.fieldKey] !== cleared[f.fieldKey]) payload[f.fieldKey] = "";
    }
    cellUpdateMutation.mutate({ id: record.id, data: { valuesJson: payload, pageId: permPageId } });
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
              tr.allowedRoleIds.some((rid) => userRoleIds.includes(rid))),
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
    const pageValuesJson: Record<string, unknown> = {};
    if (hasPage && pageId != null) {
      for (const pf of pageFields) {
        if (pf.fieldType === "function" || pf.fieldType === "relation") continue;
        const val = cellValueForPayload({ ...pf, permissionsJson: {}, entityId: 0 } as unknown as Field, newPageRow[pf.fieldKey] as CellValue);
        if (val !== "" && val !== undefined && val !== null) pageValuesJson[pf.fieldKey] = val;
      }
    }
    void (async () => {
      try {
        const created = await createMutation.mutateAsync({ entityId, data: buildCreateData(valuesJson, statusValue) });
        if (created?.id != null) {
          if (hasPage && pageId != null && Object.keys(pageValuesJson).length > 0) {
            await setPageValuesMutation.mutateAsync({ pageId, recordId: created.id, data: { valuesJson: pageValuesJson } });
          }
          setNewPageRow({});
          await persistPendingRelationLinks(created.id, newRow);
        }
      } catch {
        // errors surfaced via mutation onError toasts
      }
    })();
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

  // ── Pinned (frozen-left) columns ──────────────────────────────────────────
  // Fields/page-fields flagged isPinned stay stuck to the left while the rest of
  // the table scrolls horizontally. A column's sticky offset is the cumulative
  // measured width of the pinned columns to its left, in DOM order (entity
  // fields, then page fields) — measurement is required because columns can be
  // auto-width. Pinning is suppressed in setup mode where headers carry extra
  // controls and saved widths are already ignored (see colWidthStyle).
  const pinnedKeys = useMemo(() => {
    const s = new Set<string>();
    if (!setupMode) {
      for (const f of displayFields) if (f.isPinned) s.add(`f:${f.id}`);
      for (const pf of displayedPageFields) if (pf.isPinned) s.add(`pf:${pf.id}`);
    }
    return s;
  }, [displayFields, displayedPageFields, setupMode]);
  const pinnedOrder = useMemo(() => {
    const keys: string[] = [];
    for (const f of displayFields) if (pinnedKeys.has(`f:${f.id}`)) keys.push(`f:${f.id}`);
    for (const pf of displayedPageFields) if (pinnedKeys.has(`pf:${pf.id}`)) keys.push(`pf:${pf.id}`);
    return keys;
  }, [displayFields, displayedPageFields, pinnedKeys]);
  const lastPinnedKey = pinnedOrder[pinnedOrder.length - 1];
  const pinHeaderRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  const [pinnedLeft, setPinnedLeft] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    if (pinnedOrder.length === 0) {
      setPinnedLeft((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }
    const measure = () => {
      const next: Record<string, number> = {};
      let acc = 0;
      for (const key of pinnedOrder) {
        next[key] = acc;
        acc += pinHeaderRefs.current[key]?.offsetWidth ?? 0;
      }
      setPinnedLeft((prev) => {
        const same =
          Object.keys(prev).length === pinnedOrder.length &&
          pinnedOrder.every((k) => prev[k] === next[k]);
        return same ? prev : next;
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [pinnedOrder, columnWidths, records, recordsLoading, numericTotals]);
  // Sticky is only applied once every pinned column's offset has been measured;
  // until then we render columns normally rather than risk several collapsing to
  // left:0 and overlapping during a transient render before refs resolve.
  const pinReady = pinnedOrder.every((k) => k in pinnedLeft);
  // Sticky style for a pinned cell. The background must be opaque so scrolling
  // cells don't show through; a caller-supplied conditional-format/row colour
  // takes precedence, otherwise the given base colour. The last pinned column
  // gets a divider shadow to mark the frozen boundary.
  const pinStyle = (key: string, bg: string, isHeader = false): CSSProperties | undefined => {
    if (!pinnedKeys.has(key) || !pinReady) return undefined;
    return {
      position: "sticky",
      left: pinnedLeft[key] ?? 0,
      zIndex: isHeader ? 3 : 2,
      backgroundColor: bg,
      ...(key === lastPinnedKey ? { boxShadow: "2px 0 5px -2px rgba(15,23,42,0.15)" } : undefined),
    };
  };

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
          {(canConfigureColumns || canEditMirrorLabels) && (
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
                effectiveType={
                  f.fieldType === "relation" || f.fieldType === "lookup"
                    ? ((entityRelatedColMeta.get(f.fieldKey)?.relatedFieldType ?? "text") as Field["fieldType"])
                    : f.fieldType
                }
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
                              ...pinStyle(`f:${f.id}`, hasTotal ? "#ecfdf5" : "#ffffff", true),
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
                        const pfTotalKey = `pf:${pf.id}`;
                        const hasTotal = numericTotals[pfTotalKey] !== undefined;
                        return (
                          <th
                            key={`tot-pf-${pf.id}`}
                            className={cn("px-4 py-3 text-left", hasTotal && !pf.totalFillColor && "bg-emerald-50")}
                            style={{
                              ...pinStyle(`pf:${pf.id}`, hasTotal ? "#ecfdf5" : "#ffffff", true),
                              ...(hasTotal && pf.totalFillColor ? { backgroundColor: pf.totalFillColor } : undefined),
                              ...colWidthStyle(`pf:${pf.id}`),
                            }}
                          >
                            {hasTotal ? (
                              <span
                                className={cn("text-sm font-bold whitespace-nowrap", !pf.totalTextColor && "text-emerald-700")}
                                style={pf.totalTextColor ? { color: pf.totalTextColor } : undefined}
                              >
                                {numericTotals[pfTotalKey].toLocaleString("ru-RU")}
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
                        ref={(el) => { pinHeaderRefs.current[`f:${f.id}`] = el; }}
                        className="relative align-top text-center px-4 py-3 font-medium text-slate-600 break-words"
                        style={{ ...pinStyle(`f:${f.id}`, "#f8fafc", true), ...colWidthStyle(`f:${f.id}`) }}
                      >
                        {setupMode && !isMirror ? (
                          <div className="flex flex-col items-center gap-1">
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
                                <span className="text-slate-400 font-normal">({f.sortOrder})</span>
                                <Settings2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {(() => {
                              const overrides = fieldRoleOverrides(f);
                              if (overrides.length === 0) return null;
                              return (
                                <HoverCard openDelay={100}>
                                  <HoverCardTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => openColumnConfig(f)}
                                      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100 transition"
                                    >
                                      <ShieldAlert className="w-3 h-3" />
                                      {t("records.colPermsBadge", "Особые права")}: {overrides.length}
                                    </button>
                                  </HoverCardTrigger>
                                  <HoverCardContent align="center" className="w-64 p-3">
                                    <p className="text-xs font-semibold text-slate-700 mb-2">
                                      {t("records.colPermsTitle", "Права доступа по ролям")}
                                    </p>
                                    <ul className="space-y-1">
                                      {overrides.map((o) => (
                                        <li
                                          key={o.roleId}
                                          className="flex items-center justify-between gap-2 text-xs"
                                        >
                                          <span className="text-slate-600 truncate text-left">{o.name}</span>
                                          <span
                                            className={cn(
                                              "px-1.5 py-0.5 rounded text-[10px] leading-none shrink-0",
                                              o.access === "hidden"
                                                ? "bg-red-100 text-red-700"
                                                : o.access === "view"
                                                  ? "bg-slate-100 text-slate-600"
                                                  : "bg-emerald-100 text-emerald-700",
                                            )}
                                          >
                                            {o.label}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </HoverCardContent>
                                </HoverCard>
                              );
                            })()}
                          </div>
                        ) : setupMode && isMirror && canEditMirrorLabels ? (
                          <button
                            type="button"
                            onClick={() => setMirrorLabelField(f)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-1 text-amber-700 hover:bg-amber-100 transition"
                            title={t("records.mirrorLabelEdit", "Переименовать заголовок на этой странице")}
                          >
                            {ml(f.nameJson)}
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          ml(f.nameJson)
                        )}
                        <ResizeHandle colKey={`f:${f.id}`} />
                      </th>
                    ))}
                    {displayedPageFields.map((pf: PageField, pi: number) => (
                      <th
                        key={`pf-${pf.id}`}
                        ref={(el) => { pinHeaderRefs.current[`pf:${pf.id}`] = el; }}
                        className="relative align-top text-center px-4 py-3 font-medium text-slate-600 break-words"
                        style={{ ...pinStyle(`pf:${pf.id}`, "#f8fafc", true), ...colWidthStyle(`pf:${pf.id}`) }}
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
                              <span className="text-slate-400 font-normal">({pf.sortOrder})</span>
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
                        const editable =
                          fieldAccess(f, entityId, permPageId) === "edit" &&
                          f.fieldType !== "function" &&
                          f.fieldType !== "lookup";
                        const addRowRelInfo = relCreateDepInfo(f, newRow);
                        return (
                          <td key={f.id} className="px-2 py-1.5 align-top max-w-[260px]" style={{ ...pinStyle(`f:${f.id}`, "#eff6ff"), ...colWidthStyle(`f:${f.id}`) }}>
                            {editable && f.fieldType === "relation" ? (
                              <RelationCreatePicker
                                entityId={entityId}
                                fieldKey={f.fieldKey}
                                pageId={permPageId}
                                value={typeof newRow[f.fieldKey] === "number" ? (newRow[f.fieldKey] as number) : null}
                                onChange={(id) =>
                                  setNewRow((prev) =>
                                    clearDependentDescendants({ ...prev, [f.fieldKey]: id ?? "" }, f.fieldKey, fields),
                                  )
                                }
                                dependent={addRowRelInfo.dependent}
                                parentValue={addRowRelInfo.parentValue}
                                relatedFilterFieldKey={addRowRelInfo.relatedFilterFieldKey}
                              />
                            ) : editable ? (
                              <FieldInput
                                field={f}
                                value={newRow[f.fieldKey]}
                                onChange={(v) =>
                                  setNewRow((prev) =>
                                    clearDependentDescendants({ ...prev, [f.fieldKey]: v }, f.fieldKey, fields),
                                  )
                                }
                                userOptions={userOptions}
                                allFields={fields}
                                rowValues={newRow}
                                entityId={entityId}
                                pageId={permPageId}
                              />
                            ) : f.fieldType === "lookup" ? (
                              (() => {
                                const linkedId = lookupLinkedId(f, newRow);
                                if (linkedId == null)
                                  return <span className="text-slate-300 text-xs">—</span>;
                                const meta = entityRelatedColMeta.get(f.fieldKey);
                                const fallbackField = {
                                  ...f,
                                  fieldType: (meta?.relatedFieldType ?? "text") as Field["fieldType"],
                                  optionsJson: meta?.optionsJson ?? [],
                                } as unknown as Field;
                                return (
                                  <LookupCreatePreview
                                    linkedRecordId={linkedId}
                                    relatedFieldKey={f.relationConfigJson?.relatedFieldKey ?? ""}
                                    fallbackField={fallbackField}
                                    userNames={userNames}
                                  />
                                );
                              })()
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
                          <td key={`pf-${pf.id}`} className="px-2 py-1.5 align-top max-w-[260px]" style={{ ...pinStyle(`pf:${pf.id}`, "#eff6ff"), ...colWidthStyle(`pf:${pf.id}`) }}>
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
                    const formulaValues = resolveFormulaValues(allValues);
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
                      // relation/lookup values are projected from the linked
                      // record (held in entityRelatedByRecord for entity fields,
                      // relatedByRecord for page-relation fields), NOT stored in the
                      // row's valuesJson. Resolve them here so conditional formatting
                      // matches the displayed value instead of treating it as empty.
                      if (def && (def.fieldType === "relation" || def.fieldType === "lookup")) {
                        const entityRel = entityRelatedByRecord.get(record.id)?.get(key);
                        if (entityRel) return entityRel.value;
                        return relatedByRecord.get(record.id)?.get(key)?.value;
                      }
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
                          // A lockAfterCreate field stops being editable once it has a
                          // value (mirrors the hard server boundary on records update).
                          const cellEditable =
                            inlineEditEnabled &&
                            access === "edit" &&
                            !isFunction &&
                            !scalarFieldLocked(f, values[f.fieldKey]);
                          const cellBg = formatting.cellColors[f.fieldKey];
                          const cellText = formatting.cellTextColors[f.fieldKey];
                          const cellStyle = cellBg || cellText ? { backgroundColor: cellBg || undefined, color: cellText || undefined } : undefined;
                          if (f.fieldType === "relation" || f.fieldType === "lookup") {
                            const meta = entityRelatedColMeta.get(f.fieldKey);
                            const rel = entityRelatedByRecord.get(record.id)?.get(f.fieldKey);
                            // Synthetic Field so the related value reuses the standard cell
                            // renderer with the related field's render type / select options.
                            const relField = {
                              ...f,
                              fieldType: (meta?.relatedFieldType ?? "text") as Field["fieldType"],
                              optionsJson: meta?.optionsJson ?? [],
                            } as unknown as Field;
                            // Assignable column-wide when inline edit is on and the server
                            // reports both the column and this row's link as editable. A
                            // lockAfterCreate field stops being assignable once a link exists
                            // (mirrors the hard server boundary on related-link).
                            const relAssignable =
                              inlineEditEnabled &&
                              !!meta?.editableColumn &&
                              !!rel?.editable &&
                              !relationFieldLocked(f, rel?.linkedRecordId);
                            // Dependent (cascading) relation field: resolve the parent
                            // field's value for this row to gate + filter the picker. A
                            // relation parent contributes its linked record id; any other
                            // parent contributes its stored scalar value.
                            const relDep = f.dependencyConfigJson;
                            const relDepParentKey = relDep?.dependsOnFieldKey;
                            const relIsDependent = !!(relDepParentKey && relDep?.relatedFilterFieldKey);
                            let relParentValue: string | null = null;
                            if (relIsDependent && relDepParentKey) {
                              const parentField = fields.find((x) => x.fieldKey === relDepParentKey);
                              if (parentField?.fieldType === "relation") {
                                const pid = entityRelatedByRecord.get(record.id)?.get(relDepParentKey)?.linkedRecordId;
                                relParentValue = pid == null ? null : String(pid);
                              } else {
                                const raw = values[relDepParentKey];
                                relParentValue = raw == null || raw === "" ? null : String(raw);
                              }
                            }
                            const display =
                              rel?.linkedRecordId == null ? (
                                <span className="text-slate-300">—</span>
                              ) : (
                                renderCellValue(relField, rel?.value, t, userNames, cellText)
                              );
                            return (
                              <td key={f.id} className="px-4 py-3 max-w-[240px] truncate" style={{ ...pinStyle(`f:${f.id}`, formatting.rowColor || "#ffffff"), ...cellStyle, ...colWidthStyle(`f:${f.id}`) }}>
                                {relAssignable ? (
                                  <EntityRelationLinkPicker
                                    entityId={entityId}
                                    fieldKey={f.fieldKey}
                                    recordId={record.id}
                                    currentLinkedId={rel?.linkedRecordId ?? null}
                                    display={display}
                                    onChanged={() => setRefreshTick((x) => x + 1)}
                                    dependent={relIsDependent}
                                    parentValue={relParentValue}
                                    relatedFilterFieldKey={relDep?.relatedFilterFieldKey ?? null}
                                    pageId={pageId}
                                  />
                                ) : f.fieldType === "lookup" &&
                                  meta?.writeThrough &&
                                  meta?.relatedEntityId != null &&
                                  rel?.linkedRecordId != null &&
                                  canRecord(meta.relatedEntityId, "update") ? (
                                  // The projected value of a file/url lookup renders as a
                                  // clickable <a> (opens the file/link), so the whole cell
                                  // can't double as the "edit source record" target — keep a
                                  // dedicated pencil button next to the link. Every other
                                  // type makes the entire cell clickable, no icon.
                                  relField.fieldType === "file" || relField.fieldType === "url" ? (
                                    <div className="flex w-full items-center justify-between gap-1">
                                      <span className="truncate">{display}</span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setWriteThroughEdit({
                                            entityId: meta.relatedEntityId as number,
                                            recordId: rel.linkedRecordId as number,
                                          })
                                        }
                                        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-blue-50/60 hover:text-slate-600"
                                        title={t("records.openLinkedRecord", "Открыть связанную запись")}
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setWriteThroughEdit({
                                          entityId: meta.relatedEntityId as number,
                                          recordId: rel.linkedRecordId as number,
                                        })
                                      }
                                      className="flex w-full items-center -mx-1 rounded px-1 text-left hover:bg-blue-50/60"
                                      title={t("records.openLinkedRecord", "Открыть связанную запись")}
                                    >
                                      <span className="truncate">{display}</span>
                                    </button>
                                  )
                                ) : (
                                  <div className="truncate">{display}</div>
                                )}
                              </td>
                            );
                          }
                          const isEditingThis =
                            editingCell?.recordId === record.id && editingCell?.fieldKey === f.fieldKey;
                          if (isEditingThis) {
                            return (
                              <td key={f.id} className="px-4 py-3 max-w-[240px]" style={{ ...pinStyle(`f:${f.id}`, formatting.rowColor || "#ffffff"), ...colWidthStyle(`f:${f.id}`) }}>
                                <InlineCellEditor
                                  field={f}
                                  initial={valueToForm(f, values[f.fieldKey])}
                                  userOptions={userOptions}
                                  onCommit={(raw) => commitCell(record, f, raw)}
                                  onCancel={() => setEditingCell(null)}
                                  allFields={fields}
                                  rowValues={values}
                                  entityId={entityId}
                                  pageId={permPageId}
                                />
                              </td>
                            );
                          }
                          if (f.fieldType === "boolean" && cellEditable) {
                            return (
                              <td key={f.id} className="px-4 py-3 max-w-[240px]" style={{ ...pinStyle(`f:${f.id}`, formatting.rowColor || "#ffffff"), ...cellStyle, ...colWidthStyle(`f:${f.id}`) }}>
                                <Switch
                                  checked={values[f.fieldKey] === true}
                                  onCheckedChange={(v) => commitCell(record, f, v)}
                                />
                              </td>
                            );
                          }
                          if (isFunction) {
                            const computed = formatFormulaResult(f.formulaConfigJson?.expression ?? "", formulaValues, f.formulaConfigJson?.decimals);
                            return (
                              <td key={f.id} className="px-4 py-3 max-w-[240px] truncate" style={{ ...pinStyle(`f:${f.id}`, formatting.rowColor || "#ffffff"), ...cellStyle, ...colWidthStyle(`f:${f.id}`) }}>
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
                              style={{ ...pinStyle(`f:${f.id}`, formatting.rowColor || "#ffffff"), ...cellStyle, ...colWidthStyle(`f:${f.id}`) }}
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
                              <td key={`pf-${pf.id}`} className="px-4 py-3 max-w-[240px] truncate" style={{ ...pinStyle(`pf:${pf.id}`, formatting.rowColor || "#ffffff"), ...cellStyle, ...colWidthStyle(`pf:${pf.id}`) }}>
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
                              <td key={`pf-${pf.id}`} className="px-4 py-3 max-w-[240px]" style={{ ...pinStyle(`pf:${pf.id}`, formatting.rowColor || "#ffffff"), ...colWidthStyle(`pf:${pf.id}`) }}>
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
                              <td key={`pf-${pf.id}`} className="px-4 py-3 max-w-[240px]" style={{ ...pinStyle(`pf:${pf.id}`, formatting.rowColor || "#ffffff"), ...cellStyle, ...colWidthStyle(`pf:${pf.id}`) }}>
                                <Switch
                                  checked={pageValues[pf.fieldKey] === true}
                                  onCheckedChange={(v) => commitPageCell(record, pf, v)}
                                />
                              </td>
                            );
                          }
                          if (isFunction) {
                            const computed = formatFormulaResult(pf.formulaConfigJson?.expression ?? "", formulaValues, pf.formulaConfigJson?.decimals);
                            return (
                              <td key={`pf-${pf.id}`} className="px-4 py-3 max-w-[240px] truncate" style={{ ...pinStyle(`pf:${pf.id}`, formatting.rowColor || "#ffffff"), ...cellStyle, ...colWidthStyle(`pf:${pf.id}`) }}>
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
                              style={{ ...pinStyle(`pf:${pf.id}`, formatting.rowColor || "#ffffff"), ...cellStyle, ...colWidthStyle(`pf:${pf.id}`) }}
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
          <div className="space-y-4 py-2 min-w-0">
            <RecordFormBody
              entityId={entityId}
              pageId={permPageId}
              mode={editing ? "edit" : "create"}
              recordId={editing?.id ?? null}
              allFields={fields}
              formFields={visibleFormFields}
              form={form}
              setForm={setForm}
              userOptions={userOptions}
              onRelationChanged={() => setRefreshTick((x) => x + 1)}
            />

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

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("records.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? t("records.save", "Сохранить") : t("records.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {writeThroughEdit && (
        <RecordEditModal
          entityId={writeThroughEdit.entityId}
          recordId={writeThroughEdit.recordId}
          open={true}
          onOpenChange={(o) => { if (!o) setWriteThroughEdit(null); }}
          onSaved={() => setRefreshTick((x) => x + 1)}
        />
      )}

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
      {canEditMirrorLabels && (
        <MirrorFieldLabelDialog
          field={mirrorLabelField}
          sourceNameJson={
            (mirrorLabelField
              ? rawAllFields.find((rf: Field) => rf.fieldKey === mirrorLabelField.fieldKey)?.nameJson
              : undefined) ?? {}
          }
          current={
            (mirrorLabelField ? fieldLabelOverrides?.[mirrorLabelField.fieldKey] : undefined) ?? {}
          }
          saving={updateMirrorLabelsMutation.isPending}
          onClose={() => setMirrorLabelField(null)}
          onSave={(value) => {
            if (mirrorLabelField) saveMirrorLabel(mirrorLabelField.fieldKey, value);
          }}
        />
      )}
    </div>
  );
}

function MirrorFieldLabelDialog({
  field,
  sourceNameJson,
  current,
  saving,
  onClose,
  onSave,
}: {
  field: Field | null;
  sourceNameJson: { ru?: string; en?: string; he?: string };
  current: { ru?: string; en?: string; he?: string };
  saving: boolean;
  onClose: () => void;
  onSave: (value: { ru?: string; en?: string; he?: string }) => void;
}) {
  const t = useT();
  const [value, setValue] = useState<{ ru?: string; en?: string; he?: string }>(current);
  const [activeLang, setActiveLang] = useState<"ru" | "en" | "he" | null>(null);
  // Reload the inputs each time a different field's dialog opens.
  useEffect(() => {
    setValue(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);
  const sourceForLang = activeLang ? sourceNameJson?.[activeLang]?.trim() : undefined;
  return (
    <Dialog open={!!field} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("records.mirrorLabelTitle", "Заголовок поля на этой странице")}</DialogTitle>
          <DialogDescription>
            {t(
              "records.mirrorLabelDesc",
              "Переименование действует только на этой зеркальной странице. Исходное поле сущности не меняется.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="py-1">
          <MultilingualInput
            label={t("records.mirrorLabelInput", "Новый заголовок (пусто = как в источнике)")}
            value={value}
            onChange={setValue}
            onActiveLangChange={(lang) => setActiveLang(lang as "ru" | "en" | "he")}
          />
          {sourceForLang && (
            <p className="mt-2 text-xs text-slate-400">
              {t("records.mirrorLabelSource", "В источнике")}: {sourceForLang}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("records.cancel", "Отмена")}
          </Button>
          <Button
            onClick={() => onSave(value)}
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("records.save", "Сохранить")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

/** Restrict user options to a `user`-field's allowed roles (empty/unset = all).
 * Matches on the user's FULL role set (primary + additional), so a user who
 * holds the required role as a secondary role still appears in the picker. */
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

/**
 * Entity-keyed twin of RelationLinkPicker: assigns / changes / clears the single
 * link backing a relation ENTITY-field cell. Identical UX, but candidates and the
 * link write go through the entity-keyed endpoints (the relation field's own
 * field/row boundary applies — no page-field role-visibility layer).
 */
function EntityRelationLinkPicker({
  entityId,
  fieldKey,
  recordId,
  currentLinkedId,
  display,
  onChanged,
  dependent = false,
  parentValue = null,
  relatedFilterFieldKey = null,
  pageId,
}: {
  entityId: number;
  fieldKey: string;
  recordId: number;
  currentLinkedId: number | null;
  display: React.ReactNode;
  onChanged: () => void;
  /** True when this relation field is a dependent (cascading) field. */
  dependent?: boolean;
  /** The parent field's value used to narrow candidates (scalar, or a linked
   * record id for a relation parent). Null/empty disables the picker. */
  parentValue?: string | null;
  /** For a dependent relation field: the field key (in the related entity) used
   * to filter candidates. Used to prefill+lock that field when quick-creating a
   * related record so the new record satisfies the dependency filter. */
  relatedFilterFieldKey?: string | null;
  /** The page the records table is rendered under (RBAC scope for create). */
  pageId?: number;
}) {
  const t = useT();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<PageRelatedCandidate[]>([]);
  // The related entity id + create permission are surfaced by the entity-keyed
  // candidates endpoint; they drive the in-place "add record" affordance.
  const [relatedEntityId, setRelatedEntityId] = useState<number | null>(null);
  const [canCreateRelated, setCanCreateRelated] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const fetchCandidates = useGetEntityRelatedCandidates().mutateAsync;
  const linkMutation = useSetEntityRelatedLink();
  // A dependent relation field is gated until its parent has a value.
  const gated = dependent && (parentValue == null || parentValue === "");
  // When gated we block assigning a new link, but a previously-set ("stale")
  // link must still be clearable — relation children are not auto-cleared when a
  // parent changes — so the picker stays openable while a link exists.
  const triggerDisabled = gated && currentLinkedId == null;
  const allowOpen = !gated || currentLinkedId != null;

  useEffect(() => {
    if (!open) return;
    if (gated) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      fetchCandidates({
        entityId,
        data: {
          fieldKey,
          q: search.trim() || undefined,
          ...(dependent ? { parentValue: parentValue ?? undefined } : {}),
        },
      })
        .then((res) => {
          if (cancelled) return;
          setCandidates(res.candidates);
          setRelatedEntityId(res.relatedEntityId ?? null);
          setCanCreateRelated(res.canCreate === true);
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, search, entityId, fieldKey, fetchCandidates, gated, dependent, parentValue]);

  const choose = async (linkedRecordId: number | null) => {
    try {
      await linkMutation.mutateAsync({ entityId, data: { fieldKey, recordId, linkedRecordId } });
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
      open={open && allowOpen}
      onOpenChange={(o) => {
        if (!allowOpen) return;
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={triggerDisabled}
          className="flex w-full items-center justify-between gap-2 -mx-1 rounded px-1 text-left hover:bg-blue-50/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
          title={
            gated
              ? t("records.relatedPickParentFirst", "Сначала заполните родительское поле")
              : t("records.clickToAssign", "Нажмите, чтобы назначить связь")
          }
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
          {canCreateRelated && relatedEntityId != null && !gated && (
            // Fixed footer (outside the scrollable CommandList) so "Add record"
            // stays reachable no matter how long the candidate list is.
            <div className="border-t border-slate-200 p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreateOpen(true);
                }}
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("records.relatedCreate", "Добавить запись")}
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
      {createOpen && relatedEntityId != null && (
        <QuickCreateRelatedRecordDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          relatedEntityId={relatedEntityId}
          pageId={pageId}
          lockedFieldKey={dependent ? relatedFilterFieldKey : null}
          lockedValue={dependent ? parentValue : null}
          onCreated={(newId) => {
            setCreateOpen(false);
            void choose(newId);
          }}
        />
      )}
    </Popover>
  );
}

/**
 * Deferred relation picker for CREATE flows (new-record modal + inline add-row).
 * A relation link can only be written once the base record exists, so this picker
 * does not mutate: it just SELECTS (or quick-creates) a related record and reports
 * the chosen id via onChange. The caller persists the link after the base record
 * is created (see persistPendingRelationLinks). Mirrors EntityRelationLinkPicker's
 * candidate search + quick-create, including dependent (cascading) parent gating.
 */
function RelationCreatePicker({
  entityId,
  fieldKey,
  pageId,
  value,
  onChange,
  dependent = false,
  parentValue = null,
  relatedFilterFieldKey = null,
}: {
  entityId: number;
  fieldKey: string;
  pageId?: number;
  /** The selected linked record id (numeric) or null when nothing is chosen. */
  value: number | null;
  onChange: (id: number | null) => void;
  dependent?: boolean;
  parentValue?: string | null;
  relatedFilterFieldKey?: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<PageRelatedCandidate[]>([]);
  const [relatedEntityId, setRelatedEntityId] = useState<number | null>(null);
  const [relatedLabelFieldKey, setRelatedLabelFieldKey] = useState<string | null>(null);
  const [canCreateRelated, setCanCreateRelated] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // Label of the current selection, remembered when chosen (create mode starts
  // empty, so there is no pre-existing label to resolve). Display always gates on
  // `value` so an external clear (dependent parent change) cannot show a stale label.
  const [selfLabel, setSelfLabel] = useState<string | null>(null);
  const fetchCandidates = useGetEntityRelatedCandidates().mutateAsync;
  const gated = dependent && (parentValue == null || parentValue === "");

  useEffect(() => {
    if (!open) return;
    if (gated) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      fetchCandidates({
        entityId,
        data: {
          fieldKey,
          q: search.trim() || undefined,
          ...(dependent ? { parentValue: parentValue ?? undefined } : {}),
        },
      })
        .then((res) => {
          if (cancelled) return;
          setCandidates(res.candidates);
          setRelatedEntityId(res.relatedEntityId ?? null);
          setRelatedLabelFieldKey(res.relatedFieldKey ?? null);
          setCanCreateRelated(res.canCreate === true);
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, search, entityId, fieldKey, fetchCandidates, gated, dependent, parentValue]);

  const choose = (id: number | null, label: string | null) => {
    setSelfLabel(label);
    onChange(id);
    setOpen(false);
    setSearch("");
  };

  const display =
    value == null ? (
      <span className="text-slate-400">{t("records.relatedSelect", "Выберите запись")}</span>
    ) : (
      <span className="truncate">{selfLabel || `#${value}`}</span>
    );

  return (
    <Popover
      open={open && !gated}
      onOpenChange={(o) => {
        if (gated) return;
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={gated}
          className="flex w-full items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1.5 text-left text-sm hover:bg-blue-50/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
          title={
            gated
              ? t("records.relatedPickParentFirst", "Сначала заполните родительское поле")
              : t("records.clickToAssign", "Нажмите, чтобы назначить связь")
          }
        >
          {display}
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
            {value != null && (
              <CommandGroup>
                <CommandItem value="__clear__" onSelect={() => choose(null, null)} className="text-rose-600">
                  <X className="mr-2 h-4 w-4" />
                  {t("records.clearLink", "Очистить связь")}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {candidates.map((c) => (
                <CommandItem key={c.id} value={`${c.label} #${c.id}`} onSelect={() => choose(c.id, c.label)}>
                  <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{c.label || `#${c.id}`}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {canCreateRelated && relatedEntityId != null && !gated && (
            // Fixed footer (outside the scrollable CommandList) so "Add record"
            // stays reachable no matter how long the candidate list is.
            <div className="border-t border-slate-200 p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreateOpen(true);
                }}
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("records.relatedCreate", "Добавить запись")}
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
      {createOpen && relatedEntityId != null && (
        <QuickCreateRelatedRecordDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          relatedEntityId={relatedEntityId}
          pageId={pageId}
          lockedFieldKey={dependent ? relatedFilterFieldKey : null}
          lockedValue={dependent ? parentValue : null}
          labelFieldKey={relatedLabelFieldKey}
          onCreated={(newId, label) => {
            setCreateOpen(false);
            choose(newId, label);
          }}
        />
      )}
    </Popover>
  );
}

/**
 * Reusable full-record editor for ONE record in ANY entity. Used by write-through
 * lookup cells: clicking the cell opens the LINKED record's editor in the related
 * entity. Loads that entity's fields/statuses, mirrors the per-field read-only
 * boundary cosmetically (the server PUT remains the real boundary), and saves via
 * the standard records update path. Relation fields render an in-place link picker
 * (like the main editor); the generic RecordLinkManager handles ad-hoc links.
 */
// Single source of truth for field immutability, shared by the inline grid AND
// the shared record-form body so a lockAfterCreate field can never be editable in
// one surface but locked in another (mirrors the hard server boundary).
function scalarFieldLocked(field: Field, value: unknown): boolean {
  return !!(field.lockAfterCreate && valueIsSet(value));
}
function relationFieldLocked(field: Field, linkedRecordId: number | null | undefined): boolean {
  return !!(field.lockAfterCreate && linkedRecordId != null);
}

/**
 * The ONE shared body of both record-edit dialogs (the main add/edit dialog and
 * the write-through RecordEditModal). It owns ALL per-field rendering, locking,
 * dependent-field resolution and relation/lookup display so the two dialogs can no
 * longer drift apart. In edit mode it self-fetches THIS record's relation/lookup
 * values, so relation pickers show the current link and relation/lookup read-only
 * displays show their value (matching the inline grid).
 */
function RecordFormBody({
  entityId,
  pageId,
  mode,
  recordId,
  allFields,
  formFields,
  form,
  setForm,
  userOptions,
  onRelationChanged,
}: {
  entityId: number;
  pageId?: number;
  mode: "create" | "edit";
  recordId: number | null;
  /** Full field list — needed for dependency-chain resolution. */
  allFields: Field[];
  /** The fields actually rendered (caller applies its own visibility filter). */
  formFields: Field[];
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  userOptions: UserOption[];
  /** Bubbled when a relation link changes, so the parent table can refresh. */
  onRelationChanged?: () => void;
}) {
  const t = useT();
  const ml = useML();
  const { fieldAccess, canRecord } = useAuth();
  const userNames = useMemo(
    () => new Map<number, string>(userOptions.map((u: UserOption) => [u.id, u.name])),
    [userOptions],
  );

  // THIS record's relation/lookup values (edit mode only — a create has no record
  // yet). Self-fetched so relation fields render a live picker with the current
  // selection and relation/lookup read-only displays show their value.
  const fetchEntityRelatedValues = useGetEntityRelatedValues().mutateAsync;
  const [relCols, setRelCols] = useState<PageRelatedColumn[]>([]);
  const [relByField, setRelByField] = useState<Map<string, PageRelatedValue>>(new Map());
  const [relTick, setRelTick] = useState(0);
  // Open the linked record's full editor for a write-through lookup (mirrors the
  // inline grid's "Открыть связанную запись" affordance).
  const [writeThroughEdit, setWriteThroughEdit] = useState<{ entityId: number; recordId: number } | null>(null);
  const relColMetaMap = useMemo(() => {
    const m = new Map<string, PageRelatedColumn>();
    for (const c of relCols) m.set(c.fieldKey, c);
    return m;
  }, [relCols]);

  // Clear stale relation values the instant the edited record changes, so the
  // previous record's links never flash on the new one before the fetch resolves.
  useEffect(() => {
    setRelCols([]);
    setRelByField(new Map());
  }, [recordId]);

  // Load this record's relation/lookup values. relTick re-fetches after a link
  // change so the display stays in sync without closing the dialog.
  useEffect(() => {
    if (mode !== "edit" || recordId == null || recordId <= 0) return;
    let cancelled = false;
    fetchEntityRelatedValues({ entityId, data: { recordIds: [recordId], pageId } })
      .then((res) => {
        if (cancelled) return;
        setRelCols(res.columns);
        const m = new Map<string, PageRelatedValue>();
        for (const v of res.values) m.set(v.fieldKey, v);
        setRelByField(m);
      })
      .catch(() => {
        if (cancelled) return;
        setRelCols([]);
        setRelByField(new Map());
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recordId, entityId, relTick]);

  // Merge each relation field's linked record id into the form values so dependent
  // (cascading) fields whose parent is a relation field — and lookups projecting
  // from a relation — can resolve their parent in both create and edit modes.
  const formWithRelationParents = useMemo<FormState>(() => {
    const merged: FormState = { ...form };
    for (const [fieldKey, v] of relByField.entries()) {
      if (v.linkedRecordId != null) merged[fieldKey] = v.linkedRecordId;
    }
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, relByField]);

  const relationFieldKeyByRelationId = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of allFields) {
      const rid = f.fieldType === "relation" ? f.relationConfigJson?.relationId : undefined;
      if (rid != null) m.set(rid, f.fieldKey);
    }
    return m;
  }, [allFields]);

  // A lookup projects a value from the record linked by its underlying relation
  // field; resolve that relation field's selected id from the merged form snapshot.
  const lookupLinkedId = (f: Field): number | null => {
    const rid = f.relationConfigJson?.relationId;
    if (rid == null) return null;
    const relKey = relationFieldKeyByRelationId.get(rid);
    if (!relKey) return null;
    const v = formWithRelationParents[relKey];
    return typeof v === "number" && v > 0 ? v : null;
  };

  // ONE dependent-field resolver: the parent value comes from the relation-merged
  // form snapshot, covering scalar parents AND relation parents in BOTH modes.
  const depInfo = (field: Field) => {
    const dep = field.dependencyConfigJson;
    const dependsOn = dep?.dependsOnFieldKey?.trim();
    const filterKey = dep?.relatedFilterFieldKey?.trim();
    if (!dependsOn || !filterKey)
      return { dependent: false, parentValue: null as string | null, relatedFilterFieldKey: null as string | null };
    const raw = formWithRelationParents[dependsOn];
    const parentValue = raw == null || raw === "" ? null : String(raw);
    return { dependent: true, parentValue, relatedFilterFieldKey: filterKey };
  };

  const handleRelationChanged = () => {
    setRelTick((x) => x + 1);
    onRelationChanged?.();
  };

  // Read-only display node for a relation/lookup field's current value (its
  // configured display field), or an em dash when nothing is linked.
  const relDisplayFor = (field: Field): React.ReactNode => {
    const relColMeta = relColMetaMap.get(field.fieldKey);
    const relVal = relByField.get(field.fieldKey);
    if (relVal?.linkedRecordId == null) return <span className="text-slate-300">—</span>;
    return renderCellValue(
      {
        ...field,
        fieldType: (relColMeta?.relatedFieldType ?? "text") as Field["fieldType"],
        optionsJson: relColMeta?.optionsJson ?? [],
      } as unknown as Field,
      relVal?.value,
      t,
      userNames,
    );
  };

  const roBox = (children: React.ReactNode) => (
    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm break-all">{children}</div>
  );

  // Edit-mode display for a lookup field. When the lookup is write-through and the
  // viewer can update the linked record, the value doubles as an "open linked
  // record" action (mirrors the inline grid). A file/url projection renders as a
  // clickable <a> (opens the file), so it gets a dedicated pencil button; every
  // other type makes the whole box clickable.
  const lookupEditNode = (field: Field): React.ReactNode => {
    const meta = relColMetaMap.get(field.fieldKey);
    const relVal = relByField.get(field.fieldKey);
    const canOpen =
      !!meta?.writeThrough &&
      meta?.relatedEntityId != null &&
      relVal?.linkedRecordId != null &&
      canRecord(meta.relatedEntityId, "update");
    if (!canOpen) return roBox(relDisplayFor(field));
    const open = () =>
      setWriteThroughEdit({
        entityId: meta!.relatedEntityId as number,
        recordId: relVal!.linkedRecordId as number,
      });
    const relatedType = meta?.relatedFieldType;
    if (relatedType === "file" || relatedType === "url") {
      return (
        <div className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm">
          <span className="min-w-0 break-all">{relDisplayFor(field)}</span>
          <button
            type="button"
            onClick={open}
            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-blue-50/60 hover:text-slate-600"
            title={t("records.openLinkedRecord", "Открыть связанную запись")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={open}
        className="flex w-full items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-sm hover:bg-blue-50/60"
        title={t("records.openLinkedRecord", "Открыть связанную запись")}
      >
        <span className="min-w-0 break-all">{relDisplayFor(field)}</span>
        <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>
    );
  };

  return (
    <>
      {formFields.map((field: Field) => {
        const access = fieldAccess(field, entityId, pageId);
        const relVal = relByField.get(field.fieldKey);
        const relLocked = mode === "edit" && relationFieldLocked(field, relVal?.linkedRecordId);
        // A lookup is always read-only (it projects a linked record's value); a
        // lockAfterCreate scalar becomes read-only in edit mode once it has a value.
        const readOnly =
          access === "view" ||
          field.fieldType === "lookup" ||
          (mode === "edit" && scalarFieldLocked(field, form[field.fieldKey]));
        const dep = depInfo(field);
        return (
          <div key={field.id} className="min-w-0 space-y-1.5">
            <Label>
              {ml(field.nameJson)}
              {field.isRequired && <span className="text-red-500 ml-0.5">*</span>}
              {(readOnly || relLocked) && (
                <span className="ml-1.5 text-xs font-normal text-slate-400">
                  {t("records.readOnly", "(только чтение)")}
                </span>
              )}
            </Label>
            {field.fieldType === "relation" ? (
              access === "edit" && !relLocked ? (
                mode === "edit" && recordId != null ? (
                  <EntityRelationLinkPicker
                    entityId={entityId}
                    fieldKey={field.fieldKey}
                    recordId={recordId}
                    currentLinkedId={relVal?.linkedRecordId ?? null}
                    display={relDisplayFor(field)}
                    onChanged={handleRelationChanged}
                    dependent={dep.dependent}
                    parentValue={dep.parentValue}
                    relatedFilterFieldKey={dep.relatedFilterFieldKey}
                    pageId={pageId}
                  />
                ) : (
                  <RelationCreatePicker
                    entityId={entityId}
                    fieldKey={field.fieldKey}
                    pageId={pageId}
                    value={typeof form[field.fieldKey] === "number" ? (form[field.fieldKey] as number) : null}
                    onChange={(id) =>
                      setForm((prev) =>
                        clearDependentDescendants({ ...prev, [field.fieldKey]: id ?? "" }, field.fieldKey, allFields),
                      )
                    }
                    dependent={dep.dependent}
                    parentValue={dep.parentValue}
                    relatedFilterFieldKey={dep.relatedFilterFieldKey}
                  />
                )
              ) : (
                roBox(relDisplayFor(field))
              )
            ) : field.fieldType === "lookup" ? (
              mode === "edit" ? (
                lookupEditNode(field)
              ) : lookupLinkedId(field) != null ? (
                (() => {
                  const meta = relColMetaMap.get(field.fieldKey);
                  const fallbackField = {
                    ...field,
                    fieldType: (meta?.relatedFieldType ?? "text") as Field["fieldType"],
                    optionsJson: meta?.optionsJson ?? [],
                  } as unknown as Field;
                  return roBox(
                    <LookupCreatePreview
                      linkedRecordId={lookupLinkedId(field) as number}
                      relatedFieldKey={field.relationConfigJson?.relatedFieldKey ?? ""}
                      fallbackField={fallbackField}
                      userNames={userNames}
                    />,
                  );
                })()
              ) : (
                roBox(<span className="text-slate-300">—</span>)
              )
            ) : (
              <FieldInput
                field={field}
                value={form[field.fieldKey]}
                onChange={(v) =>
                  setForm((prev) =>
                    clearDependentDescendants({ ...prev, [field.fieldKey]: v }, field.fieldKey, allFields),
                  )
                }
                disabled={readOnly}
                userOptions={userOptions}
                allFields={allFields}
                rowValues={formWithRelationParents}
                entityId={entityId}
                pageId={pageId}
              />
            )}
            {ml(field.descriptionJson) && (
              <p className="text-xs text-slate-400">{ml(field.descriptionJson)}</p>
            )}
          </div>
        );
      })}
      {writeThroughEdit && (
        <RecordEditModal
          entityId={writeThroughEdit.entityId}
          recordId={writeThroughEdit.recordId}
          open={true}
          onOpenChange={(o) => {
            if (!o) setWriteThroughEdit(null);
          }}
          onSaved={handleRelationChanged}
        />
      )}
    </>
  );
}

function RecordEditModal({
  entityId,
  recordId,
  open,
  onOpenChange,
  onSaved,
}: {
  entityId: number;
  recordId: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const t = useT();
  const ml = useML();
  const { toast } = useToast();
  const { fieldAccess, user } = useAuth();
  const { data: record, isLoading: recordLoading } = useGetRecord(recordId, {
    query: { enabled: open, queryKey: getGetRecordQueryKey(recordId) },
  });
  const { data: fields = [], isLoading: fieldsLoading } = useListEntityFields(entityId);
  const { data: statuses = [] } = useListEntityStatuses(entityId);
  const updateMutation = useUpdateRecord();
  const [form, setForm] = useState<FormState>({});
  const [statusId, setStatusId] = useState<string>(NO_STATUS);
  const [submitting, setSubmitting] = useState(false);

  // User options for `user` field selects; without them a `user` field's dropdown
  // is empty and cannot be selected. Relation/lookup values are now fetched inside
  // RecordFormBody (the shared editor body), not here.
  const { data: userOptions = [] } = useListUserOptions();

  const visibleFields = fields.filter((f: Field) => fieldAccess(f, entityId) !== "hidden");

  // Cosmetic mirror of the related entity's per-role status visibility (same rule
  // as the main editor). superAdmin sees everything; the record's CURRENT status is
  // always kept so its Select renders the value it is actually set to. The server
  // PUT remains the real boundary.
  const isSuperAdmin = user?.permissions?.superAdmin === true;
  const hiddenStatusIds = new Set<number>(
    isSuperAdmin
      ? []
      : ((user?.permissions?.records?.[String(entityId)]?.hiddenStatusIds ?? []).filter(
          (n): n is number => Number.isInteger(n),
        )),
  );
  const currentStatusId = record?.statusId ?? null;
  const visibleStatuses = statuses.filter(
    (s: Status) => !hiddenStatusIds.has(s.id) || s.id === currentStatusId,
  );

  useEffect(() => {
    if (!open || !record) return;
    const values = (record.valuesJson ?? {}) as Record<string, unknown>;
    const initial: FormState = {};
    for (const f of fields) initial[f.fieldKey] = valueToForm(f, values[f.fieldKey]);
    setForm(initial);
    setStatusId(record.statusId != null ? String(record.statusId) : NO_STATUS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.id, fields.length]);

  const submit = async () => {
    setSubmitting(true);
    const valuesJson = formToValues(
      visibleFields.filter((f: Field) => fieldAccess(f, entityId) === "edit"),
      form,
    );
    const statusValue = statusId === NO_STATUS ? null : Number(statusId);
    try {
      await updateMutation.mutateAsync({ id: recordId, data: { valuesJson, statusId: statusValue } });
      setSubmitting(false);
      toast({ title: t("records.updated", "Запись обновлена") });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setSubmitting(false);
      toast({
        variant: "destructive",
        title: t("records.updateError", "Ошибка обновления"),
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const loading = recordLoading || fieldsLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("records.editLinkedTitle", "Редактировать связанную запись")}</DialogTitle>
          <DialogDescription>
            {t("records.dialogDesc", "Заполните поля записи. Обязательные поля помечены звёздочкой.")}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">{t("common.loading", "Загрузка...")}</div>
        ) : (
          <div className="space-y-4 py-2 min-w-0">
            <RecordFormBody
              entityId={entityId}
              mode="edit"
              recordId={recordId}
              allFields={fields}
              formFields={visibleFields}
              form={form}
              setForm={setForm}
              userOptions={userOptions}
            />
            {statuses.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t("records.status", "Статус")}</Label>
                <Select value={statusId} onValueChange={setStatusId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("records.noStatus", "Без статуса")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_STATUS}>{t("records.noStatus", "Без статуса")}</SelectItem>
                    {visibleStatuses.map((s: Status) => (
                      <SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("records.cancel", "Отмена")}
          </Button>
          <Button onClick={submit} disabled={submitting || loading} className="bg-blue-600 hover:bg-blue-700">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("records.save", "Сохранить")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Quick-create modal: create a record in the RELATED entity from inside the
 * relation picker, then link it to the base record. For a dependent (cascading)
 * relation field the dependency filter field is prefilled and locked to the
 * parent's value so the new record satisfies the filter:
 *  - scalar filter field → the value is written into valuesJson at create time;
 *  - relation filter field → after create, the link is set on the new record.
 * Only valuesJson-backed field types are offered in the form; pure relation
 * fields on the related entity cannot be filled here (the dependency filter
 * relation field is the exception, set via the link path above).
 */
function QuickCreateRelatedRecordDialog({
  open,
  onOpenChange,
  relatedEntityId,
  pageId,
  lockedFieldKey,
  lockedValue,
  labelFieldKey,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  relatedEntityId: number;
  pageId?: number;
  lockedFieldKey?: string | null;
  lockedValue?: string | null;
  /** The related entity field used as the display label, so the caller can show
   * the new record's name instead of its id right after a quick-create. */
  labelFieldKey?: string | null;
  onCreated: (newId: number, label: string | null) => void;
}) {
  const t = useT();
  const ml = useML();
  const { toast } = useToast();
  const { data: relFields = [], isLoading: fieldsLoading } = useListEntityFields(relatedEntityId);
  const { data: userOptions = [] } = useListUserOptions();
  const createMutation = useCreateEntityRecord();
  const setLinkMutation = useSetEntityRelatedLink();
  const [form, setForm] = useState<FormState>({});
  const [submitting, setSubmitting] = useState(false);

  // Is the locked dependency filter field a relation field on the related entity?
  // If so it cannot live in valuesJson; we set it as a link after create.
  const lockedField = lockedFieldKey ? relFields.find((f: Field) => f.fieldKey === lockedFieldKey) : undefined;
  const lockedIsRelation = lockedField?.fieldType === "relation";

  // Fields editable in the quick-create form: skip read-only/computed types and
  // any relation field (relations are linked separately, not stored in values).
  const editableFields = relFields.filter(
    (f: Field) => f.fieldType !== "relation" && f.fieldType !== "function",
  );

  useEffect(() => {
    if (!open) return;
    const initial: FormState = {};
    for (const f of editableFields) {
      initial[f.fieldKey] =
        f.fieldKey === lockedFieldKey && !lockedIsRelation && lockedValue != null
          ? valueToForm(f, lockedValue)
          : emptyForField(f);
    }
    setForm(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, relatedEntityId, relFields.length]);

  const submit = async () => {
    setSubmitting(true);
    // Step 1 — create. A failure here means nothing was written.
    let newId: number;
    try {
      const valuesJson = formToValues(editableFields, form);
      const created = await createMutation.mutateAsync({
        entityId: relatedEntityId,
        data: { valuesJson, ...(pageId != null ? { pageId } : {}) },
      });
      newId = created.id;
    } catch (e) {
      setSubmitting(false);
      // A 409 here means the typed value duplicates an existing record's unique
      // (isKey) field. Guide the user to pick the existing record from the list
      // instead of surfacing the raw "HTTP 409 …" technical message.
      if ((e as { status?: number }).status === 409) {
        toast({
          variant: "destructive",
          title: t("records.relatedDuplicateTitle", "Такая запись уже существует"),
          description: t(
            "records.relatedDuplicateDesc",
            "Запись с таким значением уже есть. Закройте это окно и выберите её из списка, а не создавайте новую.",
          ),
        });
        return;
      }
      toast({
        variant: "destructive",
        title: t("records.relatedCreateFailed", "Не удалось создать запись"),
        description: extractError(e),
      });
      return;
    }
    // Step 2 — for a relation dependency filter field, set the link on the new
    // record so it matches the parent (scalar values went in via valuesJson). The
    // record already exists; a failure here leaves it created-but-unmatched, so we
    // report that honestly rather than claiming creation failed.
    if (lockedIsRelation && lockedFieldKey) {
      const linkedRecordId = lockedValue == null || lockedValue === "" ? NaN : Number(lockedValue);
      if (!Number.isFinite(linkedRecordId)) {
        setSubmitting(false);
        toast({
          variant: "destructive",
          title: t("records.relatedCreatedNotLinked", "Запись создана, но не привязана"),
        });
        return;
      }
      try {
        await setLinkMutation.mutateAsync({
          entityId: relatedEntityId,
          data: { fieldKey: lockedFieldKey, recordId: newId, linkedRecordId },
        });
      } catch (e) {
        setSubmitting(false);
        toast({
          variant: "destructive",
          title: t("records.relatedCreatedNotLinked", "Запись создана, но не привязана"),
          description: e instanceof Error ? e.message : undefined,
        });
        return;
      }
    }
    setSubmitting(false);
    // Derive the new record's display label from the label field the caller named,
    // so the picker can show the name immediately (the record is not yet in the
    // candidate list). Falls back to null → the caller renders `#id`.
    const labelRaw = labelFieldKey ? form[labelFieldKey] : undefined;
    const label = labelRaw == null || labelRaw === "" ? null : String(labelRaw);
    onCreated(newId, label);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("records.relatedCreateTitle", "Новая связанная запись")}</DialogTitle>
        </DialogHeader>
        {fieldsLoading ? (
          <div className="py-8 text-center text-sm text-slate-400">{t("common.loading", "Загрузка...")}</div>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2 pr-2">
            {editableFields.length === 0 && (
              <p className="text-sm text-slate-400">{t("records.relatedCreateNoFields", "Нет полей для заполнения")}</p>
            )}
            {editableFields.map((f: Field) => {
              const isLockedScalar = f.fieldKey === lockedFieldKey && !lockedIsRelation;
              return (
                <div key={f.id} className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    {ml(f.nameJson) || f.fieldKey}
                    {f.isRequired && <span className="ml-0.5 text-rose-500">*</span>}
                  </label>
                  <FieldInput
                    field={f}
                    value={form[f.fieldKey]}
                    onChange={(v) => setForm((prev) => ({ ...prev, [f.fieldKey]: v }))}
                    disabled={isLockedScalar}
                    userOptions={userOptions}
                    allFields={relFields}
                    rowValues={form}
                    entityId={relatedEntityId}
                    pageId={pageId}
                  />
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("common.cancel", "Отмена")}
          </Button>
          <Button onClick={submit} disabled={submitting || fieldsLoading}>
            {t("common.create", "Создать")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Searchable single-select for `user`-type field values (Command + Popover).
 * When `allowCreate` is set (the field opted in via `userConfigJson.allowCreate`)
 * the dropdown gains an "add new user" action that opens a create-user dialog
 * restricted to `allowedRoleIds`; the new user is selected on success. */
/**
 * Walk a dependent field's parent chain (closest parent first), cycle-guarded.
 * Mirrors the server's `dependencyAncestorKeys` so the option list / rename /
 * dedupe scope is computed identically on both sides.
 */
function dependencyChainKeys(field: Field, allFields: Field[]): string[] {
  const byKey = new Map(allFields.map((f) => [f.fieldKey, f] as const));
  const out: string[] = [];
  const seen = new Set<string>([field.fieldKey]);
  let cur = field.dependencyConfigJson?.dependsOnFieldKey;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = byKey.get(cur)?.dependencyConfigJson?.dependsOnFieldKey;
  }
  return out;
}

/** True if `field` is a dependent (cascading) text field. */
function isDependentField(field: Field): boolean {
  return field.fieldType === "text" && !!field.dependencyConfigJson?.dependsOnFieldKey;
}

/**
 * Clear the values of every field whose dependency chain leads back to
 * `changedKey`, so changing a parent invalidates its (now mismatched) children.
 */
function clearDependentDescendants<T extends Record<string, unknown>>(
  values: T,
  changedKey: string,
  allFields: Field[],
): T {
  let next = values;
  for (const f of allFields) {
    if (!isDependentField(f)) continue;
    if (dependencyChainKeys(f, allFields).includes(changedKey) && f.fieldKey in next && next[f.fieldKey] !== "") {
      if (next === values) next = { ...values };
      (next as Record<string, unknown>)[f.fieldKey] = "";
    }
  }
  return next;
}

/**
 * Picker for a dependent ("cascading") text field. Disabled until the immediate
 * parent has a value; otherwise lists the distinct existing values of this field
 * scoped to the row's parent-chain values, with inline "add new" (client-side
 * dedupe) and per-option rename (scoped merge via the rename endpoint).
 */
function DependentFieldCombobox({
  field,
  allFields,
  rowValues,
  entityId,
  pageId,
  value,
  onChange,
  disabled = false,
  autoOpen = false,
  onClose,
  triggerClassName,
}: {
  field: Field;
  allFields: Field[];
  rowValues: Record<string, unknown>;
  entityId: number;
  pageId?: number;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  autoOpen?: boolean;
  onClose?: (committed: boolean) => void;
  triggerClassName?: string;
}) {
  const t = useT();
  const ml = useML();
  const { toast } = useToast();
  const [open, setOpen] = useState(autoOpen);
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const committedRef = useRef(false);
  const depValues = useGetFieldDependentValues();
  const renameMutation = useRenameFieldValue();

  const parentChain = useMemo(() => dependencyChainKeys(field, allFields), [field, allFields]);
  const parentValues = parentChain
    .map((key) => ({ field: key, value: rowValues[key] == null ? "" : String(rowValues[key]) }))
    .filter((p) => p.value !== "");
  const immediateParentKey = field.dependencyConfigJson?.dependsOnFieldKey ?? "";
  const parentSet = parentValues.some((p) => p.field === immediateParentKey);
  const parentKey = JSON.stringify(parentValues);

  const loadOptions = useCallback(async () => {
    if (!parentSet) {
      setOptions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await depValues.mutateAsync({ entityId, fieldId: field.id, data: { pageId, parentValues } });
      setOptions(res.values);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentSet, parentKey, entityId, field.id, pageId]);

  useEffect(() => {
    if (open && parentSet) void loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parentSet, parentKey]);

  const norm = (s: string) => s.trim().toLowerCase();

  const commitValue = (v: string) => {
    committedRef.current = true;
    onChange(v);
    setOpen(false);
  };

  const handleAdd = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (options.some((o) => o === v)) {
      commitValue(v);
      return;
    }
    if (options.some((o) => norm(o) === norm(v))) {
      toast({
        title: t("records.depDuplicate", "Такое значение уже существует в другом написании"),
        variant: "destructive",
      });
      return;
    }
    commitValue(v);
  };

  const handleRename = async (oldValue: string) => {
    const nv = renameText.trim();
    if (!nv || nv === oldValue) {
      setRenaming(null);
      return;
    }
    const collides = options.some((o) => o !== oldValue && norm(o) === norm(nv));
    if (
      collides &&
      !window.confirm(
        t("records.depMergeConfirm", "Значение с таким названием уже существует. Объединить записи?"),
      )
    ) {
      return;
    }
    try {
      await renameMutation.mutateAsync({
        entityId,
        fieldId: field.id,
        data: { pageId, parentValues, oldValue, newValue: nv },
      });
      toast({ title: t("records.depRenamed", "Значение переименовано") });
      setRenaming(null);
      if (value === oldValue) onChange(nv);
      await loadOptions();
    } catch (err) {
      toast({
        title: t("records.depRenameError", "Ошибка переименования"),
        description: extractError(err),
        variant: "destructive",
      });
    }
  };

  if (!parentSet) {
    const parentName = ml(allFields.find((f) => f.fieldKey === immediateParentKey)?.nameJson);
    const placeholderMsg = parentName
      ? `${t("records.depSelectPrefix", "Выберите")} ${parentName}`
      : t("records.depParentRequired", "Сначала выберите родительское поле");
    return (
      <Button
        type="button"
        variant="outline"
        aria-disabled="true"
        title={placeholderMsg}
        className={cn(
          "w-full cursor-not-allowed justify-between font-normal text-slate-400",
          triggerClassName,
        )}
      >
        <span className="truncate">{placeholderMsg}</span>
      </Button>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setSearch("");
          onClose?.(committedRef.current);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn("w-full justify-between font-normal", triggerClassName)}
        >
          <span className={cn("truncate", !value && "text-slate-400")}>
            {value || t("records.depSelect", "Выберите или добавьте")}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0">
        <Command>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t("records.depSearch", "Поиск...")}
          />
          <CommandList>
            <CommandEmpty>
              {loading ? t("records.loading", "Загрузка...") : t("records.depEmpty", "Нет значений")}
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) =>
                renaming === o ? (
                  <div key={o} className="flex items-center gap-1 px-2 py-1">
                    <Input
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      className="h-7 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleRename(o);
                        } else if (e.key === "Escape") {
                          setRenaming(null);
                        }
                      }}
                    />
                    <Button
                      size="icon"
                      className="h-7 w-7 bg-blue-600 hover:bg-blue-700"
                      onClick={() => void handleRename(o)}
                      disabled={renameMutation.isPending}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRenaming(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <CommandItem key={o} value={o} onSelect={() => commitValue(o)}>
                    <Check className={cn("mr-2 h-4 w-4", value === o ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{o}</span>
                    <button
                      type="button"
                      className="ml-2 opacity-50 hover:opacity-100"
                      title={t("records.depRename", "Переименовать")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming(o);
                        setRenameText(o);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </CommandItem>
                ),
              )}
            </CommandGroup>
          </CommandList>
          {search.trim() !== "" && !options.some((o) => norm(o) === norm(search)) && (
            <div className="border-t border-slate-100 p-1">
              <Button
                type="button"
                variant="ghost"
                className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal"
                onClick={() => handleAdd(search)}
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                <span className="truncate">
                  {t("records.depAddNew", "Добавить значение")}: «{search.trim()}»
                </span>
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function UserCombobox({
  options,
  value,
  onChange,
  placeholder,
  triggerClassName,
  autoOpen = false,
  onClose,
  disabled = false,
  allowCreate = false,
  allowedRoleIds,
  fieldId,
}: {
  options: UserOption[];
  value: number | null;
  onChange: (id: number) => void;
  placeholder: string;
  triggerClassName?: string;
  autoOpen?: boolean;
  onClose?: (committed: boolean) => void;
  disabled?: boolean;
  allowCreate?: boolean;
  allowedRoleIds?: number[];
  fieldId?: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(autoOpen);
  const [createOpen, setCreateOpen] = useState(false);
  const committedRef = useRef(false);
  const creatingRef = useRef(false);
  const createdRef = useRef(false);
  const selected = options.find((u) => u.id === value) ?? null;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            // When the popover closes only to open the create-user dialog, defer
            // the commit/cancel decision to the dialog flow below.
            if (creatingRef.current) return;
            onClose?.(committedRef.current);
          }
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
              {allowCreate && (
                <CommandGroup className="border-t border-slate-100">
                  <CommandItem
                    value="__create_user__"
                    onSelect={() => {
                      creatingRef.current = true;
                      setOpen(false);
                      setCreateOpen(true);
                    }}
                    className="text-blue-600"
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    {t("records.addNewUser", "Добавить нового пользователя")}
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {allowCreate && fieldId != null && (
        <CreateUserDialog
          open={createOpen}
          onOpenChange={(o) => {
            setCreateOpen(o);
            if (!o) {
              const created = createdRef.current;
              createdRef.current = false;
              creatingRef.current = false;
              // Dialog dismissed without creating: cancel the pending inline edit.
              if (!created) onClose?.(false);
            }
          }}
          fieldId={fieldId}
          allowedRoleIds={allowedRoleIds}
          onCreated={(u) => {
            createdRef.current = true;
            committedRef.current = true;
            onChange(u.id);
          }}
        />
      )}
    </>
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
  allFields,
  rowValues,
  entityId,
  pageId,
}: {
  field: Field;
  initial: CellValue;
  userOptions: UserOption[];
  onCommit: (raw: CellValue) => void;
  onCancel: () => void;
  allFields?: Field[];
  rowValues?: Record<string, unknown>;
  entityId?: number;
  pageId?: number;
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

  if (isDependentField(field) && allFields && rowValues && entityId != null) {
    return (
      <DependentFieldCombobox
        field={field}
        allFields={allFields}
        rowValues={rowValues}
        entityId={entityId}
        pageId={pageId}
        value={typeof initial === "string" ? initial : initial == null ? "" : String(initial)}
        onChange={(v) => commitOnce(v)}
        triggerClassName="h-8 w-full text-sm"
        autoOpen
        onClose={(committed) => {
          if (!committed && !committedRef.current) onCancel();
        }}
      />
    );
  }

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
        allowCreate={field.userConfigJson?.allowCreate === true}
        allowedRoleIds={field.userConfigJson?.allowedRoleIds}
        fieldId={field.id}
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

  if (field.fieldType === "number") {
    const dotHint = t(
      "records.numberDotHint",
      "Используйте точку как десятичный разделитель, например 11.6",
    );
    return (
      <Input
        autoFocus
        type="text"
        inputMode="decimal"
        title={dotHint}
        className="h-auto w-full rounded-sm border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-blue-400"
        value={draft === "" || draft === undefined ? "" : String(draft)}
        onChange={(e) => {
          const { value: clean, hadComma } = sanitizeNumberInput(e.target.value);
          // Reject comma-bearing input (e.g. pasted "1,5") instead of stripping
          // the comma, which would silently corrupt it to "15".
          if (hadComma) return;
          setDraft(clean);
        }}
        onKeyDown={(e) => {
          if (e.key === ",") { e.preventDefault(); }
          else if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === "Escape") { cancelRef.current = true; (e.target as HTMLInputElement).blur(); }
        }}
        onBlur={() => { if (cancelRef.current) onCancel(); else commitOnce(draft); }}
      />
    );
  }

  const inputType =
    field.fieldType === "date" ? "date"
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

/**
 * Sanitize free-typed number input into the canonical dot-decimal format the DB
 * stores. Keeps only digits, a single leading minus, and a single dot; commas
 * are rejected (never auto-converted), so the stored value can never depend on
 * the user's browser/OS locale. `hadComma` lets the caller surface a hint.
 */
function sanitizeNumberInput(raw: string): { value: string; hadComma: boolean } {
  const hadComma = raw.includes(",");
  const neg = raw.trimStart().startsWith("-");
  let s = raw.replace(/[^0-9.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  }
  return { value: (neg ? "-" : "") + s, hadComma };
}

/**
 * Number entry for the modal/add-row form. A controlled text input with
 * inputMode="decimal" (so mobile shows a numeric keypad) instead of a native
 * `<input type="number">`: the native control's decimal separator is locale-
 * dependent, which silently drops comma-typed values in dot-locale browsers.
 * Here we own the parsing — commas are blocked and a hint is shown.
 */
function NumberInput({
  value,
  onChange,
  disabled = false,
}: {
  value: CellValue | undefined;
  onChange: (v: CellValue) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [showHint, setShowHint] = useState(false);
  const dotHint = t(
    "records.numberDotHint",
    "Используйте точку как десятичный разделитель, например 11.6",
  );
  return (
    <div>
      <Input
        type="text"
        inputMode="decimal"
        placeholder={t("records.numberPlaceholder", "Например: 11.6")}
        title={dotHint}
        value={value === "" || value === undefined || value === null ? "" : String(value)}
        onChange={(e) => {
          const { value: clean, hadComma } = sanitizeNumberInput(e.target.value);
          // Reject (rather than rewrite) any input containing a comma — e.g. a
          // pasted "1,5". Rewriting by stripping the comma would silently corrupt
          // it to "15". Returning without updating leaves the controlled input on
          // its previous value and surfaces the dot hint.
          if (hadComma) {
            setShowHint(true);
            return;
          }
          onChange(clean);
        }}
        onKeyDown={(e) => {
          if (e.key === ",") {
            e.preventDefault();
            setShowHint(true);
          }
        }}
        disabled={disabled}
      />
      {showHint && <p className="mt-1 text-xs text-amber-600">{dotHint}</p>}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  disabled = false,
  userOptions = [],
  allFields,
  rowValues,
  entityId,
  pageId,
}: {
  field: Field;
  value: CellValue | undefined;
  onChange: (v: CellValue) => void;
  disabled?: boolean;
  userOptions?: UserOption[];
  allFields?: Field[];
  rowValues?: Record<string, unknown>;
  entityId?: number;
  pageId?: number;
}) {
  const t = useT();
  if (isDependentField(field) && allFields && rowValues && entityId != null) {
    return (
      <DependentFieldCombobox
        field={field}
        allFields={allFields}
        rowValues={rowValues}
        entityId={entityId}
        pageId={pageId}
        value={typeof value === "string" ? value : value == null ? "" : String(value)}
        onChange={(v) => onChange(v)}
        disabled={disabled}
      />
    );
  }
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
      return <NumberInput value={value} onChange={onChange} disabled={disabled} />;
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
          allowCreate={field.userConfigJson?.allowCreate === true}
          allowedRoleIds={field.userConfigJson?.allowedRoleIds}
          fieldId={field.id}
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

