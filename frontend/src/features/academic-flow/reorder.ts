export type ReorderPlacement = "before" | "after";

export function getReorderPlacement(
  pointerY: number,
  top: number,
  height: number,
): ReorderPlacement {
  return pointerY < top + height / 2 ? "before" : "after";
}

export function getReorderDestination(
  sourceIndex: number,
  targetIndex: number,
  placement: ReorderPlacement,
  itemCount: number,
): number | null {
  const rawInsertionIndex = targetIndex + (placement === "after" ? 1 : 0);
  const destinationIndex = rawInsertionIndex > sourceIndex
    ? rawInsertionIndex - 1
    : rawInsertionIndex;
  if (
    sourceIndex < 0
    || sourceIndex >= itemCount
    || targetIndex < 0
    || targetIndex >= itemCount
    || destinationIndex < 0
    || destinationIndex >= itemCount
    || destinationIndex === sourceIndex
  ) {
    return null;
  }
  return destinationIndex;
}

export function reorderItem<T>(
  items: T[],
  sourceIndex: number,
  destinationIndex: number,
): T[] {
  if (
    sourceIndex < 0
    || sourceIndex >= items.length
    || destinationIndex < 0
    || destinationIndex >= items.length
    || sourceIndex === destinationIndex
  ) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(sourceIndex, 1);
  next.splice(destinationIndex, 0, item);
  return next;
}
