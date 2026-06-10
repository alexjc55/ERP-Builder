import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useListEntityFields,
  useCreateEntityField,
  useUpdateField,
  useDeleteField,
  useReorderFields,
  useListEntities,
  useListRoles,
  type Field,
  type Entity,
  type FieldType,
  type FieldAccess,
  type FieldPermissions,
  type FileSource,
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
import { Plus, Pencil, Trash2, Loader2, ArrowLeft, Columns3, KeyRound, ChevronUp, ChevronDown } from "lucide-react";
import { useML, useT } from "@/lib/i18n";
import { FIELD_KEY_RE, slugifyKey, uniqueKey } from "@/lib/keys";

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
  { value: "file", label: "Файл" },
];

const FILE_SOURCES: { value: FileSource; labelKey: string; label: string }[] = [
  { value: "server", labelKey: "fields.fileSource.server", label: "Загрузка на сервер" },
  { value: "gdrive", labelKey: "fields.fileSource.gdrive", label: "Загрузка в Google Drive" },
  { value: "link", labelKey: "fields.fileSource.link", label: "Ссылка" },
];

const FIELD_ACCESS_OPTIONS: { value: FieldAccess; label: string }[] = [
  { value: "edit", label: "Редактирование" },
  { value: "view", label: "Просмотр" },
  { value: "hidden", label: "Скрыто" },
];

function typeLabel(t: string): string {
  return FIELD_TYPES.find((ft) => ft.value === t)?.label ?? t;
}

export default function EntityFieldsPage() {
  const ml = useML();
  const t = useT();
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
  const [isFilterable, setIsFilterable] = useState(false);
  const [showInTable, setShowInTable] = useState(true);
  const [permissions, setPermissions] = useState<FieldPermissions>({});
  const [allowedSources, setAllowedSources] = useState<FileSource[]>(["server"]);
  const [allowedRoleIds, setAllowedRoleIds] = useState<number[]>([]);

  const { data: entities = [] } = useListEntities();
  const { data: roles = [] } = useListRoles();
  const entity = entities.find((e: Entity) => e.id === entityId);

  const { data: fields = [], isLoading } = useListEntityFields(entityId);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/fields`] });

  const createMutation = useCreateEntityField({
    mutation: {
      onSuccess: () => { toast({ title: t("fields.created", "Поле создано") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("fields.createError", "Ошибка создания поля"), description: extractError(err), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateField({
    mutation: {
      onSuccess: () => { toast({ title: t("fields.updated", "Поле обновлено") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("fields.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }),
    },
  });

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
    setIsFilterable(false);
    setShowInTable(true);
    setPermissions({});
    setAllowedSources(["server"]);
    setAllowedRoleIds([]);
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
    setIsFilterable(field.isFilterable ?? false);
    setShowInTable(field.showInTable ?? true);
    setPermissions(field.permissionsJson ?? {});
    setAllowedSources(
      field.fileConfigJson?.allowedSources && field.fileConfigJson.allowedSources.length > 0
        ? field.fileConfigJson.allowedSources
        : ["server"],
    );
    setAllowedRoleIds(
      Array.isArray(field.userConfigJson?.allowedRoleIds) ? field.userConfigJson!.allowedRoleIds : [],
    );
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const options = optionsText
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    const resolvedKey = fieldKey.trim() || uniqueKey(slugifyKey(nameForKey), existingKeys);
    const payload = {
      fieldKey: resolvedKey,
      nameJson: nameJson as MultilingualText,
      descriptionJson: descJson as MultilingualText,
      fieldType,
      isRequired,
      defaultValue: defaultValue.trim() ? defaultValue.trim() : null,
      optionsJson: options,
      permissionsJson: permissions,
      sortOrder,
      isActive,
      isFilterable,
      showInTable,
      fileConfigJson:
        fieldType === "file"
          ? { allowedSources: allowedSources.length > 0 ? allowedSources : (["server"] as FileSource[]) }
          : {},
      userConfigJson: fieldType === "user" ? { allowedRoleIds } : {},
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
  const assignableRoles = roles;

  const existingKeys = new Set(
    fields.filter((f: Field) => f.id !== editingField?.id).map((f: Field) => f.fieldKey),
  );
  const nameForKey = (nameJson.en || nameJson.ru || nameJson.he || "").toString();
  const generatedKey = uniqueKey(slugifyKey(nameForKey), existingKeys);
  const trimmedKey = fieldKey.trim();
  const keyFormatInvalid = trimmedKey !== "" && !FIELD_KEY_RE.test(trimmedKey);
  const manualKeyTaken = trimmedKey !== "" && existingKeys.has(trimmedKey);
  const effectiveKey = trimmedKey || generatedKey;
  const canSubmit = !isPending && FIELD_KEY_RE.test(effectiveKey) && !manualKeyTaken;

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
                      <span className="font-medium text-slate-700">{ml(field.nameJson)}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{field.fieldKey}</td>
                    <td className="px-4 py-3">
                      <Badge className="bg-slate-100 text-slate-600 border-0 font-normal">
                        {t(`fields.type.${field.fieldType}`, typeLabel(field.fieldType))}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {field.isRequired ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
                          <KeyRound className="w-3 h-3" /> {t("fields.yes", "Да")}
                        </span>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingField ? t("fields.editTitle", "Редактировать поле") : t("fields.newTitle", "Новое поле")}</DialogTitle>
            <DialogDescription>
              {t("fields.dialogDesc", "Поле — это столбец данных сущности с типом, обязательностью и значением по умолчанию.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label={t("fields.name", "Название")} value={nameJson} onChange={setNameJson} required />
            <MultilingualInput label={t("fields.description", "Описание")} value={descJson} onChange={setDescJson} multiline />
            <div className="space-y-1.5">
              <Label>
                {t("fields.systemKey", "Системный ключ")}
                <span className="text-red-500 ml-1">*</span>
              </Label>
              <Input
                value={fieldKey}
                onChange={(e) => setFieldKey(e.target.value)}
                placeholder={generatedKey || "title"}
                className="font-mono"
              />
              <p className="text-xs text-slate-400">
                {t("fields.keyHintPre", "Только строчные латинские буквы, цифры и подчёркивания (например, ")}<code>start_date</code>{t("fields.keyHintPost", "). Уникален в пределах сущности.")}
              </p>
              {keyFormatInvalid ? (
                <p className="text-xs text-red-500">
                  {t("fields.keyInvalid", "Системный ключ должен состоять только из строчных латинских букв, цифр и подчёркиваний и начинаться с буквы (например, attachment).")}
                </p>
              ) : manualKeyTaken ? (
                <p className="text-xs text-red-500">
                  {t("fields.keyTaken", "Поле с таким системным ключом уже существует в этой сущности.")}
                </p>
              ) : trimmedKey === "" && generatedKey !== "" ? (
                <p className="text-xs text-slate-400">
                  {t("fields.keyAutoHint", "Если оставить пустым, ключ будет сгенерирован автоматически из названия:")}{" "}
                  <code>{generatedKey}</code>
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("fields.fieldType", "Тип поля")}</Label>
                <Select value={fieldType} onValueChange={(v) => setFieldType(v as FieldType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((ft) => (
                      <SelectItem key={ft.value} value={ft.value}>{t(`fields.type.${ft.value}`, ft.label)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.sortOrder", "Порядок")}</Label>
                <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
              </div>
            </div>
            {fieldType === "select" && (
              <div className="space-y-1.5">
                <Label>{t("fields.options", "Варианты списка")}</Label>
                <Textarea
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder={t("fields.optionsPlaceholder", "Новая\nВ работе\nЗавершена")}
                  rows={4}
                />
                <p className="text-xs text-slate-400">{t("fields.optionsHint", "По одному варианту на строку.")}</p>
              </div>
            )}
            {fieldType === "file" && (
              <div className="space-y-2">
                <Label>{t("fields.fileSources", "Разрешённые источники файлов")}</Label>
                <p className="text-xs text-slate-400">
                  {t("fields.fileSourcesHint", "Выберите, как пользователи смогут прикреплять файлы. Должен быть выбран хотя бы один источник.")}
                </p>
                <div className="space-y-1.5 pt-1">
                  {FILE_SOURCES.map((s) => {
                    const checked = allowedSources.includes(s.value);
                    return (
                      <div key={s.value} className="flex items-center gap-2">
                        <Switch
                          id={`field-src-${s.value}`}
                          checked={checked}
                          onCheckedChange={(on) =>
                            setAllowedSources((prev) => {
                              const next = on ? [...prev, s.value] : prev.filter((x) => x !== s.value);
                              return next.length > 0 ? next : prev;
                            })
                          }
                        />
                        <Label htmlFor={`field-src-${s.value}`}>{t(s.labelKey, s.label)}</Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {fieldType === "user" && (
              <div className="space-y-2">
                <Label>{t("fields.userRoles", "Доступные роли пользователей")}</Label>
                <p className="text-xs text-slate-400">
                  {t("fields.userRolesHint", "Ограничьте выбор пользователями указанных ролей. Если ничего не выбрано — доступны все пользователи.")}
                </p>
                {roles.length === 0 ? (
                  <p className="text-xs text-slate-400">{t("fields.noRoles", "Нет ролей для настройки.")}</p>
                ) : (
                  <div className="space-y-1.5 pt-1">
                    {roles.map((role: Role) => {
                      const checked = allowedRoleIds.includes(role.id);
                      return (
                        <div key={role.id} className="flex items-center gap-2">
                          <Switch
                            id={`field-role-${role.id}`}
                            checked={checked}
                            onCheckedChange={(on) =>
                              setAllowedRoleIds((prev) =>
                                on ? [...prev, role.id] : prev.filter((x) => x !== role.id),
                              )
                            }
                          />
                          <Label htmlFor={`field-role-${role.id}`}>{ml(role.nameJson)}</Label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("fields.defaultValue", "Значение по умолчанию")}</Label>
              <Input
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                placeholder="—"
              />
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <Switch checked={isRequired} onCheckedChange={setIsRequired} id="field-required" />
                <Label htmlFor="field-required">{t("fields.required", "Обязательное")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} id="field-active" />
                <Label htmlFor="field-active">{t("fields.active", "Активно")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isFilterable} onCheckedChange={setIsFilterable} id="field-filterable" />
                <Label htmlFor="field-filterable">{t("fields.filterable", "Участвует в фильтре")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={showInTable} onCheckedChange={setShowInTable} id="field-show-in-table" />
                <Label htmlFor="field-show-in-table">{t("fields.showInTable", "Показывать в таблице")}</Label>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-2">
              <Label>{t("fields.accessByRoles", "Доступ к полю по ролям")}</Label>
              <p className="text-xs text-slate-400">
                {t("fields.accessHint", "«По умолчанию» — поле наследует права роли на записи (изменение ⇒ редактирование, иначе просмотр). Суперадмины видят и редактируют всё.")}
              </p>
              {assignableRoles.length === 0 ? (
                <p className="text-xs text-slate-400">{t("fields.noRoles", "Нет ролей для настройки.")}</p>
              ) : (
                <div className="space-y-2 pt-1">
                  {assignableRoles.map((role: Role) => (
                    <div key={role.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-slate-700 truncate">{ml(role.nameJson)}</span>
                      <Select
                        value={permissions[String(role.id)] ?? "inherit"}
                        onValueChange={(v) => setRoleAccess(role.id, v as FieldAccess | "inherit")}
                      >
                        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">{t("fields.inherit", "По умолчанию")}</SelectItem>
                          {FIELD_ACCESS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{t(`fields.access.${o.value}`, o.label)}</SelectItem>
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
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("fields.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={!canSubmit} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingField ? t("fields.save", "Сохранить") : t("fields.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const data = (err as { data?: { error?: unknown } }).data;
    if (data && typeof data.error === "string" && data.error.trim()) return data.error;
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return undefined;
}
