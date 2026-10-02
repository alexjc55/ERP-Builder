import type { TextDirection } from "@workspace/api-client-react";
import { useT } from "@/lib/i18n";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type TextDirectionOverride = TextDirection | null;

/** Configuration only: null clears the override and restores inheritance. */
export function TextDirectionSelect({
  value,
  onChange,
  id,
}: {
  value: TextDirectionOverride;
  onChange: (value: TextDirectionOverride) => void;
  id: string;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("textDirection.label", "Направление текста")}</Label>
      <Select value={value ?? "inherit"} onValueChange={(next) => onChange(next === "ltr" || next === "rtl" ? next : null)}>
        <SelectTrigger id={id} data-testid={`select-${id}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit" data-testid={`${id}-inherit`}>{t("textDirection.inherit", "Наследовать / по умолчанию")}</SelectItem>
          <SelectItem value="ltr" data-testid={`${id}-ltr`}>{t("textDirection.ltr", "Слева направо (LTR)")}</SelectItem>
          <SelectItem value="rtl" data-testid={`${id}-rtl`}>{t("textDirection.rtl", "Справа налево (RTL)")}</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-slate-500" data-testid={`text-${id}-hint`}>
        {t("textDirection.priority", "Приоритет: поле → страница → приложение → язык. Наследовать снимает переопределение. Статусы не затрагиваются.")}
      </p>
    </div>
  );
}