import { useRef } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";

export type FormulaFieldRef = { key: string; label: string };

/** Functions that take arguments — clicking inserts `name()` with the caret inside. */
const FORMULA_FUNCS = [
  "if",
  "round",
  "min",
  "max",
  "sum",
  "abs",
  "concat",
  "coalesce",
  "upper",
  "lower",
  "len",
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
            <button
              key={fn}
              type="button"
              onClick={() => insert(`${fn}()`, 1)}
              className="px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-slate-100 hover:border-slate-300 font-mono text-xs text-slate-600 transition-colors"
              title={`${fn}(…)`}
            >
              {fn}
            </button>
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
