import { useRef } from "react";
import { AuditHistory, Report } from "./AuditHistory";
import { FeedbackDownload } from "./ManualFeedbackList";
import { FileFormatIcon } from "./FileFormatIcon";
import type { RuntimeNodeInstance } from "./runtimeTypes";

type Attempt = NonNullable<RuntimeNodeInstance["reviewTimeline"]>[number];
const labels: Record<string, string> = { passed: "通过", rejected: "未通过", active: "审核中", waiting: "待开始", stopped: "未执行" };
const date = (value: string) => new Date(value).toLocaleString("zh-CN");

function latestAnnotations(items: Attempt["steps"][number]["annotations"]) {
  return items.reduce<typeof items>((latest, item) =>
    !latest.length || new Date(item.publishedAt).getTime() >= new Date(latest[0].publishedAt).getTime() ? [item] : latest, []);
}

export function ReviewProgress({ runtime, onPreviewReview }: { runtime: RuntimeNodeInstance; onPreviewReview?: () => void }) {
  const attempts = runtime.reviewTimeline ?? [];
  if (!attempts.length) return <AuditHistory runtime={{ ...runtime, auditHistory: (runtime.auditHistory ?? []).filter((entry) => entry.attemptNo === runtime.attemptNo) }} />;
  const current = attempts.find((item) => item.attemptNo === runtime.attemptNo);
  return <section className="runtime-review-progress" aria-label="审核进度">
    <header><h3>审核进度</h3><small>本次审核</small></header>
    {runtime.status === "reviewing" ? <p className="review-progress-notice" role="status">{runtime.reviewStage === "manual" ? "等待教师最终审核" : "正在进行 AI 审核"} · 结果自动刷新</p> : null}
    {current ? <Steps attempt={current} onPreviewReview={(runtime.reviewStage === "manual" || runtime.status === "approved" || runtime.status === "rejected") ? onPreviewReview : undefined} /> : null}
  </section>;
}

function Steps({ attempt, onPreviewReview }: { attempt: Attempt; onPreviewReview?: () => void }) {
  return <ol className="review-progress-steps">{attempt.steps.map((step) => {
    const annotations = latestAnnotations(step.annotations);
    return <li key={step.index}>
    <span className="review-step-number">{step.index + 1}</span>
    <details className="review-step-disclosure">
      <summary><span className="review-step-heading"><strong>{step.kind === "manual" ? "人工审核" : step.kind === "score" ? "AI 评分审核" : "AI 审核"}</strong><small className={`review-step-description${step.kind === "manual" ? " is-manual" : ""}`}>{step.kind === "manual" ? "由教师复核材料并给出最终结论" : step.kind === "score" ? "依据评分标准评估提交内容并给出分数" : step.audit?.scriptName.replace(/^第 \d+ 步 · /, "") || "按配置的规则检查提交文件"}</small>
        {step.kind === "manual" ? <small className="review-step-feedback-count">{annotations.length} 条反馈 · {annotations.reduce((count, item) => count + item.files.length, 0)} 个附件</small> : null}</span><span className={`review-status is-${step.status}`}>{labels[step.status] ?? "待开始"}</span>{step.kind === "manual" && (step.status === "active" || (step.index === attempt.steps.length - 1 && ["passed", "rejected"].includes(step.status))) && onPreviewReview ? <button type="button" className="review-preview-action" onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onPreviewReview();
      }}>{step.status === "active" ? "模拟审核" : "修改审核结果"}</button> : null}</summary>
      <div className="review-step-detail">
        {step.kind === "score" && !step.audit?.reason ? <span>{labels[step.status] ?? "待开始"}</span> : null}
        {step.audit?.reason ? <AuditDetail audit={step.audit} /> : null}
        {annotations.map((item) => <article className="review-annotation" key={item.id}>
          <header><strong>最新评语</strong><time>{date(item.publishedAt)}</time><span>{item.passed === undefined ? "补充意见" : item.passed ? "通过" : "退回修改"}</span></header>
          <Report value={item.remark} />
          {item.files.map((file) => <div className="review-feedback-file" key={file.id}><FileFormatIcon filename={file.name} /><span title={file.name}>{file.name}<small>{(file.sizeBytes / 1024).toFixed(1)} KB</small></span><FeedbackDownload fileId={file.id} filename={file.name} student>下载</FeedbackDownload></div>)}
        </article>)}
        {!step.audit && !annotations.length ? <p className="review-progress-empty">{step.status === "active" ? "暂未发布审核意见。" : step.status === "passed" ? "此步骤已完成，未记录详细意见。" : "此步骤尚无审核结论。"}</p> : null}
      </div>
    </details>
  </li>; })}</ol>;
}

function AuditDetail({ audit }: { audit: NonNullable<Attempt["steps"][number]["audit"]> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <><small>{audit.reviewedAt ? date(audit.reviewedAt) : "时间未记录"}</small><div className="review-reason-scroll"><Report value={audit.reason} /></div>
    {audit.reason ? <button type="button" className="review-report-button" onClick={() => dialog.current?.showModal()}>查看完整报告 ↗</button> : null}
    <dialog ref={dialog} className="runtime-audit-report-dialog" aria-label="AI 审核报告" onKeyDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <header><h3>{audit.scriptName}</h3><button type="button" aria-label="关闭报告" onClick={() => dialog.current?.close()}>×</button></header><div className="runtime-audit-report-body"><Report value={audit.reason} /></div><footer><button type="button" onClick={() => dialog.current?.close()}>返回审核进度</button></footer>
    </dialog></>;
}

export function CompletedReviewFeedback({ runtime }: { runtime: RuntimeNodeInstance }) {
  const current = runtime.reviewTimeline?.find((attempt) => attempt.attemptNo === runtime.attemptNo);
  const annotations = latestAnnotations(current?.steps.filter((step) => step.kind === "manual").flatMap((step) => step.annotations) ?? []);
  if (!annotations.length) return null;
  return <section className="completed-review-feedback" aria-label="教师评语与评阅附件">
    <header><h3>教师评语与评阅附件</h3><small>可下载评阅文件查看</small></header>
    {annotations.map((item) => <article key={item.id}>
      <time>{date(item.publishedAt)}</time><Report value={item.remark} />
      {item.files.map((file) => <div className="review-feedback-file" key={file.id}>
        <FileFormatIcon filename={file.name} /><span>{file.name}<small>{(file.sizeBytes / 1024).toFixed(1)} KB</small></span>
        <FeedbackDownload fileId={file.id} filename={file.name} student iconOnly />
      </div>)}
    </article>)}
  </section>;
}
