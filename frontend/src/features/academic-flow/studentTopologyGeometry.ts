import type { AcademicFlowPort } from "../../types";
import {
  createCurvedEdgeGeometries,
  type CurvedEdgeGeometry,
} from "./edgeCurveGeometry";

export const studentNodeSize = { height: 126, width: 280 };

export type TopologyNode = {
  id: string;
  x: number;
  y: number;
};

export type TopologyEdge = {
  id: string;
  source: string;
  sourcePort?: AcademicFlowPort;
  target: string;
  targetPort?: AcademicFlowPort;
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

export function createStudentEdgeGeometries(
  edges: TopologyEdge[],
  nodes: TopologyNode[],
): Map<string, CurvedEdgeGeometry> {
  return createCurvedEdgeGeometries(
    edges,
    nodes.map((node) => ({
      ...node,
      height: studentNodeSize.height,
      width: studentNodeSize.width,
    })),
  );
}
