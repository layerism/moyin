import {
  getAuditScriptParameterError,
  type AuditScriptParameter,
  type AuditScriptRuntimeSetting,
} from "./auditScripts";

export type AuditScriptValue = string | number | boolean;

export type AuditScriptManagementSummary = {
  description: string;
  id: string;
  language: "js" | "py";
  generation: number;
  maxConcurrency: number;
  name: string;
  pendingJobCount: number;
  parameterCount: number;
  runningJobCount: number;
  runtimeSettingCount: number;
  status: "error" | "ready" | "updating";
  updatedAt: string;
};

export type AuditScriptConfigDetail = AuditScriptManagementSummary & {
  configHash: string;
  contentHash: string;
  editorHash: string;
  errorMessage?: string | null;
  parameters: AuditScriptParameter[];
  runtimeSettings: AuditScriptRuntimeSetting[];
};

export type AuditScriptConfigUpdate = {
  expectedEditorHash: string;
  maxConcurrency: number;
  parameterDefaults: Record<string, AuditScriptValue>;
  runtimeSettings: Record<string, AuditScriptValue>;
};

export function createParameterDefaultDraft(
  detail: AuditScriptConfigDetail,
): Record<string, AuditScriptValue> {
  return Object.fromEntries(
    detail.parameters.map((parameter) => [parameter.key, parameter.default]),
  );
}

export function createRuntimeSettingDraft(
  detail: AuditScriptConfigDetail,
): Record<string, AuditScriptValue> {
  return Object.fromEntries(
    detail.runtimeSettings.map((setting) => [setting.key, setting.value]),
  );
}

export function hasAuditScriptConfigChanges(
  detail: AuditScriptConfigDetail,
  parameterDefaults: Record<string, AuditScriptValue>,
  runtimeSettings: Record<string, AuditScriptValue>,
  maxConcurrency = detail.maxConcurrency,
): boolean {
  return maxConcurrency !== detail.maxConcurrency || detail.parameters.some(
    (parameter) => parameterDefaults[parameter.key] !== parameter.default,
  ) || detail.runtimeSettings.some(
    (setting) => runtimeSettings[setting.key] !== setting.value,
  );
}

export function getAuditScriptConfigErrors(
  detail: AuditScriptConfigDetail,
  parameterDefaults: Record<string, AuditScriptValue>,
  runtimeSettings: Record<string, AuditScriptValue>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const parameter of detail.parameters) {
    const error = getAuditScriptParameterError(parameter, parameterDefaults[parameter.key]);
    if (error) errors[`parameter:${parameter.key}`] = error;
  }
  for (const setting of detail.runtimeSettings) {
    const error = getAuditScriptParameterError(setting, runtimeSettings[setting.key]);
    if (error) errors[`setting:${setting.key}`] = error;
  }
  return errors;
}
