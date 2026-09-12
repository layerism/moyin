import { useState, type ReactNode } from "react";
import { workflowApi } from "./api";
import type { ManualFeedback } from "./runtimeTypes";

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

export function ManualFeedbackList({ feedback, student = false }: { feedback: ManualFeedback[]; student?: boolean }) {
  if (!feedback.length) return null;
  const render = (item: ManualFeedback) => <article key={item.id} className="manual-feedback-published">
    <small>{new Date(item.publishedAt).toLocaleString("zh-CN")}{item.historical ? " · 历史版本" : " · 最新反馈"}</small>
    {item.remark ? <p>{item.remark}</p> : null}
    {item.files.map((file) => <div key={file.id} className="manual-feedback-published-file">
      <span><small>对应原件：{file.sourceName}</small><strong>{file.name}</strong></span>
      <FeedbackDownload fileId={file.id} student={student}>下载批改件</FeedbackDownload>
    </div>)}
    {!item.remark && !item.files.length ? <p>教师未附加备注或批改文件。</p> : null}
  </article>;
  return <section className="manual-feedback-list"><h4>教师反馈</h4>
    {feedback.filter((item) => !item.historical).map(render)}
    {feedback.some((item) => item.historical) ? <details><summary>历史反馈（{feedback.filter((item) => item.historical).length}）</summary>
      <p>以下反馈对应较早的材料或批改版本。</p>{feedback.filter((item) => item.historical).map(render)}
    </details> : null}
  </section>;
}
