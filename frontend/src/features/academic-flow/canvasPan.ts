export type CanvasPanStart = {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
};

export function getCanvasPanScroll(
  start: CanvasPanStart,
  current: { clientX: number; clientY: number },
) {
  return {
    left: Math.max(0, start.scrollLeft - (current.clientX - start.clientX)),
    top: Math.max(0, start.scrollTop - (current.clientY - start.clientY)),
  };
}
