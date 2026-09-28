import type { FormulaFieldConfig } from "@workspace/api-client-react";
import { useId } from "react";
import { useI18n } from "@/lib/i18n";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type FormulaTotalMode = NonNullable<FormulaFieldConfig["totalMode"]>;

const labels = {
  ru: { title: "Как считать итог", sum: "Сумма результатов строк", average: "Среднее результатов строк", formula: "Формула по итогам колонок", hint: "По всем записям с учётом фильтров. Формула по итогам: сначала суммируются исходные значения, затем вычисляется формула." },
  en: { title: "Column total calculation", sum: "Sum of row results", average: "Average of row results", formula: "Formula over column totals", hint: "Uses all filtered records. Formula over totals: sum source values first, then evaluate the formula." },
  he: { title: "חישוב סיכום העמודה", sum: "סכום תוצאות השורות", average: "ממוצע תוצאות השורות", formula: "נוסחה על סיכומי העמודות", hint: "לפי כל הרשומות המסוננות. נוסחה על סיכומים: תחילה מסכמים את ערכי המקור ואז מחשבים את הנוסחה." },
};

export function FormulaTotalModeSelect({ value, onChange }: {
  value: FormulaTotalMode; onChange: (value: FormulaTotalMode) => void;
}) {
  const { lang, t } = useI18n();
  const id = useId();
  const text = labels[lang];
  return <div className="space-y-2">
    <Label htmlFor={id}>{t("fields.formulaTotalMode", text.title)}</Label>
    <Select value={value} onValueChange={v => onChange(v as FormulaTotalMode)}>
      <SelectTrigger id={id}><SelectValue /></SelectTrigger>
      <SelectContent>
        {(["sum", "average", "formula"] as const).map(mode =>
          <SelectItem key={mode} value={mode}>{t(`fields.formulaTotalMode.${mode}`, text[mode])}</SelectItem>)}
      </SelectContent>
    </Select>
    <p className="text-xs text-muted-foreground">{t("fields.formulaTotalMode.hint", text.hint)}</p>
  </div>;
}