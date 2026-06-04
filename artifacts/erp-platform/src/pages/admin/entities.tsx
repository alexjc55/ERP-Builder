import { useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { MultilingualInput } from "@/components/MultilingualInput";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Database, Loader2, Columns3 } from "lucide-react";
import { useLocation } from "wouter";

type MLValue = { ru?: string; en?: string; he?: string };

function getML(val: MultilingualText | string | undefined | null): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.ru || val.en || val.he || "";
}

export default function EntitiesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [deleteEntity, setDeleteEntity] = useState<Entity | null>(null);

  const [entityKey, setEntityKey] = useState("");
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [descJson, setDescJson] = useState<MLValue>({});
  const [icon, setIcon] = useState("");
  const [pageId, setPageId] = useState<string>("none");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);

  const { data: entities = [], isLoading } = useListEntities();
  const { data: pages = [] } = useListPages();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/entities"] });

  const createMutation = useCreateEntity({
    mutation: {
      onSuccess: () => { toast({ title: "Сущность создана" }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: "Ошибка создания сущности", description: extractError(err), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateEntity({
    mutation: {
      onSuccess: () => { toast({ title: "Сущность обновлена" }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: "Ошибка обновления", description: extractError(err), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteEntity({
    mutation: {
      onSuccess: () => { toast({ title: "Сущность удалена" }); setDeleteEntity(null); invalidate(); },
      onError: () => toast({ title: "Ошибка удаления сущности", variant: "destructive" }),
    },
  });

  const openCreate = () => {
    setEditingEntity(null);
    setEntityKey("");
    setNameJson({});
    setDescJson({});
    setIcon("");
    setPageId("none");
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
    setIcon(entity.icon || "");
    setPageId(entity.pageId ? String(entity.pageId) : "none");
    setSortOrder(entity.sortOrder);
    setIsActive(entity.isActive);
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = {
      entityKey: entityKey.trim(),
      nameJson: nameJson as MultilingualText,
      descriptionJson: descJson as MultilingualText,
      icon: icon || "table",
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
  const navPages = pages.filter((p: Page) => p.path);
  const pageName = (id: number | null | undefined) => {
    if (!id) return null;
    const p = pages.find((pg: Page) => pg.id === id);
    return p ? getML(p.nameJson) : null;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Сущности</h1>
          <p className="text-sm text-slate-500 mt-0.5">Конструктор объектов данных вашей системы</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          Создать сущность
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
              Сущности ещё не созданы. Нажмите «Создать сущность», чтобы добавить первую.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Название</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Ключ</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Страница</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Статус</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Действия</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((entity: Entity) => (
                  <tr key={entity.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-slate-400" />
                        <span className="font-medium text-slate-700">{getML(entity.nameJson)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{entity.entityKey}</td>
                    <td className="px-4 py-3 text-slate-500">{pageName(entity.pageId) || "—"}</td>
                    <td className="px-4 py-3">
                      {entity.isActive ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">Активна</Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">Скрыта</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-slate-600"
                          onClick={() => navigate(`/admin/entities/${entity.id}/fields`)}
                        >
                          <Columns3 className="w-3.5 h-3.5" />
                          Поля
                        </Button>
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
            <DialogTitle>{editingEntity ? "Редактировать сущность" : "Новая сущность"}</DialogTitle>
            <DialogDescription>
              Сущность — это объект данных (таблица). Поля добавляются на следующем этапе.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label="Название" value={nameJson} onChange={setNameJson} required />
            <MultilingualInput label="Описание" value={descJson} onChange={setDescJson} multiline />
            <div className="space-y-1.5">
              <Label>Системный ключ</Label>
              <Input
                value={entityKey}
                onChange={(e) => setEntityKey(e.target.value)}
                placeholder="projects"
                className="font-mono"
              />
              <p className="text-xs text-slate-400">
                Только строчные латинские буквы, цифры и подчёркивания (например, <code>projects</code>). Используется в хранилище данных.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Иконка</Label>
                <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="table" />
              </div>
              <div className="space-y-1.5">
                <Label>Порядок</Label>
                <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Страница отображения</Label>
              <Select value={pageId} onValueChange={setPageId}>
                <SelectTrigger><SelectValue placeholder="Не привязана" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Не привязана —</SelectItem>
                  {navPages.map((p: Page) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {getML(p.nameJson)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">На какой странице меню будет показана эта сущность.</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} id="entity-active" />
              <Label htmlFor="entity-active">Активна</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingEntity ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteEntity} onOpenChange={(o) => !o && setDeleteEntity(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить сущность?</AlertDialogTitle>
            <AlertDialogDescription>
              "{getML(deleteEntity?.nameJson)}" будет удалена безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteEntity && deleteMutation.mutate({ id: deleteEntity.id })}
            >
              Удалить
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
