import { Link } from "wouter";
import { ShieldAlert, HardDrive } from "lucide-react";
import { useGetSecuritySummary, getGetSecuritySummaryQueryKey, useGetSecurityRetention, getGetSecurityRetentionQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

/** Only a real (non-guest, non-impersonated) super-admin may see security evidence. */
export function useCanSeeSecurityAudit(): boolean {
  const { user, isSuperAdmin, isGuest } = useAuth();
  return !!user && isSuperAdmin && !isGuest && !user.impersonator;
}

export default function SecurityAlertBanner() {
  const t = useT();
  const authorized = useCanSeeSecurityAudit();
  const { data } = useGetSecuritySummary({
    query: {
      queryKey: getGetSecuritySummaryQueryKey(),
      enabled: authorized,
      refetchInterval: authorized ? 30_000 : false,
      staleTime: 0,
      retry: false,
    },
  });
  const { data: retention } = useGetSecurityRetention({
    query: {
      queryKey: getGetSecurityRetentionQueryKey(),
      enabled: authorized,
      refetchInterval: authorized ? 60_000 : false,
      retry: false,
    },
  });
  if (!authorized) return null;
  const alerts = !!data && data.unreviewedAlerts > 0;
  const storage = !!retention && (retention.sizeWarning || !!retention.lastCleanupError);
  if (!alerts && !storage) return null;
  return (
    <>
      {alerts && data && (
    <div
      role="alert"
      data-testid="security-alert-banner"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 bg-rose-50 border-b border-rose-200 text-sm text-rose-900"
    >
      <span className="flex items-center gap-2 font-medium">
        <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
        {t("securityAudit.banner.text", "Непросмотренные тревоги безопасности")}:{" "}
        <strong data-testid="text-security-unreviewed-count">{data.unreviewedAlerts}</strong>
      </span>
      <Link
        href="/admin/events?tab=security"
        data-testid="link-security-audit"
        className="underline underline-offset-2 hover:text-rose-700"
      >
        {t("securityAudit.banner.link", "Открыть журнал аудита")}
      </Link>
    </div>
      )}
      {storage && retention && (
        <div
          role="status"
          data-testid="security-retention-banner"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-900"
        >
          <span className="flex items-center gap-2 font-medium">
            <HardDrive className="w-4 h-4 shrink-0" aria-hidden="true" />
            {retention.lastCleanupError
              ? <span data-testid="text-security-retention-banner-error">{t("securityRetention.banner.error", "Очистка журнала безопасности завершилась ошибкой")}</span>
              : <span data-testid="text-security-retention-banner-size">{t("securityRetention.banner.size", "Журнал безопасности превысил порог объёма (это предупреждение, не лимит)")}</span>}
          </span>
          <Link href="/admin/events?tab=security" data-testid="link-security-retention" className="underline underline-offset-2 hover:text-amber-700">
            {t("securityRetention.banner.link", "Настройки хранения")}
          </Link>
        </div>
      )}
    </>
  );
}
