import { useEffect, useState } from "react";
import {
  useCreateEntityField,
  useUpdateField,
  useDeleteField,
  useListRoles,
  useListEntityFields,
  type Field,
  type FieldType,
  type FieldAccess,
  type FieldPermissions,
  type Role,
  type MultilingualText,
  type FileSource,
  type FieldFormatRule,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { MultilingualInput } from "@/components/MultilingualInput";
import { FieldFormatRulesEditor } from "@/components/FieldFormatRulesEditor";
import { useToast } from "@/hooks/use-toast";
import { FormulaEditor, type FormulaFieldRef } from "@/components/FormulaEditor";
import { useML, useT } from "@/lib/i18n";
import { FIELD_KEY_RE, slugifyKey, uniqueKey } from "@/lib/keys";
import { Loader2, Trash2 } from "lucide-react";

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
  { value: "function", label: "Формула (вычисляемое)" },
];

const FIELD_ACCESS_OPTIONS: { value: FieldAccess; label: string }[] = [
  { value: "edit", label: "Редактирование" },
  { value: "view", label: "Просмотр" },
  { value: "hidden", label: "Скрыто" },
];

const FILE_SOURCES: { value: FileSource; labelKey: string; label: string }[] = [
  { value: "server", labelKey: "fields.fileSource.server", label: "Загрузка на сервер" },
  { value: "gdrive", labelKey: "fields.fileSource.gdrive", label: "Загрузка в Google Drive" },
  { value: "link", labelKey: "fields.fileSource.link", label: "Ссылка" },
];

function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object" && "response" in err) {
    const resp = (err as { response?: { data?: { error?: string } } }).response;
    return resp?.data?.error;
  }
  return undefined;
}

/**
 * Shared create/edit dialog for an entity field (column). Used by the fields
 * builder and the records-page setup mode. Encapsulates the form, the per-role
 * access matrix, and the create/update/delete mutations.
 */
export function FieldConfigDialog({
  open,
  onOpenChange,
  entityId,
  field,
  nextSortOrder,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: number;
  field: Field | null;
  nextSortOrder: number;
  onSaved: () => void;
}) {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const { data: roles = [] } = useListRoles();
  const { data: existingFields = [] } = useListEntityFields(entityId);

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
  const [showColumnTotal, setShowColumnTotal] = useState(false);
  const [permissions, setPermissions] = useState<FieldPermissions>({});
  const [allowedSources, setAllowedSources] = useState<FileSource[]>(["server"]);
  const [allowedRoleIds, setAllowedRoleIds] = useState<number[]>([]);
  const [formatRules, setFormatRules] = useState<FieldFormatRule[]>([]);
  const [formula, setFormula] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync form state whenever the dialog opens for a given field (or create).
  useEffect(() => {
    if (!open) return;
    if (field) {
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
      setShowColumnTotal(field.showColumnTotal ?? false);
      setPermissions(field.permissionsJson ?? {});
      {
        const src = field.fileConfigJson?.allowedSources;
        setAllowedSources(Array.isArray(src) && src.length > 0 ? src : ["server"]);
      }
      setAllowedRoleIds(
        Array.isArray(field.userConfigJson?.allowedRoleIds) ? field.userConfigJson!.allowedRoleIds : [],
      );
      setFormatRules(Array.isArray(field.formatRulesJson) ? field.formatRulesJson : []);
      setFormula(field.formulaConfigJson?.expression ?? "");
    } else {
      setFieldKey("");
      setNameJson({});
      setDescJson({});
      setFieldType("text");
      setIsRequired(false);
      setDefaultValue("");
      setOptionsText("");
      setSortOrder(nextSortOrder);
      setIsActive(true);
      setIsFilterable(false);
      setShowInTable(true);
      setShowColumnTotal(false);
      setPermissions({});
      setAllowedSources(["server"]);
      setAllowedRoleIds([]);
      setFormatRules([]);
      setFormula("");
    }
  }, [open, field, nextSortOrder]);

  const createMutation = useCreateEntityField({
    mutation: {
      onSuccess: () => {
        toast({ title: t("fields.created", "Поле создано") });
        onOpenChange(false);
        onSaved();
      },
      onError: (err) =>
        toast({ title: t("fields.createError", "Ошибка создания поля"), description: extractError(err), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateField({
    mutation: {
      onSuccess: () => {
        toast({ title: t("fields.updated", "Поле обновлено") });
        onOpenChange(false);
        onSaved();
      },
      onError: (err) =>
        toast({ title: t("fields.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteField({
    mutation: {
      onSuccess: () => {
        toast({ title: t("fields.deleted", "Поле удалено") });
        setConfirmDelete(false);
        onOpenChange(false);
        onSaved();
      },
      onError: () => toast({ title: t("fields.deleteError", "Ошибка удаления поля"), variant: "destructive" }),
    },
  });

  const setRoleAccess = (roleId: number, access: FieldAccess | "inherit") => {
    setPermissions((prev) => {
      const next = { ...prev };
      if (access === "inherit") delete next[String(roleId)];
      else next[String(roleId)] = access;
      return next;
    });
  };

  // Auto-generate the system key from the name when left blank (mirrors the
  // entity-fields builder), so users no longer have to type a valid key by hand.
  const existingKeys = new Set(
    existingFields.filter((f: Field) => f.id !== field?.id).map((f: Field) => f.fieldKey),
  );
  const trimmedKey = fieldKey.trim();
  const nameForKey = (nameJson.en || nameJson.ru || nameJson.he || "").toString();
  const generatedKey = uniqueKey(slugifyKey(nameForKey) || "field", existingKeys);
  const keyFormatInvalid = trimmedKey !== "" && !FIELD_KEY_RE.test(trimmedKey);
  const manualKeyTaken = trimmedKey !== "" && existingKeys.has(trimmedKey);
  const effectiveKey = trimmedKey || generatedKey;

  // Fields a formula can reference: this entity's other non-formula columns.
  const formulaFields: FormulaFieldRef[] = existingFields
    .filter((f: Field) => f.id !== field?.id && f.fieldType !== "function")
    .map((f: Field) => ({ key: f.fieldKey, label: ml(f.nameJson) || f.fieldKey }));

  const handleSubmit = () => {
    const options = optionsText
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    const payload = {
      fieldKey: effectiveKey,
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
      showColumnTotal: fieldType === "number" ? showColumnTotal : false,
      fileConfigJson:
        fieldType === "file"
          ? { allowedSources: allowedSources.length > 0 ? allowedSources : (["server"] as FileSource[]) }
          : {},
      userConfigJson: fieldType === "user" ? { allowedRoleIds } : {},
      formatRulesJson: formatRules,
      formulaConfigJson: fieldType === "function" ? { expression: formula.trim() } : {},
    };
    if (field) updateMutation.mutate({ id: field.id, data: payload });
    else createMutation.mutate({ entityId, data: payload });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const canSubmit = !isPending && FIELD_KEY_RE.test(effectiveKey) && !manualKeyTaken && !keyFormatInvalid;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{field ? t("fields.editTitle", "Редактировать поле") : t("fields.newTitle", "Новое поле")}</DialogTitle>
            <DialogDescription>
              {t("fields.dialogDesc", "Поле — это столбец данных сущности с типом, обязательностью и значением по умолчанию.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label={t("fields.name", "Название")} value={nameJson} onChange={setNameJson} required />
            <MultilingualInput label={t("fields.description", "Описание")} value={descJson} onChange={setDescJson} multiline />
            <div className="space-y-1.5">
              <Label>{t("fields.systemKey", "Системный ключ")}</Label>
              <Input
                value={fieldKey}
                onChange={(e) => setFieldKey(e.target.value)}
                placeholder="title"
                className="font-mono"
              />
              {manualKeyTaken ? (
                <p className="text-xs text-red-500">{t("fields.keyTaken", "Такой ключ уже используется в этой сущности.")}</p>
              ) : keyFormatInvalid ? (
                <p className="text-xs text-red-500">{t("fields.keyInvalid", "Только строчные латинские буквы, цифры и подчёркивания.")}</p>
              ) : (
                <p className="text-xs text-slate-400">
                  {t("fields.keyAutoHint", "Оставьте пустым — ключ создастся автоматически из названия. Можно задать вручную: ")}
                  <code>{trimmedKey || generatedKey || "field"}</code>
                </p>
              )}
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
                          id={`fcd-src-${s.value}`}
                          checked={checked}
                          onCheckedChange={(on) =>
                            setAllowedSources((prev) => {
                              const next = on ? [...prev, s.value] : prev.filter((x) => x !== s.value);
                              return next.length > 0 ? next : prev;
                            })
                          }
                        />
                        <Label htmlFor={`fcd-src-${s.value}`}>{t(s.labelKey, s.label)}</Label>
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
                            id={`fcd-role-${role.id}`}
                            checked={checked}
                            onCheckedChange={(on) =>
                              setAllowedRoleIds((prev) =>
                                on ? [...prev, role.id] : prev.filter((x) => x !== role.id),
                              )
                            }
                          />
                          <Label htmlFor={`fcd-role-${role.id}`}>{ml(role.nameJson)}</Label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {fieldType === "function" && (
              <FormulaEditor value={formula} onChange={setFormula} fields={formulaFields} />
            )}
            {fieldType !== "function" && (
              <div className="space-y-1.5">
                <Label>{t("fields.defaultValue", "Значение по умолчанию")}</Label>
                <Input value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} placeholder="—" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="flex items-center gap-2">
                <Switch checked={isRequired} onCheckedChange={setIsRequired} id="fcd-required" />
                <Label htmlFor="fcd-required">{t("fields.required", "Обязательное")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} id="fcd-active" />
                <Label htmlFor="fcd-active">{t("fields.active", "Активно")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isFilterable} onCheckedChange={setIsFilterable} id="fcd-filterable" />
                <Label htmlFor="fcd-filterable">{t("fields.filterable", "Участвует в фильтре")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={showInTable} onCheckedChange={setShowInTable} id="fcd-show-in-table" />
                <Label htmlFor="fcd-show-in-table">{t("fields.showInTable", "Показывать в таблице")}</Label>
              </div>
              {fieldType === "number" && (
                <div className="flex items-center gap-2">
                  <Switch checked={showColumnTotal} onCheckedChange={setShowColumnTotal} id="fcd-show-column-total" />
                  <Label htmlFor="fcd-show-column-total">{t("fields.showColumnTotal", "Показывать сумму столбца")}</Label>
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <FieldFormatRulesEditor
                fieldType={fieldType}
                options={optionsText.split("\n").map((o) => o.trim()).filter(Boolean)}
                rules={formatRules}
                onChange={setFormatRules}
              />
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-2">
              <Label>{t("fields.accessByRoles", "Доступ к полю по ролям")}</Label>
              <p className="text-xs text-slate-400">
                {t("fields.accessHint", "«По умолчанию» — поле наследует права роли на записи (изменение ⇒ редактирование, иначе просмотр). Суперадмины видят и редактируют всё.")}
              </p>
              {roles.length === 0 ? (
                <p className="text-xs text-slate-400">{t("fields.noRoles", "Нет ролей для настройки.")}</p>
              ) : (
                <div className="space-y-2 pt-1">
                  {roles.map((role: Role) => (
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
          <DialogFooter className="gap-2 sm:justify-between">
            {field ? (
              <Button
                variant="ghost"
                className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1.5"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="w-4 h-4" />
                {t("fields.delete", "Удалить")}
              </Button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t("fields.cancel", "Отмена")}</Button>
              <Button onClick={handleSubmit} disabled={!canSubmit} className="bg-blue-600 hover:bg-blue-700">
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : field ? t("fields.save", "Сохранить") : t("fields.create", "Создать")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("fields.deleteTitle", "Удалить поле?")}</AlertDialogTitle>
            <AlertDialogDescription>
              "{ml(field?.nameJson)}" {t("fields.deleteSuffix", "будет удалено безвозвратно.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("fields.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => field && deleteMutation.mutate({ id: field.id })}
            >
              {t("fields.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
