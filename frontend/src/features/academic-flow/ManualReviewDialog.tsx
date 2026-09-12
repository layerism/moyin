import { useCallback, useEffect, useRef, useState } from "react";
import { FeedbackDownload, ManualFeedbackList } from "./ManualFeedbackList";
import type { AcademicFlowNode } from "../../types";
import { ApiError, workflowApi } from "./api";
import type { ManualReviewDetail, ManualReviewQueue, ManualFeedbackFile, ManualSourceReview, RuntimeNodeStatus } from "./runtimeTypes";
import { AnswerSheetMarkdown } from "./AnswerSheetMarkdown";
import { ReadonlyFormFields } from "./RuntimeFormFields";
import { AnswerSheetGradeResult, RuntimeAnswerSheet } from "./RuntimeAnswerSheet";

const category = (status: RuntimeNodeStatus) => status === "approved" ? "approved" : status === "reviewing" ? "reviewing" : "locked";
const labels = { all: "全部", locked: "未就绪", reviewing: "待审核", approved: "已通过" };
const parameterLabels: Record<string, string> = { documentReviewPrompt: "文档审核要求", scanAuditPrompt: "审核标准", scanAuditMode: "审核模式", scanAuditThreshold: "通过阈值" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "尚未提交";

export function ManualReviewDialog({ versionId, nodeKey, onClose }: {
  versionId: string; nodeKey: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [queue, setQueue] = useState<ManualReviewQueue | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<ManualReviewDetail | null>(null);
  const [filter, setFilter] = useState<keyof typeof labels>("reviewing");
  const [query, setQuery] = useState("");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const loadQueue = useCallback(async () => {
    const next = await workflowApi.getManualReviewQueue(versionId, nodeKey);
    setQueue(next);
    return next;
  }, [versionId, nodeKey]);

  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    workflowApi.getManualReviewQueue(versionId, nodeKey).then((next) => {
      if (!cancelled) setQueue(next);
    }).catch((reason: Error) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [versionId, nodeKey, refresh]);

  const students = (queue?.students ?? []).filter((student) =>
    (filter === "all" || category(student.status) === filter)
    && `${student.name} ${student.studentNo}`.includes(query.trim()),
  );
  const active = students.find((student) => student.id === selected) ?? students[0];
  const activeId = active?.nodeInstanceId ?? null;
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setRemark("");
    setError("");
    if (!activeId) { setLoading(false); return; }
    setLoading(true);
    workflowApi.getManualReview(activeId).then((next) => {
      if (!cancelled) { setDetail(next); setRemark(next.feedbackDraft.remark); }
    }).catch((reason: Error) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeId, refresh]);

  useEffect(() => { setSaved(false); }, [activeId]);

  const saveFeedback = async (pass: boolean, sourceNodeKey: string | null = null, sourceRemark = "") => {
    if (!detail || detail.nodeInstanceId !== activeId || saving) return;
    setSaving(true);
    setError("");
    try {
      if (pass) {
        const result = await workflowApi.approveManualReview(detail.nodeInstanceId, detail.evidenceHash, remark, detail.feedbackDraft.revision, sourceNodeKey, sourceRemark);
        if (!result.approved) { setRefresh((value) => value + 1); return; }
      } else {
        await workflowApi.saveManualFeedback(detail.nodeInstanceId, detail.evidenceHash, remark, detail.feedbackDraft.revision);
        setSaved(true);
        setRefresh((value) => value + 1);
        return;
      }
      setDetail(null);
      setRemark("");
      const next = await loadQueue();
      const nextStudent = next.students.find((student) => student.status === "reviewing" && student.nodeInstanceId !== activeId);
      setSelected(nextStudent?.id ?? null);
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "审核操作失败");
      if (reason instanceof ApiError && reason.status === 409) setDetail(null);
    } finally { setSaving(false); }
  };

  const changeFile = async (sourceId: string, file?: File, removeId?: string) => {
    if (!detail || saving) return;
    if (file && (file.size === 0 || file.size > 50 * 1024 * 1024)) { setError("批改文件须非空且不超过 50 MB"); return; }
    setSaved(false); setSaving(true); setError("");
    try {
      const next = file
        ? await workflowApi.uploadManualFeedback(detail.nodeInstanceId, detail.evidenceHash, detail.feedbackDraft.revision, sourceId, file)
        : await workflowApi.removeManualFeedback(detail.nodeInstanceId, detail.evidenceHash, detail.feedbackDraft.revision, removeId!);
      setDetail((current) => current ? { ...current, feedbackDraft: next } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "批改文件操作失败");
      if (reason instanceof ApiError && reason.status === 409) setDetail(null);
    } finally { setSaving(false); }
  };

  return <dialog className="manual-review-dialog" ref={dialog} aria-labelledby="manual-review-title"
    onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
    <header><div><h2 id="manual-review-title">{queue?.title ?? "正在读取审核列表"}</h2></div>
      <button aria-label="关闭审核" disabled={saving} onClick={onClose} type="button">×</button></header>
    <div className="manual-review-filters">
      {(Object.keys(labels) as Array<keyof typeof labels>).map((key) => <button key={key} disabled={saving} aria-pressed={filter === key}
        onClick={() => { setFilter(key); setSelected(null); }} type="button">
        {labels[key]} {queue?.students.filter((student) => key === "all" || category(student.status) === key).length ?? 0}
      </button>)}
      <input aria-label="搜索学生" disabled={saving} placeholder="搜索姓名、学号" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button disabled={saving} onClick={() => setRefresh((value) => value + 1)} type="button">刷新</button>
    </div>
    {error ? <p className="dialog-error" role="alert">{error} 请点击刷新重试。</p> : null}
    <div className="manual-review-layout">
      <nav aria-label="学生审核列表">{students.map((student) => <button key={student.id} type="button" disabled={saving}
        aria-current={active?.id === student.id ? "true" : undefined} onClick={() => setSelected(student.id)}>
        <strong>{student.name}</strong><small>{student.studentNo}</small><span>{labels[category(student.status)]}</span>
      </button>)}{queue && students.length === 0 ? <p>暂无符合条件的学生</p> : null}</nav>
      <section className="manual-review-detail" aria-busy={loading}>
        {loading ? <p>正在读取材料……</p> : detail && detail.nodeInstanceId === activeId ? <>
          <div className="manual-review-student-heading"><h3>{detail.student.name}<small>{detail.student.studentNo}</small></h3><span>{labels[category(detail.status)]}</span></div>
          <div className="manual-review-content">
            <details className="manual-review-instructions"><summary>审核说明</summary><AnswerSheetMarkdown>{detail.requirement}</AnswerSheetMarkdown></details>
            {detail.sources.map((source) => <SourceMaterial key={`${detail.nodeInstanceId}-${source.nodeKey}`} source={source}
              review={detail.sourceReviews.find((item) => item.nodeKey === source.nodeKey)} onApprove={(text) => void saveFeedback(true, source.nodeKey, text)}
              feedbackFiles={detail.feedbackDraft.files} busy={saving} editable={detail.status === "reviewing" || detail.status === "approved"}
              onUpload={(sourceId, file) => void changeFile(sourceId, file)} onRemove={(id) => void changeFile("", undefined, id)} />)}
            <ManualFeedbackList feedback={detail.feedback} />
            {detail.history.length ? <details><summary>历史审核记录（{detail.history.length}）</summary>
              {detail.history.map((record) => <p key={record.id}>{date(record.reviewedAt)} · {record.teacherName} · {record.remark || "审核通过"}</p>)}
            </details> : null}
          </div>
          {detail.status === "reviewing" || detail.status === "approved" ? <div className="manual-review-action">
            <label>反馈备注<textarea rows={2} placeholder="填写批改意见，保存后学生可见" maxLength={1000} disabled={saving} value={remark} onChange={(event) => { setSaved(false); setRemark(event.target.value); }} /></label>
            <div className="manual-review-action-buttons"><small role="status">{saved ? "反馈已保存，学生可查看并下载。" : "逐节点确认后自动放行；确认时会同时保存反馈。"}</small>
              <button disabled={saving} onClick={() => void saveFeedback(false)} type="button">保存反馈</button>
              {detail.status === "reviewing" && !detail.sources.length ? <button className="primary-action" disabled={saving} onClick={() => void saveFeedback(true)} type="button">{saving ? "正在处理…" : "审核通过"}</button> : <span>{detail.status === "approved" ? "已通过" : `${detail.sourceReviews.filter((item) => item.approved).length}/${detail.sources.length} 节点已确认`}</span>}
            </div>
          </div> : <p>前置材料就绪且到达开始时间后可审核。</p>}
        </> : active && !activeId ? <p>该学生尚未进入流程，暂无提交材料。</p> : !error && !loading ? <p>请选择待审核学生。</p> : null}
      </section>
    </div>
  </dialog>;
}

function SourceMaterial({ source, feedbackFiles, busy, editable, onUpload, onRemove, review, onApprove }: {
  review?: ManualSourceReview; onApprove: (remark: string) => void;
  source: ManualReviewDetail["sources"][number]; feedbackFiles: ManualFeedbackFile[]; busy: boolean; editable: boolean;
  onUpload: (sourceId: string, file: File) => void; onRemove: (id: string) => void;
}) {
  const [sourceRemark, setSourceRemark] = useState(review?.remark ?? "");
  const node: AcademicFlowNode = {
    id: source.nodeKey, title: source.title, kind: source.kind, requirement: source.requirement,
    infoFields: source.infoFields, answerSheet: source.answerSheet ?? undefined,
    auditScriptName: "", auditScriptType: "none", fileExtensions: "", fileLimitMb: "", status: "disabled", x: 0, y: 0,
  };
  return <section className="manual-review-source">
    <header><h4>{source.title}</h4><small>{source.status === "approved" ? "已通过" : "尚未通过"} · {date(source.submittedAt)}</small></header>
    <details className="manual-review-instructions"><summary>节点要求</summary><AnswerSheetMarkdown>{source.requirement}</AnswerSheetMarkdown></details>
    {source.submissionId && source.kind === "form" ? <ReadonlyFormFields fields={source.infoFields} payload={source.submission} /> : null}
    {source.submissionId && source.kind === "answer_sheet" ? <>
      <RuntimeAnswerSheet errors={{}} instanceId="" node={node} payload={source.submission} readonly />
      {source.grade ? <AnswerSheetGradeResult grade={source.grade} node={node} /> : null}
    </> : null}
    {source.files.map((file) => {
      const corrected = feedbackFiles.find((item) => item.sourceFileId === file.id);
      return <div className="manual-review-file-pair" key={file.id}>
        <div className="manual-review-file-row"><small>学生原件</small><a href={file.url} target="_blank" rel="noreferrer" title={file.original_name}>{file.original_name}</a><small>{Math.ceil(file.size_bytes / 1024)} KB</small></div>
        <div className="manual-review-file-row"><small>教师批改</small><span title={corrected?.name}>{corrected?.name ?? "未上传"}</span>
          <div className="manual-review-file-controls">{corrected ? <FeedbackDownload fileId={corrected.id}>下载</FeedbackDownload> : null}
            {editable ? <><label className={`manual-feedback-upload${busy ? " is-disabled" : ""}`}>{corrected ? "替换" : "上传批改件"}<input type="file" disabled={busy} onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; if (picked) onUpload(file.id, picked); }} /></label>
              {corrected ? <button disabled={busy} onClick={() => onRemove(corrected.id)} type="button">移除</button> : null}</> : null}
          </div>
        </div>
      </div>;
    })}
    {source.audit ? <p className="manual-review-audit-summary">自动审核：{source.audit.passed ? "通过" : "未通过"}{typeof source.audit.details?.score === "number" ? ` · ${source.audit.details.score} 分` : ""}</p> : null}
    {source.audit || Object.keys(source.auditParams).length ? <details className="manual-review-instructions"><summary>审核标准与反馈</summary>
    {Object.entries(source.auditParams).filter(([key]) => ["documentReviewPrompt", "scanAuditPrompt", "scanAuditMode", "scanAuditThreshold"].includes(key)).map(([key, value]) => <div key={key}>
      <strong>{parameterLabels[key]}</strong>
      <AnswerSheetMarkdown>{key === "scanAuditMode" ? value === "score" ? "评分" : "通过/不通过" : String(value)}</AnswerSheetMarkdown>
    </div>)}
    {source.audit ? <div><strong>自动审核：{source.audit.passed ? "通过" : "未通过"}</strong>
      {typeof source.audit.details?.score === "number" ? <p>评分：{source.audit.details.score}</p> : null}
      <AnswerSheetMarkdown>{source.audit.reason ?? ""}</AnswerSheetMarkdown></div> : null}
    </details> : null}
    {source.manualReview ? <p>人工审核：{source.manualReview.remark || "审核通过"} · {date(source.manualReview.reviewedAt)}</p> : null}
    {!source.submissionId && !source.manualReview ? <p>暂无正式提交内容</p> : null}
    {source.kind === "announcement" && source.submissionId ? <p>{source.submission.confirmed ? "已阅读确认" : "尚未确认"}</p> : null}
    <div className="manual-source-decision">
      {review?.approved ? <p className="manual-source-approved">✓ 已确认通过{review.remark ? ` · ${review.remark}` : ""}</p> : <>
        <textarea aria-label={`${source.title}审核意见`} rows={2} maxLength={1000} placeholder="该节点的审核意见（选填）" disabled={busy || !editable} value={sourceRemark} onChange={(event) => setSourceRemark(event.target.value)} />
        <button className="primary-action" type="button" disabled={busy || !editable} onClick={() => onApprove(sourceRemark)}>{busy ? "正在处理…" : "该节点审核通过"}</button>
      </>}
    </div>
  </section>;
}
