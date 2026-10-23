import type { Field, UserOption, MultilingualText } from "@workspace/api-client-react";
import { Info, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import type { RecipientDraft } from "@/lib/activityAutomation";

const PICK = "__pick__";

/** Editor for the internal-inbox `notify` action and the `create_task` action. */
export function RecipientActionEditor({ type, draft, onChange, triggerType, userOptions, fields, ml, index }: {
  type: "notify" | "create_task";
  draft: RecipientDraft;
  onChange: (patch: Partial<RecipientDraft>) => void;
  triggerType: string;
  userOptions: UserOption[];
  fields: Field[];
  ml: (v: MultilingualText | string | null | undefined) => string;
  index: number;
}) {
  const t = useT();
  const userFields = fields.filter(f => f.isActive && f.fieldType === "user");
  const userName = (id: number) => userOptions.find(u => u.id === id)?.name ?? `#${id}`;
  const fieldName = (k: string) => ml(userFields.find(f => f.fieldKey === k)?.nameJson) || k;
  const none = draft.userIds.length === 0 && draft.userFieldKeys.length === 0 && !(triggerType === "task_due" && draft.taskAssignee);
  const chip = "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pe-1 ps-2 text-xs text-slate-700";

  return (
    <div className="space-y-3 ps-7" data-testid={`action-recipient-${index}`}>
      {type === "notify" ? (
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">{t("auto.notify.message", "Текст уведомления")}</Label>
          <Textarea rows={2} maxLength={2000} value={draft.message} onChange={e => onChange({ message: e.target.value })} data-testid={`input-notify-message-${index}`}
            placeholder={t("auto.notify.messagePh", "Например: клиент без контакта больше недели")} />
          <p className="text-[11px] text-slate-400">{t("auto.notify.where", "Уведомление приходит во внутренние «Входящие» ERP (страница «Мои задачи») со ссылкой на запись. Почта и телефон не используются.")}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs text-slate-600">{t("auto.task.title", "Название задачи")}</Label>
            <Input maxLength={500} value={draft.title} onChange={e => onChange({ title: e.target.value })} data-testid={`input-task-title-${index}`} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">{t("activity.task.kind", "Тип")}</Label>
            <Select value={draft.kind} onValueChange={v => onChange({ kind: v as RecipientDraft["kind"] })}>
              <SelectTrigger data-testid={`select-task-kind-${index}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="call">{t("activity.kind.call", "Звонок")}</SelectItem>
                <SelectItem value="email">{t("activity.kind.email", "Письмо")}</SelectItem>
                <SelectItem value="meeting">{t("activity.kind.meeting", "Встреча")}</SelectItem>
                <SelectItem value="task">{t("activity.kind.task", "Задача")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">{t("auto.task.dueIn", "Срок через, часов")}</Label>
            <Input inputMode="decimal" className="w-28" value={draft.dueInHours} onChange={e => onChange({ dueInHours: e.target.value })} data-testid={`input-task-due-${index}`} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs text-slate-600">{t("activity.task.description", "Подробности (необязательно)")}</Label>
            <Textarea rows={2} maxLength={10000} value={draft.description} onChange={e => onChange({ description: e.target.value })} />
          </div>
          <p className="text-[11px] text-slate-400 sm:col-span-2">{t("auto.task.perRecipient", "Каждому получателю создаётся своя задача по этой записи.")}</p>
        </div>
      )}

      <div className="space-y-2 rounded-md border border-slate-200 bg-white p-2.5">
        <Label className="text-xs font-semibold text-slate-700">{type === "notify" ? t("auto.rcpt.title", "Получатели") : t("auto.rcpt.assignees", "Исполнители")}</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={PICK} onValueChange={v => { if (v !== PICK && !draft.userIds.includes(Number(v))) onChange({ userIds: [...draft.userIds, Number(v)] }); }}>
            <SelectTrigger data-testid={`select-rcpt-user-${index}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={PICK} disabled>{t("auto.rcpt.addUser", "Добавить пользователя…")}</SelectItem>
              {userOptions.filter(u => !draft.userIds.includes(u.id)).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={PICK} onValueChange={v => { if (v !== PICK && !draft.userFieldKeys.includes(v)) onChange({ userFieldKeys: [...draft.userFieldKeys, v] }); }} disabled={userFields.length === 0}>
            <SelectTrigger data-testid={`select-rcpt-field-${index}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={PICK} disabled>{userFields.length ? t("auto.rcpt.addField", "Из поля записи…") : t("auto.rcpt.noUserFields", "Нет полей типа «Пользователь»")}</SelectItem>
              {userFields.filter(f => !draft.userFieldKeys.includes(f.fieldKey)).map(f => <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {(draft.userIds.length > 0 || draft.userFieldKeys.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {draft.userIds.map(id => (
              <span key={`u${id}`} className={chip} data-testid={`chip-rcpt-user-${id}`}>{userName(id)}
                <button type="button" className="rounded-full p-0.5 hover:bg-slate-100" aria-label={t("common.remove", "Убрать")} onClick={() => onChange({ userIds: draft.userIds.filter(x => x !== id) })}><X className="h-3 w-3" /></button>
              </span>
            ))}
            {draft.userFieldKeys.map(k => (
              <span key={`f${k}`} className={`${chip} border-dashed`} data-testid={`chip-rcpt-field-${k}`}>{t("auto.rcpt.field", "Поле")}: {fieldName(k)}
                <button type="button" className="rounded-full p-0.5 hover:bg-slate-100" aria-label={t("common.remove", "Убрать")} onClick={() => onChange({ userFieldKeys: draft.userFieldKeys.filter(x => x !== k) })}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}
        {triggerType === "task_due" ? (
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-700">
            <Checkbox checked={draft.taskAssignee} onCheckedChange={c => onChange({ taskAssignee: c === true })} data-testid={`checkbox-rcpt-assignee-${index}`} />
            {t("auto.rcpt.taskAssignee", "Исполнитель задачи, по которой сработал триггер")}
          </label>
        ) : draft.taskAssignee ? (
          <p className="text-xs text-amber-700">{t("auto.rcpt.assigneeOnlyTaskDue", "«Исполнитель задачи» доступен только для триггера «Срок задачи». Уберите его или смените триггер.")}
            <button type="button" className="ms-1 underline" onClick={() => onChange({ taskAssignee: false })}>{t("common.remove", "Убрать")}</button></p>
        ) : null}
        {none && <p className="text-xs text-red-600" data-testid={`text-rcpt-required-${index}`}>{t("auto.rcpt.required", "Выберите хотя бы одного получателя.")}</p>}
        <p className="flex gap-1.5 text-[11px] leading-snug text-slate-400"><Info className="mt-0.5 h-3 w-3 shrink-0" />{t("auto.rcpt.access", "Получатели без доступа к записи на момент срабатывания пропускаются: они не увидят ни уведомления, ни задачи.")}</p>
      </div>
    </div>
  );
}
