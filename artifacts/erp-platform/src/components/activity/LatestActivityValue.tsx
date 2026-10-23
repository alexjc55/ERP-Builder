import { useLang, useT } from "@/lib/i18n";

const labels: Record<string, [string, string, string]> = {
  call: ["Звонок", "Call", "שיחה"],
  email: ["Письмо", "Email", "דוא״ל"],
  meeting: ["Встреча", "Meeting", "פגישה"],
  note: ["Заметка", "Note", "הערה"],
  status_changed: ["Смена статуса", "Status changed", "שינוי סטטוס"],
  task_created: ["Создана задача", "Task created", "משימה נוצרה"],
  task_completed: ["Задача завершена", "Task completed", "משימה הושלמה"],
  task_rescheduled: ["Задача перенесена", "Task rescheduled", "משימה נדחתה"],
  task_cancelled: ["Задача отменена", "Task cancelled", "משימה בוטלה"],
};

export function LatestActivityValue({ value }: { value: unknown }) {
  const { lang } = useLang();
  const t = useT();
  if (!value || typeof value !== "object") return <span className="text-slate-300">—</span>;
  const entry = value as { kind?: string; occurredAt?: string };
  const date = new Date(entry.occurredAt ?? "");
  if (!entry.kind || !labels[entry.kind] || !Number.isFinite(date.getTime())) return <span>—</span>;
  const index = lang === "ru" ? 0 : lang === "he" ? 2 : 1;
  return <span className="inline-flex flex-col text-start leading-snug">
    <span>{t(`activity.kind.${entry.kind}`, labels[entry.kind][index])}</span>
    <time dateTime={date.toISOString()} className="text-xs opacity-70" dir="ltr">
      {new Intl.DateTimeFormat(lang === "he" ? "he-IL" : lang === "ru" ? "ru-RU" : "en-GB",
        { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}
    </time>
  </span>;
}
