import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListInboundIntegrations,
  useCreateInboundIntegration,
  useUpdateInboundIntegration,
  useDeleteInboundIntegration,
  useRegenerateInboundIntegrationSecret,
  useListRoles,
  useListInboundIntegrationErrors,
  getInboundIntegration,
  type InboundIntegration,
  type InboundIntegrationCreated,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useT, useML } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Plus,
  Copy,
  KeyRound,
  Trash2,
  Pencil,
  Loader2,
  Link as LinkIcon,
  Webhook,
  Activity,
} from "lucide-react";

export default function InboundIntegrationsListPage() {
  const t = useT();
  const ml = useML();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: integrations = [], isLoading } = useListInboundIntegrations();
  const { data: roles = [] } = useListRoles();
  const { data: errorsData } = useListInboundIntegrationErrors();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InboundIntegration | null>(null);
  const [name, setName] = useState("");
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [deleting, setDeleting] = useState<InboundIntegration | null>(null);
  const [regenTarget, setRegenTarget] = useState<InboundIntegration | null>(null);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/inbound-integrations"] });

  const createMutation = useCreateInboundIntegration({
    mutation: {
      onSuccess: (res) => {
        setDialogOpen(false);
        setIssuedSecret(res.plainSecret);
        invalidate();
      },
      onError: () => toast({ title: t("inbound.createError", "Не удалось создать интеграцию"), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateInboundIntegration({
    mutation: {
      onSuccess: () => { toast({ title: t("inbound.updated", "Интеграция обновлена") }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: t("inbound.updateError", "Не удалось обновить интеграцию"), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteInboundIntegration({
    mutation: {
      onSuccess: () => { toast({ title: t("inbound.deleted", "Интеграция удалена") }); setDeleting(null); invalidate(); },
      onError: () => { toast({ title: t("inbound.deleteError", "Не удалось удалить интеграцию"), variant: "destructive" }); setDeleting(null); },
    },
  });

  const regenMutation = useRegenerateInboundIntegrationSecret({
    mutation: {
      onSuccess: (res) => { setRegenTarget(null); setIssuedSecret(res.plainSecret); invalidate(); },
      onError: () => { toast({ title: t("inbound.regenError", "Не удалось перевыпустить секрет"), variant: "destructive" }); setRegenTarget(null); },
    },
  });

  const openCreate = () => {
    setEditing(null);
    setName("");
    setRoleIds(roles[0] ? [roles[0].id] : []);
    setDialogOpen(true);
  };

  const openEdit = async (integration: InboundIntegration) => {
    try {
      const detail = await getInboundIntegration(integration.id);
      setEditing(integration);
      setName(integration.name);
      setRoleIds(detail.roleIds);
      setDialogOpen(true);
    } catch {
      toast({ title: t("inbound.loadError", "Не удалось загрузить роли интеграции"), variant: "destructive" });
    }
  };

  const submit = () => {
    if (!name.trim() || roleIds.length === 0) return;
    const data = {
      name: name.trim(),
      roleIds,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate({ data });
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: label });
    } catch {
        toast({ title: t("inbound.copyError", "Не удалось скопировать"), variant: "destructive" });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <Button
        variant="ghost"
        size="sm"
        className="-ms-2 text-slate-500 hover:text-slate-800"
        onClick={() => setLocation("/admin/modules")}
      >
        <ArrowLeft className="w-4 h-4 me-1.5" />
        {t("inbound.backToList", "К списку модулей")}
      </Button>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Webhook className="w-6 h-6 text-blue-600" />
            {t("inbound.title", "Входящие интеграции")}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">
            {t("inbound.subtitle", "Принимайте данные из внешних систем. Платформа будет слушать вебхуки и сохранять их как записи.")}
          </p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 me-1.5" />
          {t("inbound.add", "Создать интеграцию")}
        </Button>
      </div>

      {(errorsData?.unresolved ?? 0) > 0 && (
        <Card className="border-red-200 shadow-sm bg-red-50/50">
          <CardContent className="p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-red-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-red-800 mb-1">
                {t("inbound.errorsTitle", "Внимание: есть неразрешенные ошибки доставок")} ({errorsData?.unresolved})
              </h3>
              <p className="text-xs text-red-600/80 mb-3 max-w-3xl">
                {t("inbound.errorsDesc", "Некоторые входящие запросы не удалось обработать. Проверьте настройки маппинга и повторите доставку.")}
              </p>
              <div className="space-y-2">
                {errorsData?.items?.slice(0, 3).map((err) => {
                  const intName = integrations.find(i => i.id === err.integrationId)?.name || `ID: ${err.integrationId}`;
                  return (
                    <div key={err.id} className="flex items-center gap-2 text-xs bg-white/60 p-2 rounded border border-red-100">
                      <span className="font-semibold text-red-700 w-32 truncate">{intName}</span>
                      <span className="text-slate-500 w-32">{new Date(err.receivedAt).toLocaleString()}</span>
                       <span className="font-mono text-red-600 truncate flex-1">{err.errorMessage || err.errorCode || t("inbound.unknownError", "Неизвестная ошибка")}</span>
                    </div>
                  );
                })}
                {(errorsData?.unresolved ?? 0) > 3 && (
                  <div className="text-xs text-red-500 font-medium ps-2">
                    {t("inbound.moreErrors", "и еще")} {(errorsData?.unresolved ?? 0) - 3}...
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Card className="border-slate-200 shadow-sm"><CardContent className="p-6 space-y-3">
          <Skeleton className="h-5 w-1/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
        </CardContent></Card>
      ) : integrations.length === 0 ? (
        <Card className="border-slate-200 shadow-sm bg-slate-50 border-dashed"><CardContent className="p-10 text-center flex flex-col items-center">
          <Webhook className="w-10 h-10 text-slate-300 mb-3" />
          <h3 className="text-lg font-medium text-slate-700 mb-1">{t("inbound.emptyTitle", "Нет входящих интеграций")}</h3>
          <p className="text-sm text-slate-500 max-w-md mb-4">{t("inbound.empty", "Создайте первую интеграцию, чтобы начать принимать данные. Вы сможете настроить маппинг полей после создания.")}</p>
          <Button onClick={openCreate} variant="outline" className="bg-white">
            <Plus className="w-4 h-4 me-1.5" />
            {t("inbound.addFirst", "Создать первую интеграцию")}
          </Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {integrations.map((integration) => {
            const role = roles.find((r) => r.id === integration.roleId);
            return (
              <Card key={integration.id} className="border-slate-200 shadow-sm transition-all hover:shadow-md">
                <CardContent className="p-5 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-lg font-semibold text-slate-800">{integration.name}</span>
                      <Badge variant="secondary" className={integration.isActive ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-500 hover:bg-slate-100"}>
                        {integration.isActive ? t("inbound.active", "Активна") : t("inbound.inactive", "Отключена")}
                      </Badge>
                      <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                        {role ? ml(role.nameJson) : `#${integration.roleId}`}
                      </Badge>
                      {!integration.publishedMappingVersionId && (
                        <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                          {t("inbound.notPublished", "Черновик")}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
                      <div className="flex items-center gap-1">
                        <KeyRound className="w-3.5 h-3.5" />
                        {t("inbound.tokenPrefix", "Префикс ключа")}: <span className="font-mono bg-slate-100 px-1 rounded">{integration.tokenPrefix}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Activity className="w-3.5 h-3.5" />
                        {integration.lastUsedAt 
                          ? `${t("inbound.lastUsed", "Последнее обращение")}: ${new Date(integration.lastUsedAt).toLocaleString()}` 
                          : t("inbound.neverUsed", "Нет активности")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button 
                      variant="default" 
                      className="bg-slate-800 hover:bg-slate-900" 
                      onClick={() => setLocation(`/admin/inbound-integrations/${integration.id}`)}
                    >
                      {t("inbound.workspace", "В мастерскую")}
                    </Button>
                    <div className="w-px h-6 bg-slate-200 mx-1"></div>
                    <Switch
                      checked={integration.isActive}
                      onCheckedChange={(v) => updateMutation.mutate({ id: integration.id, data: { isActive: v } })}
                      title={t("inbound.toggle", "Включить/отключить")}
                    />
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-700" title={t("inbound.edit", "Изменить")} onClick={() => openEdit(integration)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-700" title={t("inbound.regen", "Перевыпустить секрет")} onClick={() => setRegenTarget(integration)}>
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50" title={t("inbound.delete", "Удалить")} onClick={() => setDeleting(integration)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("inbound.editTitle", "Настройки интеграции") : t("inbound.createTitle", "Новая входящая интеграция")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("inbound.name", "Название")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("inbound.namePlaceholder", "Например: Синхронизация лидов")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("inbound.role", "Роль (права доступа к сущностям)")}</Label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                {roles.map((role) => {
                  const checked = roleIds.includes(role.id);
                  return (
                    <label key={role.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => setRoleIds((current) => value
                          ? [...current, role.id]
                          : current.filter((id) => id !== role.id))}
                      />
                      <span>{ml(role.nameJson)}</span>
                      {roleIds[0] === role.id && (
                        <Badge variant="outline" className="ms-auto text-[10px]">{t("inbound.primaryRole", "Основная")}</Badge>
                      )}
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500">
                {t("inbound.roleHint", "Интеграция сможет создавать и обновлять только те записи, к которым есть доступ у этой роли.")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>{t("inbound.cancel", "Отмена")}</Button>
            <Button onClick={submit} disabled={saving || !name.trim() || roleIds.length === 0} className="bg-blue-600 hover:bg-blue-700">
              {saving && <Loader2 className="w-4 h-4 me-1.5 animate-spin" />}
              {editing ? t("inbound.save", "Сохранить") : t("inbound.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={issuedSecret !== null} onOpenChange={(o) => { if (!o) setIssuedSecret(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-600" />
              {t("inbound.secretTitle", "Секрет интеграции")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {t("inbound.secretOnce", "Скопируйте секрет сейчас — он показывается только один раз. Этот секрет необходимо передавать в заголовке Authorization (Bearer) при отправке вебхуков.")}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-slate-100 border border-slate-200 px-3 py-2 text-sm font-mono break-all text-slate-800">{issuedSecret}</code>
              <Button size="icon" variant="outline" onClick={() => issuedSecret && copy(issuedSecret, t("inbound.secretCopied", "Секрет скопирован"))}>
                <Copy className="w-4 h-4 text-slate-600" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIssuedSecret(null)}>{t("inbound.close", "Закрыть")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={regenTarget !== null} onOpenChange={(o) => !o && setRegenTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("inbound.regenTitle", "Перевыпустить секрет?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("inbound.regenConfirm", "Старый секрет немедленно перестанет работать и все внешние системы, использующие его, потеряют доступ. Новый секрет будет показан один раз.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("inbound.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => regenTarget && regenMutation.mutate({ id: regenTarget.id })}>
              {t("inbound.regenBtn", "Перевыпустить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("inbound.deleteTitle", "Удалить интеграцию?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("inbound.deleteConfirm", "Прием данных будет немедленно прекращен. История доставок и ошибки будут сохранены.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("inbound.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleting && deleteMutation.mutate({ id: deleting.id })}>
              {t("inbound.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}