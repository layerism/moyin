import type { AcademicFlowNode } from "../../types";

export function nodeReferences(node: AcademicFlowNode) {
  return node.referenceAssets ?? (node.referenceAsset ? [node.referenceAsset] : []);
}
