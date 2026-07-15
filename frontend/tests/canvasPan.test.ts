import assert from "node:assert/strict";
import test from "node:test";

import {
  bindCtrlWheelListener,
  getCanvasPanScroll,
  getCanvasZoomState,
  shouldStartCanvasPan,
} from "../src/features/academic-flow/canvasPan.ts";

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

test("starts panning from a non-interactive child of the canvas background", () => {
  assert.equal(
    shouldStartCanvasPan({
      button: 0,
      interactiveTarget: false,
      panToolActive: true,
    }),
    true,
  );
});

test("does not start canvas panning from an interactive flow element", () => {
  assert.equal(
    shouldStartCanvasPan({
      button: 0,
      interactiveTarget: true,
      panToolActive: true,
    }),
    false,
  );
});

test("movable revision nodes take priority over the active pan tool", () => {
  assert.equal(
    shouldStartCanvasPan({
      button: 0,
      interactiveTarget: false,
      movableNodeTarget: true,
      panToolActive: true,
    }),
    false,
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

test("registers Ctrl-wheel zoom as a non-passive native listener", () => {
  let registeredOptions: AddEventListenerOptions | boolean | undefined;
  let wheelListener: ((event: WheelEvent) => void) | undefined;
  let zoomed = false;
  const target = {
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions | boolean,
    ) {
      assert.equal(type, "wheel");
      registeredOptions = options;
      wheelListener = listener as (event: WheelEvent) => void;
    },
    removeEventListener() {},
  } as unknown as HTMLElement;

  bindCtrlWheelListener(target, () => {
    zoomed = true;
  });

  let prevented = false;
  wheelListener?.({
    ctrlKey: true,
    preventDefault: () => {
      prevented = true;
    },
  } as WheelEvent);

  assert.deepEqual(registeredOptions, { passive: false });
  assert.equal(prevented, true);
  assert.equal(zoomed, true);
});
