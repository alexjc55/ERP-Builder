import { useEffect, useState } from "react";
import { ACTIVITY_REFRESH_MS } from "@/lib/activity";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListActivityNotifications, getListActivityNotificationsQueryKey, listActivityNotifications, readActivityNotification,
  type ActivityNotification,
} from "@workspace/api-client-react";
import { Bell, CheckCheck, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiErrorMessage, recordHref } from "@/lib/activity";
import { invalidateActivity, useActivityLabels } from "./activityShared";

/** Personal internal inbox (automation notifications and task reminders). */
export function NotificationInbox() {
  const L = useActivityLabels();
  const { t } = L;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const q = useListActivityNotifications({}, { query: { queryKey: getListActivityNotificationsQueryKey({}), refetchInterval: ACTIVITY_REFRESH_MS, refetchIntervalInBackground: false } });
  const [more, setMore] = useState<ActivityNotification[]>([]);
  const [offset, setOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const head = q.data?.items ?? [];
  const headKey = head.map(n => `${n.id}:${n.readAt ?? ""}`).join(",");
  useEffect(() => { setMore([]); setOffset(q.data?.nextOffset ?? null); }, [headKey, q.data?.nextOffset]);
  const items = [...head, ...more.filter(m => !head.some(h => h.id === m.id))];
  const unread = items.filter(n => !n.readAt).length;

  const markRead = async (n: ActivityNotification) => {
    if (n.readAt) return;
    setBusyId(n.id);
    try {
      await readActivityNotification(n.id);
      setMore(prev => prev.map(x => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x));
    } catch (e) {
      toast({ variant: "destructive", title: t("activity.err.read", "Не удалось отметить"), description: apiErrorMessage(e) });
    } finally { setBusyId(null); void invalidateActivity(qc); }
  };
  const openRecord = async (n: ActivityNotification) => {
    const href = recordHref(n.recordUrl);
    await markRead(n);
    if (href) navigate(href);
  };
  const loadMore = async () => {
    if (offset == null) return;
    setLoadingMore(true);
    try {
      const page = await listActivityNotifications({ offset });
      setMore(prev => [...prev, ...page.items]);
      setOffset(page.nextOffset);
    } catch (e) {
      toast({ variant: "destructive", title: t("activity.err.load", "Не удалось загрузить."), description: apiErrorMessage(e) });
    } finally { setLoadingMore(false); }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="notification-inbox">
      <header className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
        <Bell className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-800">{t("activity.inbox", "Входящие")}</h2>
        {unread > 0 && <span className="rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold tabular-nums text-white" data-testid="text-unread-count">{unread}</span>}
      </header>
      {q.isLoading ? (
        <div className="space-y-2 p-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : q.isError ? (
        <div role="alert" className="p-4 text-sm text-red-700">
          {t("activity.err.inbox", "Не удалось загрузить входящие.")}{" "}
          <button type="button" className="underline" onClick={() => void q.refetch()} data-testid="button-inbox-retry">{t("common.retry", "Повторить")}</button>
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-10 text-center" data-testid="inbox-empty">
          <CheckCheck className="mx-auto mb-2 h-6 w-6 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">{t("activity.inboxEmpty", "Новых уведомлений нет")}</p>
          <p className="mt-1 text-xs text-slate-400">{t("activity.inboxEmptyDesc", "Сюда приходят напоминания о задачах и сообщения автоматизаций.")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map(n => (
            <li key={n.id} data-testid={`notification-${n.id}`} className={cn("relative flex gap-3 px-4 py-3", !n.readAt && "bg-blue-50/40")}>
              {!n.readAt && <span className="absolute start-1.5 top-4 h-1.5 w-1.5 rounded-full bg-blue-600" aria-label={t("activity.unread", "Не прочитано")} />}
              <div className="min-w-0 flex-1">
                <p className={cn("whitespace-pre-wrap break-words text-sm", n.readAt ? "text-slate-600" : "font-medium text-slate-900")} dir="auto">{n.message}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  <time className="tabular-nums" dateTime={n.createdAt}>{L.dateTime(n.createdAt)}</time>
                  <span className="text-slate-300">·</span>
                  {recordHref(n.recordUrl) ? (
                    <button type="button" onClick={() => void openRecord(n)} className="inline-flex min-w-0 items-center gap-1 font-medium text-blue-700 hover:underline" data-testid={`link-notification-record-${n.id}`}>
                      <ExternalLink className="h-3 w-3 shrink-0" /><span className="truncate">{n.recordLabel}</span>
                    </button>
                  ) : <span className="truncate">{n.recordLabel}</span>}
                </div>
              </div>
              {!n.readAt && (
                <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" disabled={busyId === n.id} onClick={() => void markRead(n)} data-testid={`button-notification-read-${n.id}`}>
                  {busyId === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("activity.markRead", "Прочитано")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {offset != null && (
        <div className="border-t border-slate-100 p-2 text-center">
          <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore} data-testid="button-inbox-more">
            {loadingMore && <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />}{t("activity.loadMore", "Показать ещё")}
          </Button>
        </div>
      )}
    </section>
  );
}
