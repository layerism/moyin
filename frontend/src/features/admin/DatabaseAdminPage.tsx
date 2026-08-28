import { useEffect, useMemo, useState } from "react";

import type { AuthIdentity } from "../auth/authApi";
import {
  databaseAdminApi,
  type AdminColumn,
  type AdminRows,
  type AdminTable,
  type AdminTableSchema,
} from "./databaseAdminApi";

const PAGE_SIZE = 50;

export function DatabaseAdminPage({
  identity,
  onBack,
}: {
  identity: AuthIdentity;
  onBack: () => void;
}) {
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [activeTable, setActiveTable] = useState("");
  const [schema, setSchema] = useState<AdminTableSchema | null>(null);
  const [rowPage, setRowPage] = useState<AdminRows | null>(null);
  const [offset, setOffset] = useState(0);
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);
  const [deletingRow, setDeletingRow] = useState<Record<string, unknown> | null>(null);
  const [resettingStudent, setResettingStudent] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const loadTables = async () => {
    const nextTables = await databaseAdminApi.listTables();
    setTables(nextTables);
    setActiveTable((current) => current || nextTables[0]?.name || "");
  };

  useEffect(() => {
    setLoading(true);
    loadTables()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeTable) return;
    setLoading(true);
    setError("");
    Promise.all([
      databaseAdminApi.getSchema(activeTable),
      databaseAdminApi.getRows(activeTable, offset, PAGE_SIZE),
    ])
      .then(([nextSchema, rows]) => {
        setSchema(nextSchema);
        setRowPage(rows);
        setEditingRow(null);
        setDeletingRow(null);
        setResettingStudent(null);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [activeTable, offset]);

  const selectTable = (name: string) => {
    setOffset(0);
    setActiveTable(name);
    setNotice("");
  };

  if (identity.role !== "super_admin") {
    return (
      <main className="database-admin-denied">
        <h1>无权访问数据库管理</h1>
        <button onClick={onBack}>返回首页</button>
      </main>
    );
  }

  return (
    <main className="database-admin-page">
      <header className="database-admin-header">
        <div>
          <span className="oa-brand-mark">DB</span>
          <div>
            <strong>数据库管理</strong>
            <small>超级管理员 · {identity.name}（{identity.employeeNo}）</small>
          </div>
        </div>
        <button onClick={onBack}>返回首页</button>
      </header>
      <section className="database-admin-layout">
        <aside className="database-table-nav">
          <h2>数据表</h2>
          <p>{tables.length} 个数据表</p>
          <nav aria-label="数据库表列表">
            {tables.map((table) => (
              <button
                className={table.name === activeTable ? "active" : ""}
                key={table.name}
                onClick={() => selectTable(table.name)}
                type="button"
              >
                <span>{table.name}</span>
                <small>{table.rowCount}</small>
              </button>
            ))}
          </nav>
        </aside>
        <section className="database-table-main">
          <div className="database-table-toolbar">
            <div>
              <p>当前数据表</p>
              <h1>{activeTable || "正在加载"}</h1>
            </div>
            <div>
              <span>{rowPage?.total ?? 0} 条记录</span>
              <button
                disabled={!activeTable || loading}
                onClick={() => {
                  setOffset(0);
                  void loadTables();
                  if (activeTable) {
                    void databaseAdminApi.getRows(activeTable, 0, PAGE_SIZE).then(setRowPage);
                  }
                }}
              >
                刷新
              </button>
            </div>
          </div>
          {error ? <p className="database-admin-message error" role="alert">{error}</p> : null}
          {notice ? <p className="database-admin-message">{notice}</p> : null}
          <DatabaseRowsTable
            deletable={schema?.deletable ?? false}
            loading={loading}
            onDelete={setDeletingRow}
            onEdit={setEditingRow}
            rows={rowPage?.rows ?? []}
            schema={schema}
          />
          <div className="database-pagination">
            <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              上一页
            </button>
            <span>第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span>
            <button
              disabled={loading || offset + PAGE_SIZE >= (rowPage?.total ?? 0)}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              下一页
            </button>
          </div>
        </section>
      </section>
      {editingRow && schema ? (
        <DatabaseRowEditor
          key={`${activeTable}-${JSON.stringify(primaryKey(schema, editingRow))}`}
          onClose={() => setEditingRow(null)}
          onResetPassword={
            activeTable === "student_accounts" && editingRow.account_kind === "normal"
              ? () => setResettingStudent(editingRow)
              : undefined
          }
          onSaved={async () => {
            setEditingRow(null);
            setNotice("记录已保存；修改前数据库备份和审计记录已生成");
            setRowPage(await databaseAdminApi.getRows(activeTable, offset, PAGE_SIZE));
            await loadTables();
          }}
          row={editingRow}
          schema={schema}
          table={activeTable}
        />
      ) : null}
      {resettingStudent ? (
        <StudentPasswordResetDialog
          key={`student-password-reset-${String(resettingStudent.id)}`}
          onClose={() => setResettingStudent(null)}
          onReset={async () => {
            setResettingStudent(null);
            setEditingRow(null);
            setNotice("学生密码已重置为 123；原流程数据保留，学生下次登录必须修改密码");
            setRowPage(await databaseAdminApi.getRows(activeTable, offset, PAGE_SIZE));
            await loadTables();
          }}
          row={resettingStudent}
        />
      ) : null}
      {deletingRow && schema ? (
        <DatabaseRowDeleteDialog
          key={`${activeTable}-${JSON.stringify(primaryKey(schema, deletingRow))}`}
          onClose={() => setDeletingRow(null)}
          onDeleted={async () => {
            setDeletingRow(null);
            setNotice("记录已删除；删除前数据库备份和审计记录已生成");
            const rows = await databaseAdminApi.getRows(activeTable, offset, PAGE_SIZE);
            if (rows.rows.length === 0 && offset > 0) {
              setOffset(Math.max(0, offset - PAGE_SIZE));
            } else {
              setRowPage(rows);
            }
            await loadTables();
          }}
          row={deletingRow}
          schema={schema}
          table={activeTable}
        />
      ) : null}
    </main>
  );
}

function DatabaseRowsTable({
  deletable,
  loading,
  onDelete,
  onEdit,
  rows,
  schema,
}: {
  deletable: boolean;
  loading: boolean;
  onDelete: (row: Record<string, unknown>) => void;
  onEdit: (row: Record<string, unknown>) => void;
  rows: Array<Record<string, unknown>>;
  schema: AdminTableSchema | null;
}) {
  if (loading && rows.length === 0) return <p className="database-empty">正在读取数据库记录</p>;
  if (!schema || rows.length === 0) return <p className="database-empty">该表暂无记录</p>;
  return (
    <div className="database-grid-scroll">
      <table className="database-grid">
        <thead>
          <tr>
            {schema.columns.map((column) => <th key={column.name}>{column.name}</th>)}
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={JSON.stringify(primaryKey(schema, row))}>
              {schema.columns.map((column) => (
                <td key={column.name} title={displayValue(row[column.name])}>
                  {displayValue(row[column.name])}
                </td>
              ))}
              <td>
                <div className="database-row-actions">
                  <button onClick={() => onEdit(row)}>查看</button>
                  {deletable ? (
                    <button className="danger" onClick={() => onDelete(row)}>删除</button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DatabaseRowDeleteDialog({
  onClose,
  onDeleted,
  row,
  schema,
  table,
}: {
  onClose: () => void;
  onDeleted: () => Promise<void>;
  row: Record<string, unknown>;
  schema: AdminTableSchema;
  table: string;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const key = primaryKey(schema, row);

  const remove = async () => {
    if (!reason.trim()) {
      setError("请填写删除原因");
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await databaseAdminApi.deleteRow(table, { key, reason: reason.trim() });
      await onDeleted();
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="database-editor-backdrop database-delete-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="database-delete-title"
        aria-modal="true"
        className="database-delete-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="database-delete-icon" aria-hidden="true">!</div>
        <h2 id="database-delete-title">确认删除这条记录？</h2>
        <p>删除后无法撤销，关联数据可能同时被删除。系统将在执行前自动备份数据库。</p>
        <dl>
          <div><dt>数据表</dt><dd>{table}</dd></div>
          <div><dt>主键</dt><dd>{JSON.stringify(key)}</dd></div>
        </dl>
        <label>
          <span>删除原因</span>
          <input
            autoFocus
            disabled={deleting}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            placeholder="请说明删除原因（必填）"
            value={reason}
          />
        </label>
        {error ? <p className="database-delete-error" role="alert">{error}</p> : null}
        <footer>
          <button disabled={deleting} onClick={onClose}>取消</button>
          <button className="danger-action" disabled={deleting} onClick={() => void remove()}>
            {deleting ? "正在删除" : "确认删除"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function StudentPasswordResetDialog({
  onClose,
  onReset,
  row,
}: {
  onClose: () => void;
  onReset: () => Promise<void>;
  row: Record<string, unknown>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);

  const reset = async () => {
    if (!reason.trim()) {
      setError("请填写重置原因");
      return;
    }
    const studentId = Number(row.id);
    if (!Number.isInteger(studentId)) {
      setError("学生账号 ID 无效");
      return;
    }
    setResetting(true);
    setError("");
    try {
      await databaseAdminApi.resetStudentPassword(studentId, reason.trim());
      await onReset();
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "密码重置失败");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="database-editor-backdrop database-delete-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="student-password-reset-title"
        aria-modal="true"
        className="database-delete-dialog database-reset-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="database-delete-icon database-reset-icon" aria-hidden="true">!</div>
        <h2 id="student-password-reset-title">重置学生密码？</h2>
        <p>执行后该学生现有登录状态将全部失效，下次登录必须先设置新密码。</p>
        <dl>
          <div><dt>学生</dt><dd>{String(row.name)}（{String(row.student_no)}）</dd></div>
          <div><dt>临时密码</dt><dd>123</dd></div>
          <div><dt>数据保留</dt><dd>流程、草稿、提交、成绩和文件均不删除</dd></div>
        </dl>
        <label>
          <span>重置原因</span>
          <input
            autoFocus
            disabled={resetting}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            placeholder="请说明重置原因（必填）"
            value={reason}
          />
        </label>
        {error ? <p className="database-delete-error" role="alert">{error}</p> : null}
        <footer>
          <button disabled={resetting} onClick={onClose}>取消</button>
          <button
            className="primary-action"
            disabled={resetting}
            onClick={() => void reset()}
          >
            {resetting ? "正在重置" : "确认重置"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function DatabaseRowEditor({
  onClose,
  onResetPassword,
  onSaved,
  row,
  schema,
  table,
}: {
  onClose: () => void;
  onResetPassword?: () => void;
  onSaved: () => Promise<void>;
  row: Record<string, unknown>;
  schema: AdminTableSchema;
  table: string;
}) {
  const editableColumns = useMemo(() => schema.columns.filter((column) => column.editable), [schema]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(schema.columns.map((column) => [column.name, displayValue(row[column.name])])),
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const changes = Object.fromEntries(
      editableColumns
        .filter((column) => values[column.name] !== displayValue(row[column.name]))
        .map((column) => [column.name, coerceValue(column, values[column.name])]),
    );
    if (!reason.trim()) {
      setError("请填写修改原因");
      return;
    }
    if (Object.keys(changes).length === 0) {
      setError("没有发生字段变化");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await databaseAdminApi.updateRow(table, {
        changes,
        key: primaryKey(schema, row),
        reason: reason.trim(),
      });
      await onSaved();
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="database-editor-backdrop" onMouseDown={onClose}>
      <aside className="database-row-editor" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><small>数据表</small><h2>{table}</h2></div>
          <button aria-label="关闭记录编辑器" onClick={onClose}>×</button>
        </header>
        <div className="database-field-list">
          {schema.columns.map((column) => (
            <label key={column.name}>
              <span>{column.name}<em>{column.primaryKey ? "主键" : column.editable ? "可编辑" : "只读"}</em></span>
              <textarea
                disabled={!column.editable}
                onChange={(event) => setValues((current) => ({ ...current, [column.name]: event.target.value }))}
                rows={longValue(values[column.name]) ? 5 : 1}
                value={values[column.name]}
              />
            </label>
          ))}
          {editableColumns.length > 0 ? (
            <label>
              <span>修改原因<em>必填</em></span>
              <input maxLength={300} onChange={(event) => setReason(event.target.value)} value={reason} />
            </label>
          ) : null}
        </div>
        {error ? <p className="database-editor-error" role="alert">{error}</p> : null}
        <footer>
          {onResetPassword ? (
            <button
              className="database-reset-password-action"
              disabled={saving}
              onClick={onResetPassword}
            >
              重置密码
            </button>
          ) : null}
          <button disabled={saving} onClick={onClose}>取消</button>
          <button className="primary-action" disabled={saving || editableColumns.length === 0} onClick={() => void save()}>
            {saving ? "保存中" : editableColumns.length === 0 ? "只读记录" : "保存修改"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function primaryKey(schema: AdminTableSchema, row: Record<string, unknown>) {
  return Object.fromEntries(
    schema.columns.filter((column) => column.primaryKey).map((column) => [column.name, row[column.name]]),
  );
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function coerceValue(column: AdminColumn, value: string): unknown {
  if (!value && column.nullable) return null;
  if (column.type.toUpperCase().includes("INT")) return Number.parseInt(value, 10);
  if (column.type.toUpperCase().includes("REAL")) return Number.parseFloat(value);
  return value;
}

function longValue(value: string) {
  return value.length > 100 || value.includes("\n") || value.startsWith("{") || value.startsWith("[");
}
