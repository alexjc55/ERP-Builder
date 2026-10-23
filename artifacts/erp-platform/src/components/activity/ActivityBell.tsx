import { Link } from "wouter";
import { Bell } from "lucide-react";
import { useListActivityNotifications, getListActivityNotificationsQueryKey } from "@workspace/api-client-react";
import { useT } from "@/lib/i18n";

/** Shared query with the inbox; a dot indicates unread items in the latest page,
 * not an inaccurate total of the entire notification archive. */
export function ActivityBell() {
  const t = useT();
  const query = useListActivityNotifications({}, { query: {
    queryKey: getListActivityNotificationsQueryKey({}),
    refetchInterval: 60_000, refetchIntervalInBackground: false,
  } });
  const unread = query.data?.items?.some(item => !item.readAt);
  return (
    <Link href="/my-tasks" title={t("activity.inbox", "Входящие")}
      aria-label={t("activity.inbox", "Входящие")}
      data-testid="activity-notification-bell"
      className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-500/10 hover:text-blue-500">
      <Bell className="h-4 w-4" />
      {unread && <span className="absolute end-1 top-1 h-2 w-2 rounded-full bg-blue-500" data-testid="activity-unread-dot" />}
    </Link>
  );
}
