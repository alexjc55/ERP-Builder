import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useQuerySecurityEvents,
  exportSecurityEvents,
  useGetSecuritySummary,
  getGetSecuritySummaryQueryKey,
  useReviewSecurityEvent,
  SecurityEventQueryOutcome,
  type SecurityEvent,
  type SecurityEventPage,
  type SecurityEventQuery,
  type SecurityDisplayReference,
} from "@workspace/api-client-react";
import { useT, useML } from "@/lib/i18n";
import SecurityRetentionPanel from "./SecurityRetentionPanel";
import { useManualDataRefresh } from "@/lib/manualDataRefresh";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ShieldAlert, ShieldCheck, Info, RefreshCw, RotateCcw, Search,
  ChevronLeft, ChevronRight, Eye, Check, History, AlertTriangle, Download,
} from "lucide-react";

const PAGE_SIZE = 50; // server max 100
const MAX_OFFSET = 100_000;

type Draft = {
  from: string; to: string; action: string; outcome: string;
  actorUserId: string; targetUserId: string; agentId: string; integrationId: string;
  sessionRef: string; requestId: string; clientIp: string; loginEmail: string;
  onlyUnreviewed: boolean;
};
const EMPTY: Draft = {
  from: "", to: "", action: "", outcome: "all", actorUserId: "", targetUserId: "",
  agentId: "", integrationId: "", sessionRef: "", requestId: "", clientIp: "", loginEmail: "",
  onlyUnreviewed: false,
};

const OUTCOMES = Object.values(SecurityEventQueryOutcome);
const OUTCOME_STYLE: Record<string, string> = {
  attempt: "bg-amber-100 text-amber-800 border border-dashed border-amber-400",
  success: "bg-emerald-100 text-emerald-700",
  denied: "bg-red-100 text-red-700",
  failure: "bg-orange-100 text-orange-700",
  interrupted: "bg-slate-200 text-slate-700",
};

function posInt(v: string): number | undefined | null {
  const s = v.trim();
  if (!s) return undefined;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}
function toUtcIso(local: string): string | undefined | null {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** Returns the exact server query, or null when a field is invalid. */
function buildQuery(d: Draft): SecurityEventQuery | null {
  const q: SecurityEventQuery = {};
  const from = toUtcIso(d.from), to = toUtcIso(d.to);
  if (from === null || to === null) return null;
  if (from && to && from > to) return null;
  if (from) q.from = from;
  if (to) q.to = to;
  const ints = { actorUserId: d.actorUserId, targetUserId: d.targetUserId, agentId: d.agentId, integrationId: d.integrationId } as const;
  for (const [k, v] of Object.entries(ints)) {
    const n = posInt(v);
    if (n === null) return null;
    if (n !== undefined) q[k as keyof typeof ints] = n;
  }
  const strs: [keyof SecurityEventQuery, string, number][] = [
    ["action", d.action, 100], ["sessionRef", d.sessionRef, 64], ["requestId", d.requestId, 64],
    ["clientIp", d.clientIp, 64], ["loginEmail", d.loginEmail, 254],
  ];
  for (const [k, v, max] of strs) {
    const s = v.trim();
    if (s.length > max) return null;
    if (s) (q as Record<string, unknown>)[k] = s;
  }
  if (d.outcome !== "all") q.outcome = d.outcome as SecurityEventQuery["outcome"];
  if (d.onlyUnreviewed) q.onlyUnreviewed = true;
  return q;
}

const fmtUtc = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
};

export default function SecurityAuditPanel() {
  const t = useT();
  const ml = useML();
  const queryClient = useQueryClient();

  const summary = useGetSecuritySummary({
    query: { queryKey: getGetSecuritySummaryQueryKey(), staleTime: 0, retry: false },
  });

  const queryMut = useQuerySecurityEvents();
  const reviewMut = useReviewSecurityEvent();
  const queryFnRef = useRef(queryMut.mutateAsync);
  queryFnRef.current = queryMut.mutateAsync;
  const reviewFnRef = useRef(reviewMut.mutateAsync);
  reviewFnRef.current = reviewMut.mutateAsync;

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [applied, setApplied] = useState<{ q: SecurityEventQuery; page: number }>({ q: {}, page: 0 });
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const [invalid, setInvalid] = useState(false);

  const [result, setResult] = useState<SecurityEventPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<SecurityEvent | null>(null);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [reviewError, setReviewError] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<"large" | "failed" | null>(null);
  const exportAbort = useRef<AbortController | null>(null);

  // Latest-generation guard: only the newest request may write state; unmount invalidates all.
  const genRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; genRef.current++; exportAbort.current?.abort(); };
  }, []);

  const load = useCallback(async (clear: boolean) => {
    const gen = ++genRef.current;
    const { q, page } = appliedRef.current;
    setLoading(true);
    setError(false);
    if (clear) setResult(null);
    try {
      const res = await queryFnRef.current({ data: { ...q, limit: PAGE_SIZE, offset: page * PAGE_SIZE } });
      if (!mountedRef.current || gen !== genRef.current) return;
      setResult(res);
      setSelected((s) => (s ? res.data.find((e) => e.id === s.id) ?? s : s));
    } catch {
      if (!mountedRef.current || gen !== genRef.current) return;
      setError(true);
    } finally {
      if (mountedRef.current && gen === genRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [applied, load]);

  useManualDataRefresh(() => load(false));

  const apply = (next: Draft) => {
    const q = buildQuery(next);
    if (!q) { setInvalid(true); return; }
    setInvalid(false);
    setApplied({ q, page: 0 });
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); apply(draft); };
  const downloadExport = async () => {
    if (exportAbort.current) return;
    const q = buildQuery(draft);
    if (!q) { setInvalid(true); return; }
    setInvalid(false);
    setApplied({ q, page: 0 });
    setExportError(null);
    setExporting(true);
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      const file = await exportSecurityEvents(q, { signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      const blob = new Blob([JSON.stringify(file)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `security-audit-${file.exportedAt.replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted) {
        setExportError((error as { status?: number })?.status === 413 ? "large" : "failed");
      }
    } finally {
      exportAbort.current = null;
      if (mountedRef.current) setExporting(false);
    }
  };
  const reset = () => { setDraft(EMPTY); setInvalid(false); setApplied({ q: {}, page: 0 }); };
  const followTrail = (kind: "sessionRef" | "requestId", value: string) => {
    const next = { ...EMPTY, [kind]: value };
    setDraft(next);
    setSelected(null);
    apply(next);
  };
  const setPage = (page: number) => setApplied((a) => ({ ...a, page }));

  const acknowledge = async (ev: SecurityEvent) => {
    setReviewingId(ev.id);
    setReviewError(null);
    try {
      await reviewFnRef.current({ eventId: ev.id });
      if (!mountedRef.current) return;
      void queryClient.invalidateQueries({ queryKey: getGetSecuritySummaryQueryKey() });
      await load(false);
    } catch {
      if (mountedRef.current) setReviewError(ev.id);
    } finally {
      if (mountedRef.current) setReviewingId(null);
    }
  };

  const total = result?.total ?? 0;
  const events = result?.data ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const nextDisabled = applied.page + 1 >= totalPages || (applied.page + 1) * PAGE_SIZE > MAX_OFFSET;
  const trail = applied.q.sessionRef ?? applied.q.requestId;

  const outcomeLabel = (o: string) => t(`securityAudit.outcome.${o}`, o);
  const field = (k: keyof Draft) => ({
    id: `sa-${k}`,
    value: draft[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value })),
    "data-testid": `input-security-${k}`,
  });
  const kindLabels = {
    user: t("securityAudit.user", "Пользователь"),
    role: t("securityAudit.ref.role", "Роль"),
    entity: t("securityAudit.ref.entity", "Сущность"),
    record: t("securityAudit.ref.record", "Запись"),
    agent: t("securityAudit.detail.agent", "Агент"),
    integration: t("securityAudit.detail.integration", "Интеграция"),
  };
  const relationLabels = {
    actor: t("securityAudit.detail.actor", "Кто выполнил"),
    impersonator: t("securityAudit.detail.impersonator", "Инициатор входа от имени пользователя"),
    target: t("securityAudit.ref.target", "Объект действия"),
    reviewer: t("securityAudit.detail.reviewedBy", "Проверил"),
    agent: kindLabels.agent,
    integration: kindLabels.integration,
    requested_role: t("securityAudit.ref.requestedRole", "Запрошенная роль"),
    entity: kindLabels.entity,
    record: kindLabels.record,
  };
  const referenceText = (ref: SecurityDisplayReference) => {
    const name = ref.nameJson ? ml(ref.nameJson) : "";
    return `${kindLabels[ref.kind]}: ${name ? `${name} ` : ""}#${ref.id}${
      ref.missing ? ` — ${t("securityAudit.ref.missing", "объект удалён или не найден")}` : ""
    }`;
  };
  const named = (ev: SecurityEvent, kind: SecurityDisplayReference["kind"], id: number) => {
    const ref = ev.displayReferences?.find(r => r.kind === kind && r.id === id);
    return ref ? referenceText(ref) : `${kindLabels[kind]} #${id}`;
  };
  const who = (ev: SecurityEvent) =>
    ev.actorUserId != null ? named(ev, "user", ev.actorUserId)
      : ev.agentId != null ? named(ev, "agent", ev.agentId)
      : ev.integrationId != null ? named(ev, "integration", ev.integrationId)
      : ev.loginEmail ?? t("securityAudit.anonymous", "Не аутентифицирован");

  const stats = [
    { k: "unreviewed", v: summary.data?.unreviewedAlerts, label: t("securityAudit.stat.unreviewed", "Непросмотренные тревоги"), hot: (summary.data?.unreviewedAlerts ?? 0) > 0 },
    { k: "failedLogins", v: summary.data?.failedLogins24h, label: t("securityAudit.stat.failedLogins", "Неудачные входы, 24 ч") },
    { k: "denied", v: summary.data?.deniedRequests24h, label: t("securityAudit.stat.denied", "Отказы в доступе, 24 ч") },
    { k: "critical", v: summary.data?.criticalChanges24h, label: t("securityAudit.stat.critical", "Критические изменения, 24 ч") },
  ];

  return (
    <div className="space-y-5" data-testid="panel-security-audit">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-slate-500" aria-hidden="true" />
            {t("securityAudit.title", "Журнал аудита безопасности")}
          </h2>
          <p className="text-sm text-slate-500">{t("securityAudit.subtitle", "Доказательная запись HTTP-событий входа, отказов и критических изменений")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void downloadExport()} disabled={exporting} data-testid="button-security-export">
          <Download className="w-4 h-4 me-1.5" aria-hidden="true" />
          {exporting ? t("securityAudit.export.busy", "Подготовка файла…") : t("securityAudit.export.button", "Экспорт JSON")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => { void load(false); void summary.refetch(); }} disabled={loading} data-testid="button-security-refresh">
          <RefreshCw className={cn("w-4 h-4 me-1.5", loading && "animate-spin")} aria-hidden="true" />
          {t("securityAudit.refresh", "Обновить")}
        </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {t("securityAudit.export.hint", "Экспортируются все события по заполненным фильтрам, а не только текущая страница. До 10 000 строк / 20 МБ за один файл. Файл содержит имена, IP и сведения безопасности — передавайте его только доверенным получателям.")}
      </p>
      {exportError && <p role="alert" className="text-sm text-red-700" data-testid="security-export-error">
        {exportError === "large"
          ? t("securityAudit.export.large", "Слишком большой журнал. Сузьте период или фильтры и повторите экспорт. Частичный файл не создан.")
          : t("securityAudit.export.failed", "Не удалось выгрузить журнал. Проверьте подключение и права доступа, затем повторите экспорт.")}
      </p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.k} className={cn("border-slate-200 shadow-sm", s.hot && "border-rose-300 bg-rose-50")}>
            <CardContent className="p-4">
              <div className="text-xs text-slate-500">{s.label}</div>
              {summary.isLoading ? <Skeleton className="h-7 w-12 mt-1" /> : (
                <div className={cn("text-2xl font-semibold tabular-nums mt-0.5", s.hot ? "text-rose-700" : "text-slate-800")} data-testid={`stat-security-${s.k}`}>
                  {s.v ?? "—"}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {summary.isError && (
        <div className="flex items-center gap-2 text-sm text-red-700" role="alert" data-testid="status-security-summary-error">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          {t("securityAudit.summary.error", "Не удалось загрузить сводку")}
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void summary.refetch()} data-testid="button-security-summary-retry">
            {t("securityAudit.retry", "Повторить")}
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 space-y-2" data-testid="section-security-scope">
        <div className="font-medium text-slate-800 flex items-center gap-2">
          <Info className="w-4 h-4 text-slate-500" aria-hidden="true" />
          {t("securityAudit.scope.title", "Границы покрытия")}
        </div>
        <ul className="list-disc ps-5 space-y-1">
          <li>{t("securityAudit.scope.afterDeploy", "Записи начинаются с момента развёртывания аудита; более ранние события не восстанавливаются.")}</li>
          <li>{t("securityAudit.scope.appOpen", "Предупреждения в приложении видны только пока приложение открыто.")}</li>
          <li>{t("securityAudit.scope.ipNotIdentity", "IP-адрес не является личностью: он указывает на сеть, а не на человека.")}</li>
          <li className="font-medium text-slate-800">{t("securityAudit.scope.notCovered", "Прямые операции с базой данных, SSH и другие действия вне HTTP НЕ фиксируются.")}</li>
          {summary.data && (
            <li data-testid="text-security-proxy-attribution" className={summary.data.proxyAttribution === "socket-only" ? "text-amber-800" : undefined}>
              {summary.data.proxyAttribution === "socket-only"
                ? t("securityAudit.proxy.socketOnly", "Атрибуция IP: только сокет. Доверенный прокси не настроен, поэтому клиентский IP может быть адресом прокси или балансировщика.")
                : t("securityAudit.proxy.trusted", "Атрибуция IP: доверенный прокси. Клиентский IP взят из заголовка прокси и зависит от его честности.")}
            </li>
          )}
          <li>{t("securityAudit.attemptNote", "«Попытка» означает, что итог не был записан: запрос мог завершиться, упасть или оборваться. Это не подтверждение успеха.")}</li>
        </ul>
      </div>

      <SecurityRetentionPanel onChanged={() => { void load(false); void summary.refetch(); }} />

      <form onSubmit={onSubmit} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3" data-testid="form-security-filters" aria-label={t("securityAudit.filter.title", "Фильтры")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1"><Label htmlFor="sa-from">{t("securityAudit.filter.from", "С (местное время)")}</Label><Input type="datetime-local" {...field("from")} /></div>
          <div className="space-y-1"><Label htmlFor="sa-to">{t("securityAudit.filter.to", "По (местное время)")}</Label><Input type="datetime-local" {...field("to")} /></div>
          <div className="space-y-1"><Label htmlFor="sa-action">{t("securityAudit.filter.action", "Действие")}</Label><Input maxLength={100} dir="ltr" {...field("action")} /></div>
          <div className="space-y-1">
            <Label htmlFor="sa-outcome">{t("securityAudit.filter.outcome", "Результат")}</Label>
            <Select value={draft.outcome} onValueChange={(v) => setDraft((d) => ({ ...d, outcome: v }))}>
              <SelectTrigger id="sa-outcome" data-testid="select-security-outcome"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("securityAudit.filter.anyOutcome", "Любой результат")}</SelectItem>
                {OUTCOMES.map((o) => <SelectItem key={o} value={o}>{outcomeLabel(o)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor="sa-actorUserId">{t("securityAudit.filter.actor", "ID инициатора")}</Label><Input inputMode="numeric" dir="ltr" {...field("actorUserId")} /></div>
          <div className="space-y-1"><Label htmlFor="sa-targetUserId">{t("securityAudit.filter.target", "ID цели")}</Label><Input inputMode="numeric" dir="ltr" {...field("targetUserId")} /></div>
          <div className="space-y-1"><Label htmlFor="sa-agentId">{t("securityAudit.filter.agent", "ID агента")}</Label><Input inputMode="numeric" dir="ltr" {...field("agentId")} /></div>
          <div className="space-y-1"><Label htmlFor="sa-integrationId">{t("securityAudit.filter.integration", "ID интеграции")}</Label><Input inputMode="numeric" dir="ltr" {...field("integrationId")} /></div>
          <div className="space-y-1"><Label htmlFor="sa-sessionRef">{t("securityAudit.filter.sessionRef", "Ссылка на сессию")}</Label><Input maxLength={64} dir="ltr" autoComplete="off" spellCheck={false} className="font-mono text-xs" {...field("sessionRef")} /></div>
          <div className="space-y-1"><Label htmlFor="sa-requestId">{t("securityAudit.filter.requestId", "ID запроса")}</Label><Input maxLength={64} dir="ltr" autoComplete="off" spellCheck={false} className="font-mono text-xs" {...field("requestId")} /></div>
          <div className="space-y-1"><Label htmlFor="sa-clientIp">{t("securityAudit.filter.clientIp", "IP клиента")}</Label><Input maxLength={64} dir="ltr" className="font-mono text-xs" {...field("clientIp")} /></div>
          <div className="space-y-1"><Label htmlFor="sa-loginEmail">{t("securityAudit.filter.loginEmail", "Email попытки входа")}</Label><Input type="email" maxLength={254} dir="ltr" {...field("loginEmail")} /></div>
        </div>
        <p className="text-xs text-slate-500">{t("securityAudit.filter.refHint", "Ссылки — это идентификаторы-доказательства из журнала, а не токены доступа.")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <Switch checked={draft.onlyUnreviewed} onCheckedChange={(v) => setDraft((d) => ({ ...d, onlyUnreviewed: v }))} data-testid="switch-security-only-unreviewed" />
            {t("securityAudit.filter.onlyUnreviewed", "Только непросмотренные тревоги")}
          </label>
          <div className="ms-auto flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={reset} data-testid="button-security-reset">
              <RotateCcw className="w-4 h-4 me-1.5" aria-hidden="true" />{t("securityAudit.filter.reset", "Сбросить")}
            </Button>
            <Button type="submit" size="sm" data-testid="button-security-apply">
              <Search className="w-4 h-4 me-1.5" aria-hidden="true" />{t("securityAudit.filter.apply", "Применить")}
            </Button>
          </div>
        </div>
        {invalid && <p role="alert" className="text-sm text-red-700" data-testid="status-security-filter-invalid">{t("securityAudit.filter.invalid", "Проверьте поля: ID — целые числа от 1, даты корректны, «с» не позже «по».")}</p>}
        {trail && (
          <p className="text-xs text-slate-600" data-testid="text-security-trail">
            {t("securityAudit.filter.activeTrail", "Показана цепочка")}: <code dir="ltr" className="font-mono bg-slate-100 px-1 rounded">{trail}</code>
          </p>
        )}
      </form>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {error ? (
            <div className="px-4 py-12 text-center text-sm text-red-700" role="alert" data-testid="status-security-error">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-red-300" aria-hidden="true" />
              {t("securityAudit.error", "Не удалось загрузить журнал")}
              <div className="mt-3"><Button size="sm" variant="outline" onClick={() => void load(false)} data-testid="button-security-retry">{t("securityAudit.retry", "Повторить")}</Button></div>
            </div>
          ) : (
            <div className="overflow-x-auto" aria-busy={loading}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {[t("securityAudit.col.time", "Время (UTC)"), t("securityAudit.col.action", "Действие"), t("securityAudit.col.outcome", "Результат"), t("securityAudit.col.who", "Кто"), t("securityAudit.col.ip", "IP клиента"), t("securityAudit.col.http", "HTTP"), t("securityAudit.col.review", "Проверка"), ""].map((h, i) => (
                      <th key={i} className="text-start px-4 py-3 font-medium text-slate-600 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && !result ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-slate-100">{Array.from({ length: 8 }).map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>)}</tr>
                    ))
                  ) : events.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400" data-testid="status-security-empty">
                      <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-slate-300" aria-hidden="true" />
                      <div>{t("securityAudit.empty", "Записей по этим условиям нет")}</div>
                      <div className="text-xs mt-1">{t("securityAudit.emptyHint", "Журнал содержит только события после развёртывания аудита.")}</div>
                    </td></tr>
                  ) : events.map((ev) => (
                    <tr key={ev.id} className={cn("border-b border-slate-100 hover:bg-slate-50 align-top", ev.isAlert && !ev.reviewedAt && "bg-rose-50/60")} data-testid={`row-security-event-${ev.id}`}>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap font-mono text-xs" dir="ltr">{fmtUtc(ev.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {ev.isAlert && <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" aria-label={t("securityAudit.alert", "Тревога")} />}
                          <code dir="ltr" className="text-xs font-mono text-slate-700">{ev.action}</code>
                          {ev.detailsJson?.summaryType === "revoked-session" && (
                            <p className="text-xs text-slate-600 mt-1">{t("securityRetention.revokedSummary", "Обращения после завершения сеанса")}</p>
                          )}
                          {(ev.occurrenceCount ?? 1) > 1 && (
                            <Badge variant="outline" className="h-5 px-1.5 text-[11px] tabular-nums border-slate-300 text-slate-600" title={t("securityRetention.occurrenceHint", "Агрегированная запись: хранится только первый образец запроса/сессии")} data-testid={`text-security-occurrences-${ev.id}`}>
                              ×{ev.occurrenceCount}
                            </Badge>
                          )}
                        </div>
                        {(ev.occurrenceCount ?? 1) > 1 && ev.lastSeenAt && (
                          <div className="text-[11px] text-slate-500 mt-0.5" data-testid={`text-security-lastseen-${ev.id}`}>
                            {t("securityRetention.lastSeen", "Последнее")}: <span dir="ltr" className="font-mono">{fmtUtc(ev.lastSeenAt)}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3"><Badge variant="secondary" className={OUTCOME_STYLE[ev.outcome] ?? "bg-slate-100 text-slate-700"} data-testid={`status-security-outcome-${ev.id}`}>{outcomeLabel(ev.outcome)}</Badge></td>
                      <td className="px-4 py-3 text-slate-600 max-w-[280px] break-words">
                        <div>{who(ev)}</div>
                        {ev.displayReferences?.filter(ref => ["target", "entity", "record"].includes(ref.relation)).map(ref => (
                          <div key={`${ref.relation}-${ref.kind}-${ref.id}`} className="text-xs mt-1">
                            {t("securityAudit.ref.target", "Объект действия")}: {referenceText(ref)}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600" dir="ltr">{ev.clientIp}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600" dir="ltr">{ev.statusCode ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {!ev.isAlert ? <span className="text-slate-300">—</span> : ev.reviewedAt ? (
                          <span className="text-xs text-emerald-700 flex items-center gap-1"><Check className="w-3.5 h-3.5" aria-hidden="true" />{t("securityAudit.reviewed", "Просмотрено")}</span>
                        ) : (
                          <div>
                            <Button size="sm" variant="outline" className="h-7 border-rose-300 text-rose-700 hover:bg-rose-50" disabled={reviewingId === ev.id} onClick={() => void acknowledge(ev)} title={t("securityAudit.ackHint", "Отметка относится только к этой тревоге и не удаляет запись.")} data-testid={`button-security-ack-${ev.id}`}>
                              {t("securityAudit.ack", "Отметить просмотренной")}
                            </Button>
                            {reviewError === ev.id && <div role="alert" className="text-xs text-red-700 mt-1">{t("securityAudit.ackError", "Не удалось отметить тревогу")}</div>}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelected(ev)} data-testid={`button-security-inspect-${ev.id}`}>
                          <Eye className="w-4 h-4 me-1" aria-hidden="true" />{t("securityAudit.inspect", "Подробнее")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!error && total > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span data-testid="text-security-total">{t("securityAudit.total", "Всего")}: {total}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={applied.page === 0 || loading} onClick={() => setPage(applied.page - 1)} aria-label={t("securityAudit.prev", "Назад")} data-testid="button-security-prev">
              <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
            </Button>
            <span data-testid="text-security-page">{applied.page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={nextDisabled || loading} onClick={() => setPage(applied.page + 1)} aria-label={t("securityAudit.next", "Вперёд")} data-testid="button-security-next">
              <ChevronRight className="w-4 h-4 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto" data-testid="dialog-security-event">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selected.isAlert && <ShieldAlert className="w-5 h-5 text-rose-600" aria-hidden="true" />}
                  {t("securityAudit.detail.title", "Запись аудита")} #{selected.id}
                </DialogTitle>
                <DialogDescription><code dir="ltr" className="font-mono">{selected.action}</code> · {outcomeLabel(selected.outcome)}</DialogDescription>
              </DialogHeader>
              {selected.outcome === "attempt" && (
                <p className="text-sm rounded-md border border-dashed border-amber-400 bg-amber-50 text-amber-900 p-3">{t("securityAudit.attemptNote", "«Попытка» означает, что итог не был записан: запрос мог завершиться, упасть или оборваться. Это не подтверждение успеха.")}</p>
              )}
              {(selected.occurrenceCount ?? 1) > 1 && (
                <p className="text-sm rounded-md border border-slate-200 bg-slate-50 text-slate-700 p-3" data-testid="text-security-detail-aggregated">
                  {t("securityRetention.aggregatedNote", "Агрегированная запись: доказательства (запрос, сессия) сохранены только для первого случая, а не для каждого повторения.")}
                </p>
              )}
              {selected.detailsJson?.summaryType === "revoked-session" && (
                <p className="text-sm bg-slate-50 border rounded p-3">
                  {t("securityRetention.revokedExplanation", "Обращения с отозванной сессией объединены за 5 минут. Сохранены число обращений, время и сводка маршрутов в подробностях ниже. Основной запрос и связанные объекты — пример первого обращения. Это не доказательство атаки: причиной может быть открытая вкладка после завершения сеансов.")}
                </p>
              )}
              {selected.detailsJson?.sourceDetailsTruncated === true && (
                <p className="text-sm rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3" role="note" data-testid="text-security-detail-truncated">
                  {t("securityRetention.truncatedNote", "Несколько источников: детали по каждому источнику не сохранены (sourceDetailsTruncated).")}
                </p>
              )}
              <dl className="grid grid-cols-1 sm:grid-cols-[minmax(0,12rem)_1fr] gap-x-4 gap-y-2 text-sm">
                {([
                  ["createdAt", fmtUtc(selected.createdAt), true],
                  ["occurrenceCount", selected.occurrenceCount != null ? String(selected.occurrenceCount) : null, true],
                  ["lastSeenAt", selected.lastSeenAt ? fmtUtc(selected.lastSeenAt) : null, true],
                  ["severity", selected.severity, true],
                  ["actor", selected.actorUserId != null ? named(selected, "user", selected.actorUserId) : null, false],
                  ["impersonator", selected.impersonatorUserId != null ? named(selected, "user", selected.impersonatorUserId) : null, false],
                  ["target", selected.targetUserId != null ? named(selected, "user", selected.targetUserId) : null, false],
                  ["agent", selected.agentId != null ? named(selected, "agent", selected.agentId) : null, false],
                  ["integration", selected.integrationId != null ? named(selected, "integration", selected.integrationId) : null, false],
                  ["source", selected.authSource, true],
                  ["loginEmail", selected.loginEmail, true],
                  ["clientIp", selected.clientIp, true],
                  ["peerIp", selected.peerIp, true],
                  ["ipSource", selected.ipSource, true],
                  ["request", `${selected.method} ${selected.route}`, true],
                  ["status", selected.statusCode != null ? String(selected.statusCode) : null, true],
                  ["reason", selected.reason, false],
                  ["userAgent", selected.userAgent, true],
                  ["reviewedAt", selected.isAlert ? fmtUtc(selected.reviewedAt) : null, true],
                  ["reviewedBy", selected.reviewedBy != null ? named(selected, "user", selected.reviewedBy) : null, false],
                ] as [string, string | null | undefined, boolean][]).map(([k, v, ltr]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-500">{k === "occurrenceCount" || k === "lastSeenAt" ? t(`securityRetention.detail.${k}`, k) : t(`securityAudit.detail.${k}`, k)}</dt>
                    <dd className={cn("text-slate-800 break-all", ltr && "font-mono text-xs")} dir={ltr ? "ltr" : undefined} data-testid={`text-security-detail-${k}`}>{v || "—"}</dd>
                  </div>
                ))}
                <dt className="text-slate-500">{t("securityAudit.detail.requestId", "ID запроса (доказательство)")}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code dir="ltr" className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded break-all" data-testid="text-security-detail-requestId">{selected.requestId}</code>
                  <Button size="sm" variant="link" className="h-auto p-0" onClick={() => followTrail("requestId", selected.requestId)} data-testid="button-security-follow-request">
                    <History className="w-3.5 h-3.5 me-1" aria-hidden="true" />{t("securityAudit.detail.requestTrail", "История этого запроса")}
                  </Button>
                </dd>
                <dt className="text-slate-500">{t("securityAudit.detail.sessionRef", "Ссылка на сессию (доказательство)")}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  {selected.sessionRef ? (
                    <>
                      <code dir="ltr" className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded break-all" data-testid="text-security-detail-sessionRef">{selected.sessionRef}</code>
                      <Button size="sm" variant="link" className="h-auto p-0" onClick={() => followTrail("sessionRef", selected.sessionRef!)} data-testid="button-security-follow-session">
                        <History className="w-3.5 h-3.5 me-1" aria-hidden="true" />{t("securityAudit.detail.sessionTrail", "История этой сессии")}
                      </Button>
                    </>
                  ) : "—"}
                </dd>
              </dl>
              {!!selected.displayReferences?.length && (
                <section className="rounded-md border border-slate-200 p-3 space-y-2" data-testid="security-reference-names">
                  <h3 className="font-medium">{t("securityAudit.ref.title", "Участники и связанные объекты")}</h3>
                  <ul className="space-y-1 text-sm break-words">
                    {selected.displayReferences.map(ref => (
                      <li key={`${ref.relation}-${ref.kind}-${ref.id}`}>
                        <span className="text-slate-500">{relationLabels[ref.relation]}: </span>{referenceText(ref)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-slate-500">
                    {t("securityAudit.ref.currentNames", "Показаны текущие имена и названия, а не снимок на момент события. После удаления объекта остаётся ID. Имя учётной записи не устанавливает личность человека, выполнившего запрос.")}
                  </p>
                </section>
              )}
              <div>
                <div className="text-sm text-slate-500 mb-1">{t("securityAudit.detail.details", "Безопасные детали")}</div>
                <pre dir="ltr" className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all" data-testid="text-security-detail-json">{JSON.stringify(selected.detailsJson, null, 2)}</pre>
              </div>
              <p className="text-xs text-slate-500">{t("securityAudit.scope.ipNotIdentity", "IP-адрес не является личностью: он указывает на сеть, а не на человека.")}</p>
              <div className="flex flex-wrap justify-end gap-2">
                {selected.isAlert && !selected.reviewedAt && (
                  <Button size="sm" variant="outline" className="border-rose-300 text-rose-700" disabled={reviewingId === selected.id} onClick={() => void acknowledge(selected)} data-testid="button-security-detail-ack">
                    {t("securityAudit.ack", "Отметить просмотренной")}
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => setSelected(null)} data-testid="button-security-detail-close">{t("securityAudit.detail.close", "Закрыть")}</Button>
              </div>
              {selected.isAlert && !selected.reviewedAt && <p className="text-xs text-slate-500 text-end">{t("securityAudit.ackHint", "Отметка относится только к этой тревоге и не удаляет запись.")}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
