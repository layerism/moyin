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
