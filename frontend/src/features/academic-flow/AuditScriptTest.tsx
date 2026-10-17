import { AuditReportDialog } from "./AuditReportDialog";
import { Report } from "./AuditHistory";
import { AuditScriptParameterFields } from "./AuditScriptParameterFields";
import { getAuditScriptParameterError, type AuditScriptParameter } from "./auditScripts";
import { LocalMaterialPreviewDialog } from "./MaterialPreviewDialog";
import { createParameterDefaultDraft, type AuditScriptConfigDetail } from "./auditScriptConfig";
import { modelCardsApi, type ModelCard } from "../admin/modelCardsApi";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FileReviewStep } from "../../types";
import { workflowApi, type AuditLLMMessage } from "./api";
import { AuditMessageViewer } from "./AuditMessageViewer";

export function AuditScriptTest({ step, disabled, configurable = false, onParametersChange }: { step: FileReviewStep; disabled: boolean; configurable?: boolean; onParametersChange?: (params: Record<string, string | number | boolean>) => void }) {
  const [parameters, setParameters] = useState<AuditScriptParameter[]>([]);
  const [draft, setDraft] = useState<Record<string, string | number | boolean> | null>(null);
  const [parameterError, setParameterError] = useState("");
  const [parametersReady, setParametersReady] = useState(false);
  const values = draft ?? step.auditScriptParams ?? {};
  const invalid = parameters.some(item => getAuditScriptParameterError(item, values[item.key] ?? item.default));
  const dirty = parameters.some(item => (values[item.key] ?? item.default) !== (step.auditScriptParams?.[item.key] ?? item.default));
  const reportRef = useRef<HTMLDialogElement>(null);
  const [report, setReport] = useState<{ reason: string; passed: boolean | null; completedAt: string } | null>(null);
  useEffect(() => { if (report) reportRef.current?.showModal(); }, [report]);
  const [configuration, setConfiguration] = useState<AuditScriptConfigDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<ModelCard[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [requests, setRequests] = useState<Array<{ messages: AuditLLMMessage[]; response?: string; responseTruncated?: boolean }>>([]);
  const [view, setView] = useState<"messages" | "result">(configurable ? "result" : "messages");
  const [requestIndex, setRequestIndex] = useState(0);
  const [diagnostic, setDiagnostic] = useState<{ stage: string; message: string; exitCode?: number } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const scans = ["image-visual-audit", "image-visual-score-audit"].includes(step.auditScriptId ?? "");
  const accept = (step.auditScriptAcceptedExtensions ?? (scans ? [".jpg", ".jpeg", ".png", ".pdf"] : [])).join(",");
  const json = result ? JSON.stringify(result, null, 2) : "";
  const messages = requests[requestIndex]?.messages;
  const copyText = view === "messages" ? (messages ? JSON.stringify(messages, null, 2) : "") : json;
  const clearOutput = () => {
    setDiagnostic(null); setResult(null); setRequests([]); setRequestIndex(0); setView(configurable ? "result" : "messages"); setError(""); setCopied(false);
  };
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const run = async (showReport = false) => {
    if (!step.auditScriptId || !files.length || requestRef.current || (onParametersChange && (!parametersReady || invalid))) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setRunning(true);
    clearOutput();
    try {
      const response = await workflowApi.testAuditScript(step.auditScriptId, {
        params: configurable && configuration ? createParameterDefaultDraft(configuration) : values, modelCardId: configurable ? modelId : step.auditModelCardId ?? null,
      }, files, controller.signal);
      if (!controller.signal.aborted) {
        setDiagnostic(response.diagnostic ?? null);
        setResult(response.result);
        if (showReport) setReport({
          reason: typeof response.result?.reason === "string" ? response.result.reason : response.error || response.diagnostic?.message || "审核未提供文字说明。",
          passed: typeof response.result?.passed === "boolean" ? response.result.passed : null,
          completedAt: new Date().toISOString(),
        });
        setRequests(response.requests);
        setError(response.error ?? "");
        if (configurable || !response.requests.length) setView("result");
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : "审核测试失败";
        setError(message);
        if (showReport) setReport({ reason: message, passed: null, completedAt: new Date().toISOString() });
      }
    } finally {
      if (!controller.signal.aborted) setRunning(false);
      requestRef.current = null;
    }
  };

  return <>
    <button type="button" className="node-time-settings-toggle audit-test-toggle" disabled={disabled || !step.auditScriptId}
      aria-haspopup="dialog" onClick={async () => {
        setFiles([]); clearOutput();
        dialogRef.current?.showModal();
        if (onParametersChange && step.auditScriptId) {
          setLoading(true); setParametersReady(false); setParameterError("");
          try {
            const scripts = await workflowApi.listAuditScripts();
            const selected = scripts.find(script => script.id === step.auditScriptId);
            if (!selected) throw new Error("未找到当前审核脚本配置");
            setParameters(selected.parameters); setParametersReady(true);
          } catch (reason) { setParameterError(reason instanceof Error ? reason.message : "读取节点配置失败"); }
          finally { setLoading(false); }
        }
        if (configurable && step.auditScriptId) {
          setLoading(true); setConfiguration(null); setModelId(null);
          try {
            const detail = await workflowApi.getAuditScriptConfig(step.auditScriptId);
            const cards = detail.usesAi ? (await modelCardsApi.list()).cards : [];
            setConfiguration(detail);
            setModels(cards);
          } catch (reason) { setError(reason instanceof Error ? reason.message : "读取测试配置失败"); }
          finally { setLoading(false); }
        }
      }}>
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 3 7 5-7 5V3Z" strokeLinejoin="round" /></svg>测试
    </button>
    {createPortal(<dialog ref={dialogRef} className="node-script-config-dialog audit-test-dialog" aria-labelledby={titleId}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); if (!running && !loading) dialogRef.current?.close(); }}>
      <header><div><h2 id={titleId}>审核测试</h2><p>{step.auditScriptName ?? "当前审核步骤"}</p></div>
        <button type="button" aria-label="关闭审核测试" disabled={running || loading} onClick={() => dialogRef.current?.close()}>×</button>
      </header>
      <div className="node-script-config-body audit-test-body">
        {parameterError ? <p role="alert" className="audit-script-error">{parameterError}</p> : null}
        {loading ? <p role="status">正在读取测试配置…</p> : null}
        {configurable && configuration?.usesAi ? <div className="audit-test-configuration">
          <label className="audit-test-model"><span>审核模型</span>
            <select disabled={running} value={modelId ?? ""} onChange={event => { setModelId(event.target.value || null); clearOutput(); }}>
              <option value="">请选择模型</option>{models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.model}</option>)}
            </select>
          </label>
        </div> : null}
        <input ref={inputRef} className="audit-test-file-input" type="file" accept={accept} multiple={scans} disabled={running}
          aria-label="选择审核测试文件" onChange={event => {
            const selected = Array.from(event.currentTarget.files ?? []);
            if (selected.length) {
              setFiles(scans ? [...files, ...selected] : selected.slice(0, 1));
              clearOutput();
            }
            event.currentTarget.value = "";
          }} />
        <div className="audit-test-upload">
          <button type="button" disabled={running} onClick={() => inputRef.current?.click()}>＋ {files.length && !scans ? "替换文件" : "添加文件"}</button>
          <button type="button" disabled={!files.length} onClick={() => setPreviewIndex(0)}>预览</button>
          <small>{scans ? "最多 10 个文件、20 页；单文件 10 MB，合计 30 MB" : "选择一个文件，最大 50 MB"}{accept ? ` · ${accept.replace(/\./g, "").toUpperCase()}` : ""}</small>
        </div>
        {files.length ? <ul className="audit-test-files">{files.map((file, index) => <li key={`${index}-${file.name}`}>
          <span><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(1)} KB</small></span>
          <button type="button" disabled={running} aria-label={`移除 ${file.name}`} onClick={() => {
            setFiles(files.filter((_, position) => position !== index)); clearOutput();
          }}>×</button>
        </li>)}</ul> : null}
        {running ? <p className="audit-test-running" role="status">正在执行审核，请稍候…</p> : null}
        {error ? <p className="audit-script-error" role="alert">{error}</p> : null}
        {diagnostic ? <section className="audit-test-result"><strong>失败诊断 · {diagnostic.stage}</strong>
          <p>{diagnostic.message}{diagnostic.exitCode !== undefined ? `（退出码 ${diagnostic.exitCode}）` : ""}</p>
          {requests.filter(request => request.response !== undefined).map((request, index) => <details key={index}>
            <summary>模型响应 {index + 1}{request.responseTruncated ? "（已截断）" : ""}</summary>
            <pre><code>{request.response}</code></pre>
          </details>)}
        </section> : null}
        {running || result || requests.length || error ? <>
          <div className="audit-test-tabs" role="tablist" aria-label="测试请求与结果">
            {(["messages", "result"] as const).map(tab => <button type="button" key={tab} role="tab"
              id={`${titleId}-${tab}-tab`} aria-controls={`${titleId}-${tab}-panel`} aria-selected={view === tab}
              tabIndex={view === tab ? 0 : -1} onClick={() => { setView(tab); setCopied(false); }}
              onKeyDown={event => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? "messages" : event.key === "End" ? "result" : view === "messages" ? "result" : "messages";
                setView(next); setCopied(false);
                document.getElementById(`${titleId}-${next}-tab`)?.focus();
              }}>{tab === "messages" ? `请求 messages${requests.length ? ` (${requests.length})` : ""}` : "反馈 JSON"}</button>)}
          </div>
          <section className="audit-test-result" role="tabpanel" id={`${titleId}-${view}-panel`}
            aria-labelledby={`${titleId}-${view}-tab`}>
            {view === "messages" ? <>
              {requests.length > 1 ? <div className="audit-test-request-picker" role="group" aria-label="选择模型请求">
                {requests.map((_, index) => <button key={index} type="button" aria-pressed={requestIndex === index}
                  onClick={() => { setRequestIndex(index); setCopied(false); }}>请求 {index + 1}</button>)}
              </div> : null}
              {messages ? <div className="audit-test-messages">
                {messages.map((message, index) => <AuditMessageViewer key={`${requestIndex}-${index}`} message={message} index={index} />)}
                <p className="audit-test-note">以上为实际请求的消息内容；复制 messages 会包含完整图片数据。</p>
              </div> : <p className="audit-test-note">{running ? "执行结束后显示实际请求的 messages。" : error ? "本次没有记录到模型请求，可能在文件处理或请求准备阶段失败。" : "此脚本未调用大模型。"}</p>}
            </> : result ? <>
              <header><strong>反馈 JSON</strong><span className={result.passed ? "is-passed" : "is-rejected"}>{result.passed ? "审核通过" : "审核未通过"}</span></header>
              <pre tabIndex={0}><code>{json}</code></pre>
            </> : <p className="audit-test-note">{running ? "正在等待完整审核反馈。" : "本次未产生审核反馈 JSON。"}</p>}
          </section>
        </> : null}
      </div>
      <footer><div style={{ marginLeft: "auto" }}>
        {copyText ? <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(copyText); setCopied(true); }
          catch { setError("复制失败，请选中内容手动复制。"); }
        }}>{copied ? "已复制" : view === "messages" ? "复制 messages" : "复制 JSON"}</button> : null}
        <button type="button" className="primary-action" disabled={running || loading || (!!onParametersChange && (!parametersReady || invalid)) || (configurable && (!configuration || (configuration.usesAi && !modelId))) || !files.length || (scans && files.length > 10)} onClick={() => void run()}>{running ? "审核中…" : result ? "重新测试" : "开始测试"}</button>
      </div></footer>
    </dialog>, document.body)}
    {previewIndex !== null ? <LocalMaterialPreviewDialog files={files} initialIndex={previewIndex} onClose={() => setPreviewIndex(null)} sidebar={onParametersChange ? <>
      <h3>节点审核配置</h3>
      {loading ? <p role="status">正在读取配置…</p> : parameterError ? <p role="alert">{parameterError}</p> : parametersReady ?
        <AuditScriptParameterFields parameters={parameters} value={values} disabled={disabled || running}
          onChange={(key, value) => { setDraft({ ...values, [key]: value }); clearOutput(); }} /> : null}
      <div className="audit-preview-actions">
        <button type="button" disabled={disabled || running || !parametersReady || invalid || !dirty}
          onClick={() => { onParametersChange({ ...Object.fromEntries(parameters.map(item => [item.key, item.default])), ...values }); setDraft(null); }}>应用到节点配置</button>
        <button type="button" disabled={disabled || running || !parametersReady || invalid || !files.length || (scans && files.length > 10)}
          onClick={() => void run(true)}>{running ? "审核中…" : "测试当前配置"}</button>
      </div>
    </> : undefined} /> : null}
    <AuditReportDialog dialogRef={reportRef} title="本次测试结果" subtitle={step.auditScriptName ?? "当前审核步骤"}
      passed={report?.passed ?? null} reviewedAt={report?.completedAt ?? null} reason={report?.reason ?? ""} returnLabel="返回文档预览">
      <Report value={report?.reason ?? ""} />
    </AuditReportDialog>
  </>;
}
