import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";

export type FormulaFieldRef = {
  /** Lookup key without braces. Legacy callers may continue to supply flat keys. */
  key: string;
  label: string;
  /** Unambiguous key inserted for newly configured entity/page fields. */
  token?: string;
  /** Human-readable source heading, for example “Страница: Заказы”. */
  sourceLabel?: string;
  sourceKind?: "entity" | "page" | "linked";
};

type FormulaFunction = {
  name: string;
  category: "numeric" | "text" | "logical" | "date" | "aggregate";
  signature: string;
  example: string;
  description: string;
  noCaret?: boolean;
};

const FORMULA_FUNCS: FormulaFunction[] = [
  { name: "round", category: "numeric", signature: "round(число, знаки)", example: "round({entity:1.price}, 2)", description: "Округляет число." },
  { name: "floor", category: "numeric", signature: "floor(число)", example: "floor({entity:1.price})", description: "Округляет вниз." },
  { name: "ceil", category: "numeric", signature: "ceil(число)", example: "ceil({entity:1.price})", description: "Округляет вверх." },
  { name: "abs", category: "numeric", signature: "abs(число)", example: "abs({entity:1.balance})", description: "Возвращает модуль числа." },
  { name: "min", category: "numeric", signature: "min(число1, число2, …)", example: "min({plan}, {fact})", description: "Наименьшее значение." },
  { name: "max", category: "numeric", signature: "max(число1, число2, …)", example: "max({plan}, {fact})", description: "Наибольшее значение." },
  { name: "sum", category: "aggregate", signature: "sum(число1, число2, …)", example: "sum({q1}, {q2})", description: "Сумма значений." },
  { name: "average", category: "aggregate", signature: "average(число1, число2, …)", example: "average({plan}, {fact})", description: "Среднее значение." },
  { name: "concat", category: "text", signature: "concat(значение1, значение2, …)", example: 'concat({first}, " ", {last})', description: "Объединяет текст." },
  { name: "upper", category: "text", signature: "upper(текст)", example: "upper({code})", description: "Переводит текст в верхний регистр." },
  { name: "lower", category: "text", signature: "lower(текст)", example: "lower({email})", description: "Переводит текст в нижний регистр." },
  { name: "trim", category: "text", signature: "trim(текст)", example: "trim({title})", description: "Удаляет пробелы в начале и конце." },
  { name: "replace", category: "text", signature: "replace(текст, что, на_что)", example: 'replace({phone}, "-", "")', description: "Заменяет все вхождения текста." },
  { name: "contains", category: "text", signature: "contains(текст, искомое)", example: 'contains({email}, "@")', description: "Проверяет, содержит ли текст фрагмент." },
  { name: "startsWith", category: "text", signature: "startsWith(текст, начало)", example: 'startsWith({code}, "A-")', description: "Проверяет начало текста." },
  { name: "endsWith", category: "text", signature: "endsWith(текст, окончание)", example: 'endsWith({file}, ".pdf")', description: "Проверяет окончание текста." },
  { name: "len", category: "text", signature: "len(текст)", example: "len({title})", description: "Количество символов." },
  { name: "coalesce", category: "logical", signature: "coalesce(значение1, значение2, …)", example: "coalesce({nick}, {name})", description: "Первое непустое значение." },
  { name: "if", category: "logical", signature: "if(условие, если_да, если_нет)", example: 'if({qty} > 10, "опт", "розница")', description: "Выбирает результат по условию." },
  { name: "today", category: "date", signature: "today()", example: "today()", description: "Текущая системная дата.", noCaret: true },
  { name: "daysBetween", category: "date", signature: "daysBetween(начало, конец)", example: "daysBetween({start}, {end})", description: "Количество календарных дней." },
  { name: "workingDaysBetween", category: "date", signature: "workingDaysBetween(начало, конец)", example: "workingDaysBetween({start}, {end})", description: "Количество рабочих дней." },
  { name: "daysSince", category: "date", signature: "daysSince(дата)", example: "daysSince({start})", description: "Дни от даты до сегодня." },
  { name: "daysUntil", category: "date", signature: "daysUntil(дата)", example: "daysUntil({end})", description: "Дни от сегодня до даты." },
];

const CATEGORY_LABELS: Record<FormulaFunction["category"], string> = {
  numeric: "Числовые",
  text: "Текстовые",
  logical: "Логические",
  date: "Дата",
  aggregate: "Агрегаты",
};

export function FormulaEditor({
  value,
  onChange,
  fields,
  label,
  placeholder,
  hint,
  insertLabel,
  hideFunctions,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  fields: FormulaFieldRef[];
  label?: string;
  placeholder?: string;
  hint?: string;
  insertLabel?: string;
  hideFunctions?: boolean;
  /** Optional structured-source builder supplied by field configuration dialogs. */
  children?: React.ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [search, setSearch] = useState("");

  const insert = (snippet: string, caretBack = 0) => {
    const el = ref.current;
    if (!el) return onChange(value + snippet);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + snippet + value.slice(end));
    const pos = start + snippet.length - caretBack;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const groups = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    const map = new Map<string, FormulaFieldRef[]>();
    for (const field of fields) {
      const token = field.token ?? field.key;
      if (q && !`${field.label} ${field.sourceLabel ?? ""} ${token}`.toLocaleLowerCase().includes(q)) continue;
      const group = field.sourceLabel ?? t("fields.formulaCurrentSource", "Текущая запись");
      map.set(group, [...(map.get(group) ?? []), field]);
    }
    return [...map.entries()];
  }, [fields, search, t]);

  return (
    <div className="space-y-2">
      <Label>{label ?? t("fields.formula", "Формула")}</Label>
      <Textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "{entity:12.price} * {entity:12.qty}"} rows={3} className="font-mono text-sm" />
      {fields.length > 0 && (
        <div className="space-y-2 rounded-md border border-slate-200 p-2">
          <p className="text-xs font-medium text-slate-600">{insertLabel ?? t("fields.formulaInsertField", "Вставить поле:")}</p>
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t("fields.formulaSearch", "Поиск поля или источника")} className="h-8 pl-7 text-xs" />
          </div>
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {groups.map(([group, refs]) => (
              <section key={group}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group}</p>
                <div className="flex flex-wrap gap-1">
                  {refs.map((field) => {
                    const token = field.token ?? field.key;
                    return (
                      <button key={`${group}:${token}`} type="button" onClick={() => insert(`{${token}}`)}
                        className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-left text-xs hover:border-slate-300 hover:bg-slate-100"
                        title={`${group} · ${field.label} · {${token}}`}>
                        <span className="font-medium text-slate-700">{field.label}</span>
                        <span className="ml-1 font-mono text-slate-400">{`{${token}}`}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {groups.length === 0 && <p className="py-2 text-center text-xs text-slate-400">{t("common.noResults", "Ничего не найдено")}</p>}
          </div>
        </div>
      )}
      {children}
      {!hideFunctions && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{t("fields.formulaInsertFunc", "Функции:")}</p>
          {(Object.keys(CATEGORY_LABELS) as FormulaFunction["category"][]).map((category) => (
            <div key={category} className="flex items-start gap-2">
              <span className="w-20 shrink-0 pt-1 text-[11px] text-slate-400">{CATEGORY_LABELS[category]}</span>
              <div className="flex flex-wrap gap-1">
                {FORMULA_FUNCS.filter((fn) => fn.category === category).map((fn) => (
                  <Tooltip key={fn.name}>
                    <TooltipTrigger asChild>
                      <button type="button" onClick={() => insert(`${fn.name}()`, fn.noCaret ? 0 : 1)}
                        className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs text-slate-600 hover:bg-slate-100">
                        {fn.name}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs space-y-1">
                      <p className="font-mono text-[11px]">{fn.signature}</p>
                      <p className="opacity-80">{fn.description}</p>
                      <p className="font-mono text-[11px] opacity-70">{t("fields.fnExample", "Пример")}: {fn.example}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400">{hint ?? t("fields.formulaHintQualified",
        "Новые ссылки имеют однозначный вид {entity:ID.ключ}, {page:ID.ключ} или {source:ключ}. Старые формулы с {ключ} продолжат работать.")}</p>
    </div>
  );
}