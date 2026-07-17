import type { AcademicFlowEdge, AcademicFlowNode } from "../../types";

export type StudentIdentity = {
  id: number;
  name: string;
  studentNo: string;
};

export type PublishedFlow = {
  configHash: string;
  flowId: string;
  flowVersionId: string;
  shareUrl: string;
  token: string;
  versionNo: number;
};

export type RevisionImpactSource = {
  addedNodeIds: string[];
  affectedStudentCount: number;
  changedNodeIds: string[];
  invalidatedNodeIds: string[];
  predecessorChangedNodeIds: string[];
  status: "disabled" | "published";
  versionId: string;
  versionNo: number;
};

export type RevisionImpact = {
  addedNodeIds: string[];
  affectedStudentCount: number;
  changedNodeIds: string[];
  currentVersionId: string | null;
  currentVersionNo: number | null;
  draftConfigHash: string;
  invalidatedNodeIds: string[];
  nextVersionNo: number;
  predecessorChangedNodeIds: string[];
  sourceVersionImpacts: RevisionImpactSource[];
};

export type SharedFlow = {
  description: string;
  name: string;
};

export type RuntimeNodeStatus =
  | "approved"
  | "audit_error"
  | "available"
  | "draft"
  | "expired"
  | "locked"
  | "rejected"
  | "reviewing"
  | "submitted";

export type RuntimeNodeAudit = {
  attemptCount: number;
  canRetry: boolean;
  details: Record<string, unknown> | null;
  reason: string | null;
  status: RuntimeNodeStatus;
};

export type RuntimeNodeInstance = {
  approvedAt: string | null;
  audit: RuntimeNodeAudit | null;
  attemptNo: number;
  draft: Record<string, unknown>;
  effectiveDeadline: string | null;
  id: string;
  nodeKey: string;
  status: RuntimeNodeStatus;
  submission: Record<string, unknown>;
  submittedAt: string | null;
};

export type RuntimeFlowInstance = {
  config: { edges: AcademicFlowEdge[]; nodes: AcademicFlowNode[] };
  description: string;
  flowId: string;
  flowVersionId: string;
  id: string;
  name: string;
  nodeInstances: RuntimeNodeInstance[];
  status: "completed" | "in_progress";
  student: { name: string; studentNo: string };
};

export type WorkflowProgressStudent = {
  approvedCount: number;
  expiredCount: number;
  instanceId: string;
  lastActiveAt: string;
  name: string;
  status: string;
  studentNo: string;
  totalCount: number;
};

export type WorkflowProgress = {
  flowVersionId: string;
  name: string;
  students: WorkflowProgressStudent[];
};
