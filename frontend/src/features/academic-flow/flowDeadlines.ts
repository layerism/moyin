import type { AcademicFlowEdge, AcademicFlowNode } from "../../types";

// Unset deadlines stay empty; branches transmit upstream calendar constraints.
export function resolveFlowSchedule(nodes: AcademicFlowNode[], edges: AcademicFlowEdge[]) {
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
  const minimumDeadlines = new Map<string, string | null>();
  for (let index = 0; index < queue.length; index++) {
    const key = queue[index];
    const node = byId.get(key)!;
    const upstream = parents.get(key)!.flatMap((id) => dates.has(id) ? [dates.get(id)!] : []);
    const latest = upstream.length ? Math.max(...upstream) : NaN;
    minimumDeadlines.set(key, Number.isFinite(latest) ? new Date(latest).toISOString() : null);
    const value = node.kind === "branch" ? latest : node.deadlineAt
      ? new Date(node.deadlineAt).getTime() : NaN;
    if (Number.isFinite(value)) dates.set(key, value);
    result.set(key, node.kind !== "branch" && Number.isFinite(value) ? new Date(value).toISOString() : null);
    for (const child of children.get(key)!) {
      degree.set(child, degree.get(child)! - 1);
      if (!degree.get(child)) queue.push(child);
    }
  }
  return { deadlines: result, minimumDeadlines };
}

export function resolveFlowDeadlines(nodes: AcademicFlowNode[], edges: AcademicFlowEdge[]) {
  return resolveFlowSchedule(nodes, edges).deadlines;
}

export function getFlowTimeIssues(nodes: AcademicFlowNode[], edges: AcademicFlowEdge[]) {
  const schedule = resolveFlowSchedule(nodes, edges);
  const issues = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind === "branch") continue;
    const deadline = schedule.deadlines.get(node.id);
    const upstream = schedule.minimumDeadlines.get(node.id);
    if ((node.startAt && !Number.isFinite(new Date(node.startAt).getTime()))
      || (node.deadlineAt && !Number.isFinite(new Date(node.deadlineAt).getTime()))) {
      issues.set(node.id, "时间格式不正确");
    } else if (deadline && node.startAt && new Date(node.startAt) >= new Date(deadline)) {
      issues.set(node.id, "起始时间必须早于截止时间");
    } else if (deadline && upstream && new Date(deadline) < new Date(upstream)) {
      issues.set(node.id, "截止时间不得早于上游最晚截止时间");
    }
  }
  return issues;
}
