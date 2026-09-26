import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FileReviewStep } from "../../types";
import { workflowApi } from "./api";

export function AuditScriptTest({ step, disabled }: { step: FileReviewStep; disabled: boolean }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const scans = ["image-visual-audit", "image-visual-score-audit"].includes(step.auditScriptId ?? "");
  const accept = (step.auditScriptAcceptedExtensions ?? (scans ? [".jpg", ".jpeg", ".png", ".pdf"] : [])).join(",");
  const json = result ? JSON.stringify(result, null, 2) : "";
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const run = async () => {
    if (!step.auditScriptId || !files.length || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setRunning(true);
    setError("");
    setResult(null);
    setCopied(false);
    try {
      const response = await workflowApi.testAuditScript(step.auditScriptId, {
        params: step.auditScriptParams ?? {}, modelCardId: step.auditModelCardId ?? null,
      }, files, controller.signal);
      if (!controller.signal.aborted) setResult(response);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "审核测试失败");
    } finally {
      if (!controller.signal.aborted) setRunning(false);
      requestRef.current = null;
    }
  };

  return <>
    <button type="button" className="node-time-settings-toggle audit-test-toggle" disabled={disabled || !step.auditScriptId}
      aria-haspopup="dialog" onClick={() => {
        setFiles([]); setResult(null); setError(""); setCopied(false);
        dialogRef.current?.showModal();
      }}>
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 3 7 5-7 5V3Z" strokeLinejoin="round" /></svg>测试
    </button>
    {createPortal(<dialog ref={dialogRef} className="node-script-config-dialog audit-test-dialog" aria-labelledby={titleId}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); if (!running) dialogRef.current?.close(); }}>
      <header><div><h2 id={titleId}>审核测试</h2><p>{step.auditScriptName ?? "当前审核步骤"}</p></div>
        <button type="button" aria-label="关闭审核测试" disabled={running} onClick={() => dialogRef.current?.close()}>×</button>
      </header>
      <div className="node-script-config-body audit-test-body">
        <p className="audit-test-note">使用当前步骤的审核要点和模型配置。AI 审核会调用所选模型，测试结果不会写入学生流程。</p>
        <input ref={inputRef} className="audit-test-file-input" type="file" accept={accept} multiple={scans} disabled={running}
          aria-label="选择审核测试文件" onChange={event => {
            const selected = Array.from(event.currentTarget.files ?? []);
            if (selected.length) {
              setFiles(scans ? [...files, ...selected] : selected.slice(0, 1));
              setResult(null); setError(""); setCopied(false);
            }
            event.currentTarget.value = "";
          }} />
        <div className="audit-test-upload">
          <button type="button" disabled={running} onClick={() => inputRef.current?.click()}>＋ {files.length && !scans ? "替换文件" : "添加文件"}</button>
          <small>{scans ? "最多 10 个文件、20 页；单文件 10 MB，合计 30 MB" : "选择一个文件，最大 50 MB"}{accept ? ` · ${accept.replaceAll(".", "").toUpperCase()}` : ""}</small>
        </div>
        {files.length ? <ul className="audit-test-files">{files.map((file, index) => <li key={`${index}-${file.name}`}>
          <span><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(1)} KB</small></span>
          <button type="button" disabled={running} aria-label={`移除 ${file.name}`} onClick={() => {
            setFiles(files.filter((_, position) => position !== index)); setResult(null); setCopied(false);
          }}>×</button>
        </li>)}</ul> : <div className="audit-test-empty">添加文件后即可开始测试</div>}
        {running ? <p className="audit-test-running" role="status">正在执行审核，请稍候…</p> : null}
        {error ? <p className="audit-script-error" role="alert">{error}</p> : null}
        {result ? <section className="audit-test-result" aria-label="审核反馈 JSON">
          <header><strong>反馈 JSON</strong><span className={result.passed ? "is-passed" : "is-rejected"}>{result.passed ? "审核通过" : "审核未通过"}</span></header>
          <pre tabIndex={0}><code>{json}</code></pre>
        </section> : null}
      </div>
      <footer><small>文件仅用于本次测试，结束后清理。</small><div>
        {result ? <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(json); setCopied(true); }
          catch { setError("复制失败，请选中 JSON 手动复制。"); }
        }}>{copied ? "已复制" : "复制 JSON"}</button> : null}
        <button type="button" className="primary-action" disabled={running || !files.length || (scans && files.length > 10)} onClick={() => void run()}>{running ? "审核中…" : result ? "重新测试" : "开始测试"}</button>
      </div></footer>
    </dialog>, document.body)}
  </>;
}
