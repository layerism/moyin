import type { AcademicFlowNode } from "../../types";

const noAuditScript = { label: "不启用材料审核", value: "" };

export type AuditScriptSummary = {
  description: string;
  id: string;
  language: "js" | "py";
  name: string;
  sha256: string;
  updatedAt: string;
  version: number;
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
      auditScriptId: undefined,
      auditScriptName: "",
      auditScriptType: "none",
      auditScriptVersion: undefined,
    };
  }
  return {
    auditScriptHash: script.sha256,
    auditScriptId: script.id,
    auditScriptName: script.name,
    auditScriptType: script.language,
    auditScriptVersion: script.version,
  };
}

export function getUploadedScriptValue(script: AuditScriptSummary): string {
  return `uploaded:${script.id}:${script.version}`;
}

function getLanguageLabel(language: "js" | "py"): string {
  return language === "py" ? "Python" : "JavaScript";
}
