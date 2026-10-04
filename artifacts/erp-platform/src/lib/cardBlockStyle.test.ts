import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeLink, textRenderProps, dividerRenderProps, blockStyleIssues, compactStyle, parseTextStyle, parseDividerStyle } from "./cardBlockStyle.ts";
import { parseCardLayout, copyLayout, makeBlock, type CardLayout } from "./cardLayout.ts";
import { demoValue, demoValueText } from "./cardDemoData.ts";

test("safe links: only absolute http/https and mailto with @", () => {
  for (const ok of ["https://example.com", "http://a.b/x?y=1#z", "HTTPS://EXAMPLE.COM", "mailto:a@b.co"]) assert.equal(sanitizeLink(ok), ok, ok);
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "//evil.com", "/relative", "example.com", " https://x.com", "https://x.com ",
    "https://exa mple.com", "https://x.com/\u0000", "https://x.com\u007f", "mailto:nobody", "ftp://x.com", "http:/x.com", "https:", "", "https://" + "a".repeat(2050), "vbscript:x"]) {
    assert.equal(sanitizeLink(bad), null, JSON.stringify(bad));
  }
});

test("text render props: formatting, card color override only when set, unsafe link not rendered", () => {
  const r = textRenderProps({ bold: true, italic: true, underline: true, color: "#123456", align: "center", direction: "rtl", link: "https://x.test" });
  assert.deepEqual(r.style, { textAlign: "center", color: "#123456", fontWeight: 600, fontStyle: "italic", textDecoration: "underline" });
  assert.equal(r.dir, "rtl");
  assert.equal(r.href, "https://x.test");
  assert.equal(r.external, true);
  assert.equal(textRenderProps(undefined).style.color, "var(--card-text, #475569)");
  assert.equal(textRenderProps({ link: "javascript:alert(1)" }).href, null);
  const m = textRenderProps({ link: "mailto:a@b.co" });
  assert.equal(m.external, false);
});

test("dividers: default solid 1px legacy, space draws no line with sane height", () => {
  assert.deepEqual(dividerRenderProps(undefined), { kind: "solid", thickness: 1, color: "#e2e8f0", height: 16 });
  const sp = dividerRenderProps({ kind: "space" });
  assert.equal(sp.kind, "space");
  assert.ok(sp.height >= 16);
  assert.equal(parseDividerStyle({ kind: "dashed", thickness: 40, color: "#abcdef" })!.thickness, 12);
  assert.equal(parseDividerStyle({ kind: "wavy" })!.kind, undefined);
});

test("compactStyle drops empty values so untouched blocks keep legacy shape", () => {
  assert.equal(compactStyle({ bold: false, link: undefined, color: "" }), undefined);
  assert.deepEqual(compactStyle({ bold: true, link: undefined }), { bold: true });
  assert.equal(parseTextStyle({ align: "middle", color: "red" })!.align, undefined);
});

const layoutWith = (): CardLayout => {
  const text = { ...makeBlock("text"), text: { ru: "Привет" }, textStyle: { bold: true, color: "#ff0000", link: "https://x.test", align: "end" as const, direction: "ltr" as const } };
  const div = { ...makeBlock("divider"), dividerStyle: { kind: "dotted" as const, thickness: 3, color: "#00ff00" } };
  return { version: 1, style: "standard", customStyle: {}, tabs: [{ id: "t", title: {}, sections: [{ id: "s", title: {}, columns: 1, blocks: [text, div] }] }] };
};

test("formatting persists through JSON parse and copy (same and other entity)", () => {
  const l = layoutWith();
  const parsed = parseCardLayout(JSON.parse(JSON.stringify(l)))!;
  assert.deepEqual(parsed.tabs[0].sections[0].blocks[0].textStyle, l.tabs[0].sections[0].blocks[0].textStyle);
  assert.deepEqual(parsed.tabs[0].sections[0].blocks[1].dividerStyle, l.tabs[0].sections[0].blocks[1].dividerStyle);
  for (const same of [true, false]) {
    const c = copyLayout(parsed, same);
    const [t, d] = c.tabs[0].sections[0].blocks;
    assert.deepEqual(t.textStyle, l.tabs[0].sections[0].blocks[0].textStyle);
    assert.deepEqual(d.dividerStyle, l.tabs[0].sections[0].blocks[1].dividerStyle);
    assert.notEqual(t.textStyle, parsed.tabs[0].sections[0].blocks[0].textStyle, "deep copy");
  }
});

test("pre-save validation flags invalid links and partial colors", () => {
  const l = layoutWith();
  assert.deepEqual(blockStyleIssues(l), []);
  l.tabs[0].sections[0].blocks[0].textStyle!.link = "javascript:alert(1)";
  l.tabs[0].sections[0].blocks[1].dividerStyle!.color = "#12";
  assert.deepEqual(blockStyleIssues(l).map(i => i.kind), ["invalidLink", "invalidColor"]);
});

test("demo data covers field types without records", () => {
  const types = ["text", "textarea", "number", "percent", "boolean", "date", "datetime", "select", "status", "email", "url", "phone", "file", "user", "relation", "lookup", "page_ref", "function", "created_at"];
  for (const ft of types) assert.ok(demoValueText(demoValue({ fieldKey: ft, fieldType: ft, optionsJson: [{ value: "a" }] })).length > 0, ft);
  assert.deepEqual(demoValue({ fieldKey: "s", fieldType: "select", optionsJson: ["x", "y"] }, 1), { kind: "options", values: ["y"] });
  assert.equal(demoValue({ fieldKey: "r", fieldType: "relation", relationConfigJson: { selectionMode: "multiple" } }).kind, "relation");
});

import { applyMarks, clearMarks, spliceRuns, runsText, effectiveRuns, migrateLegacyText, marksIn, parseTextRuns, RUNS_MAX } from "./cardBlockStyle.ts";
import { blockColumnLimit, effectiveSpan, spanChoices } from "./cardLayout.ts";

test("selected word bold only; adjacent text stays normal", () => {
  const r = applyMarks([{ text: "hello big world" }], 6, 9, { bold: true });
  assert.deepEqual(r, [{ text: "hello " }, { text: "big", bold: true }, { text: " world" }]);
  assert.equal(runsText(r), "hello big world");
  assert.equal(marksIn(r, 6, 9).bold, true);
  assert.equal(marksIn(r, 0, 9).bold, undefined);
});

test("link and color on selected word only; remove link/mark via explicit false", () => {
  let r = applyMarks([{ text: "see docs now" }], 4, 8, { link: "https://x.test", color: "#112233", italic: true });
  assert.deepEqual(r[1], { text: "docs", italic: true, color: "#112233", link: "https://x.test" });
  assert.deepEqual(r[0], { text: "see " });
  r = applyMarks(r, 4, 8, { link: false });
  assert.equal(r[1].link, undefined);
  r = applyMarks(r, 4, 6, { italic: false });
  assert.deepEqual(r, [{ text: "see " }, { text: "do", color: "#112233" }, { text: "cs", italic: true, color: "#112233" }, { text: " now" }]);
  assert.deepEqual(clearMarks(r, 0, 12), [{ text: "see docs now" }]);
});

test("mixed formatting preserved through plain-text edits", () => {
  const base = applyMarks(applyMarks([{ text: "one two three" }], 0, 3, { bold: true }), 8, 13, { underline: true });
  const typed = spliceRuns(base, "one! two three");
  assert.deepEqual(typed[0], { text: "one!", bold: true });
  assert.equal(runsText(typed), "one! two three");
  const del = spliceRuns(typed, "one! three", 5);
  assert.deepEqual(del, [{ text: "one!", bold: true }, { text: " " }, { text: "three", underline: true }]);
});

test("legacy whole-block style renders unchanged until edit, then migrates to runs keeping paragraph props", () => {
  const style = { bold: true, link: "https://x.test", align: "center" as const, direction: "rtl" as const };
  const m = migrateLegacyText({ ru: "Привет", he: "שלום" }, undefined, style);
  assert.deepEqual(m.textRuns.ru, [{ text: "Привет", bold: true, link: "https://x.test" }]);
  assert.deepEqual(m.textRuns.he, [{ text: "שלום", bold: true, link: "https://x.test" }]);
  assert.deepEqual(m.textStyle, { align: "center", direction: "rtl" });
  // Stale runs never lose content.
  assert.deepEqual(effectiveRuns({ en: "new" }, { en: [{ text: "old", bold: true }] }, "en"), [{ text: "new" }]);
});

test("multilingual runs survive save/parse and copy", () => {
  const layout = parseCardLayout({ version: 1, style: "standard", customStyle: {}, tabs: [{ id: "t", title: {}, sections: [{ id: "s", title: {}, columns: 3, blocks: [
    { id: "b", kind: "text", span: 2, modes: ["view"], columns: [], text: { ru: "a b", en: "x y" },
      textRuns: { ru: [{ text: "a", bold: true }, { text: " b" }], en: [{ text: "x " }, { text: "y", link: "mailto:a@b.co", bold: false }] } },
  ] }] }] }) as CardLayout;
  const b = layout.tabs[0].sections[0].blocks[0];
  assert.deepEqual(b.textRuns?.en, [{ text: "x " }, { text: "y", link: "mailto:a@b.co" }]);
  const back = parseCardLayout(JSON.parse(JSON.stringify(layout))) as CardLayout;
  assert.deepEqual(back.tabs[0].sections[0].blocks[0].textRuns, b.textRuns);
  const copy = copyLayout(layout, true);
  const cb = copy.tabs[0].sections[0].blocks[0];
  assert.deepEqual(cb.textRuns, b.textRuns);
  assert.notEqual(cb.textRuns?.ru, b.textRuns?.ru);
  assert.ok((parseTextRuns({ ru: Array.from({ length: 900 }, (_, i) => ({ text: String(i % 2), bold: i % 2 === 0 })) })?.ru?.length ?? 0) <= RUNS_MAX);
  assert.equal(parseTextRuns({ ru: [{ text: "<b>x</b>", link: "javascript:1" }] })?.ru?.[0].text, "<b>x</b>");
});

test("space divider height px, thickness for lines only", () => {
  assert.equal(dividerRenderProps({ kind: "space" }).height, 16);
  assert.equal(dividerRenderProps({ kind: "space", height: 120 }).height, 120);
  assert.equal(dividerRenderProps({ kind: "space", height: 0 }).height, 0);
  assert.equal(parseDividerStyle({ kind: "space", height: 9999 })?.height, 400);
  assert.equal(parseDividerStyle({ kind: "space", height: -5 })?.height, 0);
  assert.equal(dividerRenderProps({ kind: "solid", thickness: 4, height: 300 }).height, 16);
});

test("width = column span clamped to row columns", () => {
  const layout = parseCardLayout({ version: 1, style: "standard", customStyle: {}, tabs: [{ id: "t", title: {}, sections: [{ id: "s", title: {}, columns: 1, blocks: [
    { id: "a", kind: "field", span: 2, modes: ["view"], columns: [] }, { id: "c", kind: "field", span: 3, modes: ["view"], columns: [] },
  ], rows: [{ id: "r3", columns: 3, blockIds: ["a"] }, { id: "r1", columns: 1, blockIds: ["c"] }] }] }] }) as CardLayout;
  assert.equal(blockColumnLimit(layout, "a"), 3);
  assert.equal(effectiveSpan(2, 3), 2);
  assert.deepEqual(spanChoices(3).map(x => x.available), [true, true, true]);
  assert.equal(blockColumnLimit(layout, "c"), 1);
  assert.equal(effectiveSpan(3, 1), 1);
  assert.deepEqual(spanChoices(1).map(x => x.available), [true, false, false]);
});

test("sanitizeLink: same-page anchors allowed, not treated as web links", () => {
  for (const ok of ["#test", "#section-2", "#a.b_c:d"]) { assert.equal(sanitizeLink(ok), ok, ok); assert.equal(textRenderProps({ link: ok }).external, false); }
  for (const bad of ["#", "# test", "#<x>", "#\u0000a", "#javascript:alert(1)x\"", "##a"]) assert.equal(sanitizeLink(bad), null, JSON.stringify(bad));
});
