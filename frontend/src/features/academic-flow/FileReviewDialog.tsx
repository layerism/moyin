import { DownloadIcon } from "./DownloadIcon";
import { FileFormatIcon } from "./FileFormatIcon";
import { useEffect, useRef, useState } from "react";
import { workflowApi } from "./api";
import { FeedbackDownload, ManualFeedbackList } from "./ManualFeedbackList";
import type { ManualReviewDetail, ManualReviewQueue, ManualReviewStudent } from "./runtimeTypes";

const labels = { all: "全部", waiting: "未就绪", pending: "待人工审核", returned: "已退回", approved: "已通过" };
type Filter = keyof typeof labels;
const category = (student: ManualReviewStudent): Exclude<Filter, "all"> => student.status === "approved" ? "approved"
  : student.status === "rejected" ? "returned" : student.canReview ? "pending" : "waiting";

export function FileReviewDialog({ versionId, nodeKey, onClose, initialStudentNo = "" }: { versionId: string; nodeKey: string; onClose: () => void; initialStudentNo?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const actionInFlight = useRef(false);
  const [queue, setQueue] = useState<ManualReviewQueue | null>(null);
  const [detail, setDetail] = useState<ManualReviewDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>(initialStudentNo ? "all" : "pending");
  const [query, setQuery] = useState(initialStudentNo);
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const students = (queue?.students ?? []).filter((student) => (filter === "all" || category(student) === filter)
    && `${student.name} ${student.studentNo}`.includes(query.trim()));
  const active = students.find((student) => student.id === selected) ?? students[0];
  const activeId = active?.nodeInstanceId;
  const current = detail?.nodeInstanceId === activeId ? detail : null;
  const canReview = Boolean((current?.canReview || current?.canAmend) && !busy && !loading);

  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    workflowApi.getManualReviewQueue(versionId, nodeKey).then((value) => {
      if (!cancelled) setQueue(value);
    }).catch((reason: Error) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [versionId, nodeKey, refresh]);
  useEffect(() => {
    let cancelled = false;
    setDetail(null); setRemark(""); setError("");
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    workflowApi.getManualReview(activeId).then((value) => {
      if (!cancelled) { setDetail(value); setRemark(value.feedbackDraft.remark); }
    }).catch((reason: Error) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeId, refresh]);

  const act = async (action: () => Promise<void>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败，请刷新后重试"); }
    finally { actionInFlight.current = false; setBusy(false); }
  };
  const decide = (passed: boolean) => {
    if (!current || !canReview) return;
    if (!remark.trim()) { setError("请填写审核评语"); dialog.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(); return; }
    if (current.canAmend && current.status === "approved" && !passed && !window.confirm("改为退回将暂停依赖此节点的所有后续节点，已有材料保留并需重新确认。确定修改？")) return;
    void act(async () => {
      if (passed) await workflowApi.approveManualReview(current.nodeInstanceId, current.evidenceHash, remark, current.feedbackDraft.revision, null, "");
      else await workflowApi.rejectManualSource(current.nodeInstanceId, current.evidenceHash, current.feedbackDraft.revision, nodeKey, remark);
      setDetail(null);
      setQueue(await workflowApi.getManualReviewQueue(versionId, nodeKey));
      setRefresh((value) => value + 1);
    });
  };
  const upload = (files: File[]) => {
    const sourceFile = current?.sources[0]?.files[0];
    if (!current || !canReview || !sourceFile || !files.length) return;
    void act(async () => {
      let draft = current.feedbackDraft;
      for (const file of files) {
        draft = await workflowApi.uploadManualFeedback(current.nodeInstanceId, current.evidenceHash, draft.revision, sourceFile.id, file);
        setDetail((value) => value?.nodeInstanceId === current.nodeInstanceId ? { ...value, feedbackDraft: draft } : value);
      }
    });
  };
  return <dialog ref={dialog} className="manual-review-dialog file-manual-review-dialog" aria-label="文件人工审核" onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); if (!actionInFlight.current) onClose(); }}>
    <header><div><h2>{queue?.title ?? "文件节点"} · 人工审核</h2></div><button type="button" disabled={busy} aria-label="关闭人工审核" onClick={onClose}>×</button></header>
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    <div className="manual-review-layout">
      <aside className="file-review-sidebar">
        <header><strong>学生列表</strong><button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>刷新</button></header>
        <input aria-label="搜索学生" disabled={busy} placeholder="搜索姓名、学号" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="审核状态筛选" disabled={busy} value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
          {(Object.keys(labels) as Filter[]).map((key) => <option key={key} value={key}>{labels[key]} · {(queue?.students ?? []).filter((student) => key === "all" || category(student) === key).length}</option>)}
        </select>
        <nav aria-label="学生审核列表">{students.map((student) => <button key={student.id} type="button" disabled={busy}
          aria-current={active?.id === student.id ? "true" : undefined} onClick={() => setSelected(student.id)}>
          <strong>{student.name}</strong><small>{student.studentNo}</small><span>{labels[category(student)]}</span>
        </button>)}{queue && !students.length ? <p className="file-review-muted">暂无符合条件的学生</p> : null}</nav>
      </aside>
      <section className="manual-review-detail" aria-busy={loading}>
        {loading ? <p className="file-review-empty">正在读取材料……</p> : current ? <>
          <div className="manual-review-student-heading"><h3>{current.student.name}<small>{current.student.studentNo}</small></h3><span>{active ? labels[category(active)] : ""}</span></div>
          <div className="manual-review-content">
            <section className="manual-review-source"><header><h4>本次提交</h4><small>{current.sources[0]?.submittedAt ? new Date(current.sources[0].submittedAt).toLocaleString("zh-CN") : "尚未提交"}</small></header>
              {current.sources.flatMap((source) => source.files).map((file) => <div className="file-review-original" key={file.id}><FileFormatIcon filename={file.original_name} /><span className="file-review-filename">{file.original_name}<small>{(file.size_bytes / 1024).toFixed(1)} KB</small></span><a className="review-download-icon" href={file.url} target="_blank" rel="noreferrer" title="下载原件" aria-label={`下载原件：${file.original_name}`}><DownloadIcon /></a></div>)}
            </section>
            {current.canReview || current.canAmend ? <section className="file-review-workspace" aria-label="填写审核意见">
              <label className="file-review-remark">审核评语 *<textarea disabled={busy} maxLength={1000} value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="填写评阅意见或需要修改的内容…" /></label>
              <section className="file-review-attachments" aria-label="评阅附件">
                <header><strong>评阅附件 <small>（选填）</small></strong>
                  <label className={`manual-feedback-upload${busy ? " is-disabled" : ""}`}>＋ 添加文件<input aria-label="上传评阅附件" disabled={busy} type="file" multiple onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; upload(files); }} /></label>
                </header>
                {!current.feedbackDraft.files.length ? <p className="file-review-attachment-empty">可添加批改文档或审批意见书<br /><small>单文件不超过 50 MB</small></p> : null}
              {current.feedbackDraft.files.map((file) => <div className="file-review-attachment-row" key={file.id}><FileFormatIcon filename={file.name} /><span className="file-review-filename"><strong>{file.name}</strong><small>{(file.sizeBytes / 1024).toFixed(1)} KB</small></span><FeedbackDownload fileId={file.id} filename={file.name} iconOnly /><button title="移除附件" aria-label={`移除附件：${file.name}`} disabled={busy} type="button" onClick={() => void act(async () => {
                const draft = await workflowApi.removeManualFeedback(current.nodeInstanceId, current.evidenceHash, current.feedbackDraft.revision, file.id);
                setDetail((value) => value ? { ...value, feedbackDraft: draft } : value);
              })}>×</button></div>)}
              </section>
            </section> : <p className="file-review-muted">{current.status === "approved" ? "本节点已通过。" : current.status === "rejected" ? "本次材料已退回，等待学生重新提交。" : "当前未轮到人工审核，请刷新查看最新状态。"}</p>}
            <details className="file-review-secondary"><summary>材料要求与历史记录</summary>
              {current.requirement ? <section className="manual-review-instructions"><h4>材料要求</h4><p>{current.requirement}</p></section> : null}
            {current.referenceFiles?.length ? <details className="manual-review-instructions"><summary>填写模板与参考材料</summary>{current.referenceFiles.map((file) => <p key={file.id}>{file.label}：<a href={file.url} target="_blank" rel="noreferrer">{file.original_name}</a></p>)}</details> : null}
            <ManualFeedbackList feedback={current.feedback} />
            {current.history.length ? <details className="file-review-history"><summary>历史人工审核记录（{current.history.length}）</summary>{current.history.map((item) => <article key={item.id}><strong>{item.passed ? "审核通过" : "退回修改"}</strong><small>{new Date(item.reviewedAt).toLocaleString("zh-CN")} · {item.teacherName}</small><p>{item.remark}</p></article>)}</details> : null}
              {!current.requirement && !current.referenceFiles?.length && !current.feedback.length && !current.history.length ? <p className="file-review-muted">暂无补充资料或历史记录。</p> : null}
            </details>
          </div>
          {current.canReview || current.canAmend ? <footer className="manual-review-action"><div className="manual-review-action-buttons"><details className="file-review-more"><summary>更多操作</summary><div><p>发布批注可补充评语和附件，不结束本次审核。</p><button type="button" disabled={!canReview || !remark.trim()} onClick={() => void act(async () => {
                if (!current) return;
                await workflowApi.saveManualFeedback(current.nodeInstanceId, current.evidenceHash, remark, current.feedbackDraft.revision);
                setRefresh((value) => value + 1);
              })}>发布批注</button></div></details><button type="button" className="file-review-reject" disabled={!canReview} onClick={() => decide(false)}>退回修改</button><button type="button" className="file-review-approve" disabled={!canReview} onClick={() => decide(true)}>{busy ? "处理中…" : "审核通过"}</button></div></footer> : null}
        </> : <p className="file-review-empty">{active ? "学生尚未提交材料。" : "请选择学生查看材料。"}</p>}
      </section>
    </div>
  </dialog>;
}
