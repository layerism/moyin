import { useEffect, useRef, useState } from "react";
import { workflowApi, type NodeProgressData, type NodeProgressStudent, type NodeResetImpact } from "./api";

const statusNames: Record<string, string> = { approved: "已通过", reviewing: "审核中", locked: "未开放", scheduled: "未到开始时间", available: "待提交", draft: "草稿", expired: "已截止", rejected: "未通过", audit_error: "审核异常", skipped: "不适用" };
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "无截止时间";
function localInput(time: number) { const d = new Date(time); return new Date(time - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

export function NodeProgressDialog({ versionId, nodeKey, onClose }: { versionId: string; nodeKey: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const actionDialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<NodeProgressData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [history, setHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<{ kind: "reset" | "extend"; student: NodeProgressStudent } | null>(null);
  const [impact, setImpact] = useState<NodeResetImpact | null>(null);
  const [actionError, setActionError] = useState("");
  const [reason, setReason] = useState("");
  const [deadline, setDeadline] = useState("");
  const [extendCurrent, setExtendCurrent] = useState(false);
  const [extendDownstream, setExtendDownstream] = useState(false);
  const requestSerial = useRef(0);
  async function refresh() {
    setLoading(true); setError("");
    try { setData(await workflowApi.getNodeProgress(versionId, nodeKey)); }
    catch (e) { setError(e instanceof Error ? e.message : "进度读取失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { dialog.current?.showModal(); void refresh(); return () => { requestSerial.current++; }; }, [versionId, nodeKey]);
  useEffect(() => { if (action) actionDialog.current?.showModal(); else actionDialog.current?.close(); }, [action]);
  async function openAction(kind: "reset" | "extend", student: NodeProgressStudent) {
    const serial = ++requestSerial.current;
    setAction({ kind, student }); setActionError(""); setImpact(null);
    setReason(kind === "extend" ? "批准个别延期" : ""); setExtendCurrent(false); setExtendDownstream(false);
    setDeadline(localInput(Math.max(Date.now(), new Date(student.effectiveDeadline || 0).getTime()) + 7 * 86400000));
    if (kind === "reset") {
      try { const result = await workflowApi.getNodeResetImpact(student.instanceId, nodeKey); if (serial === requestSerial.current) setImpact(result); }
      catch (e) { if (serial === requestSerial.current) setActionError(e instanceof Error ? e.message : "影响范围读取失败"); }
    }
  }
  function closeAction() { if (!busy) { requestSerial.current++; setAction(null); } }
  const current = impact?.nodes.find(n => n.nodeKey === nodeKey);
  const expiredDownstream = impact?.nodes.filter(n => n.nodeKey !== nodeKey && n.expired && n.canExtend) ?? [];
  const requiresDate = action?.kind === "extend" || extendCurrent || extendDownstream;
  const dateFloor = action?.kind === "extend" ? Math.max(Date.now(), new Date(action.student.effectiveDeadline || 0).getTime()) : Date.now();
  const validDate = !requiresDate || (Number.isFinite(new Date(deadline).getTime()) && new Date(deadline).getTime() > dateFloor);
  async function save() {
    if (!action || busy || !reason.trim() || !validDate || (action.kind === "reset" && !impact)) return;
    setBusy(true); setActionError("");
    try {
      if (action.kind === "extend") await workflowApi.setStudentDeadline(action.student.instanceId, nodeKey, new Date(deadline).toISOString(), reason.trim());
      else await workflowApi.resetNodeProgress(action.student.instanceId, nodeKey, { fingerprint: impact!.fingerprint, reason: reason.trim(), deadlineAt: requiresDate ? new Date(deadline).toISOString() : null, extendCurrent, extendDownstream });
      setNotice(action.kind === "extend" ? `${action.student.name}的节点截止时间已更新` : `${action.student.name}的当前节点及下游进度已重置`);
      setAction(null); await refresh();
    } catch (e) { setActionError(e instanceof Error ? e.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  }
  const students = data?.students ?? [];
  const matches = (s: NodeProgressStudent) => filter === "all" || (filter === "pending" ? !["approved", "reviewing", "skipped"].includes(s.status) : s.status === filter);
  const visible = students.filter(s => matches(s) && `${s.name} ${s.studentNo}`.includes(search.trim()));
  return <>
    <dialog className="node-progress-dialog" ref={dialog} onCancel={e => { e.preventDefault(); onClose(); }}>
      <header><div><h2>节点进度管理</h2><p>{data?.title ?? "正在读取节点…"}</p></div><button type="button" aria-label="关闭进度管理" onClick={onClose}>×</button></header>
      <nav><button type="button" className={!history ? "active" : ""} onClick={() => setHistory(false)}>学生进度</button><button type="button" className={history ? "active" : ""} onClick={() => setHistory(true)}>操作记录</button></nav>
      <section className="np-body">
        {error && <p className="np-error" role="alert">{error} <button type="button" onClick={() => void refresh()}>重新加载</button></p>}
        {notice && <p className="np-success" role="status">{notice}</p>}
        {history ? <div>{data?.logs.map((log, i) => <article className="np-record" key={`${log.created_at}-${i}`}><b>{log.action === "node_progress_reset" ? "撤销通过" : "节点延期"} · {log.name}（{log.student_no}）</b><p>{new Date(log.created_at).toLocaleString("zh-CN")} · 教师 {log.actor_id}</p><div>{log.reason}</div>{(() => { const details = JSON.parse(log.after_data); return details.deadlineAt ? <p>延期至 {new Date(details.deadlineAt).toLocaleString("zh-CN")}</p> : null; })()}</article>)}{!loading && !data?.logs.length && <p className="np-empty">暂无操作记录</p>}</div> : <>
          <div className="np-filters">{[["all", "全部"], ["approved", "已通过"], ["reviewing", "审核中"], ["pending", "待完成"]].map(([value, label]) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}{value === "all" ? ` ${students.length}` : ""}</button>)}<button type="button" disabled={loading} onClick={() => void refresh()}>刷新</button></div>
          <input aria-label="搜索学生" placeholder="搜索姓名或学号" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="np-table"><table><thead><tr><th>学生</th><th>状态</th><th>有效截止时间</th><th>操作</th></tr></thead><tbody>{visible.map(s => <tr key={s.instanceId}><td><b>{s.name}</b><small>{s.studentNo}</small></td><td><span className={`np-status ${s.status}`}>{statusNames[s.status] ?? s.status}</span></td><td>{dateLabel(s.effectiveDeadline)}{s.overrideDeadline && <small>已延期</small>}</td><td><div className="np-actions">{s.canRevoke && <button type="button" className="np-danger-link" onClick={() => void openAction("reset", s)}>撤销通过</button>}{s.canExtend && <button type="button" onClick={() => void openAction("extend", s)}>延期</button>}{!s.canRevoke && !s.canExtend && <span>—</span>}</div></td></tr>)}</tbody></table></div>
          {!visible.length && <p className="np-empty">{loading ? "正在读取…" : "暂无匹配学生"}</p>}
          <p className="np-hint">仅显示已进入流程的学生。撤销会重置所选学生的当前节点及下游进度。</p>
        </>}
      </section><footer><span>仅管理当前节点 · {students.length} 位学生</span><button type="button" onClick={onClose}>关闭</button></footer>
    </dialog>
    <dialog ref={actionDialog} className="node-progress-dialog np-confirm" onCancel={e => { e.preventDefault(); closeAction(); }}>
      <header><div><h2>{action?.kind === "extend" ? "节点延期" : "撤销节点通过"}</h2><p>{action?.student.name} · {action?.student.studentNo}</p></div><button type="button" disabled={busy} aria-label="关闭确认" onClick={closeAction}>×</button></header>
      <section className="np-body">
        {actionError && <p className="np-error" role="alert">{actionError}</p>}
        {action?.kind === "reset" ? <>
          <p className="np-warning">当前节点及下游需要重新完成，相关审核将取消。</p>
          {!impact ? <p>正在读取影响范围…</p> : <><div className="np-affected">{impact.nodes.map(n => <div key={n.nodeKey}><span>{n.title}</span><small>{n.nodeKey === nodeKey ? "当前节点" : "下游"}{n.expired ? " · 已截止" : ""}</small></div>)}</div>
            {(current?.expired || expiredDownstream.length > 0) && <div className="np-extension">
              {current?.expired && current.canExtend && <label><input type="checkbox" checked={extendCurrent} onChange={e => setExtendCurrent(e.target.checked)} />同时延期当前节点</label>}
              {expiredDownstream.length > 0 && <label><input type="checkbox" checked={extendDownstream} onChange={e => setExtendDownstream(e.target.checked)} />同时延期已截止的下游节点（{expiredDownstream.length} 个）</label>}
              {impact.nodes.some(n => n.expired && !n.canExtend) && <p className="np-hint">已公开标准答案的答题卡不能再次延期。</p>}
              <p className="np-hint">未勾选的节点保留原截止时间，已截止时仍无法提交。</p>
            </div>}</>}
        </> : <p className="np-hint">当前有效截止时间：{dateLabel(action?.student.effectiveDeadline ?? null)}</p>}
        {requiresDate && <label className="np-field">延长至<input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />{!validDate && <span className="np-error">新时间须晚于当前时间及原有效截止时间。</span>}</label>}
        <label className="np-field">{action?.kind === "extend" ? "延期原因" : "撤销原因"} *<textarea maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="请填写原因" /></label>
      </section><footer><span>仅影响该学生</span><div><button type="button" disabled={busy} onClick={closeAction}>取消</button><button type="button" className={action?.kind === "reset" ? "np-danger" : "np-primary"} disabled={busy || !reason.trim() || !validDate || (action?.kind === "reset" && !impact)} onClick={() => void save()}>{busy ? "正在保存…" : action?.kind === "reset" ? "确认撤销通过" : "确认延期"}</button></div></footer>
    </dialog>
  </>;
}
