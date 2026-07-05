import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { SelectOption } from "@/lib/selectOptions";

interface PercentOptionsEditorProps {
  value: SelectOption[];
  onChange: (next: SelectOption[]) => void;
  t: (key: string, fallback: string) => string;
}

// Editor for a percent field's list-mode options. Each option is a NUMBER: the
// stored `value` is the numeric string (so it stays a real number for formulas
// and averaging) and the label is auto-derived as `${n}%`. Kept separate from
// SelectOptionsEditor because that editor derives values from free-text labels,
// which would corrupt the numeric contract the server enforces for percent.
export function PercentOptionsEditor({ value, onChange, t }: PercentOptionsEditorProps) {
  const setAt = (index: number, raw: string) => {
    const clean = raw.replace(",", ".").trim();
    const next = value.slice();
    next[index] = { value: clean, labelJson: { ru: clean === "" ? "" : `${clean}%` } };
    onChange(next);
  };
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  const add = () => onChange([...value, { value: "", labelJson: {} }]);

  return (
    <div className="space-y-2">
      <Label>{t("fields.percentOptions", "Варианты (числа)")}</Label>
      <p className="text-xs text-slate-400">
        {t("fields.percentOptionsHint", "Каждый вариант — число (например 25 или 12.5). В списке показывается как «25%».")}
      </p>
      <div className="space-y-2">
        {value.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              type="text"
              inputMode="decimal"
              value={opt.value}
              onChange={(e) => setAt(i, e.target.value)}
              placeholder="0"
              className="w-40"
            />
            <span className="text-sm text-slate-400">%</span>
            <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)}>
              <Trash2 className="w-4 h-4 text-slate-400" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="w-4 h-4 mr-1" />
        {t("fields.percentOptionAdd", "Добавить вариант")}
      </Button>
    </div>
  );
}
