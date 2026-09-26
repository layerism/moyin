import type { ReactNode } from "react";
import type { AuditScriptRuntimeSetting } from "./auditScripts";
import type { AuditScriptValue } from "./auditScriptConfig";
import { ScriptPromptEditor } from "./ScriptPromptEditor";

function ConfigInput({
  definition,
  disabled,
  error,
  onChange,
  value,
}: {
  definition: AuditScriptRuntimeSetting;
  disabled: boolean;
  error: string;
  onChange: (value: AuditScriptValue) => void;
  value: AuditScriptValue;
}) {
  const inputId = `audit-script-config-setting-${definition.key}`;
  const errorId = `${inputId}-error`;
  const descriptionId = `${inputId}-description`;
  const describedBy = [definition.description ? descriptionId : "", error ? errorId : ""]
    .filter(Boolean)
    .join(" ") || undefined;

  if (definition.key === "systemPrompt" && definition.type === "string") {
    return <ScriptPromptEditor label={definition.label} value={String(value)} disabled={disabled}
      minimumLength={definition.minimumLength} maximumLength={definition.maximumLength}
      error={error} onChange={onChange} />;
  }

  if (definition.type === "boolean") {
    return (
      <div className="audit-script-config-field" title={definition.description}>
        <span>{definition.label}</span>
        {definition.description ? <small id={descriptionId}>{definition.description}</small> : null}
        <label className="audit-script-config-boolean-control" htmlFor={inputId}>
          <span>启用</span>
          <input
            aria-describedby={describedBy}
            checked={value === true}
            disabled={disabled}
            id={inputId}
            onChange={(event) => onChange(event.target.checked)}
            type="checkbox"
          />
        </label>
      </div>
    );
  }

  return (
    <label className="audit-script-config-field" htmlFor={inputId} title={definition.description}>
      <span>{definition.label}</span>
      {definition.description ? <small id={descriptionId}>{definition.description}</small> : null}
      {definition.type === "select" ? (
        <select
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          disabled={disabled}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          value={String(value)}
        >
          {definition.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      ) : definition.type === "string" && "multiline" in definition && definition.multiline ? (
        <textarea
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          disabled={disabled}
          id={inputId}
          maxLength={definition.maximumLength}
          minLength={definition.minimumLength}
          onChange={(event) => onChange(event.target.value)}
          rows={7}
          value={String(value)}
        />
      ) : (
        <input
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          disabled={disabled}
          id={inputId}
          max={definition.type === "integer" || definition.type === "number" ? definition.maximum : undefined}
          maxLength={definition.type === "string" ? definition.maximumLength : undefined}
          min={definition.type === "integer" || definition.type === "number" ? definition.minimum : undefined}
          minLength={definition.type === "string" ? definition.minimumLength : undefined}
          onChange={(event) => {
            const next = event.target.value;
            onChange(definition.type === "string" || next === "" ? next : Number(next));
          }}
          step={definition.type === "integer" ? 1 : definition.type === "number" ? "any" : undefined}
          type={definition.type === "string" ? "text" : "number"}
          value={String(value)}
        />
      )}
      {error ? <small className="audit-script-config-error" id={errorId}>{error}</small> : null}
    </label>
  );
}

export function AuditScriptConfigForm({
  disabled,
  errors,
  onSettingChange,
  runtimeSettings,
  settingValues,
  concurrency,
}: {
  concurrency?: ReactNode;
  disabled: boolean;
  errors: Record<string, string>;
  onSettingChange: (key: string, value: AuditScriptValue) => void;
  runtimeSettings: AuditScriptRuntimeSetting[];
  settingValues: Record<string, AuditScriptValue>;
}) {
  const common = runtimeSettings.filter((setting) => ["temperature", "requestTimeoutSeconds"].includes(setting.key));
  const advanced = runtimeSettings.filter((setting) => !common.includes(setting));
  const renderSetting = (setting: AuditScriptRuntimeSetting) => <ConfigInput
    definition={setting} disabled={disabled} error={errors[`setting:${setting.key}`] ?? ""}
    key={setting.key} onChange={(value) => onSettingChange(setting.key, value)}
    value={settingValues[setting.key] ?? ""}
  />;
  return <div className="audit-script-config-sections">
    {concurrency || common.length ? <section><h3>运行参数</h3><div className="audit-script-config-fields">{concurrency}{common.map(renderSetting)}</div></section> : null}
    {advanced.length ? <details className="script-advanced-settings" open={advanced.some((setting) => Boolean(errors[`setting:${setting.key}`])) || undefined}>
      <summary>高级设置 <span>{advanced.length} 项</span></summary>
      <div className="audit-script-config-fields">{advanced.map(renderSetting)}</div>
    </details> : null}
  </div>;
}
