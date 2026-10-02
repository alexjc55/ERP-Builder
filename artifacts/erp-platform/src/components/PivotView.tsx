import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  usePivotEntityRecords,
  useGetSettings,
  type PivotQuery,
  type PivotResult,
  type PivotConfig,
  type PivotDimension,
  type PivotMeasure,
  type Field,
  type PageField,
} from "@workspace/api-client-react";
import { useLang, useML, useT } from "@/lib/i18n";
import { Loader2, TableProperties } from "lucide-react";
import { AffixedNumericValue } from "@/components/AffixedNumericValue";
import { useManualDataRefresh } from "@/lib/manualDataRefresh";
import { resolveDataDirection, type DataDirection } from "@/lib/dataDirection";

/** Only metadata the records page already has permission to read is passed in. */
type PivotDirectionProps = {
  pageTextDirection?: DataDirection | null;
  fields?: readonly Pick<Field, "fieldKey" | "textDirection">[];
  pageFields?: readonly Pick<PageField, "fieldKey" | "textDirection">[];
};

// Structural compatibility until the owning agent regenerates the API client.
type DirectedPivotResult = PivotResult & {
  textDirections?: {
    row?: DataDirection | null;
    column?: DataDirection | null;
    rowLanguageDriven?: boolean;
    columnLanguageDriven?: boolean;
    columnIsMeasure?: boolean;
    measures?: { measureKey: string | null; textDirection: DataDirection | null }[];
  };
};

/**
 * Cross-tab (Сводная таблица) renderer for an entity's records. Receives a fully
 * assembled {@link PivotQuery} (the same filter/search/status/archive state that
 * drives the records table, plus the pivot config) and posts it to the
 * permission-scoped pivot endpoint, then renders rows × cols with row/column and
 * grand totals. All aggregation happens server-side under the viewer's read
 * boundary; this component is display-only.
 */
export function PivotView({
  entityId,
  query,
  refreshTick = 0,
  pageTextDirection,
  fields,
  pageFields,
}: {
  entityId: number;
  query: PivotQuery;
  refreshTick?: number;
} & PivotDirectionProps) {
  const t = useT();
  const pivotMutation = usePivotEntityRecords();
  const run = pivotMutation.mutateAsync;
  const [result, setResult] = useState<PivotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Serialize the query so the effect only re-fires on real changes (the object
  // identity changes every render). refreshTick lets the parent force a refetch.
  const queryKey = useMemo(() => JSON.stringify(query), [query]);
  const reqIdRef = useRef(0);
  const effectRequestIdRef = useRef(0);
  const skipNextRefreshTickRef = useRef(false);
  useEffect(
    () => () => {
      reqIdRef.current += 1;
    },
    [],
  );

  const loadPivot = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await run({ entityId, data: query });
      if (reqId !== reqIdRef.current) return;
      setResult(res);
    } catch (err: unknown) {
      if (reqId !== reqIdRef.current) return;
      const msg =
        err && typeof err === "object" && "data" in err
          ? ((err as { data?: { error?: string } }).data?.error ?? null)
          : null;
      setError(msg ?? t("pivot.error", "Не удалось построить сводную таблицу"));
      setResult(null);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [entityId, queryKey, run, t]);

  useManualDataRefresh(async () => {
    skipNextRefreshTickRef.current = true;
    await loadPivot();
  });

  useEffect(() => {
    if (skipNextRefreshTickRef.current) {
      skipNextRefreshTickRef.current = false;
      return;
    }
    void loadPivot();
    effectRequestIdRef.current = reqIdRef.current;
    return () => {
      // Do not cancel a manual-refresh request that began after this effect's
      // request; the mutation cannot be aborted, so stale effect responses are
      // instead made a no-op by invalidating their own token.
      if (reqIdRef.current === effectRequestIdRef.current) reqIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, queryKey, refreshTick]);

  const fmt = (v: number): string => {
    if (!Number.isFinite(v)) return "";
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v);
  };

  if (loading && !result) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("pivot.loading", "Строим сводную…")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (!result || result.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
        <TableProperties className="w-8 h-8 opacity-50" />
        <p className="text-sm">{t("pivot.empty", "Нет данных для сводной таблицы")}</p>
      </div>
    );
  }

  return <PivotResultTable result={result} loading={loading} pivot={query.pivot} fields={fields} pageFields={pageFields} pageTextDirection={pageTextDirection} />;
}

/**
 * Presentational cross-tab table for a fully-computed {@link PivotResult}. Shared
 * by {@link PivotView} (records page, permission-scoped fetch) and the dashboard
 * pivot widget (admin-authoritative result shipped with the widget data). Pure
 * render: no fetching, no permission logic.
 */
export function PivotResultTable({
  result,
  loading = false,
  pivot,
  pageTextDirection,
  fields = [],
  pageFields = [],
}: {
  result: DirectedPivotResult;
  loading?: boolean;
  pivot?: PivotConfig;
} & PivotDirectionProps) {
  const t = useT();
  const ml = useML();
  const { lang } = useLang();
  const { data: settings } = useGetSettings();
  const inheritedDirection = resolveDataDirection(null, pageTextDirection, settings?.textDirection, lang);
  const sourceDirection = (source: "entity" | "page", fieldKey?: string | null) => {
    const metadata = source === "page" ? pageFields : fields;
    return resolveDataDirection(metadata.find((field) => field.fieldKey === fieldKey)?.textDirection, pageTextDirection, settings?.textDirection, lang);
  };
  // Status dimensions are language-driven, never field/page/app overrides.
  const dimensionDirection = (dimension?: PivotDimension) =>
    dimension?.source === "status" || dimension?.source === "statusTag"
      ? resolveDataDirection(null, null, null, lang)
      : dimension ? sourceDirection(dimension.source, dimension.fieldKey) : inheritedDirection;
  const measureDirection = (measure?: PivotMeasure, columnKey?: string) => {
    const override = result.textDirections?.measures?.find((item) =>
      item.measureKey === (result.multiMeasure ? columnKey : null))?.textDirection;
    return override != null
      ? resolveDataDirection(override, pageTextDirection, settings?.textDirection, lang)
      : measure?.agg === "sum" ? sourceDirection(measure.source ?? "entity", measure.fieldKey) : inheritedDirection;
  };
  const rowDirection = result.textDirections?.rowLanguageDriven
    ? resolveDataDirection(null, null, null, lang)
    : result.textDirections?.row != null
      ? resolveDataDirection(result.textDirections.row, pageTextDirection, settings?.textDirection, lang)
      : dimensionDirection(pivot?.rows);
  const columnHeaderDirection = result.textDirections?.columnLanguageDriven
    ? resolveDataDirection(null, null, null, lang)
    : result.textDirections?.column != null
      ? resolveDataDirection(result.textDirections.column, pageTextDirection, settings?.textDirection, lang)
      : dimensionDirection(pivot?.cols);
  const columnMeasure = (columnKey?: string) =>
    pivot?.measures?.find((measure) => measure.key === columnKey) ?? pivot?.measure;
  const content = (children: ReactNode, direction = inheritedDirection) => (
    <div dir={direction} style={{ textAlign: "start" }}>{children}</div>
  );
  const striped = settings?.tableStyle === "striped" || settings?.tableStyle === "striped_bold";
  const boldHeader = settings?.tableStyle === "striped_bold";
  const headerBg = settings?.tableHeaderColor ?? (boldHeader ? "#e2e8f0" : "#f8fafc");
  const fmt = (v: number): string => {
    if (!Number.isFinite(v)) return "";
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v);
  };

  // Sparse cells → quick lookup keyed by "rowKey\u0000colKey".
  const cellMap = new Map<string, number>();
  for (const c of result.cells) cellMap.set(c.rowKey + "\u0000" + c.colKey, c.value);
  const rowTotal = new Map(result.rowTotals.map((r) => [r.key, r.value]));
  const colTotal = new Map(result.colTotals.map((c) => [c.key, c.value]));
  // Multi-measure pivots have heterogeneous columns, so a per-row total and a
  // grand total are meaningless — the server omits them and we hide the column.
  const showRowTotal = !result.multiMeasure;
  const affixByMeasureKey = new Map(
    (result.measureDisplayAffixes ?? [])
      .filter((item) => item.measureKey != null)
      .map((item) => [item.measureKey as string, item]),
  );
  const singleAffix = (result.measureDisplayAffixes ?? []).find((item) => item.measureKey == null);
  const withAffix = (value: number, columnKey?: string) => (
    <div dir={measureDirection(columnMeasure(columnKey), columnKey)} style={{ textAlign: "start" }}>
      <AffixedNumericValue config={columnKey ? affixByMeasureKey?.get(columnKey) ?? singleAffix : singleAffix}>
        {fmt(value)}
      </AffixedNumericValue>
    </div>
  );

  return (
    <div className="relative overflow-auto bg-white pb-3">
      {loading && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded bg-white/90 px-2 py-1 text-xs text-slate-500 shadow-sm">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t("pivot.updating", "Обновление…")}
        </div>
      )}
      <table className="w-full text-sm" style={settings?.tableBorderColor ? { "--erp-table-border": settings.tableBorderColor } as CSSProperties : undefined}>
        <thead className="sticky top-0 z-20">
          <tr className="bg-slate-50" data-testid="pivot-column-totals">
            <th scope="row" className="sticky start-0 z-[1] bg-slate-50 px-4 py-2 text-start font-medium text-slate-500">
              {content(t("pivot.colTotal", "Итого"))}
            </th>
            {result.cols.map((c) => (
              <td key={c.key} className="bg-[#d1fae5] px-4 py-2 text-start font-bold whitespace-nowrap tabular-nums text-[#047857]">
                {withAffix(colTotal.get(c.key) ?? 0, c.key)}
              </td>
            ))}
            {showRowTotal && (
              <td className="bg-[#d1fae5] px-4 py-2 text-start font-bold whitespace-nowrap tabular-nums text-[#047857]">
                {withAffix(result.grandTotal)}
              </td>
            )}
          </tr>
          <tr className={`erp-main-header border-b text-xs leading-snug ${boldHeader ? "font-semibold border-b-2 border-slate-300 text-slate-800" : "border-slate-100"}`} style={{ backgroundColor: headerBg }}>
            <th scope="col" style={{ backgroundColor: headerBg }} className="sticky start-0 z-[1] px-4 py-3 text-center font-medium text-slate-600">
              {content(ml(result.rowLabelJson) || t("pivot.rowDimension", "Группировка"), rowDirection)}
            </th>
            {result.cols.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="px-4 py-3 text-center font-medium text-slate-600"
              >
                {content(c.label, result.multiMeasure || result.textDirections?.columnIsMeasure || (pivot && !pivot.cols) ? measureDirection(columnMeasure(c.key), c.key) : columnHeaderDirection)}
              </th>
            ))}
            {showRowTotal && (
              <th scope="col" className="px-4 py-3 text-center font-medium text-slate-600">
                {content(t("pivot.rowTotal", "Итого"))}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, index) => (
            <tr key={r.key} className="group border-b border-slate-100 hover:bg-slate-50/50" style={{ backgroundColor: striped && index % 2 === 1 ? settings?.tableStripeColor ?? "#f8fafc" : "#ffffff" }}>
              <th scope="row" style={{ backgroundColor: "inherit" }} className="sticky start-0 z-[1] px-4 py-3 text-start font-normal text-slate-700">
                {content(r.label, rowDirection)}
              </th>
              {result.cols.map((c) => {
                const v = cellMap.get(r.key + "\u0000" + c.key);
                return (
                  <td
                    key={c.key}
                    className="px-4 py-3 text-start tabular-nums text-slate-700"
                  >
                    {v == null || v === 0 ? content(<span className="text-slate-300">—</span>, measureDirection(columnMeasure(c.key), c.key)) : withAffix(v, c.key)}
                  </td>
                );
              })}
              {showRowTotal && (
                <td className="px-4 py-3 text-start font-semibold tabular-nums text-slate-700">
                  {withAffix(rowTotal.get(r.key) ?? 0)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
