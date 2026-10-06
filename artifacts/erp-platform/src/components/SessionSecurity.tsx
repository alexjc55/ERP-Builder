import { useState } from "react";
import { useRevokeOwnSessions, useRevokeAllSessions } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export function SessionSecurity() {
  const { user, isSuperAdmin, logout } = useAuth();
  const t = useT();
  const { toast } = useToast();
  const own = useRevokeOwnSessions();
  const all = useRevokeAllSessions();
  const [scope, setScope] = useState<"own" | "all" | null>(null);
  const pending = own.isPending || all.isPending;
  if (!user || user.isGuest || user.impersonator) return null;
  const confirm = async () => {
    try {
      if (scope === "all") await all.mutateAsync();
      else if (scope === "own") await own.mutateAsync();
      else return;
      logout();
    } catch {
      toast({ title: t("sessions.error", "Не удалось отозвать сессии"), variant: "destructive" });
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle>{t("sessions.title", "Безопасность сессий")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("sessions.hint", "Завершение сессий требует повторного входа. Ключи ИИ-агентов, интеграций и гостевые ссылки не отзываются.")}</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setScope("own")}>{t("sessions.own", "Завершить все мои сессии")}</Button>
          {isSuperAdmin && <Button variant="destructive" onClick={() => setScope("all")}>{t("sessions.all", "Завершить сессии всех пользователей")}</Button>}
        </div>
        <Dialog open={scope !== null} onOpenChange={(open) => { if (!open && !pending) setScope(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("sessions.title", "Безопасность сессий")}</DialogTitle>
              <DialogDescription>{scope === "all"
                ? t("sessions.confirmAll", "Все пользователи, включая вас, потеряют текущие сессии и должны будут войти заново. Несохранённые изменения могут быть потеряны. Продолжить?")
                : t("sessions.confirmOwn", "Все ваши сессии, включая текущую, будут завершены. Потребуется повторный вход. Продолжить?")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={() => setScope(null)}>{t("common.cancel", "Отмена")}</Button>
              <Button variant="destructive" disabled={pending} onClick={confirm}>{t("sessions.confirm", "Завершить сессии")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
