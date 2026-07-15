import type { AcademicFlowEdge, AcademicProcess } from "../../types";

type IdentifiedNode = { id: string };
type PositionedNode = IdentifiedNode & { x: number; y: number };

export function createFlowConfig(process: AcademicProcess) {
  return { edges: process.edges, nodes: process.nodes };
}

export function createPublishRequestPayload(
  expectedDraftConfigHash?: string | null,
  expectedCurrentVersionId?: string | null,
) {
  return {
    expectedDraftConfigHash: expectedDraftConfigHash ?? null,
    expectedCurrentVersionId: expectedCurrentVersionId ?? null,
  };
}

export function shouldReloadRevisionAfterConflict(
  status: number,
  _expectedDraftConfigHash?: string | null,
  _expectedCurrentVersionId?: string | null,
) {
  return status === 409;
}

export function canDeleteRevisionNode(
  nodeId: string,
  publishedNodeIds: readonly string[] | undefined,
  existingNodeIds: readonly string[] = [],
) {
  return !(publishedNodeIds ?? existingNodeIds).includes(nodeId);
}

export function canMoveRevisionNode() {
  return true;
}

export function canDeleteRevisionEdge(
  edgeId: string,
  publishedEdgeIds: readonly string[],
) {
  return !publishedEdgeIds.includes(edgeId);
}

export function preservePublishedEdges(
  currentEdges: AcademicFlowEdge[],
  publishedEdges: readonly AcademicFlowEdge[],
) {
  const currentById = new Map(currentEdges.map((edge) => [edge.id, edge]));
  const publishedIds = new Set(publishedEdges.map((edge) => edge.id));
  const publishedEdgesUnchanged = publishedEdges.every((publishedEdge) => {
    const currentEdge = currentById.get(publishedEdge.id);
    return (
      currentEdge?.source === publishedEdge.source &&
      currentEdge.target === publishedEdge.target &&
      currentEdge.sourcePort === publishedEdge.sourcePort &&
      currentEdge.targetPort === publishedEdge.targetPort
    );
  });
  if (publishedEdgesUnchanged) return currentEdges;
  return [
    ...publishedEdges,
    ...currentEdges.filter((edge) => !publishedIds.has(edge.id)),
  ];
}

export function canEditRevisionNodeDeadline(
  nodeId: string,
  publishedNodeIds: readonly string[] | undefined,
  existingNodeIds: readonly string[] = [],
) {
  return canDeleteRevisionNode(nodeId, publishedNodeIds, existingNodeIds);
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
