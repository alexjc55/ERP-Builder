import assert from "node:assert/strict";
import test from "node:test";
import { collaborationTooltipPosition } from "./collaborationTooltipPosition.ts";

test("all four viewport edges keep tooltip inside the viewport in either direction", () => {
  for (const direction of ["ltr", "rtl"]) {
    for (const anchor of [
      { left: 0, right: 40, top: 0, bottom: 20 },
      { left: 360, right: 400, top: 0, bottom: 20 },
      { left: 0, right: 40, top: 580, bottom: 600 },
      { left: 360, right: 400, top: 580, bottom: 600 },
    ]) {
      const result = collaborationTooltipPosition(anchor, { width: 200, height: 60 }, { width: 400, height: 600 });
      assert.ok(result.left >= 8 && result.left + 200 <= 392, direction);
      assert.ok(result.top >= 8 && result.top + 60 <= 592, direction);
      if (anchor.top === 0) assert.ok(result.top > anchor.bottom);
      else assert.ok(result.top + 60 < anchor.top);
    }
  }
});

test("oversize content and visual viewport offsets clamp without negative geometry", () => {
  assert.deepEqual(
    collaborationTooltipPosition(
      { left: -200, right: -100, top: -20, bottom: 0 },
      { width: 900, height: 1000 },
      { width: 200, height: 300, left: 25, top: 40 },
    ),
    { left: 33, top: 48 },
  );
});