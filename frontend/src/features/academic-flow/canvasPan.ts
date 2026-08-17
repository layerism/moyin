export type CanvasPoint = {
  x: number;
  y: number;
};

const canvasArrowDirections: Record<string, CanvasPoint> = {
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
};

export function getCanvasArrowKeyDelta(key: string, step: number): CanvasPoint | null {
  const direction = canvasArrowDirections[key];
  return direction
    ? { x: direction.x * step, y: direction.y * step }
    : null;
}

export function isCanvasKeyboardEditingTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]',
  ));
}

export type CanvasRect = CanvasPoint & {
  height: number;
  width: number;
};

export type CanvasPanStart = {
  clientX: number;
  clientY: number;
  offsetX: number;
  offsetY: number;
};

export type CanvasViewportZoomInput = {
  deltaY: number;
  offsetX: number;
  offsetY: number;
  pointerX: number;
  pointerY: number;
  zoom: number;
};

export type CanvasZoomInput = {
  deltaY: number;
  offsetX: number;
  offsetY: number;
  scrollLeft: number;
  scrollTop: number;
  zoom: number;
};

export type CanvasPanStartInput = {
  button: number;
};

const minimumZoom = 0.5;
const maximumZoom = 1.5;
const zoomStep = 0.02;

export function shouldStartCanvasPan(input: CanvasPanStartInput) {
  return input.button === 2;
}

export function normalizeCanvasRect(start: CanvasPoint, end: CanvasPoint): CanvasRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function canvasRectsIntersect(left: CanvasRect, right: CanvasRect) {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}

export function constrainCanvasGroupDelta(
  points: readonly CanvasPoint[],
  desiredDelta: CanvasPoint,
  minimumCoordinate: number,
): CanvasPoint {
  const minimumX = Math.min(...points.map((point) => point.x));
  const minimumY = Math.min(...points.map((point) => point.y));
  return {
    x: Math.max(desiredDelta.x, minimumCoordinate - minimumX),
    y: Math.max(desiredDelta.y, minimumCoordinate - minimumY),
  };
}

export function bindCtrlWheelListener(
  target: HTMLElement,
  onCtrlWheel: (event: WheelEvent) => void,
) {
  const handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    onCtrlWheel(event);
  };

  target.addEventListener("wheel", handleWheel, { passive: false });
  return () => target.removeEventListener("wheel", handleWheel);
}

export function getCanvasPanOffset(
  start: CanvasPanStart,
  current: { clientX: number; clientY: number },
) {
  return {
    x: start.offsetX + current.clientX - start.clientX,
    y: start.offsetY + current.clientY - start.clientY,
  };
}

export function getCanvasViewportZoomState(input: CanvasViewportZoomInput) {
  const zoom = nextZoom(input.zoom, input.deltaY);
  const worldX = (input.pointerX - input.offsetX) / input.zoom;
  const worldY = (input.pointerY - input.offsetY) / input.zoom;
  return {
    offsetX: input.pointerX - worldX * zoom,
    offsetY: input.pointerY - worldY * zoom,
    zoom,
  };
}

export function getCanvasZoomState(input: CanvasZoomInput) {
  const zoom = nextZoom(input.zoom, input.deltaY);
  const ratio = zoom / input.zoom;

  return {
    scrollLeft: Math.max(0, (input.scrollLeft + input.offsetX) * ratio - input.offsetX),
    scrollTop: Math.max(0, (input.scrollTop + input.offsetY) * ratio - input.offsetY),
    zoom,
  };
}

function nextZoom(zoom: number, deltaY: number) {
  return Math.min(
    maximumZoom,
    Math.max(minimumZoom, zoom + (deltaY < 0 ? zoomStep : -zoomStep)),
  );
}
