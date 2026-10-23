import type { ReactNode } from "react";
import { CalendarClock, Info, Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { isMonitorTrigger, isSchedulableTrigger, type ActivityKind, type Frequency, type MonitorDraft, type MonitorError } from "@/lib/activityAutomation";

const KINDS: ActivityKind[] = ["call", "email", "meeting", "note"];
const TIMEZONES = ["Asia/Jerusalem", "Europe/Moscow", "Europe/Kiev", "Europe/London", "Europe/Berlin", "UTC", "America/New_York"];

/** Short explanation under the trigger select for every activity-aware trigger. */
export function ActivityTriggerHint({ type }: { type: string }) {
  const t = useT();
  const text: Record<string, string> = {
    activity_logged: t("auto.hint.activity_logged", "Срабатывает сразу, когда в записи сохраняют звонок, письмо, встречу или заметку."),
    task_completed: t("auto.hint.task_completed", "Срабатывает сразу при выполнении задачи по записи."),
    inactivity: t("auto.hint.inactivity", "Проверка по расписанию: в записи давно не было работы с клиентом."),
    status_age: t("auto.hint.status_age", "Проверка по расписанию: запись слишком долго находится в текущем статусе. Нужный статус задайте в условиях ниже."),
    task_due: t("auto.hint.task_due", "Проверка по расписанию относительно срока открытых задач записи."),
  };
  if (!text[type]) return null;
  return <p className="flex gap-1.5 text-xs text-slate-500" data-testid="text-trigger-hint"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{text[type]}</p>;
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-slate-600">{label}</Label>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : hint ? <p className="text-[11px] leading-snug text-slate-400">{hint}</p> : null}
    </div>
  );
}

/**
 * Schedule, repeat limits and type-specific options for monitoring triggers
 * (inactivity, status_age, task_due) and the optional schedule of date_reached.
 * Regular triggers render nothing: they run immediately on the event.
 */
export function ActivityTriggerOptions({ type, value, onChange, error }: {
  type: string;
  value: MonitorDraft;
  onChange: (patch: Partial<MonitorDraft>) => void;
  error: MonitorError | null;
}) {
  const t = useT();
  if (!isSchedulableTrigger(type)) return null;
  const monitor = isMonitorTrigger(type);
  const showSchedule = monitor || value.scheduleOn;
  const err = (k: MonitorError, msg: string) => (error === k ? msg : null);
  const kindLabel = (k: ActivityKind) => ({ call: t("activity.kind.call", "Звонок"), email: t("activity.kind.email", "Письмо"), meeting: t("activity.kind.meeting", "Встреча"), note: t("activity.kind.note", "Заметка") })[k];

  return (
    <div className="space-y-3" data-testid="trigger-monitor-options">
      {type === "inactivity" && (
        <div className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-2">
          <Field label={t("auto.mon.days", "Нет активности дольше, дней")} error={err("days", t("auto.err.days", "Укажите число дней больше нуля."))}>
            <Input inputMode="decimal" className="w-28" value={value.days} onChange={e => onChange({ days: e.target.value })} data-testid="input-trigger-days" />
          </Field>
          <Field label={t("auto.mon.baseline", "Отсчёт, если активности ещё не было")}>
            <Select value={value.baseline} onValueChange={v => onChange({ baseline: v as MonitorDraft["baseline"] })}>
              <SelectTrigger data-testid="select-trigger-baseline"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="created">{t("auto.mon.baselineCreated", "от создания записи")}</SelectItem>
                <SelectItem value="status">{t("auto.mon.baselineStatus", "от входа в текущий статус")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={t("auto.mon.kinds", "Что считается активностью")} error={err("kinds", t("auto.err.kinds", "Выберите хотя бы один тип."))}>
              <div className="flex flex-wrap gap-3">
                {KINDS.map(k => (
                  <label key={k} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
                    <Checkbox checked={value.kinds.includes(k)} data-testid={`checkbox-trigger-kind-${k}`}
                      onCheckedChange={c => onChange({ kinds: c === true ? [...value.kinds.filter(x => x !== k), k] : value.kinds.filter(x => x !== k) })} />
                    {kindLabel(k)}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
            <Checkbox className="mt-0.5" checked={value.successfulOnly} onCheckedChange={c => onChange({ successfulOnly: c === true })} data-testid="checkbox-trigger-successful" />
            <span>{t("auto.mon.successfulOnly", "Учитывать только успешные контакты")}<span className="block text-[11px] text-slate-400">{t("auto.mon.successfulOnlyHint", "Недозвоны не сбрасывают отсчёт.")}</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
            <Checkbox className="mt-0.5" checked={value.skipWithFutureTask} onCheckedChange={c => onChange({ skipWithFutureTask: c === true })} data-testid="checkbox-trigger-skip-future" />
            <span>{t("auto.mon.skipFuture", "Пропускать записи с запланированной задачей")}<span className="block text-[11px] text-slate-400">{t("auto.mon.skipFutureHint", "Следующий шаг уже назначен, напоминать не нужно.")}</span></span>
          </label>
        </div>
      )}
      {type === "status_age" && (
        <div className="rounded-md bg-slate-50 p-3">
          <Field label={t("auto.mon.statusDays", "В текущем статусе дольше, дней")} error={err("days", t("auto.err.days", "Укажите число дней больше нуля."))}>
            <Input inputMode="decimal" className="w-28" value={value.days} onChange={e => onChange({ days: e.target.value })} data-testid="input-trigger-days" />
          </Field>
        </div>
      )}
      {type === "task_due" && (
        <div className="rounded-md bg-slate-50 p-3">
          <Field label={t("auto.mon.offset", "Когда срабатывать относительно срока задачи")} error={err("offset", t("auto.err.offset", "Укажите целое неотрицательное число."))}
            hint={t("auto.mon.offsetHint", "0 = в момент срока. В действиях можно выбрать получателя «Исполнитель задачи».")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Input inputMode="numeric" className="w-20" value={value.offsetAmount} onChange={e => onChange({ offsetAmount: e.target.value })} data-testid="input-trigger-offset" />
              <Select value={value.offsetUnit} onValueChange={v => onChange({ offsetUnit: v as MonitorDraft["offsetUnit"] })}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">{t("auto.unit.minutes", "минут")}</SelectItem>
                  <SelectItem value="hours">{t("auto.unit.hours", "часов")}</SelectItem>
                  <SelectItem value="days">{t("auto.unit.days", "дней")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={value.offsetDir} onValueChange={v => onChange({ offsetDir: v as MonitorDraft["offsetDir"] })}>
                <SelectTrigger className="w-36" data-testid="select-trigger-offset-dir"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="before">{t("auto.mon.before", "до срока")}</SelectItem>
                  <SelectItem value="after">{t("auto.mon.after", "после срока")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Field>
        </div>
      )}

      {!monitor && (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-700">
          <Switch checked={value.scheduleOn} onCheckedChange={v => onChange({ scheduleOn: v })} data-testid="switch-trigger-schedule" />
          {t("auto.sched.custom", "Своё расписание проверки")}
        </label>
      )}

      {showSchedule && (
        <div className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-2" data-testid="trigger-schedule">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 sm:col-span-2"><CalendarClock className="h-3.5 w-3.5" />{t("auto.sched.title", "Как часто проверять")}</p>
          <Field label={t("auto.sched.frequency", "Частота")} error={err("frequency", t("auto.err.frequency", "Выберите частоту."))}>
            <Select value={value.frequency} onValueChange={v => onChange({ frequency: v as Frequency })}>
              <SelectTrigger data-testid="select-trigger-frequency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="minute">{t("auto.sched.minute", "Каждую минуту")}</SelectItem>
                <SelectItem value="hour">{t("auto.sched.hour", "Каждый час")}</SelectItem>
                <SelectItem value="day">{t("auto.sched.day", "Каждый день")}</SelectItem>
                <SelectItem value="month">{t("auto.sched.month", "Каждый месяц")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("auto.sched.timezone", "Часовой пояс")} error={err("timezone", t("auto.err.timezone", "Укажите часовой пояс."))}>
            <Select value={value.timezone} onValueChange={v => onChange({ timezone: v })}>
              <SelectTrigger data-testid="select-trigger-timezone"><SelectValue /></SelectTrigger>
              <SelectContent>{[...new Set([value.timezone, ...TIMEZONES])].map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {(value.frequency === "day" || value.frequency === "month") && (
            <Field label={t("auto.sched.hourOfDay", "Час (0–23)")} error={err("hour", t("auto.err.hour", "Час от 0 до 23."))}>
              <Input inputMode="numeric" className="w-24" value={value.hour} onChange={e => onChange({ hour: e.target.value })} data-testid="input-trigger-hour" />
            </Field>
          )}
          {value.frequency === "month" && (
            <Field label={t("auto.sched.dayOfMonth", "День месяца (1–28)")} error={err("day", t("auto.err.day", "День от 1 до 28."))}>
              <Input inputMode="numeric" className="w-24" value={value.day} onChange={e => onChange({ day: e.target.value })} data-testid="input-trigger-day" />
            </Field>
          )}
          <p className="text-[11px] leading-snug text-slate-400 sm:col-span-2">{t("auto.sched.explain", "Расписание задаёт только частоту проверки. Сколько раз действие сработает для одной записи, задаётся ниже.")}</p>
        </div>
      )}

      {monitor && (
        <div className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-2" data-testid="trigger-repeats">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 sm:col-span-2"><Repeat className="h-3.5 w-3.5" />{t("auto.rep.title", "Повторы для одной записи")}</p>
          <Field label={t("auto.rep.every", "Повторять не чаще чем раз в, часов")} hint={t("auto.rep.everyHint", "Пусто = сработать один раз, пока условие не сбросится.")}
            error={err("repeatHours", t("auto.err.positiveInt", "Целое число не меньше 1 или пусто."))}>
            <Input inputMode="numeric" className={cn("w-28")} placeholder={t("auto.rep.once", "один раз")} value={value.repeatHours} onChange={e => onChange({ repeatHours: e.target.value })} data-testid="input-trigger-repeat" />
          </Field>
          <Field label={t("auto.rep.max", "Всего срабатываний не больше")} hint={t("auto.rep.maxHint", "Пусто = без ограничения.")}
            error={err("maxRuns", t("auto.err.positiveInt", "Целое число не меньше 1 или пусто."))}>
            <Input inputMode="numeric" className="w-28" placeholder={t("auto.rep.unlimited", "без лимита")} value={value.maxRuns} onChange={e => onChange({ maxRuns: e.target.value })} data-testid="input-trigger-maxruns" />
          </Field>
        </div>
      )}
    </div>
  );
}
