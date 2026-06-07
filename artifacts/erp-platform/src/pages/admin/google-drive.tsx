import { useEffect, useMemo, useState } from "react";
import {
  useGetGoogleDriveConnection,
  useUpdateGoogleDriveConnection,
  useStartGoogleDriveOauth,
  useDisconnectGoogleDrive,
  type GoogleDriveConnectionInfo,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  HardDrive,
  Check,
  X,
  Copy,
  ExternalLink,
  Loader2,
  Link2Off,
  RefreshCw,
} from "lucide-react";

type KeyMode = "builtin" | "own";

export default function GoogleDrivePage() {
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetGoogleDriveConnection();
  const conn = data as GoogleDriveConnectionInfo | undefined;

  const [keyMode, setKeyMode] = useState<KeyMode>("own");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);

  // Sync local form from server state once loaded.
  useEffect(() => {
    if (!conn) return;
    setKeyMode(conn.keyMode);
    setClientId(conn.ownClientId ?? "");
  }, [conn]);

  // Surface the OAuth callback result (redirected back with ?drive=...).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const drive = params.get("drive");
    if (!drive) return;
    if (drive === "connected") {
      toast({ title: t("gdrive.connectedToast", "Google Drive подключён") });
    } else if (drive === "error") {
      toast({ title: t("gdrive.connectError", "Не удалось подключить Google Drive"), variant: "destructive" });
    }
    params.delete("drive");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    queryClient.invalidateQueries({ queryKey: ["/api/google-drive/connection"] });
    queryClient.invalidateQueries({ queryKey: ["/api/google-drive/status"] });
  }, [toast, t, queryClient]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/google-drive/connection"] });
    queryClient.invalidateQueries({ queryKey: ["/api/google-drive/status"] });
  };

  const updateMutation = useUpdateGoogleDriveConnection({
    mutation: {
      onSuccess: () => { toast({ title: t("gdrive.saved", "Настройки сохранены") }); setClientSecret(""); invalidate(); },
      onError: () => toast({ title: t("gdrive.saveError", "Ошибка сохранения настроек"), variant: "destructive" }),
    },
  });
  const startMutation = useStartGoogleDriveOauth({
    mutation: {
      onSuccess: (res) => {
        const url = (res as { authUrl?: string })?.authUrl;
        if (url) window.location.href = url;
      },
      onError: () => toast({ title: t("gdrive.startError", "Не удалось начать подключение"), variant: "destructive" }),
    },
  });
  const disconnectMutation = useDisconnectGoogleDrive({
    mutation: {
      onSuccess: () => { toast({ title: t("gdrive.disconnected", "Google Drive отключён") }); setDisconnecting(false); invalidate(); },
      onError: () => { toast({ title: t("gdrive.disconnectError", "Ошибка отключения"), variant: "destructive" }); setDisconnecting(false); },
    },
  });

  const saving = updateMutation.isPending;
  const builtinAvailable = conn?.builtinAvailable ?? false;
  const connected = conn?.connected ?? false;
  const redirectUri = conn?.redirectUri ?? "";

  const credsReady = useMemo(() => {
    if (keyMode === "builtin") return builtinAvailable;
    // own: stored creds OR a freshly filled form
    return Boolean(conn?.hasOwnCreds) || (clientId.trim() !== "" && clientSecret.trim() !== "");
  }, [keyMode, builtinAvailable, conn?.hasOwnCreds, clientId, clientSecret]);

  const saveConnection = () => {
    const payload: { keyMode: KeyMode; ownClientId?: string; ownClientSecret?: string } = { keyMode };
    if (keyMode === "own") {
      payload.ownClientId = clientId.trim();
      if (clientSecret.trim()) payload.ownClientSecret = clientSecret.trim();
    }
    updateMutation.mutate({ data: payload });
  };

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      toast({ title: t("gdrive.copied", "Скопировано") });
    } catch {
      toast({ title: t("gdrive.copyError", "Не удалось скопировать"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <HardDrive className="w-6 h-6 text-blue-600" />
            {t("gdrive.title", "Google Drive")}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {t("gdrive.subtitle", "Подключите Google Drive для загрузки файлов в полях типа «файл»")}
          </p>
        </div>
        {!isLoading && (
          <Badge
            variant="secondary"
            className={connected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}
          >
            {connected ? (
              <><Check className="w-3.5 h-3.5 mr-1" />{t("gdrive.statusConnected", "Подключено")}</>
            ) : (
              <><X className="w-3.5 h-3.5 mr-1" />{t("gdrive.statusDisconnected", "Не подключено")}</>
            )}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <Card className="border-slate-200 shadow-sm"><CardContent className="p-6 space-y-3">
          <Skeleton className="h-5 w-1/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
        </CardContent></Card>
      ) : (
        <>
          {/* Status card */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader><CardTitle className="text-base">{t("gdrive.statusTitle", "Состояние подключения")}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label={t("gdrive.account", "Аккаунт")} value={conn?.accountEmail || "—"} />
              <Row label={t("gdrive.folder", "Папка загрузок")} value={conn?.folderName || "—"} />
              <Row
                label={t("gdrive.mode", "Режим ключей")}
                value={conn?.keyMode === "builtin" ? t("gdrive.modeBuiltin", "Встроенные") : t("gdrive.modeOwn", "Собственные")}
              />
              {connected ? (
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
                    {startMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
                    {t("gdrive.reconnect", "Переподключить")}
                  </Button>
                  <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setDisconnecting(true)}>
                    <Link2Off className="w-4 h-4 mr-1.5" />
                    {t("gdrive.disconnect", "Отключить")}
                  </Button>
                </div>
              ) : (
                <div className="pt-2">
                  <Button size="sm" onClick={() => startMutation.mutate()} disabled={!credsReady || startMutation.isPending}>
                    {startMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <HardDrive className="w-4 h-4 mr-1.5" />}
                    {t("gdrive.connect", "Подключить Google Drive")}
                  </Button>
                  {!credsReady && (
                    <p className="text-xs text-slate-400 mt-1.5">
                      {keyMode === "own"
                        ? t("gdrive.needCreds", "Сначала сохраните Client ID и Client Secret ниже")
                        : t("gdrive.builtinUnavailable", "Встроенные ключи недоступны — переключитесь на собственные")}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Key mode + own creds */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader><CardTitle className="text-base">{t("gdrive.credsTitle", "Ключи OAuth")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <ModeButton active={keyMode === "builtin"} disabled={!builtinAvailable} onClick={() => setKeyMode("builtin")}>
                  {t("gdrive.modeBuiltin", "Встроенные")}
                  {!builtinAvailable && <span className="ml-1 text-xs opacity-70">({t("gdrive.unavailable", "недоступно")})</span>}
                </ModeButton>
                <ModeButton active={keyMode === "own"} onClick={() => setKeyMode("own")}>
                  {t("gdrive.modeOwn", "Собственные")}
                </ModeButton>
              </div>

              {keyMode === "own" ? (
                <div className="space-y-4">
                  <WizardSteps t={t} redirectUri={redirectUri} onCopy={copyRedirect} />
                  <div className="space-y-1.5">
                    <Label>{t("gdrive.clientId", "Client ID")}</Label>
                    <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxxxxx.apps.googleusercontent.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("gdrive.clientSecret", "Client Secret")}</Label>
                    <Input
                      type="password"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder={conn?.hasOwnCreds ? t("gdrive.secretStored", "•••••• (сохранён, оставьте пустым чтобы не менять)") : ""}
                    />
                  </div>
                  <Button onClick={saveConnection} disabled={saving}>
                    {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                    {t("gdrive.save", "Сохранить ключи")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-500">
                    {builtinAvailable
                      ? t("gdrive.builtinReady", "Используются встроенные ключи платформы. Нажмите «Сохранить», затем подключите Google Drive.")
                      : t("gdrive.builtinMissing", "Встроенные ключи не настроены в этой установке. Выберите режим «Собственные».")}
                  </p>
                  <Button onClick={saveConnection} disabled={saving || !builtinAvailable}>
                    {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                    {t("gdrive.save", "Сохранить")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={disconnecting} onOpenChange={(o) => !o && setDisconnecting(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("gdrive.disconnectConfirmTitle", "Отключить Google Drive?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("gdrive.disconnectConfirm", "Токен доступа будет удалён. Уже загруженные файлы останутся в Google Drive, но новые загрузки станут недоступны до повторного подключения.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => { setDisconnecting(true); disconnectMutation.mutate(); }}
            >
              {t("gdrive.disconnect", "Отключить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1 border-b border-slate-50 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-700 font-medium truncate max-w-[60%]">{value}</span>
    </div>
  );
}

function ModeButton({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "px-3 py-1.5 rounded-md text-sm border transition-colors " +
        (active
          ? "bg-blue-600 text-white border-blue-600"
          : disabled
            ? "bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed"
            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")
      }
    >
      {children}
    </button>
  );
}

function WizardSteps({ t, redirectUri, onCopy }: { t: ReturnType<typeof useT>; redirectUri: string; onCopy: () => void }) {
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 space-y-2.5 text-sm">
      <div className="font-medium text-slate-700">{t("gdrive.wizardTitle", "Как получить ключи (бесплатный аккаунт Gmail)")}</div>
      <ol className="list-decimal list-inside space-y-1.5 text-slate-600">
        <li>
          {t("gdrive.step1", "Откройте")}{" "}
          <a className="text-blue-600 hover:underline inline-flex items-center gap-0.5" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
            Google Cloud Console <ExternalLink className="w-3 h-3" />
          </a>{" "}
          {t("gdrive.step1b", "и создайте проект.")}
        </li>
        <li>
          {t("gdrive.step2", "Включите")}{" "}
          <a className="text-blue-600 hover:underline inline-flex items-center gap-0.5" href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">
            Google Drive API <ExternalLink className="w-3 h-3" />
          </a>.
        </li>
        <li>
          {t("gdrive.step3", "В разделе")}{" "}
          <a className="text-blue-600 hover:underline inline-flex items-center gap-0.5" href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noreferrer">
            OAuth consent screen <ExternalLink className="w-3 h-3" />
          </a>{" "}
          {t("gdrive.step3b", "выберите «External», добавьте себя в Test users.")}
        </li>
        <li>
          {t("gdrive.step4", "В разделе")}{" "}
          <a className="text-blue-600 hover:underline inline-flex items-center gap-0.5" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
            Credentials <ExternalLink className="w-3 h-3" />
          </a>{" "}
          {t("gdrive.step4b", "создайте «OAuth client ID» → тип «Web application».")}
        </li>
        <li>
          {t("gdrive.step5", "Добавьте этот Redirect URI:")}
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 text-xs bg-white border border-slate-200 rounded px-2 py-1 font-mono break-all">{redirectUri || "—"}</code>
            <Button type="button" variant="outline" size="sm" onClick={onCopy} disabled={!redirectUri}>
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
        </li>
        <li>{t("gdrive.step6", "Скопируйте Client ID и Client Secret в поля ниже и сохраните.")}</li>
      </ol>
    </div>
  );
}
