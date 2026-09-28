import { cleanFpNoise, evaluateFormula, normalizeDecimals } from "@workspace/formula";
import { buildQualifiedFormulaScope } from "./formula-runtime";

type Scope = Parameters<typeof buildQualifiedFormulaScope>[0];
type Config = { expression?: string; decimals?: number | null; totalMode?: "sum" | "average" | "formula" };

/**
 * Records-table aggregation only. Dashboard/pivot measures retain their explicit
 * aggregation settings: a column footer setting must not override a measure.
 * Call with the complete already-authorized filtered universe, never a page.
 * Inputs come from the existing permission-aware linked-source materializer.
 */
export class FormulaColumnTotal {
  private sum = 0;
  private count = 0;
  private context?: Scope;
  private entity: Record<string, unknown> = {};
  private page: Record<string, unknown> = {};
  constructor(private config: Config) {}

  /** Legacy group sum cells remain absent when every row was empty/suppressed. */
  hasGroupValue(): boolean {
    return this.config.totalMode === "formula" || this.config.totalMode === "average" || this.count > 0;
  }

  private round(n: number): number {
    const d = normalizeDecimals(this.config.decimals);
    return d == null ? cleanFpNoise(n) : Number(n.toFixed(d));
  }

  add(scope: Scope, suppressed = false): void {
    this.context = scope;
    if (suppressed) {
      // Once-per-group non-winners are displayed as numeric zero.
      if (this.config.totalMode === "average") this.count++;
      return;
    }
    if (this.config.totalMode === "formula") {
      const collect = (target: Record<string, unknown>, source: Record<string, unknown>, keys: Set<string>) => {
        for (const [key, raw] of Object.entries(source)) {
          // Re-evaluate same-context formula chains over aggregate inputs rather
          // than summing previously materialized row-level intermediate results.
          if (keys.has(key)) continue;
          const n = typeof raw === "number" ? raw :
            typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
          if (Number.isFinite(n)) target[key] = Number(target[key] ?? 0) + n;
          else if (!(key in target)) target[key] = null;
        }
      };
      const entityKeys = new Set(scope.entityFormulas.flatMap(f => [f.key, `entity:${scope.entityId}.${f.key}`]));
      const pageKeys = new Set((scope.pageFormulas ?? []).flatMap(f => [f.key, `page:${scope.pageId}.${f.key}`]));
      for (const f of scope.pageFormulas ?? []) entityKeys.add(`page:${scope.pageId}.${f.key}`);
      collect(this.entity, scope.entityValues, entityKeys);
      collect(this.page, scope.pageValues ?? {}, pageKeys);
      this.count++;
      return;
    }
    try {
      const out = evaluateFormula(this.config.expression ?? "", buildQualifiedFormulaScope(scope), scope.formulaOptions);
      if (typeof out === "number" && Number.isFinite(out)) {
        this.sum += this.round(out);
        this.count++;
      }
    } catch { /* Invalid/nonnumeric row results do not contribute. */ }
  }

  value(): number {
    if (this.config.totalMode === "formula") {
      if (!this.context || !this.count) return 0;
      try {
        const scope = buildQualifiedFormulaScope({
          ...this.context, entityValues: this.entity, pageValues: this.page,
        });
        const out = evaluateFormula(this.config.expression ?? "", scope, this.context.formulaOptions);
        return typeof out === "number" && Number.isFinite(out) ? this.round(out) : 0;
      } catch { return 0; }
    }
    return this.round(this.config.totalMode === "average" && this.count ? this.sum / this.count : this.sum);
  }
}