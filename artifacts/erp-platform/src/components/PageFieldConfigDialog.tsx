import { useEffect, useState } from "react";
import {
  useCreatePageField,
  useUpdatePageField,
  useDeletePageField,
  useListPageFields,
  useGetPageRelationOptions,
  getGetPageRelationOptionsQueryKey,
  useListRoles,
  useListUserOptions,
  type PageField,
  type FieldType,
  type MultilingualText,
  type FieldFormatRule,
  type FieldPermissions,
  type FieldAccess,
  type Role,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { MultilingualInput } from "@/components/MultilingualInput";
import { SelectOptionsEditor } from "@/components/SelectOptionsEditor";
import { normalizeSelectOptions, type SelectOption } from "@/lib/selectOptions";
import { FieldFormatRulesEditor } from "@/components/FieldFormatRulesEditor";
import { ColorPickerControl } from "@/components/ColorPickerControl";
import { FormulaEditor, type FormulaFieldRef } from "@/components/FormulaEditor";
import { normalizeDecimals } from "@workspace/formula";
import { useToast } from "@/hooks/use-toast";
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
  { value: "function", label: "Формула (вычисляемое)" },
  { value: "relation", label: "Связанное поле" },
  { value: "lookup", label: "Поле подстановки" },
];

const FIELD_ACCESS_OPTIONS: { value: FieldAccess; label: string }[] = [
  { value: "edit", label: "Редактирование" },
  { value: "view", label: "Просмотр" },
  { value: "hidden", label: "Скрыто" },
];

// Page-local field types that can participate in the records filter bar. Limited
// to types whose filter options are deterministic on the client (select options,
// yes/no) or use a date range — so no dependent-values endpoint is needed.
const PAGE_FILTERABLE_TYPES = new Set<FieldType>(["select", "boolean", "date", "datetime"]);

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
 * Create/edit dialog for a page-local field (a column that lives on a mirror
 * page, not on the source entity). Mirrors {@link FieldConfigDialog} but writes
 * to the page-fields endpoints and omits entity-only options (per-role access,
 * file/user config, filtering).
 */
export function PageFieldConfigDialog({
  open,
  onOpenChange,
  pageId,
  entityId,
  field,
  nextSortOrder,
  sourceFields = [],
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: number;
  /** The page's effective entity (drives the relation picker). */
  entityId: number;
  field: PageField | null;
  nextSortOrder: number;
  /** Source-entity fields a page formula may also reference (merged at read time). */
  sourceFields?: FormulaFieldRef[];
  onSaved: () => void;
}) {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const { data: existingFields = [] } = useListPageFields(pageId);
  const { data: relationOptionsData } = useGetPageRelationOptions(pageId, {
    query: { enabled: open, queryKey: getGetPageRelationOptionsQueryKey(pageId) },
  });
  const relationOptions = relationOptionsData?.options ?? [];
  const { data: roles = [] } = useListRoles();
  const { data: userOptions = [] } = useListUserOptions();

  const [fieldKey, setFieldKey] = useState("");
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [descJson, setDescJson] = useState<MLValue>({});
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [isRequired, setIsRequired] = useState(false);
  const [isFilterable, setIsFilterable] = useState(false);
  const [defaultValue, setDefaultValue] = useState("");
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [showInTable, setShowInTable] = useState(true);
  const [isPinned, setIsPinned] = useState(false);
  const [showColumnTotal, setShowColumnTotal] = useState(false);
  const [totalFillColor, setTotalFillColor] = useState("");
  const [totalTextColor, setTotalTextColor] = useState("");
  const [formatRules, setFormatRules] = useState<FieldFormatRule[]>([]);
  const [formula, setFormula] = useState("");
  const [formulaDecimals, setFormulaDecimals] = useState("");
  const [relationId, setRelationId] = useState<number | null>(null);
  const [relatedFieldKey, setRelatedFieldKey] = useState("");
  // relation + lookup: when set, the field projects a PAGE-LOCAL field of the
  // linked record instead of one of its entity fields (value read-only; a
  // relation field's link itself stays assignable).
  const [relatedPageId, setRelatedPageId] = useState<number | null>(null);
  const [permissions, setPermissions] = useState<FieldPermissions>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      setIsFilterable(field.isFilterable ?? false);
      setDefaultValue(field.defaultValue ?? "");
      setOptions(normalizeSelectOptions(field.optionsJson));
      setSortOrder(field.sortOrder);
      setIsActive(field.isActive);
      setShowInTable(field.showInTable ?? true);
      setIsPinned(field.isPinned ?? false);
      setShowColumnTotal(field.showColumnTotal ?? false);
      setTotalFillColor(field.totalFillColor ?? "");
      setTotalTextColor(field.totalTextColor ?? "");
      setFormatRules(Array.isArray(field.formatRulesJson) ? field.formatRulesJson : []);
      setFormula(field.formulaConfigJson?.expression ?? "");
      setFormulaDecimals(
        field.formulaConfigJson?.decimals != null ? String(field.formulaConfigJson.decimals) : "",
      );
      setRelationId(field.relationConfigJson?.relationId ?? null);
      setRelatedFieldKey(field.relationConfigJson?.relatedFieldKey ?? "");
      setRelatedPageId(field.relationConfigJson?.relatedPageId ?? null);
      setPermissions(field.permissionsJson ? { ...field.permissionsJson } : {});
    } else {
      setFieldKey("");
      setNameJson({});
      setDescJson({});
      setFieldType("text");
      setIsRequired(false);
      setIsFilterable(false);
      setDefaultValue("");
      setOptions([]);
      setSortOrder(nextSortOrder);
      setIsActive(true);
      setShowInTable(true);
      setIsPinned(false);
      setShowColumnTotal(false);
      setTotalFillColor("");
      setTotalTextColor("");
      setFormatRules([]);
      setFormula("");
      setFormulaDecimals("");
      setRelationId(null);
      setRelatedFieldKey("");
      setRelatedPageId(null);
      setPermissions({});
    }
  }, [open, field, nextSortOrder]);

  const createMutation = useCreatePageField({
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

  const updateMutation = useUpdatePageField({
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

  const deleteMutation = useDeletePageField({
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

  const existingKeys = new Set(
    existingFields.filter((f: PageField) => f.id !== field?.id).map((f: PageField) => f.fieldKey),
  );
  const trimmedKey = fieldKey.trim();
  const nameForKey = (nameJson.en || nameJson.ru || nameJson.he || "").toString();
  const generatedKey = uniqueKey(slugifyKey(nameForKey) || "field", existingKeys);
  const keyFormatInvalid = trimmedKey !== "" && !FIELD_KEY_RE.test(trimmedKey);
  const manualKeyTaken = trimmedKey !== "" && existingKeys.has(trimmedKey);
  const effectiveKey = trimmedKey || generatedKey;

  const formatFieldType: FieldType = fieldType;

  // A page formula can reference the mirrored entity's fields (passed in) plus
  // this page's other non-formula local fields — all merged at read time. Values
  // merge as {...source, ...page}, so a page-local field shadows a same-key source
  // field; list page fields first and de-duplicate by key to match that precedence
  // (and to avoid duplicate React keys among the chips).
  const formulaFields: FormulaFieldRef[] = (() => {
    const pageRefs = existingFields
      .filter((f: PageField) => f.id !== field?.id && f.fieldType !== "function")
      .map((f: PageField) => ({ key: f.fieldKey, label: ml(f.nameJson) || f.fieldKey }));
    const seen = new Set(pageRefs.map((r) => r.key));
    return [...pageRefs, ...sourceFields.filter((r) => !seen.has(r.key))];
  })();

  const selectedRelation = relationOptions.find((o) => o.relationId === relationId);
  // Pages of the related entity whose page-local fields a relation/lookup can project.
  const relatedPages = selectedRelation?.pages ?? [];
  const selectedPage = relatedPages.find((p) => p.pageId === relatedPageId);
  const relatedFieldOptions =
    relatedPageId != null ? selectedPage?.fields ?? [] : selectedRelation?.fields ?? [];

  const setRoleAccess = (roleId: number, access: FieldAccess | "inherit") => {
    setPermissions((prev) => {
      const next = { ...prev };
      if (access === "inherit") delete next[String(roleId)];
      else next[String(roleId)] = access;
      return next;
    });
  };

  const handleSubmit = () => {
    const payload = {
      fieldKey: effectiveKey,
      nameJson: nameJson as MultilingualText,
      descriptionJson: descJson as MultilingualText,
      fieldType,
      isRequired,
      isFilterable: PAGE_FILTERABLE_TYPES.has(fieldType) ? isFilterable : false,
      defaultValue: defaultValue.trim() ? defaultValue.trim() : null,
      optionsJson: options,
      sortOrder,
      isActive,
      showInTable,
      isPinned,
      showColumnTotal: fieldType === "number" || fieldType === "function" ? showColumnTotal : false,
      totalFillColor: (fieldType === "number" || fieldType === "function") && showColumnTotal && totalFillColor ? totalFillColor : null,
      totalTextColor: (fieldType === "number" || fieldType === "function") && showColumnTotal && totalTextColor ? totalTextColor : null,
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
      relationConfigJson:
        fieldType === "lookup"
          ? { relationId, relatedFieldKey: relatedFieldKey || null, relatedPageId }
          : fieldType === "relation"
            ? relatedPageId != null
              ? // Page-source relation fields project a page-local field (read-only
                // display) while the link itself stays assignable.
                { relationId, relatedFieldKey: relatedFieldKey || null, relatedPageId }
              : { relationId, relatedFieldKey: relatedFieldKey || null }
            : {},
      permissionsJson: fieldType === "relation" || fieldType === "lookup" ? permissions : {},
    };
    if (field) updateMutation.mutate({ id: field.id, data: payload });
    else createMutation.mutate({ pageId, data: payload });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const relationIncomplete =
    (fieldType === "relation" || fieldType === "lookup") && (relationId == null || !relatedFieldKey);
  const hasName = Object.values(nameJson).some((v) => typeof v === "string" && v.trim() !== "");
  const canSubmit =
    !isPending && hasName && FIELD_KEY_RE.test(effectiveKey) && !manualKeyTaken && !keyFormatInvalid && !relationIncomplete;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{field ? t("pageFields.editTitle", "Редактировать поле страницы") : t("pageFields.newTitle", "Новое поле страницы")}</DialogTitle>
            <DialogDescription>
              {t("pageFields.dialogDesc", "Поле страницы — это дополнительный столбец, который хранится на этой странице и не изменяет исходную сущность.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label={t("fields.name", "Название")} value={nameJson} onChange={setNameJson} required />
            <MultilingualInput label={t("fields.description", "Описание")} value={descJson} onChange={setDescJson} multiline />
            <div className="space-y-1.5">
              <Label>{t("fields.systemKey", "Системный ключ")}</Label>
              <Input value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} placeholder="title" className="font-mono" />
              {manualKeyTaken ? (
                <p className="text-xs text-red-500">{t("pageFields.keyTaken", "Такой ключ уже используется на этой странице.")}</p>
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
              <SelectOptionsEditor value={options} onChange={setOptions} t={t} />
            )}
            {fieldType === "function" && (
              <div className="space-y-3">
                <FormulaEditor value={formula} onChange={setFormula} fields={formulaFields} />
                <div className="space-y-1.5">
                  <Label htmlFor="pfcd-formula-decimals">
                    {t("fields.formulaDecimals", "Знаков после запятой (округление)")}
                  </Label>
                  <Input
                    id="pfcd-formula-decimals"
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
            {(fieldType === "relation" || fieldType === "lookup") && (
              <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3 space-y-3">
                <p className="text-xs text-slate-500">
                  {fieldType === "lookup"
                    ? t(
                        "pageFields.lookupHint",
                        "Поле подстановки показывает значение из единственной связанной записи (только для чтения). Источником может быть поле связанной сущности или поле страницы связанной записи.",
                      )
                    : t(
                        "pageFields.relationHint",
                        "Связанное поле показывает значение из единственной связанной записи. Доступны связи «один к одному» и «многие к одному» (а также обратная сторона «один ко многим»).",
                      )}
                </p>
                <div className="space-y-1.5">
                  <Label>{t("pageFields.relation", "Связь")}</Label>
                  <Select
                    value={relationId != null ? String(relationId) : ""}
                    onValueChange={(v) => {
                      setRelationId(Number(v));
                      setRelatedFieldKey("");
                      setRelatedPageId(null);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder={t("pageFields.relationPlaceholder", "Выберите связь")} /></SelectTrigger>
                    <SelectContent>
                      {relationOptions.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-slate-400">
                          {t("pageFields.noRelations", "Нет подходящих связей для этой сущности.")}
                        </div>
                      ) : (
                        relationOptions.map((o) => (
                          <SelectItem key={o.relationId} value={String(o.relationId)}>
                            {ml(o.label)} → {ml(o.relatedEntityLabel)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {relationId != null && relatedPages.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>{t("fields.lookupSource", "Источник значения")}</Label>
                    <Select
                      value={relatedPageId != null ? String(relatedPageId) : "__entity__"}
                      onValueChange={(v) => {
                        setRelatedPageId(v === "__entity__" ? null : Number(v));
                        setRelatedFieldKey("");
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__entity__">
                          {t("fields.lookupSourceEntity", "Поля связанной сущности")}
                        </SelectItem>
                        {relatedPages.map((p) => (
                          <SelectItem key={p.pageId} value={String(p.pageId)}>
                            {t("fields.lookupSourcePagePrefix", "Страница")}: {ml(p.pageLabel)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {relationId != null && (
                  <div className="space-y-1.5">
                    <Label>
                      {relatedPageId != null
                        ? t("fields.relatedPageField", "Поле страницы")
                        : t("pageFields.relatedField", "Поле связанной сущности")}
                    </Label>
                    <Select value={relatedFieldKey} onValueChange={setRelatedFieldKey}>
                      <SelectTrigger><SelectValue placeholder={t("pageFields.relatedFieldPlaceholder", "Выберите поле")} /></SelectTrigger>
                      <SelectContent>
                        {relatedFieldOptions.map((f) => (
                          <SelectItem key={f.key} value={f.key}>{ml(f.label) || f.key}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
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
                <Switch checked={isRequired} onCheckedChange={setIsRequired} id="pfcd-required" />
                <Label htmlFor="pfcd-required">{t("fields.required", "Обязательное")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} id="pfcd-active" />
                <Label htmlFor="pfcd-active">{t("fields.active", "Активно")}</Label>
              </div>
              {PAGE_FILTERABLE_TYPES.has(fieldType) && (
                <div className="flex items-center gap-2">
                  <Switch checked={isFilterable} onCheckedChange={setIsFilterable} id="pfcd-filterable" />
                  <Label htmlFor="pfcd-filterable">{t("fields.filterable", "Участвует в фильтре")}</Label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Switch checked={showInTable} onCheckedChange={setShowInTable} id="pfcd-show-in-table" />
                <Label htmlFor="pfcd-show-in-table">{t("fields.showInTable", "Показывать в таблице")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isPinned} onCheckedChange={setIsPinned} id="pfcd-pinned" />
                <Label htmlFor="pfcd-pinned">{t("fields.pinColumn", "Закрепить при горизонтальной прокрутке")}</Label>
              </div>
              {(fieldType === "number" || fieldType === "function") && (
                <div className="flex items-center gap-2">
                  <Switch checked={showColumnTotal} onCheckedChange={setShowColumnTotal} id="pfcd-show-column-total" />
                  <Label htmlFor="pfcd-show-column-total">{t("fields.showColumnTotal", "Показывать сумму столбца")}</Label>
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

            {(fieldType === "relation" || fieldType === "lookup") && (
              <div className="border-t border-slate-100 pt-4 space-y-2">
                <Label>{t("fields.accessByRoles", "Доступ к полю по ролям")}</Label>
                <p className="text-xs text-slate-400">
                  {t(
                    "pageFields.relationAccessHint",
                    "«По умолчанию» — столбец наследует права роли на связанное поле. Доступ ограничивается правами роли на связанную сущность.",
                  )}
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
            )}

            <div className="border-t border-slate-100 pt-4">
              <FieldFormatRulesEditor
                fieldType={formatFieldType}
                options={options}
                users={userOptions}
                rules={formatRules}
                onChange={setFormatRules}
              />
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
