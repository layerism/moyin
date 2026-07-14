import assert from "node:assert/strict";
import test from "node:test";

import { getCanvasPanScroll } from "../src/features/academic-flow/canvasPan.ts";

test("pans the viewport opposite to pointer movement", () => {
  assert.deepEqual(
    getCanvasPanScroll(
      { clientX: 120, clientY: 80, scrollLeft: 300, scrollTop: 200 },
      { clientX: 90, clientY: 130 },
    ),
    { left: 330, top: 150 },
  );
});

test("clamps canvas scroll offsets at zero", () => {
  assert.deepEqual(
    getCanvasPanScroll(
      { clientX: 10, clientY: 10, scrollLeft: 4, scrollTop: 6 },
      { clientX: 30, clientY: 40 },
    ),
    { left: 0, top: 0 },
  );
});
