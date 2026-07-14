type IdentifiedNode = { id: string };
type PositionedNode = IdentifiedNode & { x: number; y: number };

export function createPublishRequestPayload(expectedDraftConfigHash?: string | null) {
  return { expectedDraftConfigHash: expectedDraftConfigHash ?? null };
}

export function getRevisionPublishConflictMessage(
  status: number,
  expectedDraftConfigHash?: string | null,
) {
  return status === 409 && expectedDraftConfigHash != null
    ? "草稿已变化，请重新预览影响"
    : null;
}

export function canDeleteRevisionNode(
  nodeId: string,
  publishedNodeIds: readonly string[] | undefined,
  existingNodeIds: readonly string[] = [],
) {
  return !(publishedNodeIds ?? existingNodeIds).includes(nodeId);
}

export function filterPublishedRuntimeNodes<T extends IdentifiedNode>(
  nodes: readonly T[],
  publishedNodeIds: readonly string[] | undefined,
) {
  if (!publishedNodeIds) return [];
  const publishedIds = new Set(publishedNodeIds);
  return nodes.filter((node) => publishedIds.has(node.id));
}

export function layoutRevisionNodes<T extends PositionedNode>(nodes: readonly T[]): T[] {
  return nodes.map((node, index) => ({
    ...node,
    x: snapToGrid(170 + (index % 2) * 330),
    y: snapToGrid(70 + Math.floor(index / 2) * 185),
  }));
}

function snapToGrid(value: number) {
  return Math.max(16, Math.round(value / 16) * 16);
}
