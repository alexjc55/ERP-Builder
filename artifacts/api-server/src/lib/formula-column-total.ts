import { cleanFpNoise, evaluateFormula, normalizeDecimals } from "@workspace/formula";
import { buildQualifiedFormulaScope } from "./formula-runtime";

type Config = { expression?: string; decimals?: number | null; totalMode?: "sum" | "average" | "formula" };
type RuntimeScope = Parameters<typeof buildQualifiedFormulaScope>[0];
type TotalDef = RuntimeScope["entityFormulas"][number] & Config;
type Scope = Omit<RuntimeScope, "entityFormulas" | "pageFormulas"> & {
  entityFormulas: TotalDef[];
  pageFormulas?: TotalDef[];
  suppressedEntityKeys?: ReadonlySet<string>;
  suppressedPageKeys?: ReadonlySet<string>;
};

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
  private dependencies = new Map<string, FormulaColumnTotal | null>();
  constructor(private config: Config, private ancestors = new Set<string>()) {}

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
          // Formula columns have their own aggregation, not products of sums.
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
      const definitions = new Map<string, { def: TotalDef; id: string; suppressed: boolean }>();
      const register = (defs: TotalDef[], prefix: string, suppressed?: ReadonlySet<string>) => {
        for (const def of defs) {
          const entry = { def, id: `${prefix}.${def.key}`, suppressed: suppressed?.has(def.key) ?? false };
          definitions.set(def.key, entry);
          definitions.set(entry.id, entry);
        }
      };
      register(scope.entityFormulas, `entity:${scope.entityId}`, scope.suppressedEntityKeys);
      if (scope.pageId != null) {
        for (const key of Object.keys(scope.pageValues ?? {})) definitions.delete(key);
      }
      register(scope.pageFormulas ?? [], `page:${scope.pageId}`, scope.suppressedPageKeys);
      for (const match of (this.config.expression ?? "").matchAll(/\{([^{}]+)\}/g)) {
        const key = match[1].trim();
        const entry = definitions.get(key);
        if (!entry) continue;
        if (!this.dependencies.has(key)) {
          this.dependencies.set(key, this.ancestors.has(entry.id) ? null :
            new FormulaColumnTotal(entry.def, new Set([...this.ancestors, entry.id])));
        }
        // Each referenced column totals its own rounded row results by default.
        // Explicit average/formula modes are honored recursively, cycle-safe.
      }
      for (const [key, total] of this.dependencies) {
        total?.add(scope, definitions.get(key)?.suppressed);
      }
      this.count++;
      return;
    }
    try {
      const entityValues = { ...scope.entityValues };
      const pageValues = { ...scope.pageValues };
      for (const key of scope.suppressedEntityKeys ?? []) {
        entityValues[key] = entityValues[`entity:${scope.entityId}.${key}`] = 0;
      }
      for (const key of scope.suppressedPageKeys ?? []) {
        pageValues[key] = 0;
        entityValues[`page:${scope.pageId}.${key}`] = 0;
      }
      const out = evaluateFormula(this.config.expression ?? "", buildQualifiedFormulaScope({
        ...scope, entityValues, pageValues,
      }), scope.formulaOptions);
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
          entityFormulas: [], pageFormulas: [],
        });
        for (const [key, total] of this.dependencies) scope[key] = total?.value() ?? null;
        const out = evaluateFormula(this.config.expression ?? "", scope, this.context.formulaOptions);
        return typeof out === "number" && Number.isFinite(out) ? this.round(out) : 0;
      } catch { return 0; }
    }
    return this.round(this.config.totalMode === "average" && this.count ? this.sum / this.count : this.sum);
  }
}