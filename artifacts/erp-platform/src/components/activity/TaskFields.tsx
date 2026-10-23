import { useListActivityAssignees, getListActivityAssigneesQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { REMINDER_PRESETS, TASK_KINDS, type TaskDraft, type TaskDraftError } from "@/lib/activity";
import { KindMarker, useActivityLabels } from "./activityShared";

const NO_REMINDER = "__none__";

export function useAssignees(entityId: number, recordId: number, pageId?: number | null) {
  const params = { entityId, recordId, ...(pageId != null ? { pageId } : {}) };
  return useListActivityAssignees(params, { query: { queryKey: getListActivityAssigneesQueryKey(params), staleTime: 60_000 } });
}

/** Task planning inputs shared by "next step" in the composer and the standalone task dialog. */
export function TaskFields({ draft, onChange, assignees, assigneesLoading, error, currentUserId, idPrefix }: {
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
  assignees: { id: number; name: string }[];
  assigneesLoading: boolean;
  error: TaskDraftError | null;
  currentUserId?: number;
  idPrefix: string;
}) {
  const L = useActivityLabels();
  const { t } = L;
  const assigningOther = draft.assigneeId !== "" && currentUserId != null && Number(draft.assigneeId) !== currentUserId;
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid={`${idPrefix}-task-fields`}>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-title`}>{t("activity.task.title", "Что сделать")}</Label>
        <Input id={`${idPrefix}-title`} data-testid={`${idPrefix}-input-task-title`} value={draft.title} maxLength={500}
          aria-invalid={error === "title"} className={cn(error === "title" && "border-red-400")}
          placeholder={t("activity.task.titlePh", "Например: перезвонить по согласованию цены")}
          onChange={e => onChange({ title: e.target.value })} />
        {error === "title" && <p className="text-xs text-red-600">{t("activity.err.title", "Укажите, что нужно сделать.")}</p>}
      </div>
      <div className="space-y-1.5">
        <Label>{t("activity.task.kind", "Тип")}</Label>
        <div className="flex flex-wrap gap-1" role="radiogroup">
          {TASK_KINDS.map(k => (
            <button key={k} type="button" role="radio" aria-checked={draft.kind === k} data-testid={`${idPrefix}-task-kind-${k}`}
              onClick={() => onChange({ kind: k })}
              className={cn("flex items-center gap-1.5 rounded-full border py-0.5 pe-2.5 ps-0.5 text-xs transition-colors",
                draft.kind === k ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
              <KindMarker kind={k} className="h-5 w-5" />{L.kind(k)}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-due`}>{t("activity.task.due", "Срок")}</Label>
        <Input id={`${idPrefix}-due`} type="datetime-local" data-testid={`${idPrefix}-input-task-due`} value={draft.due}
          aria-invalid={error === "due"} className={cn("tabular-nums", error === "due" && "border-red-400")}
          onChange={e => onChange({ due: e.target.value })} />
        {error === "due" && <p className="text-xs text-red-600">{t("activity.err.due", "Укажите срок.")}</p>}
      </div>
      <div className="space-y-1.5">
        <Label>{t("activity.task.assignee", "Исполнитель")}</Label>
        <Select value={draft.assigneeId} onValueChange={v => onChange({ assigneeId: v })} disabled={assigneesLoading}>
          <SelectTrigger data-testid={`${idPrefix}-select-assignee`} className={cn(error === "assignee" && "border-red-400")}>
            <SelectValue placeholder={assigneesLoading ? t("common.loading", "Загрузка…") : t("activity.task.pickAssignee", "Выберите исполнителя")} />
          </SelectTrigger>
          <SelectContent>
            {assignees.map(a => (
              <SelectItem key={a.id} value={String(a.id)}>{a.name}{a.id === currentUserId ? ` (${t("activity.task.me", "я")})` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error === "assignee" && <p className="text-xs text-red-600">{t("activity.err.assignee", "Выберите исполнителя.")}</p>}
        {!assigneesLoading && assignees.length === 0 && <p className="text-xs text-amber-700">{t("activity.task.noAssignees", "Нет пользователей с доступом к этой записи.")}</p>}
        {assigningOther && <p className="text-xs text-slate-500">{t("activity.task.otherHint", "Назначить задачу коллеге можно только с правом изменения записи.")}</p>}
      </div>
      <div className="space-y-1.5">
        <Label>{t("activity.task.reminder", "Напоминание во входящих")}</Label>
        <Select value={draft.reminder === "" ? NO_REMINDER : draft.reminder} onValueChange={v => onChange({ reminder: v === NO_REMINDER ? "" : v })}>
          <SelectTrigger data-testid={`${idPrefix}-select-reminder`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {REMINDER_PRESETS.map(m => (
              <SelectItem key={String(m)} value={m == null ? NO_REMINDER : String(m)}>{L.reminder(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-desc`}>{t("activity.task.description", "Подробности (необязательно)")}</Label>
        <Textarea id={`${idPrefix}-desc`} rows={2} maxLength={10000} data-testid={`${idPrefix}-input-task-desc`} value={draft.description}
          onChange={e => onChange({ description: e.target.value })} />
      </div>
    </div>
  );
}
