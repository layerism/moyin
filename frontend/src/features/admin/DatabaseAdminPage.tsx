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
  const [view, setView] = useState<"data" | "schema">("data");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);
  const [deletingRow, setDeletingRow] = useState<Record<string, unknown> | null>(null);
  const [resettingStudent, setResettingStudent] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const loadTables = async () => {
    const nextTables = await databaseAdminApi.listTables();
    setTables(nextTables);
    setActiveTable((current) => current || nextTables.find((table) => table.name === "flows")?.name || nextTables[0]?.name || "");
  };

  useEffect(() => {
    setLoading(true);
    loadTables()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeTable) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      databaseAdminApi.getSchema(activeTable),
      databaseAdminApi.getRows(activeTable, offset, PAGE_SIZE),
    ])
      .then(([nextSchema, rows]) => {
        if (cancelled) return;
        setSchema(nextSchema);
        setRowPage(rows);
        setEditingRow(null);
        setDeletingRow(null);
        setResettingStudent(null);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeTable, offset, refreshVersion]);

  const selectTable = (name: string) => {
    setSchema(null);
    setRowPage(null);
    setLoading(true);
    setEditingRow(null);
    setDeletingRow(null);
    setResettingStudent(null);
    setOffset(0);
    setActiveTable(name);
    setError("");
    setNotice("");
  };

  const changePage = (nextOffset: number) => {
    setRowPage(null);
    setLoading(true);
    setOffset(nextOffset);
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
          <h1>数据库管理</h1>
          <span className="database-table-count">{tables.length} 个数据表</span>
        </div>
        <span className="database-admin-identity">超级管理员 · {identity.name}</span>
        <button onClick={onBack}>返回首页</button>
      </header>
      <section className="database-admin-layout">
        <section className="database-table-main">
          <div className="database-table-toolbar">
            <label className="database-table-picker">
              <span>数据表</span>
              <select
                aria-label="选择数据表"
                disabled={tables.length === 0}
                onChange={(event) => selectTable(event.target.value)}
                value={activeTable}
              >
                {tables.length === 0 ? <option value="">{loading ? "正在加载" : "暂无数据表"}</option> : null}
                {tables.map((table) => <option key={table.name} value={table.name}>{table.name}</option>)}
              </select>
            </label>
            <span className="database-record-count">
              {rowPage ? `${rowPage.total} 条记录` : loading ? "读取中…" : "—"}
            </span>
            <div className="database-toolbar-actions">
              <div className="database-view-switch" aria-label="查看方式" role="group">
                <button aria-pressed={view === "data"} onClick={() => setView("data")}>数据</button>
                <button aria-pressed={view === "schema"} onClick={() => setView("schema")}>结构</button>
              </div>
              <button
                disabled={loading}
                onClick={() => {
                  setError("");
                  setRowPage(null);
                  setLoading(true);
                  setOffset(0);
                  if (activeTable) {
                    setRefreshVersion((current) => current + 1);
                  } else {
                    void loadTables()
                      .catch((reason: Error) => setError(reason.message))
                      .finally(() => setLoading(false));
                  }
                }}
              >
                刷新
              </button>
            </div>
          </div>
          {error ? <p className="database-admin-message error" role="alert">{error}</p> : null}
          {notice ? <p className="database-admin-message">{notice}</p> : null}
          {view === "data" ? <DatabaseRowsTable
            deletable={schema?.deletable ?? false}
            error={error}
            loading={loading}
            offset={offset}
            onDelete={setDeletingRow}
            onEdit={setEditingRow}
            rows={rowPage?.rows ?? []}
            schema={schema}
          /> : <DatabaseSchemaTable error={error} loading={loading} schema={schema} />}
          <div className="database-pagination">
            <span className="database-record-range">
              {view === "schema"
                ? `${schema?.columns.length ?? 0} 个字段`
                : rowPage
                  ? rowPage.total > 0 ? `${offset + 1}–${offset + rowPage.rows.length} / ${rowPage.total} 条` : "0 条记录"
                  : loading ? "正在读取记录" : "记录未加载"}
            </span>
            {view === "data" ? (
              <>
                <button disabled={offset === 0 || loading} onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))}>
                  上一页
                </button>
                <span>{Math.floor(offset / PAGE_SIZE) + 1} / {rowPage ? Math.max(1, Math.ceil(rowPage.total / PAGE_SIZE)) : "—"}</span>
                <button
                  disabled={loading || offset + PAGE_SIZE >= (rowPage?.total ?? 0)}
                  onClick={() => changePage(offset + PAGE_SIZE)}
                >
                  下一页
                </button>
              </>
            ) : null}
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
  error,
  loading,
  offset,
  onDelete,
  onEdit,
  rows,
  schema,
}: {
  deletable: boolean;
  error: string;
  loading: boolean;
  offset: number;
  onDelete: (row: Record<string, unknown>) => void;
  onEdit: (row: Record<string, unknown>) => void;
  rows: Array<Record<string, unknown>>;
  schema: AdminTableSchema | null;
}) {
  if (loading && rows.length === 0) return <p className="database-empty">正在读取数据库记录</p>;
  if (error && rows.length === 0) return <p className="database-empty">记录读取失败，请点击刷新重试</p>;
  if (!schema || rows.length === 0) return <p className="database-empty">该表暂无记录</p>;
  const widths = schema.columns.map((column) => column.type.toUpperCase().includes("INT") ? 110 : 200);
  const hasPrimaryKey = schema.columns.some((column) => column.primaryKey);
  return (
    <div className="database-grid-scroll" key={`${schema.name}-${offset}`} tabIndex={0} aria-label={`${schema.name} 数据记录，可横向滚动查看全部字段`}>
      <table className="database-grid" style={{ width: widths.reduce((sum, width) => sum + width, 176) }}>
        <colgroup>
          <col style={{ width: 48 }} />
          {schema.columns.map((column, index) => <col key={column.name} style={{ width: widths[index] }} />)}
          <col style={{ width: 128 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="database-row-number" scope="col">#</th>
            {schema.columns.map((column) => <th key={column.name} scope="col">{column.name}</th>)}
            <th className="database-actions-cell" scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={hasPrimaryKey ? JSON.stringify(primaryKey(schema, row)) : offset + index}>
              <td className="database-row-number">{offset + index + 1}</td>
              {schema.columns.map((column) => (
                <td key={column.name} title={displayValue(row[column.name])}>
                  <span className="database-cell-value">{row[column.name] === null ? <span className="database-null">NULL</span> : displayValue(row[column.name])}</span>
                </td>
              ))}
              <td className="database-actions-cell">
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

function DatabaseSchemaTable({ error, loading, schema }: {
  error: string;
  loading: boolean;
  schema: AdminTableSchema | null;
}) {
  if (!schema) return <p className="database-empty">{loading ? "正在读取字段结构" : error ? "字段读取失败，请点击刷新重试" : "暂无字段"}</p>;
  return (
    <div className="database-grid-scroll" tabIndex={0} aria-label="数据表字段结构">
      <table className="database-grid database-schema-grid">
        <colgroup><col style={{ width: 48 }} /><col /><col style={{ width: 120 }} /><col style={{ width: 140 }} /><col style={{ width: 110 }} /></colgroup>
        <thead><tr><th className="database-row-number" scope="col">#</th><th scope="col">字段名</th><th scope="col">类型</th><th scope="col">约束</th><th scope="col">显示权限</th></tr></thead>
        <tbody>{schema.columns.map((column, index) => (
          <tr key={column.name}>
            <td className="database-row-number">{index + 1}</td>
            <td>{column.name}</td>
            <td>{column.type || "—"}</td>
            <td>{column.primaryKey ? "主键" : column.nullable ? "允许空值" : "非空"}</td>
            <td>{column.sensitive ? "已脱敏" : column.editable ? "可编辑" : "只读"}</td>
          </tr>
        ))}</tbody>
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
