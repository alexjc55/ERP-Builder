import { useEffect, useMemo, useRef, useState } from "react";
import {
  usePivotEntityRecords,
  type PivotQuery,
  type PivotResult,
} from "@workspace/api-client-react";
import { useT } from "@/lib/i18n";
import { Loader2, TableProperties } from "lucide-react";

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
}: {
  entityId: number;
  query: PivotQuery;
  refreshTick?: number;
}) {
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

  useEffect(() => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    run({ entityId, data: query })
      .then((res) => {
        if (reqId !== reqIdRef.current) return; // a newer request superseded this one
        setResult(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (reqId !== reqIdRef.current) return;
        const msg =
          err && typeof err === "object" && "data" in err
            ? ((err as { data?: { error?: string } }).data?.error ?? null)
            : null;
        setError(msg ?? t("pivot.error", "Не удалось построить сводную таблицу"));
        setResult(null);
        setLoading(false);
      });
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

  // Sparse cells → quick lookup keyed by "rowKey\u0000colKey".
  const cellMap = new Map<string, number>();
  for (const c of result.cells) cellMap.set(c.rowKey + "\u0000" + c.colKey, c.value);
  const rowTotal = new Map(result.rowTotals.map((r) => [r.key, r.value]));
  const colTotal = new Map(result.colTotals.map((c) => [c.key, c.value]));
  const hasCols = result.cols.length > 1 || (result.cols[0]?.key ?? "") !== "__all__";

  return (
    <div className="relative overflow-auto rounded-lg border border-slate-200">
      {loading && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded bg-white/90 px-2 py-1 text-xs text-slate-500 shadow-sm">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t("pivot.updating", "Обновление…")}
        </div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="sticky left-0 z-[1] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600">
              {hasCols ? "" : result.measureLabel}
            </th>
            {result.cols.map((c) => (
              <th
                key={c.key}
                className="border-b border-l border-slate-200 px-3 py-2 text-right font-semibold text-slate-600"
              >
                {c.label}
              </th>
            ))}
            <th className="border-b border-l-2 border-slate-300 bg-slate-100 px-3 py-2 text-right font-semibold text-slate-700">
              {t("pivot.rowTotal", "Итого")}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.key} className="even:bg-slate-50/40 hover:bg-blue-50/40">
              <th className="sticky left-0 z-[1] border-r border-slate-200 bg-white px-3 py-2 text-left font-medium text-slate-700">
                {r.label}
              </th>
              {result.cols.map((c) => {
                const v = cellMap.get(r.key + "\u0000" + c.key);
                return (
                  <td
                    key={c.key}
                    className="border-l border-slate-100 px-3 py-2 text-right tabular-nums text-slate-700"
                  >
                    {v == null || v === 0 ? <span className="text-slate-300">—</span> : fmt(v)}
                  </td>
                );
              })}
              <td className="border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-right font-semibold tabular-nums text-slate-800">
                {fmt(rowTotal.get(r.key) ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-100">
            <th className="sticky left-0 z-[1] border-r border-slate-200 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-700">
              {t("pivot.colTotal", "Итого")}
            </th>
            {result.cols.map((c) => (
              <td
                key={c.key}
                className="border-l border-slate-200 px-3 py-2 text-right font-semibold tabular-nums text-slate-800"
              >
                {fmt(colTotal.get(c.key) ?? 0)}
              </td>
            ))}
            <td className="border-l-2 border-slate-300 bg-slate-200 px-3 py-2 text-right font-bold tabular-nums text-slate-900">
              {fmt(result.grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
