import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListModules,
  useCreateModule,
  useUpdateModule,
  useDeleteModule,
  type Module,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useML, useT } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { MultilingualInput } from "@/components/MultilingualInput";
import { useToast } from "@/hooks/use-toast";
import { Puzzle, Pencil, Trash2, Settings2 } from "lucide-react";

type MLValue = { ru?: string; en?: string; he?: string };

const MODULE_KEY_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Modules with a dedicated settings screen (vs. the generic JSON editor). These
 * are platform-managed system modules: toggle on/off here, configure via their
 * own page; they cannot be edited as raw JSON or deleted.
 */
const MODULE_SETTINGS_ROUTES: Record<string, string> = {
  google_drive: "/admin/google-drive",
};

export default function ModulesPage() {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data, isLoading } = useListModules();
  const modules: Module[] = data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Module | null>(null);
  const [moduleKey, setModuleKey] = useState("");
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [version, setVersion] = useState("1.0.0");
  const [isEnabled, setIsEnabled] = useState(false);
  const [settingsText, setSettingsText] = useState("{}");
  const [deleting, setDeleting] = useState<Module | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/modules"] });

  const createMutation = useCreateModule({
    mutation: {
      onSuccess: () => { toast({ title: t("modules.created", "Модуль зарегистрирован") }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: t("modules.createError", "Ошибка регистрации модуля"), variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateModule({
    mutation: {
      onSuccess: () => { toast({ title: t("modules.updated", "Модуль обновлён") }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: t("modules.updateError", "Ошибка обновления модуля"), variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteModule({
    mutation: {
      onSuccess: () => { toast({ title: t("modules.deleted", "Модуль удалён") }); setDeleting(null); invalidate(); },
      onError: () => toast({ title: t("modules.deleteError", "Ошибка удаления модуля"), variant: "destructive" }),
    },
  });

  const openEdit = (m: Module) => {
    setEditing(m);
    setModuleKey(m.moduleKey);
    setNameJson((m.nameJson as MLValue) ?? {});
    setVersion(m.version);
    setIsEnabled(m.isEnabled);
    setSettingsText(JSON.stringify(m.settingsJson ?? {}, null, 2));
    setDialogOpen(true);
  };

  const parseSettings = (): Record<string, unknown> | null => {
    const raw = settingsText.trim();
    if (raw === "") return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const submit = () => {
    const name = (nameJson.ru ?? nameJson.en ?? nameJson.he ?? "").trim();
    if (!name) {
      toast({ title: t("modules.nameRequired", "Укажите название"), variant: "destructive" });
      return;
    }
    const settings = parseSettings();
    if (settings === null) {
      toast({ title: t("modules.settingsInvalid", "Настройки должны быть корректным JSON-объектом"), variant: "destructive" });
      return;
    }

    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        data: { nameJson, version, isEnabled, settingsJson: settings },
      });
    } else {
      const key = moduleKey.trim();
      if (!MODULE_KEY_RE.test(key)) {
        toast({ title: t("modules.keyInvalid", "Ключ: строчные латинские буквы, цифры, _; начинается с буквы"), variant: "destructive" });
        return;
      }
      createMutation.mutate({
        data: { moduleKey: key, nameJson, version, isEnabled, settingsJson: settings },
      });
    }
  };

  const toggleEnabled = (m: Module, value: boolean) => {
    updateMutation.mutate({ id: m.id, data: { isEnabled: value } });
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("modules.title", "Модули")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {t("modules.subtitle", "Реестр модулей — инфраструктура для будущих плагинов")}
          </p>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("modules.col.name", "Название")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-48">{t("modules.col.key", "Ключ")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-28">{t("modules.col.version", "Версия")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-32">{t("modules.col.status", "Статус")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 w-28">{t("modules.col.actions", "Действия")}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : modules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                      <Puzzle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      {t("modules.empty", "Модулей пока нет")}
                    </td>
                  </tr>
                ) : (
                  modules.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-700">{ml(m.nameJson) || m.moduleKey}</td>
                      <td className="px-4 py-3">
                        <code className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">{m.moduleKey}</code>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{m.version}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Switch checked={m.isEnabled} onCheckedChange={(v) => toggleEnabled(m, v)} />
                          <Badge variant="secondary" className={m.isEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}>
                            {m.isEnabled ? t("modules.enabled", "Включён") : t("modules.disabled", "Выключен")}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {MODULE_SETTINGS_ROUTES[m.moduleKey] ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setLocation(MODULE_SETTINGS_ROUTES[m.moduleKey])}
                            >
                              <Settings2 className="w-4 h-4 mr-1.5" />
                              {t("modules.openSettings", "Настройки")}
                            </Button>
                          ) : (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setDeleting(m)}>
                                <Trash2 className="w-4 h-4 text-red-500" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("modules.editTitle", "Редактировать модуль") : t("modules.newTitle", "Новый модуль")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput
              label={t("modules.name", "Название")}
              value={nameJson}
              onChange={setNameJson}
              required
            />
            <div className="space-y-1.5">
              <Label>{t("modules.key", "Системный ключ")}</Label>
              <Input
                value={moduleKey}
                onChange={(e) => setModuleKey(e.target.value)}
                placeholder="whatsapp"
                disabled={!!editing}
              />
              {editing && (
                <p className="text-xs text-slate-400">{t("modules.keyImmutable", "Ключ нельзя изменить после создания")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t("modules.version", "Версия")}</Label>
              <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 p-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{t("modules.enable", "Включён")}</p>
                <p className="text-xs text-slate-500">{t("modules.enableDesc", "Активные модули доступны платформе")}</p>
              </div>
              <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("modules.settings", "Настройки (JSON)")}</Label>
              <Textarea
                value={settingsText}
                onChange={(e) => setSettingsText(e.target.value)}
                rows={6}
                className="font-mono text-xs"
                placeholder="{}"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel", "Отмена")}
            </Button>
            <Button onClick={submit} disabled={saving}>
              {t("common.save", "Сохранить")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("modules.deleteTitle", "Удалить модуль?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("modules.deleteDesc", "Это действие нельзя отменить.")}
              {deleting ? ` (${deleting.moduleKey})` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate({ id: deleting.id })}
              className="bg-red-600 hover:bg-red-700"
            >
              {t("common.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
