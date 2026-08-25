import assert from "node:assert/strict";
import test from "node:test";
import {
  getCalendarWeekDays,
  startOfCalendarWeek,
} from "./calendarWeek.ts";

function localISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test("Sunday-first calendar starts headers and month grid on Sunday", () => {
  const reference = new Date(2026, 7, 1);

  assert.equal(localISO(startOfCalendarWeek(reference, 7)), "2026-07-26");
  assert.deepEqual(
    getCalendarWeekDays(reference, 7).map((date) => date.getDay()),
    [0, 1, 2, 3, 4, 5, 6],
  );
});

test("Monday-first calendar starts headers and month grid on Monday", () => {
  const reference = new Date(2026, 7, 1);

  assert.equal(localISO(startOfCalendarWeek(reference, 1)), "2026-07-27");
  assert.deepEqual(
    getCalendarWeekDays(reference, 1).map((date) => date.getDay()),
    [1, 2, 3, 4, 5, 6, 0],
  );
});