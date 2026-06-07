import type { ChangeEvent, FocusEvent } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n";
import { Plus, Trash2 } from "lucide-react";
import { HexColorPicker } from "react-colorful";

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
 * Normalize a user-typed color into either "" (no color) or an uppercase
 * #RRGGBB hex. Accepts shorthand #RGB and tolerates a missing leading "#".
 * Returns null for values that are not (yet) valid hex so callers can keep the
 * raw in-progress text instead of persisting malformed CSS.
 */
function normalizeHexColor(raw: string): string | null {
  const v = raw.trim();
  if (v === "") return "";
  const body = (v.startsWith("#") ? v.slice(1) : v).toLowerCase();
  if (/^[0-9a-f]{3}$/.test(body)) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`.toUpperCase();
  }
  if (/^[0-9a-f]{6}$/.test(body)) {
    return `#${body}`.toUpperCase();
  }
  return null;
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

  const renderColorControl = (label: string, value: string, onColorChange: (v: string) => void) => {
    const valid = /^#[0-9a-fA-F]{6}$/.test(value);
    const swatch = valid ? value : "#ffffff";
    // Allow free typing (so partial hex like "#1" is not rejected mid-edit), but
    // snap to a normalized #RRGGBB on blur when the text forms a valid color.
    const onTextChange = (e: ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value.trim();
      onColorChange(v === "" ? "" : v.startsWith("#") ? v : `#${v}`);
    };
    const onTextBlur = (e: FocusEvent<HTMLInputElement>) => {
      const normalized = normalizeHexColor(e.target.value);
      if (normalized !== null && normalized !== value) onColorChange(normalized);
    };
    const checkerboard =
      "linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%),linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%)";
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500">{label}</span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="h-7 w-9 rounded border border-slate-200 cursor-pointer shrink-0"
              style={{ backgroundColor: swatch, backgroundImage: valid ? undefined : checkerboard, backgroundSize: "8px 8px", backgroundPosition: "0 0,4px 4px" }}
              aria-label={t("fields.pickColor", "Выбрать цвет")}
              title={t("fields.pickColor", "Выбрать цвет")}
            />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="start">
            <div className="format-color-picker">
              <HexColorPicker color={swatch} onChange={onColorChange} />
            </div>
            <Input
              className="h-7 w-[200px] mt-3 font-mono text-xs"
              value={value}
              onChange={onTextChange}
              onBlur={onTextBlur}
              placeholder="#RRGGBB"
              spellCheck={false}
            />
          </PopoverContent>
        </Popover>
        <Input
          className="h-7 w-24 font-mono text-xs"
          value={value}
          onChange={onTextChange}
          onBlur={onTextBlur}
          placeholder="#RRGGBB"
          spellCheck={false}
        />
        {value ? (
          <button
            type="button"
            className="text-xs text-slate-400 hover:text-slate-600"
            aria-label={t("fields.clearColor", "Очистить цвет")}
            title={t("fields.clearColor", "Очистить цвет")}
            onClick={() => onColorChange("")}
          >
            ✕
          </button>
        ) : null}
      </div>
    );
  };

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
