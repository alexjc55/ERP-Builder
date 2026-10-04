// Client mirror of the card-template layout contract defined server-side in
// lib/db/src/schema/card-templates.ts (cardLayoutSchema). The client never
// imports the db package; keep these shapes in sync with that zod schema.
import { parseDividerStyle, parseTextRuns, parseTextStyle, type CardDividerStyle, type CardTextStyle, type TextRuns } from "./cardBlockStyle.ts";

export type CardMode = "view" | "create" | "edit";
export const CARD_MODES: readonly CardMode[] = ["view", "create", "edit"];
export type CardML = { ru?: string; en?: string; he?: string };
export type CardBlockKind = "field" | "text" | "divider" | "relatedTable";
export type CardStyle = "standard" | "compact" | "sectioned" | "custom";
export const CARD_STYLES: readonly CardStyle[] = ["standard", "compact", "sectioned", "custom"];

export interface CardBlock {
  id: string;
  kind: CardBlockKind;
  fieldKey?: string | null;
  label?: CardML;
  text?: CardML;
  span: number;
  modes: CardMode[];
  columns: string[];
  /** Whole-block formatting for text blocks (additive, optional). */
  textStyle?: CardTextStyle;
  /** Line style for divider blocks (additive, optional). */
  dividerStyle?: CardDividerStyle;
  /** Inline formatted runs per language; concatenation equals text[lang]. */
  textRuns?: TextRuns;
}
export type RowColumns = 1 | 2 | 3;
/** Explicit row inside a section. Blocks stay canonical in `section.blocks`;
 * rows only reference them by id (each block exactly once). */
export interface CardRow { id: string; columns: RowColumns; blockIds: string[] }
export interface CardSection { id: string; title: CardML; columns: number; blocks: CardBlock[]; rows?: CardRow[] }
export interface CardTab { id: string; title: CardML; sections: CardSection[] }
export interface CardCustomStyle {
  background?: string;
  sectionBackground?: string;
  accent?: string;
  textColor?: string;
  spacing?: number;
  radius?: number;
  fontSize?: number;
  border?: boolean;
  shadow?: boolean;
}
export interface CardLayout {
  version: 1;
  style: CardStyle;
  customStyle: CardCustomStyle;
  tabs: CardTab[];
}

export const LIMITS = { tabs: 20, sections: 30, blocks: 100, columns: 30, text: 10000, rows: 100 } as const;

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clampInt = (v: unknown, min: number, max: number, def: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;

function parseML(v: unknown): CardML {
  if (!isObj(v)) return {};
  const out: CardML = {};
  for (const k of ["ru", "en", "he"] as const) if (typeof v[k] === "string") out[k] = (v[k] as string).slice(0, LIMITS.text);
  return out;
}

export function mlIsEmpty(v: CardML | undefined): boolean {
  return !v || !((v.ru ?? "").trim() || (v.en ?? "").trim() || (v.he ?? "").trim());
}

function parseBlock(v: unknown): CardBlock | null {
  if (!isObj(v) || typeof v.id !== "string" || !v.id) return null;
  const kind = v.kind;
  if (kind !== "field" && kind !== "text" && kind !== "divider" && kind !== "relatedTable") return null;
  const modes = Array.isArray(v.modes) ? (v.modes.filter(m => CARD_MODES.includes(m as CardMode)) as CardMode[]) : [];
  return {
    id: v.id,
    kind,
    fieldKey: typeof v.fieldKey === "string" && v.fieldKey ? v.fieldKey : null,
    ...(v.label !== undefined ? { label: parseML(v.label) } : {}),
    ...(v.text !== undefined ? { text: parseML(v.text) } : {}),
    span: clampInt(v.span, 1, 3, 1),
    modes: modes.length ? [...new Set(modes)] : [...CARD_MODES],
    columns: Array.isArray(v.columns) ? v.columns.filter((c): c is string => typeof c === "string").slice(0, LIMITS.columns) : [],
    ...(() => { const ts = kind === "text" ? parseTextStyle(v.textStyle) : undefined; return ts ? { textStyle: ts } : {}; })(),
    ...(() => { const tr = kind === "text" ? parseTextRuns(v.textRuns) : undefined; return tr ? { textRuns: tr } : {}; })(),
    ...(() => { const ds = kind === "divider" ? parseDividerStyle(v.dividerStyle) : undefined; return ds ? { dividerStyle: ds } : {}; })(),
  };
}

function parseCustomStyle(v: unknown): CardCustomStyle {
  if (!isObj(v)) return {};
  const out: CardCustomStyle = {};
  for (const k of ["background", "sectionBackground", "accent", "textColor"] as const) {
    const c = v[k];
    if (typeof c === "string" && HEX.test(c)) out[k] = c;
  }
  if (typeof v.spacing === "number") out.spacing = clampInt(v.spacing, 4, 32, 16);
  if (typeof v.radius === "number") out.radius = clampInt(v.radius, 0, 24, 8);
  if (typeof v.fontSize === "number") out.fontSize = clampInt(v.fontSize, 12, 20, 14);
  if (typeof v.border === "boolean") out.border = v.border;
  if (typeof v.shadow === "boolean") out.shadow = v.shadow;
  return out;
}

/** Strict row parse. `undefined` = rows absent (legacy grid); `null` = malformed
 * explicit rows (the whole layout is rejected; no repair). Rows must form an exact
 * partition of the section blocks with known, unique refs. */
function parseRows(v: unknown, blocks: CardBlock[], rowIds: Set<string>): CardRow[] | null | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > LIMITS.rows) return null;
  const ids = new Set(blocks.map(b => b.id));
  const used = new Set<string>();
  const rows: CardRow[] = [];
  for (const r of v) {
    if (!isObj(r) || typeof r.id !== "string" || !r.id || r.id.length > 100 || rowIds.has(r.id)) return null;
    if (typeof r.columns !== "number" || !Number.isInteger(r.columns) || r.columns < 1 || r.columns > 3) return null;
    if (!Array.isArray(r.blockIds)) return null;
    for (const x of r.blockIds) {
      if (typeof x !== "string" || !ids.has(x) || used.has(x)) return null;
      used.add(x);
    }
    rowIds.add(r.id);
    rows.push({ id: r.id, columns: r.columns as RowColumns, blockIds: [...(r.blockIds as string[])] });
  }
  if (used.size !== ids.size) return null;
  return rows;
}

/** Lenient parse of an untrusted layout. Returns null when the shape is unusable,
 * so runtime callers fall back to the standard form instead of breaking it. */
export function parseCardLayout(raw: unknown): CardLayout | null {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.tabs) || raw.tabs.length === 0) return null;
  const tabs: CardTab[] = [];
  const rowIds = new Set<string>();
  const nodeIds: string[] = [];
  for (const tab of raw.tabs) {
    if (!isObj(tab) || typeof tab.id !== "string" || !tab.id) return null;
    const sections: CardSection[] = [];
    for (const s of Array.isArray(tab.sections) ? tab.sections : []) {
      if (!isObj(s) || typeof s.id !== "string" || !s.id) return null;
      const blocks = (Array.isArray(s.blocks) ? s.blocks : []).map(parseBlock);
      if (blocks.some(b => b == null)) return null;
      const rows = parseRows(s.rows, blocks as CardBlock[], rowIds);
      if (rows === null) return null;
      nodeIds.push(s.id, ...(blocks as CardBlock[]).map(b => b.id));
      sections.push({ id: s.id, title: parseML(s.title), columns: clampInt(s.columns, 1, 3, 1), blocks: blocks as CardBlock[], ...(rows ? { rows } : {}) });
    }
    tabs.push({ id: tab.id, title: parseML(tab.title), sections });
    nodeIds.push(tab.id);
  }
  // Row ids must not collide with any tab/section/block id either.
  if (rowIds.size && nodeIds.some(id => rowIds.has(id))) return null;
  const style = CARD_STYLES.includes(raw.style as CardStyle) ? (raw.style as CardStyle) : "standard";
  return { version: 1, style, customStyle: parseCustomStyle(raw.customStyle), tabs };
}

export interface LayoutFieldLike { fieldKey: string; fieldType: string; isActive?: boolean; sortOrder?: number }

export function emptyLayout(): CardLayout {
  return {
    version: 1, style: "standard", customStyle: {},
    tabs: [{ id: newId("tab"), title: { ru: "Основное", en: "General", he: "כללי" }, sections: [
      { id: newId("sec"), title: {}, columns: 1, blocks: [] },
    ] }],
  };
}

export type LayoutPreset = "standard" | "compact" | "sectioned";
/** Starting layout for a new template: every active field, in field order. Each
 * section starts as ONE explicit row holding all of its fields (the row grid
 * wraps by its column count); the user adds further rows himself. */
export function presetLayout(fields: LayoutFieldLike[], preset: LayoutPreset = "standard"): CardLayout {
  const active = fields.filter(f => f.isActive !== false).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const block = (f: LayoutFieldLike): CardBlock => ({ id: newId("blk"), kind: "field", fieldKey: f.fieldKey, span: 1, modes: [...CARD_MODES], columns: [] });
  const layout = emptyLayout();
  layout.style = preset;
  const withRows = (l: CardLayout): CardLayout => {
    for (const tab of l.tabs) for (const s of tab.sections)
      s.rows = [{ id: newId("row"), columns: clampInt(s.columns, 1, 3, 1) as RowColumns, blockIds: s.blocks.map(b => b.id) }];
    return l;
  };
  const section = layout.tabs[0].sections[0];
  if (preset === "standard") { section.blocks = active.map(block); return withRows(layout); }
  if (preset === "compact") { section.columns = 2; section.blocks = active.map(block); return withRows(layout); }
  const scalars = active.filter(f => f.fieldType !== "relation" && f.fieldType !== "lookup");
  const links = active.filter(f => f.fieldType === "relation" || f.fieldType === "lookup");
  section.title = { ru: "Основные данные", en: "Details", he: "פרטים" };
  section.columns = 2;
  section.blocks = scalars.map(block);
  if (links.length) layout.tabs[0].sections.push({ id: newId("sec"), title: { ru: "Связи", en: "Relations", he: "קשרים" }, columns: 2, blocks: links.map(block) });
  return withRows(layout);
}

/** Deep clone with fresh ids for every tab/section/block (required: ids are
 * template-local, and a copy is a new template). */
export function cloneLayoutWithNewIds(layout: CardLayout): CardLayout {
  return {
    version: 1,
    style: layout.style,
    customStyle: { ...layout.customStyle },
    tabs: layout.tabs.map(tab => ({
      id: newId("tab"), title: { ...tab.title },
      sections: tab.sections.map(s => {
        const map = new Map<string, string>();
        const blocks = s.blocks.map(b => {
          const id = newId("blk");
          map.set(b.id, id);
          return { ...b, id, modes: [...b.modes], columns: [...b.columns],
            ...(b.label ? { label: { ...b.label } } : {}), ...(b.text ? { text: { ...b.text } } : {}),
            ...(b.textStyle ? { textStyle: { ...b.textStyle } } : {}), ...(b.dividerStyle ? { dividerStyle: { ...b.dividerStyle } } : {}),
            ...(b.textRuns ? { textRuns: Object.fromEntries(Object.entries(b.textRuns).map(([l, r]) => [l, (r ?? []).map(x => ({ ...x }))])) } : {}) };
        });
        const rows = s.rows?.map(r => ({ id: newId("row"), columns: r.columns, blockIds: r.blockIds.map(x => map.get(x)).filter((x): x is string => !!x) }));
        return { id: newId("sec"), title: { ...s.title }, columns: s.columns, blocks, ...(rows ? { rows } : {}) };
      }),
    })),
  };
}

/** Copy to another entity: keep tabs, sections, slots, texts, dividers and style;
 * drop every entity-specific binding so slots become empty placeholders. */
export function clearBindings(layout: CardLayout): CardLayout {
  return {
    ...layout,
    tabs: layout.tabs.map(tab => ({
      ...tab,
      sections: tab.sections.map(s => ({
        ...s,
        blocks: s.blocks.map(b => (b.kind === "field" || b.kind === "relatedTable") ? { ...b, fieldKey: null, columns: [] } : b),
      })),
    })),
  };
}

export function copyLayout(layout: CardLayout, sameEntity: boolean): CardLayout {
  const cloned = cloneLayoutWithNewIds(layout);
  return sameEntity ? cloned : clearBindings(cloned);
}

/** Stale bindings (field no longer in the entity metadata) become blanks. Call
 * only with LOADED metadata; returns the same object when nothing changed. */
export function normalizeUnknownBindings(layout: CardLayout, fields: LayoutFieldLike[]): CardLayout {
  const known = new Set(fields.map(f => f.fieldKey));
  let changed = false;
  const tabs = layout.tabs.map(tab => ({ ...tab, sections: tab.sections.map(s => ({ ...s, blocks: s.blocks.map(b => {
    if ((b.kind === "field" || b.kind === "relatedTable") && b.fieldKey && !known.has(b.fieldKey)) { changed = true; return { ...b, fieldKey: null, columns: [] }; }
    return b;
  }) })) }));
  return changed ? { ...layout, tabs } : layout;
}

export function boundFieldKeys(layout: CardLayout): Set<string> {
  const keys = new Set<string>();
  for (const tab of layout.tabs) for (const s of tab.sections) for (const b of s.blocks)
    if ((b.kind === "field" || b.kind === "relatedTable") && b.fieldKey) keys.add(b.fieldKey);
  return keys;
}

export interface LayoutIssue { kind: "duplicate" | "rowInvalid"; fieldKey?: string; blockId?: string }
/** Client-side pre-publish hints. The server remains authoritative. Unbound or
 * unknown field slots are intentional blanks (layout spacers), never issues;
 * required-field coverage is enforced by the record form, not the card. */
export function layoutIssues(layout: CardLayout, fields: LayoutFieldLike[]): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const known = new Set(fields.map(f => f.fieldKey));
  const seen = new Map<string, number>();
  for (const tab of layout.tabs) for (const s of tab.sections) for (const b of s.blocks) {
    if (b.kind !== "field" && b.kind !== "relatedTable") continue;
    if (!b.fieldKey || !known.has(b.fieldKey)) continue;
    seen.set(b.fieldKey, (seen.get(b.fieldKey) ?? 0) + 1);
  }
  const rowIds = new Set<string>();
  for (const tab of layout.tabs) for (const s of tab.sections) {
    if (!s.rows) continue;
    const ids = new Set(s.blocks.map(b => b.id));
    const refs = s.rows.flatMap(r => r.blockIds);
    let bad = s.rows.length > LIMITS.rows || refs.length !== ids.size || new Set(refs).size !== refs.length || refs.some(x => !ids.has(x));
    for (const r of s.rows) { if (rowIds.has(r.id)) bad = true; rowIds.add(r.id); }
    if (bad) issues.push({ kind: "rowInvalid" });
  }
  for (const [k, n] of seen) if (n > 1) issues.push({ kind: "duplicate", fieldKey: k });
  return issues;
}

// ---- Immutable editing helpers ------------------------------------------------

export type BlockLocation = { tabId: string; sectionId: string; index: number };

export function findBlock(layout: CardLayout, blockId: string): (BlockLocation & { block: CardBlock }) | null {
  for (const tab of layout.tabs) for (const s of tab.sections) {
    const index = s.blocks.findIndex(b => b.id === blockId);
    if (index >= 0) return { tabId: tab.id, sectionId: s.id, index, block: s.blocks[index] };
  }
  return null;
}

function mapSection(layout: CardLayout, sectionId: string, fn: (s: CardSection) => CardSection): CardLayout {
  return { ...layout, tabs: layout.tabs.map(tab => ({ ...tab, sections: tab.sections.map(s => s.id === sectionId ? fn(s) : s) })) };
}

/** Reorder canonical blocks to follow row order (rows are the visual truth). */
function syncBlocks(s: CardSection): CardSection {
  if (!s.rows) return s;
  const by = new Map(s.blocks.map(b => [b.id, b]));
  const blocks = s.rows.flatMap(r => r.blockIds.map(id => by.get(id)).filter((b): b is CardBlock => !!b));
  return { ...s, blocks };
}

/** Insert by flat block index. In a rowed section the block joins the row of the
 * block currently at `index` (before it), else the last row. */
export function insertBlock(layout: CardLayout, sectionId: string, index: number, block: CardBlock): CardLayout {
  return mapSection(layout, sectionId, s => {
    const blocks = [...s.blocks];
    const at = Math.max(0, Math.min(index, blocks.length));
    if (!s.rows) { blocks.splice(at, 0, block); return { ...s, blocks }; }
    const rows = s.rows.map(r => ({ ...r, blockIds: [...r.blockIds] }));
    const anchor = blocks[at]?.id;
    const row = anchor ? rows.find(r => r.blockIds.includes(anchor)) : undefined;
    if (row) row.blockIds.splice(row.blockIds.indexOf(anchor!), 0, block.id);
    else if (rows.length) rows[rows.length - 1].blockIds.push(block.id);
    else rows.push({ id: newId("row"), columns: clampInt(s.columns, 1, 3, 1) as RowColumns, blockIds: [block.id] });
    return syncBlocks({ ...s, rows, blocks: [...blocks, block] });
  });
}

export function removeBlock(layout: CardLayout, blockId: string): CardLayout {
  return { ...layout, tabs: layout.tabs.map(tab => ({ ...tab, sections: tab.sections.map(s => ({
    ...s, blocks: s.blocks.filter(b => b.id !== blockId),
    ...(s.rows ? { rows: s.rows.map(r => r.blockIds.includes(blockId) ? { ...r, blockIds: r.blockIds.filter(x => x !== blockId) } : r) } : {}),
  })) })) };
}

// ---- Rows -------------------------------------------------------------------

export function findSection(layout: CardLayout, sectionId: string): CardSection | undefined {
  for (const tab of layout.tabs) for (const s of tab.sections) if (s.id === sectionId) return s;
  return undefined;
}

/** Pack a legacy implicit grid into explicit rows exactly as CSS grid would
 * place them (non-dense, sequential), so the rendered layout is unchanged. */
export function packRows(section: CardSection): CardRow[] {
  const cols = clampInt(section.columns, 1, 3, 1) as RowColumns;
  const rows: CardRow[] = [];
  let cur: CardRow | null = null;
  let used = 0;
  for (const b of section.blocks) {
    const span = Math.min(cols, Math.max(1, b.span));
    if (!cur || used + span > cols) { cur = { id: newId("row"), columns: cols, blockIds: [] }; rows.push(cur); used = 0; }
    cur.blockIds.push(b.id);
    used += span;
  }
  if (!rows.length) rows.push({ id: newId("row"), columns: cols, blockIds: [] });
  return rows.slice(0, LIMITS.rows);
}

export function convertSectionToRows(layout: CardLayout, sectionId: string): CardLayout {
  return mapSection(layout, sectionId, s => s.rows ? s : { ...s, rows: packRows(s) });
}

export function findRowOf(layout: CardLayout, blockId: string): { sectionId: string; rowId: string; rowIndex: number; rowCount: number; index: number } | null {
  for (const tab of layout.tabs) for (const s of tab.sections) {
    if (!s.rows) continue;
    const rowIndex = s.rows.findIndex(r => r.blockIds.includes(blockId));
    if (rowIndex >= 0) return { sectionId: s.id, rowId: s.rows[rowIndex].id, rowIndex, rowCount: s.rows.length, index: s.rows[rowIndex].blockIds.indexOf(blockId) };
  }
  return null;
}

export function addRow(layout: CardLayout, sectionId: string, columns: RowColumns = 2, at?: number): CardLayout {
  return mapSection(convertSectionToRows(layout, sectionId), sectionId, s => {
    const rows = [...(s.rows ?? [])];
    if (rows.length >= LIMITS.rows) return s;
    rows.splice(at == null ? rows.length : Math.max(0, Math.min(at, rows.length)), 0, { id: newId("row"), columns, blockIds: [] });
    return { ...s, rows };
  });
}

export function setRowColumns(layout: CardLayout, sectionId: string, rowId: string, columns: RowColumns): CardLayout {
  return mapSection(layout, sectionId, s => ({ ...s, rows: s.rows?.map(r => r.id === rowId ? { ...r, columns } : r) }));
}

export function moveRow(layout: CardLayout, sectionId: string, rowId: string, delta: number): CardLayout {
  return mapSection(layout, sectionId, s => {
    if (!s.rows) return s;
    return syncBlocks({ ...s, rows: moveItem(s.rows, s.rows.findIndex(r => r.id === rowId), delta) });
  });
}

/** Delete a row without dropping fields: its blocks move to the end of the row
 * above (or the start of the row below for the first row). A populated row with
 * no neighbour is kept unchanged; callers disable that action. */
export function removeRow(layout: CardLayout, sectionId: string, rowId: string): CardLayout {
  return mapSection(layout, sectionId, s => {
    if (!s.rows) return s;
    const i = s.rows.findIndex(r => r.id === rowId);
    if (i < 0) return s;
    const row = s.rows[i];
    if (row.blockIds.length && s.rows.length === 1) return s;
    const rows = s.rows.map(r => ({ ...r, blockIds: [...r.blockIds] }));
    if (row.blockIds.length) {
      if (i > 0) rows[i - 1].blockIds.push(...row.blockIds);
      else rows[1].blockIds.unshift(...row.blockIds);
    }
    rows.splice(i, 1);
    return syncBlocks({ ...s, rows });
  });
}

/** Move a block into a row at `index` (index measured BEFORE removal). Legacy
 * target sections are converted to rows first. */
export function moveBlockToRow(layout: CardLayout, blockId: string, sectionId: string, rowId: string, index: number): CardLayout {
  const from = findBlock(layout, blockId);
  if (!from) return layout;
  const fromRow = findRowOf(layout, blockId);
  let target = index;
  if (fromRow && fromRow.rowId === rowId && fromRow.index < index) target -= 1;
  return insertBlockInRow(removeBlock(layout, blockId), sectionId, rowId, target, from.block);
}

export function insertBlockInRow(layout: CardLayout, sectionId: string, rowId: string, index: number, block: CardBlock): CardLayout {
  return mapSection(convertSectionToRows(layout, sectionId), sectionId, s => {
    const rows = (s.rows ?? []).map(r => ({ ...r, blockIds: [...r.blockIds] }));
    const row = rows.find(r => r.id === rowId) ?? rows[rows.length - 1];
    if (!row) return s;
    row.blockIds.splice(Math.max(0, Math.min(index, row.blockIds.length)), 0, block.id);
    return syncBlocks({ ...s, rows, blocks: [...s.blocks, block] });
  });
}

/** Accessible alternative to DnD: move a block to the previous/next row. At the
 * edge a new row with the same column count is created. */
export function moveBlockAcrossRows(layout: CardLayout, blockId: string, delta: -1 | 1): CardLayout {
  const loc = findRowOf(layout, blockId);
  if (!loc) return layout;
  const s = findSection(layout, loc.sectionId)!;
  const rows = s.rows!;
  const targetIndex = loc.rowIndex + delta;
  if (targetIndex < 0 || targetIndex >= rows.length) {
    if (rows.length >= LIMITS.rows || (rows[loc.rowIndex].blockIds.length === 1)) return layout;
    const withRow = addRow(layout, loc.sectionId, rows[loc.rowIndex].columns, delta < 0 ? 0 : rows.length);
    const ns = findSection(withRow, loc.sectionId)!;
    const nr = ns.rows![delta < 0 ? 0 : ns.rows!.length - 1];
    return moveBlockToRow(withRow, blockId, loc.sectionId, nr.id, 0);
  }
  const target = rows[targetIndex];
  return moveBlockToRow(layout, blockId, loc.sectionId, target.id, delta < 0 ? target.blockIds.length : 0);
}

export function updateBlock(layout: CardLayout, blockId: string, patch: Partial<CardBlock>): CardLayout {
  return { ...layout, tabs: layout.tabs.map(tab => ({ ...tab, sections: tab.sections.map(s => ({ ...s, blocks: s.blocks.map(b => b.id === blockId ? { ...b, ...patch } : b) })) })) };
}

/** Move a block to (sectionId, index). The index is interpreted in the target
 * section BEFORE removal, so dropping "before block X" works in one section too. */
export function moveBlock(layout: CardLayout, blockId: string, sectionId: string, index: number): CardLayout {
  const from = findBlock(layout, blockId);
  if (!from) return layout;
  let target = index;
  if (from.sectionId === sectionId && from.index < index) target -= 1;
  return insertBlock(removeBlock(layout, blockId), sectionId, target, from.block);
}

export function makeBlock(kind: CardBlockKind, fieldKey: string | null = null): CardBlock {
  return {
    id: newId("blk"), kind, fieldKey: kind === "field" || kind === "relatedTable" ? fieldKey : null,
    span: kind === "divider" || kind === "relatedTable" ? 3 : 1,
    modes: [...CARD_MODES], columns: [],
    ...(kind === "text" ? { text: {} } : {}),
  };
}

export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

/** Inline CSS variables for the runtime card. Standard (and custom with nothing
 * changed) yields no overrides so the existing ERP look stays identical. */
export function cardStyleVars(layout: CardLayout): Record<string, string> {
  if (layout.style !== "custom") return {};
  const c = layout.customStyle;
  const vars: Record<string, string> = {};
  if (c.background) vars["--card-bg"] = c.background;
  if (c.sectionBackground) vars["--card-section-bg"] = c.sectionBackground;
  if (c.accent) vars["--card-accent"] = c.accent;
  if (c.textColor) vars["--card-text"] = c.textColor;
  if (c.spacing != null) vars["--card-gap"] = `${c.spacing}px`;
  if (c.radius != null) vars["--card-radius"] = `${c.radius}px`;
  if (c.fontSize != null) vars["--card-font"] = `${c.fontSize}px`;
  return vars;
}

export function layoutIsWide(layout: CardLayout | null | undefined): boolean {
  return !!layout?.tabs.some(t => t.sections.some(s => s.rows ? s.rows.some(r => r.columns > 1) : s.columns > 1));
}

/** Columns available to a block: its explicit row's columns, else the legacy
 * section.columns, clamped 1..3. */
export function blockColumnLimit(layout: CardLayout, blockId: string): number {
  for (const tab of layout.tabs) for (const s of tab.sections) {
    if (!s.blocks.some(b => b.id === blockId)) continue;
    const row = s.rows?.find(r => r.blockIds.includes(blockId));
    return Math.min(3, Math.max(1, row ? row.columns : s.columns));
  }
  return 1;
}
/** Span actually rendered (desktop); phones are always one column. */
export const effectiveSpan = (span: number, columns: number) => Math.min(Math.min(3, Math.max(1, columns)), Math.max(1, Math.round(span)));
export const spanChoices = (columns: number) => [1, 2, 3].map(n => ({ n, available: n <= Math.min(3, Math.max(1, columns)) }));
