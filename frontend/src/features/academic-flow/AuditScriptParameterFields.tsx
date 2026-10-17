import { PromptTextarea } from "./PromptTextarea";
import { getAuditScriptParameterError, type AuditScriptParameter } from "./auditScripts";

export function AuditScriptParameterFields({ parameters: parameterDefinitions, value: draft, disabled: parameterDisabled, onChange: updateParameter }: {
  parameters: AuditScriptParameter[];
  value: Record<string, string | number | boolean>;
  disabled: boolean;
  onChange: (key: string, value: string | number | boolean) => void;
}) {
  return <>
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
                <PromptTextarea
                  key={parameter.key}
                  disabled={parameterDisabled}
                  maxLength={parameter.maximumLength}
                  minLength={parameter.minimumLength}
                  value={String(value)}
                  onChange={value => updateParameter(parameter.key, value)}
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
  </>;
}
