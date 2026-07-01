import { useEffect, useMemo, useRef, useState } from "react";
import {
  useQueryEntityRecords,
  useGetEntityRelatedValues,
  type EntityRecord,
  type Field,
  type Status,
  type FilterCondition,
  type RecordQueryFilterConjunction,
  type ArchiveFilter,
  type CalendarConfig,
  type CalendarConfigDefaultMode,
  type MultilingualText,
  type PageRelatedColumn,
  type PageRelatedValue,
} from "@workspace/api-client-react";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export type CalendarMode = "month" | "week" | "day" | "agenda";

/** Sentinel card-field key that renders the record's STATUS on the plaque (status
 * is not an entity field, so it can't be selected by fieldKey). */
export const CALENDAR_STATUS_KEY = "__status__";

/** Base records-query state shared with the table (everything except the date window). */
export type CalendarBaseQuery = {
  filters: FilterCondition[];
  filterConjunction: RecordQueryFilterConjunction;
  pageLocalFilters: FilterCondition[];
  statusIds?: number[];
  search?: string;
  archived: ArchiveFilter;
  pageId?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDaysLocal(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Monday-based start of week.
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const dow = (s.getDay() + 6) % 7; // 0 = Monday
  return addDaysLocal(s, -dow);
}

// Parse a record's date value (date or datetime string) into a local day, or null.
function parseRecordDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  // Date-only strings (YYYY-MM-DD) should be read as local days, not UTC midnight.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = dateOnly ? new Date(value + "T00:00:00") : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return startOfDay(d);
}

// Deterministic pastel color for a free-form value when coloring "by field".
function hashColor(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

type CalendarEvent = {
  record: EntityRecord;
  start: Date;
  end: Date;
  title: string;
  color: string | null;
};

/**
 * Calendar renderer for an entity's records (viewType=calendar). It reuses the
 * SAME viewer-scoped records/query as the table — there is no calendar endpoint
 * and no admin-authoritative path. The component owns its own date-window query:
 * it appends a `between` filter on the configured date field for the visible range
 * (only when the base conjunction is AND, so it can't break an OR view) and always
 * re-filters to the window client-side for exactness (handles multi-day spans and
 * OR views). Clicking an event opens the existing record edit dialog.
 */
export function CalendarView({
  entityId,
  config,
  baseQuery,
  fields,
  statuses,
  userNames,
  renderCellValue,
  onRecordClick,
  mode,
  onModeChange,
  refreshTick = 0,
  ml,
}: {
  entityId: number;
  config: CalendarConfig;
  baseQuery: CalendarBaseQuery;
  fields: Field[];
  statuses: Status[];
  userNames: Map<number, string>;
  renderCellValue: (
    field: Field,
    value: unknown,
    t: (key: string, def: string) => string,
    userNames?: Map<number, string>,
    textColor?: string,
    ml?: (val: MultilingualText | string | undefined | null) => string,
  ) => React.ReactNode;
  onRecordClick: (record: EntityRecord) => void;
  mode: CalendarMode;
  onModeChange: (m: CalendarMode) => void;
  refreshTick?: number;
  ml: (val: MultilingualText | string | undefined | null) => string;
}) {
  const t = useT();
  const queryMutation = useQueryEntityRecords();
  const run = queryMutation.mutateAsync;
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [records, setRecords] = useState<EntityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const reqIdRef = useRef(0);

  // Relation/lookup fields (title or plaque data) don't store a scalar in
  // valuesJson — their display value is projected from the linked record via the
  // entity-keyed related-values endpoint (the same one the table uses), which
  // re-applies the related entity's field/row boundary server-side. We resolve
  // them for the calendar's OWN window records here so the plaque shows real
  // values (e.g. a "Проект" relation → the project name) instead of "#id".
  const [relByRecord, setRelByRecord] = useState<Map<number, Map<string, PageRelatedValue>>>(
    new Map(),
  );
  const [relColMeta, setRelColMeta] = useState<Map<string, PageRelatedColumn>>(new Map());
  const fetchEntityRelatedValues = useGetEntityRelatedValues().mutateAsync;
  // Only resolve related-values when a relation/lookup field is actually used by
  // the calendar — as the title or in the plaque data. Otherwise skip the fetch.
  const hasRelationLikeFields = useMemo(() => {
    const isRel = (key: string | null | undefined) => {
      if (!key) return false;
      const f = fields.find((x) => x.fieldKey === key);
      return f?.fieldType === "relation" || f?.fieldType === "lookup";
    };
    if (isRel(config.titleFieldKey)) return true;
    return (config.cardFieldKeys ?? []).some((k) => isRel(k));
  }, [fields, config.titleFieldKey, config.cardFieldKeys]);

  const fieldByKey = useMemo(() => {
    const m = new Map<string, Field>();
    for (const f of fields) m.set(f.fieldKey, f);
    return m;
  }, [fields]);
  const statusById = useMemo(() => {
    const m = new Map<number, Status>();
    for (const s of statuses) m.set(s.id, s);
    return m;
  }, [statuses]);

  // The inclusive [windowStart, windowEnd) day range that's currently visible.
  const { windowStart, windowEnd } = useMemo(() => {
    if (mode === "day") {
      const s = startOfDay(anchor);
      return { windowStart: s, windowEnd: addDaysLocal(s, 1) };
    }
    if (mode === "week") {
      const s = startOfWeek(anchor);
      return { windowStart: s, windowEnd: addDaysLocal(s, 7) };
    }
    if (mode === "agenda") {
      const s = startOfDay(anchor);
      return { windowStart: s, windowEnd: addDaysLocal(s, 30) };
    }
    // month: full weeks covering the month grid.
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return { windowStart: gridStart, windowEnd: addDaysLocal(gridStart, 42) };
  }, [mode, anchor]);

  const titleFieldKey =
    config.titleFieldKey ||
    fields.find((f) => f.fieldType === "text")?.fieldKey ||
    null;

  const baseKey = JSON.stringify(baseQuery);
  const windowKey = `${toISODate(windowStart)}_${toISODate(windowEnd)}`;
  const dateFieldKey = config.dateFieldKey;
  const endDateFieldKey = config.endDateFieldKey ?? null;

  useEffect(() => {
    if (!dateFieldKey) {
      setRecords([]);
      setLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setTruncated(false);

    // The records/query endpoint applies one filterConjunction to the whole filter
    // list, so a date-window filter can only be AND-narrowed server-side when the
    // base logic is already AND (or there are no base filters). Under OR, appending
    // the window would OR-widen instead, so we DON'T send it; we page by date asc
    // and stop as soon as a row starts at/after windowEnd — by asc order every
    // remaining row is also later, so all window-overlapping rows have been seen.
    const canServerWindow =
      baseQuery.filterConjunction !== "or" || baseQuery.filters.length === 0;
    const startISO = toISODate(windowStart);
    const endISO = toISODate(windowEnd); // exclusive

    const windowFilters: FilterCondition[] = [];
    if (canServerWindow) {
      if (endDateFieldKey) {
        // A span overlaps the window when start < windowEnd AND end >= windowStart.
        windowFilters.push({ field: dateFieldKey, operator: "lt", value: endISO });
        windowFilters.push({ field: endDateFieldKey, operator: "gte", value: startISO });
      } else {
        windowFilters.push({ field: dateFieldKey, operator: "between", value: [startISO, endISO] });
      }
    }

    const PAGE_SIZE = 200;
    const MAX_PAGES = 6; // hard cap (~1200 records) so a huge entity can't stall the view

    const fetchAll = async (): Promise<{ rows: EntityRecord[]; truncated: boolean }> => {
      const acc: EntityRecord[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await run({
          entityId,
          data: {
            filters: [...baseQuery.filters, ...windowFilters],
            filterConjunction: baseQuery.filterConjunction,
            pageLocalFilters: baseQuery.pageLocalFilters,
            statusIds: baseQuery.statusIds,
            search: baseQuery.search,
            archived: baseQuery.archived,
            pageId: baseQuery.pageId,
            sorts: [{ field: dateFieldKey, direction: "asc" }],
            page,
            pageSize: PAGE_SIZE,
          },
        });
        acc.push(...res.data);
        // Natural completion: this page wasn't full, or we've pulled every row.
        if (res.data.length < PAGE_SIZE || acc.length >= res.total) {
          return { rows: acc, truncated: false };
        }
        // OR fallback (no server window): once the last (asc) row starts at/after
        // windowEnd, every later row is too — we've captured the whole window.
        if (!canServerWindow) {
          const lastStart = parseRecordDate(res.data[res.data.length - 1]?.valuesJson?.[dateFieldKey]);
          if (lastStart && lastStart.getTime() >= windowEnd.getTime()) {
            return { rows: acc, truncated: false };
          }
        }
      }
      // Hit the page cap with more rows still unread → results are incomplete.
      return { rows: acc, truncated: true };
    };

    fetchAll()
      .then(({ rows, truncated: cut }) => {
        if (reqId !== reqIdRef.current) return;
        setRecords(rows);
        setTruncated(cut);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (reqId !== reqIdRef.current) return;
        const msg =
          err && typeof err === "object" && "data" in err
            ? ((err as { data?: { error?: string } }).data?.error ?? null)
            : null;
        setError(msg ?? t("calendar.error", "Не удалось загрузить календарь"));
        setRecords([]);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, baseKey, windowKey, dateFieldKey, endDateFieldKey, refreshTick]);

  // Resolve relation/lookup values for the loaded window records (see note above).
  const recordIdsKey = useMemo(() => records.map((r) => r.id).join(","), [records]);
  useEffect(() => {
    if (!hasRelationLikeFields || records.length === 0) {
      setRelByRecord(new Map());
      setRelColMeta(new Map());
      return;
    }
    let cancelled = false;
    const recordIds = records.map((r) => r.id);
    fetchEntityRelatedValues({ entityId, data: { recordIds, pageId: baseQuery.pageId } })
      .then((res) => {
        if (cancelled) return;
        const meta = new Map<string, PageRelatedColumn>();
        for (const c of res.columns) meta.set(c.fieldKey, c);
        const byRec = new Map<number, Map<string, PageRelatedValue>>();
        for (const v of res.values) {
          let inner = byRec.get(v.recordId);
          if (!inner) {
            inner = new Map();
            byRec.set(v.recordId, inner);
          }
          inner.set(v.fieldKey, v);
        }
        setRelColMeta(meta);
        setRelByRecord(byRec);
      })
      .catch(() => {
        if (cancelled) return;
        setRelByRecord(new Map());
        setRelColMeta(new Map());
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, hasRelationLikeFields, recordIdsKey, baseQuery.pageId, refreshTick]);

  // Map records → events with resolved start/end/title/color, dropping any without
  // a parseable date and clipping to the visible window.
  const events = useMemo<CalendarEvent[]>(() => {
    const out: CalendarEvent[] = [];
    for (const rec of records) {
      const start = parseRecordDate(rec.valuesJson?.[dateFieldKey]);
      if (!start) continue;
      let end = start;
      if (endDateFieldKey) {
        const e = parseRecordDate(rec.valuesJson?.[endDateFieldKey]);
        if (e && e.getTime() >= start.getTime()) end = e;
      }
      // Client-side window overlap check (exact, handles spans + OR views).
      if (end.getTime() < windowStart.getTime() || start.getTime() >= windowEnd.getTime()) continue;

      const titleField = titleFieldKey ? fieldByKey.get(titleFieldKey) : undefined;
      // A relation/lookup title projects the linked record's value, which lives in
      // relByRecord (not valuesJson). Fall back to valuesJson for scalar fields.
      let rawTitle: unknown =
        titleFieldKey ? rec.valuesJson?.[titleFieldKey] : undefined;
      if (
        titleField &&
        (titleField.fieldType === "relation" || titleField.fieldType === "lookup")
      ) {
        rawTitle = relByRecord.get(rec.id)?.get(titleField.fieldKey)?.value ?? null;
      }
      const title =
        rawTitle != null && rawTitle !== ""
          ? String(rawTitle)
          : `${ml(titleField?.nameJson) || t("calendar.untitled", "Без названия")} #${rec.id}`;

      let color: string | null = null;
      if (config.colorBy === "status" && rec.statusId != null) {
        color = statusById.get(rec.statusId)?.color ?? null;
      } else if (config.colorBy === "field" && config.colorFieldKey) {
        const v = rec.valuesJson?.[config.colorFieldKey];
        if (v != null && v !== "") color = hashColor(String(v));
      }
      out.push({ record: rec, start, end, title, color });
    }
    return out;
  }, [records, dateFieldKey, endDateFieldKey, titleFieldKey, fieldByKey, config.colorBy, config.colorFieldKey, statusById, windowStart, windowEnd, ml, t, relByRecord]);

  // Group events by ISO day for the grid/list renderers. A span lands on every day
  // it covers within the window.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      let d = ev.start.getTime() < windowStart.getTime() ? windowStart : ev.start;
      const last = ev.end;
      while (d.getTime() <= last.getTime() && d.getTime() < windowEnd.getTime()) {
        const key = toISODate(d);
        const arr = map.get(key) ?? [];
        arr.push(ev);
        map.set(key, arr);
        d = addDaysLocal(d, 1);
      }
    }
    return map;
  }, [events, windowStart, windowEnd]);

  const goPrev = () => {
    if (mode === "day") setAnchor((a) => addDaysLocal(a, -1));
    else if (mode === "week") setAnchor((a) => addDaysLocal(a, -7));
    else if (mode === "agenda") setAnchor((a) => addDaysLocal(a, -30));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1));
  };
  const goNext = () => {
    if (mode === "day") setAnchor((a) => addDaysLocal(a, 1));
    else if (mode === "week") setAnchor((a) => addDaysLocal(a, 7));
    else if (mode === "agenda") setAnchor((a) => addDaysLocal(a, 30));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1));
  };
  const goToday = () => setAnchor(startOfDay(new Date()));

  const locale =
    typeof document !== "undefined" && document.documentElement.lang
      ? document.documentElement.lang
      : undefined;
  const headerLabel = useMemo(() => {
    if (mode === "day") {
      return anchor.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
    }
    if (mode === "week") {
      const e = addDaysLocal(windowStart, 6);
      return `${windowStart.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${e.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`;
    }
    if (mode === "agenda") {
      const e = addDaysLocal(windowStart, 29);
      return `${windowStart.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${e.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`;
    }
    return anchor.toLocaleDateString(locale, { month: "long", year: "numeric" });
  }, [mode, anchor, windowStart, locale]);

  // Plaque data fields, ordered to MATCH the table (by field sortOrder) rather
  // than the checkbox pick order. The status sentinel is handled separately.
  const cardFields = useMemo(
    () =>
      (config.cardFieldKeys ?? [])
        .filter((k) => k !== CALENDAR_STATUS_KEY)
        .map((k) => fieldByKey.get(k))
        .filter((f): f is Field => !!f)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [config.cardFieldKeys, fieldByKey],
  );
  const showStatusOnCard = (config.cardFieldKeys ?? []).includes(CALENDAR_STATUS_KEY);

  const renderChip = (ev: CalendarEvent, key: string, compact: boolean) => {
    // When coloring by status/field we tint the plaque background + left border,
    // but keep the TEXT dark so it stays readable (a light-tinted bg + same-hue
    // text was nearly invisible).
    const style = ev.color
      ? { backgroundColor: `${ev.color}20`, color: "#1e293b", borderLeft: `3px solid ${ev.color}` }
      : undefined;
    const status = ev.record.statusId != null ? statusById.get(ev.record.statusId) : undefined;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onRecordClick(ev.record)}
        style={style}
        className={`block w-full rounded px-1.5 py-1 text-left text-xs transition hover:brightness-95 ${
          ev.color ? "" : "bg-blue-50 text-blue-700 border-l-[3px] border-blue-400"
        }`}
        title={ev.title}
      >
        <span className={`block font-medium ${compact ? "truncate" : "break-words"}`}>{ev.title}</span>
        {!compact && showStatusOnCard && status && (
          <span className="flex items-center gap-1 break-words text-[11px] opacity-80">
            {status.color && (
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: status.color }}
              />
            )}
            <span className="font-semibold">{t("calendar.statusLabel", "Статус")}:</span> {ml(status.nameJson)}
          </span>
        )}
        {!compact &&
          cardFields.map((f) => {
            const isRel = f.fieldType === "relation" || f.fieldType === "lookup";
            let renderField: Field = f;
            let v: unknown;
            if (isRel) {
              // Relation/lookup plaque fields project the linked record's value from
              // relByRecord and render with the PROJECTED type (meta.relatedFieldType).
              const rel = relByRecord.get(ev.record.id)?.get(f.fieldKey);
              if (rel?.linkedRecordId == null || rel.value == null || rel.value === "") return null;
              const meta = relColMeta.get(f.fieldKey);
              renderField = {
                ...f,
                fieldType: (meta?.relatedFieldType ?? "text") as Field["fieldType"],
                optionsJson: meta?.optionsJson ?? [],
              } as Field;
              v = rel.value;
            } else {
              v = ev.record.valuesJson?.[f.fieldKey];
              if (v == null || v === "") return null;
            }
            return (
              <span key={f.fieldKey} className="block break-words text-[11px] opacity-80">
                <span className="font-semibold">{ml(f.nameJson)}:</span> {renderCellValue(renderField, v, t, userNames, undefined, ml)}
              </span>
            );
          })}
      </button>
    );
  };

  const modeButtons: [CalendarMode, string][] = [
    ["month", t("calendar.modeMonth", "Месяц")],
    ["week", t("calendar.modeWeek", "Неделя")],
    ["day", t("calendar.modeDay", "День")],
    ["agenda", t("calendar.modeAgenda", "Повестка")],
  ];

  const weekdayLabels = useMemo(() => {
    const base = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) =>
      addDaysLocal(base, i).toLocaleDateString(locale, { weekday: "short" }),
    );
  }, [locale]);

  const todayISO = toISODate(startOfDay(new Date()));

  if (!dateFieldKey) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
        <CalendarDays className="w-8 h-8 opacity-50" />
        <p className="text-sm">{t("calendar.noDateConfigured", "Поле даты для календаря не настроено")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={goToday}>
            {t("calendar.today", "Сегодня")}
          </Button>
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={goPrev}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={goNext}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <span className="ml-1 text-sm font-medium capitalize text-slate-700">{headerLabel}</span>
          {loading && <Loader2 className="ml-1 w-3.5 h-3.5 animate-spin text-slate-400" />}
        </div>
        <div className="inline-flex items-center rounded-md border border-slate-200 p-0.5">
          {modeButtons.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onModeChange(value)}
              className={`px-3 h-7 text-xs rounded-[5px] transition ${
                mode === value ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {truncated && !error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {t(
            "calendar.truncated",
            "Показаны не все события: слишком много записей. Сузьте период или фильтры.",
          )}
        </div>
      )}

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : mode === "agenda" ? (
        <AgendaList
          windowStart={windowStart}
          eventsByDay={eventsByDay}
          renderChip={renderChip}
          locale={locale}
          t={t}
        />
      ) : mode === "month" ? (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {weekdayLabels.map((w, i) => (
              <div key={i} className="px-2 py-1.5 text-center text-xs font-medium capitalize text-slate-500">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => {
              const day = addDaysLocal(windowStart, i);
              const iso = toISODate(day);
              const inMonth = day.getMonth() === anchor.getMonth();
              const dayEvents = eventsByDay.get(iso) ?? [];
              return (
                <div
                  key={iso}
                  className={`min-h-[96px] border-b border-r border-slate-100 p-1 ${
                    inMonth ? "bg-white" : "bg-slate-50/50"
                  }`}
                >
                  <div
                    className={`mb-1 text-right text-xs ${
                      iso === todayISO
                        ? "font-semibold text-blue-600"
                        : inMonth
                          ? "text-slate-500"
                          : "text-slate-300"
                    }`}
                  >
                    {day.getDate()}
                  </div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 4).map((ev, idx) => renderChip(ev, `${iso}-${ev.record.id}-${idx}`, false))}
                    {dayEvents.length > 4 && (
                      <span className="block px-1 text-[11px] text-slate-400">
                        +{dayEvents.length - 4} {t("calendar.more", "ещё")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        // week + day share a column layout (1 or 7 day columns).
        <div className={`grid gap-2 ${mode === "week" ? "grid-cols-1 sm:grid-cols-7" : "grid-cols-1"}`}>
          {Array.from({ length: mode === "week" ? 7 : 1 }, (_, i) => {
            const day = addDaysLocal(windowStart, i);
            const iso = toISODate(day);
            const dayEvents = eventsByDay.get(iso) ?? [];
            return (
              <div key={iso} className="rounded-lg border border-slate-200">
                <div
                  className={`border-b border-slate-100 px-2 py-1.5 text-xs font-medium capitalize ${
                    iso === todayISO ? "text-blue-600" : "text-slate-600"
                  }`}
                >
                  {day.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })}
                </div>
                <div className="space-y-1 p-1.5">
                  {dayEvents.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-slate-300">{t("calendar.noEvents", "Нет событий")}</p>
                  ) : (
                    dayEvents.map((ev, idx) => renderChip(ev, `${iso}-${ev.record.id}-${idx}`, false))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AgendaList({
  windowStart,
  eventsByDay,
  renderChip,
  locale,
  t,
}: {
  windowStart: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  renderChip: (ev: CalendarEvent, key: string, compact: boolean) => React.ReactNode;
  locale: string | undefined;
  t: (key: string, def: string) => string;
}) {
  const days = Array.from({ length: 30 }, (_, i) => addDaysLocal(windowStart, i)).filter(
    (d) => (eventsByDay.get(toISODate(d)) ?? []).length > 0,
  );
  if (days.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
        <CalendarDays className="w-8 h-8 opacity-50" />
        <p className="text-sm">{t("calendar.empty", "Нет событий в этом диапазоне")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {days.map((day) => {
        const iso = toISODate(day);
        const dayEvents = eventsByDay.get(iso) ?? [];
        return (
          <div key={iso} className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-medium capitalize text-slate-600">
              {day.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <div className="space-y-1 p-2">
              {dayEvents.map((ev, idx) => renderChip(ev, `${iso}-${ev.record.id}-${idx}`, false))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function defaultCalendarMode(config: CalendarConfig | undefined): CalendarMode {
  const m = (config?.defaultMode ?? "month") as CalendarConfigDefaultMode;
  if (m === "week" || m === "day" || m === "agenda" || m === "month") return m;
  return "month";
}
