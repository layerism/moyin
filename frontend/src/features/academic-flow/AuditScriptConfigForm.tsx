import type { AuditScriptParameter, AuditScriptRuntimeSetting } from "./auditScripts";
import type { AuditScriptValue } from "./auditScriptConfig";

type ConfigField = AuditScriptParameter | AuditScriptRuntimeSetting;

function ConfigInput({
  definition,
  disabled,
  error,
  namespace,
  onChange,
  value,
}: {
  definition: ConfigField;
  disabled: boolean;
  error: string;
  namespace: "parameter" | "setting";
  onChange: (value: AuditScriptValue) => void;
  value: AuditScriptValue;
}) {
  const inputId = `audit-script-config-${namespace}-${definition.key}`;
  const errorId = `${inputId}-error`;
  const descriptionId = `${inputId}-description`;
  const describedBy = [definition.description ? descriptionId : "", error ? errorId : ""]
    .filter(Boolean)
    .join(" ") || undefined;

  if (definition.type === "boolean") {
    return (
      <div className="audit-script-config-field">
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
    <label className="audit-script-config-field" htmlFor={inputId}>
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
  onParameterChange,
  onSettingChange,
  parameterDefaults,
  parameters,
  runtimeSettings,
  settingValues,
}: {
  disabled: boolean;
  errors: Record<string, string>;
  onParameterChange: (key: string, value: AuditScriptValue) => void;
  onSettingChange: (key: string, value: AuditScriptValue) => void;
  parameterDefaults: Record<string, AuditScriptValue>;
  parameters: AuditScriptParameter[];
  runtimeSettings: AuditScriptRuntimeSetting[];
  settingValues: Record<string, AuditScriptValue>;
}) {
  if (parameters.length === 0 && runtimeSettings.length === 0) {
    return <p className="audit-script-config-empty">当前脚本暂无可调参数</p>;
  }

  return (
    <div className="audit-script-config-sections">
      {parameters.length > 0 ? (
        <section>
          <h3>节点参数默认值</h3>
          <p>用于新选择该脚本的流程节点，具体流程仍可单独调整。</p>
          <div className="audit-script-config-fields">
            {parameters.map((parameter) => (
              <ConfigInput
                definition={parameter}
                disabled={disabled}
                error={errors[`parameter:${parameter.key}`] ?? ""}
                key={parameter.key}
                namespace="parameter"
                onChange={(value) => onParameterChange(parameter.key, value)}
                value={parameterDefaults[parameter.key] ?? ""}
              />
            ))}
          </div>
        </section>
      ) : null}
      {runtimeSettings.length > 0 ? (
        <section>
          <h3>运行配置</h3>
          <p>发布或预览时会将当前值固定到流程快照。</p>
          <div className="audit-script-config-fields">
            {runtimeSettings.map((setting) => (
              <ConfigInput
                definition={setting}
                disabled={disabled}
                error={errors[`setting:${setting.key}`] ?? ""}
                key={setting.key}
                namespace="setting"
                onChange={(value) => onSettingChange(setting.key, value)}
                value={settingValues[setting.key] ?? ""}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
