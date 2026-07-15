import assert from "node:assert/strict";
import test from "node:test";

import {
  bindCtrlWheelListener,
  getCanvasPanOffset,
  getCanvasViewportZoomState,
  getCanvasZoomState,
  shouldStartCanvasPan,
} from "../src/features/academic-flow/canvasPan.ts";

test("moves the viewport without clamping its offset", () => {
  assert.deepEqual(
    getCanvasPanOffset(
      { clientX: 120, clientY: 80, offsetX: 300, offsetY: 200 },
      { clientX: 90, clientY: 130 },
    ),
    { x: 270, y: 250 },
  );
});

test("allows the viewport to move beyond its original boundary", () => {
  assert.deepEqual(
    getCanvasPanOffset(
      { clientX: 10, clientY: 10, offsetX: 4, offsetY: 6 },
      { clientX: 30, clientY: 40 },
    ),
    { x: 24, y: 36 },
  );
});

test("viewport zoom preserves the pointer anchor", () => {
  assert.deepEqual(
    getCanvasViewportZoomState({
      deltaY: -120,
      offsetX: 40,
      offsetY: 20,
      pointerX: 240,
      pointerY: 120,
      zoom: 1,
    }),
    { offsetX: 36, offsetY: 18, zoom: 1.02 },
  );
});

test("starts canvas panning with the right mouse button", () => {
  assert.equal(shouldStartCanvasPan({ button: 2 }), true);
});

test("does not start canvas panning with the left mouse button", () => {
  assert.equal(shouldStartCanvasPan({ button: 0 }), false);
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
