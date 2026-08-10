import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetGoogleDriveConnection,
  useUpdateGoogleDriveConnection,
  useStartGoogleDriveOauth,
  useDisconnectGoogleDrive,
  useListGoogleDriveFolders,
  useCreateGoogleDriveFolder,
  useDeleteGoogleDriveFolder,
  useUpdateGoogleDriveFolder,
  useListEntities,
  useListEntityFields,
  useListPages,
  useListPageFields,
  getListEntityFieldsQueryKey,
  getListPageFieldsQueryKey,
  type GoogleDriveConnectionInfo,
  type DriveFolder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useT, useML } from "@/lib/i18n";
import { usePagePathLabel } from "@/lib/pagePath";
import { driveNameHash, type DriveNameSection } from "@/lib/driveNaming";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  ArrowLeft,
  Folder,
  FolderPlus,
  Trash2,
  Plus,
  Type,
  FileSignature,
} from "lucide-react";

type KeyMode = "builtin" | "own";

/** Flatten managed Drive folders into a depth-ordered list for indented display. */
function flattenDriveFolders<T extends { id: number; parentId?: number | null }>(
  folders: T[],
): { folder: T; depth: number }[] {
  const byParent = new Map<number | null, T[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(f);
  }
  const out: { folder: T; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const f of byParent.get(parent) ?? []) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default function GoogleDrivePage() {
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

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
    <div className="p-6 space-y-5 max-w-3xl">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-slate-500 hover:text-slate-800"
        onClick={() => setLocation("/admin/modules")}
      >
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        {t("modules.backToList", "К списку модулей")}
      </Button>
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

          {connected && <FolderManager t={t} />}

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

function FolderManager({ t }: { t: (key: string, fallback: string) => string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: folders = [], isLoading } = useListGoogleDriveFolders();
  const createMutation = useCreateGoogleDriveFolder();
  const deleteMutation = useDeleteGoogleDriveFolder();
  const [name, setName] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [addingParentId, setAddingParentId] = useState<number | null>(null);
  const [subName, setSubName] = useState("");
  const [templateFolder, setTemplateFolder] = useState<DriveFolder | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/google-drive/folders"] });

  const addFolder = (parentId: number | null, value: string, onDone: () => void) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    createMutation.mutate(
      { data: { name: trimmed, ...(parentId != null ? { parentId } : {}) } },
      {
        onSuccess: () => {
          onDone();
          invalidate();
          toast({ title: t("gdrive.folderCreated", "Папка создана") });
        },
        onError: () =>
          toast({ title: t("gdrive.folderCreateError", "Не удалось создать папку"), variant: "destructive" }),
      },
    );
  };

  const removeFolder = (id: number) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          setDeleteId(null);
          invalidate();
          toast({ title: t("gdrive.folderDeleted", "Папка удалена из списка") });
        },
        onError: () => {
          setDeleteId(null);
          toast({ title: t("gdrive.folderDeleteError", "Не удалось удалить папку"), variant: "destructive" });
        },
      },
    );
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{t("gdrive.foldersTitle", "Папки загрузок")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-500">
          {t(
            "gdrive.foldersHint",
            "Создавайте папки в Google Drive, между которыми распределяются загрузки. Каждое поле-файл можно привязать к своей папке. Удаление убирает папку из списка, но сама папка в Google Drive остаётся.",
          )}
        </p>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addFolder(null, name, () => setName("")); }}
            placeholder={t("gdrive.folderNamePlaceholder", "Название новой папки")}
          />
          <Button onClick={() => addFolder(null, name, () => setName(""))} disabled={!name.trim() || createMutation.isPending}>
            {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FolderPlus className="w-4 h-4 mr-1.5" />}
            {t("gdrive.folderAdd", "Создать")}
          </Button>
        </div>
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : folders.length === 0 ? (
          <p className="text-sm text-slate-400">{t("gdrive.noFolders", "Папок пока нет.")}</p>
        ) : (
          <div className="space-y-1.5">
            {flattenDriveFolders(folders).map(({ folder: f, depth }) => (
              <Fragment key={f.id}>
                <div
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2"
                  style={{ marginLeft: depth * 20 }}
                >
                  <span className="flex items-center gap-2 text-sm text-slate-700 truncate">
                    <Folder className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate">{f.name}</span>
                    {f.isDefault && (
                      <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                        {t("gdrive.folderDefault", "По умолчанию")}
                      </Badge>
                    )}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={(f.nameTemplateJson?.length ?? 0) > 0 ? "text-blue-600 hover:text-blue-700" : "text-slate-500 hover:text-slate-700"}
                      title={t("gdrive.nameTemplate", "Формирование имени файла")}
                      onClick={() => setTemplateFolder(f)}
                    >
                      <FileSignature className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-500 hover:text-slate-700"
                      title={t("gdrive.subfolderAdd", "Создать подпапку")}
                      onClick={() => {
                        setAddingParentId(addingParentId === f.id ? null : f.id);
                        setSubName("");
                      }}
                    >
                      <FolderPlus className="w-4 h-4" />
                    </Button>
                    {!f.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setDeleteId(f.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </span>
                </div>
                {addingParentId === f.id && (
                  <div className="flex gap-2" style={{ marginLeft: (depth + 1) * 20 }}>
                    <Input
                      autoFocus
                      value={subName}
                      onChange={(e) => setSubName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addFolder(f.id, subName, () => { setAddingParentId(null); setSubName(""); });
                        if (e.key === "Escape") setAddingParentId(null);
                      }}
                      placeholder={t("gdrive.subfolderPlaceholder", "Название подпапки")}
                    />
                    <Button
                      onClick={() => addFolder(f.id, subName, () => { setAddingParentId(null); setSubName(""); })}
                      disabled={!subName.trim() || createMutation.isPending}
                    >
                      {t("gdrive.folderAdd", "Создать")}
                    </Button>
                    <Button variant="ghost" onClick={() => setAddingParentId(null)}>
                      {t("common.cancel", "Отмена")}
                    </Button>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("gdrive.folderDeleteTitle", "Удалить папку из списка?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "gdrive.folderDeleteConfirm",
                "Папка и все её подпапки перестанут быть доступными для новых загрузок. Сами папки и файлы в Google Drive не удаляются. Поля, привязанные к ним, начнут использовать папку по умолчанию.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteId && removeFolder(deleteId)}
            >
              {t("gdrive.folderDeleteAction", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {templateFolder && (
        <FolderNameTemplateDialog
          folder={templateFolder}
          onClose={() => setTemplateFolder(null)}
          onSaved={() => { setTemplateFolder(null); invalidate(); }}
          t={t}
        />
      )}
    </Card>
  );
}

/**
 * One "field value" section editor. A section can hold SEVERAL field variants
 * (the same logical field, e.g. "order number", lives under different keys in
 * different entities/pages that upload into this folder). At upload time the
 * first variant with a non-empty value in the record wins.
 */
function FieldSectionPicker({
  section,
  onChange,
  t,
}: {
  section: Extract<DriveNameSection, { kind: "field" }>;
  onChange: (s: DriveNameSection) => void;
  t: (key: string, fallback: string) => string;
}) {
  const ml = useML();
  const pageLabel = usePagePathLabel();
  const { data: entities = [] } = useListEntities();
  const { data: pages = [] } = useListPages();
  // Source of the field being added: "e:<entityId>" or "p:<pageId>" (page-local).
  const [source, setSource] = useState<string>("");
  const entityId = source.startsWith("e:") ? Number(source.slice(2)) : 0;
  const pageId = source.startsWith("p:") ? Number(source.slice(2)) : 0;
  const { data: entityFields = [] } = useListEntityFields(entityId, {
    query: { enabled: entityId > 0, queryKey: getListEntityFieldsQueryKey(entityId) },
  });
  const { data: pageFields = [] } = useListPageFields(pageId, {
    query: { enabled: pageId > 0, queryKey: getListPageFieldsQueryKey(pageId) },
  });
  const sourceLabel = entityId > 0
    ? ml(entities.find((e) => e.id === entityId)?.nameJson) || ""
    : pageId > 0
      ? pageLabel(pageId)
      : "";
  const fieldOptions = (entityId > 0 ? entityFields : pageFields).map((f) => ({
    key: f.fieldKey,
    label: `${ml(f.nameJson) || f.fieldKey}${sourceLabel ? ` (${sourceLabel})` : ""}`,
  }));

  // Chosen variants: primary + alts, in order.
  const variants: { fieldKey: string; label?: string }[] = section.fieldKey
    ? [{ fieldKey: section.fieldKey, label: section.label }, ...(section.alts ?? [])]
    : [];

  const commit = (next: { fieldKey: string; label?: string }[]) => {
    const [first, ...rest] = next;
    onChange(
      first
        ? { kind: "field", fieldKey: first.fieldKey, label: first.label, alts: rest.length > 0 ? rest : undefined }
        : { kind: "field", fieldKey: "" },
    );
  };

  const addVariant = (key: string) => {
    if (variants.some((v) => v.fieldKey === key)) return;
    const opt = fieldOptions.find((f) => f.key === key);
    commit([...variants, { fieldKey: key, label: opt?.label ?? key }]);
  };

  return (
    <div className="flex-1 min-w-0 space-y-1.5">
      {variants.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {variants.map((v, idx) => (
            <Badge key={v.fieldKey} variant="secondary" className="gap-1 font-normal max-w-full">
              <span className="truncate">{v.label || v.fieldKey}</span>
              {idx === 0 && variants.length > 1 && (
                <span className="text-[10px] text-slate-400">{t("gdrive.tplPrimary", "осн.")}</span>
              )}
              <button
                type="button"
                className="text-slate-400 hover:text-red-600"
                onClick={() => commit(variants.filter((x) => x.fieldKey !== v.fieldKey))}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue placeholder={t("gdrive.tplPickSource", "Сущность / страница")} />
          </SelectTrigger>
          <SelectContent>
            {entities.map((e) => (
              <SelectItem key={`e:${e.id}`} value={`e:${e.id}`}>{ml(e.nameJson)}</SelectItem>
            ))}
            {pages.filter((p) => (p as { pageType?: string }).pageType !== "dashboard").map((p) => (
              <SelectItem key={`p:${p.id}`} value={`p:${p.id}`}>
                {t("gdrive.tplPagePrefix", "Стр.")} {pageLabel(p.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value="" onValueChange={addVariant} disabled={!source}>
          <SelectTrigger className="h-8 w-[190px] text-xs">
            <SelectValue placeholder={variants.length > 0 ? t("gdrive.tplAddVariant", "Добавить вариант поля") : t("gdrive.tplPickField", "Поле")} />
          </SelectTrigger>
          <SelectContent>
            {fieldOptions.map((f) => (
              <SelectItem key={f.key} value={f.key} disabled={variants.some((v) => v.fieldKey === f.key)}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {variants.length > 1 && (
        <p className="text-[11px] text-slate-400">
          {t("gdrive.tplVariantsHint", "Подставится первое поле, у которого в записи есть значение.")}
        </p>
      )}
    </div>
  );
}

/**
 * Per-folder file-name template editor. When enabled, uploads into the folder are
 * renamed from the sections (fixed text / record field value / random hash),
 * joined with "_", keeping the original extension.
 */
function FolderNameTemplateDialog({
  folder,
  onClose,
  onSaved,
  t,
}: {
  folder: DriveFolder;
  onClose: () => void;
  onSaved: () => void;
  t: (key: string, fallback: string) => string;
}) {
  const { toast } = useToast();
  const updateMutation = useUpdateGoogleDriveFolder();
  const initial = (folder.nameTemplateJson ?? []) as DriveNameSection[];
  const [enabled, setEnabled] = useState(initial.length > 0);
  const [sections, setSections] = useState<DriveNameSection[]>(initial.length > 0 ? initial : []);

  const setSection = (i: number, s: DriveNameSection) =>
    setSections((prev) => prev.map((x, idx) => (idx === i ? s : x)));
  const removeSection = (i: number) => setSections((prev) => prev.filter((_, idx) => idx !== i));
  const addSection = (kind: DriveNameSection["kind"]) =>
    setSections((prev) => [...prev, kind === "text" ? { kind: "text", text: "" } : kind === "field" ? { kind: "field", fieldKey: "" } : { kind: "hash" }]);

  // Live example of the resulting name.
  const preview = enabled && sections.length > 0
    ? sections
        .map((s) =>
          s.kind === "text" ? (s.text ?? "").trim() : s.kind === "hash" ? driveNameHash() : s.label || s.fieldKey ? `«${s.label || s.fieldKey}»` : "",
        )
        .filter(Boolean)
        .join("_") + ".pdf"
    : null;

  const save = () => {
    const cleaned = enabled
      ? sections.filter((s) => (s.kind === "text" ? Boolean(s.text?.trim()) : s.kind === "field" ? Boolean(s.fieldKey) : true))
      : [];
    updateMutation.mutate(
      { id: folder.id, data: { nameTemplateJson: cleaned.length > 0 ? cleaned : null } },
      {
        onSuccess: () => {
          toast({ title: t("gdrive.tplSaved", "Настройки имени файла сохранены") });
          onSaved();
        },
        onError: () => toast({ title: t("gdrive.tplSaveError", "Не удалось сохранить настройки"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="w-4 h-4 text-blue-600" />
            {t("gdrive.tplTitle", "Имя файла")} — {folder.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <span className="text-sm text-slate-700">{t("gdrive.tplEnable", "Формировать имя файла из секций")}</span>
          </div>
          {!enabled ? (
            <p className="text-sm text-slate-500">
              {t("gdrive.tplDisabledHint", "Файлы загружаются с исходным именем без изменений.")}
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-500">
                {t(
                  "gdrive.tplHint",
                  "Секции склеиваются через «_», расширение файла сохраняется. Значения полей берутся из записи, в которую загружается файл.",
                )}
              </p>
              <div className="space-y-2">
                {sections.map((s, i) => (
                  <div key={i} className="flex items-start gap-1.5 rounded-md border border-slate-100 p-2">
                    <Select
                      value={s.kind}
                      onValueChange={(kind) =>
                        setSection(i, kind === "text" ? { kind: "text", text: "" } : kind === "field" ? { kind: "field", fieldKey: "" } : { kind: "hash" })
                      }
                    >
                      <SelectTrigger className="h-8 w-[150px] text-xs shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">{t("gdrive.tplKindText", "Текст")}</SelectItem>
                        <SelectItem value="field">{t("gdrive.tplKindField", "Значение поля")}</SelectItem>
                        <SelectItem value="hash">{t("gdrive.tplKindHash", "Авто-хеш")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {s.kind === "text" && (
                      <Input
                        className="h-8 flex-1 text-sm"
                        value={s.text ?? ""}
                        onChange={(e) => setSection(i, { kind: "text", text: e.target.value })}
                        placeholder={t("gdrive.tplTextPlaceholder", "Произвольный текст")}
                      />
                    )}
                    {s.kind === "field" && (
                      <FieldSectionPicker section={s} onChange={(next) => setSection(i, next)} t={t} />
                    )}
                    {s.kind === "hash" && (
                      <span className="self-center flex-1 text-xs text-slate-500">
                        {t("gdrive.tplHashHint", "Случайный код, например")} {`${driveNameHash()}`}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 text-red-600 hover:text-red-700"
                      onClick={() => removeSection(i)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => addSection("text")}>
                  <Plus className="w-4 h-4 mr-1" />
                  {t("gdrive.tplAddSection", "Добавить секцию")}
                </Button>
              </div>
              {preview && (
                <p className="text-sm text-slate-600">
                  <Type className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
                  {t("gdrive.tplPreview", "Пример:")} <span className="font-mono">{preview}</span>
                </p>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel", "Отмена")}</Button>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={save} disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {t("common.save", "Сохранить")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
