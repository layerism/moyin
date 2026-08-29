import type { AuthIdentity } from "./authApi";

export type TeacherInvitationSummary = {
  employeeNo: string;
  expiresAt: string;
  name: string;
};

class TeacherInvitationApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new TeacherInvitationApiError(body?.detail ?? "邀请链接无效或已失效");
  }
  return response.json() as Promise<T>;
}

export const teacherInvitationApi = {
  accept(token: string, password: string) {
    return request<AuthIdentity>(
      `/api/auth/teacher-invitations/${encodeURIComponent(token)}/accept`,
      { method: "POST", body: JSON.stringify({ password }) },
    );
  },
  get(token: string) {
    return request<TeacherInvitationSummary>(
      `/api/auth/teacher-invitations/${encodeURIComponent(token)}`,
    );
  },
};
