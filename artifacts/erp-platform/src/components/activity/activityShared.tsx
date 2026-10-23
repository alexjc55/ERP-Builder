import { useCallback } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { Mail, MessageSquareText, Phone, Users, ListChecks, type LucideIcon } from "lucide-react";
import { useLang, useT } from "@/lib/i18n";
import type { EntryKind, Outcome, TaskFilter, TaskKind } from "@/lib/activity";

/** Invalidate every activity / task / notification query (feeds, lists, inbox). */
export function invalidateActivity(qc: QueryClient) {
  return qc.invalidateQueries({
    predicate: q => {
      const k = q.queryKey[0];
      return typeof k === "string" && (k.startsWith("/api/record-activity") || k.startsWith("/api/activity-tasks") || k.startsWith("/api/activity-notifications"));
    },
  });
}

export const KIND_ICON: Record<EntryKind | TaskKind, LucideIcon> = {
  call: Phone, email: Mail, meeting: Users, note: MessageSquareText, task: ListChecks,
};
/** Kind tone: marker ring + tint. Muted, ink-on-paper colors. */
export const KIND_TONE: Record<EntryKind | TaskKind, string> = {
  call: "bg-sky-50 text-sky-700 ring-sky-200",
  email: "bg-teal-50 text-teal-700 ring-teal-200",
  meeting: "bg-amber-50 text-amber-700 ring-amber-200",
  note: "bg-slate-100 text-slate-600 ring-slate-200",
  task: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

export function useActivityLabels() {
  const t = useT();
  const { lang } = useLang();
  const kind = useCallback((k: string) => ({
    call: t("activity.kind.call", "Звонок"),
    email: t("activity.kind.email", "Письмо"),
    meeting: t("activity.kind.meeting", "Встреча"),
    note: t("activity.kind.note", "Заметка"),
    task: t("activity.kind.task", "Задача"),
  } as Record<string, string>)[k] ?? k, [t]);
  const outcome = useCallback((o: string) => ({
    successful: t("activity.outcome.successful", "Состоялся / результат есть"),
    attempted: t("activity.outcome.attempted", "Попытка, без ответа"),
    none: t("activity.outcome.none", "Без исхода"),
  } as Record<Outcome, string>)[o as Outcome] ?? o, [t]);
  const filter = useCallback((f: TaskFilter) => ({
    open: t("activity.filter.open", "Открытые"),
    today: t("activity.filter.today", "Сегодня"),
    upcoming: t("activity.filter.upcoming", "Предстоящие"),
    overdue: t("activity.filter.overdue", "Просроченные"),
    completed: t("activity.filter.completed", "Выполненные"),
    cancelled: t("activity.filter.cancelled", "Отменённые"),
    all: t("activity.filter.all", "Все"),
  })[f], [t]);
  const locale = lang === "he" ? "he-IL" : lang === "en" ? "en-GB" : "ru-RU";
  const dateTime = useCallback((iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  }, [locale]);
  const reminder = useCallback((m: number | null) => {
    if (m == null) return t("activity.reminder.none", "Без напоминания");
    if (m === 0) return t("activity.reminder.atDue", "В момент срока");
    if (m % 1440 === 0) return `${m / 1440} ${t("activity.unit.dayShort", "дн.")} ${t("activity.reminder.before", "до срока")}`;
    if (m % 60 === 0) return `${m / 60} ${t("activity.unit.hourShort", "ч")} ${t("activity.reminder.before", "до срока")}`;
    return `${m} ${t("activity.unit.minShort", "мин")} ${t("activity.reminder.before", "до срока")}`;
  }, [t]);
  return { kind, outcome, filter, dateTime, reminder, t };
}

export function KindMarker({ kind, className }: { kind: string; className?: string }) {
  const Icon = KIND_ICON[kind as EntryKind] ?? MessageSquareText;
  const tone = KIND_TONE[kind as EntryKind] ?? KIND_TONE.note;
  return (
    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ${tone} ${className ?? ""}`} aria-hidden>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}
