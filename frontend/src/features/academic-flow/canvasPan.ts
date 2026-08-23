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

export type CanvasViewportBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type CanvasEdgePanInput = {
  bounds: CanvasViewportBounds;
  clientX: number;
  clientY: number;
  edgeSize: number;
  maxStep: number;
};

const minimumZoom = 0.25;
const maximumZoom = 1.5;
const zoomStep = 0.02;

type CanvasControlModifierInput = {
  ctrlKey: boolean;
  metaKey: boolean;
};

export function isCanvasControlModifierActive(input: CanvasControlModifierInput) {
  return input.ctrlKey || input.metaKey;
}

export function shouldStartCanvasPan(input: CanvasPanStartInput) {
  return input.button === 2;
}

export function getCanvasEdgePanDelta(input: CanvasEdgePanInput): CanvasPoint {
  if (
    input.edgeSize <= 0 ||
    input.maxStep <= 0 ||
    input.clientX < input.bounds.left ||
    input.clientX > input.bounds.right ||
    input.clientY < input.bounds.top ||
    input.clientY > input.bounds.bottom
  ) {
    return { x: 0, y: 0 };
  }

  return {
    x: getEdgePanAxisDelta(
      input.clientX,
      input.bounds.left,
      input.bounds.right,
      input.edgeSize,
      input.maxStep,
    ),
    y: getEdgePanAxisDelta(
      input.clientY,
      input.bounds.top,
      input.bounds.bottom,
      input.edgeSize,
      input.maxStep,
    ),
  };
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

export function bindCanvasZoomWheelListener(
  target: HTMLElement,
  onZoomWheel: (event: WheelEvent) => void,
) {
  const handleWheel = (event: WheelEvent) => {
    if (!isCanvasControlModifierActive(event)) return;
    event.preventDefault();
    onZoomWheel(event);
  };

  target.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  return () => target.removeEventListener("wheel", handleWheel, true);
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

function getEdgePanAxisDelta(
  pointer: number,
  start: number,
  end: number,
  edgeSize: number,
  maxStep: number,
) {
  const startStrength = Math.min(1, Math.max(0, (start + edgeSize - pointer) / edgeSize));
  const endStrength = Math.min(1, Math.max(0, (pointer - end + edgeSize) / edgeSize));
  return (startStrength - endStrength) * maxStep;
}
