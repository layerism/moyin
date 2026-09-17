import type { AcademicFlowEdge, AcademicFlowNode, AnswerSheetGrade } from "../../types";

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
  | "skipped"
  | "approved"
  | "audit_error"
  | "available"
  | "draft"
  | "expired"
  | "locked"
  | "rejected"
  | "reviewing"
  | "scheduled"
  | "submitted";

export type RuntimeNodeTemplate = {
  assetId: string;
  contentType: string;
  originalName: string;
  sizeBytes: number;
};

export type RuntimeScanFile = {
  contentType: string;
  fileId: string;
  order: number;
  originalName: string;
  pageCount: number;
  sizeBytes: number;
};

export type RuntimeNodeAudit = {
  attemptCount: number;
  canRetry: boolean;
  details: Record<string, unknown> | null;
  reason: string | null;
  status: RuntimeNodeStatus;
};

export type RuntimeAuditHistoryEntry = {
  id: string;
  attemptNo: number;
  scriptName: string;
  passed: boolean;
  reason: string;
  reviewedAt: string | null;
};

export type RuntimeNodeInstance = {
  auditHistory?: RuntimeAuditHistoryEntry[];
  reviewStage?: "ai" | "manual" | null;
  approvedAt: string | null;
  feedback?: ManualFeedback[];
  sourceReviews?: ManualSourceReview[];
  manualRejection?: { id: string; remark: string; reviewedAt: string; files: ManualFeedbackFile[] } | null;
  manualReview?: { remark: string; reviewedAt: string } | null;
  audit: RuntimeNodeAudit | null;
  attemptNo: number;
  attemptsRemaining: number | null;
  requiresResubmission?: boolean;
  draft: Record<string, unknown>;
  effectiveDeadline: string | null;
  effectiveStartAt: string | null;
  id: string;
  grade: AnswerSheetGrade | null;
  nodeKey: string;
  status: RuntimeNodeStatus;
  submission: Record<string, unknown>;
  submittedAt: string | null;
  template: RuntimeNodeTemplate | null;
  templateDownloaded: boolean;
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
  nodes: WorkflowProgressNode[];
  status: string;
  studentNo: string;
  totalCount: number;
};

export type WorkflowProgressNode = {
  effectiveDeadline: string | null;
  globalDeadline: string | null;
  nodeKey: string;
  nodeInstanceId: string;
  overrideDeadline: string | null;
  status: RuntimeNodeStatus;
  title: string;
};

export type TeacherSubmissionDetail = {
  answerSheetGrade: AnswerSheetGrade | null;
  attemptNo: number;
  auditJobStatus: "failed" | "pending" | "running" | "succeeded" | null;
  canManualApprove: boolean;
  mode: "answer_sheet" | "pass_fail" | "score" | null;
  nodeInstanceId: string;
  nodeTitle: string;
  passed: boolean | null;
  reason: string | null;
  reviewSource: "ai" | "manual" | null;
  scans: Array<RuntimeScanFile & { url: string }>;
  score: number | null;
  status: RuntimeNodeStatus;
  student: { name: string; studentNo: string };
  submissionId: string | null;
  submission: Record<string, unknown>;
  threshold: number | null;
};

export type WorkflowProgress = {
  flowVersionId: string;
  name: string;
  students: WorkflowProgressStudent[];
};

export type ManualReviewStudent = {
  canReview?: boolean;
  id: number;
  name: string;
  studentNo: string;
  nodeInstanceId: string | null;
  status: RuntimeNodeStatus;
};
export type ManualReviewQueue = {
  title: string;
  requirement: string;
  students: ManualReviewStudent[];
};
export type ManualSourceReview = { nodeKey: string; title: string; approved: boolean; rejected: boolean; remark: string; reviewedAt: string | null };
export type ManualFeedbackFile = { id: string; sourceFileId: string; sourceNodeKey: string | null; sourceName: string; name: string; sizeBytes: number };
export type ManualFeedback = { id: string; remark: string; publishedAt: string; historical: boolean; files: ManualFeedbackFile[] };
export type ManualFeedbackDraft = { revision: number; remark: string; files: ManualFeedbackFile[] };
export type ManualReviewDetail = {
  referenceFiles?: Array<{ id: string; label: string; original_name: string; url: string }>;
  canReview?: boolean;
  sourceReviews: ManualSourceReview[];
  feedbackDraft: ManualFeedbackDraft;
  feedback: ManualFeedback[];
  nodeInstanceId: string;
  title: string;
  requirement: string;
  student: { name: string; studentNo: string };
  status: RuntimeNodeStatus;
  evidenceHash: string;
  sources: Array<{
    nodeKey: string;
    title: string;
    kind: AcademicFlowNode["kind"];
    requirement: string;
    infoFields: AcademicFlowNode["infoFields"];
    answerSheet: AcademicFlowNode["answerSheet"] | null;
    status: RuntimeNodeStatus;
    submissionId: string | null;
    submittedAt: string | null;
    submission: Record<string, unknown>;
    audit: { passed?: boolean; reason?: string; details?: Record<string, unknown> } | null;
    auditParams: Record<string, unknown>;
    grade: AnswerSheetGrade | null;
    manualReview: { remark: string; reviewedAt: string } | null;
    files: Array<{ id: string; original_name: string; size_bytes: number; url: string }>;
  }>;
  history: Array<{ id: string; remark: string; reviewedAt: string; teacherName: string; passed?: boolean }>;
};
