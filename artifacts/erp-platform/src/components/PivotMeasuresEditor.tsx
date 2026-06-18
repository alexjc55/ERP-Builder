import { Plus, Trash2, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultilingualInput } from "@/components/MultilingualInput";
import { FormulaEditor, type FormulaFieldRef } from "@/components/FormulaEditor";
import type { MultilingualText, PivotMeasure } from "@workspace/api-client-react";

type MLValue = { ru?: string; en?: string; he?: string };

/**
 * Editor draft for a single pivot measure. The three pivot surfaces (named view,
 * default pivot, dashboard widget) all edit a `DraftMeasure[]`; the save rule
 * (single → `measure`, many → `measures`) lives in {@link buildMeasureConfig}.
 */
export type DraftMeasure = {
  /** Stable id within the pivot: column key + the {ref} target for calc measures. */
  key: string;
  agg: "count" | "sum" | "formula" | "calc";
  /** For agg=sum: the numeric entity field key. */
  fieldKey: string;
  /** For agg=formula (per-record) or agg=calc (over other measures). */
  formula: string;
  /** Multilingual column-header override. */
  nameJson: MLValue;
};

let measureSeq = 0;
/** Generate a unique stable key for a new measure within the editor session. */
export function newMeasureKey(): string {
  measureSeq += 1;
  return `m_${Date.now().toString(36)}_${measureSeq}`;
}

export function newDraftMeasure(fieldKey = ""): DraftMeasure {
  return { key: newMeasureKey(), agg: "count", fieldKey, formula: "", nameJson: {} };
}

function cleanML(v: MLValue): MultilingualText | null {
  const out: MLValue = {};
  for (const lang of ["ru", "en", "he"] as const) {
    const s = (v[lang] ?? "").trim();
    if (s) out[lang] = s;
  }
  return Object.keys(out).length > 0 ? (out as MultilingualText) : null;
}

/** Build a single {@link PivotMeasure} from a draft. `includeKey` is set in
 * multi-measure mode (the key is the column id + calc ref target). */
export function draftToMeasure(m: DraftMeasure, includeKey: boolean): PivotMeasure {
  const name = cleanML(m.nameJson);
  let out: PivotMeasure;
  if (m.agg === "sum") {
    out = { agg: "sum", source: "entity", fieldKey: m.fieldKey };
  } else if (m.agg === "formula") {
    out = { agg: "formula", formula: m.formula.trim() };
  } else if (m.agg === "calc") {
    out = { agg: "calc", formula: m.formula.trim() };
  } else {
    out = { agg: "count" };
  }
  if (name) out.nameJson = name;
  if (includeKey) out.key = m.key;
  return out;
}

/** Load a pivot config's measures into editor drafts (multi `measures` wins,
 * else the legacy single `measure`). */
export function measuresFromConfig(
  pivot: { measure?: PivotMeasure | null; measures?: PivotMeasure[] | null } | null | undefined,
): DraftMeasure[] {
  const toDraft = (mm: PivotMeasure | null | undefined): DraftMeasure => ({
    key: (mm?.key && mm.key.trim()) || newMeasureKey(),
    agg: mm?.agg === "sum" ? "sum" : mm?.agg === "formula" ? "formula" : mm?.agg === "calc" ? "calc" : "count",
    fieldKey: mm?.fieldKey ?? "",
    formula: mm?.formula ?? "",
    nameJson: ((mm?.nameJson as MLValue | null | undefined) ?? (mm?.formulaName as MLValue | null | undefined) ?? {}),
  });
  if (pivot?.measures && pivot.measures.length > 0) return pivot.measures.map(toDraft);
  return [toDraft(pivot?.measure)];
}

/** Validate + serialize the measures for the wire. Returns either an `error`
 * (i18n'd message) or the `{ measure?, measures? }` fields to spread onto the
 * PivotConfig. Single measure → `measure` (cols allowed by caller); many →
 * `measures` (caller must drop any cols dimension). */
export function buildMeasureConfig(
  measures: DraftMeasure[],
  t: (k: string, f: string) => string,
): { error: string } | { measure?: PivotMeasure; measures?: PivotMeasure[] } {
  if (measures.length === 0) return { error: t("pivot.needMeasure", "Добавьте хотя бы одну меру") };
  // Per-measure agg-specific checks.
  for (const m of measures) {
    if (m.agg === "sum" && !m.fieldKey)
      return { error: t("pivot.needMeasureField", "Выберите числовое поле для суммы") };
    if (m.agg === "formula" && !m.formula.trim())
      return { error: t("pivot.needFormula", "Введите формулу для меры") };
    if (m.agg === "calc" && !m.formula.trim())
      return { error: t("pivot.needCalcFormula", "Введите формулу вычисляемой меры") };
  }
  if (measures.length === 1) {
    // calc is only meaningful when it references OTHER measures.
    if (measures[0].agg === "calc")
      return { error: t("pivot.calcNeedsOthers", "Вычисляемая мера требует других мер") };
    return { measure: draftToMeasure(measures[0], false) };
  }
  // Multi-measure: keys must be unique and there must be a non-calc measure to compute over.
  const seen = new Set<string>();
  let hasValue = false;
  for (const m of measures) {
    if (seen.has(m.key)) return { error: t("pivot.dupMeasureKey", "Дублирующийся ключ меры") };
    seen.add(m.key);
    if (m.agg !== "calc") hasValue = true;
  }
  if (!hasValue) return { error: t("pivot.needValueMeasure", "Добавьте хотя бы одну невычисляемую меру") };
  return { measures: measures.map((m) => draftToMeasure(m, true)) };
}

/**
 * Editor for a pivot's list of measures (each becomes a value column). When the
 * list has a single entry the parent shows the optional column dimension; with
 * more than one, columns are the measures themselves (mutually exclusive). A
 * `calc` measure runs a formula over the OTHER measures' per-row aggregated
 * values, referenced by their key.
 */
export function PivotMeasuresEditor({
  measures,
  onChange,
  sumFields,
  formulaRefs,
  ml,
  t,
}: {
  measures: DraftMeasure[];
  onChange: (next: DraftMeasure[]) => void;
  sumFields: { fieldKey: string; nameJson: MultilingualText | string | null | undefined }[];
  formulaRefs: FormulaFieldRef[];
  ml: (val: MultilingualText | string | undefined | null) => string;
  t: (k: string, f: string) => string;
}) {
  const update = (idx: number, patch: Partial<DraftMeasure>) =>
    onChange(measures.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  const remove = (idx: number) => onChange(measures.filter((_, i) => i !== idx));
  const add = () => onChange([...measures, newDraftMeasure(sumFields[0]?.fieldKey ?? "")]);

  const multi = measures.length > 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{t("pivot.measures", "Меры (столбцы значений)")}</Label>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={add}>
          <Plus className="w-3.5 h-3.5" /> {t("pivot.addMeasure", "Мера")}
        </Button>
      </div>
      <div className="space-y-3">
        {measures.map((m, idx) => {
          // calc may reference any OTHER measure by its key; its label falls back to its key.
          const calcRefs: FormulaFieldRef[] = measures
            .filter((o) => o.key !== m.key)
            .map((o) => ({ key: o.key, label: ml(cleanML(o.nameJson)) || o.key }));
          return (
            <div key={m.key} className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-2.5">
              <div className="flex items-center gap-2">
                <Select
                  value={m.agg}
                  onValueChange={(v) =>
                    update(idx, { agg: v as DraftMeasure["agg"], fieldKey: "", formula: "" })
                  }
                >
                  <SelectTrigger className="h-8 text-sm w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">{t("pivot.aggCount", "Количество записей")}</SelectItem>
                    <SelectItem value="sum">{t("pivot.aggSum", "Сумма поля")}</SelectItem>
                    <SelectItem value="formula">{t("pivot.aggFormula", "Формула")}</SelectItem>
                    <SelectItem value="calc">{t("pivot.aggCalc", "Вычисление по мерам")}</SelectItem>
                  </SelectContent>
                </Select>
                {m.agg === "sum" && (
                  <Select value={m.fieldKey} onValueChange={(v) => update(idx, { fieldKey: v })}>
                    <SelectTrigger className="h-8 text-sm flex-1">
                      <SelectValue placeholder={t("pivot.selectNumberField", "числовое поле…")} />
                    </SelectTrigger>
                    <SelectContent>
                      {sumFields.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-slate-400">
                          {t("pivot.noNumberFields", "Нет числовых полей в сводных")}
                        </div>
                      ) : (
                        sumFields.map((f) => (
                          <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                )}
                {(m.agg === "count" || m.agg === "calc") && <div className="flex-1" />}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-slate-400 hover:text-rose-600"
                  onClick={() => remove(idx)}
                  title={t("common.delete", "Удалить")}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              {m.agg === "formula" && (
                <FormulaEditor
                  value={m.formula}
                  onChange={(v) => update(idx, { formula: v })}
                  fields={formulaRefs}
                  label={t("pivot.formulaMeasureLabel", "Формула меры")}
                  hint={t(
                    "pivot.formulaMeasureHint",
                    "Вычисляется для каждой записи, затем суммируется по ячейкам. Ссылайтесь на поля через {ключ_поля} (доступны поля, включённые в сводные).",
                  )}
                />
              )}

              {m.agg === "calc" && (
                <FormulaEditor
                  value={m.formula}
                  onChange={(v) => update(idx, { formula: v })}
                  fields={calcRefs}
                  label={t("pivot.calcFormulaLabel", "Формула по мерам")}
                  hint={t(
                    "pivot.calcFormulaHint",
                    "Вычисляется для каждой строки по уже посчитанным значениям ДРУГИХ мер. Ссылайтесь на меру через {ключ_меры}.",
                  )}
                />
              )}

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs text-slate-500">
                  {m.agg === "calc" && <Calculator className="w-3 h-3" />}
                  {t("pivot.measureName", "Название меры (заголовок столбца)")}
                </Label>
                <MultilingualInput
                  label={t("pivot.measureNamePlaceholder", "Название")}
                  value={m.nameJson}
                  onChange={(v) => update(idx, { nameJson: v })}
                />
              </div>
            </div>
          );
        })}
      </div>
      {multi && (
        <p className="text-xs text-slate-400">
          {t(
            "pivot.multiMeasureHint",
            "Несколько мер: каждая мера — отдельный столбец. Измерение столбцов недоступно, итоги по строкам не считаются.",
          )}
        </p>
      )}
    </div>
  );
}
