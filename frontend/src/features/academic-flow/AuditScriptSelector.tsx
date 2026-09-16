import { useEffect, useRef, useState } from "react";

import type { AcademicFlowNode } from "../../types";
import { workflowApi } from "./api";
import {
  getAuditScriptOptions,
  getAuditScriptParameterError,
  getSelectedAuditScriptValue,
  resolveAuditScriptSelection,
  type AuditScriptParameter,
  type AuditScriptSummary,
} from "./auditScripts";

export function AuditScriptSelector({
  disabled = false,
  node,
  onChange,
  parameterDisabled = disabled,
  parameters,
}: {
  disabled?: boolean;
  node: AcademicFlowNode;
  onChange: (patch: Partial<AcademicFlowNode>) => void;
  parameterDisabled?: boolean;
  parameters?: AuditScriptParameter[];
}) {
  const [scripts, setScripts] = useState<AuditScriptSummary[]>([]);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({});

  useEffect(() => { dialogRef.current?.close(); }, [node.id, node.auditScriptId]);

  useEffect(() => {
    let cancelled = false;
    workflowApi
      .listAuditScripts()
      .then((items) => {
        if (!cancelled) setScripts(items);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "脚本列表加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = getAuditScriptOptions(scripts, node);
  const selectedValue = getSelectedAuditScriptValue(node);
  const selectedScript = scripts.find(
    (script) => `uploaded:${script.id}` === selectedValue,
  );
  const parameterDefinitions = parameters ?? selectedScript?.parameters ?? [];
  const updateParameter = (key: string, value: string | number | boolean) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const openConfig = () => {
    setDraft({ ...Object.fromEntries(parameterDefinitions.map((item) => [item.key, item.default])), ...node.auditScriptParams });
    dialogRef.current?.showModal();
  };
  const invalid = parameterDefinitions.some((item) => getAuditScriptParameterError(item, draft[item.key] ?? item.default));

  return (
    <div className="audit-script-section">
      <div className="audit-script-selector-row">
        <strong className="node-file-material-label">审核</strong>
        <select
          aria-label="材料审核脚本"
          disabled={disabled}
          value={selectedValue}
          onChange={(event) => onChange(resolveAuditScriptSelection(event.target.value, scripts))}
        >
          {options.map((option) => (
            <option key={option.value || "none"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {selectedValue ? <button className="node-script-config-toggle" type="button" aria-label="审核脚本配置" title="审核脚本配置" aria-haspopup="dialog" onClick={openConfig}>
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 3-.6 2.3-2 .9-2.2-.6-2 3.4 1.6 1.7v2.6L2.2 15l2 3.4 2.2-.6 2 .9L9 21h4l.6-2.3 2-.9 2.2.6 2-3.4-1.6-1.7v-2.6L19.8 9l-2-3.4-2.2.6-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/></svg>
        </button> : null}
        {disabled && selectedValue ? (
          <small className="audit-script-lock">🔒 脚本固化</small>
        ) : null}
      </div>
      <dialog ref={dialogRef} className="node-script-config-dialog" aria-labelledby="node-script-config-title" onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); dialogRef.current?.close(); }}>
        <header><div><h2 id="node-script-config-title">审核脚本配置</h2><p>{selectedScript?.name ?? node.auditScriptName}</p></div><button type="button" aria-label="关闭脚本配置" onClick={() => dialogRef.current?.close()}>×</button></header>
        <div className="node-script-config-body">
        {parameterDefinitions.length ? <div className="audit-script-parameters">
          {parameterDefinitions.map((parameter) => {
            const value = draft[parameter.key] ?? parameter.default;
            const parameterError = getAuditScriptParameterError(parameter, value);
            const isLongText = parameter.type === "string" && parameter.maximumLength > 500;
            return (
              <label
                className={`audit-script-parameter ${isLongText ? "is-long-text" : ""}`}
                key={parameter.key}
              >
                <span>{parameter.label}</span>
                {parameter.type === "boolean" ? (
                  <input
                    checked={value === true}
                    disabled={parameterDisabled}
                    type="checkbox"
                    onChange={(event) => updateParameter(parameter.key, event.target.checked)}
                  />
                ) : parameter.type === "select" ? (
                  <select
                    disabled={parameterDisabled}
                    value={String(value)}
                    onChange={(event) => updateParameter(parameter.key, event.target.value)}
                  >
                    {parameter.options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : isLongText && parameter.type === "string" ? (
                  <span className="audit-script-long-text-input">
                    <textarea
                      disabled={parameterDisabled}
                      maxLength={parameter.maximumLength}
                      minLength={parameter.minimumLength}
                      value={String(value)}
                      onChange={(event) => updateParameter(parameter.key, event.target.value)}
                    />
                    <small>{String(value).length}/{parameter.maximumLength}</small>
                  </span>
                ) : (
                  <input
                    disabled={parameterDisabled}
                    max={parameter.type === "integer" || parameter.type === "number" ? parameter.maximum : undefined}
                    maxLength={parameter.type === "string" ? parameter.maximumLength : undefined}
                    min={parameter.type === "integer" || parameter.type === "number" ? parameter.minimum : undefined}
                    minLength={parameter.type === "string" ? parameter.minimumLength : undefined}
                    step={parameter.type === "integer" ? 1 : parameter.type === "number" ? "any" : undefined}
                    type={parameter.type === "string" ? "text" : "number"}
                    value={String(value)}
                    onChange={(event) => {
                      const next = event.target.value;
                      updateParameter(
                        parameter.key,
                        parameter.type === "string" || next === "" ? next : Number(next),
                      );
                    }}
                  />
                )}
                {parameter.description ? <small>{parameter.description}</small> : null}
                {parameterError ? <small className="audit-script-error">{parameterError}</small> : null}
              </label>
            );
          })}
        </div> : <p>此脚本没有可配置的节点参数。</p>}
        </div>
        <footer><small>确认后应用到当前节点，点击节点“完成”后按现有规则保存。</small><div><button type="button" onClick={() => dialogRef.current?.close()}>取消</button><button className="primary-action" type="button" disabled={parameterDisabled || invalid} onClick={() => { onChange({ auditScriptParams: draft }); dialogRef.current?.close(); }}>确认配置</button></div></footer>
      </dialog>
      {error ? <p className="audit-script-error" role="alert">{error}</p> : null}
    </div>
  );
}
