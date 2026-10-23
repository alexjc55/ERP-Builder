import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { changeActivityTask, type ActivityTask } from "@workspace/api-client-react";
import { AlarmClock, CalendarClock, Check, ExternalLink, Loader2, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { OUTCOMES, apiErrorMessage, apiErrorStatus, dueState, fromLocalInput, recordHref, toLocalInput, type Outcome } from "@/lib/activity";
import { KindMarker, invalidateActivity, useActivityLabels } from "./activityShared";

type Mode = "complete" | "reschedule" | "cancel" | null;

const DUE_TONE = {
  overdue: "text-red-700 bg-red-50 ring-red-200",
  today: "text-amber-800 bg-amber-50 ring-amber-200",
  upcoming: "text-slate-600 bg-slate-50 ring-slate-200",
  done: "text-slate-500 bg-slate-50 ring-slate-200",
} as const;

/** One task with its full management flow (complete / reschedule / cancel).
 * Actions render only when the server says `canManage`. */
export function TaskRow({ task, showRecord, pageId, compact }: { task: ActivityTask; showRecord?: boolean; pageId?: number | null; compact?: boolean }) {
  const L = useActivityLabels();
  const { t } = L;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(null);
  const [result, setResult] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("successful");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const state = dueState(task.dueAt, task.status);
  const href = showRecord ? recordHref(task.recordUrl) : null;

  const open = (m: Mode) => { setMode(m); setErr(null); setResult(""); setOutcome("successful"); setDue(toLocalInput(task.dueAt)); };
  const submit = async () => {
    if (!mode) return;
    if (mode === "reschedule" && !fromLocalInput(due)) { setErr(t("activity.err.due", "Укажите срок.")); return; }
    setBusy(true);
    try {
      await changeActivityTask(task.id, {
        expectedVersion: task.version,
        action: mode,
        ...(pageId != null ? { pageId } : {}),
        ...(mode === "reschedule" ? { dueAt: fromLocalInput(due) as string } : {}),
        ...(mode === "complete" ? { outcome, ...(result.trim() ? { result: result.trim() } : {}) } : {}),
        ...(mode === "cancel" && result.trim() ? { result: result.trim() } : {}),
      });
      toast({ title: mode === "complete" ? t("activity.task.completed", "Задача выполнена") : mode === "reschedule" ? t("activity.task.rescheduled", "Срок перенесён") : t("activity.task.cancelled", "Задача отменена") });
      setMode(null);
    } catch (e) {
      setErr(apiErrorStatus(e) === 409
        ? t("activity.err.conflict", "Задачу уже изменил кто-то другой. Список обновлён, проверьте и повторите.")
        : apiErrorMessage(e));
    } finally {
      setBusy(false);
      void invalidateActivity(qc);
    }
  };

  return (
    <div data-testid={`task-row-${task.id}`} className={cn("group flex gap-3 rounded-lg border bg-white p-3 transition-colors",
      state === "overdue" ? "border-red-200" : "border-slate-200", task.status !== "open" && "opacity-75")}>
      <KindMarker kind={task.kind} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <p className={cn("min-w-0 flex-1 break-words text-sm font-medium text-slate-900", task.status === "cancelled" && "line-through decoration-slate-400")} data-testid={`text-task-title-${task.id}`}>{task.title}</p>
          <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ring-1", DUE_TONE[state])} data-testid={`status-task-due-${task.id}`}>
            <CalendarClock className="h-3 w-3" />{L.dateTime(task.dueAt)}
            {state === "overdue" && <span className="ms-0.5">· {t("activity.filter.overdue", "Просрочено")}</span>}
          </span>
        </div>
        {task.description && !compact && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">{task.description}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{task.assigneeName}</span>
          {task.reminderMinutes != null && task.status === "open" && <span className="inline-flex items-center gap-1"><AlarmClock className="h-3 w-3" />{L.reminder(task.reminderMinutes)}</span>}
          {task.status !== "open" && <span className="font-medium text-slate-600">{task.status === "completed" ? t("activity.status.completed", "Выполнена") : t("activity.status.cancelled", "Отменена")}</span>}
          {showRecord && (href ? (
            <Link href={href} className="inline-flex min-w-0 items-center gap-1 font-medium text-blue-700 hover:underline" data-testid={`link-task-record-${task.id}`}>
              <ExternalLink className="h-3 w-3 shrink-0" /><span className="truncate">{task.recordLabel}</span>
            </Link>
          ) : <span className="truncate text-slate-600">{task.recordLabel}</span>)}
        </div>
        {task.result && <p className="mt-1.5 border-s-2 border-slate-200 ps-2 text-xs italic text-slate-600">{task.result}</p>}
        {task.status === "open" && task.canManage && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" className="h-7 bg-slate-900 px-2.5 text-xs hover:bg-slate-800" data-testid={`button-task-complete-${task.id}`} onClick={() => open("complete")}>
              <Check className="me-1 h-3.5 w-3.5" />{t("activity.task.complete", "Выполнено")}
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" data-testid={`button-task-reschedule-${task.id}`} onClick={() => open("reschedule")}>
              <CalendarClock className="me-1 h-3.5 w-3.5" />{t("activity.task.reschedule", "Перенести")}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-slate-500 hover:text-red-700" data-testid={`button-task-cancel-${task.id}`} onClick={() => open("cancel")}>
              <X className="me-1 h-3.5 w-3.5" />{t("activity.task.cancel", "Отменить")}
            </Button>
          </div>
        )}
      </div>

      <Dialog open={mode != null} onOpenChange={o => { if (!o && !busy) setMode(null); }}>
        <DialogContent className="max-w-md" data-testid={`dialog-task-${mode ?? "none"}`}>
          <DialogHeader>
            <DialogTitle>
              {mode === "complete" ? t("activity.task.completeTitle", "Закрыть задачу") : mode === "reschedule" ? t("activity.task.rescheduleTitle", "Перенести срок") : t("activity.task.cancelTitle", "Отменить задачу?")}
            </DialogTitle>
            <DialogDescription className="break-words">{task.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {mode === "complete" && (
              <div className="space-y-1.5">
                <Label>{t("activity.outcome", "Исход")}</Label>
                <div className="grid gap-1.5" role="radiogroup">
                  {OUTCOMES.map(o => (
                    <button key={o} type="button" role="radio" aria-checked={outcome === o} data-testid={`button-outcome-${o}`} onClick={() => setOutcome(o)}
                      className={cn("rounded-md border px-3 py-1.5 text-start text-sm", outcome === o ? "border-slate-800 bg-slate-50 font-medium" : "border-slate-200 hover:border-slate-300")}>
                      {L.outcome(o)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mode === "reschedule" && (
              <div className="space-y-1.5">
                <Label>{t("activity.task.newDue", "Новый срок")}</Label>
                <Input type="datetime-local" className="tabular-nums" value={due} onChange={e => setDue(e.target.value)} data-testid="input-task-new-due" />
              </div>
            )}
            {mode !== "reschedule" && (
              <div className="space-y-1.5">
                <Label>{mode === "complete" ? t("activity.task.result", "Результат (попадёт в ленту записи)") : t("activity.task.cancelReason", "Причина (необязательно)")}</Label>
                <Textarea rows={3} maxLength={10000} value={result} onChange={e => setResult(e.target.value)} data-testid="input-task-result" />
              </div>
            )}
            {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700" data-testid="text-task-error">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={busy}>{t("common.cancel", "Отмена")}</Button>
            <Button data-testid="button-task-confirm" onClick={() => void submit()} disabled={busy}
              className={mode === "cancel" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}>
              {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {mode === "complete" ? t("activity.task.complete", "Выполнено") : mode === "reschedule" ? t("activity.task.reschedule", "Перенести") : t("activity.task.cancelConfirm", "Отменить задачу")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
