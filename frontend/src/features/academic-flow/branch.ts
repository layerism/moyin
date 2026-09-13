import type { AcademicFlowNode, AcademicFlowPort } from "../../types";

export function branchPort(id: string): AcademicFlowPort {
  return `branch:${id}`;
}

export function nodePorts(node: Pick<AcademicFlowNode, "kind" | "branches">): AcademicFlowPort[] {
  return node.kind === "branch"
    ? ["top", ...(node.branches ?? []).map((option) => branchPort(option.id))]
    : ["top", "bottom"];
}

export function branchPortFraction(branches: AcademicFlowNode["branches"], port: AcademicFlowPort) {
  const options = branches ?? [];
  const index = options.findIndex((option) => branchPort(option.id) === port);
  return (index + 1) / (options.length + 1);
}
