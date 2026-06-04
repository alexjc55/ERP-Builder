import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useListEntityFields,
  useCreateEntityField,
  useUpdateField,
  useDeleteField,
  useListEntities,
  useListRoles,
  type Field,
  type Entity,
  type FieldType,
  type FieldAccess,
  type FieldPermissions,
  type Role,
  type MultilingualText,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Pencil, Trash2, Loader2, ArrowLeft, Columns3, KeyRound } from "lucide-react";

type MLValue = { ru?: string; en?: string; he?: string };

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Текст" },
  { value: "textarea", label: "Многострочный текст" },
  { value: "number", label: "Число" },
  { value: "boolean", label: "Да / Нет" },
  { value: "date", label: "Дата" },
  { value: "datetime", label: "Дата и время" },
  { value: "select", label: "Список (выбор)" },
  { value: "email", label: "Email" },
  { value: "url", label: "Ссылка (URL)" },
  { value: "phone", label: "Телефон" },
  { value: "user", label: "Пользователь" },
];

const FIELD_ACCESS_OPTIONS: { value: FieldAccess; label: string }[] = [
  { value: "edit", label: "Редактирование" },
  { value: "view", label: "Просмотр" },
  { value: "hidden", label: "Скрыто" },
];

function typeLabel(t: string): string {
  return FIELD_TYPES.find((ft) => ft.value === t)?.label ?? t;
}

function getML(val: MultilingualText | string | undefined | null): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.ru || val.en || val.he || "";
}

export default function EntityFieldsPage() {
  const params = useParams();
  const entityId = Number(params.entityId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<Field | null>(null);
  const [deleteField, setDeleteField] = useState<Field | null>(null);

  const [fieldKey, setFieldKey] = useState("");
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [descJson, setDescJson] = useState<MLValue>({});
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [isRequired, setIsRequired] = useState(false);
  const [defaultValue, setDefaultValue] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [permissions, setPermissions] = useState<FieldPermissions>({});

  const { data: entities = [] } = useListEntities();
  const { data: roles = [] } = useListRoles();
  const entity = entities.find((e: Entity) => e.id === entityId);

  const { data: fields = [], isLoading } = useListEntityFields(entityId);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/fields`] });

  const createMutation = useCreateEntityField({
    mutation: {
      onSuccess: () => { toast({ title: "Поле создано" }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: "Ошибка создания поля", description: extractError(err), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateField({
    mutation: {
      onSuccess: () => { toast({ title: "Поле обновлено" }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: "Ошибка обновления", description: extractError(err), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteField({
    mutation: {
      onSuccess: () => { toast({ title: "Поле удалено" }); setDeleteField(null); invalidate(); },
      onError: () => toast({ title: "Ошибка удаления поля", variant: "destructive" }),
    },
  });

  const openCreate = () => {
    setEditingField(null);
    setFieldKey("");
    setNameJson({});
    setDescJson({});
    setFieldType("text");
    setIsRequired(false);
    setDefaultValue("");
    setOptionsText("");
    setSortOrder(fields.length + 1);
    setIsActive(true);
    setPermissions({});
    setDialogOpen(true);
  };

  const openEdit = (field: Field) => {
    setEditingField(field);
    const n = field.nameJson;
    const d = field.descriptionJson;
    setFieldKey(field.fieldKey);
    setNameJson(typeof n === "object" && n ? { ru: n.ru, en: n.en, he: n.he } : {});
    setDescJson(typeof d === "object" && d ? { ru: d.ru, en: d.en, he: d.he } : {});
    setFieldType(field.fieldType);
    setIsRequired(field.isRequired);
    setDefaultValue(field.defaultValue ?? "");
    setOptionsText((field.optionsJson ?? []).join("\n"));
    setSortOrder(field.sortOrder);
    setIsActive(field.isActive);
    setPermissions(field.permissionsJson ?? {});
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const options = optionsText
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    const payload = {
      fieldKey: fieldKey.trim(),
      nameJson: nameJson as MultilingualText,
      descriptionJson: descJson as MultilingualText,
      fieldType,
      isRequired,
      defaultValue: defaultValue.trim() ? defaultValue.trim() : null,
      optionsJson: options,
      permissionsJson: permissions,
      sortOrder,
      isActive,
    };
    if (editingField) {
      updateMutation.mutate({ id: editingField.id, data: payload });
    } else {
      createMutation.mutate({ entityId, data: payload });
    }
  };

  const setRoleAccess = (roleId: number, access: FieldAccess | "inherit") => {
    setPermissions((prev) => {
      const next = { ...prev };
      if (access === "inherit") {
        delete next[String(roleId)];
      } else {
        next[String(roleId)] = access;
      }
      return next;
    });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const sorted = [...fields].sort((a: Field, b: Field) => a.sortOrder - b.sortOrder);
  const assignableRoles = roles.filter((r: Role) => !r.permissionsJson?.superAdmin);

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          onClick={() => navigate("/admin/entities")}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          К списку сущностей
        </button>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Columns3 className="w-6 h-6 text-blue-600" />
              Поля{entity ? `: ${getML(entity.nameJson)}` : ""}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Структура полей сущности{entity ? <> <code className="text-xs">{entity.entityKey}</code></> : null}
            </p>
          </div>
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
            <Plus className="w-4 h-4" />
            Добавить поле
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
              У этой сущности ещё нет полей. Нажмите «Добавить поле», чтобы создать первое.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Название</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Ключ</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Тип</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Обязательное</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Статус</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Действия</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((field: Field) => (
                  <tr key={field.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-700">{getML(field.nameJson)}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{field.fieldKey}</td>
                    <td className="px-4 py-3">
                      <Badge className="bg-slate-100 text-slate-600 border-0 font-normal">
                        {typeLabel(field.fieldType)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {field.isRequired ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
                          <KeyRound className="w-3 h-3" /> Да
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">Нет</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {field.isActive ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">Активно</Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">Скрыто</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingField ? "Редактировать поле" : "Новое поле"}</DialogTitle>
            <DialogDescription>
              Поле — это столбец данных сущности с типом, обязательностью и значением по умолчанию.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label="Название" value={nameJson} onChange={setNameJson} required />
            <MultilingualInput label="Описание" value={descJson} onChange={setDescJson} multiline />
            <div className="space-y-1.5">
              <Label>Системный ключ</Label>
              <Input
                value={fieldKey}
                onChange={(e) => setFieldKey(e.target.value)}
                placeholder="title"
                className="font-mono"
              />
              <p className="text-xs text-slate-400">
                Только строчные латинские буквы, цифры и подчёркивания (например, <code>start_date</code>). Уникален в пределах сущности.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Тип поля</Label>
                <Select value={fieldType} onValueChange={(v) => setFieldType(v as FieldType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((ft) => (
                      <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Порядок</Label>
                <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
              </div>
            </div>
            {fieldType === "select" && (
              <div className="space-y-1.5">
                <Label>Варианты списка</Label>
                <Textarea
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder={"Новая\nВ работе\nЗавершена"}
                  rows={4}
                />
                <p className="text-xs text-slate-400">По одному варианту на строку.</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Значение по умолчанию</Label>
              <Input
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="—"
              />
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={isRequired} onCheckedChange={setIsRequired} id="field-required" />
                <Label htmlFor="field-required">Обязательное</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} id="field-active" />
                <Label htmlFor="field-active">Активно</Label>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-2">
              <Label>Доступ к полю по ролям</Label>
              <p className="text-xs text-slate-400">
                «По умолчанию» — поле наследует права роли на записи (изменение ⇒ редактирование, иначе просмотр). Суперадмины видят и редактируют всё.
              </p>
              {assignableRoles.length === 0 ? (
                <p className="text-xs text-slate-400">Нет ролей для настройки.</p>
              ) : (
                <div className="space-y-2 pt-1">
                  {assignableRoles.map((role: Role) => (
                    <div key={role.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-700 truncate">{getML(role.nameJson)}</span>
                      <Select
                        value={permissions[String(role.id)] ?? "inherit"}
                        onValueChange={(v) => setRoleAccess(role.id, v as FieldAccess | "inherit")}
                      >
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">По умолчанию</SelectItem>
                          {FIELD_ACCESS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingField ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteField} onOpenChange={(o) => !o && setDeleteField(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить поле?</AlertDialogTitle>
            <AlertDialogDescription>
              "{getML(deleteField?.nameJson)}" будет удалено безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteField && deleteMutation.mutate({ id: deleteField.id })}
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
