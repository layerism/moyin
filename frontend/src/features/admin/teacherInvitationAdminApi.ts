export type TeacherInvitationStatus = "active" | "used" | "expired" | "revoked";

export type TeacherInvitationRecord = {
  createdAt: string;
  employeeNo: string;
  expiresAt: string;
  id: string;
  name: string;
  revokedAt: string | null;
  status: TeacherInvitationStatus;
  usedAt: string | null;
};

export type CreatedTeacherInvitation = TeacherInvitationRecord & { token: string };

class TeacherInvitationAdminApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new TeacherInvitationAdminApiError(body?.detail ?? "教师邀请请求失败");
  }
  return response.json() as Promise<T>;
}

export const teacherInvitationAdminApi = {
  create(payload: { employeeNo: string; expiresAt: string; name: string }) {
    return request<CreatedTeacherInvitation>("/api/admin/teacher-invitations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  list() {
    return request<TeacherInvitationRecord[]>("/api/admin/teacher-invitations");
  },
  revoke(id: string) {
    return request<TeacherInvitationRecord>(
      `/api/admin/teacher-invitations/${encodeURIComponent(id)}/revoke`,
      { method: "POST" },
    );
  },
};
