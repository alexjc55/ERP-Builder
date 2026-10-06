import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSecurityRetention,
  getGetSecurityRetentionQueryKey,
  useUpdateSecurityRetention,
  useCleanupSecurityRetention,
  getGetSecuritySummaryQueryKey,
  type SecurityRetention,
} from "@workspace/api-client-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Archive, AlertTriangle, HardDrive, Trash2, Save, RotateCcw, Info, PauseCircle } from "lucide-react";

type Draft = { ordinaryDays: string; importantDays: string; warningSizeMb: string; cleanupEnabled: boolean };
const toDraft = (r: SecurityRetention): Draft => ({
  ordinaryDays: String(r.ordinaryDays), importantDays: String(r.importantDays),
  warningSizeMb: String(r.warningSizeMb), cleanupEnabled: r.cleanupEnabled,
});
const sameDraft = (a: Draft, b: Draft) =>
  a.ordinaryDays === b.ordinaryDays && a.importantDays === b.importantDays &&
  a.warningSizeMb === b.warningSizeMb && a.cleanupEnabled === b.cleanupEnabled;
const intIn = (s: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(s.trim())) return null;
  const n = Number(s.trim());
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
};
const status = (e: unknown) => (e as { status?: number } | null)?.status;

export function fmtBytes(n: number): string {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}
const fmtUtc = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
};

export default function SecurityRetentionPanel({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useGetSecurityRetention({ query: { queryKey: getGetSecurityRetentionQueryKey(), staleTime: 0, retry: false } });
  const updateMut = useUpdateSecurityRetention();
  const cleanupMut = useCleanupSecurityRetention();
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const [draft, setDraft] = useState<Draft | null>(null);
  const baseRef = useRef<Draft | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ ok: boolean; deleted?: number } | null>(null);

  const data = q.data;
  const dirty = !!draft && !!baseRef.current && !sameDraft(draft, baseRef.current);

  // Adopt server values only when the user has no unsaved edits (polling/refetch safe).
  useEffect(() => {
    if (!data) return;
    const next = toDraft(data);
    setDraft((cur) => {
      if (cur && baseRef.current && !sameDraft(cur, baseRef.current)) return cur;
      baseRef.current = next;
      return next;
    });
  }, [data]);

  const reloadLatest = async () => {
    const r = await q.refetch();
    if (r.data) { const next = toDraft(r.data); baseRef.current = next; setDraft(next); }
    setConflict(false); setConfirmed(false); setSaveError(false);
  };
  const discard = () => { if (baseRef.current) setDraft(baseRef.current); setConfirmed(false); setSaveError(false); };

  const ord = draft ? intIn(draft.ordinaryDays, 1, 365) : null;
  const imp = draft ? intIn(draft.importantDays, ord ?? 1, 3650) : null;
  const warn = draft ? intIn(draft.warningSizeMb, 10, 1_000_000) : null;
  const valid = ord !== null && imp !== null && warn !== null;

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: getGetSecurityRetentionQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetSecuritySummaryQueryKey() });
    onChangedRef.current();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !data || !valid || !confirmed || updateMut.isPending) return;
    setSaveError(false); setSaved(false);
    updateMut.mutate(
      { data: { revision: data.revision, ordinaryDays: ord!, importantDays: imp!, warningSizeMb: warn!, cleanupEnabled: draft.cleanupEnabled, confirmed: true } },
      {
        onSuccess: (res) => {
          const next = toDraft(res); baseRef.current = next; setDraft(next);
          qc.setQueryData(getGetSecurityRetentionQueryKey(), res);
          setConfirmed(false); setSaved(true); refreshAll();
        },
        onError: (err) => { if (status(err) === 409) setConflict(true); else setSaveError(true); },
      },
    );
  };

  const runCleanup = () => {
    setCleanupResult(null);
    cleanupMut.mutate(undefined, {
      onSuccess: (res) => {
        qc.setQueryData(getGetSecurityRetentionQueryKey(), res);
        setCleanupResult({ ok: !res.lastCleanupError, deleted: res.lastDeletedCount });
        setCleanupOpen(false); refreshAll();
      },
      onError: () => { setCleanupResult({ ok: false }); setCleanupOpen(false); refreshAll(); },
    });
  };

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => (d ? { ...d, [k]: e.target.value } : d));

  if (q.isLoading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3" data-testid="section-security-retention" aria-busy="true">
        <Skeleton className="h-5 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
        <Skeleton className="h-24" />
      </section>
    );
  }
  if (q.isError || !data || !draft) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex flex-wrap items-center gap-2" role="alert" data-testid="status-security-retention-error">
        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
        {t("securityRetention.loadError", "Не удалось загрузить настройки хранения журнала")}
        <Button size="sm" variant="outline" onClick={() => void q.refetch()} data-testid="button-security-retention-retry">{t("securityRetention.retry", "Повторить")}</Button>
      </section>
    );
  }

  const stats = [
    { k: "size", label: t("securityRetention.stat.size", "Физический объём"), v: fmtBytes(data.sizeBytes), hot: data.sizeWarning },
    { k: "rows", label: t("securityRetention.stat.rows", "Строк в журнале"), v: data.rowCount.toLocaleString() },
    { k: "occurrences", label: t("securityRetention.stat.occurrences", "Учтённых повторений"), v: data.occurrenceCount.toLocaleString() },
    { k: "expired", label: t("securityRetention.stat.expired", "Просрочено к удалению"), v: data.expiredCount.toLocaleString(), hot: data.expiredCount > 0 && !data.cleanupEnabled },
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white overflow-hidden" data-testid="section-security-retention" aria-labelledby="sr-title">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center gap-2">
        <Archive className="w-4 h-4 text-slate-500" aria-hidden="true" />
        <h3 id="sr-title" className="font-semibold text-slate-800">{t("securityRetention.title", "Хранение журнала безопасности")}</h3>
        <span className="text-xs text-slate-500 font-mono ms-auto" dir="ltr" data-testid="text-security-retention-revision">rev {data.revision}</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div key={s.k} className={cn("rounded-md border border-slate-200 p-3", s.hot && "border-amber-300 bg-amber-50")}>
              <div className="text-xs text-slate-500">{s.label}</div>
              <div className={cn("text-xl font-semibold tabular-nums mt-0.5", s.hot ? "text-amber-800" : "text-slate-800")} dir="ltr" data-testid={`stat-security-retention-${s.k}`}>{s.v}</div>
            </div>
          ))}
        </div>

        {data.sizeWarning && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2" role="status" data-testid="status-security-retention-size-warning">
            <HardDrive className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{t("securityRetention.sizeWarning", "Объём журнала превысил порог предупреждения")} ({fmtBytes(data.sizeBytes)} / {data.warningSizeMb} MB).</span>
          </div>
        )}

        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div><dt className="text-slate-500 text-xs">{t("securityRetention.lastCleanupAt", "Последняя очистка (UTC)")}</dt><dd className="font-mono text-xs text-slate-800" dir="ltr" data-testid="text-security-retention-last-cleanup">{fmtUtc(data.lastCleanupAt)}</dd></div>
          <div><dt className="text-slate-500 text-xs">{t("securityRetention.lastDeleted", "Удалено в последний раз")}</dt><dd className="tabular-nums text-slate-800" data-testid="text-security-retention-last-deleted">{data.lastDeletedCount}</dd></div>
          <div>
            <dt className="text-slate-500 text-xs">{t("securityRetention.lastError", "Ошибка последней очистки")}</dt>
            <dd className={cn("break-all", data.lastCleanupError ? "text-red-700" : "text-slate-400")} data-testid="text-security-retention-last-error">{data.lastCleanupError || "—"}</dd>
          </div>
        </dl>

        <form onSubmit={submit} className="space-y-3 border-t border-slate-100 pt-4" data-testid="form-security-retention" aria-label={t("securityRetention.formTitle", "Правила хранения")}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sr-ordinary">{t("securityRetention.ordinaryDays", "Обычные события, дней")}</Label>
              <Input id="sr-ordinary" inputMode="numeric" dir="ltr" value={draft.ordinaryDays} onChange={set("ordinaryDays")} aria-invalid={ord === null} aria-describedby="sr-ordinary-hint" data-testid="input-security-retention-ordinary" />
              <p id="sr-ordinary-hint" className={cn("text-xs", ord === null ? "text-red-700" : "text-slate-500")}>1–365</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sr-important">{t("securityRetention.importantDays", "Важные события и тревоги, дней")}</Label>
              <Input id="sr-important" inputMode="numeric" dir="ltr" value={draft.importantDays} onChange={set("importantDays")} aria-invalid={imp === null} aria-describedby="sr-important-hint" data-testid="input-security-retention-important" />
              <p id="sr-important-hint" className={cn("text-xs", imp === null ? "text-red-700" : "text-slate-500")}><span dir="ltr">{ord ?? 1}–3650</span> · {t("securityRetention.importantHint", "не меньше срока обычных")}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sr-warn">{t("securityRetention.warningSizeMb", "Порог предупреждения, MB")}</Label>
              <Input id="sr-warn" inputMode="numeric" dir="ltr" value={draft.warningSizeMb} onChange={set("warningSizeMb")} aria-invalid={warn === null} aria-describedby="sr-warn-hint" data-testid="input-security-retention-warning" />
              <p id="sr-warn-hint" className={cn("text-xs", warn === null ? "text-red-700" : "text-slate-500")}>10–1000000</p>
            </div>
          </div>

          <ul className="text-xs text-slate-600 space-y-1 rounded-md bg-slate-50 border border-slate-200 p-3" data-testid="text-security-retention-notes">
            <li className="flex gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />{t("securityRetention.note.threshold", "Порог — только предупреждение. Это не жёсткий лимит и не триггер удаления: записи удаляются лишь по сроку хранения.")}</li>
            <li className="flex gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />{t("securityRetention.note.postgres", "После удаления PostgreSQL повторно использует освободившееся место, но файл на диске может не уменьшиться.")}</li>
            <li className="flex gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />{t("securityRetention.note.aggregation", "Повторяющиеся события агрегируются: хранится только первый образец запроса/сессии и счётчик повторений, а не каждое повторение.")}</li>
          </ul>

          <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <Switch checked={draft.cleanupEnabled} onCheckedChange={(v) => setDraft((d) => (d ? { ...d, cleanupEnabled: v } : d))} data-testid="switch-security-retention-enabled" />
            {t("securityRetention.cleanupEnabled", "Плановая очистка включена")}
          </label>
          {!draft.cleanupEnabled && (
            <p className="text-xs text-amber-800 flex gap-1.5" data-testid="text-security-retention-paused">
              <PauseCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              {t("securityRetention.pausedNote", "Пауза отключает только плановую очистку: журнал будет расти. Ручной запуск очистки остаётся разрешён.")}
            </p>
          )}

          <label className="flex items-start gap-2 text-sm rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-900">
            <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" data-testid="checkbox-security-retention-confirm" aria-describedby="sr-confirm-text" />
            <span id="sr-confirm-text">{t("securityRetention.confirm", "Я понимаю, что события старше срока хранения будут безвозвратно удалены и не подлежат восстановлению.")}</span>
          </label>

          {conflict && (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex flex-wrap items-center gap-2" data-testid="status-security-retention-conflict">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              {t("securityRetention.conflict", "Настройки уже изменил другой администратор. Ваши правки не сохранены — загрузите актуальные настройки и повторите.")}
              <Button type="button" size="sm" variant="outline" onClick={() => void reloadLatest()} data-testid="button-security-retention-reload">{t("securityRetention.reload", "Загрузить актуальные")}</Button>
            </div>
          )}
          {saveError && <p role="alert" className="text-sm text-red-700" data-testid="status-security-retention-save-error">{t("securityRetention.saveError", "Не удалось сохранить настройки")}</p>}
          {saved && !dirty && <p role="status" className="text-sm text-emerald-700" data-testid="status-security-retention-saved">{t("securityRetention.saved", "Настройки сохранены")}</p>}
          {cleanupResult && (
            <p role="status" className={cn("text-sm", cleanupResult.ok ? "text-emerald-700" : "text-red-700")} data-testid="status-security-retention-cleanup-result">
              {cleanupResult.ok
                ? `${t("securityRetention.cleanupDone", "Пакет очистки выполнен, удалено")}: ${cleanupResult.deleted ?? 0}`
                : t("securityRetention.cleanupError", "Очистка завершилась ошибкой")}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="border-rose-300 text-rose-700 hover:bg-rose-50" onClick={() => setCleanupOpen(true)} disabled={cleanupMut.isPending} data-testid="button-security-retention-cleanup">
              <Trash2 className="w-4 h-4 me-1.5" aria-hidden="true" />{t("securityRetention.runCleanup", "Очистить один пакет")}
            </Button>
            <div className="ms-auto flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={discard} disabled={!dirty || updateMut.isPending} data-testid="button-security-retention-discard">
                <RotateCcw className="w-4 h-4 me-1.5" aria-hidden="true" />{t("securityRetention.discard", "Отменить правки")}
              </Button>
              <Button type="submit" size="sm" disabled={!valid || !confirmed || updateMut.isPending || conflict} data-testid="button-security-retention-save">
                <Save className="w-4 h-4 me-1.5" aria-hidden="true" />
                {updateMut.isPending ? t("securityRetention.saving", "Сохранение…") : t("securityRetention.save", "Сохранить")}
              </Button>
            </div>
          </div>
          {dirty && <p className="text-xs text-slate-500 text-end" data-testid="text-security-retention-dirty">{t("securityRetention.dirty", "Есть несохранённые правки; фоновое обновление их не перезапишет.")}</p>}
        </form>
      </div>

      <AlertDialog open={cleanupOpen} onOpenChange={(o) => { if (!cleanupMut.isPending) setCleanupOpen(o); }}>
        <AlertDialogContent data-testid="dialog-security-retention-cleanup">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("securityRetention.cleanupTitle", "Удалить один пакет просроченных событий?")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>{t("securityRetention.cleanupBody", "Будет безвозвратно удалено до 1000 событий, срок хранения которых уже истёк по сохранённым правилам. Свежие события не затрагиваются.")}</p>
                <p>{t("securityRetention.cleanupExpired", "Сейчас просрочено")}: <strong className="tabular-nums">{data.expiredCount}</strong></p>
                {dirty && <p className="text-amber-800">{t("securityRetention.cleanupUsesSaved", "Применяются сохранённые правила, а не несохранённые правки формы.")}</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleanupMut.isPending} data-testid="button-security-retention-cleanup-cancel">{t("securityRetention.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); runCleanup(); }}
              disabled={cleanupMut.isPending}
              className="bg-rose-600 hover:bg-rose-700"
              data-testid="button-security-retention-cleanup-confirm"
            >
              {cleanupMut.isPending ? t("securityRetention.cleaning", "Удаление…") : t("securityRetention.cleanupConfirm", "Удалить пакет")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
