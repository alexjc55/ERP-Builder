// Formatting contract for card text/divider blocks. Mirrors the server zod
// schema (textStyle / dividerStyle on a card block). Pure: no React, no imports,
// so node unit tests can load it directly.

export type TextDirection = "auto" | "ltr" | "rtl";
export type TextAlign = "start" | "center" | "end" | "left" | "right" | "justify";
export interface CardTextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  direction?: TextDirection;
  align?: TextAlign;
  link?: string;
}
export type DividerKind = "space" | "solid" | "dashed" | "dotted";
export interface CardDividerStyle {
  kind?: DividerKind;
  thickness?: number;
  color?: string;
  /** Height in px of an empty `space` divider (0..400, default 16). */
  height?: number;
}

export const TEXT_DIRECTIONS: readonly TextDirection[] = ["auto", "ltr", "rtl"];
export const TEXT_ALIGNS: readonly TextAlign[] = ["start", "center", "end", "justify"];
export const DIVIDER_KINDS: readonly DividerKind[] = ["solid", "dashed", "dotted", "space"];
export const LINK_MAX = 2048;
export const SPACE_MAX = 400;
export const SPACE_DEFAULT = 16;
export const RUNS_MAX = 500;
export const RUNS_TEXT_MAX = 10000;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ALL_ALIGNS: readonly TextAlign[] = ["start", "center", "end", "left", "right", "justify"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Returns the normalized URL when it is an absolute http(s) or mailto link,
 * otherwise null. Rejects protocol-relative, javascript:, data:, relative and
 * whitespace/control-character smuggling. */
export function sanitizeLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw;
  if (!v || v.length > LINK_MAX) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f]/.test(v)) return null;
  // Same-page anchor: "#section". Stays in the tab, no target=_blank.
  if (v[0] === "#") return /^#[A-Za-z0-9][A-Za-z0-9\-_.:]{0,254}$/.test(v) ? v : null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol === "http:" || u.protocol === "https:") return /^https?:\/\//i.test(v) && u.hostname ? v : null;
  if (u.protocol === "mailto:") return u.pathname.includes("@") ? v : null;
  return null;
}
export const isWebLink = (url: string) => /^https?:/i.test(url);

export function parseTextStyle(v: unknown): CardTextStyle | undefined {
  if (!isObj(v)) return undefined;
  const out: CardTextStyle = {};
  for (const k of ["bold", "italic", "underline"] as const) if (typeof v[k] === "boolean") out[k] = v[k] as boolean;
  if (typeof v.color === "string" && HEX.test(v.color)) out.color = v.color;
  if (TEXT_DIRECTIONS.includes(v.direction as TextDirection)) out.direction = v.direction as TextDirection;
  if (ALL_ALIGNS.includes(v.align as TextAlign)) out.align = v.align as TextAlign;
  // Runtime: keep the raw string so the editor can show it; rendering sanitizes.
  if (typeof v.link === "string" && v.link) out.link = v.link.slice(0, LINK_MAX);
  return out;
}

export function parseDividerStyle(v: unknown): CardDividerStyle | undefined {
  if (!isObj(v)) return undefined;
  const out: CardDividerStyle = {};
  if (["space", "solid", "dashed", "dotted"].includes(v.kind as string)) out.kind = v.kind as DividerKind;
  if (typeof v.thickness === "number" && Number.isFinite(v.thickness)) out.thickness = Math.min(12, Math.max(1, Math.round(v.thickness)));
  if (typeof v.color === "string" && HEX.test(v.color)) out.color = v.color;
  if (typeof v.height === "number" && Number.isFinite(v.height)) out.height = Math.min(SPACE_MAX, Math.max(0, Math.round(v.height)));
  return out;
}

/** Drop undefined/false-default keys; returns undefined when nothing is set so
 * untouched blocks keep their legacy shape byte-for-byte. */
export function compactStyle<T extends object>(s: T | undefined): T | undefined {
  if (!s) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(s)) if (val !== undefined && val !== "" && val !== false) out[k] = val;
  return Object.keys(out).length ? (out as T) : undefined;
}

export interface TextRenderProps {
  style: Record<string, string | number>;
  dir?: "ltr" | "rtl" | "auto";
  href: string | null;
  external: boolean;
}
/** Shared by editor canvas, runtime card and preview so all three match. */
export function textRenderProps(s: CardTextStyle | undefined): TextRenderProps {
  const style: Record<string, string | number> = {
    textAlign: s?.align ?? "start",
    color: s?.color ?? "var(--card-text, #475569)",
  };
  if (s?.bold) style.fontWeight = 600;
  if (s?.italic) style.fontStyle = "italic";
  if (s?.underline) style.textDecoration = "underline";
  const href = s?.link ? sanitizeLink(s.link) : null;
  return { style, dir: s?.direction, href, external: !!href && isWebLink(href) };
}

export interface DividerRenderProps { kind: DividerKind; thickness: number; color: string; height: number }
export function dividerRenderProps(s: CardDividerStyle | undefined): DividerRenderProps {
  const thickness = s?.thickness ?? 1;
  const kind = s?.kind ?? "solid";
  if (kind === "space") return { kind, thickness, color: s?.color ?? "#e2e8f0", height: Math.min(SPACE_MAX, Math.max(0, Math.round(s?.height ?? SPACE_DEFAULT))) };
  return { kind, thickness, color: s?.color ?? "#e2e8f0", height: Math.max(16, thickness + 12) };
}

// ---------------------------------------------------------------------------
// Inline rich text: structured runs per language. Never HTML. `text[lang]`
// stays the plain fallback and must equal the concatenation of the runs.
export type RunLang = "ru" | "en" | "he";
export const RUN_LANGS: readonly RunLang[] = ["ru", "en", "he"];
export interface TextRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string; link?: string }
export type TextRuns = Partial<Record<RunLang, TextRun[]>>;
/** Patch for a selected range. `false` / "" removes the mark. */
export interface RunMarksPatch { bold?: boolean; italic?: boolean; underline?: boolean; color?: string | false; link?: string | false }

function parseRun(v: unknown): TextRun | null {
  if (!isObj(v) || typeof v.text !== "string") return null;
  const r: TextRun = { text: v.text };
  for (const k of ["bold", "italic", "underline"] as const) if (v[k] === true) r[k] = true;
  if (typeof v.color === "string" && HEX.test(v.color)) r.color = v.color;
  if (typeof v.link === "string" && v.link) r.link = v.link.slice(0, LINK_MAX);
  return r;
}
export function parseTextRuns(v: unknown): TextRuns | undefined {
  if (!isObj(v)) return undefined;
  const out: TextRuns = {};
  for (const l of RUN_LANGS) {
    const arr = v[l];
    if (!Array.isArray(arr)) continue;
    out[l] = normalizeRuns(arr.slice(0, RUNS_MAX).map(parseRun).filter((r): r is TextRun => !!r));
  }
  return Object.keys(out).length ? out : undefined;
}
export const runsText = (runs: readonly TextRun[]) => runs.map(r => r.text).join("");
const sameMarks = (a: TextRun, b: TextRun) => !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline && (a.color ?? "") === (b.color ?? "") && (a.link ?? "") === (b.link ?? "");
function cleanRun(r: TextRun): TextRun {
  const o: TextRun = { text: r.text };
  if (r.bold) o.bold = true; if (r.italic) o.italic = true; if (r.underline) o.underline = true;
  if (r.color) o.color = r.color; if (r.link) o.link = r.link;
  return o;
}
/** Drops empty runs, strips false marks, merges adjacent equal runs. */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r0 of runs) {
    if (!r0.text) continue;
    const r = cleanRun(r0);
    const last = out[out.length - 1];
    if (last && sameMarks(last, r)) out[out.length - 1] = { ...last, text: last.text + r.text };
    else out.push(r);
  }
  return out;
}
function splitAt(runs: readonly TextRun[], pos: number): TextRun[] {
  const out: TextRun[] = []; let i = 0;
  for (const r of runs) {
    const end = i + r.text.length;
    if (pos > i && pos < end) { out.push({ ...r, text: r.text.slice(0, pos - i) }, { ...r, text: r.text.slice(pos - i) }); }
    else out.push({ ...r });
    i = end;
  }
  return out;
}
/** Applies marks to [start,end) only; neighbours keep their formatting. */
export function applyMarks(runs: readonly TextRun[], start: number, end: number, patch: RunMarksPatch): TextRun[] {
  const a = Math.max(0, Math.min(start, end)), b = Math.max(start, end);
  if (a === b) return normalizeRuns(runs);
  const parts = splitAt(splitAt(runs, a), b);
  let i = 0;
  const next = parts.map(r => {
    const s0 = i; i += r.text.length;
    if (s0 < a || s0 >= b) return r;
    const n: TextRun = { ...r };
    for (const k of ["bold", "italic", "underline"] as const) if (patch[k] !== undefined) n[k] = patch[k] || undefined;
    if (patch.color !== undefined) n.color = patch.color || undefined;
    if (patch.link !== undefined) n.link = patch.link || undefined;
    return n;
  });
  return normalizeRuns(next);
}
export const clearMarks = (runs: readonly TextRun[], start: number, end: number) =>
  applyMarks(runs, start, end, { bold: false, italic: false, underline: false, color: false, link: false });

/** Marks shared by every character of the range (collapsed: char before caret). */
export function marksIn(runs: readonly TextRun[], start: number, end: number): TextRun {
  let a = Math.min(start, end), b = Math.max(start, end);
  if (a === b) { if (a === 0) b = 1; else a -= 1; }
  let i = 0; let acc: TextRun | null = null;
  for (const r of runs) {
    const s0 = i, e0 = i + r.text.length; i = e0;
    if (e0 <= a || s0 >= b) continue;
    if (!acc) { acc = cleanRun(r); continue; }
    if (!r.bold) delete acc.bold; if (!r.italic) delete acc.italic; if (!r.underline) delete acc.underline;
    if (acc.color !== r.color) delete acc.color; if (acc.link !== r.link) delete acc.link;
  }
  return { ...(acc ?? {}), text: "" };
}
/** Keeps runs in sync with a plain-text edit: the changed middle is replaced
 * and inserted text inherits the marks of the character before it. */
export function spliceRuns(runs: readonly TextRun[], next: string, caret?: number): TextRun[] {
  const prev = runsText(runs);
  if (prev === next) return normalizeRuns(runs);
  // The caret (end of the edit in the new text) disambiguates repeated chars.
  const pMax = caret == null ? Infinity : caret;
  const sMax = caret == null ? Infinity : next.length - caret;
  let p = 0; const max = Math.min(prev.length, next.length);
  while (p < max && p < pMax && prev[p] === next[p]) p++;
  let sfx = 0;
  while (sfx < max - p && sfx < sMax && prev[prev.length - 1 - sfx] === next[next.length - 1 - sfx]) sfx++;
  const delEnd = prev.length - sfx;
  const inserted = next.slice(p, next.length - sfx);
  const parts = splitAt(splitAt(runs, p), delEnd);
  const before: TextRun[] = [], after: TextRun[] = []; let i = 0;
  for (const r of parts) { const s0 = i; i += r.text.length; if (s0 < p) before.push(r); else if (s0 >= delEnd) after.push(r); }
  const tmpl = before[before.length - 1] ?? after[0] ?? { text: "" };
  const ins = inserted ? [{ ...cleanRun(tmpl), text: inserted }] : [];
  return normalizeRuns([...before, ...ins, ...after]);
}
type MLText = Partial<Record<RunLang, string>>;
/** Runs to render for one language: stored runs when in sync with the plain
 * text, otherwise the plain text (stale/missing runs never lose content). */
export function effectiveRuns(text: MLText | undefined, runs: TextRuns | undefined, lang: RunLang, legacy?: CardTextStyle): TextRun[] {
  const plain = text?.[lang] ?? "";
  const r = runs?.[lang];
  if (r && runsText(r) === plain) return normalizeRuns(r);
  if (!plain) return [];
  return normalizeRuns([{ text: plain, bold: legacy?.bold, italic: legacy?.italic, underline: legacy?.underline, color: legacy?.color, link: legacy?.link }]);
}
/** Converts legacy whole-block inline marks into runs for every language and
 * strips them from textStyle (direction/alignment stay paragraph-level). */
export function migrateLegacyText(text: MLText | undefined, runs: TextRuns | undefined, style: CardTextStyle | undefined): { textRuns: TextRuns; textStyle: CardTextStyle | undefined } {
  const legacy = runs ? undefined : style;
  const textRuns: TextRuns = {};
  for (const l of RUN_LANGS) { const r = effectiveRuns(text, runs, l, legacy); if (r.length || runs?.[l]) textRuns[l] = r; }
  const textStyle = compactStyle<CardTextStyle>({ direction: style?.direction, align: style?.align });
  return { textRuns, textStyle };
}
/** Inline CSS for one run (color falls back to the paragraph color). */
export function runStyle(r: TextRun): Record<string, string | number> {
  const st: Record<string, string | number> = {};
  if (r.bold) st.fontWeight = 600;
  if (r.italic) st.fontStyle = "italic";
  if (r.underline) st.textDecoration = "underline";
  if (r.color) st.color = r.color;
  return st;
}

export interface StyleIssue { blockId: string; kind: "invalidLink" | "invalidColor" | "tooManyRuns" | "textTooLong" }
interface BlockLike { id: string; kind: string; textStyle?: CardTextStyle; dividerStyle?: CardDividerStyle; textRuns?: TextRuns }
/** Pre-save/publish validation. A link that would be rejected must block the
 * save with a visible error instead of being silently dropped. */
export function blockStyleIssues(layout: { tabs: { sections: { blocks: BlockLike[] }[] }[] }): StyleIssue[] {
  const out: StyleIssue[] = [];
  for (const tab of layout.tabs) for (const s of tab.sections) for (const b of s.blocks) {
    const ts = b.textStyle;
    if (ts?.link && !sanitizeLink(ts.link)) out.push({ blockId: b.id, kind: "invalidLink" });
    if (ts?.color && !HEX.test(ts.color)) out.push({ blockId: b.id, kind: "invalidColor" });
    if (b.dividerStyle?.color && !HEX.test(b.dividerStyle.color)) out.push({ blockId: b.id, kind: "invalidColor" });
    for (const l of RUN_LANGS) {
      const runs = b.textRuns?.[l];
      if (!runs) continue;
      if (runs.length > RUNS_MAX) out.push({ blockId: b.id, kind: "tooManyRuns" });
      if (runsText(runs).length > RUNS_TEXT_MAX) out.push({ blockId: b.id, kind: "textTooLong" });
      if (runs.some(r => r.link && !sanitizeLink(r.link))) out.push({ blockId: b.id, kind: "invalidLink" });
      if (runs.some(r => r.color && !HEX.test(r.color))) out.push({ blockId: b.id, kind: "invalidColor" });
    }
  }
  return out;
}
