import { useEffect, useState } from "react";
import {
  useListEntities,
  useCreateEntity,
  useUpdateEntity,
  useDeleteEntity,
  useListPages,
  type Entity,
  type Page,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { MultilingualInput } from "@/components/MultilingualInput";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Database, Loader2, Columns3, CircleDot, Share2, LayoutList, Workflow, Settings2, ChevronDown, Zap } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { useML, useT } from "@/lib/i18n";
import { slugifyKey, uniqueKey } from "@/lib/keys";

type MLValue = { ru?: string; en?: string; he?: string };

export default function EntitiesPage() {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [deleteEntity, setDeleteEntity] = useState<Entity | null>(null);

  const [entityKey, setEntityKey] = useState("");
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [descJson, setDescJson] = useState<MLValue>({});
  const [pageId, setPageId] = useState<string>("none");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);

  const { data: entities = [], isLoading } = useListEntities();
  const { data: pages = [] } = useListPages();
  const search = useSearch();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/entities"] });

  const createMutation = useCreateEntity({
    mutation: {
      onSuccess: () => { toast({ title: t("entities.created", "Сущность создана") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("entities.createError", "Ошибка создания сущности"), description: extractError(err), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateEntity({
    mutation: {
      onSuccess: () => { toast({ title: t("entities.updated", "Сущность обновлена") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("entities.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteEntity({
    mutation: {
      onSuccess: () => { toast({ title: t("entities.deleted", "Сущность удалена") }); setDeleteEntity(null); invalidate(); },
      onError: () => toast({ title: t("entities.deleteError", "Ошибка удаления сущности"), variant: "destructive" }),
    },
  });

  const openCreate = (prefillPageId?: number) => {
    setEditingEntity(null);
    setEntityKey("");
    setNameJson({});
    setDescJson({});
    setPageId(prefillPageId ? String(prefillPageId) : "none");
    setSortOrder(entities.length + 1);
    setIsActive(true);
    setDialogOpen(true);
  };

  const openEdit = (entity: Entity) => {
    setEditingEntity(entity);
    const n = entity.nameJson;
    const d = entity.descriptionJson;
    setEntityKey(entity.entityKey);
    setNameJson(typeof n === "object" && n ? { ru: n.ru, en: n.en, he: n.he } : {});
    setDescJson(typeof d === "object" && d ? { ru: d.ru, en: d.en, he: d.he } : {});
    setPageId(entity.pageId ? String(entity.pageId) : "none");
    setSortOrder(entity.sortOrder);
    setIsActive(entity.isActive);
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const existingKeys = new Set(
      entities.filter((e: Entity) => e.id !== editingEntity?.id).map((e: Entity) => e.entityKey),
    );
    const nameForKey = (nameJson.en || nameJson.ru || nameJson.he || "").toString();
    const autoBase = slugifyKey(nameForKey) || "entity";
    const resolvedKey = entityKey.trim() || uniqueKey(autoBase, existingKeys);
    const payload = {
      entityKey: resolvedKey,
      nameJson: nameJson as MultilingualText,
      descriptionJson: descJson as MultilingualText,
      icon: editingEntity?.icon || "table",
      pageId: pageId !== "none" ? Number(pageId) : null,
      sortOrder,
      isActive,
    };
    if (editingEntity) {
      updateMutation.mutate({ id: editingEntity.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const sorted = [...entities].sort((a: Entity, b: Entity) => a.sortOrder - b.sortOrder);
  // A page that mirrors an entity cannot also have a bound entity (either/or),
  // so such pages are not offered as binding targets here.
  const navPages = [...pages]
    .filter((p: Page) => p.mirrorEntityId == null)
    .sort((a: Page, b: Page) => a.sortOrder - b.sortOrder);

  useEffect(() => {
    if (!search) return;
    const params = new URLSearchParams(search);
    const createForPage = params.get("createForPage");
    const editId = params.get("edit");
    if (editId) {
      const ent = entities.find((e: Entity) => e.id === Number(editId));
      if (ent) {
        openEdit(ent);
        navigate("/admin/entities", { replace: true });
      }
    } else if (createForPage) {
      openCreate(Number(createForPage));
      navigate("/admin/entities", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, entities]);
  const pageName = (id: number | null | undefined) => {
    if (!id) return null;
    const p = pages.find((pg: Page) => pg.id === id);
    return p ? ml(p.nameJson) : null;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("entities.title", "Сущности")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t("entities.subtitle", "Конструктор объектов данных вашей системы")}</p>
        </div>
        <Button onClick={() => openCreate()} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          {t("entities.create", "Создать сущность")}
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : entities.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              {t("entities.empty", "Сущности ещё не созданы. Нажмите «Создать сущность», чтобы добавить первую.")}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("entities.colName", "Название")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("entities.colKey", "Ключ")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("entities.colPage", "Страница")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("entities.colStatus", "Статус")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">{t("entities.colActions", "Действия")}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((entity: Entity) => (
                  <tr key={entity.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-slate-400" />
                        <span className="font-medium text-slate-700">{ml(entity.nameJson)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{entity.entityKey}</td>
                    <td className="px-4 py-3 text-slate-500">{pageName(entity.pageId) || "—"}</td>
                    <td className="px-4 py-3">
                      {entity.isActive ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">{t("entities.statusActive", "Активна")}</Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">{t("entities.statusHidden", "Скрыта")}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-slate-600">
                              <Settings2 className="w-3.5 h-3.5" />
                              {t("entities.manage", "Настройка")}
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => navigate(`/admin/entities/${entity.id}/fields`)}>
                              <Columns3 className="w-3.5 h-3.5 mr-2" />
                              {t("entities.fields", "Поля")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/admin/entities/${entity.id}/statuses`)}>
                              <CircleDot className="w-3.5 h-3.5 mr-2" />
                              {t("entities.statuses", "Статусы")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/admin/entities/${entity.id}/relations`)}>
                              <Share2 className="w-3.5 h-3.5 mr-2" />
                              {t("entities.relations", "Связи")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/admin/entities/${entity.id}/views`)}>
                              <LayoutList className="w-3.5 h-3.5 mr-2" />
                              {t("entities.views", "Виды")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/admin/entities/${entity.id}/workflow`)}>
                              <Workflow className="w-3.5 h-3.5 mr-2" />
                              {t("entities.workflow", "Процессы")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/admin/entities/${entity.id}/automations`)}>
                              <Zap className="w-3.5 h-3.5 mr-2" />
                              {t("entities.automations", "Автоматизации")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/admin/entities/${entity.id}/records`)}>
                              <Database className="w-3.5 h-3.5 mr-2" />
                              {t("entities.records", "Данные")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(entity)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeleteEntity(entity)}>
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
            <DialogTitle>{editingEntity ? t("entities.editTitle", "Редактировать сущность") : t("entities.newTitle", "Новая сущность")}</DialogTitle>
            <DialogDescription>
              {t("entities.dialogDesc", "Сущность — это объект данных (таблица). Поля добавляются на следующем этапе.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label={t("entities.fieldName", "Название")} value={nameJson} onChange={setNameJson} required />
            <MultilingualInput label={t("entities.fieldDescription", "Описание")} value={descJson} onChange={setDescJson} multiline />
            <div className="space-y-1.5">
              <Label>{t("entities.fieldKey", "Системный ключ")}</Label>
              <Input
                value={entityKey}
                onChange={(e) => setEntityKey(e.target.value)}
                placeholder={t("entities.keyAutoPlaceholder", "Сгенерируется автоматически")}
                className="font-mono"
              />
              <p className="text-xs text-slate-400">
                {t("entities.keyHintAuto", "Необязательно. Если оставить пустым, ключ будет создан автоматически из названия. Только строчные латинские буквы, цифры и подчёркивания. Используется в хранилище данных.")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("entities.fieldOrder", "Порядок")}</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("entities.fieldPage", "Страница отображения")}</Label>
              <Select value={pageId} onValueChange={setPageId}>
                <SelectTrigger><SelectValue placeholder={t("entities.pageUnbound", "Не привязана")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("entities.pageUnboundOption", "— Не привязана —")}</SelectItem>
                  {navPages.map((p: Page) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {ml(p.nameJson)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">{t("entities.pageHint", "На какой странице меню будет показана эта сущность.")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} id="entity-active" />
              <Label htmlFor="entity-active">{t("entities.fieldActive", "Активна")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("entities.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingEntity ? t("entities.save", "Сохранить") : t("entities.createShort", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteEntity} onOpenChange={(o) => !o && setDeleteEntity(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("entities.deleteConfirmTitle", "Удалить сущность?")}</AlertDialogTitle>
            <AlertDialogDescription>
              "{ml(deleteEntity?.nameJson)}" {t("entities.deleteConfirmDesc", "будет удалена безвозвратно.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("entities.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteEntity && deleteMutation.mutate({ id: deleteEntity.id })}
            >
              {t("entities.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const data = (err as { data?: { error?: unknown } }).data;
    if (data && typeof data.error === "string" && data.error.trim()) return data.error;
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return undefined;
}
