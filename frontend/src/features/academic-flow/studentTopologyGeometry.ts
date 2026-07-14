export const studentNodeSize = { height: 126, width: 280 };

type TopologyPort = "bottom" | "left" | "right" | "top";

type TopologyNode = {
  id: string;
  x: number;
  y: number;
};

type TopologyEdge = {
  id: string;
  source: string;
  sourcePort?: TopologyPort;
  target: string;
  targetPort?: TopologyPort;
};

export function getStudentCanvasBounds(nodes: TopologyNode[]) {
  const padding = 96;
  return {
    height: Math.max(
      520,
      ...nodes.map((node) => node.y + studentNodeSize.height + padding),
    ),
    width: Math.max(
      760,
      ...nodes.map((node) => node.x + studentNodeSize.width + padding),
    ),
  };
}

export function createStudentEdgePath(edge: TopologyEdge, nodes: TopologyNode[]) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return "";

  const fallback = getFallbackPorts(source, target);
  const sourcePort = edge.sourcePort ?? fallback.sourcePort;
  const targetPort = edge.targetPort ?? fallback.targetPort;
  const start = getPortPoint(source, sourcePort);
  const end = getPortPoint(target, targetPort);
  const sourceHorizontal = sourcePort === "left" || sourcePort === "right";
  const targetHorizontal = targetPort === "left" || targetPort === "right";

  if (sourceHorizontal && targetHorizontal) {
    const middleX = (start.x + end.x) / 2;
    return pointsToPath([start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end]);
  }
  if (!sourceHorizontal && !targetHorizontal) {
    const middleY = (start.y + end.y) / 2;
    return pointsToPath([start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end]);
  }
  if (sourceHorizontal) {
    return pointsToPath([start, { x: end.x, y: start.y }, end]);
  }
  return pointsToPath([start, { x: start.x, y: end.y }, end]);
}

export function getStudentEdgeTarget(
  edge: TopologyEdge,
  nodes: TopologyNode[],
): { port: TopologyPort; x: number; y: number } | null {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return null;
  const port = edge.targetPort ?? getFallbackPorts(source, target).targetPort;
  return { ...getPortPoint(target, port), port };
}

function getPortPoint(node: TopologyNode, port: TopologyPort) {
  if (port === "top") return { x: node.x + studentNodeSize.width / 2, y: node.y };
  if (port === "bottom") {
    return { x: node.x + studentNodeSize.width / 2, y: node.y + studentNodeSize.height };
  }
  if (port === "left") return { x: node.x, y: node.y + studentNodeSize.height / 2 };
  return { x: node.x + studentNodeSize.width, y: node.y + studentNodeSize.height / 2 };
}

function getFallbackPorts(source: TopologyNode, target: TopologyNode) {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  if (Math.abs(deltaY) >= Math.abs(deltaX)) {
    return deltaY >= 0
      ? ({ sourcePort: "bottom", targetPort: "top" } as const)
      : ({ sourcePort: "top", targetPort: "bottom" } as const);
  }
  return deltaX >= 0
    ? ({ sourcePort: "right", targetPort: "left" } as const)
    : ({ sourcePort: "left", targetPort: "right" } as const);
}

function pointsToPath(points: Array<{ x: number; y: number }>) {
  const unique = points.filter(
    (point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y,
  );
  const [first, ...rest] = unique;
  return `M ${first.x} ${first.y}${rest.map((point) => ` L ${point.x} ${point.y}`).join("")}`;
}
