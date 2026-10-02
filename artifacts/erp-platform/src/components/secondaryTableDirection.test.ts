import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("./DashboardView.tsx", import.meta.url), "utf8");
const widgetTable = dashboard.slice(dashboard.indexOf("function WidgetTable("), dashboard.indexOf("function getRelativeTime("));
const pivot = readFileSync(new URL("./PivotView.tsx", import.meta.url), "utf8");

test("secondary tables isolate direction inside content, preserving table and sticky geometry", () => {
  for (const source of [widgetTable, pivot]) {
    assert.doesNotMatch(source, /<(?:table|thead|tbody|tr|td|th)\b[^>]*\bdir=/);
    assert.match(source, /<div dir=\{[^}]+\} style=\{\{ textAlign: "start" \}\}/);
    assert.doesNotMatch(source, /\.reverse\(/);
  }
  assert.match(pivot, /className="sticky start-0/);
});

test("dashboard uses source field metadata, current page override and application setting", () => {
  assert.match(widgetTable, /new Map\(fields\.map\(\(field\) => \[field\.fieldKey, field\.textDirection\]\)\)/);
  assert.match(widgetTable, /column\.textDirection === undefined \? directionByFieldKey\?\.get\(column\.fieldKey\) : column\.textDirection/);
  assert.match(widgetTable, /pageTextDirection,\s*settings\?\.textDirection,\s*lang/);
  assert.match(dashboard, /pageTextDirection=\{thisPage\?\.textDirection\}/);
  assert.match(widgetTable, /c\.fieldType === "status" \? \(\s*<StatusCell/);
  assert.match(dashboard, /<CompactStatus name=\{s\.name\} nameJson=\{s\.nameJson\}/);
});

test("pivot uses caller-supplied metadata without adding an entity or page metadata fetch", () => {
  assert.match(pivot, /pivot=\{query\.pivot\} fields=\{fields\} pageFields=\{pageFields\}/);
  assert.match(pivot, /source === "page" \? pageFields : fields/);
  assert.match(pivot, /metadata\.find\(\(field\) => field\.fieldKey === fieldKey\)\?\.textDirection/);
  assert.match(pivot, /pivot\?\.measures\?\.find\(\(measure\) => measure\.key === columnKey\)/);
  assert.match(pivot, /measure\?\.agg === "sum" \? sourceDirection/);
  assert.match(pivot, /dimension\?\.source === "status" \|\| dimension\?\.source === "statusTag"\s*\? resolveDataDirection\(null, null, null, lang\)/);
  assert.doesNotMatch(pivot, /useListEntityFields|useListPageFields|useListDashboardWidgets/);
});

test("dashboard projection metadata covers entity, page-local and related overrides", () => {
  const backend = readFileSync(new URL("../../../api-server/src/routes/dashboard.ts", import.meta.url), "utf8");
  const tableCompute = backend.slice(backend.indexOf("async function computeTableData("), backend.indexOf("async function", backend.indexOf("async function computeTableData(") + 1));
  assert.match(tableCompute, /textDirection: entityFieldsTable\.textDirection/);
  assert.match(tableCompute, /textDirection: pageFieldsTable\.textDirection/);
  assert.match(tableCompute, /textDirection: relName\?\.textDirection \?\? null/);
  assert.match(tableCompute, /textDirection: pc\.textDirection/);
  assert.match(tableCompute, /textDirection: rc\.textDirection/);
  assert.match(pivot, /result\.textDirections\?\.measures\?\.find/);
  assert.match(pivot, /result\.textDirections\?\.rowLanguageDriven/);
  assert.match(pivot, /result\.textDirections\?\.columnIsMeasure/);
});