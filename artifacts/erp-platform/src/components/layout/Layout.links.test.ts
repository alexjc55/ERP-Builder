import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./Layout.tsx", import.meta.url),
  "utf8",
);

test("layout links let Wouter render the only anchor element", () => {
  assert.doesNotMatch(
    source,
    /<Link\b[^>]*>\s*<a\b/s,
    "Link must not wrap a manually rendered anchor",
  );
});

test("expanded and collapsed sidebar links keep styling on Link", () => {
  const sidebarSource = source.slice(
    source.indexOf("function SidebarItem("),
    source.indexOf("export default function Layout"),
  );

  assert.match(sidebarSource, /title=\{name\}/);
  assert.match(
    sidebarSource,
    /flex items-center justify-center px-0 py-2\.5 rounded-lg transition-colors/,
  );
  assert.match(
    sidebarSource,
    /flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors/,
  );
});