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
    <header><div><h2>{queue?.title ?? "文件节点"} · 人工审核</h2><p className="file-review-muted">由你（流程发布者）审核</p></div><button type="button" disabled={busy} aria-label="关闭人工审核" onClick={onClose}>×</button></header>
    <div className="manual-review-filters">{(Object.keys(labels) as Filter[]).map((key) => <button key={key} type="button" disabled={busy}
      aria-pressed={filter === key} onClick={() => setFilter(key)}>{labels[key]} {(queue?.students ?? []).filter((student) => key === "all" || category(student) === key).length}</button>)}
      <input aria-label="搜索学生" disabled={busy} placeholder="搜索姓名、学号" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>刷新</button>
    </div>
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    <div className="manual-review-layout"><nav aria-label="学生审核列表">{students.map((student) => <button key={student.id} type="button" disabled={busy}
      aria-current={active?.id === student.id ? "true" : undefined} onClick={() => setSelected(student.id)}><strong>{student.name}</strong><small>{student.studentNo}</small><span>{labels[category(student)]}</span></button>)}
      {queue && !students.length ? <p>暂无符合条件的学生</p> : null}</nav>
      <section className="manual-review-detail" aria-busy={loading}>
        {loading ? <p className="file-review-empty">正在读取材料……</p> : current ? <>
          <div className="manual-review-student-heading"><h3>{current.student.name}<small>{current.student.studentNo}</small></h3><span>{active ? labels[category(active)] : ""}</span></div>
          <div className="manual-review-content">
            {current.requirement ? <details className="manual-review-instructions"><summary>材料要求</summary><p>{current.requirement}</p></details> : null}
            <section className="manual-review-source"><header><h4>本次提交材料</h4><small>{current.sources[0]?.submittedAt ? new Date(current.sources[0].submittedAt).toLocaleString("zh-CN") : "尚未提交"}</small></header>
              {current.sources.flatMap((source) => source.files).map((file) => <div className="file-review-original" key={file.id}><span>{file.original_name}<small>{(file.size_bytes / 1024).toFixed(1)} KB</small></span><a href={file.url} target="_blank" rel="noreferrer">下载原件</a></div>)}
            </section>
            {current.referenceFiles?.length ? <details className="manual-review-instructions"><summary>填写模板与参考材料</summary>{current.referenceFiles.map((file) => <p key={file.id}>{file.label}：<a href={file.url} target="_blank" rel="noreferrer">{file.original_name}</a></p>)}</details> : null}
            {current.canReview || current.canAmend ? <section className="manual-review-source"><header><h4>人工审核</h4><small>发布者本人处理</small></header>
              <label className="file-review-remark">审核评语（必填）<textarea disabled={busy} maxLength={1000} value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="请填写审核结论及建议；退回时写清需要修改的内容。" /></label>
              <div className="file-review-upload"><span><strong>审核材料（选填）</strong><small>支持多个批改文档、审核意见书或说明附件；单文件不超过 50 MB</small></span>
                <label className={`manual-feedback-upload${busy ? " is-disabled" : ""}`}>＋ 上传审核材料<input aria-label="上传审核材料" disabled={busy} type="file" multiple onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; upload(files); }} /></label>
              </div>
              {current.feedbackDraft.files.map((file) => <div className="manual-feedback-published-file" key={file.id}><span><strong>{file.name}</strong></span><FeedbackDownload fileId={file.id}>下载</FeedbackDownload><button disabled={busy} type="button" onClick={() => void act(async () => {
                const draft = await workflowApi.removeManualFeedback(current.nodeInstanceId, current.evidenceHash, current.feedbackDraft.revision, file.id);
                setDetail((value) => value ? { ...value, feedbackDraft: draft } : value);
              })}>移除</button></div>)}
              <p className="file-review-muted">发布批注可补充意见和附件，不结束审核；通过或退回才会提交最终结论。</p>
            </section> : <p className="file-review-muted">{current.status === "approved" ? "本节点已通过。" : current.status === "rejected" ? "本次材料已退回，等待学生重新提交。" : "当前未轮到人工审核，请刷新查看最新状态。"}</p>}
            <ManualFeedbackList feedback={current.feedback} />
            {current.history.length ? <details className="file-review-history"><summary>历史人工审核记录（{current.history.length}）</summary>{current.history.map((item) => <article key={item.id}><strong>{item.passed ? "审核通过" : "退回修改"}</strong><small>{new Date(item.reviewedAt).toLocaleString("zh-CN")} · {item.teacherName}</small><p>{item.remark}</p></article>)}</details> : null}
          </div>
          {current.canReview || current.canAmend ? <footer className="manual-review-action"><div className="manual-review-action-buttons"><small>评语与审核材料同时提交；全部步骤通过后开放下游。</small><button type="button" disabled={!canReview || !remark.trim()} onClick={() => void act(async () => {
                if (!current) return;
                await workflowApi.saveManualFeedback(current.nodeInstanceId, current.evidenceHash, remark, current.feedbackDraft.revision);
                setRefresh((value) => value + 1);
              })}>发布批注</button><button type="button" className="file-review-reject" disabled={!canReview} onClick={() => decide(false)}>退回修改</button><button type="button" className="file-review-approve" disabled={!canReview} onClick={() => decide(true)}>{busy ? "处理中…" : "审核通过"}</button></div></footer> : null}
        </> : <p className="file-review-empty">{active ? "学生尚未提交材料。" : "请选择学生查看材料。"}</p>}
      </section>
    </div>
  </dialog>;
}
