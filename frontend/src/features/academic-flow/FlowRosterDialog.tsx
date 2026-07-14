import { useEffect, useMemo, useState } from "react";

import { parseFlowRoster, type FlowRosterParseResult } from "../../utils/roster";
import {
  workflowApi,
  type FlowRoster,
  type FlowRosterEntry,
} from "./api";

export function FlowRosterDialog({
  flowId,
  onClose,
  onRosterChange,
}: {
  flowId: string;
  onClose: () => void;
  onRosterChange: (roster: FlowRoster) => void;
}) {
  const [roster, setRoster] = useState<FlowRoster | null>(null);
  const [parsed, setParsed] = useState<FlowRosterParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingEntryId, setConfirmingEntryId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    workflowApi
      .getRoster(flowId)
      .then((value) => {
        if (!cancelled) setRoster(value);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return roster?.entries ?? [];
    return (roster?.entries ?? []).filter(
      (entry) =>
        entry.name.toLowerCase().includes(normalizedQuery) ||
        entry.studentNo.toLowerCase().includes(normalizedQuery),
    );
  }, [query, roster]);

  const selectFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    setFileName(file.name);
    try {
      setParsed(await parseFlowRoster(file));
    } catch {
      setParsed(null);
      setError("名单解析失败，请确认文件为有效的 Excel 或 CSV 文件");
    } finally {
      setBusy(false);
    }
  };

  const importEntries = async () => {
    if (!parsed || parsed.entries.length === 0 || parsed.errors.length > 0) return;
    setBusy(true);
    setError("");
    try {
      const next = await workflowApi.importRoster(flowId, {
        entries: parsed.entries,
        sourceFileName: fileName,
      });
      setRoster(next);
      onRosterChange(next);
      setParsed(null);
      setFileName("");
      setNotice(
        `导入完成：新增 ${next.summary.added}，更新 ${next.summary.updated}，恢复 ${next.summary.restored}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "名单导入失败");
    } finally {
      setBusy(false);
    }
  };

  const revokeEntry = async (entry: FlowRosterEntry) => {
    setBusy(true);
    setError("");
    try {
      const next = await workflowApi.revokeRosterEntry(flowId, entry.id);
      setRoster(next);
      onRosterChange(next);
      setConfirmingEntryId(null);
      setNotice(`已移除 ${entry.name}（${entry.studentNo}）的流程访问权限`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "移除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flow-roster-backdrop" onMouseDown={onClose}>
      <section className="flow-roster-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>流程访问控制</p>
            <h2>学生名单</h2>
          </div>
          <button aria-label="关闭学生名单" onClick={onClose}>×</button>
        </header>

        <div className="flow-roster-import">
          <label>
            <input
              accept=".xlsx,.csv"
              disabled={busy}
              onChange={(event) => void selectFile(event.target.files?.[0] ?? null)}
              type="file"
            />
            选择 Excel 名单
          </label>
          <div>
            <strong>{fileName || "未选择文件"}</strong>
            <small>自动识别姓名、学号；班级列不参与权限判断</small>
          </div>
          <button
            className="primary-action"
            disabled={
              busy || !parsed || parsed.entries.length === 0 || parsed.errors.length > 0
            }
            onClick={() => void importEntries()}
          >
            导入名单
          </button>
        </div>

        {parsed ? (
          <div className={`flow-roster-preview ${parsed.errors.length ? "has-error" : ""}`}>
            <span>识别 {parsed.entries.length} 名学生</span>
            <span>姓名列：{parsed.columns.姓名 || "未识别"}</span>
            <span>学号列：{parsed.columns.学号 || "未识别"}</span>
            {parsed.errors.slice(0, 6).map((message) => <em key={message}>{message}</em>)}
            {parsed.errors.length > 6 ? <em>另有 {parsed.errors.length - 6} 项错误</em> : null}
          </div>
        ) : null}
        {error ? <p className="flow-roster-message error" role="alert">{error}</p> : null}
        {notice ? <p className="flow-roster-message">{notice}</p> : null}

        <div className="flow-roster-toolbar">
          <div>
            <strong>{roster?.activeCount ?? 0}</strong><span>有效</span>
            <strong>{roster?.revokedCount ?? 0}</strong><span>已移除</span>
          </div>
          <input
            aria-label="搜索学生名单"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索姓名或学号"
            value={query}
          />
        </div>

        <div className="flow-roster-table-wrap">
          <table className="flow-roster-table">
            <thead><tr><th>学号</th><th>姓名</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.studentNo}</td>
                  <td>{entry.name}</td>
                  <td><span className={`roster-status ${entry.status}`}>{entry.status === "active" ? "有效" : "已移除"}</span></td>
                  <td>
                    {entry.status === "active" ? (
                      confirmingEntryId === entry.id ? (
                        <span className="flow-roster-confirm">
                          <button disabled={busy} onClick={() => setConfirmingEntryId(null)}>取消</button>
                          <button disabled={busy} onClick={() => void revokeEntry(entry)}>确认移除</button>
                        </span>
                      ) : (
                        <button disabled={busy} onClick={() => setConfirmingEntryId(entry.id)}>移除</button>
                      )
                    ) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!roster ? <p>正在读取名单</p> : null}
          {roster && visibleEntries.length === 0 ? <p>暂无匹配学生</p> : null}
        </div>
      </section>
    </div>
  );
}
