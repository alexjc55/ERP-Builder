import assert from "node:assert/strict";
import test from "node:test";
import { columnGroupBodyStyle, resolveColumnGroupCellStyle } from "./columnGroupStyles.ts";

test("unset body colors produce no group override", () => {
  assert.equal(columnGroupBodyStyle({ bodyBackgroundColor: null, bodyTextColor: null }), undefined);
});

test("body palette is independent of header settings", () => {
  const body = { bodyBackgroundColor: "#112233", bodyTextColor: "#F0F0F0" };
  assert.deepEqual(
    columnGroupBodyStyle({ ...body, color: "#FF0000", displayMode: "bar", textColor: null } as typeof body),
    columnGroupBodyStyle({ ...body, color: "#00FF00", displayMode: "fill", textColor: "#000000" } as typeof body),
  );
});

test("conditional cell and row colors take precedence over group colors", () => {
  const group = columnGroupBodyStyle({ bodyBackgroundColor: "#112233", bodyTextColor: "#EEEEEE" });
  assert.deepEqual(resolveColumnGroupCellStyle(group, { rowColor: "#445566" }), {
    backgroundColor: "#445566",
    color: "#EEEEEE",
  });
  assert.deepEqual(resolveColumnGroupCellStyle(group, {
    rowColor: "#445566",
    cellColor: "#778899",
    textColor: "#010203",
  }), { backgroundColor: "#778899", color: "#010203" });
});