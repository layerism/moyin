import assert from "node:assert/strict";
import test from "node:test";

import { getCanvasPanScroll, getCanvasZoomState } from "../src/features/academic-flow/canvasPan.ts";

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

test("zooms slowly while preserving the pointer anchor", () => {
  assert.deepEqual(
    getCanvasZoomState({
      deltaY: -120,
      offsetX: 200,
      offsetY: 100,
      scrollLeft: 300,
      scrollTop: 150,
      zoom: 1,
    }),
    { scrollLeft: 310, scrollTop: 155, zoom: 1.02 },
  );
});

test("clamps Ctrl-wheel zoom to the supported range", () => {
  assert.equal(
    getCanvasZoomState({
      deltaY: -120,
      offsetX: 0,
      offsetY: 0,
      scrollLeft: 0,
      scrollTop: 0,
      zoom: 1.5,
    }).zoom,
    1.5,
  );
});
