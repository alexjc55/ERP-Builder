// Client mirror of the card-template layout contract defined server-side in
// lib/db/src/schema/card-templates.ts (cardLayoutSchema). The client never
// imports the db package; keep these shapes in sync with that zod schema.

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
}
export interface CardSection { id: string; title: CardML; columns: number; blocks: CardBlock[] }
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

export const LIMITS = { tabs: 20, sections: 30, blocks: 100, columns: 30, text: 10000 } as const;

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

/** Lenient parse of an untrusted layout. Returns null when the shape is unusable,
 * so runtime callers fall back to the standard form instead of breaking it. */
export function parseCardLayout(raw: unknown): CardLayout | null {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.tabs) || raw.tabs.length === 0) return null;
  const tabs: CardTab[] = [];
  for (const tab of raw.tabs) {
    if (!isObj(tab) || typeof tab.id !== "string" || !tab.id) return null;
    const sections: CardSection[] = [];
    for (const s of Array.isArray(tab.sections) ? tab.sections : []) {
      if (!isObj(s) || typeof s.id !== "string" || !s.id) return null;
      const blocks = (Array.isArray(s.blocks) ? s.blocks : []).map(parseBlock);
      if (blocks.some(b => b == null)) return null;
      sections.push({ id: s.id, title: parseML(s.title), columns: clampInt(s.columns, 1, 3, 1), blocks: blocks as CardBlock[] });
    }
    tabs.push({ id: tab.id, title: parseML(tab.title), sections });
  }
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
/** Starting layout for a new template: every active field, in field order. The
 * "standard" preset reproduces the existing single-column ERP form exactly. */
export function presetLayout(fields: LayoutFieldLike[], preset: LayoutPreset = "standard"): CardLayout {
  const active = fields.filter(f => f.isActive !== false).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const block = (f: LayoutFieldLike): CardBlock => ({ id: newId("blk"), kind: "field", fieldKey: f.fieldKey, span: 1, modes: [...CARD_MODES], columns: [] });
  const layout = emptyLayout();
  layout.style = preset;
  const section = layout.tabs[0].sections[0];
  if (preset === "standard") { section.blocks = active.map(block); return layout; }
  if (preset === "compact") { section.columns = 2; section.blocks = active.map(block); return layout; }
  const scalars = active.filter(f => f.fieldType !== "relation" && f.fieldType !== "lookup");
  const links = active.filter(f => f.fieldType === "relation" || f.fieldType === "lookup");
  section.title = { ru: "Основные данные", en: "Details", he: "פרטים" };
  section.columns = 2;
  section.blocks = scalars.map(block);
  if (links.length) layout.tabs[0].sections.push({ id: newId("sec"), title: { ru: "Связи", en: "Relations", he: "קשרים" }, columns: 2, blocks: links.map(block) });
  return layout;
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
      sections: tab.sections.map(s => ({
        id: newId("sec"), title: { ...s.title }, columns: s.columns,
        blocks: s.blocks.map(b => ({ ...b, id: newId("blk"), modes: [...b.modes], columns: [...b.columns],
          ...(b.label ? { label: { ...b.label } } : {}), ...(b.text ? { text: { ...b.text } } : {}) })),
      })),
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

export function boundFieldKeys(layout: CardLayout): Set<string> {
  const keys = new Set<string>();
  for (const tab of layout.tabs) for (const s of tab.sections) for (const b of s.blocks)
    if ((b.kind === "field" || b.kind === "relatedTable") && b.fieldKey) keys.add(b.fieldKey);
  return keys;
}

export interface LayoutIssue { kind: "emptySlot" | "unknownField" | "duplicate" | "requiredMissing"; fieldKey?: string; blockId?: string }
/** Client-side pre-publish hints. The server remains authoritative. */
export function layoutIssues(layout: CardLayout, fields: (LayoutFieldLike & { isRequired?: boolean })[]): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const known = new Set(fields.map(f => f.fieldKey));
  const seen = new Map<string, number>();
  const createKeys = new Set<string>();
  for (const tab of layout.tabs) for (const s of tab.sections) for (const b of s.blocks) {
    if (b.kind !== "field" && b.kind !== "relatedTable") continue;
    if (!b.fieldKey) { issues.push({ kind: "emptySlot", blockId: b.id }); continue; }
    if (!known.has(b.fieldKey)) issues.push({ kind: "unknownField", fieldKey: b.fieldKey, blockId: b.id });
    seen.set(b.fieldKey, (seen.get(b.fieldKey) ?? 0) + 1);
    if (b.modes.includes("create")) createKeys.add(b.fieldKey);
  }
  for (const [k, n] of seen) if (n > 1) issues.push({ kind: "duplicate", fieldKey: k });
  for (const f of fields) if (f.isRequired && f.isActive !== false && !createKeys.has(f.fieldKey)) issues.push({ kind: "requiredMissing", fieldKey: f.fieldKey });
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

export function insertBlock(layout: CardLayout, sectionId: string, index: number, block: CardBlock): CardLayout {
  return mapSection(layout, sectionId, s => {
    const blocks = [...s.blocks];
    blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, block);
    return { ...s, blocks };
  });
}

export function removeBlock(layout: CardLayout, blockId: string): CardLayout {
  return { ...layout, tabs: layout.tabs.map(tab => ({ ...tab, sections: tab.sections.map(s => ({ ...s, blocks: s.blocks.filter(b => b.id !== blockId) })) })) };
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
  return !!layout?.tabs.some(t => t.sections.some(s => s.columns > 1));
}
