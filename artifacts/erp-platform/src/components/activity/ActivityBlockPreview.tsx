import { CalendarClock, MessagesSquare } from "lucide-react";
import { KindMarker, useActivityLabels } from "./activityShared";

/** Static stand-in for the activity panel used by the card builder canvas and
 * the preview dialog (no API calls: the preview has no real record). */
export function ActivityBlockPreview({ compact }: { compact?: boolean }) {
  const { t, kind } = useActivityLabels();
  if (compact) {
    return (
      <div className="mt-1 flex items-center gap-1.5" aria-hidden data-testid="activity-block-mini">
        {["call", "email", "meeting", "note"].map(k => <KindMarker key={k} kind={k} className="h-5 w-5" />)}
        <span className="ms-1 truncate text-xs text-slate-400">{t("activity.previewMini", "лента, следующие шаги, задачи")}</span>
      </div>
    );
  }
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/40 p-3" data-testid="activity-block-preview" aria-label={t("activity.title", "Работа с клиентом")}>
      <header className="flex items-center gap-2">
        <MessagesSquare className="h-4 w-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-800">{t("activity.title", "Работа с клиентом")}</span>
        <span className="ms-auto text-[11px] text-slate-400">{t("activity.previewNote", "Пример. В записи будут реальные данные.")}</span>
      </header>
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5">
        <KindMarker kind="call" />
        <div className="min-w-0 flex-1 space-y-1"><div className="h-2.5 w-2/3 rounded bg-slate-200" /><div className="h-2 w-1/3 rounded bg-slate-100" /></div>
        <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 ring-1 ring-amber-200"><CalendarClock className="h-3 w-3" />{t("activity.filter.today", "Сегодня")}</span>
      </div>
      <div className="space-y-2.5 ps-1">
        {(["meeting", "email"] as const).map((k, i) => (
          <div key={k} className="flex gap-3">
            <KindMarker kind={k} />
            <div className="min-w-0 flex-1 space-y-1 pt-1">
              <div className="text-xs font-semibold text-slate-700">{kind(k)}</div>
              <div className="h-2 rounded bg-slate-200" style={{ width: i ? "55%" : "80%" }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
