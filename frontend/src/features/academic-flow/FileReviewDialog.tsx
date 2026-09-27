import { saveDownloadFile } from "./saveStudentFile";
import { saveDownload } from "./download";
import { DownloadIcon } from "./DownloadIcon";
import { FileFormatIcon } from "./FileFormatIcon";
import { useEffect, useRef, useState } from "react";
import { workflowApi } from "./api";
import { FeedbackDownload, ManualFeedbackList } from "./ManualFeedbackList";
import type { ManualReviewDetail, ManualReviewQueue, ManualReviewStudent } from "./runtimeTypes";

const labels = { all: "全部", waiting: "未就绪", pending: "待审核", returned: "已退回", approved: "已通过" };
type Filter = keyof typeof labels;
const category = (student: ManualReviewStudent): Exclude<Filter, "all"> => student.status === "approved" ? "approved"
  : student.status === "rejected" ? "returned" : student.canReview ? "pending" : "waiting";
const quickRemarks = ["材料齐全，符合要求。", "请按模板补全后重新提交。", "请核对签名与日期后重新提交。"];

function OriginalDownload({ nodeId, fileId, filename }: { nodeId: string; fileId: string; filename: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/workflow-admin/node-instances/${encodeURIComponent(nodeId)}/manual-review/files/${encodeURIComponent(fileId)}/download`;
  const download = async () => {
    setBusy(true); setError("");
    try {
      await saveDownloadFile(endpoint, filename);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "下载失败，请重试");
    } finally { setBusy(false); }
  };
  // A native attachment link stays inside the active dialog and avoids Blob downloads.
  if (!("showSaveFilePicker" in window)) {
    return <a className="review-download-icon" href={endpoint} download={filename} title="下载原件" aria-label={`下载原件：${filename}`}><DownloadIcon /></a>;
  }
  return <span><button type="button" className="review-download-icon" disabled={busy} title={busy ? "正在下载…" : "下载原件"} aria-label={`下载原件：${filename}`} onClick={() => void download()}><DownloadIcon /></button>{error && <small className="dialog-error" role="alert">{error}</small>}</span>;
}

export function FileReviewDialog({ versionId, nodeKey, onClose, initialStudentNo = "", allowBulkDownload = true }: { versionId: string; nodeKey: string; onClose: () => void; initialStudentNo?: string; allowBulkDownload?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const actionInFlight = useRef(false);
  const localRemarks = useRef(new Map<string, string>());
  const [queue, setQueue] = useState<ManualReviewQueue | null>(null);
  const [detail, setDetail] = useState<ManualReviewDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>(initialStudentNo ? "all" : "pending");
  const [query, setQuery] = useState(initialStudentNo);
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
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
      if (!cancelled) { setDetail(value); setRemark(localRemarks.current.get(activeId) ?? value.feedbackDraft.remark); }
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
      localRemarks.current.delete(current.nodeInstanceId);
      if (autoAdvance) {
        const initialScope = Boolean(initialStudentNo && query === initialStudentNo);
        const candidates = initialScope
          ? (queue?.students ?? []).filter((student) => student.canReview)
          : students;
        const index = candidates.findIndex((student) => student.nodeInstanceId === current.nodeInstanceId);
        const ordered = index < 0 ? candidates : [...candidates.slice(index + 1), ...candidates.slice(0, index)];
        const following = ordered
          .find((student) => student.canReview && student.nodeInstanceId !== current.nodeInstanceId);
        if (initialScope) { setQuery(""); setFilter("pending"); }
        if (following) setSelected(following.id);
      } else if (filter === "pending") {
        setFilter("all");
      }
      setDetail(null);
      setRefresh((value) => value + 1);
    });
  };
  const downloadAll = async () => {
    if (downloading) return;
    setDownloading(true); setError("");
    try {
      const result = await workflowApi.downloadTeacherNodePackage(versionId, nodeKey, {
        includeFiles: true, includeWorkbook: false, rosterEntryIds: [], studentScope: "all",
      });
      saveDownload(result.blob, result.filename, dialog.current ?? document.body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "批量下载失败");
    } finally { setDownloading(false); }
  };
  const changeRemark = (value: string) => {
    if (activeId) localRemarks.current.set(activeId, value);
    setRemark(value);
  };
  const appendRemark = (value: string) => changeRemark(remark.trim() ? `${remark.trim()}\n${value}` : value);
  const moveSelection = (offset: number) => {
    if (busy || loading || students.length < 2) return;
    const index = students.findIndex((student) => student.id === active?.id);
    setSelected(students[(index + offset + students.length) % students.length].id);
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
  return <dialog ref={dialog} className="manual-review-dialog file-manual-review-dialog" aria-label="材料人工审核" onKeyDown={(event) => {
    event.stopPropagation();
    if ((event.key === "ArrowDown" || event.key === "ArrowUp")
      && !(event.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) {
      event.preventDefault();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
    }
  }}
    onCancel={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      if (!actionInFlight.current && !downloading) onClose();
    }}>
    <header><div><h2>人工审核</h2><p>{queue?.title ?? "材料节点"}</p></div><button type="button" disabled={busy || downloading} aria-label="关闭人工审核" onClick={onClose}>×</button></header>
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    <div className="manual-review-layout">
      <aside className="file-review-sidebar">
        <header><strong>学生列表</strong><button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>刷新</button></header>
        {allowBulkDownload ? <button className="file-review-batch-download" type="button" disabled={downloading || !(queue?.students.length)} onClick={() => void downloadAll()}>{downloading ? "正在打包…" : "批量下载文件 ZIP"}</button> : null}
        <input aria-label="搜索学生" disabled={busy} placeholder="搜索姓名、学号" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="file-review-status-filters" aria-label="审核状态筛选">
          {(["pending", "approved", "returned", "all", "waiting"] as Filter[]).map((key) => <button key={key} type="button" disabled={busy} aria-pressed={filter === key} onClick={() => { setFilter(key); setSelected(null); }}>
            <span>{labels[key]}</span><strong>{(queue?.students ?? []).filter((student) => key === "all" || category(student) === key).length}</strong>
          </button>)}
        </div>
        <small className="file-review-list-count">{labels[filter]} · {students.length} 人</small>
        <nav aria-label="学生审核列表">{students.map((student) => <button key={student.id} type="button" disabled={busy}
          aria-current={active?.id === student.id ? "true" : undefined}
          aria-label={`${student.studentNo}－${student.name}，${labels[category(student)]}`}
          onClick={() => setSelected(student.id)}>
          <span className="file-review-student-avatar" aria-hidden="true">{student.name.slice(0, 1)}</span>
          <span className="file-review-student-identity"><strong>{student.name}</strong><small>{student.studentNo}</small></span>
          <span className={`file-review-status is-${category(student)}`}>{labels[category(student)]}</span>
        </button>)}{queue && !students.length ? <p className="file-review-muted">暂无符合条件的学生</p> : null}</nav>
      </aside>
      <section className="manual-review-detail" aria-busy={loading}>
        {loading ? <p className="file-review-empty">正在读取材料……</p> : current ? <>
          <div className="file-review-body">
          <div className="manual-review-content">
            <div className="manual-review-student-heading"><h3>{current.student.name}<small>学号 {current.student.studentNo}</small></h3><span className={`file-review-status is-${active ? category(active) : "waiting"}`}>{active ? labels[category(active)] : ""}</span></div>
            <section className="manual-review-source" aria-label="本次提交原件">
              {current.sources.flatMap((source) => source.files).map((file) => <div className="file-review-document" key={file.id}>
                <div className="file-review-original"><FileFormatIcon filename={file.original_name} /><span className="file-review-filename">{file.original_name}<small>{(file.size_bytes / 1024).toFixed(1)} KB</small></span><OriginalDownload nodeId={current.nodeInstanceId} fileId={file.id} filename={file.original_name} /></div>
                {/\.(jpe?g|png)$/i.test(file.original_name)
                  ? <img className="file-review-image-preview" loading="lazy" alt={file.original_name} src={`/api/workflow-admin/node-instances/${encodeURIComponent(current.nodeInstanceId)}/manual-review/files/${encodeURIComponent(file.id)}/download?preview=true`} /> : null}
                {/\.pdf$/i.test(file.original_name) ? <iframe className="file-review-pdf-preview" title={`原件预览：${file.original_name}`} src={`/api/workflow-admin/node-instances/${encodeURIComponent(current.nodeInstanceId)}/manual-review/files/${encodeURIComponent(file.id)}/download?preview=true`} /> : null}
                {!/\.(pdf|jpe?g|png)$/i.test(file.original_name) ? <p className="file-review-muted">此格式请下载原件查看。</p> : null}
              </div>)}
              {!current.sources.some((source) => source.files.length) ? <p className="file-review-muted">暂无已提交原件。</p> : null}
            </section>
            {current.priorAiResults?.length ? <section className="file-review-prior-ai" aria-label="前序 AI 结论"><h4>前序 AI 结论</h4>{current.priorAiResults.map((result) => <article key={result.step}><strong>第 {result.step} 步 · {result.scriptName}：{result.passed ? "通过" : "未通过"}</strong><p>{result.reason}</p></article>)}</section> : null}
            <details className="file-review-secondary"><summary>材料要求与历史记录</summary>
              {current.requirement ? <section className="manual-review-instructions"><h4>材料要求</h4><p>{current.requirement}</p></section> : null}
            {current.referenceFiles?.length ? <details className="manual-review-instructions"><summary>填写模板与参考材料</summary>{current.referenceFiles.map((file) => <p key={file.id}>{file.label}：<a href={file.url} target="_blank" rel="noreferrer">{file.original_name}</a></p>)}</details> : null}
            <ManualFeedbackList feedback={current.feedback} />
            {current.history.length ? <details className="file-review-history"><summary>历史人工审核记录（{current.history.length}）</summary>{current.history.map((item) => <article key={item.id}><strong>{item.passed ? "审核通过" : "退回修改"}</strong><small>{new Date(item.reviewedAt).toLocaleString("zh-CN")} · {item.teacherName}</small><p>{item.remark}</p></article>)}</details> : null}
              {!current.requirement && !current.referenceFiles?.length && !current.feedback.length && !current.history.length ? <p className="file-review-muted">暂无补充资料或历史记录。</p> : null}
            </details>
          </div>
          <aside className="file-review-decision-pane" aria-label="人工审核操作">
          {current.canReview || current.canAmend ? <>
            <div className="file-review-decision-scroll">
              <section className="file-review-workspace" aria-label="填写审核意见">
                <label className="file-review-remark">审核评语 *<textarea disabled={busy} maxLength={1000} value={remark} onChange={(event) => changeRemark(event.target.value)} placeholder="填写评阅意见或需要修改的内容…" /></label>
                <div className="file-review-quick-remarks" aria-label="常用评语"><small>常用评语</small>{quickRemarks.map((value) => <button key={value} type="button" disabled={busy} onClick={() => appendRemark(value)}>{value}</button>)}</div>
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
              </section>
            </div>
            <footer className="manual-review-action"><label className="file-review-auto-advance"><input type="checkbox" checked={autoAdvance} onChange={(event) => setAutoAdvance(event.target.checked)} />完成后自动切换下一位</label><div className="manual-review-action-buttons"><details className="file-review-more"><summary>更多操作</summary><div><p>发布批注可补充评语和附件，不结束本次审核。</p><button type="button" disabled={!canReview || !remark.trim()} onClick={() => void act(async () => {
                if (!current) return;
                await workflowApi.saveManualFeedback(current.nodeInstanceId, current.evidenceHash, remark, current.feedbackDraft.revision);
                localRemarks.current.delete(current.nodeInstanceId);
                setRefresh((value) => value + 1);
              })}>发布批注</button></div></details><button type="button" className="file-review-reject" disabled={!canReview} onClick={() => decide(false)}>退回修改</button><button type="button" className="file-review-approve" disabled={!canReview} onClick={() => decide(true)}>{busy ? "处理中…" : "审核通过"}</button></div><small>↑ / ↓ 切换学生</small></footer>
          </> : <p className="file-review-muted">{current.status === "approved" ? "本节点已通过。" : current.status === "rejected" ? "本次材料已退回，等待学生重新提交。" : "当前未轮到人工审核，请刷新查看最新状态。"}</p>}
          </aside>
          </div>
        </> : <p className="file-review-empty">{active ? "学生尚未提交材料。" : "请选择学生查看材料。"}</p>}
      </section>
    </div>
  </dialog>;
}
