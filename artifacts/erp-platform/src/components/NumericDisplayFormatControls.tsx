import { AffixedNumericValue } from "@/components/AffixedNumericValue";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function NumericDisplayFormatControls({
  idPrefix,
  decimals,
  onDecimalsChange,
  decimalsHint,
  displayAffix,
  onDisplayAffixChange,
  displayAffixPosition,
  onDisplayAffixPositionChange,
  t,
}: {
  idPrefix: string;
  decimals: string;
  onDecimalsChange: (value: string) => void;
  decimalsHint: string;
  displayAffix: string;
  onDisplayAffixChange: (value: string) => void;
  displayAffixPosition: "before" | "after";
  onDisplayAffixPositionChange: (value: "before" | "after") => void;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-slate-800">
          {t("fields.numericDisplay", "Формат отображения")}
        </h4>
        <p className="text-xs leading-5 text-slate-500">
          {t(
            "fields.numericDisplayHint",
            "Эти настройки меняют только внешний вид числа. Хранимое значение и расчёты не изменяются.",
          )}
        </p>
      </div>

      <div className="max-w-sm space-y-1.5">
        <Label htmlFor={`${idPrefix}-decimals`}>
          {t("fields.formulaDecimals", "Знаков после запятой (округление)")}
        </Label>
        <Input
          id={`${idPrefix}-decimals`}
          type="number"
          min={0}
          max={10}
          value={decimals}
          onChange={(event) => onDecimalsChange(event.target.value)}
          placeholder={t("fields.formulaDecimalsNone", "Без округления")}
        />
        <p className="text-xs leading-5 text-muted-foreground">{decimalsHint}</p>
      </div>

      <div className="space-y-3 border-t border-slate-200 pt-4">
        <div className="space-y-1">
          <h5 className="text-sm font-medium text-slate-800">
            {t("fields.displayAffixSection", "Текст рядом со значением")}
          </h5>
          <p className="text-xs leading-5 text-slate-500">
            {t(
              "fields.displayAffixHint",
              "Добавьте знак или единицу измерения. Например: 15,23 % или $ 15,23.",
            )}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`${idPrefix}-affix`}>
              {t("fields.displayAffix", "Текст или знак")}
            </Label>
            <Input
              id={`${idPrefix}-affix`}
              value={displayAffix}
              onChange={(event) => onDisplayAffixChange(event.target.value)}
              placeholder={t("fields.displayAffixPlaceholder", "Например: %, кг, шт.")}
              maxLength={100}
            />
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`${idPrefix}-affix-position`}>
              {t("fields.displayAffixPosition", "Где показывать")}
            </Label>
            <Select
              value={displayAffixPosition}
              onValueChange={(value) =>
                onDisplayAffixPositionChange(value as "before" | "after")
              }
            >
              <SelectTrigger id={`${idPrefix}-affix-position`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="before">
                  {t("fields.displayAffixBefore", "Перед значением")}
                </SelectItem>
                <SelectItem value="after">
                  {t("fields.displayAffixAfter", "После значения")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
          <span className="shrink-0 text-slate-500">
            {t("fields.displayAffixPreview", "Пример:")}
          </span>
          <span className="font-medium tabular-nums text-slate-900">
            <AffixedNumericValue config={{ displayAffix, displayAffixPosition }}>
              15,23
            </AffixedNumericValue>
          </span>
        </div>
      </div>
    </section>
  );
}