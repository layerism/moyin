import type { AcademicFlowNode } from "../../types";

const noAuditScript = { label: "不启用材料审核", value: "" };

export type AuditScriptSummary = {
  acceptedExtensions: string[];
  configSha256: string;
  description: string;
  id: string;
  language: "js" | "py";
  name: string;
  parameters: AuditScriptParameter[];
  runtimeSettings: AuditScriptRuntimeSetting[];
  sha256: string;
  updatedAt: string;
  version: number;
};

type AuditScriptValueDefinitionBase = {
  description?: string;
  key: string;
  label: string;
  required: boolean;
};

export type AuditScriptValueDefinition = AuditScriptValueDefinitionBase &
  (
    | { maximum?: number; minimum?: number; type: "integer" | "number" }
    | { maximumLength: number; minimumLength: number; type: "string" }
    | { type: "boolean" }
    | { options: Array<{ label: string; value: string }>; type: "select" }
  );

export type AuditScriptParameter = AuditScriptValueDefinition & {
  default: string | number | boolean;
};

export type AuditScriptRuntimeSetting = AuditScriptValueDefinition & {
  multiline?: boolean;
  value: string | number | boolean;
};

export type AuditScriptOption = {
  label: string;
  value: string;
};

export function getAuditScriptOptions(
  scripts: AuditScriptSummary[],
  node?: AcademicFlowNode,
): AuditScriptOption[] {
  const options = [
    noAuditScript,
    ...scripts.map((script) => ({
      label: `${script.name}（${getLanguageLabel(script.language)}，v${script.version}）`,
      value: getUploadedScriptValue(script),
    })),
  ];
  const selectedValue = node ? getSelectedAuditScriptValue(node) : "";
  const isFixedVersion = selectedValue.startsWith("uploaded:");
  if (isFixedVersion && !options.some((option) => option.value === selectedValue)) {
    options.push({
      label: `${node?.auditScriptName ?? "审核脚本"}（固定 v${node?.auditScriptVersion}）`,
      value: selectedValue,
    });
  }
  return options;
}

export function getSelectedAuditScriptValue(node: AcademicFlowNode): string {
  if (node.auditScriptId && node.auditScriptVersion !== undefined) {
    return `uploaded:${node.auditScriptId}:${node.auditScriptVersion}`;
  }
  return node.auditScriptName;
}

export function resolveAuditScriptSelection(
  value: string,
  scripts: AuditScriptSummary[],
): Partial<AcademicFlowNode> {
  const uploaded = scripts.find((script) => getUploadedScriptValue(script) === value);
  if (uploaded) return toNodeAuditScriptSelection(uploaded);
  return toNodeAuditScriptSelection(null);
}

export function toNodeAuditScriptSelection(
  script: AuditScriptSummary | null,
): Partial<AcademicFlowNode> {
  if (!script) {
    return {
      auditScriptHash: undefined,
      auditScriptConfigHash: undefined,
      auditScriptAcceptedExtensions: undefined,
      auditScriptParams: undefined,
      auditScriptSettings: undefined,
      auditScriptId: undefined,
      auditScriptName: "",
      auditScriptType: "none",
      auditScriptVersion: undefined,
    };
  }
  return {
    auditScriptAcceptedExtensions: script.acceptedExtensions,
    auditScriptConfigHash: script.configSha256,
    auditScriptHash: script.sha256,
    auditScriptId: script.id,
    auditScriptName: script.name,
    auditScriptType: script.language,
    auditScriptVersion: script.version,
    auditScriptParams: Object.fromEntries(
      script.parameters.map((parameter) => [parameter.key, parameter.default]),
    ),
    auditScriptSettings: Object.fromEntries(
      script.runtimeSettings.map((setting) => [setting.key, setting.value]),
    ),
    ...(script.acceptedExtensions.length
      ? { fileExtensions: script.acceptedExtensions.map((value) => value.slice(1)).join(", ") }
      : {}),
  };
}

export function getAuditScriptParameterError(
  definition: AuditScriptValueDefinition,
  value: unknown,
): string {
  if (definition.type === "integer" || definition.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "请输入有效数值";
    if (definition.type === "integer" && !Number.isInteger(value)) return "请输入整数";
    if (definition.minimum !== undefined && value < definition.minimum) {
      return `不能小于 ${definition.minimum}`;
    }
    if (definition.maximum !== undefined && value > definition.maximum) {
      return `不能大于 ${definition.maximum}`;
    }
  }
  if (definition.type === "string") {
    if (typeof value !== "string") return "请输入文本";
    if (value.trim().length < definition.minimumLength) return `至少 ${definition.minimumLength} 个有效字符`;
    if (value.length > definition.maximumLength) return `最多 ${definition.maximumLength} 个字符`;
  }
  if (definition.type === "boolean" && typeof value !== "boolean") return "请选择是否启用";
  if (
    definition.type === "select" &&
    (typeof value !== "string" || !definition.options.some((option) => option.value === value))
  ) {
    return "请选择有效选项";
  }
  return "";
}

export function getUploadedScriptValue(script: AuditScriptSummary): string {
  return `uploaded:${script.id}:${script.version}`;
}

function getLanguageLabel(language: "js" | "py"): string {
  return language === "py" ? "Python" : "JavaScript";
}
