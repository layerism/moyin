export type AuthRole = "student" | "teacher";

export type AuthIdentity = {
  employeeNo?: string;
  id: number;
  mustChangePassword?: boolean;
  name: string;
  role?: "super_admin" | "teacher";
  studentNo?: string;
};

export type RoleCredentials = {
  identifier: string;
  name: string;
  password: string;
};

export type StudentFlowSummary = {
  flowId: string;
  instanceId: string | null;
  lastActiveAt: string | null;
  name: string;
  status: "completed" | "in_progress" | "not_started";
};

export class AuthApiError extends Error {
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
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new AuthApiError(response.status, body?.detail ?? "请求失败");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function payload(role: AuthRole, credentials: RoleCredentials) {
  return role === "teacher"
    ? {
        employeeNo: credentials.identifier,
        name: credentials.name,
        password: credentials.password,
      }
    : {
        studentNo: credentials.identifier,
        name: credentials.name,
        password: credentials.password,
      };
}

const pendingLogouts = new Map<AuthRole, Promise<void>>();

export const authApi = {
  changeStudentPassword(newPassword: string) {
    return request<AuthIdentity>("/api/auth/student/change-password", {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    });
  },
  async login(role: AuthRole, credentials: RoleCredentials) {
    await pendingLogouts.get(role);
    return request<AuthIdentity>(`/api/auth/${role}/login`, {
      method: "POST",
      body: JSON.stringify(payload(role, credentials)),
    });
  },
  registerStudent(credentials: RoleCredentials) {
    return request<AuthIdentity>("/api/auth/student/register", {
      method: "POST",
      body: JSON.stringify(payload("student", credentials)),
    });
  },
  me(role: AuthRole) {
    return request<AuthIdentity>(`/api/auth/${role}/me`);
  },
  logout(role: AuthRole) {
    const pending = pendingLogouts.get(role);
    if (pending) return pending;
    const logout = request<void>(`/api/auth/${role}/logout`, { method: "POST" })
      .finally(() => pendingLogouts.delete(role));
    pendingLogouts.set(role, logout);
    return logout;
  },
  studentFlows() {
    return request<StudentFlowSummary[]>("/api/student/flows");
  },
};
