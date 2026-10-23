import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createRecordActivity, createActivityTask } from "@workspace/api-client-react";
import { CalendarPlus, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  ENTRY_KINDS, OUTCOMES, apiErrorMessage, defaultDue, fromLocalInput, taskDraftError, taskDraftToInput,
  type EntryKind, type Outcome, type TaskDraft, type TaskDraftError,
} from "@/lib/activity";
import { KindMarker, invalidateActivity, useActivityLabels } from "./activityShared";
import { TaskFields, useAssignees } from "./TaskFields";

export function emptyTaskDraft(assigneeId = ""): TaskDraft {
  return { title: "", description: "", kind: "call", due: defaultDue(), assigneeId, reminder: "" };
}

/** Pick the current user when eligible, else leave empty (explicit choice). */
function useDefaultAssignee(assignees: { id: number }[], draft: TaskDraft, set: (p: Partial<TaskDraft>) => void) {
  const { user } = useAuth();
  useEffect(() => {
    if (draft.assigneeId || !user) return;
    if (assignees.some(a => a.id === user.id)) set({ assigneeId: String(user.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignees, user?.id, draft.assigneeId]);
}

interface Ctx { entityId: number; recordId: number; pageId?: number | null }

/** Log what happened (call / email / meeting / note) and optionally plan the
 * next step in the same atomic request. */
export function ActivityComposer({ ctx }: { ctx: Ctx }) {
  const L = useActivityLabels();
  const { t } = L;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [kind, setKind] = useState<EntryKind>("call");
  const [outcome, setOutcome] = useState<Outcome>("successful");
  const [body, setBody] = useState("");
  const [occurred, setOccurred] = useState("");
  const [planNext, setPlanNext] = useState(false);
  const [task, setTask] = useState<TaskDraft>(() => emptyTaskDraft());
  const [bodyErr, setBodyErr] = useState(false);
  const [taskErr, setTaskErr] = useState<TaskDraftError | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: assignees = [], isLoading: aLoading } = useAssignees(ctx.entityId, ctx.recordId, ctx.pageId);
  const patchTask = (p: Partial<TaskDraft>) => { setTask(prev => ({ ...prev, ...p })); setTaskErr(null); };
  useDefaultAssignee(assignees, task, patchTask);

  const submit = async () => {
    const noBody = !body.trim();
    setBodyErr(noBody);
    const te = planNext ? taskDraftError(task) : null;
    setTaskErr(te);
    if (noBody || te) return;
    setBusy(true);
    try {
      const occurredAt = occurred ? fromLocalInput(occurred) : null;
      await createRecordActivity({
        entityId: ctx.entityId, recordId: ctx.recordId,
        ...(ctx.pageId != null ? { pageId: ctx.pageId } : {}),
        kind, body: body.trim(),
        ...(kind !== "note" ? { outcome } : { outcome: "none" }),
        ...(occurredAt ? { occurredAt } : {}),
        ...(planNext ? { nextTask: taskDraftToInput(task, ctx) } : {}),
      });
      toast({ title: planNext ? t("activity.loggedWithTask", "Записано, следующий шаг запланирован") : t("activity.logged", "Записано в ленту") });
      setBody(""); setOccurred(""); setPlanNext(false); setTask(emptyTaskDraft(user ? String(user.id) : ""));
    } catch (e) {
      toast({ variant: "destructive", title: t("activity.err.save", "Не удалось сохранить"), description: apiErrorMessage(e) });
    } finally {
      setBusy(false);
      void invalidateActivity(qc);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white" data-testid="activity-composer">
      <div className="flex flex-wrap gap-1 border-b border-slate-100 p-2" role="tablist">
        {ENTRY_KINDS.map(k => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} data-testid={`button-entry-kind-${k}`} onClick={() => setKind(k)}
            className={cn("flex items-center gap-1.5 rounded-md py-1 pe-2.5 ps-1 text-xs font-medium transition-colors",
              kind === k ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700")}>
            <KindMarker kind={k} className="h-6 w-6" />{L.kind(k)}
          </button>
        ))}
      </div>
      <div className="space-y-3 p-3">
        <div className="space-y-1">
          <Textarea rows={3} maxLength={10000} value={body} data-testid="input-activity-body"
            aria-invalid={bodyErr} className={cn("resize-y", bodyErr && "border-red-400")}
            placeholder={kind === "note" ? t("activity.bodyPhNote", "Заметка по записи…") : t("activity.bodyPh", "О чём договорились, что сказал клиент…")}
            onChange={e => { setBody(e.target.value); if (e.target.value.trim()) setBodyErr(false); }} />
          {bodyErr && <p className="text-xs text-red-600" data-testid="text-body-error">{t("activity.err.body", "Опишите, что произошло.")}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {kind !== "note" && (
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">{t("activity.outcome", "Исход")}</Label>
              <div className="flex flex-wrap gap-1">
                {OUTCOMES.map(o => (
                  <button key={o} type="button" aria-pressed={outcome === o} data-testid={`button-entry-outcome-${o}`} onClick={() => setOutcome(o)}
                    className={cn("rounded border px-2 py-1 text-xs", outcome === o ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300")}>
                    {L.outcome(o)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs text-slate-500" htmlFor="activity-occurred">{t("activity.occurredAt", "Когда (по умолчанию сейчас)")}</Label>
            <Input id="activity-occurred" type="datetime-local" className="h-8 w-52 text-xs tabular-nums" value={occurred} onChange={e => setOccurred(e.target.value)} data-testid="input-activity-occurred" />
          </div>
        </div>
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-700">
          <Checkbox checked={planNext} onCheckedChange={v => setPlanNext(v === true)} data-testid="checkbox-plan-next" />
          <CalendarPlus className="h-4 w-4 text-slate-400" />{t("activity.planNext", "Запланировать следующий шаг")}
        </label>
        {planNext && (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-3">
            <TaskFields idPrefix="composer" draft={task} onChange={patchTask} assignees={assignees} assigneesLoading={aLoading} error={taskErr} currentUserId={user?.id} />
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={() => void submit()} disabled={busy} data-testid="button-activity-submit" className="bg-blue-600 hover:bg-blue-700">
            {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Send className="me-2 h-4 w-4 rtl:-scale-x-100" />}
            {t("activity.submit", "Записать")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Standalone next-step planning without logging an entry. */
export function NewTaskForm({ ctx, onDone }: { ctx: Ctx; onDone: () => void }) {
  const { t } = useActivityLabels();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [task, setTask] = useState<TaskDraft>(() => emptyTaskDraft());
  const [err, setErr] = useState<TaskDraftError | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: assignees = [], isLoading } = useAssignees(ctx.entityId, ctx.recordId, ctx.pageId);
  const patch = (p: Partial<TaskDraft>) => { setTask(prev => ({ ...prev, ...p })); setErr(null); };
  useDefaultAssignee(assignees, task, patch);
  const submit = async () => {
    const e = taskDraftError(task);
    setErr(e);
    if (e) return;
    setBusy(true);
    try {
      await createActivityTask(taskDraftToInput(task, ctx));
      toast({ title: t("activity.task.created", "Задача запланирована") });
      onDone();
    } catch (x) {
      toast({ variant: "destructive", title: t("activity.err.save", "Не удалось сохранить"), description: apiErrorMessage(x) });
    } finally {
      setBusy(false);
      void invalidateActivity(qc);
    }
  };
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" data-testid="form-new-task">
      <TaskFields idPrefix="newtask" draft={task} onChange={patch} assignees={assignees} assigneesLoading={isLoading} error={err} currentUserId={user?.id} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone} disabled={busy}>{t("common.cancel", "Отмена")}</Button>
        <Button size="sm" onClick={() => void submit()} disabled={busy} data-testid="button-new-task-save" className="bg-blue-600 hover:bg-blue-700">
          {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("activity.task.plan", "Запланировать")}
        </Button>
      </div>
    </div>
  );
}
