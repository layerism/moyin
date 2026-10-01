import { AuditReportDialog } from "./AuditReportDialog";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RuntimeAuditHistoryEntry, RuntimeNodeInstance } from "./runtimeTypes";

export function Report({ value }: { value: string }) {
  return <div className="runtime-audit-markdown"><Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
    img: () => null,
  }}>{value.trim() || "审核未提供文字说明。"}</Markdown></div>;
}

export function AuditHistory({ runtime }: { runtime: RuntimeNodeInstance }) {
  const entries = runtime.auditHistory ?? [];
  if (!entries.length) return null;
  const attempts = [...new Set(entries.map((entry) => entry.attemptNo))];
  return <section className="runtime-audit-history" aria-label="AI 审核结论">
    <h3>AI 审核结论</h3>
    {attempts.map((attempt) => <section key={attempt}>
      <h4>{attempt === runtime.attemptNo ? "本次提交" : `第 ${attempt} 次提交`}<small>{attempt === runtime.attemptNo ? "" : "历史记录，仅供参考"}</small></h4>
      <ol>{entries.filter((entry) => entry.attemptNo === attempt).map((entry) => <HistoryEntry key={entry.id} entry={entry} />)}</ol>
    </section>)}
  </section>;
}

function HistoryEntry({ entry }: { entry: RuntimeAuditHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLLIElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || expanded) return;
    const measure = () => setOverflowing(preview.scrollHeight > preview.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
    measure();
    return () => observer.disconnect();
  }, [entry.reason, expanded]);
  const reviewedAt = entry.reviewedAt ? new Date(entry.reviewedAt).toLocaleString("zh-CN") : "时间未记录";
  return <li className={entry.passed ? "is-passed" : "is-rejected"} ref={cardRef}>
    <header><strong>{entry.scriptName}</strong><span>{entry.passed ? "通过" : "未通过"}</span></header>
    <time>{reviewedAt}</time>
    <div className={`runtime-audit-preview${expanded ? " is-expanded" : ""}`} ref={previewRef}><Report value={entry.reason} /></div>
    <div className="runtime-audit-history-actions">
      {overflowing || expanded ? <button type="button" aria-expanded={expanded} onClick={() => {
        if (expanded) cardRef.current?.scrollIntoView({ block: "start" });
        setExpanded(!expanded);
      }}>{expanded ? "收起全文" : "展开全文"}</button> : null}
      {entry.reason.trim() ? <button type="button" onClick={() => dialogRef.current?.showModal()}>查看报告 ↗</button> : null}
    </div>
    <AuditReportDialog dialogRef={dialogRef} title={entry.scriptName}
      subtitle={`第 ${entry.attemptNo} 次提交 · AI 审核报告`} passed={entry.passed} reviewedAt={entry.reviewedAt}
      reason={entry.reason} returnLabel="返回审核记录"><Report value={entry.reason} /></AuditReportDialog>
  </li>;
}
