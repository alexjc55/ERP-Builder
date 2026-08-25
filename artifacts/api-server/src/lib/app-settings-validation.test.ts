/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { UpdateSettingsBody } from "@workspace/api-zod";
import {
  normalizeAppCalendarSettings,
  validateAppCalendarSettingsUpdate,
} from "./app-settings-validation";

function validateEndpointBody(body: unknown): string | null {
  const parsed = UpdateSettingsBody.safeParse(body);
  if (!parsed.success) return "schema";
  return validateAppCalendarSettingsUpdate(parsed.data);
}

test("accepts valid partial calendar-setting updates", () => {
  assert.equal(validateEndpointBody({ workingDays: [7, 1, 2, 3, 4] }), null);
  assert.equal(validateEndpointBody({ firstDayOfWeek: 1 }), null);
  assert.equal(validateEndpointBody({ timeZone: "Asia/Jerusalem" }), null);
});

test("rejects empty, duplicated, fractional and out-of-range working days", () => {
  assert.equal(validateEndpointBody({ workingDays: [] }), "schema");
  assert.match(validateEndpointBody({ workingDays: [1, 1, 2] }) ?? "", /unique ISO weekdays/);
  assert.match(validateEndpointBody({ workingDays: [1, 2.5] }) ?? "", /unique ISO weekdays/);
  assert.equal(validateEndpointBody({ workingDays: [1, 8] }), "schema");
});

test("rejects invalid first-day values", () => {
  assert.match(validateEndpointBody({ firstDayOfWeek: 1.5 }) ?? "", /First day of week/);
  assert.equal(validateEndpointBody({ firstDayOfWeek: 0 }), "schema");
  assert.equal(validateEndpointBody({ firstDayOfWeek: 8 }), "schema");
});

test("defaults existing singleton rows to Sunday-through-Thursday and Sunday first", () => {
  assert.deepEqual(
    normalizeAppCalendarSettings({ workingDays: null, firstDayOfWeek: null }),
    { workingDays: [7, 1, 2, 3, 4], firstDayOfWeek: 7 },
  );
});