import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AffixedNumericValue } from "./AffixedNumericValue.ts";

const render = (
  content: string,
  displayAffix?: string | null,
  displayAffixPosition?: "before" | "after" | null,
) => renderToStaticMarkup(
  createElement(AffixedNumericValue, {
    config: { displayAffix, displayAffixPosition },
    children: content,
  }),
);

test("blank affix renders only the isolated numeric token", () => {
  assert.equal(render("12.30", "  ", "before"), '<span dir="ltr" data-affix-part="number">12.30</span>');
});

test("before affix uses semantic affix-then-number order and a visual gap", () => {
  const html = render("12", "$", "before");
  assert.match(html, /data-affix-position="before"/);
  assert.match(html, /gap:0.25em/);
  assert.ok(html.indexOf('data-affix-part="affix"') < html.indexOf('data-affix-part="number"'));
});

test("after affix uses semantic number-then-affix order", () => {
  const html = render("12", "kg", "after");
  assert.ok(html.indexOf('data-affix-part="number"') < html.indexOf('data-affix-part="affix"'));
});

test("already-formatted decimal content is preserved", () => {
  assert.match(render("1,234.500", "kg", "after"), />1,234\.500<\/span>/);
});

test("RTL is inherited while numeric markup stays LTR and DOM order remains semantic", () => {
  const html = renderToStaticMarkup(
    createElement("div", { dir: "rtl" },
      createElement(AffixedNumericValue, {
        config: { displayAffix: "₪", displayAffixPosition: "before" },
        children: "12.50",
      }),
    ),
  );
  assert.match(html, /^<div dir="rtl"><span class="inline-flex items-baseline"/);
  assert.doesNotMatch(html, /data-affix-position="before" dir=/);
  assert.ok(html.indexOf('data-affix-part="affix"') < html.indexOf('dir="ltr" data-affix-part="number"'));
});