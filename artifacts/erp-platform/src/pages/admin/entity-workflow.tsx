import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useListEntityTransitions,
  useCreateEntityTransition,
  useUpdateTransition,
  useDeleteTransition,
  useListEntityStatuses,
  useListEntityFields,
  useListRoles,
  useListEntities,
  type Transition,
  type TransitionAction,
  type Status,
  type Field,
  type Role,
  type Entity,
  type MultilingualText,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Plus, Pencil, Trash2, Loader2, ArrowLeft, Workflow, ArrowRight, X } from "lucide-react";
import { useML, useT } from "@/lib/i18n";

type MLValue = { ru?: string; en?: string; he?: string };
type ActionRow = { fieldKey: string; value: string };

export default function EntityWorkflowPage() {
  const params = useParams();
  const entityId = Number(params.entityId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ml = useML();
  const t = useT();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Transition | null>(null);
  const [toDelete, setToDelete] = useState<Transition | null>(null);

  const [fromStatusId, setFromStatusId] = useState<string>("");
  const [toStatusId, setToStatusId] = useState<string>("");
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [allowedRoleIds, setAllowedRoleIds] = useState<number[]>([]);
  const [requiredFieldKeys, setRequiredFieldKeys] = useState<string[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [sortOrder, setSortOrder] = useState(0);

  const { data: entities = [] } = useListEntities();
  const entity = entities.find((e: Entity) => e.id === entityId);

  const { data: transitions = [], isLoading } = useListEntityTransitions(entityId);
  const { data: statuses = [] } = useListEntityStatuses(entityId);
  const { data: allFields = [] } = useListEntityFields(entityId);
  const { data: roles = [] } = useListRoles();

  const fields = [...allFields]
    .filter((f: Field) => f.isActive)
    .sort((a: Field, b: Field) => a.sortOrder - b.sortOrder);
  const statusById = new Map(statuses.map((s: Status) => [s.id, s]));
  const fieldByKey = new Map(fields.map((f: Field) => [f.fieldKey, f]));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/transitions`] });

  const createMutation = useCreateEntityTransition({
    mutation: {
      onSuccess: () => { toast({ title: t("workflow.transitionCreated", "Переход создан") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("workflow.createError", "Ошибка создания перехода"), description: extractError(err), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateTransition({
    mutation: {
      onSuccess: () => { toast({ title: t("workflow.transitionUpdated", "Переход обновлён") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("workflow.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteTransition({
    mutation: {
      onSuccess: () => { toast({ title: t("workflow.transitionDeleted", "Переход удалён") }); setToDelete(null); invalidate(); },
      onError: () => toast({ title: t("workflow.deleteError", "Ошибка удаления перехода"), variant: "destructive" }),
    },
  });

  const openCreate = () => {
    setEditing(null);
    setFromStatusId(statuses[0] ? String(statuses[0].id) : "");
    setToStatusId(statuses[1] ? String(statuses[1].id) : statuses[0] ? String(statuses[0].id) : "");
    setNameJson({});
    setAllowedRoleIds([]);
    setRequiredFieldKeys([]);
    setActions([]);
    setSortOrder(transitions.length + 1);
    setDialogOpen(true);
  };

  const openEdit = (t: Transition) => {
    setEditing(t);
    setFromStatusId(String(t.fromStatusId));
    setToStatusId(String(t.toStatusId));
    const n = t.nameJson;
    setNameJson(typeof n === "object" && n ? { ru: n.ru, en: n.en, he: n.he } : {});
    setAllowedRoleIds([...(t.allowedRoleIds ?? [])]);
    setRequiredFieldKeys([...(t.requiredFieldKeys ?? [])]);
    setActions(
      (t.actionsJson ?? []).map((a: TransitionAction) => ({
        fieldKey: a.fieldKey,
        value: a.value == null ? "" : String(a.value),
      })),
    );
    setSortOrder(t.sortOrder);
    setDialogOpen(true);
  };

  const toggleRole = (id: number) =>
    setAllowedRoleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleField = (key: string) =>
    setRequiredFieldKeys((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));

  const addAction = () => setActions((prev) => [...prev, { fieldKey: fields[0]?.fieldKey ?? "", value: "" }]);
  const removeAction = (i: number) => setActions((prev) => prev.filter((_, idx) => idx !== i));
  const updateAction = (i: number, patch: Partial<ActionRow>) =>
    setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  /** Coerce a string action value to the target field's stored type. */
  const coerceActionValue = (fieldKey: string, raw: string): unknown => {
    const f = fieldByKey.get(fieldKey);
    if (!f) return raw;
    if (raw === "") return null;
    switch (f.fieldType) {
      case "number":
        return Number(raw);
      case "boolean":
        return raw === "true";
      default:
        return raw;
    }
  };

  const handleSubmit = () => {
    if (!fromStatusId || !toStatusId) {
      toast({ title: t("workflow.specifyStatuses", "Укажите статусы перехода"), variant: "destructive" });
      return;
    }
    const actionsJson: TransitionAction[] = actions
      .filter((a) => a.fieldKey)
      .map((a) => ({ type: "set_field", fieldKey: a.fieldKey, value: coerceActionValue(a.fieldKey, a.value) }));
    const payload = {
      fromStatusId: Number(fromStatusId),
      toStatusId: Number(toStatusId),
      nameJson: nameJson as MultilingualText,
      allowedRoleIds,
      requiredFieldKeys,
      actionsJson,
      sortOrder,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload });
    } else {
      createMutation.mutate({ entityId, data: payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const sorted = [...transitions].sort((a: Transition, b: Transition) => a.sortOrder - b.sortOrder);

  const StatusChip = ({ id }: { id: number }) => {
    const s = statusById.get(id);
    if (!s) return <span className="text-slate-400 text-xs">—</span>;
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ backgroundColor: `${s.color}20`, color: s.color }}
      >
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
        {ml(s.nameJson)}
      </span>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          onClick={() => navigate("/admin/entities")}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("workflow.backToEntities", "К списку сущностей")}
        </button>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Workflow className="w-6 h-6 text-blue-600" />
              {t("workflow.title", "Процессы")}{entity ? `: ${ml(entity.nameJson)}` : ""}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {t("workflow.subtitle", "Разрешённые переходы между статусами. Пока переходов нет — статус можно менять свободно.")}
            </p>
          </div>
          <Button
            onClick={openCreate}
            disabled={statuses.length === 0}
            className="bg-blue-600 hover:bg-blue-700 gap-2"
          >
            <Plus className="w-4 h-4" />
            {t("workflow.addTransition", "Добавить переход")}
          </Button>
        </div>
      </div>

      {statuses.length === 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4 text-sm text-amber-700">
            {t("workflow.noStatusesWarning", "Сначала создайте статусы этой сущности — переходы определяются между ними.")}
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : transitions.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              {t("workflow.empty", "Переходов пока нет. Без переходов статус записи можно менять на любой.")}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("workflow.colTransition", "Переход")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("workflow.colName", "Название")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("workflow.colWhoCan", "Кто может")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("workflow.colRequiredFields", "Обяз. поля")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("workflow.colActions", "Действия")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((tr: Transition) => (
                  <tr key={tr.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <StatusChip id={tr.fromStatusId} />
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                        <StatusChip id={tr.toStatusId} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{ml(tr.nameJson) || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {(tr.allowedRoleIds?.length ?? 0) === 0
                        ? t("workflow.allRoles", "Все роли")
                        : tr.allowedRoleIds
                            .map((id) => ml(roles.find((r: Role) => r.id === id)?.nameJson) || `#${id}`)
                            .join(", ")}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                      {(tr.requiredFieldKeys?.length ?? 0) === 0 ? <span className="text-slate-300">—</span> : tr.requiredFieldKeys.join(", ")}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {(tr.actionsJson?.length ?? 0) === 0
                        ? <span className="text-slate-300">—</span>
                        : tr.actionsJson.map((a: TransitionAction) => `${a.fieldKey}=${a.value == null ? "∅" : String(a.value)}`).join(", ")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(tr)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setToDelete(tr)}>
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
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("workflow.editTransition", "Редактировать переход") : t("workflow.newTransition", "Новый переход")}</DialogTitle>
            <DialogDescription>
              {t("workflow.dialogDescription", "Переход разрешает смену статуса записи. Можно ограничить роли, потребовать заполнения полей и задать действия.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("workflow.fromStatus", "Из статуса")}</Label>
                <Select value={fromStatusId} onValueChange={setFromStatusId}>
                  <SelectTrigger><SelectValue placeholder={t("workflow.statusPlaceholder", "Статус")} /></SelectTrigger>
                  <SelectContent>
                    {statuses.map((s: Status) => (
                      <SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("workflow.toStatus", "В статус")}</Label>
                <Select value={toStatusId} onValueChange={setToStatusId}>
                  <SelectTrigger><SelectValue placeholder={t("workflow.statusPlaceholder", "Статус")} /></SelectTrigger>
                  <SelectContent>
                    {statuses.map((s: Status) => (
                      <SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <MultilingualInput label={t("workflow.nameOptional", "Название (необязательно)")} value={nameJson} onChange={setNameJson} />

            <div className="space-y-1.5">
              <Label>{t("workflow.whoCanExecute", "Кто может выполнять")}</Label>
              {roles.length === 0 ? (
                <p className="text-xs text-slate-400">{t("workflow.noRoles", "Ролей нет.")}</p>
              ) : (
                <div className="space-y-1.5 rounded-md border border-slate-200 p-2 max-h-32 overflow-y-auto">
                  {roles.map((r: Role) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={allowedRoleIds.includes(r.id)} onCheckedChange={() => toggleRole(r.id)} />
                      {ml(r.nameJson) || `${t("workflow.rolePrefix", "Роль")} #${r.id}`}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-400">{t("workflow.rolesHint", "Если не выбрана ни одна роль — переход доступен всем ролям.")}</p>
            </div>

            <div className="space-y-1.5">
              <Label>{t("workflow.requiredFieldsLabel", "Обязательные поля для перехода")}</Label>
              {fields.length === 0 ? (
                <p className="text-xs text-slate-400">{t("workflow.noFields", "У сущности нет полей.")}</p>
              ) : (
                <div className="space-y-1.5 rounded-md border border-slate-200 p-2 max-h-32 overflow-y-auto">
                  {fields.map((f: Field) => (
                    <label key={f.fieldKey} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={requiredFieldKeys.includes(f.fieldKey)} onCheckedChange={() => toggleField(f.fieldKey)} />
                      {ml(f.nameJson) || f.fieldKey} <code className="text-xs text-slate-400">{f.fieldKey}</code>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-400">{t("workflow.requiredFieldsHint", "Эти поля должны быть заполнены, иначе переход не выполнится.")}</p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>{t("workflow.actionsLabel", "Действия при переходе")}</Label>
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1" onClick={addAction} disabled={fields.length === 0}>
                  <Plus className="w-3 h-3" /> {t("workflow.field", "Поле")}
                </Button>
              </div>
              {actions.length === 0 ? (
                <p className="text-xs text-slate-400">{t("workflow.noActions", "Нет действий. Можно автоматически проставлять значения полей.")}</p>
              ) : (
                <div className="space-y-2">
                  {actions.map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Select value={a.fieldKey} onValueChange={(v) => updateAction(i, { fieldKey: v })}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder={t("workflow.field", "Поле")} /></SelectTrigger>
                        <SelectContent>
                          {fields.map((f: Field) => (
                            <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-slate-400">=</span>
                      <Input className="flex-1" value={a.value} onChange={(e) => updateAction(i, { value: e.target.value })} placeholder={t("workflow.valuePlaceholder", "значение")} />
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => removeAction(i)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>{t("workflow.order", "Порядок")}</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("workflow.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? t("workflow.save", "Сохранить") : t("workflow.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workflow.deleteTitle", "Удалить переход?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("workflow.deleteConfirmPrefix", "Переход")} {toDelete ? `${ml(statusById.get(toDelete.fromStatusId)?.nameJson)} → ${ml(statusById.get(toDelete.toStatusId)?.nameJson)}` : ""} {t("workflow.deleteConfirmSuffix", "будет удалён безвозвратно.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("workflow.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => toDelete && deleteMutation.mutate({ id: toDelete.id })}
            >
              {t("workflow.delete", "Удалить")}
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
