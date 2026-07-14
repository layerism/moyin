export type CanvasPanStart = {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
};

export type CanvasZoomInput = {
  deltaY: number;
  offsetX: number;
  offsetY: number;
  scrollLeft: number;
  scrollTop: number;
  zoom: number;
};

const minimumZoom = 0.5;
const maximumZoom = 1.5;
const zoomStep = 0.02;

export function getCanvasPanScroll(
  start: CanvasPanStart,
  current: { clientX: number; clientY: number },
) {
  return {
    left: Math.max(0, start.scrollLeft - (current.clientX - start.clientX)),
    top: Math.max(0, start.scrollTop - (current.clientY - start.clientY)),
  };
}

export function getCanvasZoomState(input: CanvasZoomInput) {
  const zoom = Math.min(
    maximumZoom,
    Math.max(minimumZoom, input.zoom + (input.deltaY < 0 ? zoomStep : -zoomStep)),
  );
  const ratio = zoom / input.zoom;

  return {
    scrollLeft: Math.max(0, (input.scrollLeft + input.offsetX) * ratio - input.offsetX),
    scrollTop: Math.max(0, (input.scrollTop + input.offsetY) * ratio - input.offsetY),
    zoom,
  };
}
