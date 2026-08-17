import type { AcademicFlowPort } from "../../types";

export type CurvePoint = { x: number; y: number };

export type CurveNode = CurvePoint & {
  height: number;
  id: string;
  width: number;
};

export type CurveEdge = {
  id: string;
  source: string;
  sourcePort?: AcademicFlowPort;
  target: string;
  targetPort?: AcademicFlowPort;
};

export type CurvedEdgeGeometry = {
  midX: number;
  midY: number;
  path: string;
  sourcePort: AcademicFlowPort;
  sourceX: number;
  sourceY: number;
  targetPort: AcademicFlowPort;
  targetX: number;
  targetY: number;
};

type ResolvedEdge = CurveEdge & {
  sourceNode: CurveNode;
  sourcePort: AcademicFlowPort;
  targetNode: CurveNode;
  targetPort: AcademicFlowPort;
};

export function createCurveGeometry(input: {
  source: CurvePoint;
  sourcePort: AcademicFlowPort;
  target: CurvePoint;
  targetPort: AcademicFlowPort;
}): CurvedEdgeGeometry {
  const endpointDistance = Math.hypot(
    input.target.x - input.source.x,
    input.target.y - input.source.y,
  );
  const controlDistance = Math.min(180, Math.max(48, endpointDistance * 0.35));
  const sourceNormal = getPortNormal(input.sourcePort);
  const targetNormal = getPortNormal(input.targetPort);
  const control1 = {
    x: input.source.x + sourceNormal.x * controlDistance,
    y: input.source.y + sourceNormal.y * controlDistance,
  };
  const control2 = {
    x: input.target.x + targetNormal.x * controlDistance,
    y: input.target.y + targetNormal.y * controlDistance,
  };
  const midpoint = getCubicPoint(input.source, control1, control2, input.target, 0.5);

  return {
    midX: midpoint.x,
    midY: midpoint.y,
    path: `M ${input.source.x} ${input.source.y} C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${input.target.x} ${input.target.y}`,
    sourcePort: input.sourcePort,
    sourceX: input.source.x,
    sourceY: input.source.y,
    targetPort: input.targetPort,
    targetX: input.target.x,
    targetY: input.target.y,
  };
}

export function createCurvedEdgeGeometries(
  edges: CurveEdge[],
  nodes: CurveNode[],
): Map<string, CurvedEdgeGeometry> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const resolvedEdges = edges.flatMap<ResolvedEdge>((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) return [];
    const fallback = getFallbackPorts(sourceNode, targetNode);
    return [{
      ...edge,
      sourceNode,
      sourcePort: edge.sourcePort ?? fallback.sourcePort,
      targetNode,
      targetPort: edge.targetPort ?? fallback.targetPort,
    }];
  });
  const sourceOffsets = getLaneOffsets(resolvedEdges, "source");
  const targetOffsets = getLaneOffsets(resolvedEdges, "target");

  return new Map(resolvedEdges.map((edge) => {
    const source = getPortPoint(
      edge.sourceNode,
      edge.sourcePort,
      sourceOffsets.get(edge.id) ?? 0,
    );
    const target = getPortPoint(
      edge.targetNode,
      edge.targetPort,
      targetOffsets.get(edge.id) ?? 0,
    );
    return [edge.id, createCurveGeometry({
      source,
      sourcePort: edge.sourcePort,
      target,
      targetPort: edge.targetPort,
    })] as const;
  }));
}

export function getOppositePort(port: AcademicFlowPort): AcademicFlowPort {
  if (port === "top") return "bottom";
  if (port === "bottom") return "top";
  if (port === "left") return "right";
  return "left";
}

function getFallbackPorts(source: CurveNode, target: CurveNode) {
  const sourceCenter = getNodeCenter(source);
  const targetCenter = getNodeCenter(target);
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;
  if (Math.abs(deltaY) >= Math.abs(deltaX)) {
    return deltaY >= 0
      ? ({ sourcePort: "bottom", targetPort: "top" } as const)
      : ({ sourcePort: "top", targetPort: "bottom" } as const);
  }
  return deltaX >= 0
    ? ({ sourcePort: "right", targetPort: "left" } as const)
    : ({ sourcePort: "left", targetPort: "right" } as const);
}

function getLaneOffsets(edges: ResolvedEdge[], side: "source" | "target") {
  const groups = new Map<string, ResolvedEdge[]>();
  edges.forEach((edge) => {
    const node = side === "source" ? edge.sourceNode : edge.targetNode;
    const port = side === "source" ? edge.sourcePort : edge.targetPort;
    const key = `${node.id}:${port}`;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  });

  const offsets = new Map<string, number>();
  groups.forEach((group) => {
    const node = side === "source" ? group[0].sourceNode : group[0].targetNode;
    const port = side === "source" ? group[0].sourcePort : group[0].targetPort;
    const verticalPort = port === "top" || port === "bottom";
    const span = verticalPort ? node.width : node.height;
    const usableSpan = Math.max(0, span - 32);
    const spacing = group.length > 1
      ? Math.min(18, usableSpan / (group.length - 1))
      : 0;
    const sorted = [...group].sort((left, right) => {
      const leftNode = side === "source" ? left.targetNode : left.sourceNode;
      const rightNode = side === "source" ? right.targetNode : right.sourceNode;
      const leftCenter = getNodeCenter(leftNode);
      const rightCenter = getNodeCenter(rightNode);
      const primary = verticalPort
        ? leftCenter.x - rightCenter.x
        : leftCenter.y - rightCenter.y;
      if (primary !== 0) return primary;
      const secondary = verticalPort
        ? leftCenter.y - rightCenter.y
        : leftCenter.x - rightCenter.x;
      return secondary || left.id.localeCompare(right.id);
    });
    sorted.forEach((edge, index) => {
      offsets.set(edge.id, (index - (sorted.length - 1) / 2) * spacing);
    });
  });
  return offsets;
}

function getNodeCenter(node: CurveNode): CurvePoint {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function getPortPoint(
  node: CurveNode,
  port: AcademicFlowPort,
  laneOffset: number,
): CurvePoint {
  if (port === "top") return { x: node.x + node.width / 2 + laneOffset, y: node.y };
  if (port === "bottom") {
    return { x: node.x + node.width / 2 + laneOffset, y: node.y + node.height };
  }
  if (port === "left") return { x: node.x, y: node.y + node.height / 2 + laneOffset };
  return { x: node.x + node.width, y: node.y + node.height / 2 + laneOffset };
}

function getPortNormal(port: AcademicFlowPort): CurvePoint {
  if (port === "top") return { x: 0, y: -1 };
  if (port === "bottom") return { x: 0, y: 1 };
  if (port === "left") return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}

function getCubicPoint(
  start: CurvePoint,
  control1: CurvePoint,
  control2: CurvePoint,
  end: CurvePoint,
  t: number,
): CurvePoint {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x
      + 3 * inverse ** 2 * t * control1.x
      + 3 * inverse * t ** 2 * control2.x
      + t ** 3 * end.x,
    y: inverse ** 3 * start.y
      + 3 * inverse ** 2 * t * control1.y
      + 3 * inverse * t ** 2 * control2.y
      + t ** 3 * end.y,
  };
}
