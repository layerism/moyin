import { useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export function AuditReportDialog({ dialogRef, title, subtitle, passed, reviewedAt, reason, returnLabel, children }: {
  dialogRef: RefObject<HTMLDialogElement>;
  title: string;
  subtitle: string;
  passed: boolean | null;
  reviewedAt: string | null;
  reason: string;
  returnLabel: string;
  children: ReactNode;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const close = () => dialogRef.current?.close();
  const copy = async () => {
    try { await navigator.clipboard.writeText(reason); setCopyStatus("已复制"); }
    catch { setCopyStatus("复制失败，请选中正文复制。"); }
  };
  return createPortal(<dialog ref={dialogRef} className="runtime-audit-report-dialog audit-report-polished"
    aria-label={`${title}审核报告`} onClose={() => setCopyStatus("")}
    onKeyDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
    <header>
      <span className="audit-report-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6" /></svg></span>
      <div className="audit-report-heading"><h3>{title}</h3><p>{subtitle}</p></div>
      <button type="button" className="audit-report-close" aria-label="关闭报告" onClick={close}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 4 12 12M16 4 4 16" /></svg></button>
    </header>
    <div className="audit-report-meta">
      <span className={`audit-report-status ${passed === true ? "is-passed" : passed === false ? "is-rejected" : ""}`}>{passed === true ? "通过" : passed === false ? "未通过" : "未记录结论"}</span>
      <span>{reviewedAt ? <>审核时间：<time dateTime={reviewedAt}>{new Date(reviewedAt).toLocaleString("zh-CN")}</time></> : "审核时间未记录"}</span>
    </div>
    <div className="runtime-audit-report-body">{children}</div>
    <footer><span className="audit-report-copy-status" role="status">{copyStatus}</span>
      <button type="button" onClick={() => void copy()}>复制报告</button>
      <button type="button" className="audit-report-return" onClick={close}>{returnLabel}</button>
    </footer>
  </dialog>, document.body);
}
