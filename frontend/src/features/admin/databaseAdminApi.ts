export type AdminTable = {
  deletable: boolean;
  editableColumns: string[];
  name: string;
  rowCount: number;
};

export type AdminColumn = {
  editable: boolean;
  name: string;
  nullable: boolean;
  primaryKey: boolean;
  sensitive: boolean;
  type: string;
};

export type AdminTableSchema = {
  columns: AdminColumn[];
  deletable: boolean;
  name: string;
};

export type AdminRows = {
  limit: number;
  offset: number;
  rows: Array<Record<string, unknown>>;
  total: number;
};

class DatabaseAdminApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new DatabaseAdminApiError(body?.detail ?? "数据库管理请求失败");
  }
  return response.json() as Promise<T>;
}

export const databaseAdminApi = {
  resetStudentPassword(studentId: number, reason: string) {
    return request<{ backupCreated: boolean; reset: boolean }>(
      `/api/admin/database/student-accounts/${studentId}/reset-password`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  },
  listTables() {
    return request<AdminTable[]>("/api/admin/database/tables");
  },
  getSchema(table: string) {
    return request<AdminTableSchema>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/schema`,
    );
  },
  getRows(table: string, offset: number, limit = 50) {
    return request<AdminRows>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/rows?offset=${offset}&limit=${limit}`,
    );
  },
  updateRow(
    table: string,
    payload: { changes: Record<string, unknown>; key: Record<string, unknown>; reason: string },
  ) {
    return request<{ backupCreated: boolean; row: Record<string, unknown> }>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/rows`,
      { method: "PATCH", body: JSON.stringify(payload) },
    );
  },
  deleteRow(
    table: string,
    payload: { key: Record<string, unknown>; reason: string },
  ) {
    return request<{ backupCreated: boolean; deleted: boolean }>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/rows`,
      { method: "DELETE", body: JSON.stringify(payload) },
    );
  },
};
