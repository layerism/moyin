export function canDeleteRevisionNode(nodeId: string, publishedNodeIds: string[]) {
  return !publishedNodeIds.includes(nodeId);
}
