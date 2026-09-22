import type { AcademicFlowConfig, AcademicFlowNode, AcademicProcess, AnswerSheetPrivateKey } from "../../types";
import { createFileUploadBody, type UploadedFile } from "./fileUpload";
import type { AuditScriptSummary, NodeAuditPolicy } from "./auditScripts";
import type {
  AuditScriptConfigDetail,
  AuditScriptConfigUpdate,
  AuditScriptManagementSummary,
} from "./auditScriptConfig";
import type {
  ManualFeedbackDraft,
  ManualReviewQueue,
  ManualReviewDetail,
  PublishedFlow,
  RevisionImpact,
  RuntimeFlowInstance,
  RuntimeScanFile,
  TeacherSubmissionDetail,
  WorkflowProgress,
} from "./runtimeTypes";
import { createFlowConfig, createPublishRequestPayload } from "./flowRevision";

export const FLOW_PREVIEW_TOKEN_KEY = "oa-flow-preview-token";

export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  active: boolean;
  updatedAt: string;
};

export type ServerFlow = {
  answerSheetKeys: Record<string, AnswerSheetPrivateKey>;
  config: AcademicFlowConfig;
  createdAt: string;
  description: string;
  draftConfig: AcademicFlowConfig;
  hasUnpublishedChanges: boolean;
  groupId: string | null;
  id: string;
  name: string;
  publishedNodeIds: string[];
  publishedVersionId: string | null;
  publishedVersionNo: number | null;
  status: "draft" | "published";
  updatedAt: string;
};

export type WorkflowGroup = {
  id: string;
  name: string;
  flowCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AnswerKeyPolicy = {
  flowId: string;
  nodeKey: string;
  gradingKey: AnswerSheetPrivateKey;
  gradingHash: string;
  generation: number;
  updatedAt: string;
  regradedSubmissionCount?: number;
};

export type FlowRosterEntry = {
  createdAt: string;
  id: number;
  name: string;
  status: "active" | "revoked";
  studentNo: string;
  updatedAt: string;
};

export type FlowRoster = {
  activeCount: number;
  entries: FlowRosterEntry[];
  revokedCount: number;
};

export type NodePackageStudentStatus =
  | "unsubmitted"
  | "reviewing"
  | "approved"
  | "rejected"
  | "audit_error";

export type NodePackageOptions = {
  flowName: string;
  nodeKey: string;
  nodeTitle: string;
  students: Array<{
    fileCount: number;
    fileSizeBytes: number;
    name: string;
    rosterEntryId: number;
    status: NodePackageStudentStatus;
    studentNo: string;
    submittedAt: string | null;
  }>;
  supportsFiles: boolean;
};

export type NodePackageDownloadRequest = {
  includeFiles: boolean;
  includeWorkbook: boolean;
  rosterEntryIds: number[];
  studentScope: "all" | "selected";
};

export type MaterialLibraryFile = {
  contentType: string;
  createdAt: string;
  fileId: string;
  originalName: string;
  sizeBytes: number;
  submissionStatus: "reviewing" | "approved" | "rejected" | "audit_error";
  submittedAt: string;
};

export type MaterialLibraryStudent = {
  files: MaterialLibraryFile[];
  name: string;
  rosterEntryId: number;
  studentNo: string;
};

export type MaterialLibraryNode = {
  nodeKey: string;
  students: MaterialLibraryStudent[];
  title: string;
};

export type MaterialLibraryFlow = {
  flowId: string;
  name: string;
  nodes: MaterialLibraryNode[];
  versionId: string;
};

export type PersonalDriveFile = Omit<MaterialLibraryFile, "submissionStatus" | "submittedAt">;

export type MaterialLibrary = {
  personalFiles: PersonalDriveFile[];
  flows: MaterialLibraryFlow[];
};

export class ApiError extends Error {
  public fieldErrors: Record<string, string>;
  public status: number;

  constructor(
    status: number,
    message: string,
    fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.fieldErrors = fieldErrors;
    this.status = status;
  }
}

type ErrorDetail = string | {
  fieldErrors?: Record<string, string>;
  message?: string;
};

export function applyPreviewHeaders(headers: Headers): void {
  const previewToken = window.sessionStorage.getItem(FLOW_PREVIEW_TOKEN_KEY);
  if (previewToken) headers.set("X-Flow-Preview-Token", previewToken);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isMultipart =
    typeof FormData !== "undefined" && init?.body instanceof FormData;
  const headers = new Headers(init?.headers);
  if (!isMultipart && init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  applyPreviewHeaders(headers);
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: ErrorDetail } | null;
    const detail = body?.detail;
    if (detail && typeof detail === "object") {
      throw new ApiError(
        response.status,
        detail.message ?? "请求失败",
        detail.fieldErrors ?? {},
      );
    }
    throw new ApiError(response.status, detail ?? "请求失败");
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

async function downloadRequest(
  path: string,
  fallbackFilename = "材料.zip",
  init: RequestInit = {},
): Promise<{ blob: Blob; filename: string }> {
  const headers = new Headers(init.headers);
  applyPreviewHeaders(headers);
  const response = await fetch(path, { ...init, credentials: "include", headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: ErrorDetail } | null;
    const detail = body?.detail;
    if (detail && typeof detail === "object") {
      throw new ApiError(
        response.status,
        detail.message ?? "下载失败",
        detail.fieldErrors ?? {},
      );
    }
    throw new ApiError(response.status, detail ?? "下载失败");
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encodedFilename = disposition.match(/filename\*=utf-8''([^;]+)/i)?.[1];
  const quotedFilename = disposition.match(/filename="([^"]+)"/i)?.[1];
  let filename = quotedFilename ?? fallbackFilename;
  if (encodedFilename) {
    try {
      filename = decodeURIComponent(encodedFilename);
    } catch {
      filename = fallbackFilename;
    }
  }
  return { blob: await response.blob(), filename };
}

export const workflowApi = {
  listWorkflowTemplates() {
    return request<WorkflowTemplate[]>("/api/workflow-templates");
  },
  publishWorkflowTemplate(payload: { sourceFlowId: string; name: string; description: string }, id?: string) {
    return request<{ id: string }>(id ? `/api/workflow-templates/${encodeURIComponent(id)}` : "/api/workflow-templates", {
      method: id ? "PUT" : "POST", body: JSON.stringify(payload),
    });
  },
  openWorkflowTemplateEditor(id: string) {
    return request<{ flow: ServerFlow; name: string; description: string }>(`/api/workflow-templates/${encodeURIComponent(id)}/edit`, { method: "POST" });
  },
  updateWorkflowTemplateFromDraft(id: string, payload: { sourceFlowId: string; name: string; description: string }) {
    return request<{ id: string }>(`/api/workflow-templates/${encodeURIComponent(id)}/edit`, { method: "PUT", body: JSON.stringify(payload) });
  },
  discardWorkflowTemplateDraft(id: string) {
    return request<void>(`/api/workflow-templates/${encodeURIComponent(id)}/edit`, { method: "DELETE" });
  },
  setWorkflowTemplateActive(id: string, active: boolean) {
    return request(`/api/workflow-templates/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ active }) });
  },
  deleteWorkflowTemplate(id: string) {
    return request<void>(`/api/workflow-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  useWorkflowTemplate(id: string) {
    return request<ServerFlow>(`/api/workflow-templates/${encodeURIComponent(id)}/use`, { method: "POST" });
  },
  listFlows() {
    return request<ServerFlow[]>("/api/workflows");
  },
  listWorkflowGroups() {
    return request<WorkflowGroup[]>("/api/workflow-groups");
  },
  createWorkflowGroup(name: string) {
    return request<WorkflowGroup>("/api/workflow-groups", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },
  renameWorkflowGroup(groupId: string, name: string) {
    return request<WorkflowGroup>(`/api/workflow-groups/${encodeURIComponent(groupId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },
  deleteWorkflowGroup(groupId: string) {
    return request<void>(`/api/workflow-groups/${encodeURIComponent(groupId)}`, {
      method: "DELETE",
    });
  },
  moveFlowToGroup(serverId: string, groupId: string | null) {
    return request<ServerFlow>(`/api/workflows/${encodeURIComponent(serverId)}/group`, {
      method: "PUT",
      body: JSON.stringify({ groupId }),
    });
  },
  createFlow(process: AcademicProcess) {
    return request<ServerFlow>("/api/workflows", {
      method: "POST",
      body: JSON.stringify({
        name: process.name,
        description: process.description,
        groupId: process.groupId,
      }),
    });
  },
  cloneFlow(serverId: string, name: string) {
    return request<ServerFlow>(`/api/workflows/${encodeURIComponent(serverId)}/clone`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },
  renameFlow(serverId: string, name: string) {
    return request<ServerFlow>(`/api/workflows/${encodeURIComponent(serverId)}/name`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },
  copyNode(flowId: string, node: AcademicFlowNode) {
    return request<AcademicFlowNode>(`/api/workflows/${encodeURIComponent(flowId)}/nodes/copy`, { method: "POST", body: JSON.stringify({ node }) });
  },
  saveDraft(serverId: string, process: AcademicProcess) {
    return request<ServerFlow>(`/api/workflows/${encodeURIComponent(serverId)}/draft`, {
      method: "PUT",
      body: JSON.stringify({
        answerSheetKeys: process.answerSheetKeys,
        config: { nodes: process.nodes, edges: process.edges },
      }),
    });
  },
  createPreview(serverId: string) {
    return request<{ instanceId: string; previewToken: string; previewUrl: string }>(
      `/api/workflows/${encodeURIComponent(serverId)}/preview`,
      { method: "POST" },
    );
  },
  getRevisionImpact(serverId: string, process: AcademicProcess) {
    return request<RevisionImpact>(
      `/api/workflows/${encodeURIComponent(serverId)}/revision-impact`,
      {
        method: "POST",
        body: JSON.stringify({
          answerSheetKeys: process.answerSheetKeys,
          config: createFlowConfig(process),
        }),
      },
    );
  },
  publish(
    serverId: string,
    process: AcademicProcess,
    expectedDraftConfigHash?: string | null,
    expectedCurrentVersionId?: string | null,
  ) {
    return request<PublishedFlow>(`/api/workflows/${encodeURIComponent(serverId)}/publish`, {
      method: "POST",
      body: JSON.stringify({
        answerSheetKeys: process.answerSheetKeys,
        config: createFlowConfig(process),
        ...createPublishRequestPayload(expectedDraftConfigHash, expectedCurrentVersionId),
      }),
    });
  },
  remove(serverId: string) {
    return request<void>(`/api/workflows/${serverId}`, { method: "DELETE" });
  },
  getRoster(serverId: string) {
    return request<FlowRoster>(`/api/workflows/${encodeURIComponent(serverId)}/roster`);
  },
  importRoster(
    serverId: string,
    payload: {
      entries: Array<{ name: string; studentNo: string }>;
      sourceFileName: string;
    },
  ) {
    return request<FlowRoster & { summary: { added: number; restored: number; updated: number } }>(
      `/api/workflows/${encodeURIComponent(serverId)}/roster/import`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },
  revokeRosterEntries(serverId: string, entryIds: number[]) {
    return request<FlowRoster>(`/api/workflows/${encodeURIComponent(serverId)}/roster/revoke`, {
      method: "POST", body: JSON.stringify({ entryIds }),
    });
  },
  revokeRosterEntry(serverId: string, entryId: number) {
    return request<FlowRoster>(
      `/api/workflows/${encodeURIComponent(serverId)}/roster/${entryId}`,
      { method: "DELETE" },
    );
  },
  enterFlow(flowId: string) {
    return request<RuntimeFlowInstance>(
      `/api/student/flows/${encodeURIComponent(flowId)}/enter`,
      { method: "POST" },
    );
  },
  getInstance(instanceId: string) {
    return request<RuntimeFlowInstance>(
      `/api/student/flow-instances/${encodeURIComponent(instanceId)}`,
    );
  },
  saveNodeDraft(nodeInstanceId: string, payload: Record<string, unknown>) {
    return request<RuntimeFlowInstance>(
      `/api/student/node-instances/${encodeURIComponent(nodeInstanceId)}/draft`,
      { method: "PUT", body: JSON.stringify({ payload }) },
    );
  },
  submitNode(
    nodeInstanceId: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ) {
    return request<RuntimeFlowInstance>(
      `/api/student/node-instances/${encodeURIComponent(nodeInstanceId)}/submit`,
      { method: "POST", body: JSON.stringify({ payload, idempotencyKey }) },
    );
  },
  retryAudit(nodeInstanceId: string) {
    return request<RuntimeFlowInstance>(
      `/api/student/node-instances/${encodeURIComponent(nodeInstanceId)}/audit/retry`,
      { method: "POST" },
    );
  },
  uploadFile(nodeInstanceId: string, file: File) {
    return request<UploadedFile>(
      `/api/student/node-instances/${encodeURIComponent(nodeInstanceId)}/file`,
      { method: "POST", body: createFileUploadBody(file) },
    );
  },
  listScans(nodeInstanceId: string) {
    return request<RuntimeScanFile[]>(
      `/api/student/node-instances/${encodeURIComponent(nodeInstanceId)}/scans`,
    );
  },
  uploadScan(nodeInstanceId: string, file: File) {
    return request<RuntimeScanFile>(
      `/api/student/node-instances/${encodeURIComponent(nodeInstanceId)}/scans`,
      { method: "POST", body: createFileUploadBody(file) },
    );
  },
  deleteScan(nodeInstanceId: string, fileId: string) {
    return request<{ deleted: boolean }>(
      `/api/student/node-instances/${encodeURIComponent(nodeInstanceId)}/scans/${encodeURIComponent(fileId)}`,
      { method: "DELETE" },
    );
  },
  reorderScans(nodeInstanceId: string, fileIds: string[]) {
    return request<RuntimeScanFile[]>(
      `/api/student/node-instances/${encodeURIComponent(nodeInstanceId)}/scans/order`,
      { method: "PUT", body: JSON.stringify({ fileIds }) },
    );
  },
  downloadNodeFile(fileId: string) {
    return request<{
      contentType: string;
      fileId: string;
      originalName: string;
      sizeBytes: number;
      url: string;
    }>(`/api/student/files/${encodeURIComponent(fileId)}/download`);
  },
  uploadNodeReference(flowId: string, nodeKey: string, file: File) {
    const body = new FormData(); body.append("file", file);
    return request<{ referenceAsset: NonNullable<AcademicProcess["nodes"][number]["referenceAsset"]> }>(
      `/api/workflows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeKey)}/reference`, { method: "POST", body });
  },
  deleteNodeReference(flowId: string, nodeKey: string, assetId: string) {
    return request<{ referenceAsset: null }>(`/api/workflows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeKey)}/reference?asset_id=${encodeURIComponent(assetId)}`, { method: "DELETE" });
  },
  downloadNodeReference(nodeInstanceId: string) {
    return request<{ url: string; originalName: string }>(`/api/student/node-instances/${encodeURIComponent(nodeInstanceId)}/reference/download`);
  },
  uploadNodeTemplate(flowId: string, nodeKey: string, file: File) {
    const body = new FormData();
    body.append("file", file);
    return request<{ draftConfigHash: string; templateAsset: NonNullable<AcademicProcess["nodes"][number]["templateAsset"]> }>(
      `/api/workflows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeKey)}/template`,
      { method: "POST", body },
    );
  },
  deleteNodeTemplate(flowId: string, nodeKey: string) {
    return request<{ templateAsset: null }>(
      `/api/workflows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeKey)}/template`,
      { method: "DELETE" },
    );
  },
  downloadNodeTemplate(nodeInstanceId: string) {
    return request<{ originalName: string; sizeBytes: number; url: string }>(
      `/api/student/node-instances/${encodeURIComponent(nodeInstanceId)}/template/download`,
      { method: "POST" },
    );
  },
  listAuditScripts() {
    return request<AuditScriptSummary[]>("/api/workflow-admin/audit-scripts");
  },
  getNodeAuditPolicy(flowId: string, nodeKey: string) {
    return request<NodeAuditPolicy>(
      `/api/workflows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeKey)}/audit-policy`,
    );
  },
  updateNodeAuditPolicy(
    flowId: string,
    nodeKey: string,
    payload: { modelCardId: string | null; expectedGeneration: number; params: Record<string, string | number | boolean> },
  ) {
    return request<NodeAuditPolicy>(
      `/api/workflows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeKey)}/audit-policy`,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },
  getNodeAnswerKeyPolicy(flowId: string, nodeKey: string) {
    return request<AnswerKeyPolicy>(
      `/api/workflows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeKey)}/answer-key-policy`,
    );
  },
  updateNodeAnswerKeyPolicy(
    flowId: string,
    nodeKey: string,
    payload: { expectedGeneration: number; gradingKey: AnswerSheetPrivateKey },
  ) {
    return request<AnswerKeyPolicy>(
      `/api/workflows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeKey)}/answer-key-policy`,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },
  listManageableAuditScripts() {
    return request<AuditScriptManagementSummary[]>(
      "/api/workflow-admin/audit-scripts/manage",
    );
  },
  getAuditScriptConfig(scriptId: string) {
    return request<AuditScriptConfigDetail>(
      `/api/workflow-admin/audit-scripts/${encodeURIComponent(scriptId)}`,
    );
  },
  updateAuditScriptConfig(scriptId: string, payload: AuditScriptConfigUpdate) {
    return request<AuditScriptConfigDetail>(
      `/api/workflow-admin/audit-scripts/${encodeURIComponent(scriptId)}`,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },
  getProgress(versionId: string) {
    return request<WorkflowProgress>(
      `/api/workflow-admin/versions/${encodeURIComponent(versionId)}/progress`,
    );
  },
  uploadPersonalFile(file: File) {
    const body = new FormData();
    body.append("file", file);
    return request<PersonalDriveFile>("/api/workflow-admin/personal-files", { method: "POST", body });
  },
  downloadPersonalFile(fileId: string) {
    return request<{ originalName: string; url: string }>(`/api/workflow-admin/personal-files/${encodeURIComponent(fileId)}/download`);
  },
  deletePersonalFile(fileId: string) {
    return request<{ deleted: boolean }>(`/api/workflow-admin/personal-files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  },
  getMaterialLibrary() {
    return request<MaterialLibrary>("/api/workflow-admin/material-library");
  },
  downloadMaterialLibraryFile(fileId: string) {
    return request<{ fileId: string; originalName: string; url: string }>(
      `/api/workflow-admin/material-library/files/${encodeURIComponent(fileId)}/download`,
    );
  },
  getManualReviewQueue(versionId: string, nodeKey: string) {
    return request<ManualReviewQueue>(`/api/workflow-admin/versions/${encodeURIComponent(versionId)}/nodes/${encodeURIComponent(nodeKey)}/manual-reviews`);
  },
  getManualReview(nodeInstanceId: string) {
    return request<ManualReviewDetail>(`/api/workflow-admin/node-instances/${encodeURIComponent(nodeInstanceId)}/manual-review`);
  },
  approveManualReview(nodeInstanceId: string, evidenceHash: string, remark: string, feedbackRevision: number, sourceNodeKey: string | null, sourceRemark: string) {
    return request<{ approved: boolean }>(`/api/workflow-admin/node-instances/${encodeURIComponent(nodeInstanceId)}/manual-review/approve`, {
      method: "POST", body: JSON.stringify({ evidenceHash, remark, feedbackRevision, sourceNodeKey, sourceRemark }),
    });
  },
  rejectManualSource(nodeInstanceId: string, evidenceHash: string, feedbackRevision: number, sourceNodeKey: string, sourceRemark: string) {
    return request<{ rejected: boolean }>(`/api/workflow-admin/node-instances/${encodeURIComponent(nodeInstanceId)}/manual-review/reject`, {
      method: "POST", body: JSON.stringify({ evidenceHash, feedbackRevision, sourceNodeKey, sourceRemark }),
    });
  },
  saveManualFeedback(nodeInstanceId: string, evidenceHash: string, remark: string, feedbackRevision: number) {
    return request<{ saved: boolean }>(`/api/workflow-admin/node-instances/${encodeURIComponent(nodeInstanceId)}/manual-review/feedback`, {
      method: "POST", body: JSON.stringify({ evidenceHash, remark, feedbackRevision }),
    });
  },
  uploadManualFeedback(nodeInstanceId: string, evidenceHash: string, revision: number, sourceFileId: string, file: File) {
    const body = new FormData();
    body.set("evidenceHash", evidenceHash); body.set("revision", String(revision)); body.set("sourceFileId", sourceFileId); body.set("file", file);
    return request<ManualFeedbackDraft>(`/api/workflow-admin/node-instances/${encodeURIComponent(nodeInstanceId)}/manual-review/files`, { method: "POST", body });
  },
  removeManualFeedback(nodeInstanceId: string, evidenceHash: string, revision: number, fileId: string) {
    return request<ManualFeedbackDraft>(`/api/workflow-admin/node-instances/${encodeURIComponent(nodeInstanceId)}/manual-review/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE", body: JSON.stringify({ evidenceHash, revision }),
    });
  },
  downloadManualFeedback(fileId: string, student: boolean) {
    return request<{ url: string }>(`/api/workflow-admin/manual-feedback/files/${encodeURIComponent(fileId)}/${student ? "student-download" : "download"}`);
  },
  getSubmissionDetail(nodeInstanceId: string) {
    return request<TeacherSubmissionDetail>(
      `/api/workflow-admin/node-instances/${encodeURIComponent(nodeInstanceId)}/submission-detail`,
    );
  },
  downloadTeacherMaterials(versionId: string, nodeKey: string | null) {
    const query = nodeKey ? `?nodeKey=${encodeURIComponent(nodeKey)}` : "";
    return downloadRequest(
      `/api/workflow-admin/versions/${encodeURIComponent(versionId)}/materials/download${query}`,
    );
  },
  exportTeacherNodeSubmissions(versionId: string, nodeKey: string) {
    return downloadRequest(
      `/api/workflow-admin/versions/${encodeURIComponent(versionId)}/nodes/${encodeURIComponent(nodeKey)}/submissions/export`,
      "节点填写数据.xlsx",
    );
  },
  getTeacherNodePackageOptions(versionId: string, nodeKey: string) {
    return request<NodePackageOptions>(
      `/api/workflow-admin/versions/${encodeURIComponent(versionId)}/nodes/${encodeURIComponent(nodeKey)}/package/options`,
    );
  },
  downloadTeacherNodePackage(
    versionId: string,
    nodeKey: string,
    payload: NodePackageDownloadRequest,
  ) {
    return downloadRequest(
      `/api/workflow-admin/versions/${encodeURIComponent(versionId)}/nodes/${encodeURIComponent(nodeKey)}/package/download`,
      "节点资料包.zip",
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      },
    );
  },
  downloadTeacherNodeMaterials(nodeInstanceId: string) {
    return downloadRequest(
      `/api/workflow-admin/node-instances/${encodeURIComponent(nodeInstanceId)}/materials/download`,
    );
  },
  manualApproveSubmission(nodeInstanceId: string, submissionId: string, reason: string) {
    return request<{ status: "approved" }>(
      `/api/workflow-admin/node-instances/${encodeURIComponent(nodeInstanceId)}/manual-approve`,
      { method: "POST", body: JSON.stringify({ submissionId, reason }) },
    );
  },
  setStudentDeadline(instanceId: string, nodeKey: string, deadlineAt: string, reason: string) {
    return request<RuntimeFlowInstance>(
      `/api/workflow-admin/instances/${encodeURIComponent(instanceId)}/nodes/${encodeURIComponent(nodeKey)}/deadline`,
      { method: "PUT", body: JSON.stringify({ deadlineAt, reason }) },
    );
  },
};
