import { useCallback, useEffect, useRef, useState } from "react";
import type { AcademicFlowNode } from "../../types";
import { ApiError, workflowApi } from "./api";
import type { ManualReviewDetail, ManualReviewQueue, RuntimeNodeStatus } from "./runtimeTypes";
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
      if (!cancelled) setDetail(next);
    }).catch((reason: Error) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeId, refresh]);

  const approve = async () => {
    if (!detail || detail.nodeInstanceId !== activeId || saving) return;
    setSaving(true);
    setError("");
    try {
      await workflowApi.approveManualReview(detail.nodeInstanceId, detail.evidenceHash, remark);
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

  return <dialog className="manual-review-dialog" ref={dialog} aria-labelledby="manual-review-title"
    onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
    <header><div><small>人工审核</small><h2 id="manual-review-title">{queue?.title ?? "正在读取审核列表"}</h2></div>
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
          <h3>{detail.student.name} · {detail.student.studentNo}</h3>
          <p>{labels[category(detail.status)]}</p>
          <AnswerSheetMarkdown>{detail.requirement}</AnswerSheetMarkdown>
          {detail.sources.map((source) => <SourceMaterial key={`${detail.nodeInstanceId}-${source.nodeKey}`} source={source} />)}
          {detail.history.length ? <details><summary>历史审核记录（{detail.history.length}）</summary>
            {detail.history.map((record) => <p key={record.id}>{date(record.reviewedAt)} · {record.teacherName} · {record.remark || "审核通过"}</p>)}
          </details> : null}
          {detail.status === "reviewing" ? <div className="manual-review-action">
            <label>审核备注（学生可见，可选）<textarea maxLength={1000} disabled={saving} value={remark} onChange={(event) => setRemark(event.target.value)} /></label>
            <button className="primary-action" disabled={saving} onClick={() => void approve()} type="button">{saving ? "正在保存…" : "审核通过"}</button>
          </div> : <p>{detail.status === "approved" ? "本轮审核已通过。" : "前置节点全部通过且到达审核开始时间后，才可审核通过。"}</p>}
        </> : active && !activeId ? <p>该学生尚未进入流程，暂无提交材料。</p> : !error && !loading ? <p>请选择待审核学生。</p> : null}
      </section>
    </div>
  </dialog>;
}

function SourceMaterial({ source }: { source: ManualReviewDetail["sources"][number] }) {
  const node: AcademicFlowNode = {
    id: source.nodeKey, title: source.title, kind: source.kind, requirement: source.requirement,
    infoFields: source.infoFields, answerSheet: source.answerSheet ?? undefined,
    auditScriptName: "", auditScriptType: "none", fileExtensions: "", fileLimitMb: "", status: "disabled", x: 0, y: 0,
  };
  return <section className="manual-review-source">
    <h4>{source.title}</h4><small>{source.status === "approved" ? "已通过" : "前置节点尚未通过"} · {date(source.submittedAt)}</small>
    <AnswerSheetMarkdown>{source.requirement}</AnswerSheetMarkdown>
    {source.submissionId && source.kind === "form" ? <ReadonlyFormFields fields={source.infoFields} payload={source.submission} /> : null}
    {source.submissionId && source.kind === "answer_sheet" ? <>
      <RuntimeAnswerSheet errors={{}} instanceId="" node={node} payload={source.submission} readonly />
      {source.grade ? <AnswerSheetGradeResult grade={source.grade} node={node} /> : null}
    </> : null}
    {source.files.map((file) => <a className="manual-review-file" href={file.url} key={file.id} target="_blank" rel="noreferrer">
      <span>{file.original_name}</span><small>{Math.ceil(file.size_bytes / 1024)} KB · 下载</small>
    </a>)}
    {Object.entries(source.auditParams).filter(([key]) => ["documentReviewPrompt", "scanAuditPrompt", "scanAuditMode", "scanAuditThreshold"].includes(key)).map(([key, value]) => <div key={key}>
      <strong>{parameterLabels[key]}</strong>
      <AnswerSheetMarkdown>{key === "scanAuditMode" ? value === "score" ? "评分" : "通过/不通过" : String(value)}</AnswerSheetMarkdown>
    </div>)}
    {source.audit ? <div><strong>自动审核：{source.audit.passed ? "通过" : "未通过"}</strong>
      {typeof source.audit.details?.score === "number" ? <p>评分：{source.audit.details.score}</p> : null}
      <AnswerSheetMarkdown>{source.audit.reason ?? ""}</AnswerSheetMarkdown></div> : null}
    {source.manualReview ? <p>人工审核：{source.manualReview.remark || "审核通过"} · {date(source.manualReview.reviewedAt)}</p> : null}
    {!source.submissionId && !source.manualReview ? <p>暂无正式提交内容</p> : null}
    {source.kind === "announcement" && source.submissionId ? <p>{source.submission.confirmed ? "已阅读确认" : "尚未确认"}</p> : null}
  </section>;
}
