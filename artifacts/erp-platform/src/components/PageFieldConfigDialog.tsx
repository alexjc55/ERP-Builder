import { useEffect, useState } from "react";
import {
  useCreatePageField,
  useUpdatePageField,
  useDeletePageField,
  useListPageFields,
  type PageField,
  type FieldType,
  type MultilingualText,
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
import { ColorPickerControl } from "@/components/ColorPickerControl";
import { FormulaEditor, type FormulaFieldRef } from "@/components/FormulaEditor";
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
];

function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object" && "response" in err) {
    const resp = (err as { response?: { data?: { error?: string } } }).response;
    return resp?.data?.error;
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
  field,
  nextSortOrder,
  sourceFields = [],
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: number;
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

  const [fieldKey, setFieldKey] = useState("");
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [descJson, setDescJson] = useState<MLValue>({});
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [isRequired, setIsRequired] = useState(false);
  const [defaultValue, setDefaultValue] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [showInTable, setShowInTable] = useState(true);
  const [showColumnTotal, setShowColumnTotal] = useState(false);
  const [totalFillColor, setTotalFillColor] = useState("");
  const [totalTextColor, setTotalTextColor] = useState("");
  const [formatRules, setFormatRules] = useState<FieldFormatRule[]>([]);
  const [formula, setFormula] = useState("");
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
      setDefaultValue(field.defaultValue ?? "");
      setOptionsText((field.optionsJson ?? []).join("\n"));
      setSortOrder(field.sortOrder);
      setIsActive(field.isActive);
      setShowInTable(field.showInTable ?? true);
      setShowColumnTotal(field.showColumnTotal ?? false);
      setTotalFillColor(field.totalFillColor ?? "");
      setTotalTextColor(field.totalTextColor ?? "");
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
      setShowInTable(true);
      setShowColumnTotal(false);
      setTotalFillColor("");
      setTotalTextColor("");
      setFormatRules([]);
      setFormula("");
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
      sortOrder,
      isActive,
      showInTable,
      showColumnTotal: fieldType === "number" ? showColumnTotal : false,
      totalFillColor: fieldType === "number" && showColumnTotal && totalFillColor ? totalFillColor : null,
      totalTextColor: fieldType === "number" && showColumnTotal && totalTextColor ? totalTextColor : null,
      formatRulesJson: formatRules,
      formulaConfigJson: fieldType === "function" ? { expression: formula.trim() } : {},
    };
    if (field) updateMutation.mutate({ id: field.id, data: payload });
    else createMutation.mutate({ pageId, data: payload });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const canSubmit = !isPending && FIELD_KEY_RE.test(effectiveKey) && !manualKeyTaken && !keyFormatInvalid;

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
                <Switch checked={isRequired} onCheckedChange={setIsRequired} id="pfcd-required" />
                <Label htmlFor="pfcd-required">{t("fields.required", "Обязательное")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} id="pfcd-active" />
                <Label htmlFor="pfcd-active">{t("fields.active", "Активно")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={showInTable} onCheckedChange={setShowInTable} id="pfcd-show-in-table" />
                <Label htmlFor="pfcd-show-in-table">{t("fields.showInTable", "Показывать в таблице")}</Label>
              </div>
              {fieldType === "number" && (
                <div className="flex items-center gap-2">
                  <Switch checked={showColumnTotal} onCheckedChange={setShowColumnTotal} id="pfcd-show-column-total" />
                  <Label htmlFor="pfcd-show-column-total">{t("fields.showColumnTotal", "Показывать сумму столбца")}</Label>
                </div>
              )}
            </div>

            {fieldType === "number" && showColumnTotal && (
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
                fieldType={formatFieldType}
                options={optionsText.split("\n").map((o) => o.trim()).filter(Boolean)}
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
