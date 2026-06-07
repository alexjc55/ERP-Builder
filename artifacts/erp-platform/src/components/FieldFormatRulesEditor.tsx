import type { FieldFormatRule, FormatOperator, FieldType } from "@workspace/api-client-react";
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
import { useT } from "@/lib/i18n";
import { Plus, Trash2 } from "lucide-react";

const OPERATORS: { value: FormatOperator; label: string; needsValue: boolean }[] = [
  { value: "equals", label: "равно", needsValue: true },
  { value: "notEquals", label: "не равно", needsValue: true },
  { value: "contains", label: "содержит", needsValue: true },
  { value: "notContains", label: "не содержит", needsValue: true },
  { value: "empty", label: "пусто", needsValue: false },
  { value: "notEmpty", label: "не пусто", needsValue: false },
  { value: "gt", label: "больше", needsValue: true },
  { value: "lt", label: "меньше", needsValue: true },
  { value: "gte", label: "больше или равно", needsValue: true },
  { value: "lte", label: "меньше или равно", needsValue: true },
];

function operatorsForType(fieldType: FieldType): { value: FormatOperator; label: string; needsValue: boolean }[] {
  if (fieldType === "number") {
    return OPERATORS.filter((o) => ["equals", "notEquals", "gt", "lt", "gte", "lte", "empty", "notEmpty"].includes(o.value));
  }
  if (fieldType === "boolean") {
    return OPERATORS.filter((o) => ["equals"].includes(o.value));
  }
  if (fieldType === "select") {
    return OPERATORS.filter((o) => ["equals", "notEquals", "empty", "notEmpty"].includes(o.value));
  }
  return OPERATORS.filter((o) =>
    ["equals", "notEquals", "contains", "notContains", "empty", "notEmpty"].includes(o.value),
  );
}

function needsValue(op: FormatOperator): boolean {
  return OPERATORS.find((o) => o.value === op)?.needsValue ?? true;
}

/**
 * Reusable editor for a field's conditional-formatting rules. Shared by the
 * entity field dialog and the page-local field dialog. The value input adapts to
 * the field type (select → option dropdown, boolean → да/нет, otherwise text).
 */
export function FieldFormatRulesEditor({
  fieldType,
  options,
  rules,
  onChange,
}: {
  fieldType: FieldType;
  options: string[];
  rules: FieldFormatRule[];
  onChange: (rules: FieldFormatRule[]) => void;
}) {
  const t = useT();
  const ops = operatorsForType(fieldType);

  const update = (idx: number, patch: Partial<FieldFormatRule>) => {
    onChange(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const remove = (idx: number) => onChange(rules.filter((_, i) => i !== idx));
  const add = () => {
    const op = ops[0]?.value ?? "equals";
    onChange([...rules, { operator: op, value: "", cellColor: "#fee2e2", rowColor: "" }]);
  };

  const renderColorControl = (label: string, value: string, onColorChange: (v: string) => void) => (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="color"
        className="h-7 w-9 rounded border border-slate-200 bg-white p-0.5 cursor-pointer"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff"}
        onChange={(e) => onColorChange(e.target.value)}
      />
      <Input
        className="h-7 w-24 font-mono text-xs"
        value={value}
        onChange={(e) => {
          const v = e.target.value.trim();
          onColorChange(v === "" ? "" : v.startsWith("#") ? v : `#${v}`);
        }}
        placeholder="#RRGGBB"
        spellCheck={false}
      />
      {value ? (
        <button type="button" className="text-xs text-slate-400 hover:text-slate-600" onClick={() => onColorChange("")}>
          ✕
        </button>
      ) : null}
    </div>
  );

  const renderValueInput = (rule: FieldFormatRule, idx: number) => {
    if (!needsValue(rule.operator)) return <div className="text-xs text-slate-400 self-center">—</div>;
    if (fieldType === "boolean") {
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
    if (fieldType === "select" && options.length > 0) {
      return (
        <Select value={rule.value || options[0]} onValueChange={(v) => update(idx, { value: v })}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        className="h-8"
        type={fieldType === "number" ? "number" : "text"}
        value={rule.value ?? ""}
        onChange={(e) => update(idx, { value: e.target.value })}
        placeholder={t("fields.formatValue", "значение")}
      />
    );
  };

  return (
    <div className="space-y-2">
      <Label>{t("fields.formatRules", "Условное форматирование")}</Label>
      <p className="text-xs text-slate-400">
        {t("fields.formatRulesHint", "Подсветка ячейки или строки, когда значение соответствует условию. Срабатывает первое подходящее правило.")}
      </p>
      <div className="space-y-2 pt-1">
        {rules.map((rule, idx) => (
          <div key={idx} className="rounded-md border border-slate-200 p-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select value={rule.operator} onValueChange={(v) => update(idx, { operator: v as FormatOperator })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ops.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{t(`fields.op.${o.value}`, o.label)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {renderValueInput(rule, idx)}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {renderColorControl(t("fields.cellColor", "Ячейка"), rule.cellColor ?? "", (v) => update(idx, { cellColor: v }))}
              {renderColorControl(t("fields.rowColor", "Строка"), rule.rowColor ?? "", (v) => update(idx, { rowColor: v }))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={() => remove(idx)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add}>
          <Plus className="w-3.5 h-3.5" />
          {t("fields.addFormatRule", "Добавить правило")}
        </Button>
      </div>
    </div>
  );
}
