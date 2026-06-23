import type { FieldValidationRule, ValidationOperator, FieldType } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useT } from "@/lib/i18n";
import { Plus, Trash2 } from "lucide-react";

export interface OtherField {
  fieldKey: string;
  name: string;
  fieldType: FieldType;
  options: string[];
}

const ALL_OPERATORS: { value: ValidationOperator; label: string }[] = [
  { value: "notEmpty", label: "заполнено" },
  { value: "empty", label: "пусто" },
  { value: "equals", label: "равно" },
  { value: "notEquals", label: "не равно" },
  { value: "gt", label: "больше" },
  { value: "lt", label: "меньше" },
  { value: "gte", label: "больше или равно" },
  { value: "lte", label: "меньше или равно" },
  { value: "between", label: "в диапазоне" },
];

function operatorsForType(fieldType: FieldType | undefined): ValidationOperator[] {
  if (fieldType === "number" || fieldType === "date" || fieldType === "datetime") {
    return ["notEmpty", "empty", "equals", "notEquals", "gt", "lt", "gte", "lte", "between"];
  }
  if (fieldType === "boolean") return ["equals", "notEmpty", "empty"];
  // select / user / text-like
  return ["notEmpty", "empty", "equals", "notEquals"];
}

function needsValue(op: ValidationOperator): boolean {
  return op !== "empty" && op !== "notEmpty";
}

/**
 * Editor for a field's cross-field VALIDATION ("fill") rules — a hard constraint
 * on saving, distinct from the cosmetic conditional formatting editor. A rule
 * says: this field's value (any, or one of `applyToValues` for select fields) is
 * allowed only if another field satisfies the chosen condition; otherwise the
 * record save is blocked with an auto-generated message (previewed live here).
 */
export function FieldValidationRulesEditor({
  selfType,
  selfName,
  selfOptions,
  otherFields,
  users = [],
  rules,
  onChange,
}: {
  selfType: FieldType;
  selfName: string;
  selfOptions: string[];
  otherFields: OtherField[];
  users?: { id: number; name: string }[];
  rules: FieldValidationRule[];
  onChange: (rules: FieldValidationRule[]) => void;
}) {
  const t = useT();
  const isSelectSelf = selfType === "select" && selfOptions.length > 0;

  const update = (idx: number, patch: Partial<FieldValidationRule>) => {
    onChange(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const remove = (idx: number) => onChange(rules.filter((_, i) => i !== idx));
  const add = () => {
    const first = otherFields[0];
    onChange([
      ...rules,
      {
        conditionFieldKey: first?.fieldKey ?? "",
        operator: "notEmpty",
        applyToValues: [],
        value: "",
      },
    ]);
  };

  const condFieldFor = (rule: FieldValidationRule): OtherField | undefined =>
    otherFields.find((f) => f.fieldKey === rule.conditionFieldKey);

  const userName = (id: string): string =>
    users.find((u) => String(u.id) === id)?.name ?? id;

  // Live preview of the auto-generated block message (mirrors the server text).
  const previewMessage = (rule: FieldValidationRule): string => {
    const cf = condFieldFor(rule);
    const name = cf?.name ?? rule.conditionFieldKey;
    const v =
      cf?.fieldType === "user" ? userName(rule.value ?? "") : rule.value ?? "";
    let cond: string;
    switch (rule.operator) {
      case "empty": cond = `поле «${name}» должно быть пустым`; break;
      case "notEmpty": cond = `поле «${name}» должно быть заполнено`; break;
      case "equals": cond = `поле «${name}» должно быть равно «${v}»`; break;
      case "notEquals": cond = `поле «${name}» не должно быть равно «${v}»`; break;
      case "gt": cond = `поле «${name}» должно быть больше «${v}»`; break;
      case "lt": cond = `поле «${name}» должно быть меньше «${v}»`; break;
      case "gte": cond = `поле «${name}» должно быть не меньше «${v}»`; break;
      case "lte": cond = `поле «${name}» должно быть не больше «${v}»`; break;
      case "between": cond = `поле «${name}» должно быть в диапазоне от «${v}» до «${rule.value2 ?? ""}»`; break;
      default: cond = `поле «${name}» должно удовлетворять условию`;
    }
    // Mirror the server message: it always renders the field's ACTUAL saved
    // value ("со значением «X»"). At config time we don't know that value, so we
    // illustrate with the chosen applyToValues (select self) or a placeholder.
    const sample =
      isSelectSelf && rule.applyToValues && rule.applyToValues.length > 0
        ? rule.applyToValues.join("», «")
        : "…";
    return `Нельзя сохранить поле «${selfName}» со значением «${sample}»: ${cond}.`;
  };

  const renderValueInput = (rule: FieldValidationRule, idx: number) => {
    if (!needsValue(rule.operator)) return null;
    const cf = condFieldFor(rule);
    const cfType = cf?.fieldType;
    if (cfType === "boolean") {
      return (
        <Select value={rule.value || "true"} onValueChange={(v) => update(idx, { value: v })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="true">{t("fields.true", "Да")}</SelectItem>
            <SelectItem value="false">{t("fields.false", "Нет")}</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    if (cfType === "select" && cf && cf.options.length > 0) {
      return (
        <Select value={rule.value || cf.options[0]} onValueChange={(v) => update(idx, { value: v })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {cf.options.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (cfType === "user") {
      return (
        <Select value={rule.value || ""} onValueChange={(v) => update(idx, { value: v })}>
          <SelectTrigger className="h-8">
            <SelectValue placeholder={t("records.selectUser", "Выберите пользователя")} />
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    const inputType =
      cfType === "number" ? "number" : cfType === "date" ? "date" : cfType === "datetime" ? "datetime-local" : "text";
    if (rule.operator === "between") {
      return (
        <div className="flex items-center gap-1">
          <Input
            className="h-8"
            type={inputType}
            value={rule.value ?? ""}
            onChange={(e) => update(idx, { value: e.target.value })}
            placeholder={t("fields.valFrom", "от")}
          />
          <span className="text-xs text-slate-400">—</span>
          <Input
            className="h-8"
            type={inputType}
            value={rule.value2 ?? ""}
            onChange={(e) => update(idx, { value2: e.target.value })}
            placeholder={t("fields.valTo", "до")}
          />
        </div>
      );
    }
    return (
      <Input
        className="h-8"
        type={inputType}
        value={rule.value ?? ""}
        onChange={(e) => update(idx, { value: e.target.value })}
        placeholder={t("fields.formatValue", "значение")}
      />
    );
  };

  return (
    <div className="space-y-2">
      <Label>{t("fields.validationRules", "Правила заполнения")}</Label>
      <p className="text-xs text-slate-400">
        {t(
          "fields.validationRulesHint",
          "Запрет на сохранение этого поля, пока другое поле не удовлетворяет условию. Текст ошибки формируется автоматически.",
        )}
      </p>
      {otherFields.length === 0 ? (
        <p className="text-xs text-slate-400">
          {t("fields.validationNoOther", "Сначала добавьте другие поля в эту сущность.")}
        </p>
      ) : (
        <div className="space-y-2 pt-1">
          {rules.map((rule, idx) => (
            <div key={idx} className="rounded-md border border-slate-200 p-2 space-y-2">
              {isSelectSelf && (
                <div className="space-y-1">
                  <p className="text-xs text-slate-500">
                    {t("fields.validationApplyTo", "Применять только к значениям (пусто = к любому):")}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {selfOptions.map((o) => {
                      const checked = (rule.applyToValues ?? []).includes(o);
                      return (
                        <label key={o} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => {
                              const cur = rule.applyToValues ?? [];
                              update(idx, {
                                applyToValues: c ? [...cur, o] : cur.filter((x) => x !== o),
                              });
                            }}
                          />
                          {o}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                <Select
                  value={rule.conditionFieldKey}
                  onValueChange={(v) => update(idx, { conditionFieldKey: v })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder={t("fields.validationCondField", "Поле-условие")} />
                  </SelectTrigger>
                  <SelectContent>
                    {otherFields.map((f) => (
                      <SelectItem key={f.fieldKey} value={f.fieldKey}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-red-500 hover:text-red-600 hover:bg-red-50"
                  onClick={() => remove(idx)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={rule.operator}
                  onValueChange={(v) => update(idx, { operator: v as ValidationOperator })}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {operatorsForType(condFieldFor(rule)?.fieldType).map((op) => {
                      const meta = ALL_OPERATORS.find((o) => o.value === op)!;
                      return (
                        <SelectItem key={op} value={op}>
                          {t(`fields.vop.${op}`, meta.label)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {needsValue(rule.operator) ? renderValueInput(rule, idx) : <div />}
              </div>
              <p className="text-xs text-slate-500 italic border-t border-slate-100 pt-1.5">
                {previewMessage(rule)}
              </p>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add}>
            <Plus className="w-3.5 h-3.5" />
            {t("fields.addValidationRule", "Добавить правило")}
          </Button>
        </div>
      )}
    </div>
  );
}
