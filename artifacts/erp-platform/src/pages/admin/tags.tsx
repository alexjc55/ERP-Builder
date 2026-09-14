import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Hash,
  Loader2,
  Pencil,
  Plus,
  Tags as TagsIcon,
  Trash2,
} from "lucide-react";
import { useML, useT } from "@/lib/i18n";
import { MultilingualInput } from "@/components/MultilingualInput";
import { ColorPickerControl } from "@/components/ColorPickerControl";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  getListTagsQueryKey,
  useCreateTag,
  useDeleteTag,
  useListTags,
  useReorderTags,
  useUpdateTag,
  type Tag,
  type TagInput,
} from "@workspace/api-client-react";

type MLValue = { ru?: string; en?: string; he?: string };
const DEFAULT_COLOR = "#3b82f6";

export default function TagsPage() {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: tags = [], isLoading, isError, error: loadError } = useListTags({
    query: { queryKey: getListTagsQueryKey() },
  });
  const sortedTags = useMemo(
    () => [...tags].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [tags],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [sortOrder, setSortOrder] = useState(0);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListTagsQueryKey() });
  const errorDescription = (error: unknown, fallback: string) => {
    const candidate = error as { status?: unknown; data?: { error?: unknown }; message?: unknown };
    if (candidate.status === 409) {
      return typeof candidate.data?.error === "string"
        ? candidate.data.error
        : t("tags.inUseError", "Тег используется и не может быть удалён.");
    }
    if (typeof candidate.message === "string" && candidate.message) return candidate.message;
    return fallback;
  };

  const createMutation = useCreateTag({
    mutation: {
      mutationKey: ["createTag"],
      onSuccess: () => {
        toast({ title: t("tags.created", "Тег создан") });
        setDialogOpen(false);
        invalidate();
      },
      onError: (error) =>
        toast({
          title: t("tags.createError", "Ошибка создания тега"),
          description: errorDescription(error, t("tags.createError", "Ошибка создания тега")),
          variant: "destructive",
        }),
    },
  });
  const updateMutation = useUpdateTag({
    mutation: {
      onSuccess: () => {
        toast({ title: t("tags.updated", "Тег обновлён") });
        setDialogOpen(false);
        invalidate();
      },
      onError: (error) =>
        toast({
          title: t("tags.updateError", "Ошибка обновления тега"),
          description: errorDescription(error, t("tags.updateError", "Ошибка обновления тега")),
          variant: "destructive",
        }),
    },
  });
  const deleteMutation = useDeleteTag({
    mutation: {
      onSuccess: () => {
        toast({ title: t("tags.deleted", "Тег удалён") });
        setDeleting(null);
        invalidate();
      },
      onError: (error) => {
        // A 409 is deliberately shown to the administrator: the API never
        // silently detaches a tag from permissions, widgets, or statuses.
        toast({
          title: t("tags.deleteError", "Ошибка удаления тега"),
          description: errorDescription(error, t("tags.deleteError", "Ошибка удаления тега")),
          variant: "destructive",
        });
      },
    },
  });
  const reorderMutation = useReorderTags({
    mutation: {
      onSuccess: invalidate,
      onError: (error) =>
        toast({
          title: t("tags.reorderError", "Ошибка изменения порядка"),
          description: errorDescription(error, t("tags.reorderError", "Ошибка изменения порядка")),
          variant: "destructive",
        }),
    },
  });

  const openCreate = () => {
    setEditing(null);
    setNameJson({});
    setColor(DEFAULT_COLOR);
    setSortOrder(sortedTags.length);
    setDialogOpen(true);
  };
  const openEdit = (tag: Tag) => {
    setEditing(tag);
    setNameJson((tag.nameJson as MLValue) ?? {});
    setColor(tag.color || DEFAULT_COLOR);
    setSortOrder(tag.sortOrder);
    setDialogOpen(true);
  };
  const submit = () => {
    const hasName = Object.values(nameJson).some((value) => value?.trim());
    if (!hasName) {
      toast({ title: t("tags.nameRequired", "Укажите название тега"), variant: "destructive" });
      return;
    }
    const data: TagInput = {
      nameJson,
      color: color.trim() || DEFAULT_COLOR,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : sortedTags.length,
      // This admin currently supports statuses only. Do not imply future
      // applicability targets in the UI or payload.
      applicableTo: ["statuses"],
    };
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate({ data });
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sortedTags.length) return;
    const current = sortedTags[index];
    const next = sortedTags[target];
    reorderMutation.mutate({
      data: {
        items: [
          { id: current.id, sortOrder: next.sortOrder },
          { id: next.id, sortOrder: current.sortOrder },
        ],
      },
    });
  };
  const isPending =
    createMutation.isPending || updateMutation.isPending || reorderMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <TagsIcon className="w-6 h-6 text-blue-600" />
            {t("tags.title", "Глобальные теги")}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {t("tags.subtitle", "Метки для группировки статусов и настройки доступа")}
          </p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          {t("tags.add", "Добавить тег")}
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="py-16 text-center text-red-500">
              {t("tags.loadError", "Не удалось загрузить теги")}
              {loadError instanceof Error && loadError.message ? `: ${loadError.message}` : null}
            </div>
          ) : sortedTags.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <TagsIcon className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              {t("tags.empty", "Тегов пока нет. Нажмите «Добавить тег», чтобы создать первый.")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("tags.colName", "Название")}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("tags.colColor", "Цвет")}</th>
                    <th className="text-start px-4 py-3 font-medium text-slate-600">{t("tags.colAppliesTo", "Применяется к")}</th>
                    <th className="text-end px-4 py-3 font-medium text-slate-600">{t("tags.colActions", "Действия")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTags.map((tag, index) => (
                    <tr key={tag.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                          <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: tag.color }} />
                          {ml(tag.nameJson)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{tag.color}</td>
                      <td className="px-4 py-3">
                        <Badge className="bg-blue-50 text-blue-700 border-blue-100 font-normal">
                          <Hash className="w-3 h-3 me-1" />
                          {t("tags.statuses", "Статусы")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={index === 0 || isPending} onClick={() => move(index, -1)} aria-label={t("tags.moveUp", "Переместить вверх")}>
                            <ArrowUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={index === sortedTags.length - 1 || isPending} onClick={() => move(index, 1)} aria-label={t("tags.moveDown", "Переместить вниз")}>
                            <ArrowDown className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(tag)} aria-label={t("tags.edit", "Изменить")}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeleting(tag)} aria-label={t("tags.delete", "Удалить")}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t("tags.editTitle", "Редактировать тег") : t("tags.newTitle", "Новый тег")}</DialogTitle>
            <DialogDescription>{t("tags.dialogDesc", "Тег доступен для назначения статусам сущностей.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label={t("tags.name", "Название")} value={nameJson} onChange={setNameJson} required />
            <ColorPickerControl label={t("tags.color", "Цвет")} value={color} onChange={setColor} />
            <div className="space-y-1.5">
              <label htmlFor="tag-sort-order" className="text-sm font-medium text-slate-700">{t("tags.order", "Порядок")}</label>
              <Input id="tag-sort-order" type="number" value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} />
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {t("tags.statusesOnly", "Сейчас теги поддерживаются только для статусов.")}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("tags.cancel", "Отмена")}</Button>
            <Button onClick={submit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? t("tags.save", "Сохранить") : t("tags.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tags.deleteConfirmTitle", "Удалить тег?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${ml(deleting?.nameJson)}" ${t("tags.deleteConfirmDesc", "будет удалён безвозвратно. Если тег используется, сервер не позволит удалить его.")}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("tags.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleting && deleteMutation.mutate({ id: deleting.id })}>
              {t("tags.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}