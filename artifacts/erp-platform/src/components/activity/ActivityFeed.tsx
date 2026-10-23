import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { amendRecordActivity, listRecordActivity, type ActivityEntry } from "@workspace/api-client-react";
import { History, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiErrorMessage, apiErrorStatus } from "@/lib/activity";
import { KindMarker, invalidateActivity, useActivityLabels } from "./activityShared";
import { activityStatusName } from "./activityLabels";

interface Ctx { entityId: number; recordId: number; pageId?: number | null }

const OUTCOME_DOT: Record<string, string> = { successful: "bg-emerald-500", attempted: "bg-amber-500", none: "bg-slate-300" };

/** Timeline of record entries. First page comes from the panel query; older
 * pages are appended via `beforeId` cursor. */
export function ActivityFeed({ ctx, items, nextBeforeId }: { ctx: Ctx; items: ActivityEntry[]; nextBeforeId: number | null }) {
  const L = useActivityLabels();
  const { t } = L;
  const [older, setOlder] = useState<ActivityEntry[]>([]);
  const [cursor, setCursor] = useState<number | null>(nextBeforeId);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [amend, setAmend] = useState<{ entry: ActivityEntry; action: "edit" | "delete" } | null>(null);
  // First page refreshed (new entry / amendment): restart pagination from it.
  const headKey = items.map(i => `${i.id}:${i.version}`).join(",");
  useEffect(() => { setOlder([]); setCursor(nextBeforeId); }, [headKey, nextBeforeId]);

  const loadMore = async () => {
    if (cursor == null) return;
    setLoading(true); setLoadErr(false);
    try {
      const page = await listRecordActivity({ entityId: ctx.entityId, recordId: ctx.recordId, ...(ctx.pageId != null ? { pageId: ctx.pageId } : {}), beforeId: cursor });
      setOlder(prev => [...prev, ...page.items.filter(x => !prev.some(p => p.id === x.id))]);
      setCursor(page.nextBeforeId);
    } catch { setLoadErr(true); } finally { setLoading(false); }
  };

  const all = [...items, ...older.filter(o => !items.some(i => i.id === o.id))];
  if (all.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center" data-testid="activity-empty">
        <div className="mb-3 flex -space-x-1.5 rtl:space-x-reverse">{["call", "email", "meeting"].map(k => <KindMarker key={k} kind={k} className="ring-2 ring-white" />)}</div>
        <p className="text-sm font-medium text-slate-700">{t("activity.emptyTitle", "История пока пуста")}</p>
        <p className="mt-1 max-w-xs text-xs text-slate-500">{t("activity.emptyDesc", "Запишите первый звонок или договорённость, чтобы коллеги видели, где сейчас клиент.")}</p>
      </div>
    );
  }
  return (
    <div data-testid="activity-feed">
      <ol className="relative space-y-0">
        {all.map((e, i) => (
          <li key={e.id} className="relative flex gap-3 pb-4" data-testid={`activity-entry-${e.id}`}>
            {i < all.length - 1 && <span className="absolute start-[13px] top-8 bottom-0 w-px bg-slate-200" aria-hidden />}
            <KindMarker kind={e.kind} className={cn("relative z-[1]", e.deleted && "opacity-40")} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="font-semibold text-slate-800">{L.kind(e.kind)}</span>
                {e.taskContext?.kind && <span className="text-slate-500">· {L.kind(e.taskContext.kind)}</span>}
                {e.kind !== "note" && e.outcome && e.outcome !== "none" && (
                  <span className="inline-flex items-center gap-1 text-slate-500"><span className={cn("h-1.5 w-1.5 rounded-full", OUTCOME_DOT[e.outcome] ?? "bg-slate-300")} />{L.outcome(e.outcome)}</span>
                )}
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">{e.actorName}</span>
                <time className="ms-auto tabular-nums text-slate-400" dateTime={e.occurredAt}>{L.dateTime(e.occurredAt)}</time>
                {e.canAmend && !e.deleted && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t("activity.entryMenu", "Действия")} data-testid={`button-entry-menu-${e.id}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setAmend({ entry: e, action: "edit" })} data-testid={`button-entry-edit-${e.id}`}><Pencil className="me-2 h-3.5 w-3.5" />{t("activity.edit", "Исправить")}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setAmend({ entry: e, action: "delete" })} className="text-red-600 focus:text-red-600" data-testid={`button-entry-delete-${e.id}`}><Trash2 className="me-2 h-3.5 w-3.5" />{t("activity.delete", "Удалить")}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {e.deleted ? (
                <p className="mt-1 text-xs italic text-slate-400" data-testid={`text-entry-deleted-${e.id}`}>{t("activity.deletedEntry", "Запись удалена. История изменений сохранена.")}</p>
              ) : (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700" dir="auto">
                  {e.kind === "status_changed"
                    ? e.statusChange
                      ? [activityStatusName(e.statusChange.from, L.lang),
                          e.statusChange.cleared ? t("activity.noStatus", "Без статуса")
                            : activityStatusName(e.statusChange.to, L.lang) || t("activity.statusUnavailable", "Статус недоступен")]
                          .filter(Boolean).join(" → ")
                      : t("activity.statusNotRecorded", "Статус изменён. Название не сохранено в старой истории.")
                    : e.kind.startsWith("task_")
                      ? e.body.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, iso => L.dateTime(iso))
                      : e.body}
                </p>
              )}
              {e.version > 1 && !e.deleted && (
                <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-400"><History className="h-3 w-3" />{t("activity.edited", "исправлено")}</p>
              )}
              {!e.deleted && e.taskContext?.assigneeName && <p className="mt-1 text-xs text-slate-500">
                {t("activity.assignee", "Ответственный")}: {e.taskContext.assigneeName}
              </p>}
            </div>
          </li>
        ))}
      </ol>
      {cursor != null && (
        <div className="flex flex-col items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loading} data-testid="button-activity-more">
            {loading && <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />}{t("activity.loadOlder", "Показать более ранние")}
          </Button>
          {loadErr && <p className="text-xs text-red-600">{t("activity.err.load", "Не удалось загрузить.")}</p>}
        </div>
      )}
      <AmendDialog ctx={ctx} target={amend} onClose={() => setAmend(null)} />
    </div>
  );
}

function AmendDialog({ ctx, target, onClose }: { ctx: Ctx; target: { entry: ActivityEntry; action: "edit" | "delete" } | null; onClose: () => void }) {
  const { t } = useActivityLabels();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (target) { setBody(target.entry.body); setReason(""); setErr(null); } }, [target]);
  const isEdit = target?.action === "edit";
  const submit = async () => {
    if (!target) return;
    if (!reason.trim()) { setErr(t("activity.err.reason", "Укажите причину: она сохранится в истории.")); return; }
    if (isEdit && !body.trim()) { setErr(t("activity.err.body", "Опишите, что произошло.")); return; }
    setBusy(true);
    try {
      await amendRecordActivity(target.entry.id, {
        expectedVersion: target.entry.version, action: target.action, reason: reason.trim(),
        ...(isEdit ? { body: body.trim() } : {}),
        ...(ctx.pageId != null ? { pageId: ctx.pageId } : {}),
      });
      toast({ title: isEdit ? t("activity.amended", "Запись исправлена") : t("activity.deleted", "Запись удалена") });
      onClose();
    } catch (e) {
      setErr(apiErrorStatus(e) === 409 ? t("activity.err.entryConflict", "Запись уже изменена другим пользователем. Лента обновлена.") : apiErrorMessage(e));
    } finally {
      setBusy(false);
      void invalidateActivity(qc);
    }
  };
  return (
    <Dialog open={!!target} onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-amend-entry">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("activity.editTitle", "Исправить запись") : t("activity.deleteTitle", "Удалить запись?")}</DialogTitle>
          <DialogDescription>{t("activity.amendDesc", "Прежний текст и причина сохраняются в истории записи.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isEdit && <Textarea rows={4} maxLength={10000} value={body} onChange={e => setBody(e.target.value)} data-testid="input-amend-body" />}
          <div className="space-y-1.5">
            <Label>{t("activity.reason", "Причина")}</Label>
            <Textarea rows={2} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-amend-reason" />
          </div>
          {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("common.cancel", "Отмена")}</Button>
          <Button onClick={() => void submit()} disabled={busy} data-testid="button-amend-confirm" className={isEdit ? "bg-blue-600 hover:bg-blue-700" : "bg-red-600 hover:bg-red-700"}>
            {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{isEdit ? t("common.save", "Сохранить") : t("common.delete", "Удалить")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
