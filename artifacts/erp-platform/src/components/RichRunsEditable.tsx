import { useEffect, useLayoutEffect, useRef } from "react";
import { RUNS_TEXT_MAX, runStyle, runsText, sanitizeLink, type TextRun } from "@/lib/cardBlockStyle";
import { cn } from "@/lib/utils";

export interface Sel { start: number; end: number }

/** Character offset of (node, off) inside root, counted on text content only. */
function offsetOf(root: HTMLElement, node: Node, off: number): number {
  const r = document.createRange();
  r.selectNodeContents(root);
  try { r.setEnd(node, off); } catch { return 0; }
  return r.toString().length;
}
function locate(root: HTMLElement, pos: number): [Node, number] {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null; let i = 0; let last: Node | null = null;
  while ((n = w.nextNode())) {
    const len = n.textContent?.length ?? 0;
    if (pos <= i + len) return [n, pos - i];
    i += len; last = n;
  }
  return last ? [last, last.textContent?.length ?? 0] : [root, 0];
}
export function readSelection(root: HTMLElement): Sel | null {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const a = offsetOf(root, r.startContainer, r.startOffset), b = offsetOf(root, r.endContainer, r.endOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}
export function writeSelection(root: HTMLElement, sel: Sel) {
  const s = window.getSelection(); if (!s) return;
  const [sn, so] = locate(root, sel.start); const [en, eo] = locate(root, sel.end);
  const r = document.createRange(); r.setStart(sn, so); r.setEnd(en, eo);
  s.removeAllRanges(); s.addRange(r);
}
/** Builds the editable DOM from runs with createElement/textContent only — no HTML strings. */
function paint(root: HTMLElement, runs: readonly TextRun[]) {
  const nodes: Node[] = runs.map(r => {
    const s = document.createElement("span");
    s.textContent = r.text;
    const st = runStyle(r);
    for (const [k, v] of Object.entries(st)) (s.style as unknown as Record<string, string>)[k] = String(v);
    if (r.link) {
      s.dataset.link = r.link;
      s.style.textDecoration = "underline";
      s.style.textUnderlineOffset = "2px";
      if (!sanitizeLink(r.link)) s.style.textDecorationStyle = "wavy";
    }
    return s;
  });
  // A trailing newline needs a sentinel to be visible in pre-wrap.
  if (runsText(runs).endsWith("\n")) nodes.push(document.createElement("br"));
  root.replaceChildren(...nodes);
}
const sig = (runs: readonly TextRun[]) => JSON.stringify(runs);

/** Contenteditable WYSIWYG region for structured runs. The DOM is a projection
 * of `runs`; every edit is read back as plain text + caret and reported via
 * onText, so the runs contract stays the single source of truth. */
export function RichRunsEditable({ runs, dir, align, placeholder, disabled, sel, onSel, onText, testId }: {
  runs: TextRun[]; dir?: string; align?: string; placeholder: string; disabled?: boolean; sel: Sel;
  onSel: (s: Sel) => void; onText: (next: string, caret: number) => void; testId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const painted = useRef<string | null>(null);
  const pending = useRef<Sel | null>(null);
  const composing = useRef(false);
  const selRef = useRef(sel); selRef.current = sel;
  const onSelRef = useRef(onSel); onSelRef.current = onSel;
  const plain = runsText(runs);

  useLayoutEffect(() => {
    const el = ref.current; if (!el || composing.current) return;
    const k = sig(runs);
    if (painted.current === k && el.textContent === plain) return;
    const focused = document.activeElement === el;
    const keepSel = pending.current ?? (focused ? readSelection(el) : null);
    paint(el, runs); painted.current = k;
    if (focused && keepSel) writeSelection(el, { start: Math.min(keepSel.start, plain.length), end: Math.min(keepSel.end, plain.length) });
    pending.current = null;
  });

  useEffect(() => {
    const on = () => {
      const el = ref.current;
      if (!el || document.activeElement !== el) return;
      const s = readSelection(el);
      if (s && (s.start !== selRef.current.start || s.end !== selRef.current.end)) onSelRef.current(s);
    };
    document.addEventListener("selectionchange", on);
    return () => document.removeEventListener("selectionchange", on);
  }, []);

  const commit = (next: string, caret: number) => {
    const v = next.slice(0, RUNS_TEXT_MAX); const c = Math.min(caret, v.length);
    pending.current = { start: c, end: c };
    painted.current = null; // force repaint into canonical spans
    onText(v, c); onSel({ start: c, end: c });
  };
  const insert = (str: string) => {
    const el = ref.current; if (!el) return;
    const s = readSelection(el) ?? selRef.current;
    commit(plain.slice(0, s.start) + str + plain.slice(s.end), s.start + str.length);
  };
  const readBack = () => {
    const el = ref.current; if (!el) return;
    const s = readSelection(el);
    const text = el.textContent ?? "";
    if (text === plain) return;
    commit(text, s?.end ?? text.length);
  };

  return (
    <div className="relative">
      <div ref={ref} data-testid={testId} role="textbox" aria-multiline="true" aria-label={placeholder}
        contentEditable={!disabled} suppressContentEditableWarning spellCheck dir={dir ?? "auto"}
        className={cn("min-h-[5.5rem] w-full whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white/70 px-2.5 py-2 text-sm text-slate-700 caret-slate-800",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400 selection:bg-amber-200/70", disabled && "opacity-60")}
        style={{ textAlign: (align ?? "start") as never }}
        onBeforeInput={e => {
          const t = (e.nativeEvent as InputEvent).inputType;
          if (t === "insertParagraph" || t === "insertLineBreak") { e.preventDefault(); insert("\n"); }
          else if (t === "insertFromDrop" || t === "formatBold" || t === "formatItalic" || t === "formatUnderline") e.preventDefault();
        }}
        onKeyDown={e => {
          // Native execCommand formatting would inject foreign markup; ignore it.
          if ((e.ctrlKey || e.metaKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) e.preventDefault();
        }}
        onInput={() => { if (!composing.current) readBack(); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; readBack(); }}
        onPaste={e => { e.preventDefault(); insert(e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n")); }}
        onDrop={e => e.preventDefault()} />
      {!plain && <span className="pointer-events-none absolute start-2.5 top-2 text-sm text-slate-400" data-testid="text-editor-placeholder">{placeholder}</span>}
    </div>
  );
}
