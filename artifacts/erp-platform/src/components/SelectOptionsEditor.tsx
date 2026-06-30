import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MultilingualInput } from "@/components/MultilingualInput";
import type { SelectOption } from "@/lib/selectOptions";

type MLValue = { ru?: string; en?: string; he?: string };

interface SelectOptionsEditorProps {
  value: SelectOption[];
  onChange: (next: SelectOption[]) => void;
  t: (key: string, fallback: string) => string;
}

// Editor for select-field options. Each option carries a stable `value` (the key
// stored on records, never recomputed from the label) and a multilingual label.
// Existing options keep their value untouched; new rows are sent with an empty
// value and the server derives a stable value from the label on save.
export function SelectOptionsEditor({ value, onChange, t }: SelectOptionsEditorProps) {
  const updateLabel = (index: number, labelJson: MLValue) => {
    const next = value.slice();
    next[index] = { ...next[index]!, labelJson };
    onChange(next);
  };
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  const add = () => onChange([...value, { value: "", labelJson: {} }]);

  return (
    <div className="space-y-1.5">
      <Label>{t("fields.options", "Варианты списка")}</Label>
      <p className="text-xs text-slate-400">
        {t(
          "fields.optionsMlHint",
          "Каждый вариант можно задать на нескольких языках. Значение в записях не меняется при переименовании.",
        )}
      </p>
      <div className="space-y-2">
        {value.map((opt, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md border border-slate-200 p-2">
            <div className="flex-1 min-w-0">
              <MultilingualInput
                label={`${t("fields.optionLabel", "Вариант")} ${i + 1}`}
                value={(opt.labelJson ?? {}) as MLValue}
                onChange={(lj) => updateLabel(i, lj)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-7 shrink-0 text-slate-400 hover:text-red-600"
              onClick={() => remove(i)}
              aria-label={t("common.delete", "Удалить")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {value.length === 0 && (
          <p className="text-xs text-slate-400">{t("fields.noOptionsYet", "Вариантов пока нет.")}</p>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={add} className="mt-1">
        <Plus className="h-4 w-4 mr-1" />
        {t("fields.addOption", "Добавить вариант")}
      </Button>
    </div>
  );
}
