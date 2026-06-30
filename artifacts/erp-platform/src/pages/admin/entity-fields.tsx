import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useListEntityFields,
  useDeleteField,
  useReorderFields,
  useListEntities,
  type Field,
  type Entity,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { FieldConfigDialog } from "@/components/FieldConfigDialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ArrowLeft, Columns3, KeyRound, ChevronUp, ChevronDown } from "lucide-react";
import { useML, useT } from "@/lib/i18n";

// Display-only fallback labels for the type badge in the list. The single source
// of truth for the editable type set is FieldConfigDialog (used everywhere a field
// is created/edited); these are just human-readable fallbacks when a translation
// key is missing.
const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Текст",
  textarea: "Многострочный текст",
  number: "Число",
  boolean: "Да / Нет",
  date: "Дата",
  datetime: "Дата и время",
  select: "Список (выбор)",
  email: "Email",
  url: "Ссылка (URL)",
  phone: "Телефон",
  user: "Пользователь",
  file: "Файл",
  function: "Формула (вычисляемое)",
  relation: "Связанное поле",
  lookup: "Поле подстановки",
};

function typeLabel(t: string): string {
  return FIELD_TYPE_LABELS[t] ?? t;
}

export default function EntityFieldsPage() {
  const ml = useML();
  const t = useT();
  const params = useParams();
  const entityId = Number(params.entityId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // The create/edit form itself lives entirely in the shared FieldConfigDialog —
  // the same component the records-page setup mode uses — so there is exactly one
  // field editor and no chance of the two surfaces drifting apart.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [deleteField, setDeleteField] = useState<Field | null>(null);

  const { data: entities = [] } = useListEntities();
  const entity = entities.find((e: Entity) => e.id === entityId);

  const { data: fields = [], isLoading } = useListEntityFields(entityId);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/fields`] });

  const deleteMutation = useDeleteField({
    mutation: {
      onSuccess: () => { toast({ title: t("fields.deleted", "Поле удалено") }); setDeleteField(null); invalidate(); },
      onError: () => toast({ title: t("fields.deleteError", "Ошибка удаления поля"), variant: "destructive" }),
    },
  });

  const reorderMutation = useReorderFields({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: t("fields.reorderError", "Ошибка изменения порядка"), variant: "destructive" }),
    },
  });

  const move = (list: Field[], index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    reorderMutation.mutate({
      data: {
        entityId,
        items: [
          { id: a.id, sortOrder: b.sortOrder },
          { id: b.id, sortOrder: a.sortOrder },
        ],
      },
    });
  };

  const openCreate = () => { setEditingField(null); setDialogOpen(true); };
  const openEdit = (field: Field) => { setEditingField(field); setDialogOpen(true); };

  const sorted = [...fields].sort((a: Field, b: Field) => a.sortOrder - b.sortOrder);

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          onClick={() => { if (window.history.length > 1) window.history.back(); else navigate("/admin/entities"); }}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("fields.backToEntities", "К списку сущностей")}
        </button>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Columns3 className="w-6 h-6 text-blue-600" />
              {t("fields.title", "Поля")}{entity ? `: ${ml(entity.nameJson)}` : ""}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {t("fields.subtitle", "Структура полей сущности")}{entity ? <> <code className="text-xs">{entity.entityKey}</code></> : null}
            </p>
          </div>
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
            <Plus className="w-4 h-4" />
            {t("fields.add", "Добавить поле")}
          </Button>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : fields.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              {t("fields.empty", "У этой сущности ещё нет полей. Нажмите «Добавить поле», чтобы создать первое.")}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("fields.name", "Название")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("fields.key", "Ключ")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("fields.typeHeader", "Тип")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("fields.required", "Обязательное")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("fields.status", "Статус")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">{t("fields.actions", "Действия")}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((field: Field, idx: number) => (
                  <tr key={field.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                        {field.isKey && (
                          <KeyRound
                            className="w-3.5 h-3.5 text-amber-600 shrink-0"
                            aria-label={t("fields.isKey", "Ключевое поле (уникальное)")}
                          />
                        )}
                        {ml(field.nameJson)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{field.fieldKey}</td>
                    <td className="px-4 py-3">
                      <Badge className="bg-slate-100 text-slate-600 border-0 font-normal">
                        {t(`fields.type.${field.fieldType}`, typeLabel(field.fieldType))}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {field.isRequired ? (
                        <span className="text-amber-600 text-xs">{t("fields.yes", "Да")}</span>
                      ) : (
                        <span className="text-slate-400 text-xs">{t("fields.no", "Нет")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {field.isActive ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">{t("fields.active", "Активно")}</Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">{t("fields.access.hidden", "Скрыто")}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={idx === 0 || reorderMutation.isPending} onClick={() => move(sorted, idx, -1)}>
                          <ChevronUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={idx === sorted.length - 1 || reorderMutation.isPending} onClick={() => move(sorted, idx, 1)}>
                          <ChevronDown className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(field)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeleteField(field)}>
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

      <FieldConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entityId={entityId}
        field={editingField}
        nextSortOrder={fields.length + 1}
        onSaved={invalidate}
      />

      <AlertDialog open={!!deleteField} onOpenChange={(o) => !o && setDeleteField(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("fields.deleteTitle", "Удалить поле?")}</AlertDialogTitle>
            <AlertDialogDescription>
              "{ml(deleteField?.nameJson)}" {t("fields.deleteSuffix", "будет удалено безвозвратно.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("fields.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteField && deleteMutation.mutate({ id: deleteField.id })}
            >
              {t("fields.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
