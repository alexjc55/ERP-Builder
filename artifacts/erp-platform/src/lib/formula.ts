/**
 * Tiny safe formula evaluator for `function`-type fields. Expressions reference
 * other fields of the same record via `{field_key}` and are evaluated at read
 * time. No `eval`/`Function` is used — a hand-written tokenizer + recursive
 * descent parser keeps evaluation sandboxed (only the whitelisted operators and
 * functions below can run).
 *
 * Supported:
 *   - numbers, 'strings', "strings", true/false
 *   - field refs: {price}, {qty}
 *   - arithmetic: + - * / %   (unary -)
 *   - comparison: == != < > <= >=
 *   - logic: && || !
 *   - ternary: cond ? a : b
 *   - parentheses
 *   - functions: if, round, floor, ceil, abs, min, max, sum, concat, upper,
 *     lower, len, coalesce
 *
 * `+` adds when both operands are numbers, otherwise concatenates as text.
 */

export type FormulaValue = number | string | boolean | null;

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ident"; v: string }
  | { t: "field"; v: string }
  | { t: "op"; v: string }
  | { t: "punc"; v: string };

const TWO_CHAR_OPS = ["==", "!=", "<=", ">=", "&&", "||"];
const ONE_CHAR_OPS = ["+", "-", "*", "/", "%", "<", ">", "!"];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "{") {
      const end = src.indexOf("}", i);
      if (end === -1) throw new Error("Незакрытая { в формуле");
      toks.push({ t: "field", v: src.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== c) {
        s += src[j];
        j++;
      }
      if (j >= n) throw new Error("Незакрытая строка в формуле");
      toks.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      let num = "";
      while (j < n && /[0-9.]/.test(src[j])) {
        num += src[j];
        j++;
      }
      toks.push({ t: "num", v: Number(num) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      let id = "";
      while (j < n && /[a-zA-Z0-9_]/.test(src[j])) {
        id += src[j];
        j++;
      }
      toks.push({ t: "ident", v: id });
      i = j;
      continue;
    }
    if (c === "(" || c === ")" || c === "," || c === "?" || c === ":") {
      toks.push({ t: "punc", v: c });
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      toks.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`Недопустимый символ '${c}' в формуле`);
  }
  return toks;
}

// ---- AST ----
type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "field"; v: string }
  | { k: "unary"; op: string; e: Node }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "ternary"; c: Node; a: Node; b: Node }
  | { k: "call"; name: string; args: Node[] };

class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }
  private next(): Tok | undefined {
    return this.toks[this.pos++];
  }
  private eat(t: string, v: string): void {
    const tok = this.peek();
    if (!tok || tok.t !== t || tok.v !== v) throw new Error(`Ожидалось '${v}' в формуле`);
    this.pos++;
  }

  parse(): Node {
    const node = this.ternary();
    if (this.pos < this.toks.length) throw new Error("Лишние символы в формуле");
    return node;
  }

  private ternary(): Node {
    const cond = this.logicalOr();
    const tok = this.peek();
    if (tok && tok.t === "punc" && tok.v === "?") {
      this.pos++;
      const a = this.ternary();
      this.eat("punc", ":");
      const b = this.ternary();
      return { k: "ternary", c: cond, a, b };
    }
    return cond;
  }

  private binLevel(ops: string[], next: () => Node): Node {
    let left = next();
    for (;;) {
      const tok = this.peek();
      if (tok && tok.t === "op" && ops.includes(tok.v)) {
        this.pos++;
        const right = next();
        left = { k: "bin", op: tok.v, l: left, r: right };
      } else {
        return left;
      }
    }
  }

  private logicalOr(): Node {
    return this.binLevel(["||"], () => this.logicalAnd());
  }
  private logicalAnd(): Node {
    return this.binLevel(["&&"], () => this.equality());
  }
  private equality(): Node {
    return this.binLevel(["==", "!="], () => this.comparison());
  }
  private comparison(): Node {
    return this.binLevel(["<", ">", "<=", ">="], () => this.additive());
  }
  private additive(): Node {
    return this.binLevel(["+", "-"], () => this.multiplicative());
  }
  private multiplicative(): Node {
    return this.binLevel(["*", "/", "%"], () => this.unary());
  }

  private unary(): Node {
    const tok = this.peek();
    if (tok && tok.t === "op" && (tok.v === "-" || tok.v === "!")) {
      this.pos++;
      return { k: "unary", op: tok.v, e: this.unary() };
    }
    return this.primary();
  }

  private primary(): Node {
    const tok = this.next();
    if (!tok) throw new Error("Неожиданный конец формулы");
    if (tok.t === "num") return { k: "num", v: tok.v };
    if (tok.t === "str") return { k: "str", v: tok.v };
    if (tok.t === "field") return { k: "field", v: tok.v };
    if (tok.t === "punc" && tok.v === "(") {
      const e = this.ternary();
      this.eat("punc", ")");
      return e;
    }
    if (tok.t === "ident") {
      if (tok.v === "true") return { k: "bool", v: true };
      if (tok.v === "false") return { k: "bool", v: false };
      const after = this.peek();
      if (after && after.t === "punc" && after.v === "(") {
        this.pos++;
        const args: Node[] = [];
        if (!(this.peek()?.t === "punc" && this.peek()?.v === ")")) {
          args.push(this.ternary());
          while (this.peek()?.t === "punc" && this.peek()?.v === ",") {
            this.pos++;
            args.push(this.ternary());
          }
        }
        this.eat("punc", ")");
        return { k: "call", name: tok.v.toLowerCase(), args };
      }
      throw new Error(`Неизвестный идентификатор '${tok.v}' — используйте {ключ_поля} для ссылок`);
    }
    throw new Error("Синтаксическая ошибка в формуле");
  }
}

function toNum(v: FormulaValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: FormulaValue): string {
  if (v == null) return "";
  return String(v);
}

function toBool(v: FormulaValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v == null) return false;
  return v !== "";
}

function isNumeric(v: FormulaValue): boolean {
  return typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
}

function evalNode(node: Node, vars: Record<string, unknown>): FormulaValue {
  switch (node.k) {
    case "num":
      return node.v;
    case "str":
      return node.v;
    case "bool":
      return node.v;
    case "field": {
      const raw = vars[node.v];
      if (raw == null) return null;
      if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") return raw;
      return String(raw);
    }
    case "unary": {
      const e = evalNode(node.e, vars);
      return node.op === "-" ? -toNum(e) : !toBool(e);
    }
    case "ternary":
      return toBool(evalNode(node.c, vars)) ? evalNode(node.a, vars) : evalNode(node.b, vars);
    case "bin": {
      const l = evalNode(node.l, vars);
      const r = evalNode(node.r, vars);
      switch (node.op) {
        case "+":
          if (isNumeric(l) && isNumeric(r)) return toNum(l) + toNum(r);
          return toStr(l) + toStr(r);
        case "-":
          return toNum(l) - toNum(r);
        case "*":
          return toNum(l) * toNum(r);
        case "/": {
          const d = toNum(r);
          return d === 0 ? null : toNum(l) / d;
        }
        case "%": {
          const d = toNum(r);
          return d === 0 ? null : toNum(l) % d;
        }
        case "==":
          return isNumeric(l) && isNumeric(r) ? toNum(l) === toNum(r) : toStr(l) === toStr(r);
        case "!=":
          return isNumeric(l) && isNumeric(r) ? toNum(l) !== toNum(r) : toStr(l) !== toStr(r);
        case "<":
          return isNumeric(l) && isNumeric(r) ? toNum(l) < toNum(r) : toStr(l) < toStr(r);
        case ">":
          return isNumeric(l) && isNumeric(r) ? toNum(l) > toNum(r) : toStr(l) > toStr(r);
        case "<=":
          return isNumeric(l) && isNumeric(r) ? toNum(l) <= toNum(r) : toStr(l) <= toStr(r);
        case ">=":
          return isNumeric(l) && isNumeric(r) ? toNum(l) >= toNum(r) : toStr(l) >= toStr(r);
        case "&&":
          return toBool(l) && toBool(r);
        case "||":
          return toBool(l) ? l : r;
        default:
          throw new Error(`Неизвестный оператор ${node.op}`);
      }
    }
    case "call": {
      const a = node.args.map((arg) => evalNode(arg, vars));
      switch (node.name) {
        case "if":
          return toBool(a[0]) ? a[1] ?? null : a[2] ?? null;
        case "round": {
          const d = a[1] != null ? toNum(a[1]) : 0;
          const f = 10 ** d;
          return Math.round(toNum(a[0]) * f) / f;
        }
        case "floor":
          return Math.floor(toNum(a[0]));
        case "ceil":
          return Math.ceil(toNum(a[0]));
        case "abs":
          return Math.abs(toNum(a[0]));
        case "min":
          return a.length ? Math.min(...a.map(toNum)) : null;
        case "max":
          return a.length ? Math.max(...a.map(toNum)) : null;
        case "sum":
          return a.reduce<number>((acc, v) => acc + toNum(v), 0);
        case "concat":
          return a.map(toStr).join("");
        case "upper":
          return toStr(a[0]).toUpperCase();
        case "lower":
          return toStr(a[0]).toLowerCase();
        case "len":
          return toStr(a[0]).length;
        case "coalesce":
          return a.find((v) => v != null && v !== "") ?? null;
        default:
          throw new Error(`Неизвестная функция '${node.name}'`);
      }
    }
  }
}

/**
 * Evaluate a formula. Returns the computed value, or throws on a parse/eval
 * error (callers should catch and show a fallback). An empty expression yields
 * null.
 */
export function evaluateFormula(expression: string, values: Record<string, unknown>): FormulaValue {
  const expr = (expression ?? "").trim();
  if (!expr) return null;
  const ast = new Parser(tokenize(expr)).parse();
  return evalNode(ast, values);
}

/**
 * Normalize a user/stored "decimal places" value into a bounded integer (0–10),
 * or null when absent/invalid. Used at every write/display boundary so the
 * integer contract holds even when a value is persisted directly via the API
 * (the generated Zod only enforces min/max, not integer-ness).
 */
export function normalizeDecimals(input: unknown): number | null {
  if (input == null || input === "") return null;
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(0, Math.round(n)));
}

/**
 * Display helper: evaluate and render the result as a string, or "—"/error.
 * When `decimals` is provided and the result is a finite number, the value is
 * rounded and shown with exactly that many decimal places. Non-numeric results
 * (text/boolean) ignore `decimals`.
 */
export function formatFormulaResult(
  expression: string,
  values: Record<string, unknown>,
  decimals?: number | null,
): { text: string; error: boolean; bool?: boolean } {
  try {
    const v = evaluateFormula(expression, values);
    if (v == null || v === "") return { text: "—", error: false };
    if (typeof v === "boolean") return { text: v ? "Да" : "Нет", error: false, bool: v };
    const d = normalizeDecimals(decimals);
    if (typeof v === "number" && d != null && Number.isFinite(v)) {
      return { text: v.toFixed(d), error: false };
    }
    return { text: String(v), error: false };
  } catch {
    return { text: "Ошибка формулы", error: true };
  }
}
