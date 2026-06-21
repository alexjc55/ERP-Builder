import { useState } from "react";
import {
  useListColumnGroups,
  useCreateColumnGroup,
  useUpdateColumnGroup,
  useDeleteColumnGroup,
  getListColumnGroupsQueryKey,
  type ColumnGroup,
  type ColumnGroupDisplayMode,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useML, useT } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { ColorPickerControl } from "@/components/ColorPickerControl";
import { useToast } from "@/hooks/use-toast";
import { Columns, Pencil, Trash2, Plus } from "lucide-react";

type MLValue = { ru?: string; en?: string; he?: string };

const DEFAULT_COLOR = "#6366f1";

export default function ColumnGroupsPage() {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useListColumnGroups();
  const groups: ColumnGroup[] = data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ColumnGroup | null>(null);
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [displayMode, setDisplayMode] = useState<ColumnGroupDisplayMode>("bar");
  const [textColor, setTextColor] = useState("");
  const [deleting, setDeleting] = useState<ColumnGroup | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListColumnGroupsQueryKey() });

  const createMutation = useCreateColumnGroup({
    mutation: {
      onSuccess: () => { toast({ title: t("colGroups.created", "Группа создана") }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: t("colGroups.createError", "Ошибка создания группы"), variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateColumnGroup({
    mutation: {
      onSuccess: () => { toast({ title: t("colGroups.updated", "Группа обновлена") }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: t("colGroups.updateError", "Ошибка обновления группы"), variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteColumnGroup({
    mutation: {
      onSuccess: () => { toast({ title: t("colGroups.deleted", "Группа удалена") }); setDeleting(null); invalidate(); },
      onError: () => toast({ title: t("colGroups.deleteError", "Ошибка удаления группы"), variant: "destructive" }),
    },
  });

  const openCreate = () => {
    setEditing(null);
    setNameJson({});
    setColor(DEFAULT_COLOR);
    setDisplayMode("bar");
    setTextColor("");
    setDialogOpen(true);
  };

  const openEdit = (g: ColumnGroup) => {
    setEditing(g);
    setNameJson((g.nameJson as MLValue) ?? {});
    setColor(g.color || DEFAULT_COLOR);
    setDisplayMode(g.displayMode);
    setTextColor(g.textColor ?? "");
    setDialogOpen(true);
  };

  const submit = () => {
    const name = (nameJson.ru ?? nameJson.en ?? nameJson.he ?? "").trim();
    if (!name) {
      toast({ title: t("colGroups.nameRequired", "Укажите название"), variant: "destructive" });
      return;
    }
    const normColor = color.trim() || DEFAULT_COLOR;
    const normText = displayMode === "fill" ? (textColor.trim() || null) : null;

    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        data: { nameJson, color: normColor, displayMode, textColor: normText },
      });
    } else {
      createMutation.mutate({
        data: { nameJson, color: normColor, displayMode, textColor: normText },
      });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("colGroups.title", "Группы колонок")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {t("colGroups.subtitle", "Глобальный список групп для оформления колонок таблиц")}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1.5" />
          {t("colGroups.add", "Добавить группу")}
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("colGroups.col.name", "Название")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-40">{t("colGroups.col.mode", "Отображение")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-48">{t("colGroups.col.preview", "Превью")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 w-28">{t("colGroups.col.actions", "Действия")}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {Array.from({ length: 4 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : groups.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-slate-400">
                      <Columns className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      {t("colGroups.empty", "Групп пока нет")}
                    </td>
                  </tr>
                ) : (
                  groups.map((g) => (
                    <tr key={g.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-700">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-block w-3.5 h-3.5 rounded-sm shrink-0" style={{ backgroundColor: g.color }} />
                          <span>{ml(g.nameJson) || `#${g.id}`}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="bg-slate-100 text-slate-600">
                          {g.displayMode === "fill"
                            ? t("colGroups.mode.fill", "Заливка")
                            : t("colGroups.mode.bar", "Полоса")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {g.displayMode === "fill" ? (
                          <span
                            className="inline-block px-3 py-1 rounded text-xs font-medium"
                            style={{ backgroundColor: g.color, color: g.textColor ?? "#ffffff" }}
                          >
                            {ml(g.nameJson) || "Aa"}
                          </span>
                        ) : (
                          <span className="inline-block px-3 py-1 rounded text-xs font-medium text-slate-600 bg-white border-t-[3px]" style={{ borderTopColor: g.color }}>
                            {ml(g.nameJson) || "Aa"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(g)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleting(g)}>
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
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
              {editing ? t("colGroups.editTitle", "Редактировать группу") : t("colGroups.newTitle", "Новая группа")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput
              label={t("colGroups.name", "Название")}
              value={nameJson}
              onChange={setNameJson}
              required
            />
            <ColorPickerControl
              label={t("colGroups.color", "Цвет группы")}
              value={color}
              onChange={(v) => setColor(v || DEFAULT_COLOR)}
            />
            <div className="space-y-1.5">
              <Label>{t("colGroups.displayMode", "Режим отображения")}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={displayMode === "bar" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setDisplayMode("bar")}
                >
                  {t("colGroups.mode.bar", "Полоса")}
                </Button>
                <Button
                  type="button"
                  variant={displayMode === "fill" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setDisplayMode("fill")}
                >
                  {t("colGroups.mode.fill", "Заливка")}
                </Button>
              </div>
              <p className="text-xs text-slate-400">
                {displayMode === "fill"
                  ? t("colGroups.mode.fillDesc", "Заголовок колонки заливается цветом группы.")
                  : t("colGroups.mode.barDesc", "Над заголовком колонки рисуется тонкая цветная полоса.")}
              </p>
            </div>
            {displayMode === "fill" && (
              <ColorPickerControl
                label={t("colGroups.textColor", "Цвет текста заголовка")}
                value={textColor}
                onChange={setTextColor}
              />
            )}
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
            <AlertDialogTitle>{t("colGroups.deleteTitle", "Удалить группу?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("colGroups.deleteDesc", "Колонки, привязанные к этой группе, просто перестанут показывать оформление. Это действие нельзя отменить.")}
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
