import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  queryEntityRecords,
  queryPageRecordValues,
  getEntityRelatedValues,
  getPageRelatedValues,
  getRecord,
  type RecordArchive,
  updateRecord,
  archiveRecord,
  type EntityRecord,
  type Field,
  type PageField,
  type Status,
  type RecordQuery,
  type MultilingualText,
  type PageRelatedColumn,
  type PageRelatedValue,
  type TextDirection,
} from "@workspace/api-client-react";
import { useLang, useT } from "@/lib/i18n";
import { CompactStatus } from "@/components/CompactStatus";
import { useManualDataRefresh } from "@/lib/manualDataRefresh";
import { resolveDataDirection } from "@/lib/dataDirection";
import { useToast } from "@/hooks/use-toast";
import {
  NULL_LANE,
  applyPendingMoves,
  buildLaneQuery,
  computeLanes,
  isEmptyValue,
  isPageFieldRef,
  laneKeyFor,
  moveBetween,
  pageFieldKeyOf,
  statusIdForLane,
  fitBoardHeight,
  STATUS_FIELD_REF,
  type KanbanLaneKey,
  type PendingMove,
} from "@/lib/kanbanBoard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Archive, GripVertical, Loader2, MoreHorizontal, Pencil, Eye, ArrowRightLeft, RotateCw, Inbox, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";

/** Matches backend ViewConfig.kanban. Field refs: entity fieldKey or "page:<pageFieldKey>". */
export type KanbanConfig = {
  textDirection?: "ltr" | "rtl" | null;
  titleField: string | null;
  fields: string[];
  showLabels: boolean;
  hideEmptyFields: boolean;
};

export type KanbanBaseQuery = Omit<RecordQuery, "page" | "pageSize"> & {
  statusIsNull?: boolean;
  showHiddenStatuses?: boolean;
};

type MlFn = (val: MultilingualText | string | undefined | null) => string;
type StatusX = Status & { hideByDefault?: boolean };

export type KanbanViewProps = {
  entityId: number;
  config: KanbanConfig | undefined | null;
  baseQuery: KanbanBaseQuery;
  fields: Field[];
  /** Viewer-visible page-local fields (permission-scoped); referenced as "page:<fieldKey>". */
  pageFields?: PageField[];
  statuses: Status[];
  userNames: Map<number, string>;
  renderCellValue: (
    field: Field,
    value: unknown,
    t: (key: string, def: string) => string,
    userNames?: Map<number, string>,
    textColor?: string,
    ml?: MlFn,
  ) => React.ReactNode;
  onEdit: (record: EntityRecord) => void;
  canEdit: boolean;
  canMove: (record: EntityRecord) => boolean;
  allowedStatuses: (record: EntityRecord) => Status[];
  allowNoStatus: boolean;
  /** Optional: enables the per-card Archive command (uses archive API with expectedVersion). */
  canArchive?: (record: EntityRecord) => boolean;
  /** Optional: notified after successful move/archive (e.g. to refresh counters). */
  onDataChanged?: () => void;
  refreshTick?: number;
  ml: MlFn;
  pageTextDirection?: TextDirection | null;
  appTextDirection?: TextDirection | null;
};

const PAGE_SIZE = 40;
const EDGE = 64;

type LaneState = {
  records: EntityRecord[];
  total: number;
  /** 1-based window page; DOM holds at most PAGE_SIZE cards per lane. */
  page: number;
  loading: boolean;
  error: string | null;
};
const emptyLane = (): LaneState => ({ records: [], total: 0, page: 1, loading: true, error: null });

/** Hydrated display data for loaded records (entity relations + page-local values/relations). */
type Hydration = {
  rel: Map<number, Map<string, PageRelatedValue>>;
  meta: Map<string, PageRelatedColumn>;
  pv: Map<number, Record<string, unknown>>;
  prel: Map<number, Map<string, PageRelatedValue>>;
  pmeta: Map<string, PageRelatedColumn>;
};
const emptyHydration = (): Hydration => ({ rel: new Map(), meta: new Map(), pv: new Map(), prel: new Map(), pmeta: new Map() });

const isRelType = (t: string | undefined) => t === "relation" || t === "lookup";

/** Fetches every hydration source the given refs need; throws on any failure (callers show retry). */
async function fetchHydration(
  entityId: number,
  pageId: number | undefined,
  ids: number[],
  need: { rel: boolean; pv: boolean; prel: boolean },
): Promise<Hydration> {
  const h = emptyHydration();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
  const addRel = (res: { columns: PageRelatedColumn[]; values: PageRelatedValue[] }, by: Hydration["rel"], meta: Hydration["meta"]) => {
    for (const c of res.columns) meta.set(c.fieldKey, c);
    for (const v of res.values) {
      let inner = by.get(v.recordId);
      if (!inner) by.set(v.recordId, (inner = new Map()));
      inner.set(v.fieldKey, v);
    }
  };
  await Promise.all(
    chunks.flatMap((c) => [
      need.rel ? getEntityRelatedValues(entityId, { recordIds: c, pageId }).then((r) => addRel(r, h.rel, h.meta)) : null,
      need.pv && pageId
        ? queryPageRecordValues(pageId, { recordIds: c }).then((r) => {
            for (const v of r) h.pv.set(v.recordId, v.valuesJson as Record<string, unknown>);
          })
        : null,
      need.prel && pageId ? getPageRelatedValues(pageId, { recordIds: c }).then((r) => addRel(r, h.prel, h.pmeta)) : null,
    ]),
  );
  return h;
}

function errMsg(err: unknown): string | null {
  if (err && typeof err === "object" && "data" in err) {
    return (err as { data?: { error?: string } }).data?.error ?? null;
  }
  return null;
}
function errStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) return Number((err as { status?: number }).status) || null;
  return null;
}

type DisplayItem = { key: string; label: string; field: Field; value: unknown; dir: "ltr" | "rtl" };

export function KanbanView(props: KanbanViewProps) {
  const {
    entityId, config, baseQuery, fields, pageFields = [], statuses, userNames, renderCellValue,
    onEdit, canEdit, canMove, allowedStatuses, allowNoStatus, canArchive, onDataChanged,
    refreshTick = 0, ml, pageTextDirection, appTextDirection,
  } = props;
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();

  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s as StatusX])), [statuses]);
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.fieldKey, f])), [fields]);
  const pageFieldByKey = useMemo(() => new Map(pageFields.map((f) => [f.fieldKey, f])), [pageFields]);
  const pageId = baseQuery.pageId;

  const lanes = useMemo(
    () => computeLanes(statuses as StatusX[], baseQuery as never),
    [statuses, baseQuery],
  );
  const baseKey = JSON.stringify(baseQuery);
  const lanesKey = lanes.join(",");

  const [laneState, setLaneState] = useState<Map<KanbanLaneKey, LaneState>>(new Map());
  const laneStateRef = useRef(laneState);
  laneStateRef.current = laneState;
  const genRef = useRef(new Map<KanbanLaneKey, number>());
  const pendingRef = useRef(new Map<number, PendingMove<EntityRecord>>());
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  /** Query epoch: bumped whenever the query scope changes or on unmount. Every read and
   * write completion checks it, so nothing from an old scope can touch current lanes. */
  const epochRef = useRef(0);
  const baseRef = useRef(baseQuery);
  baseRef.current = baseQuery;

  const patchLane = useCallback((lane: KanbanLaneKey, fn: (s: LaneState) => LaneState) => {
    setLaneState((prev) => {
      const m = new Map(prev);
      m.set(lane, fn(prev.get(lane) ?? emptyLane()));
      return m;
    });
  }, []);

  /** Load one bounded window page of a lane. page undefined = reload the current page. */
  const loadLane = useCallback(
    async (lane: KanbanLaneKey, page?: number) => {
      const epoch = epochRef.current;
      const cur = laneStateRef.current.get(lane);
      const target = page ?? cur?.page ?? 1;
      const gen = (genRef.current.get(lane) ?? 0) + 1;
      genRef.current.set(lane, gen);
      patchLane(lane, (s) => ({ ...s, page: target, loading: page !== undefined || s.records.length === 0, error: null }));
      try {
        const body = buildLaneQuery(baseRef.current as never, lane, target, PAGE_SIZE) as RecordQuery;
        const res = await queryEntityRecords(entityId, body);
        if (epochRef.current !== epoch || (genRef.current.get(lane) ?? 0) !== gen) return; // stale response
        const lastPage = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
        if (res.data.length === 0 && target > lastPage) {
          void loadLane(lane, lastPage); // window shrank (moves/archive) — clamp
          return;
        }
        patchLane(lane, () => ({
          records: applyPendingMoves(lane, res.data, pendingRef.current),
          total: res.total,
          page: target,
          loading: false,
          error: null,
        }));
      } catch (err) {
        if (epochRef.current !== epoch || (genRef.current.get(lane) ?? 0) !== gen) return;
        patchLane(lane, (s) => ({ ...s, loading: false, error: errMsg(err) ?? t("kanban.error", "Не удалось загрузить колонку") }));
      }
    },
    [entityId, patchLane, t],
  );

  // Full reset when the query snapshot or lane set changes.
  useEffect(() => {
    epochRef.current += 1;
    genRef.current = new Map();
    // In-flight writes belong to the old scope: never overlay them onto the new query.
    pendingRef.current = new Map();
    setPendingIds(new Set());
    setLaneState(new Map(lanes.map((l) => [l, emptyLane()])));
    laneStateRef.current = new Map(lanes.map((l) => [l, emptyLane()]));
    for (const l of lanes) void loadLane(l, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, baseKey, lanesKey]);

  useEffect(() => () => {
    epochRef.current += 1; // unmount: drop every late response
  }, []);

  const reloadAll = useCallback(
    () => Promise.all(lanes.map((l) => loadLane(l))),
    [lanes, loadLane],
  );
  const reloadAllRef = useRef(reloadAll);
  reloadAllRef.current = reloadAll;
  const firstTick = useRef(true);
  useEffect(() => {
    if (firstTick.current) {
      firstTick.current = false;
      return;
    }
    void reloadAllRef.current();
  }, [refreshTick]);
  useManualDataRefresh(() => reloadAllRef.current());

  // ---------- relation + page-local hydration for loaded cards ----------
  const allRecords = useMemo(() => {
    const out: EntityRecord[] = [];
    for (const l of lanes) out.push(...(laneState.get(l)?.records ?? []));
    return out;
  }, [laneState, lanes]);
  const idsKey = useMemo(() => allRecords.map((r) => r.id).sort((a, b) => a - b).join(","), [allRecords]);

  const cardRefs = useMemo(() => {
    const refs = config?.fields ?? [];
    return config?.titleField ? [config.titleField, ...refs] : refs;
  }, [config]);
  const need = useMemo(() => {
    let rel = false, pv = false, prel = false;
    for (const k of cardRefs) {
      if (isPageFieldRef(k)) {
        const pf = pageFieldByKey.get(pageFieldKeyOf(k));
        if (!pf || !pageId) continue;
        if (isRelType(pf.fieldType)) prel = true;
        else pv = true;
      } else if (isRelType(fieldByKey.get(k)?.fieldType)) rel = true;
    }
    return { rel, pv, prel };
  }, [cardRefs, pageFieldByKey, fieldByKey, pageId]);

  const [hyd, setHyd] = useState<Hydration>(emptyHydration);
  const [hydError, setHydError] = useState<string | null>(null);
  const [hydNonce, setHydNonce] = useState(0);

  useEffect(() => {
    if (!idsKey || (!need.rel && !need.pv && !need.prel)) return;
    let cancelled = false;
    const epoch = epochRef.current;
    fetchHydration(entityId, pageId, idsKey.split(",").map(Number), need)
      .then((h) => {
        if (cancelled || epochRef.current !== epoch) return;
        setHyd(h);
        setHydError(null);
      })
      .catch((err) => {
        if (!cancelled && epochRef.current === epoch) setHydError(errMsg(err) ?? t("kanban.hydrateError", "Не удалось загрузить связанные значения"));
      });
    return () => {
      cancelled = true;
    };
  }, [entityId, idsKey, need, pageId, refreshTick, hydNonce, t]);

  const dirFor = useCallback(
    (td: TextDirection | null | undefined) =>
      resolveDataDirection(td ?? null, config?.textDirection ?? pageTextDirection ?? null, appTextDirection ?? null, lang),
    [config?.textDirection, pageTextDirection, appTextDirection, lang],
  );

  const relItem = (
    ref: string, label: string, base: Field, r: PageRelatedValue | undefined, m: PageRelatedColumn | undefined, dir: "ltr" | "rtl",
  ): DisplayItem => ({
    key: ref,
    label,
    field: { ...base, fieldType: (m?.relatedFieldType ?? "text") as Field["fieldType"], optionsJson: m?.optionsJson ?? [] } as Field,
    value: r?.linkedRecordId == null ? null : r.value,
    dir,
  });

  /** Resolve a field ref (entity key or page:key) to a displayable item for a record. */
  const resolveItem = useCallback(
    (rec: EntityRecord, ref: string, h?: Hydration): DisplayItem | null => {
      const hy = h ?? hyd;
      if (isPageFieldRef(ref)) {
        const pf = pageFieldByKey.get(pageFieldKeyOf(ref));
        if (!pf) return null;
        const dir = dirFor(pf.textDirection);
        if (isRelType(pf.fieldType)) {
          return relItem(ref, ml(pf.nameJson), pf as unknown as Field, hy.prel.get(rec.id)?.get(pf.fieldKey), hy.pmeta.get(pf.fieldKey), dir);
        }
        return { key: ref, label: ml(pf.nameJson), field: pf as unknown as Field, value: hy.pv.get(rec.id)?.[pf.fieldKey], dir };
      }
      const f = fieldByKey.get(ref);
      if (!f) return null;
      const dir = dirFor(f.textDirection);
      if (isRelType(f.fieldType)) return relItem(ref, ml(f.nameJson), f, hy.rel.get(rec.id)?.get(f.fieldKey), hy.meta.get(f.fieldKey), dir);
      return { key: ref, label: ml(f.nameJson), field: f, value: rec.valuesJson?.[f.fieldKey], dir };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hyd, pageFieldByKey, fieldByKey, ml, dirFor],
  );

  const titleRef = (config?.titleField && config.titleField !== STATUS_FIELD_REF ? config.titleField : null) || fields.find((f) => f.fieldType === "text")?.fieldKey || null;
  const titleOf = useCallback(
    (rec: EntityRecord) => {
      const it = titleRef ? resolveItem(rec, titleRef) : null;
      if (it && !isEmptyValue(it.value)) return { text: String(it.value), dir: it.dir };
      return { text: `${t("kanban.record", "Запись")} #${rec.id}`, dir: undefined };
    },
    [titleRef, resolveItem, t],
  );

  // ---------- moves ----------
  const laneOf = (rec: EntityRecord) => laneKeyFor(rec.statusId);
  const destinationsFor = useCallback(
    (rec: EntityRecord): KanbanLaneKey[] => {
      if (!canMove(rec)) return [];
      const out = allowedStatuses(rec).filter((s) => s.id !== rec.statusId).map((s) => laneKeyFor(s.id));
      if (allowNoStatus && rec.statusId != null) out.push(NULL_LANE);
      return out;
    },
    [canMove, allowedStatuses, allowNoStatus],
  );

  const laneLabel = useCallback(
    (lane: KanbanLaneKey) => {
      const id = statusIdForLane(lane);
      return id == null ? t("kanban.noStatus", "Без статуса") : ml(statusById.get(id)?.nameJson) || `#${id}`;
    },
    [statusById, ml, t],
  );

  const moveRecord = useCallback(
    async (rec: EntityRecord, to: KanbanLaneKey) => {
      if (pendingRef.current.has(rec.id)) return;
      const epoch = epochRef.current;
      const from = laneOf(rec);
      if (from === to) return;
      const newStatusId = statusIdForLane(to);
      const optimistic: EntityRecord = { ...rec, statusId: newStatusId };
      pendingRef.current.set(rec.id, { from, to, record: optimistic });
      setPendingIds(new Set(pendingRef.current.keys()));
      // Bump generations so any in-flight lane fetch can't overwrite the optimistic state.
      let sourceIndex = -1;
      setLaneState((prev) => {
        const recMap = new Map<KanbanLaneKey, EntityRecord[]>();
        for (const [k, v] of prev) recMap.set(k, v.records);
        const r = moveBetween(recMap, rec.id, from, to, optimistic);
        sourceIndex = r.index;
        const m = new Map(prev);
        const src = prev.get(from);
        if (src) m.set(from, { ...src, records: r.lanes.get(from) ?? [], total: Math.max(0, src.total - 1) });
        const dst = prev.get(to);
        if (dst) m.set(to, { ...dst, records: r.lanes.get(to) ?? [], total: dst.total + 1 });
        return m;
      });
      try {
        await updateRecord(rec.id, { statusId: newStatusId, expectedVersion: rec.version, pageId });
        if (epochRef.current !== epoch) {
          onDataChanged?.();
          return; // scope changed; new query already reflects the server
        }
        pendingRef.current.delete(rec.id);
        setPendingIds(new Set(pendingRef.current.keys()));
        if (!laneStateRef.current.has(to)) {
          toast({ title: t("kanban.movedHidden", "Перемещено в скрытую колонку"), description: laneLabel(to) });
        }
        // Server effects (automations, archive triggers, filters) — refetch affected lanes.
        if (laneStateRef.current.has(from)) void loadLane(from);
        if (laneStateRef.current.has(to)) void loadLane(to);
        onDataChanged?.();
      } catch (err) {
        const conflict = errStatus(err) === 409;
        const errToast = () =>
          toast({
            variant: "destructive",
            title: conflict
              ? t("kanban.conflict", "Запись изменена другим пользователем")
              : t("kanban.moveFailed", "Не удалось изменить статус"),
            description: errMsg(err) ?? undefined,
          });
        if (epochRef.current !== epoch) {
          errToast(); // never roll back into lanes of a different query
          return;
        }
        pendingRef.current.delete(rec.id);
        setPendingIds(new Set(pendingRef.current.keys()));
        setLaneState((prev) => {
          const m = new Map(prev);
          const dst = prev.get(to);
          if (dst) m.set(to, { ...dst, records: dst.records.filter((r) => r.id !== rec.id), total: Math.max(0, dst.total - 1) });
          const src = prev.get(from);
          if (src && !src.records.some((r) => r.id === rec.id)) {
            const recs = [...src.records];
            recs.splice(sourceIndex < 0 ? 0 : Math.min(sourceIndex, recs.length), 0, rec);
            m.set(from, { ...src, records: recs, total: src.total + 1 });
          }
          return m;
        });
        errToast();
        if (conflict) {
          // Another editor may have moved this record into a third lane. A
          // live refresh while our write was pending hid that authoritative
          // card behind the optimistic overlay, so reloading only our source
          // and destination would leave the winner's lane missing the card.
          void reloadAllRef.current();
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageId, loadLane, toast, t, laneLabel, onDataChanged],
  );

  const doArchive = useCallback(
    async (rec: EntityRecord) => {
      let epoch = epochRef.current;
      try {
        if (pendingRef.current.has(rec.id)) return;
        epoch = epochRef.current;
        pendingRef.current.set(rec.id, { from: laneOf(rec), to: laneOf(rec), record: rec });
        setPendingIds(new Set(pendingRef.current.keys()));
        // pageId: mirror-page permission boundary (backend accepts it on RecordArchive).
        await archiveRecord(rec.id, { expectedVersion: rec.version, pageId } as RecordArchive);
        if (epochRef.current !== epoch) {
          onDataChanged?.();
          return;
        }
        pendingRef.current.delete(rec.id);
        setPendingIds(new Set(pendingRef.current.keys()));
        toast({ title: t("kanban.archived", "Запись архивирована") });
        void loadLane(laneOf(rec));
        onDataChanged?.();
      } catch (err) {
        if (epochRef.current === epoch) {
          pendingRef.current.delete(rec.id);
          setPendingIds(new Set(pendingRef.current.keys()));
        }
        toast({ variant: "destructive", title: t("kanban.archiveFailed", "Не удалось архивировать"), description: errMsg(err) ?? undefined });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadLane, toast, t, onDataChanged, pageId],
  );

  // ---------- pointer drag ----------
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ record: EntityRecord; width: number; allowed: Set<KanbanLaneKey> } | null>(null);
  const [overLane, setOverLane] = useState<KanbanLaneKey | null>(null);
  const dragRef = useRef<{
    record: EntityRecord; startX: number; startY: number; offX: number; offY: number; width: number;
    active: boolean; x: number; y: number; pointerId: number; raf: number; over: KanbanLaneKey | null;
  } | null>(null);
  const suppressClick = useRef(false);

  const laneAt = (x: number, y: number): { key: KanbanLaneKey | null; scroller: HTMLElement | null } => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const laneEl = el?.closest<HTMLElement>("[data-kanban-lane]");
    return {
      key: laneEl?.dataset.kanbanLane ?? null,
      scroller: laneEl?.querySelector<HTMLElement>("[data-kanban-scroller]") ?? null,
    };
  };

  const endDrag = useCallback((drop: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    dragRef.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey);
    if (d.active) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      const target = d.over;
      setDrag(null);
      setOverLane(null);
      if (drop && target && destinationsFor(d.record).includes(target)) void moveRecord(d.record, target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationsFor, moveRecord]);

  const tick = () => {
    const d = dragRef.current;
    if (!d || !d.active) return;
    const board = boardRef.current;
    if (board) {
      const r = board.getBoundingClientRect();
      if (d.x < r.left + EDGE) board.scrollLeft -= Math.ceil((r.left + EDGE - d.x) / 4);
      else if (d.x > r.right - EDGE) board.scrollLeft += Math.ceil((d.x - (r.right - EDGE)) / 4);
    }
    const { key, scroller } = laneAt(d.x, d.y);
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (d.y < r.top + EDGE) scroller.scrollTop -= Math.ceil((r.top + EDGE - d.y) / 4);
      else if (d.y > r.bottom - EDGE) scroller.scrollTop += Math.ceil((d.y - (r.bottom - EDGE)) / 4);
    }
    if (key !== d.over) {
      d.over = key;
      setOverLane(key);
    }
    d.raf = requestAnimationFrame(tick);
  };

  function onMove(e: PointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
      d.active = true;
      window.getSelection()?.removeAllRanges();
      setDrag({ record: d.record, width: d.width, allowed: new Set(destinationsFor(d.record)) });
      d.raf = requestAnimationFrame(tick);
    }
    e.preventDefault();
    if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${d.x - d.offX}px, ${d.y - d.offY}px, 0) rotate(1.5deg)`;
  }
  function onUp() {
    endDrag(true);
  }
  function onCancel() {
    endDrag(false);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") endDrag(false);
  }

  // Keep the exact handlers registered at gesture start. Layout/scroll renders
  // change callback identities but must never cancel an active gesture.
  const cancelGestureRef = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    cancelGestureRef.current?.();
    cancelGestureRef.current = null;
  }, [baseKey, lanesKey]);

  // Position ghost on first render after activation.
  useEffect(() => {
    const d = dragRef.current;
    if (drag && d && ghostRef.current) {
      ghostRef.current.style.transform = `translate3d(${d.x - d.offX}px, ${d.y - d.offY}px, 0) rotate(1.5deg)`;
    }
  }, [drag]);

  const onCardPointerDown = (e: React.PointerEvent<HTMLElement>, rec: EntityRecord, viaHandle: boolean) => {
    if (e.button !== 0 || dragRef.current || pendingRef.current.has(rec.id)) return;
    if (destinationsFor(rec).length === 0) return;
    if (e.pointerType !== "mouse" && !viaHandle) return; // touch: drag via grip so lanes still scroll
    const card = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-kanban-card]");
    if (!card) return;
    // Cancel native mouse selection at its start, not after the drag threshold:
    // otherwise dragging across text selects the card and neighbouring lanes.
    // Touch still scrolls normally outside the dedicated grip.
    if (e.pointerType === "mouse") e.preventDefault();
    const r = card.getBoundingClientRect();
    dragRef.current = {
      record: rec, startX: e.clientX, startY: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top,
      width: r.width, active: false, x: e.clientX, y: e.clientY, pointerId: e.pointerId, raf: 0, over: null,
    };
    cancelGestureRef.current = () => endDrag(false);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
  };

  // ---------- viewport-fitted board height ----------
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const vh = window.visualViewport?.height ?? window.innerHeight;
        setBoardHeight(fitBoardHeight(el.getBoundingClientRect().top, vh));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    if (el.parentElement) ro.observe(el.parentElement);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    // Enclosing scroll containers (app shell) move the board top.
    document.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, { capture: true } as EventListenerOptions);
    };
  }, []);

  const [boardClipped, setBoardClipped] = useState(false);
  useEffect(() => {
    const el = boardRef.current;
    if (!el || boardHeight == null) return;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    setBoardClipped(el.getBoundingClientRect().bottom > vh + 1);
  }, [boardHeight]);

  // ---------- detail modal ----------
  const [detail, setDetail] = useState<EntityRecord | null>(null);

  // ---------- render ----------
  const cardFieldRefs = config?.fields ?? [];

  const renderValue = (it: DisplayItem) => (
    <span dir={it.dir} className="min-w-0 text-start [overflow-wrap:anywhere]">
      {isEmptyValue(it.value) ? <span className="text-slate-300">—</span> : renderCellValue(it.field, it.value, t, userNames, undefined, ml)}
    </span>
  );

  const renderCard = (rec: EntityRecord, lane: KanbanLaneKey) => {
    const title = titleOf(rec);
    const pending = pendingIds.has(rec.id);
    const movable = destinationsFor(rec).length > 0;
    const dests = movable ? allowedStatuses(rec).filter((s) => s.id !== rec.statusId) : [];
    const dragging = drag?.record.id === rec.id;
    return (
      <div
        key={rec.id}
        data-kanban-card
        dir={dirFor(null)}
        data-testid={`card-kanban-${rec.id}`}
        onPointerDown={(e) => onCardPointerDown(e, rec, false)}
        className={`group relative rounded-lg border border-slate-200 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-[opacity,box-shadow] hover:shadow-md ${
          dragging ? "opacity-30" : ""
        } ${pending ? "opacity-70" : ""} ${movable ? "select-none cursor-grab active:cursor-grabbing" : ""}`}
      >
        <div className="flex items-start gap-1.5">
          {movable && (
            <span
              role="presentation"
              onPointerDown={(e) => {
                e.stopPropagation();
                onCardPointerDown(e, rec, true);
              }}
              className="-ms-1 mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
              data-testid={`handle-kanban-${rec.id}`}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (!suppressClick.current) setDetail(rec);
            }}
            className="min-w-0 flex-1 cursor-pointer text-start text-sm font-medium leading-snug text-slate-800 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 rounded"
            data-testid={`button-open-kanban-${rec.id}`}
          >
            <span dir={title.dir} className="block [overflow-wrap:anywhere]">{title.text}</span>
          </button>
          {pending && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={t("kanban.actions", "Действия")}
                className="shrink-0 rounded p-0.5 text-slate-400 opacity-70 hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 focus-visible:opacity-100"
                data-testid={`button-actions-kanban-${rec.id}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setDetail(rec)}>
                <Eye className="me-2 h-4 w-4" />
                {t("kanban.view", "Просмотр")}
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem onSelect={() => onEdit(rec)}>
                  <Pencil className="me-2 h-4 w-4" />
                  {t("kanban.edit", "Редактировать")}
                </DropdownMenuItem>
              )}
              {movable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-slate-500">
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    {t("kanban.moveTo", "Переместить в")}
                  </DropdownMenuLabel>
                  {dests.map((s) => (
                    <DropdownMenuItem key={s.id} disabled={pending} onSelect={() => void moveRecord(rec, laneKeyFor(s.id))}>
                      <span className="me-2 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      <CompactStatus name={ml(s.nameJson)} nameJson={s.nameJson} displayTags={s.displayTags} ml={ml} />
                    </DropdownMenuItem>
                  ))}
                  {allowNoStatus && rec.statusId != null && (
                    <DropdownMenuItem disabled={pending} onSelect={() => void moveRecord(rec, NULL_LANE)}>
                      <span className="me-2 h-2 w-2 shrink-0 rounded-full border border-slate-300" />
                      {t("kanban.noStatus", "Без статуса")}
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {canArchive && !rec.archivedAt && canArchive(rec) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={pending} onSelect={() => void doArchive(rec)}>
                    <Archive className="me-2 h-4 w-4" />
                    {t("kanban.archive", "В архив")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {cardFieldRefs.length > 0 && (
          <dl dir={dirFor(null)} className="mt-1.5 space-y-0.5 text-xs text-slate-600">
            {cardFieldRefs.map((ref) => {
              if (ref === STATUS_FIELD_REF) {
                const st = rec.statusId != null ? statusById.get(rec.statusId) : undefined;
                if (!st && config?.hideEmptyFields) return null;
                return (
                  <div key={ref} className="flex min-w-0 items-baseline gap-1">
                    {config?.showLabels && <dt className="shrink-0 font-medium text-slate-400">{t("kanban.statusLabel", "Статус")}:</dt>}
                    <dd className="min-w-0">
                      {st ? <CompactStatus name={ml(st.nameJson)} nameJson={st.nameJson} displayTags={st.displayTags} color={st.color} ml={ml} /> : <span className="text-slate-400">{t("kanban.noStatus", "Без статуса")}</span>}
                    </dd>
                  </div>
                );
              }
              const it = resolveItem(rec, ref);
              if (!it) return null;
              if (config?.hideEmptyFields && isEmptyValue(it.value)) return null;
              return (
                <div key={ref} dir={it.dir} className="flex min-w-0 items-baseline gap-1">
                  {config?.showLabels && <dt className="shrink-0 font-medium text-slate-400">{it.label}:</dt>}
                  <dd className="min-w-0">{renderValue(it)}</dd>
                </div>
              );
            })}
          </dl>
        )}
        {rec.archivedAt && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
            <Archive className="h-3 w-3" />
            {t("kanban.archivedBadge", "В архиве")}
          </span>
        )}
        {(
          <div className="mt-2 flex justify-end gap-1" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" title={t("kanban.view", "Просмотр")} aria-label={t("kanban.view", "Просмотр")}
              data-testid={`button-view-kanban-${rec.id}`}
              className="cursor-pointer rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-400"
              onClick={() => { if (!suppressClick.current) setDetail(rec); }}>
              <Eye className="h-4 w-4" />
            </button>
            {canEdit && (
              <button type="button" title={t("kanban.edit", "Редактировать")} aria-label={t("kanban.edit", "Редактировать")}
                data-testid={`button-edit-kanban-${rec.id}`} disabled={pending}
                className="cursor-pointer rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-default disabled:opacity-50"
                onClick={() => { if (!suppressClick.current) onEdit(rec); }}>
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        <span className="sr-only">{laneLabel(lane)}</span>
      </div>
    );
  };

  if (!config) {
    return <div className="p-8 text-center text-sm text-slate-500">{t("kanban.notConfigured", "Канбан не настроен")}</div>;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="kanban-view">
      <div className="flex items-center justify-end gap-2">
        {boardClipped && (
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => boardRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })} data-testid="button-kanban-fit">
            {t("kanban.showBoard", "Показать доску целиком")}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-slate-500" onClick={() => void reloadAll()} data-testid="button-kanban-refresh">
          <RotateCw className="h-3.5 w-3.5" />
          {t("kanban.refresh", "Обновить")}
        </Button>
      </div>
      {hydError && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800" data-testid="status-kanban-hydrate-error">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{hydError}</span>
          <Button type="button" variant="outline" size="sm" className="h-6 text-xs" onClick={() => setHydNonce((n) => n + 1)} data-testid="button-kanban-hydrate-retry">
            {t("kanban.retry", "Повторить")}
          </Button>
        </div>
      )}
      <div
        ref={boardRef}
        className="flex gap-3 overflow-x-scroll overflow-y-hidden pb-2 [scrollbar-gutter:stable]"
        style={{ height: boardHeight ?? "calc(100dvh - 230px)" }}
        data-testid="kanban-board"
        role="list"
      >
        {lanes.length === 0 && (
          <div className="flex w-full flex-col items-center justify-center gap-2 text-slate-400">
            <Inbox className="h-8 w-8 opacity-50" />
            <p className="text-sm">{t("kanban.noLanes", "Нет колонок для выбранных фильтров")}</p>
          </div>
        )}
        {lanes.map((lane) => {
          const s = laneState.get(lane) ?? emptyLane();
          const status = statusById.get(statusIdForLane(lane) ?? -1);
          const color = status?.color ?? "#94a3b8";
          const isTarget = drag ? drag.allowed.has(lane) : false;
          const isOver = overLane === lane;
          const lastPage = Math.max(1, Math.ceil(s.total / PAGE_SIZE));
          const from = s.total === 0 ? 0 : (s.page - 1) * PAGE_SIZE + 1;
          const to = Math.min(s.total, (s.page - 1) * PAGE_SIZE + s.records.length);
          return (
            <section
              key={lane}
              role="listitem"
              data-kanban-lane={lane}
              aria-label={laneLabel(lane)}
              data-testid={`lane-kanban-${lane}`}
              className={`flex h-full w-72 shrink-0 flex-col rounded-xl border bg-slate-50/80 transition-colors ${
                drag && isOver && isTarget ? "border-slate-500 bg-slate-100" : drag && isTarget ? "border-dashed border-slate-400" : "border-slate-200"
              } ${drag && !isTarget && drag.record.statusId !== statusIdForLane(lane) ? "opacity-60" : ""}`}
            >
              <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2" style={{ boxShadow: `inset 0 3px 0 ${color}` }}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">
                  {status ? <CompactStatus name={ml(status.nameJson)} nameJson={status.nameJson} displayTags={status.displayTags} ml={ml} /> : laneLabel(lane)}
                </span>
                <span className="rounded-full bg-white px-1.5 text-xs tabular-nums text-slate-500 ring-1 ring-slate-200" data-testid={`text-lane-count-${lane}`}>
                  {s.loading ? "…" : s.total}
                </span>
              </header>
              <div
                key={`${lane}:${s.page}`}
                data-kanban-scroller
                className="flex-1 space-y-2 overflow-y-auto p-2"
              >
                {s.loading ? (
                  Array.from({ length: 3 }, (_, i) => (
                    <div key={i} className="h-16 animate-pulse rounded-lg border border-slate-200 bg-white" />
                  ))
                ) : s.error ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                    <p>{s.error}</p>
                    <Button type="button" variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={() => void loadLane(lane)}>
                      {t("kanban.retry", "Повторить")}
                    </Button>
                  </div>
                ) : s.records.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-slate-400">{t("kanban.emptyLane", "Пусто")}</p>
                ) : (
                  s.records.map((r) => renderCard(r, lane))
                )}
              </div>
              {lastPage > 1 && (
                <footer className="flex items-center justify-between gap-1 border-t border-slate-200 px-2 py-1.5 text-[11px] tabular-nums text-slate-500">
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6 rtl:rotate-180" disabled={s.page <= 1 || s.loading} aria-label={t("kanban.prevPage", "Предыдущие")} onClick={() => { void loadLane(lane, s.page - 1); }} data-testid={`button-lane-prev-${lane}`}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span data-testid={`text-lane-range-${lane}`}>{from}–{to} {t("kanban.of", "из")} {s.total}</span>
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6 rtl:rotate-180" disabled={s.page >= lastPage || s.loading} aria-label={t("kanban.nextPage", "Следующие")} onClick={() => { void loadLane(lane, s.page + 1); }} data-testid={`button-lane-next-${lane}`}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </footer>
              )}
            </section>
          );
        })}
      </div>

      {drag && (
        <div
          ref={ghostRef}
          dir={dirFor(null)}
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 z-[100] rounded-lg border border-slate-300 bg-white p-2.5 text-sm font-medium text-slate-800 shadow-xl"
          style={{ width: drag.width, willChange: "transform" }}
        >
          <span dir={titleOf(drag.record).dir} className="block [overflow-wrap:anywhere]">{titleOf(drag.record).text}</span>
        </div>
      )}

      <KanbanDetailDialog
        record={detail}
        onClose={() => setDetail(null)}
        entityId={entityId}
        pageId={pageId}
        fields={fields}
        pageFields={pageFields}
        statusById={statusById}
        resolveItem={resolveItem}
        renderValue={renderValue}
        titleOf={titleOf}
        canEdit={canEdit}
        onEdit={(r) => {
          setDetail(null);
          onEdit(r);
        }}
        ml={ml}
      />
    </div>
  );
}

/** Read-only record detail: fresh record + all visible entity/page-local fields; no mutation controls. */
function KanbanDetailDialog({
  record, onClose, entityId, pageId, fields, pageFields, statusById, resolveItem, renderValue, titleOf, canEdit, onEdit, ml,
}: {
  record: EntityRecord | null;
  onClose: () => void;
  entityId: number;
  pageId?: number;
  fields: Field[];
  pageFields: PageField[];
  statusById: Map<number, StatusX>;
  resolveItem: (rec: EntityRecord, ref: string, h?: Hydration) => DisplayItem | null;
  renderValue: (it: DisplayItem) => React.ReactNode;
  titleOf: (rec: EntityRecord) => { text: string; dir?: "ltr" | "rtl" };
  canEdit: boolean;
  onEdit: (r: EntityRecord) => void;
  ml: MlFn;
}) {
  const t = useT();
  const [fresh, setFresh] = useState<EntityRecord | null>(null);
  const [hyd, setHyd] = useState<Hydration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const id = record?.id;

  useEffect(() => {
    setFresh(null);
    setHyd(null);
    setError(null);
    if (id == null) return;
    let cancelled = false;
    const need = {
      rel: fields.some((f) => isRelType(f.fieldType)),
      pv: !!pageId && pageFields.some((f) => !isRelType(f.fieldType)),
      prel: !!pageId && pageFields.some((f) => isRelType(f.fieldType)),
    };
    Promise.all([getRecord(id), fetchHydration(entityId, pageId, [id], need)])
      .then(([r, h]) => {
        if (cancelled) return;
        setFresh(r);
        setHyd(h);
      })
      .catch((err) => {
        if (!cancelled) setError(errMsg(err) ?? t("kanban.detailError", "Не удалось загрузить запись"));
      });
    return () => {
      cancelled = true;
    };
  }, [id, entityId, pageId, fields, pageFields, nonce, t]);

  const rec = fresh ?? record;
  const items = useMemo(() => {
    if (!rec || !hyd) return [];
    const refs = [
      ...[...fields].sort((a, b) => a.sortOrder - b.sortOrder).map((f) => f.fieldKey),
      ...[...pageFields].sort((a, b) => a.sortOrder - b.sortOrder).map((f) => `page:${f.fieldKey}`),
    ];
    return refs.map((r) => resolveItem(rec, r, hyd)).filter((x): x is DisplayItem => !!x);
  }, [rec, hyd, fields, pageFields, resolveItem]);

  const status = rec?.statusId != null ? statusById.get(rec.statusId) : undefined;
  const title = rec ? titleOf(rec) : null;
  const loading = !!record && !hyd && !error;

  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto" data-testid="dialog-kanban-detail">
        <DialogHeader>
          <DialogTitle dir={title?.dir} className="pe-6 [overflow-wrap:anywhere]">{title?.text}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 text-xs">
            <span>#{rec?.id}</span>
            {status ? (
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: status.color }} />
                <CompactStatus name={ml(status.nameJson)} nameJson={status.nameJson} displayTags={status.displayTags} ml={ml} />
              </span>
            ) : (
              <span>{t("kanban.noStatus", "Без статуса")}</span>
            )}
            {rec?.archivedAt && <span className="rounded bg-slate-100 px-1.5 py-0.5">{t("kanban.archivedBadge", "В архиве")}</span>}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" data-testid="status-kanban-detail-error">
            <p>{error}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={() => setNonce((n) => n + 1)} data-testid="button-kanban-detail-retry">
              {t("kanban.retry", "Повторить")}
            </Button>
          </div>
        ) : loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-[minmax(120px,auto)_1fr]">
            {items.map((it) => (
              <div key={it.key} className="contents">
                <dt className="text-xs font-medium text-slate-500 sm:pt-0.5">{it.label}</dt>
                <dd className="min-w-0 text-sm text-slate-800" data-testid={`text-detail-${it.key}`}>{renderValue(it)}</dd>
              </div>
            ))}
          </dl>
        )}
        {canEdit && rec && !error && (
          <div className="flex justify-end border-t border-slate-100 pt-3">
            <Button type="button" size="sm" disabled={loading} onClick={() => onEdit(rec)} data-testid="button-kanban-detail-edit">
              <Pencil className="me-1.5 h-3.5 w-3.5" />
              {t("kanban.edit", "Редактировать")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default KanbanView;
