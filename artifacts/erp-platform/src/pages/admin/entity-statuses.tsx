import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useListEntityStatuses,
  useCreateEntityStatus,
  useUpdateStatus,
  useDeleteStatus,
  useListEntities,
  type Status,
  type Entity,
  type MultilingualText,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Skeleton } from "@/components/ui/skeleton";
import { MultilingualInput } from "@/components/MultilingualInput";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, ArrowLeft, CircleDot, Star, Flag, Archive } from "lucide-react";
import { useML, useT } from "@/lib/i18n";

type MLValue = { ru?: string; en?: string; he?: string };

const PRESET_COLORS = [
  "#6b7280",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

export default function EntityStatusesPage() {
  const ml = useML();
  const t = useT();
  const params = useParams();
  const entityId = Number(params.entityId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState<Status | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<Status | null>(null);

  const [statusKey, setStatusKey] = useState("");
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [isDefault, setIsDefault] = useState(false);
  const [isFinal, setIsFinal] = useState(false);
  const [isArchiveTrigger, setIsArchiveTrigger] = useState(false);
  const [archiveAfterDays, setArchiveAfterDays] = useState(0);
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);

  const { data: entities = [] } = useListEntities();
  const entity = entities.find((e: Entity) => e.id === entityId);

  const { data: statuses = [], isLoading } = useListEntityStatuses(entityId);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/statuses`] });

  const createMutation = useCreateEntityStatus({
    mutation: {
      onSuccess: () => { toast({ title: t("statuses.created", "Статус создан") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("statuses.createError", "Ошибка создания статуса"), description: extractError(err), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateStatus({
    mutation: {
      onSuccess: () => { toast({ title: t("statuses.updated", "Статус обновлён") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("statuses.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteStatus({
    mutation: {
      onSuccess: () => { toast({ title: t("statuses.deleted", "Статус удалён") }); setDeleteStatus(null); invalidate(); },
      onError: () => toast({ title: t("statuses.deleteError", "Ошибка удаления статуса"), variant: "destructive" }),
    },
  });

  const openCreate = () => {
    setEditingStatus(null);
    setStatusKey("");
    setNameJson({});
    setColor(PRESET_COLORS[0]);
    setIsDefault(statuses.length === 0);
    setIsFinal(false);
    setIsArchiveTrigger(false);
    setArchiveAfterDays(0);
    setSortOrder(statuses.length + 1);
    setIsActive(true);
    setDialogOpen(true);
  };

  const openEdit = (status: Status) => {
    setEditingStatus(status);
    const n = status.nameJson;
    setStatusKey(status.statusKey);
    setNameJson(typeof n === "object" && n ? { ru: n.ru, en: n.en, he: n.he } : {});
    setColor(status.color);
    setIsDefault(status.isDefault);
    setIsFinal(status.isFinal);
    setIsArchiveTrigger(status.isArchiveTrigger);
    setArchiveAfterDays(status.archiveAfterDays);
    setSortOrder(status.sortOrder);
    setIsActive(status.isActive);
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = {
      statusKey: statusKey.trim(),
      nameJson: nameJson as MultilingualText,
      color,
      isDefault,
      isFinal,
      isArchiveTrigger,
      archiveAfterDays: isArchiveTrigger ? Math.max(0, archiveAfterDays) : 0,
      sortOrder,
      isActive,
    };
    if (editingStatus) {
      updateMutation.mutate({ id: editingStatus.id, data: payload });
    } else {
      createMutation.mutate({ entityId, data: payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const sorted = [...statuses].sort((a: Status, b: Status) => a.sortOrder - b.sortOrder);

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          onClick={() => navigate("/admin/entities")}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("statuses.backToEntities", "К списку сущностей")}
        </button>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <CircleDot className="w-6 h-6 text-blue-600" />
              {`${t("statuses.title", "Статусы")}${entity ? `: ${ml(entity.nameJson)}` : ""}`}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {t("statuses.subtitle", "Жизненный цикл записей сущности")}{entity ? <> <code className="text-xs">{entity.entityKey}</code></> : null}
            </p>
          </div>
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
            <Plus className="w-4 h-4" />
            {t("statuses.add", "Добавить статус")}
          </Button>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : statuses.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              {t("statuses.empty", "У этой сущности ещё нет статусов. Нажмите «Добавить статус», чтобы создать первый.")}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("statuses.colName", "Название")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("statuses.colKey", "Ключ")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("statuses.colFlags", "Признаки")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("statuses.colStatus", "Статус")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">{t("statuses.colActions", "Действия")}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((status: Status) => (
                  <tr key={status.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-full border border-black/10"
                          style={{ backgroundColor: status.color }}
                        />
                        <span className="font-medium text-slate-700">{ml(status.nameJson)}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{status.statusKey}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {status.isDefault && (
                          <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
                            <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> {t("statuses.default", "По умолчанию")}
                          </span>
                        )}
                        {status.isFinal && (
                          <span className="inline-flex items-center gap-1 text-slate-500 text-xs">
                            <Flag className="w-3 h-3" /> {t("statuses.final", "Финальный")}
                          </span>
                        )}
                        {status.isArchiveTrigger && (
                          <span className="inline-flex items-center gap-1 text-indigo-600 text-xs">
                            <Archive className="w-3 h-3" />
                            {`${t("statuses.archive", "Архив")}${status.archiveAfterDays > 0 ? ` (${status.archiveAfterDays} ${t("statuses.daysShort", "дн.")})` : ""}`}
                          </span>
                        )}
                        {!status.isDefault && !status.isFinal && !status.isArchiveTrigger && <span className="text-slate-300 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {status.isActive ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">{t("statuses.active", "Активно")}</Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">{t("statuses.hidden", "Скрыто")}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(status)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeleteStatus(status)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingStatus ? t("statuses.editTitle", "Редактировать статус") : t("statuses.newTitle", "Новый статус")}</DialogTitle>
            <DialogDescription>
              {t("statuses.dialogDesc", "Статус — это этап жизненного цикла записи (например, «Новая», «В работе», «Завершена»).")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label={t("statuses.colName", "Название")} value={nameJson} onChange={setNameJson} required />
            <div className="space-y-1.5">
              <Label>{t("statuses.systemKey", "Системный ключ")}</Label>
              <Input
                value={statusKey}
                onChange={(e) => setStatusKey(e.target.value)}
                placeholder="in_progress"
                className="font-mono"
              />
              <p className="text-xs text-slate-400">
                {t("statuses.keyHintPre", "Только строчные латинские буквы, цифры и подчёркивания (например,")} <code>in_progress</code>{t("statuses.keyHintPost", "). Уникален в пределах сущности.")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("statuses.color", "Цвет")}</Label>
              <div className="flex items-center gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 rounded-full border-2 transition ${color === c ? "border-slate-800 scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
                <Input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-12 h-8 p-1"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("statuses.order", "Порядок")}</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <Switch checked={isDefault} onCheckedChange={setIsDefault} id="status-default" />
                <Label htmlFor="status-default">{t("statuses.default", "По умолчанию")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isFinal} onCheckedChange={setIsFinal} id="status-final" />
                <Label htmlFor="status-final">{t("statuses.final", "Финальный")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} id="status-active" />
                <Label htmlFor="status-active">{t("statuses.active", "Активно")}</Label>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              {t("statuses.defaultHint", "«По умолчанию» назначается новым записям. У сущности может быть только один статус по умолчанию.")}
            </p>
            <div className="rounded-md border border-slate-200 bg-slate-50/50 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Switch checked={isArchiveTrigger} onCheckedChange={setIsArchiveTrigger} id="status-archive-trigger" />
                <Label htmlFor="status-archive-trigger" className="flex items-center gap-1.5">
                  <Archive className="w-3.5 h-3.5 text-slate-500" />
                  {t("statuses.archiveRecords", "Архивировать записи в этом статусе")}
                </Label>
              </div>
              {isArchiveTrigger && (
                <div className="space-y-1.5 pl-1">
                  <Label htmlFor="status-archive-days">{t("statuses.archiveAfterDays", "Архивировать через (дней)")}</Label>
                  <Input
                    id="status-archive-days"
                    type="number"
                    min={0}
                    value={archiveAfterDays}
                    onChange={(e) => setArchiveAfterDays(Math.max(0, Number(e.target.value)))}
                    className="w-32"
                  />
                  <p className="text-xs text-slate-400">
                    {archiveAfterDays === 0
                      ? t("statuses.archiveImmediate", "0 — запись архивируется сразу при переходе в этот статус.")
                      : `${t("statuses.archiveDelayedPre", "Запись будет скрыта в архив через")} ${archiveAfterDays} ${t("statuses.archiveDelayedPost", "дн. после перехода в этот статус.")}`}
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("statuses.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingStatus ? t("statuses.save", "Сохранить") : t("statuses.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteStatus} onOpenChange={(o) => !o && setDeleteStatus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("statuses.deleteConfirmTitle", "Удалить статус?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${ml(deleteStatus?.nameJson)}" ${t("statuses.deleteConfirmDesc", "будет удалён безвозвратно.")}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("statuses.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteStatus && deleteMutation.mutate({ id: deleteStatus.id })}
            >
              {t("statuses.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object" && "response" in err) {
    const resp = (err as { response?: { data?: { error?: string } } }).response;
    return resp?.data?.error;
  }
  return undefined;
}
