import type { AcademicFlowConfig, AcademicProcess } from "../../types";
import { createFileUploadBody, type UploadedFile } from "./fileUpload";
import type { AuditScriptSummary, NodeAuditPolicy } from "./auditScripts";
import type {
  AuditScriptConfigDetail,
  AuditScriptConfigUpdate,
  AuditScriptManagementSummary,
} from "./auditScriptConfig";
import type {
  PublishedFlow,
  RevisionImpact,
  RuntimeFlowInstance,
  RuntimeScanFile,
  SharedFlow,
  StudentIdentity,
  TeacherSubmissionDetail,
  WorkflowProgress,
} from "./runtimeTypes";
import { createFlowConfig, createPublishRequestPayload } from "./flowRevision";

export const FLOW_PREVIEW_TOKEN_KEY = "oa-flow-preview-token";

export type ServerFlow = {
  config: AcademicFlowConfig;
  createdAt: string;
  description: string;
  draftConfig: AcademicFlowConfig;
  hasUnpublishedChanges: boolean;
  id: string;
  name: string;
  publishedNodeIds: string[];
  publishedVersionId: string | null;
  publishedVersionNo: number | null;
  shareUrl: string;
  status: "draft" | "published";
  updatedAt: string;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isMultipart =
    typeof FormData !== "undefined" && init?.body instanceof FormData;
  const headers = new Headers(init?.headers);
  if (!isMultipart && init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const previewToken = window.sessionStorage.getItem(FLOW_PREVIEW_TOKEN_KEY);
  if (previewToken) {
    headers.set("X-Flow-Preview-Token", previewToken);
  }
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
): Promise<{ blob: Blob; filename: string }> {
  const headers = new Headers();
  const previewToken = window.sessionStorage.getItem(FLOW_PREVIEW_TOKEN_KEY);
  if (previewToken) {
    headers.set("X-Flow-Preview-Token", previewToken);
  }
  const response = await fetch(path, { credentials: "include", headers });
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
  listFlows() {
    return request<ServerFlow[]>("/api/workflows");
  },
  createFlow(process: AcademicProcess) {
    return request<{ id: string }>("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ name: process.name, description: process.description }),
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
  saveDraft(serverId: string, process: AcademicProcess) {
    return request<ServerFlow>(`/api/workflows/${encodeURIComponent(serverId)}/draft`, {
      method: "PUT",
      body: JSON.stringify({ config: { nodes: process.nodes, edges: process.edges } }),
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
        body: JSON.stringify({ config: createFlowConfig(process) }),
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
  revokeRosterEntry(serverId: string, entryId: number) {
    return request<FlowRoster>(
      `/api/workflows/${encodeURIComponent(serverId)}/roster/${entryId}`,
      { method: "DELETE" },
    );
  },
  getShared(token: string) {
    return request<SharedFlow>(`/api/shared-flows/${encodeURIComponent(token)}`);
  },
  me() {
    return request<StudentIdentity>("/api/auth/me");
  },
  register(payload: { name: string; password: string; studentNo: string }) {
    return request<StudentIdentity>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  login(payload: { name: string; password: string; studentNo: string }) {
    return request<StudentIdentity>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  logout() {
    return request<void>("/api/auth/logout", { method: "POST" });
  },
  enterShared(token: string) {
    return request<RuntimeFlowInstance>(
      `/api/student/shared/${encodeURIComponent(token)}/enter`,
      { method: "POST" },
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
    payload: { expectedGeneration: number; params: Record<string, string | number | boolean> },
  ) {
    return request<NodeAuditPolicy>(
      `/api/workflows/${encodeURIComponent(flowId)}/nodes/${encodeURIComponent(nodeKey)}/audit-policy`,
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
  downloadTeacherNodePackage(versionId: string, nodeKey: string) {
    return downloadRequest(
      `/api/workflow-admin/versions/${encodeURIComponent(versionId)}/nodes/${encodeURIComponent(nodeKey)}/package/download`,
      "节点资料包.zip",
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
