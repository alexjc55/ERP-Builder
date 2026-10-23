import { useState } from "react";
import { ACTIVITY_REFRESH_MS } from "@/lib/activity";
import {
  useListRecordActivity, getListRecordActivityQueryKey, useListActivityTasks, getListActivityTasksQueryKey,
} from "@workspace/api-client-react";
import { CalendarPlus, Lock, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorMessage } from "@/lib/activity";
import { useActivityLabels } from "./activityShared";
import { ActivityComposer, NewTaskForm } from "./ActivityComposer";
import { ActivityFeed } from "./ActivityFeed";
import { TaskRow } from "./TaskRow";

/**
 * Record activity panel: next steps (open tasks), composer and timeline.
 * Renders nothing when activity is disabled for the entity (server flag), so
 * it is safe to mount on every record card. `recordId == null` (create mode)
 * shows the saved-record requirement instead.
 */
export function ActivityPanel({ entityId, recordId, pageId, variant = "standalone" }: {
  entityId: number;
  recordId: number | null;
  pageId?: number | null;
  /** "block" = placed explicitly by a card template (always shows its frame). */
  variant?: "standalone" | "block";
}) {
  const { t } = useActivityLabels();
  if (recordId == null) {
    if (variant !== "block") return null;
    return (
      <section className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-4 text-sm text-slate-500" data-testid="activity-save-first">
        <Lock className="h-4 w-4 shrink-0 text-slate-400" />
        {t("activity.saveFirst", "Звонки, договорённости и задачи станут доступны после сохранения записи.")}
      </section>
    );
  }
  return <ActivityPanelBody entityId={entityId} recordId={recordId} pageId={pageId ?? null} variant={variant} />;
}

function ActivityPanelBody({ entityId, recordId, pageId, variant }: { entityId: number; recordId: number; pageId: number | null; variant: "standalone" | "block" }) {
  const L = useActivityLabels();
  const { t } = L;
  const ctx = { entityId, recordId, pageId };
  const feedParams = { entityId, recordId, ...(pageId != null ? { pageId } : {}) };
  const feed = useListRecordActivity(feedParams, { query: { queryKey: getListRecordActivityQueryKey(feedParams), refetchOnMount: "always", refetchInterval: ACTIVITY_REFRESH_MS, refetchIntervalInBackground: false } });
  const enabled = feed.data?.enabled === true;
  const taskParams = { entityId, recordId, ...(pageId != null ? { pageId } : {}), filter: "open" as const };
  const tasks = useListActivityTasks(taskParams, { query: { enabled, queryKey: getListActivityTasksQueryKey(taskParams), refetchOnMount: "always", refetchInterval: ACTIVITY_REFRESH_MS, refetchIntervalInBackground: false } });
  const [planning, setPlanning] = useState(false);

  if (feed.isLoading) {
    return (
      <section className="space-y-3 rounded-lg border border-slate-200 p-4" data-testid="activity-loading">
        <Skeleton className="h-4 w-40" /><Skeleton className="h-20 w-full" /><Skeleton className="h-12 w-full" />
      </section>
    );
  }
  if (feed.isError) {
    return (
      <section role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" data-testid="activity-error">
        <p>{t("activity.err.feed", "Не удалось загрузить историю работы с записью.")}</p>
        <p className="break-words text-xs text-red-500">{apiErrorMessage(feed.error)}</p>
        <button type="button" onClick={() => void feed.refetch()} className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-red-100" data-testid="button-activity-retry">
          {t("common.retry", "Повторить")}
        </button>
      </section>
    );
  }
  if (!enabled) {
    return variant === "block" ? (
      <section className="rounded-lg border border-dashed border-slate-200 p-4 text-xs text-slate-400" data-testid="activity-disabled">
        {t("activity.disabled", "Работа с клиентом для этой сущности выключена администратором.")}
      </section>
    ) : null;
  }
  const data = feed.data!;
  const open = tasks.data?.items ?? [];
  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-slate-50/40 p-3 sm:p-4" data-testid="activity-panel">
      <header className="flex flex-wrap items-center gap-2">
        <MessagesSquare className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{t("activity.title", "Работа с клиентом")}</h3>
        {open.length > 0 && <span className="rounded-full bg-slate-800 px-1.5 text-[11px] font-semibold tabular-nums text-white" data-testid="text-open-task-count">{open.length}</span>}
        {data.canWrite && !planning && (
          <Button size="sm" variant="outline" className="ms-auto h-7 text-xs" onClick={() => setPlanning(true)} data-testid="button-plan-task">
            <CalendarPlus className="me-1 h-3.5 w-3.5" />{t("activity.task.new", "Новая задача")}
          </Button>
        )}
      </header>

      <div className="space-y-2" data-testid="activity-next-steps">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("activity.nextSteps", "Следующие шаги")}</p>
        {planning && <NewTaskForm ctx={ctx} onDone={() => setPlanning(false)} />}
        {tasks.isLoading ? <Skeleton className="h-14 w-full" /> : tasks.isError ? (
          <p className="text-xs text-red-600">{t("activity.err.tasks", "Не удалось загрузить задачи.")}{" "}
            <button type="button" className="underline" onClick={() => void tasks.refetch()}>{t("common.retry", "Повторить")}</button></p>
        ) : open.length === 0 ? (
          !planning && <p className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800" data-testid="text-no-next-step">
            {t("activity.noNextStep", "Следующий шаг не запланирован. Без него клиент легко теряется.")}
          </p>
        ) : (
          <div className="space-y-2">{open.map(task => <TaskRow key={task.id} task={task} pageId={pageId} />)}</div>
        )}
      </div>

      {data.canWrite ? <ActivityComposer ctx={ctx} /> : (
        <p className="flex items-center gap-2 text-xs text-slate-500" data-testid="text-activity-readonly"><Lock className="h-3.5 w-3.5" />{t("activity.readOnly", "Только просмотр: добавлять записи может пользователь с правом изменения записи.")}</p>
      )}

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t("activity.history", "История")}</p>
        <ActivityFeed ctx={ctx} items={data.items} nextBeforeId={data.nextBeforeId} />
      </div>
    </section>
  );
}
