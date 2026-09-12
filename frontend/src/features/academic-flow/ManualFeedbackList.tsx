import { useState, type ReactNode } from "react";
import { workflowApi } from "./api";
import type { ManualFeedback, ManualSourceReview, ManualFeedbackFile } from "./runtimeTypes";

export function FeedbackDownload({ fileId, student = false, children }: { fileId: string; student?: boolean; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async () => {
    setBusy(true); setError("");
    try {
      const result = await workflowApi.downloadManualFeedback(fileId, student);
      const anchor = document.createElement("a");
      anchor.href = result.url; anchor.rel = "noreferrer"; anchor.download = "";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "下载失败"); }
    finally { setBusy(false); }
  };
  return <span><button type="button" disabled={busy} onClick={() => void download()}>{busy ? "正在下载…" : children}</button>{error ? <small role="alert" className="dialog-error">{error}</small> : null}</span>;
}

function FeedbackFiles({ files, student }: { files: ManualFeedbackFile[]; student: boolean }) {
  return <>{files.map((file) => <div key={file.id} className="manual-feedback-published-file">
    <span><strong>{file.name}</strong><small>对应原件：{file.sourceName}</small></span>
    <FeedbackDownload fileId={file.id} student={student}>下载批改件</FeedbackDownload>
  </div>)}</>;
}

export function ManualFeedbackList({ feedback, student = false, sources = [] }: { feedback: ManualFeedback[]; student?: boolean; sources?: ManualSourceReview[] }) {
  if (!feedback.length && !sources.length) return null;
  const current = feedback.find((item) => !item.historical);
  const history = feedback.filter((item) => item.historical);
  const render = (item: ManualFeedback) => <article key={item.id} className="manual-feedback-published">
    <small>{new Date(item.publishedAt).toLocaleString("zh-CN")}{item.historical ? " · 历史版本" : " · 最新反馈"}</small>
    {item.remark ? <p>{item.remark}</p> : null}
    <FeedbackFiles files={item.files} student={student} />
  </article>;
  const ungrouped = current?.files.filter((file) => !sources.some((source) => source.nodeKey === file.sourceNodeKey)) ?? [];
  return <section className="manual-feedback-list"><h4>{sources.length ? "节点审核与反馈" : "教师反馈"}</h4>
    {sources.length ? <>
      {current?.remark ? <p className="manual-feedback-overall">{current.remark}</p> : null}
      {sources.map((source) => <article key={source.nodeKey} className="manual-feedback-source">
        <header><strong>{source.title}</strong><span className={source.rejected ? "is-rejected" : source.approved ? "is-approved" : ""}>{source.rejected ? "未通过" : source.approved ? "已通过" : "待教师审核"}</span></header>
        {source.reviewedAt ? <small>审核于 {new Date(source.reviewedAt).toLocaleString("zh-CN")}</small> : null}
        {source.remark ? <p>{source.remark}</p> : null}
        <FeedbackFiles files={current?.files.filter((file) => file.sourceNodeKey === source.nodeKey) ?? []} student={student} />
      </article>)}
      {ungrouped.length ? <article className="manual-feedback-published"><h4>其他批改文件</h4><FeedbackFiles files={ungrouped} student={student} /></article> : null}
    </> : current ? render(current) : null}
    {history.length ? <details><summary>历史反馈（{history.length}）</summary>
      <p>以下反馈对应较早的材料或批改版本。</p>{history.map(render)}
    </details> : null}
  </section>;
}
