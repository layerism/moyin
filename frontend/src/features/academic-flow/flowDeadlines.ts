import type { AcademicFlowEdge, AcademicFlowNode } from "../../types";

// Derived dates never overwrite the teacher's explicit settings.
export function resolveFlowDeadlines(nodes: AcademicFlowNode[], edges: AcademicFlowEdge[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parents = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const children = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    parents.get(edge.target)!.push(edge.source);
    children.get(edge.source)!.push(edge.target);
  }
  const degree = new Map(nodes.map((node) => [node.id, parents.get(node.id)!.length]));
  const queue = nodes.filter((node) => !degree.get(node.id)).map((node) => node.id);
  const dates = new Map<string, number>();
  const result = new Map<string, string | null>();
  for (let index = 0; index < queue.length; index++) {
    const key = queue[index];
    const node = byId.get(key)!;
    const upstream = parents.get(key)!.flatMap((id) => dates.has(id) ? [dates.get(id)!] : []);
    const latest = upstream.length ? Math.max(...upstream) : NaN;
    const value = node.kind === "branch" ? latest : node.deadlineAt
      ? new Date(node.deadlineAt).getTime() : latest + 5 * 24 * 60 * 60 * 1000;
    if (Number.isFinite(value)) dates.set(key, value);
    result.set(key, node.kind !== "branch" && Number.isFinite(value) ? new Date(value).toISOString() : null);
    for (const child of children.get(key)!) {
      degree.set(child, degree.get(child)! - 1);
      if (!degree.get(child)) queue.push(child);
    }
  }
  return result;
}
