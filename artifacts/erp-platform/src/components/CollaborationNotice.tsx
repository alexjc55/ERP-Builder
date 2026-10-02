import type { CollaborationFailure } from "@/lib/useCollaboration";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function CollaborationNotice({ reason }: { reason: CollaborationFailure | null }) {
  const t = useT();
  const { logout } = useAuth();
  if (!reason) return null;
  const text = reason === "session_expired"
    ? t("collaboration.sessionExpired", "Сессия истекла. Войдите снова для совместной работы.")
    : reason === "access_denied"
      ? t("collaboration.accessDenied", "Нет доступа к совместной работе. Проверяем возврат доступа каждые 30 секунд.")
      : t("collaboration.networkLost", "Связь потеряна. Подключение восстановится автоматически.");
  return <div role="status" data-testid="collaboration-notice" data-reason={reason} className="text-xs text-amber-800 bg-amber-50 rounded-md px-3 py-2">
    {text}
    {reason === "session_expired" && <Button variant="link" size="sm" onClick={logout}>
      {t("collaboration.signInAgain", "Войти снова")}
    </Button>}
  </div>;
}