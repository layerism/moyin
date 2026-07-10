import type { AcademicProcess } from "../../types";
import type {
  PublishedFlow,
  RuntimeFlowInstance,
  SharedFlow,
  StudentIdentity,
  WorkflowProgress,
} from "./runtimeTypes";

export type ServerFlow = {
  config: { edges: AcademicProcess["edges"]; nodes: AcademicProcess["nodes"] };
  createdAt: string;
  description: string;
  id: string;
  name: string;
  status: "draft" | "published";
  updatedAt: string;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(response.status, body?.detail ?? "请求失败");
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
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
  saveDraft(serverId: string, process: AcademicProcess) {
    return request(`/api/workflows/${serverId}/draft`, {
      method: "PUT",
      body: JSON.stringify({ config: { nodes: process.nodes, edges: process.edges } }),
    });
  },
  publish(serverId: string) {
    return request<PublishedFlow>(`/api/workflows/${serverId}/publish`, { method: "POST" });
  },
  archive(serverId: string) {
    return request<void>(`/api/workflows/${serverId}`, { method: "DELETE" });
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
  getProgress(versionId: string) {
    return request<WorkflowProgress>(
      `/api/workflow-admin/versions/${encodeURIComponent(versionId)}/progress`,
    );
  },
  setGlobalDeadline(versionId: string, nodeKey: string, deadlineAt: string, reason: string) {
    return request<{ updated: boolean }>(
      `/api/workflow-admin/versions/${encodeURIComponent(versionId)}/nodes/${encodeURIComponent(nodeKey)}/deadline`,
      { method: "PATCH", body: JSON.stringify({ deadlineAt, reason }) },
    );
  },
  setStudentDeadline(instanceId: string, nodeKey: string, deadlineAt: string, reason: string) {
    return request<RuntimeFlowInstance>(
      `/api/workflow-admin/instances/${encodeURIComponent(instanceId)}/nodes/${encodeURIComponent(nodeKey)}/deadline`,
      { method: "PUT", body: JSON.stringify({ deadlineAt, reason }) },
    );
  },
};
