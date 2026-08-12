import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListAiAgents,
  useCreateAiAgent,
  useUpdateAiAgent,
  useDeleteAiAgent,
  useRegenerateAiAgentKey,
  useListRoles,
  type AiAgent,
  type AiAgentMask,
  type AiAgentWithKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useT, useML } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  Bot,
  ArrowLeft,
  Plus,
  Copy,
  KeyRound,
  Trash2,
  Pencil,
  Loader2,
  Link as LinkIcon,
} from "lucide-react";

const MASKS: AiAgentMask[] = ["full", "read", "read_edit", "read_edit_create", "read_edit_create_delete"];

function maskLabel(t: (k: string, d: string) => string, mask: string): string {
  switch (mask) {
    case "full": return t("aiAgents.maskFull", "Как у роли (без ограничений)");
    case "read": return t("aiAgents.maskRead", "Только чтение");
    case "read_edit": return t("aiAgents.maskReadEdit", "Чтение и редактирование");
    case "read_edit_create": return t("aiAgents.maskReadEditCreate", "Чтение, редактирование и создание");
    case "read_edit_create_delete": return t("aiAgents.maskAll", "Чтение, редактирование, создание и удаление");
    default: return mask;
  }
}

export default function AiAgentsPage() {
  const t = useT();
  const ml = useML();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: agents = [], isLoading } = useListAiAgents();
  const { data: roles = [] } = useListRoles();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AiAgent | null>(null);
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState<string>("");
  const [mask, setMask] = useState<AiAgentMask>("read");
  const [deleting, setDeleting] = useState<AiAgent | null>(null);
  const [regenTarget, setRegenTarget] = useState<AiAgent | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  const apiBase = `${window.location.origin}/api`;
  const schemaUrl = `${apiBase}/agent-api/schema`;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/ai-agents"] });

  const createMutation = useCreateAiAgent({
    mutation: {
      onSuccess: (res: AiAgentWithKey) => {
        setDialogOpen(false);
        setIssuedKey(res.plainKey);
        invalidate();
      },
      onError: () => toast({ title: t("aiAgents.createError", "Не удалось создать агента"), variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateAiAgent({
    mutation: {
      onSuccess: () => { toast({ title: t("aiAgents.updated", "Агент обновлён") }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: t("aiAgents.updateError", "Не удалось обновить агента"), variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteAiAgent({
    mutation: {
      onSuccess: () => { toast({ title: t("aiAgents.deleted", "Агент удалён, ключ отозван") }); setDeleting(null); invalidate(); },
      onError: () => { toast({ title: t("aiAgents.deleteError", "Не удалось удалить агента"), variant: "destructive" }); setDeleting(null); },
    },
  });
  const regenMutation = useRegenerateAiAgentKey({
    mutation: {
      onSuccess: (res: AiAgentWithKey) => { setRegenTarget(null); setIssuedKey(res.plainKey); invalidate(); },
      onError: () => { toast({ title: t("aiAgents.regenError", "Не удалось перевыпустить ключ"), variant: "destructive" }); setRegenTarget(null); },
    },
  });

  const openCreate = () => {
    setEditing(null);
    setName("");
    setRoleId(roles[0] ? String(roles[0].id) : "");
    setMask("read");
    setDialogOpen(true);
  };
  const openEdit = (a: AiAgent) => {
    setEditing(a);
    setName(a.name);
    setRoleId(String(a.roleId));
    setMask(a.capabilityMask);
    setDialogOpen(true);
  };
  const submit = () => {
    if (!name.trim() || !roleId) return;
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: { name: name.trim(), roleId: Number(roleId), capabilityMask: mask } });
    } else {
      createMutation.mutate({ data: { name: name.trim(), roleId: Number(roleId), capabilityMask: mask } });
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: label });
    } catch {
      toast({ title: t("aiAgents.copyError", "Не удалось скопировать"), variant: "destructive" });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-5 max-w-4xl">
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
            <Bot className="w-6 h-6 text-blue-600" />
            {t("aiAgents.title", "ИИ-агенты")}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {t("aiAgents.subtitle", "Ключи доступа к API для внешних ИИ-агентов (например, GPT с Actions). Агент получает права выбранной роли, ограниченные маской.")}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1.5" />
          {t("aiAgents.add", "Создать агента")}
        </Button>
      </div>

      {/* API connection info */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><LinkIcon className="w-4 h-4 text-blue-600" />{t("aiAgents.apiTitle", "Подключение внешнего агента")}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <UrlRow label={t("aiAgents.apiBase", "Базовый URL API")} value={apiBase} onCopy={() => copy(apiBase, t("aiAgents.copied", "Скопировано"))} />
          <UrlRow label={t("aiAgents.schemaUrl", "OpenAPI-схема для агента (импортируйте в GPT Actions)")} value={schemaUrl} onCopy={() => copy(schemaUrl, t("aiAgents.copied", "Скопировано"))} />
          <p className="text-xs text-slate-500">
            {t("aiAgents.apiHint", "В настройках внешнего агента укажите схему по ссылке выше и авторизацию Bearer с ключом агента. Схема содержит поиск записей, карточку записи, историю статусов и скачивание файлов.")}
          </p>
        </CardContent>
      </Card>

      {/* Agents list */}
      {isLoading ? (
        <Card className="border-slate-200 shadow-sm"><CardContent className="p-6 space-y-3">
          <Skeleton className="h-5 w-1/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
        </CardContent></Card>
      ) : agents.length === 0 ? (
        <Card className="border-slate-200 shadow-sm"><CardContent className="p-8 text-center text-sm text-slate-400">
          {t("aiAgents.empty", "Агентов пока нет. Создайте первого — ключ будет показан один раз.")}
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {agents.map((a) => {
            const role = roles.find((r) => r.id === a.roleId);
            return (
              <Card key={a.id} className="border-slate-200 shadow-sm">
                <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-800">{a.name}</span>
                      <Badge variant="secondary" className={a.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}>
                        {a.isActive ? t("aiAgents.active", "Активен") : t("aiAgents.inactive", "Отключён")}
                      </Badge>
                      <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                        {role ? ml(role.nameJson) : `#${a.roleId}`}
                      </Badge>
                      <Badge variant="secondary" className="bg-slate-100 text-slate-600">
                        {maskLabel(t, a.capabilityMask)}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {t("aiAgents.keyPrefix", "Ключ")}: <span className="font-mono">{a.tokenPrefix}</span>
                      {a.lastUsedAt && (
                        <> · {t("aiAgents.lastUsed", "Последнее обращение")}: {new Date(a.lastUsedAt).toLocaleString()}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={a.isActive}
                      onCheckedChange={(v) => updateMutation.mutate({ id: a.id, data: { isActive: v } })}
                      title={t("aiAgents.toggle", "Включить/отключить агента")}
                    />
                    <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-700" title={t("common.edit", "Изменить")} onClick={() => openEdit(a)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-700" title={t("aiAgents.regen", "Перевыпустить ключ")} onClick={() => setRegenTarget(a)}>
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" title={t("common.delete", "Удалить")} onClick={() => setDeleting(a)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("aiAgents.editTitle", "Настройки агента") : t("aiAgents.createTitle", "Новый ИИ-агент")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("aiAgents.name", "Название")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("aiAgents.namePlaceholder", "Например: Эва")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("aiAgents.role", "Роль (границы доступа)")}</Label>
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger><SelectValue placeholder={t("aiAgents.rolePick", "Выберите роль")} /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>{ml(r.nameJson)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("aiAgents.mask", "Возможности в рамках роли")}</Label>
              <Select value={mask} onValueChange={(v) => setMask(v as AiAgentMask)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MASKS.map((m) => (
                    <SelectItem key={m} value={m}>{maskLabel(t, m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">
                {t("aiAgents.maskHint", "Маска только сужает права роли: скрытые поля, статусы и области видимости роли действуют всегда.")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>{t("common.cancel", "Отмена")}</Button>
            <Button onClick={submit} disabled={saving || !name.trim() || !roleId}>
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {editing ? t("common.save", "Сохранить") : t("aiAgents.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Key shown once */}
      <Dialog open={issuedKey !== null} onOpenChange={(o) => { if (!o) setIssuedKey(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-600" />
              {t("aiAgents.keyTitle", "Ключ агента")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {t("aiAgents.keyOnce", "Скопируйте ключ сейчас — он показывается только один раз. Потом его можно будет только перевыпустить.")}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-slate-100 px-3 py-2 text-sm font-mono break-all">{issuedKey}</code>
              <Button size="sm" onClick={() => issuedKey && copy(issuedKey, t("aiAgents.keyCopied", "Ключ скопирован"))}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIssuedKey(null)}>{t("common.close", "Закрыть")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regenerate confirm */}
      <AlertDialog open={regenTarget !== null} onOpenChange={(o) => !o && setRegenTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("aiAgents.regenTitle", "Перевыпустить ключ?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("aiAgents.regenConfirm", "Старый ключ немедленно перестанет работать. Новый ключ будет показан один раз.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => regenTarget && regenMutation.mutate({ id: regenTarget.id })}>
              {t("aiAgents.regen", "Перевыпустить ключ")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("aiAgents.deleteTitle", "Удалить агента?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("aiAgents.deleteConfirm", "Ключ будет отозван немедленно, доступ агента к API прекратится. История его действий в журнале сохранится.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleting && deleteMutation.mutate({ id: deleting.id })}>
              {t("common.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UrlRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-mono break-all">{value}</code>
        <Button variant="outline" size="sm" onClick={onCopy}><Copy className="w-3.5 h-3.5" /></Button>
      </div>
    </div>
  );
}
