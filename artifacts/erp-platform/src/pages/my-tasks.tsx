import { useEffect, useState } from "react";
import { ACTIVITY_REFRESH_MS } from "@/lib/activity";
import { useListActivityTasks, getListActivityTasksQueryKey, listActivityTasks, type ActivityTask } from "@workspace/api-client-react";
import { ClipboardList, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TASK_FILTERS, apiErrorMessage, type TaskFilter } from "@/lib/activity";
import { useActivityLabels } from "@/components/activity/activityShared";
import { TaskRow } from "@/components/activity/TaskRow";
import { NotificationInbox } from "@/components/activity/NotificationInbox";

/** Personal workspace: own tasks across all records + internal inbox. */
export default function MyTasksPage() {
  const L = useActivityLabels();
  const { t } = L;
  const [filter, setFilter] = useState<TaskFilter>("open");
  const params = { filter };
  const q = useListActivityTasks(params, { query: { queryKey: getListActivityTasksQueryKey(params), refetchInterval: ACTIVITY_REFRESH_MS, refetchIntervalInBackground: false } });
  const [more, setMore] = useState<ActivityTask[]>([]);
  const [offset, setOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreErr, setMoreErr] = useState<string | null>(null);
  const head = q.data?.items ?? [];
  const headKey = head.map(x => `${x.id}:${x.version}`).join(",");
  useEffect(() => { setMore([]); setMoreErr(null); setOffset(q.data?.nextOffset ?? null); }, [headKey, q.data?.nextOffset, filter]);
  const items = [...head, ...more.filter(m => !head.some(h => h.id === m.id))];

  const loadMore = async () => {
    if (offset == null) return;
    setLoadingMore(true); setMoreErr(null);
    try {
      const page = await listActivityTasks({ filter, offset });
      setMore(prev => [...prev, ...page.items]);
      setOffset(page.nextOffset);
    } catch (e) { setMoreErr(apiErrorMessage(e)); } finally { setLoadingMore(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6" data-testid="page-my-tasks">
      <div>
        <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-blue-600">
          <ClipboardList className="h-3.5 w-3.5" />{t("activity.myKicker", "Личное")}
        </div>
        <h1 className="text-2xl font-bold text-slate-900">{t("activity.myTitle", "Мои задачи")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">{t("activity.mySubtitle", "Звонки, письма и встречи, назначенные вам по всем записям. Отметки выполнения сразу попадают в историю записи.")}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-3">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist">
            {TASK_FILTERS.map(f => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} data-testid={`tab-task-filter-${f}`}
                className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  filter === f ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                  f === "overdue" && filter !== f && "text-red-700")}>
                {L.filter(f)}
              </button>
            ))}
          </div>
          {q.isLoading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
          ) : q.isError ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {t("activity.err.tasks", "Не удалось загрузить задачи.")} {apiErrorMessage(q.error)}{" "}
              <button type="button" className="underline" onClick={() => void q.refetch()} data-testid="button-tasks-retry">{t("common.retry", "Повторить")}</button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center" data-testid="tasks-empty">
              <div className="mb-4 space-y-1.5 opacity-70">{[64, 96, 48].map((w, i) => <div key={i} className="h-2 rounded bg-slate-200" style={{ width: w }} />)}</div>
              <p className="font-semibold text-slate-800">{filter === "overdue" ? t("activity.emptyOverdue", "Просроченных задач нет") : t("activity.emptyTasks", "Здесь пусто")}</p>
              <p className="mt-1 max-w-sm text-sm text-slate-500">{t("activity.emptyTasksDesc", "Задачи появляются, когда вы или коллеги планируете следующий шаг в карточке записи.")}</p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="list-my-tasks">
              {items.map(task => <TaskRow key={task.id} task={task} showRecord />)}
              {offset != null && (
                <div className="flex flex-col items-center gap-1 pt-1">
                  <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore} data-testid="button-tasks-more">
                    {loadingMore && <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />}{t("activity.loadMore", "Показать ещё")}
                  </Button>
                  {moreErr && <p className="text-xs text-red-600">{moreErr}</p>}
                </div>
              )}
            </div>
          )}
        </section>
        <aside className="min-w-0"><NotificationInbox /></aside>
      </div>
    </div>
  );
}
