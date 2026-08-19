import type { AcademicFlowNode } from "../../types";

const noAuditScript = { label: "不启用材料审核", value: "" };

export type AuditScriptSummary = {
  acceptedExtensions: string[];
  configHash: string;
  contentHash: string;
  description: string;
  id: string;
  language: "js" | "py";
  name: string;
  parameters: AuditScriptParameter[];
  runtimeSettings: AuditScriptRuntimeSetting[];
  maxConcurrency: number;
  updatedAt: string;
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

export type NodeAuditPolicy = {
  flowId: string;
  generation: number;
  mode?: "pass_fail" | "score" | null;
  nodeKey: string;
  parameters: AuditScriptParameter[];
  params: Record<string, string | number | boolean>;
  policyHash: string;
  prompt: string;
  scriptId: string;
  scriptName: string;
  updatedAt: string;
};

export function getAuditScriptOptions(
  scripts: AuditScriptSummary[],
  node?: AcademicFlowNode,
): AuditScriptOption[] {
  const options = [
    noAuditScript,
    ...scripts.map((script) => ({
      label: `${script.name}（${getLanguageLabel(script.language)}）`,
      value: getUploadedScriptValue(script),
    })),
  ];
  const selectedValue = node ? getSelectedAuditScriptValue(node) : "";
  const isConfiguredScript = selectedValue.startsWith("uploaded:");
  if (isConfiguredScript && !options.some((option) => option.value === selectedValue)) {
    options.push({
      label: node?.auditScriptName ?? "审核脚本",
      value: selectedValue,
    });
  }
  return options;
}

export function getSelectedAuditScriptValue(node: AcademicFlowNode): string {
  if (node.auditScriptId) {
    return `uploaded:${node.auditScriptId}`;
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
      auditScriptAcceptedExtensions: undefined,
      auditScriptParams: undefined,
      auditScriptId: undefined,
      auditScriptName: "",
      auditScriptType: "none",
    };
  }
  return {
    auditScriptAcceptedExtensions: script.acceptedExtensions,
    auditScriptId: script.id,
    auditScriptName: script.name,
    auditScriptType: script.language,
    auditScriptParams: Object.fromEntries(
      script.parameters.map((parameter) => [parameter.key, parameter.default]),
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
  return `uploaded:${script.id}`;
}

function getLanguageLabel(language: "js" | "py"): string {
  return language === "py" ? "Python" : "JavaScript";
}
