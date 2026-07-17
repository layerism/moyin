import type { AuditScriptSummary } from "./auditScripts";

export type AuditScriptFormMode =
  | { kind: "create" }
  | { kind: "update"; script: AuditScriptSummary };

export function getAuditScriptFormState(mode: AuditScriptFormMode) {
  return {
    name: mode.kind === "update" ? mode.script.name : "",
    nameLocked: mode.kind === "update",
  };
}

export function validateAuditScriptForm(input: {
  mode: AuditScriptFormMode;
  name: string;
  description: string;
  file: File | null;
}): string | null {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name) return "请填写功能名称";
  if (name.length > 120) return "功能名称不能超过 120 个字符";
  if (!description) return "请填写功能描述";
  if (description.length > 500) return "功能描述不能超过 500 个字符";
  if (!input.file) return "请选择脚本文件";

  const language = getAuditScriptLanguage(input.file.name);
  if (!language) return "请选择 .py 或 .js 脚本文件";
  if (input.mode.kind === "update" && language !== input.mode.script.language) {
    return `更新版本必须保持 ${input.mode.script.language === "py" ? "Python" : "JavaScript"} 语言`;
  }
  return null;
}

export function getAuditScriptLanguage(filename: string): "js" | "py" | null {
  const parts = filename.trim().toLowerCase().split(".");
  const extension = parts[parts.length - 1];
  return extension === "py" || extension === "js" ? extension : null;
}
