import type { AcademicFlowNode, AuditScriptType } from "../../types";

const legacyAuditScripts: Array<{ label: string; name: string; type: AuditScriptType }> = [
  { label: "不启用材料审核", name: "", type: "none" },
  { label: "材料基础校验（Python）", name: "check_material.py", type: "py" },
  { label: "材料命名校验（JavaScript）", name: "check_filename.mjs", type: "mjs" },
];

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
    ...legacyAuditScripts.map((script) => ({
      label: script.label,
      value: script.name,
    })),
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

  const builtIn = legacyAuditScripts.find((script) => script.name === value);
  return {
    auditScriptHash: undefined,
    auditScriptId: undefined,
    auditScriptName: builtIn?.name ?? "",
    auditScriptType: builtIn?.type ?? "none",
    auditScriptVersion: undefined,
  };
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

function getLanguageLabel(language: Exclude<AuditScriptType, "mjs" | "none">): string {
  return language === "py" ? "Python" : "JavaScript";
}
