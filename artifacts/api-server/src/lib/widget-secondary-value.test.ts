import { test } from "node:test";
import assert from "node:assert/strict";
import { CreateDashboardWidgetBody, UpdateDashboardWidgetBody } from "@workspace/api-zod";
import { validateSecondaryValue } from "./widget-secondary-value";

const config = {
  widgetType: "metric",
  metrics: [
    { key: "orders", entityId: 1, aggregation: "count", statusIds: [10, 11] },
    { key: "total", entityId: 1, aggregation: "sum", fieldKey: "amount", statusTagIds: [2] },
  ],
  format: "number",
  secondaryValue: { metricKey: "total", captionJson: { ru: "На сумму:", he: "בסכום:", en: "Total:" }, format: "currency" },
};

test("create, JSON persistence and update preserve the explicit secondary reference and multilingual format", () => {
  const input = { titleJson: { ru: "Заказов в работе" }, config };
  const created = CreateDashboardWidgetBody.parse(input);
  const stored = JSON.parse(JSON.stringify(created));
  const updated = UpdateDashboardWidgetBody.parse(stored);
  assert.deepEqual(updated.config.secondaryValue, config.secondaryValue);
  assert.deepEqual(updated.config.metrics, created.config.metrics);
  assert.equal(validateSecondaryValue(updated.config), null);
  const { secondaryValue, ...disabled } = config;
  assert.equal(validateSecondaryValue(disabled), null);
  assert.equal(UpdateDashboardWidgetBody.parse({ ...input, config: disabled }).config.secondaryValue, undefined);
});

test("missing/deleted/renamed metric and non-scalar configs reject instead of silently selecting another metric", () => {
  assert.match(validateSecondaryValue({ ...config, metrics: config.metrics.slice(0, 1) })!, /unknown metric/);
  assert.match(validateSecondaryValue({ ...config, secondaryValue: { metricKey: "renamed" } })!, /unknown metric/);
  for (const widgetType of ["formula", "chart", "notes"]) {
    assert.match(validateSecondaryValue({ ...config, widgetType })!, /only available/);
  }
  assert.equal(validateSecondaryValue({ ...config, widgetType: undefined }), null);
});

test("contract validates required key, caption and independent format on both write paths", () => {
  for (const schema of [CreateDashboardWidgetBody, UpdateDashboardWidgetBody]) {
    for (const secondaryValue of [{}, { metricKey: "" }, { metricKey: "total", format: "invalid" }, { metricKey: "total", captionJson: { ru: 123 } }]) {
      assert.equal(schema.safeParse({ titleJson: {}, config: { ...config, secondaryValue } }).success, false);
    }
    for (const format of ["number", "currency", "percent"]) {
      assert.equal(schema.safeParse({ titleJson: {}, config: { ...config, secondaryValue: { ...config.secondaryValue, format } } }).success, true);
    }
  }
});