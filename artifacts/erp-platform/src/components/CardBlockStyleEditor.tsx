import { useState } from "react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Eraser, Italic, Link2, Unlink, Underline } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPickerControl } from "@/components/ColorPickerControl";
import { RichRunsEditable } from "@/components/RichRunsEditable";
import { useLang, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  DIVIDER_KINDS, RUN_LANGS, RUNS_TEXT_MAX, SPACE_DEFAULT, SPACE_MAX, TEXT_DIRECTIONS, applyMarks, clearMarks, compactStyle, effectiveRuns,
  marksIn, migrateLegacyText, sanitizeLink, spliceRuns,
  type CardDividerStyle, type CardTextStyle, type DividerKind, type RunLang, type RunMarksPatch, type TextAlign, type TextDirection,
} from "@/lib/cardBlockStyle";
import type { CardBlock } from "@/lib/cardLayout";

const toggleCls = (on: boolean) => cn(
  "flex h-8 min-w-8 items-center justify-center rounded border px-2 text-xs font-medium transition-colors disabled:opacity-40",
  on ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300",
);
const keep = (e: { preventDefault: () => void }) => e.preventDefault(); // keep editor selection

/** Text block editor: WYSIWYG contenteditable per language + selection toolbar that
 * formats only the selected characters (structured runs, never HTML).
 * Direction and alignment stay paragraph-level controls. */
export function TextStyleEditor({ block, readOnly, onPatch }: { block: CardBlock; readOnly: boolean; onPatch: (p: Partial<CardBlock>) => void }) {
  const t = useT();
  const { lang: uiLang } = useLang();
  const [lang, setLang] = useState<RunLang>(RUN_LANGS.includes(uiLang as RunLang) ? (uiLang as RunLang) : "ru");
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [linkDraft, setLinkDraft] = useState("");
  const s = block.textStyle ?? {};
  const text = (block.text ?? {}) as Partial<Record<RunLang, string>>;
  const value = text[lang] ?? "";
  // Legacy whole-block inline styles are shown as runs and migrated on first edit.
  const legacy = block.textRuns ? undefined : s;
  const runs = effectiveRuns(text, block.textRuns, lang, legacy);
  const hasSel = sel.end > sel.start && sel.end <= value.length;
  const active = hasSel ? marksIn(runs, sel.start, sel.end) : { text: "" };
  const linkInvalid = !!linkDraft && !sanitizeLink(linkDraft);

  const migrated = () => migrateLegacyText(text, block.textRuns, block.textStyle);
  const onText = (next: string, caret?: number) => {
    const m = migrated();
    const cur = effectiveRuns(text, m.textRuns, lang);
    onPatch({ text: { ...text, [lang]: next }, textRuns: { ...m.textRuns, [lang]: spliceRuns(cur, next, caret) }, textStyle: m.textStyle });
  };
  const mark = (patch: RunMarksPatch | "clear") => {
    if (!hasSel) return;
    const m = migrated();
    const cur = effectiveRuns(text, m.textRuns, lang);
    const next = patch === "clear" ? clearMarks(cur, sel.start, sel.end) : applyMarks(cur, sel.start, sel.end, patch);
    onPatch({ textRuns: { ...m.textRuns, [lang]: next }, textStyle: m.textStyle });
  };
  const setPara = (p: Partial<CardTextStyle>) => onPatch({ textStyle: compactStyle({ ...s, ...p }) });
  const aligns: [TextAlign, typeof AlignLeft, string][] = [
    ["start", AlignLeft, t("cards.alignStart", "По началу строки")],
    ["center", AlignCenter, t("cards.alignCenter", "По центру")],
    ["end", AlignRight, t("cards.alignEnd", "По концу строки")],
    ["justify", AlignJustify, t("cards.alignJustify", "По ширине")],
  ];
  const dirLabel = (d: TextDirection) => d === "auto" ? t("cards.dirAuto", "Авто") : d === "ltr" ? "LTR" : "RTL";
  const langLabel = (l: RunLang) => l === "ru" ? "RU" : l === "en" ? "EN" : "HE";
  const selected = hasSel ? value.slice(sel.start, sel.end) : "";
  return (
    <fieldset className="space-y-3 rounded-md border border-slate-200 p-3" data-testid="text-style-editor" disabled={readOnly}>
      <legend className="px-1 text-xs font-medium text-slate-600">{t("cards.text", "Текст")}</legend>
      <div className="flex gap-1" role="tablist" aria-label={t("cards.textLanguage", "Язык текста")}>
        {RUN_LANGS.map(l => (
          <button key={l} type="button" role="tab" aria-selected={lang === l} data-testid={`tab-text-lang-${l}`}
            className={cn(toggleCls(lang === l), "flex-1")} onClick={() => { setLang(l); setSel({ start: 0, end: 0 }); }}>
            {langLabel(l)}{text[l] ? "" : " ·"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label={t("cards.selectionToolbar", "Оформление выделенного текста")} data-testid="toolbar-text-selection">
        <button type="button" disabled={!hasSel} aria-pressed={!!active.bold} data-testid="button-text-bold" title={t("cards.bold", "Жирный")} className={toggleCls(!!active.bold)} onMouseDown={keep} onClick={() => mark({ bold: !active.bold })}><Bold className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={!hasSel} aria-pressed={!!active.italic} data-testid="button-text-italic" title={t("cards.italic", "Курсив")} className={toggleCls(!!active.italic)} onMouseDown={keep} onClick={() => mark({ italic: !active.italic })}><Italic className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={!hasSel} aria-pressed={!!active.underline} data-testid="button-text-underline" title={t("cards.underline", "Подчёркнутый")} className={toggleCls(!!active.underline)} onMouseDown={keep} onClick={() => mark({ underline: !active.underline })}><Underline className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={!hasSel} data-testid="button-text-clear" title={t("cards.clearFormat", "Убрать оформление выделенного")} className={toggleCls(false)} onMouseDown={keep} onClick={() => mark("clear")}><Eraser className="h-3.5 w-3.5" /></button>
      </div>
      <RichRunsEditable testId="input-text-content" runs={runs} dir={s.direction} align={s.align} disabled={readOnly} sel={sel} onSel={setSel}
        placeholder={t("cards.editorPlaceholder", "Введите текст. Выделите слова, чтобы оформить их.")} onText={onText} />
      <p className="text-xs text-slate-500" data-testid="text-selection-hint">
        {hasSel ? <>{t("cards.selected", "Выделено")}: <span className="font-medium text-slate-700">«{selected.length > 40 ? selected.slice(0, 40) + "…" : selected}»</span></>
          : t("cards.selectHint", "Выделите слова в тексте, чтобы изменить их оформление или добавить ссылку.")}
      </p>
      <div data-testid="input-text-color" className={cn(!hasSel && "pointer-events-none opacity-50")} onMouseDown={e => { if ((e.target as HTMLElement).tagName !== "INPUT") keep(e); }}>
        <ColorPickerControl label={t("cards.selectionColor", "Цвет выделенного текста")} value={active.color ?? ""} onChange={v => mark({ color: v || false })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`link-${block.id}`} className="flex items-center gap-1 text-xs"><Link2 className="h-3 w-3" />{t("cards.selectionLink", "Ссылка для выделенного")}</Label>
        <div className="flex gap-1">
          <Input id={`link-${block.id}`} data-testid="input-text-link" dir="ltr" inputMode="url" placeholder={active.link ?? t("cards.linkPlaceholder", "https://… / mailto:… / #якорь")} value={linkDraft}
            aria-invalid={linkInvalid} disabled={!hasSel}
            className={cn("h-8 text-sm", linkInvalid && "border-red-400 focus-visible:ring-red-400")}
            onChange={e => setLinkDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !linkInvalid && linkDraft) { e.preventDefault(); mark({ link: linkDraft }); setLinkDraft(""); } }} />
          <button type="button" data-testid="button-text-link-apply" disabled={!hasSel || !linkDraft || linkInvalid} className={toggleCls(false)} onMouseDown={keep}
            onClick={() => { mark({ link: linkDraft }); setLinkDraft(""); }}>{t("cards.apply", "Применить")}</button>
          <button type="button" data-testid="button-text-unlink" disabled={!hasSel || !active.link} title={t("cards.removeLink", "Убрать ссылку")} className={toggleCls(false)} onMouseDown={keep}
            onClick={() => mark({ link: false })}><Unlink className="h-3.5 w-3.5" /></button>
        </div>
        {linkInvalid ? (
          <p role="alert" className="text-xs text-red-600" data-testid="error-text-link">
            {t("cards.linkInvalid", "Допустимы только полные адреса http://, https://, mailto: или якорь на странице (#раздел). Исправьте ссылку перед сохранением.")}
          </p>
        ) : <p className="text-xs text-slate-500">{t("cards.linkHint", "Веб-ссылки открываются в новой вкладке, якоря (#) — на этой странице.")}</p>}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("cards.paragraph", "Абзац: выравнивание и направление")}</Label>
        <div className="flex flex-wrap gap-1">
          {aligns.map(([a, Icon, label]) => (
            <button key={a} type="button" aria-pressed={(s.align ?? "start") === a} data-testid={`button-text-align-${a}`} title={label}
              className={toggleCls((s.align ?? "start") === a)} onClick={() => setPara({ align: a === "start" ? undefined : a })}>
              <Icon className="h-3.5 w-3.5 rtl:-scale-x-100" />
            </button>
          ))}
          <span className="mx-1 w-px self-stretch bg-slate-200" />
          {TEXT_DIRECTIONS.map(d => (
            <button key={d} type="button" aria-pressed={(s.direction ?? "auto") === d} data-testid={`button-text-dir-${d}`}
              className={toggleCls((s.direction ?? "auto") === d)} onClick={() => setPara({ direction: d === "auto" ? undefined : d })}>{dirLabel(d)}</button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

/** Divider kind (line styles or empty spacer), thickness and color. */
export function DividerStyleEditor({ block, readOnly, onPatch }: { block: CardBlock; readOnly: boolean; onPatch: (p: Partial<CardBlock>) => void }) {
  const t = useT();
  const s = block.dividerStyle ?? {};
  const kind = s.kind ?? "solid";
  const set = (p: Partial<CardDividerStyle>) => onPatch({ dividerStyle: compactStyle({ ...s, ...p }) });
  const kindLabel = (k: DividerKind) => k === "solid" ? t("cards.dividerSolid", "Сплошная") : k === "dashed" ? t("cards.dividerDashed", "Штрихи") : k === "dotted" ? t("cards.dividerDotted", "Точки") : t("cards.dividerSpace", "Пустой отступ");
  return (
    <fieldset className="space-y-3 rounded-md border border-slate-200 p-3" data-testid="divider-style-editor" disabled={readOnly}>
      <legend className="px-1 text-xs font-medium text-slate-600">{t("cards.dividerStyle", "Вид разделителя")}</legend>
      <div className="grid grid-cols-2 gap-1">
        {DIVIDER_KINDS.map(k => (
          <button key={k} type="button" aria-pressed={kind === k} data-testid={`button-divider-kind-${k}`}
            className={cn(toggleCls(kind === k), "h-auto flex-col gap-1 py-1.5")} onClick={() => set({ kind: k === "solid" ? undefined : k, ...(k !== "space" ? { height: undefined } : { thickness: undefined, color: undefined }) })}>
            <span className="block h-0 w-10" style={k === "space" ? { borderTop: "2px solid transparent", outline: "1px dashed currentColor", outlineOffset: 2, opacity: 0.35 } : { borderTop: `2px ${k} currentColor` }} />
            {kindLabel(k)}
          </button>
        ))}
      </div>
      {kind === "space" && (
        <div className="space-y-1.5">
          <Label htmlFor={`space-${block.id}`} className="flex justify-between text-xs">{t("cards.spaceHeight", "Высота отступа")}<span data-testid="text-divider-height">{s.height ?? SPACE_DEFAULT}px</span></Label>
          <div className="flex items-center gap-2">
            <input type="range" min={0} max={SPACE_MAX} step={4} value={s.height ?? SPACE_DEFAULT} className="flex-1 accent-slate-800" aria-label={t("cards.spaceHeight", "Высота отступа")}
              onChange={e => { const n = Number(e.target.value); set({ height: n === SPACE_DEFAULT ? undefined : n }); }} />
            <Input id={`space-${block.id}`} type="number" min={0} max={SPACE_MAX} step={1} data-testid="input-divider-height" className="h-8 w-20 text-sm"
              value={s.height ?? SPACE_DEFAULT}
              onChange={e => { const raw = Number(e.target.value); if (!Number.isFinite(raw)) return; const n = Math.min(SPACE_MAX, Math.max(0, Math.round(raw))); set({ height: n === SPACE_DEFAULT ? undefined : n }); }} />
          </div>
        </div>
      )}
      {kind !== "space" && (
        <>
          <div className="space-y-1.5">
            <Label className="flex justify-between text-xs">{t("cards.dividerThickness", "Толщина")}<span data-testid="text-divider-thickness">{s.thickness ?? 1}px</span></Label>
            <input type="range" min={1} max={12} step={1} value={s.thickness ?? 1} data-testid="input-divider-thickness" className="w-full accent-slate-800"
              aria-label={t("cards.dividerThickness", "Толщина")} onChange={e => { const n = Number(e.target.value); set({ thickness: n === 1 ? undefined : n }); }} />
          </div>
          <div data-testid="input-divider-color">
            <ColorPickerControl label={t("cards.dividerColor", "Цвет линии")} value={s.color ?? ""} onChange={v => set({ color: v || undefined })} />
          </div>
        </>
      )}
    </fieldset>
  );
}
