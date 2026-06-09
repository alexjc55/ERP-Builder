import { useRef } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";

export type FormulaFieldRef = { key: string; label: string };

/**
 * Functions that take arguments — clicking inserts `name()` with the caret
 * inside. `sig` shows the signature (parameters separated by commas), `example`
 * a concrete call, `descKey`/`descFallback` a short i18n description — all shown
 * on hover so users know how to separate parameters.
 */
const FORMULA_FUNCS: {
  name: string;
  sig: string;
  sigKey: string;
  example: string;
  descKey: string;
  descFallback: string;
}[] = [
  {
    name: "if",
    sig: "if(условие, если_да, если_нет)",
    sigKey: "fields.fnSigIf",
    example: 'if({qty} > 10, "опт", "розница")',
    descKey: "fields.fnIf",
    descFallback: "Возвращает второй аргумент, если условие истинно, иначе третий.",
  },
  {
    name: "round",
    sig: "round(число, знаки)",
    sigKey: "fields.fnSigRound",
    example: "round({price} * 1.2, 2)",
    descKey: "fields.fnRound",
    descFallback: "Округляет число до указанного количества знаков после запятой.",
  },
  {
    name: "min",
    sig: "min(число1, число2, …)",
    sigKey: "fields.fnSigMin",
    example: "min({plan}, {fact})",
    descKey: "fields.fnMin",
    descFallback: "Наименьшее из перечисленных значений.",
  },
  {
    name: "max",
    sig: "max(число1, число2, …)",
    sigKey: "fields.fnSigMax",
    example: "max({plan}, {fact})",
    descKey: "fields.fnMax",
    descFallback: "Наибольшее из перечисленных значений.",
  },
  {
    name: "sum",
    sig: "sum(число1, число2, …)",
    sigKey: "fields.fnSigSum",
    example: "sum({q1}, {q2}, {q3})",
    descKey: "fields.fnSum",
    descFallback: "Сумма всех перечисленных значений.",
  },
  {
    name: "abs",
    sig: "abs(число)",
    sigKey: "fields.fnSigAbs",
    example: "abs({balance})",
    descKey: "fields.fnAbs",
    descFallback: "Абсолютное значение (модуль) числа.",
  },
  {
    name: "concat",
    sig: "concat(значение1, значение2, …)",
    sigKey: "fields.fnSigConcat",
    example: 'concat({first}, " ", {last})',
    descKey: "fields.fnConcat",
    descFallback: "Объединяет значения в одну строку.",
  },
  {
    name: "coalesce",
    sig: "coalesce(значение1, значение2, …)",
    sigKey: "fields.fnSigCoalesce",
    example: "coalesce({nick}, {name})",
    descKey: "fields.fnCoalesce",
    descFallback: "Первое непустое значение из перечисленных.",
  },
  {
    name: "upper",
    sig: "upper(текст)",
    sigKey: "fields.fnSigUpper",
    example: "upper({code})",
    descKey: "fields.fnUpper",
    descFallback: "Переводит текст в ВЕРХНИЙ регистр.",
  },
  {
    name: "lower",
    sig: "lower(текст)",
    sigKey: "fields.fnSigLower",
    example: "lower({email})",
    descKey: "fields.fnLower",
    descFallback: "Переводит текст в нижний регистр.",
  },
  {
    name: "len",
    sig: "len(текст)",
    sigKey: "fields.fnSigLen",
    example: "len({title})",
    descKey: "fields.fnLen",
    descFallback: "Количество символов в тексте.",
  },
];

/**
 * Formula textarea for `function`-type fields with clickable helpers: a chip per
 * referenceable field (inserts `{key}` at the caret) and a row of function chips.
 * This removes the need to remember every column's system key by hand.
 */
export function FormulaEditor({
  value,
  onChange,
  fields,
}: {
  value: string;
  onChange: (v: string) => void;
  fields: FormulaFieldRef[];
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);

  const insert = (snippet: string, caretBack = 0) => {
    const el = ref.current;
    if (!el) {
      onChange(value + snippet);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    onChange(next);
    const pos = start + snippet.length - caretBack;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="space-y-1.5">
      <Label>{t("fields.formula", "Формула")}</Label>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"{price} * {qty} * (1 + {vat} / 100)"}
        rows={3}
        className="font-mono text-sm"
      />
      {fields.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-slate-500">{t("fields.formulaInsertField", "Вставить поле:")}</p>
          <div className="flex flex-wrap gap-1">
            {fields.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => insert(`{${f.key}}`)}
                className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 text-xs transition-colors"
                title={`{${f.key}}`}
              >
                <span className="font-medium text-slate-700">{f.label}</span>
                <span className="ml-1 font-mono text-slate-400">{`{${f.key}}`}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs text-slate-500">{t("fields.formulaInsertFunc", "Функции:")}</p>
        <div className="flex flex-wrap gap-1">
          {FORMULA_FUNCS.map((fn) => (
            <Tooltip key={fn.name}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => insert(`${fn.name}()`, 1)}
                  className="px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-slate-100 hover:border-slate-300 font-mono text-xs text-slate-600 transition-colors"
                >
                  {fn.name}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs space-y-1">
                <p className="font-mono text-[11px]">{t(fn.sigKey, fn.sig)}</p>
                <p className="opacity-80">{t(fn.descKey, fn.descFallback)}</p>
                <p className="font-mono text-[11px] opacity-70">
                  {t("fields.fnExample", "Пример")}: {fn.example}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-400">
        {t(
          "fields.formulaHint",
          "Ссылайтесь на другие поля этой записи через {ключ_поля}. Операторы: + - * / %, сравнения, && || !, тернарный ?:. Функции: if, round, abs, min, max, sum, concat, upper, lower, len, coalesce. Вычисляется при показе и не хранится.",
        )}
      </p>
    </div>
  );
}
