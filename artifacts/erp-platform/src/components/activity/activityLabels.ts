export const activityLabels: Record<string, [string, string, string]> = {
  call: ["Звонок", "Call", "שיחה"],
  email: ["Письмо", "Email", "דוא״ל"],
  meeting: ["Встреча", "Meeting", "פגישה"],
  note: ["Заметка", "Note", "הערה"],
  task: ["Задача", "Task", "משימה"],
  status_changed: ["Смена статуса", "Status changed", "שינוי סטטוס"],
  task_created: ["Создана задача", "Task created", "משימה נוצרה"],
  task_completed: ["Задача завершена", "Task completed", "משימה הושלמה"],
  task_rescheduled: ["Задача перенесена", "Task rescheduled", "משימה נדחתה"],
  task_cancelled: ["Задача отменена", "Task cancelled", "משימה בוטלה"],
  activity_edited: ["Взаимодействие исправлено", "Interaction edited", "אינטראקציה נערכה"],
  activity_deleted: ["Взаимодействие удалено", "Interaction deleted", "אינטראקציה נמחקה"],
};
export function localizedActivityLabel(kind: string, lang: string) {
  return (activityLabels[kind] ?? ["Событие", "Event", "אירוע"])[lang === "ru" ? 0 : lang === "he" ? 2 : 1];
}
export function activityStatusName(value: unknown, lang: string): string {
  if (!value || typeof value !== "object") return "";
  const names = value as Record<string, unknown>;
  const label = names[lang] || names.ru || names.en || names.he;
  return typeof label === "string" ? label : "";
}
