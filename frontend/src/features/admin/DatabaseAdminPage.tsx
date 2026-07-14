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
          <p>{tables.length} 个业务表</p>
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
            loading={loading}
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
    </main>
  );
}

function DatabaseRowsTable({
  loading,
  onEdit,
  rows,
  schema,
}: {
  loading: boolean;
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
              <td><button onClick={() => onEdit(row)}>查看</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DatabaseRowEditor({
  onClose,
  onSaved,
  row,
  schema,
  table,
}: {
  onClose: () => void;
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
