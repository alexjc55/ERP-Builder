import { useEffect, useState } from "react";
import {
  useCreateEntityField,
  useUpdateField,
  useDeleteField,
  useListRoles,
  useListEntityFields,
  useListGoogleDriveFolders,
  useListUserOptions,
  useGetEntityRelationOptions,
  getGetEntityRelationOptionsQueryKey,
  type Field,
  type FieldType,
  type FieldAccess,
  type FieldPermissions,
  type Role,
  type MultilingualText,
  type FileSource,
  type FieldFormatRule,
} from "@workspace/api-client-react";

/** Flatten managed Drive folders into a depth-ordered list for indented display. */
function flattenDriveFolders<T extends { id: number; parentId?: number | null }>(
  folders: T[],
): { folder: T; depth: number }[] {
  const byParent = new Map<number | null, T[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(f);
  }
  const out: { folder: T; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const f of byParent.get(parent) ?? []) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FileSourcesConfig } from "@/components/FileSourcesConfig";
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
import { ColorPickerControl } from "@/components/ColorPickerControl";
import { useToast } from "@/hooks/use-toast";
import { FormulaEditor, type FormulaFieldRef } from "@/components/FormulaEditor";
import { normalizeDecimals } from "@workspace/formula";
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
  { value: "relation", label: "Связанное поле" },
  { value: "lookup", label: "Поле подстановки" },
];

const FIELD_ACCESS_OPTIONS: { value: FieldAccess; label: string }[] = [
  { value: "edit", label: "Редактирование" },
  { value: "view", label: "Просмотр" },
  { value: "hidden", label: "Скрыто" },
];


function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const data = (err as { data?: { error?: unknown } }).data;
    if (data && typeof data.error === "string" && data.error.trim()) return data.error;
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
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
  const { data: driveFolders = [] } = useListGoogleDriveFolders();
  const { data: userOptions = [] } = useListUserOptions();
  const [relationId, setRelationId] = useState<number | null>(null);
  const [relatedFieldKey, setRelatedFieldKey] = useState("");
  // lookup-only: when on, clicking a lookup cell opens the source record's
  // full editor (gated server-side by the viewer's update perm on that entity).
  const [writeThrough, setWriteThrough] = useState(false);
  const { data: relationOptionsData } = useGetEntityRelationOptions(entityId, {
    query: { enabled: open, queryKey: getGetEntityRelationOptionsQueryKey(entityId) },
  });
  const relationOptions = relationOptionsData?.options ?? [];
  // Entity relation fields surface a single linked record's value and only
  // make sense from the SOURCE side of a to-one relation (mirrors the Fields
  // Builder). Target-side / N:N relations are not eligible here.
  const relationFieldOptions = relationOptions.filter((o) => o.direction === "source");
  const canUseRelation = relationFieldOptions.length > 0;
  const selectedRelation = relationFieldOptions.find((o) => o.relationId === relationId);
  const relatedFieldOptions = selectedRelation?.fields ?? [];

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
  const [isPinned, setIsPinned] = useState(false);
  const [showColumnTotal, setShowColumnTotal] = useState(false);
  const [totalFillColor, setTotalFillColor] = useState("");
  const [totalTextColor, setTotalTextColor] = useState("");
  const [permissions, setPermissions] = useState<FieldPermissions>({});
  const [allowedSources, setAllowedSources] = useState<FileSource[]>(["server"]);
  const [driveFolderId, setDriveFolderId] = useState<string>("");
  const [allowedRoleIds, setAllowedRoleIds] = useState<number[]>([]);
  const [allowCreateUser, setAllowCreateUser] = useState(false);
  const [formatRules, setFormatRules] = useState<FieldFormatRule[]>([]);
  const [formula, setFormula] = useState("");
  const [formulaDecimals, setFormulaDecimals] = useState("");
  const [dependsOnFieldKey, setDependsOnFieldKey] = useState("");
  const [relatedFilterFieldKey, setRelatedFilterFieldKey] = useState("");
  const [isKey, setIsKey] = useState(false);
  const [lockAfterCreate, setLockAfterCreate] = useState(false);
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
      setIsPinned(field.isPinned ?? false);
      setShowColumnTotal(field.showColumnTotal ?? false);
      setTotalFillColor(field.totalFillColor ?? "");
      setTotalTextColor(field.totalTextColor ?? "");
      setPermissions(field.permissionsJson ?? {});
      {
        const src = field.fileConfigJson?.allowedSources;
        setAllowedSources(Array.isArray(src) && src.length > 0 ? src : ["server"]);
        setDriveFolderId(field.fileConfigJson?.driveFolderId ?? "");
      }
      setAllowedRoleIds(
        Array.isArray(field.userConfigJson?.allowedRoleIds) ? field.userConfigJson!.allowedRoleIds : [],
      );
      setAllowCreateUser(field.userConfigJson?.allowCreate === true);
      setFormatRules(Array.isArray(field.formatRulesJson) ? field.formatRulesJson : []);
      setFormula(field.formulaConfigJson?.expression ?? "");
      setFormulaDecimals(
        field.formulaConfigJson?.decimals != null ? String(field.formulaConfigJson.decimals) : "",
      );
      setDependsOnFieldKey(field.dependencyConfigJson?.dependsOnFieldKey ?? "");
      setRelatedFilterFieldKey(field.dependencyConfigJson?.relatedFilterFieldKey ?? "");
      setIsKey(field.isKey ?? false);
      setLockAfterCreate(field.lockAfterCreate ?? false);
      setRelationId(field.relationConfigJson?.relationId ?? null);
      setRelatedFieldKey(field.relationConfigJson?.relatedFieldKey ?? "");
      setWriteThrough(field.relationConfigJson?.writeThrough ?? false);
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
      setIsPinned(false);
      setShowColumnTotal(false);
      setTotalFillColor("");
      setTotalTextColor("");
      setPermissions({});
      setAllowedSources(["server"]);
      setDriveFolderId("");
      setAllowedRoleIds([]);
      setAllowCreateUser(false);
      setFormatRules([]);
      setFormula("");
      setFormulaDecimals("");
      setDependsOnFieldKey("");
      setRelatedFilterFieldKey("");
      setIsKey(false);
      setLockAfterCreate(false);
      setRelationId(null);
      setRelatedFieldKey("");
      setWriteThrough(false);
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

  // Candidate parent fields for a dependency: any OTHER field whose own
  // dependency chain does NOT already lead back to this field (cycle guard).
  const dependsByKey = new Map<string, string | undefined>(
    existingFields.map((f: Field) => [f.fieldKey, f.dependencyConfigJson?.dependsOnFieldKey]),
  );
  const wouldCycle = (candidateKey: string): boolean => {
    if (!field) return false;
    const selfKey = field.fieldKey;
    const seen = new Set<string>();
    let cur: string | undefined = candidateKey;
    while (cur && !seen.has(cur)) {
      if (cur === selfKey) return true;
      seen.add(cur);
      cur = dependsByKey.get(cur);
    }
    return false;
  };
  const dependencyCandidates = existingFields.filter(
    (f: Field) => f.id !== field?.id && f.fieldType !== "function" && !wouldCycle(f.fieldKey),
  );

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
      isPinned,
      showColumnTotal: fieldType === "number" || fieldType === "function" ? showColumnTotal : false,
      totalFillColor: (fieldType === "number" || fieldType === "function") && showColumnTotal && totalFillColor ? totalFillColor : null,
      totalTextColor: (fieldType === "number" || fieldType === "function") && showColumnTotal && totalTextColor ? totalTextColor : null,
      fileConfigJson:
        fieldType === "file"
          ? {
              allowedSources: allowedSources.length > 0 ? allowedSources : (["server"] as FileSource[]),
              ...(allowedSources.includes("gdrive") && driveFolderId ? { driveFolderId } : {}),
            }
          : {},
      userConfigJson: fieldType === "user" ? { allowedRoleIds, allowCreate: allowCreateUser } : {},
      formatRulesJson: formatRules,
      formulaConfigJson:
        fieldType === "function"
          ? {
              expression: formula.trim(),
              ...(normalizeDecimals(formulaDecimals) != null
                ? { decimals: normalizeDecimals(formulaDecimals) as number }
                : {}),
            }
          : {},
      dependencyConfigJson:
        fieldType === "text" && dependsOnFieldKey
          ? { dependsOnFieldKey }
          : fieldType === "relation" && dependsOnFieldKey && relatedFilterFieldKey
            ? { dependsOnFieldKey, relatedFilterFieldKey }
            : {},
      relationConfigJson:
        fieldType === "lookup"
          ? { relationId, relatedFieldKey: relatedFieldKey || null, writeThrough }
          : fieldType === "relation"
            ? { relationId, relatedFieldKey: relatedFieldKey || null }
            : {},
      isKey:
        fieldType !== "file" && fieldType !== "function" && fieldType !== "relation" && fieldType !== "lookup"
          ? isKey
          : false,
      lockAfterCreate:
        fieldType !== "file" &&
        fieldType !== "function" &&
        fieldType !== "lookup"
          ? lockAfterCreate
          : false,
    };
    if (field) updateMutation.mutate({ id: field.id, data: payload });
    else createMutation.mutate({ entityId, data: payload });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const relationIncomplete =
    (fieldType === "relation" || fieldType === "lookup") && (relationId == null || !relatedFieldKey);
  const canSubmit =
    !isPending && FIELD_KEY_RE.test(effectiveKey) && !manualKeyTaken && !keyFormatInvalid && !relationIncomplete;

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
                    {FIELD_TYPES.filter(
                      (ft) =>
                        (ft.value !== "relation" && ft.value !== "lookup") ||
                        canUseRelation ||
                        fieldType === ft.value,
                    ).map((ft) => (
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
            {(fieldType === "relation" || fieldType === "lookup") && (
              <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3 space-y-3">
                <p className="text-xs text-slate-500">
                  {fieldType === "lookup"
                    ? t(
                        "fields.lookupHint",
                        "Поле подстановки показывает значение из уже связанной записи (только для чтения). Выберите ту же связь, что и у связанного поля, и поле, значение которого нужно подставить.",
                      )
                    : t(
                        "fields.relationHint",
                        "Связанное поле показывает значение из единственной связанной записи. Доступны связи «один к одному» и «многие к одному», где эта сущность — источник.",
                      )}
                </p>
                <div className="space-y-1.5">
                  <Label>{t("fields.relation", "Связь")}</Label>
                  <Select
                    value={relationId != null ? String(relationId) : ""}
                    onValueChange={(v) => {
                      setRelationId(Number(v));
                      setRelatedFieldKey("");
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder={t("fields.relationPlaceholder", "Выберите связь")} /></SelectTrigger>
                    <SelectContent>
                      {relationFieldOptions.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-slate-400">
                          {t("fields.noRelations", "Нет подходящих связей для этой сущности.")}
                        </div>
                      ) : (
                        relationFieldOptions.map((o) => (
                          <SelectItem key={o.relationId} value={String(o.relationId)}>
                            {ml(o.label)} → {ml(o.relatedEntityLabel)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {relationId != null && (
                  <div className="space-y-1.5">
                    <Label>{t("fields.relatedField", "Поле связанной сущности")}</Label>
                    <Select value={relatedFieldKey} onValueChange={setRelatedFieldKey}>
                      <SelectTrigger><SelectValue placeholder={t("fields.relatedFieldPlaceholder", "Выберите поле")} /></SelectTrigger>
                      <SelectContent>
                        {relatedFieldOptions.map((f) => (
                          <SelectItem key={f.key} value={f.key}>{ml(f.label) || f.key}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {fieldType === "lookup" && relationId != null && relatedFieldKey && (
                  <div className="space-y-1.5 border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-2">
                      <Switch checked={writeThrough} onCheckedChange={setWriteThrough} id="fcd-lookup-write-through" />
                      <Label htmlFor="fcd-lookup-write-through">
                        {t("fields.lookupWriteThrough", "Разрешить редактирование исходной записи")}
                      </Label>
                    </div>
                    <p className="text-xs text-slate-400">
                      {t(
                        "fields.lookupWriteThroughHint",
                        "При клике по ячейке откроется окно исходной записи для редактирования (если у пользователя есть права на изменение исходной сущности).",
                      )}
                    </p>
                  </div>
                )}
                {fieldType === "relation" && relationId != null && relatedFieldKey && (
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    <div className="space-y-1.5">
                      <Label>{t("fields.dependsOn", "Зависит от поля")}</Label>
                      <Select
                        value={dependsOnFieldKey || "__none__"}
                        onValueChange={(v) => {
                          const nv = v === "__none__" ? "" : v;
                          setDependsOnFieldKey(nv);
                          if (!nv) setRelatedFilterFieldKey("");
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("fields.dependsOnNone", "Не зависит")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">{t("fields.dependsOnNone", "Не зависит")}</SelectItem>
                          {dependencyCandidates.map((f: Field) => (
                            <SelectItem key={f.id} value={f.fieldKey}>
                              {ml(f.nameJson) || f.fieldKey}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {dependsOnFieldKey && (
                      <div className="space-y-1.5">
                        <Label>
                          {t("fields.relatedFilterField", "Поле фильтрации в связанной сущности")}
                        </Label>
                        <Select
                          value={relatedFilterFieldKey || "__none__"}
                          onValueChange={(v) => setRelatedFilterFieldKey(v === "__none__" ? "" : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("fields.relatedFilterFieldPlaceholder", "Выберите поле")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t("fields.relatedFilterNone", "Без фильтра")}</SelectItem>
                            {relatedFieldOptions.map((f) => (
                              <SelectItem key={f.key} value={f.key}>{ml(f.label) || f.key}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {t(
                            "fields.relatedFilterHint",
                            "Список связанных записей будет сужен до тех, у кого это поле совпадает со значением родительского поля в текущей строке.",
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
                <FileSourcesConfig
                  value={allowedSources}
                  onChange={setAllowedSources}
                  t={t}
                  idPrefix="fcd-src"
                />
                {allowedSources.includes("gdrive") && (
                  <div className="space-y-1.5 pt-2">
                    <Label>{t("fields.driveFolder", "Папка Google Drive")}</Label>
                    <p className="text-xs text-slate-400">
                      {t(
                        "fields.driveFolderHint",
                        "Куда загружать файлы этого поля. По умолчанию — основная папка «ERP Uploads».",
                      )}
                    </p>
                    <Select
                      value={driveFolderId || "__default__"}
                      onValueChange={(v) => setDriveFolderId(v === "__default__" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">
                          {t("fields.driveFolderDefault", "По умолчанию (ERP Uploads)")}
                        </SelectItem>
                        {flattenDriveFolders(driveFolders).map(({ folder, depth }) => (
                          <SelectItem key={folder.driveFolderId} value={folder.driveFolderId}>
                            {depth > 0 ? "\u00A0".repeat(depth * 3) + "└ " : ""}
                            {folder.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
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
                <div className="flex items-start gap-2 pt-2 border-t border-slate-100 mt-2">
                  <Switch
                    id="fcd-user-allow-create"
                    checked={allowCreateUser}
                    onCheckedChange={setAllowCreateUser}
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor="fcd-user-allow-create">
                      {t("fields.userAllowCreate", "Разрешить создание новых пользователей")}
                    </Label>
                    <p className="text-xs text-slate-400">
                      {t("fields.userAllowCreateHint", "Добавляет в выпадающий список действие для создания нового пользователя. Создавать пользователей сможет любой, у кого есть право редактировать записи. Роль создаваемого пользователя ограничена выбранными выше ролями; назначить административную (привилегированную) роль через поле нельзя.")}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {fieldType === "function" && (
              <div className="space-y-3">
                <FormulaEditor value={formula} onChange={setFormula} fields={formulaFields} />
                <div className="space-y-1.5">
                  <Label htmlFor="fcd-formula-decimals">
                    {t("fields.formulaDecimals", "Знаков после запятой (округление)")}
                  </Label>
                  <Input
                    id="fcd-formula-decimals"
                    type="number"
                    min={0}
                    max={10}
                    value={formulaDecimals}
                    onChange={(e) => setFormulaDecimals(e.target.value)}
                    placeholder={t("fields.formulaDecimalsNone", "Без округления")}
                    className="w-48"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "fields.formulaDecimalsHint",
                      "Применяется только к числовому результату. Пусто — без округления.",
                    )}
                  </p>
                </div>
              </div>
            )}
            {fieldType === "text" && (
              <div className="space-y-1.5">
                <Label>{t("fields.dependsOn", "Зависит от поля")}</Label>
                <Select
                  value={dependsOnFieldKey || "__none__"}
                  onValueChange={(v) => setDependsOnFieldKey(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("fields.dependsOnNone", "Не зависит")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("fields.dependsOnNone", "Не зависит")}</SelectItem>
                    {dependencyCandidates.map((f: Field) => (
                      <SelectItem key={f.id} value={f.fieldKey}>
                        {ml(f.nameJson) || f.fieldKey}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "fields.dependsOnHint",
                    "Значения этого поля будут подсказываться из существующих записей с тем же родительским значением.",
                  )}
                </p>
              </div>
            )}
            {fieldType !== "function" && fieldType !== "relation" && fieldType !== "lookup" && (
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
              <div className="flex items-center gap-2">
                <Switch checked={isPinned} onCheckedChange={setIsPinned} id="fcd-pinned" />
                <Label htmlFor="fcd-pinned">{t("fields.pinColumn", "Закрепить при горизонтальной прокрутке")}</Label>
              </div>
              {fieldType !== "file" && fieldType !== "function" && fieldType !== "relation" && fieldType !== "lookup" && (
                <div className="flex items-center gap-2">
                  <Switch checked={isKey} onCheckedChange={setIsKey} id="fcd-is-key" />
                  <Label htmlFor="fcd-is-key">{t("fields.isKey", "Ключевое поле (уникальное)")}</Label>
                </div>
              )}
              {fieldType !== "file" && fieldType !== "function" && fieldType !== "lookup" && (
                <div className="flex items-center gap-2">
                  <Switch checked={lockAfterCreate} onCheckedChange={setLockAfterCreate} id="fcd-lock-after-create" />
                  <Label htmlFor="fcd-lock-after-create">{t("fields.lockAfterCreate", "Запрет изменения после создания")}</Label>
                </div>
              )}
              {(fieldType === "number" || fieldType === "function") && (
                <div className="flex items-center gap-2">
                  <Switch checked={showColumnTotal} onCheckedChange={setShowColumnTotal} id="fcd-show-column-total" />
                  <Label htmlFor="fcd-show-column-total">{t("fields.showColumnTotal", "Показывать сумму столбца")}</Label>
                </div>
              )}
            </div>

            {(fieldType === "number" || fieldType === "function") && showColumnTotal && (
              <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3 space-y-2">
                <p className="text-xs text-slate-500">
                  {t("fields.totalColorsHint", "Цвета ячейки итога столбца (необязательно)")}
                </p>
                <ColorPickerControl
                  label={t("fields.totalFillColor", "Цвет заливки")}
                  value={totalFillColor}
                  onChange={setTotalFillColor}
                />
                <ColorPickerControl
                  label={t("fields.totalTextColor", "Цвет текста")}
                  value={totalTextColor}
                  onChange={setTotalTextColor}
                />
              </div>
            )}

            <div className="border-t border-slate-100 pt-4">
              <FieldFormatRulesEditor
                fieldType={fieldType}
                options={optionsText.split("\n").map((o) => o.trim()).filter(Boolean)}
                users={userOptions}
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
