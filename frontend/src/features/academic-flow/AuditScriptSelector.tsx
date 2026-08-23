import { useEffect, useState } from "react";

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
    onChange({
      auditScriptParams: { ...(node.auditScriptParams ?? {}), [key]: value },
    });
  };

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
        {disabled && selectedValue ? (
          <small className="audit-script-lock">🔒 脚本固化</small>
        ) : null}
      </div>
      {parameterDefinitions.length ? (
        <div className="audit-script-parameters">
          {parameterDefinitions.map((parameter) => {
            const value = node.auditScriptParams?.[parameter.key] ?? parameter.default;
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
        </div>
      ) : null}
      {error ? <p className="audit-script-error" role="alert">{error}</p> : null}
    </div>
  );
}
