import type { AuditScriptSummary } from "./auditScripts";

const MAX_AUDIT_SCRIPT_FILE_SIZE = 1024 * 1024;

type AuditScriptWritableFile = {
  close: () => Promise<void>;
  write: (content: Blob) => Promise<void>;
};

type AuditScriptFileHandle = {
  createWritable: () => Promise<AuditScriptWritableFile>;
};

export type AuditScriptSaveFilePicker = (options: {
  excludeAcceptAllOption: boolean;
  suggestedName: string;
  types: Array<{
    accept: Record<string, string[]>;
    description: string;
  }>;
}) => Promise<AuditScriptFileHandle>;

export type AuditScriptFormMode =
  | { kind: "create" }
  | { kind: "update"; script: AuditScriptSummary };

export function getAuditScriptListState(input: {
  error: string;
  loading: boolean;
  scripts: AuditScriptSummary[] | null;
}): "error" | "loading" | "ready" {
  if (input.loading) return "loading";
  if (input.scripts === null && input.error) return "error";
  return "ready";
}

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

export async function downloadAuditScriptTemplate(input: {
  fallbackDownload: (blob: Blob, filename: string) => void;
  filename: string;
  getBlob: () => Promise<Blob>;
  showSaveFilePicker?: AuditScriptSaveFilePicker;
}): Promise<"cancelled" | "fallback" | "saved"> {
  if (!input.showSaveFilePicker) {
    input.fallbackDownload(await input.getBlob(), input.filename);
    return "fallback";
  }

  let handle: AuditScriptFileHandle;
  try {
    const isPython = input.filename.toLowerCase().endsWith(".py");
    handle = await input.showSaveFilePicker({
      excludeAcceptAllOption: true,
      suggestedName: input.filename,
      types: [{
        accept: isPython
          ? { "text/x-python": [".py"] }
          : { "text/javascript": [".js"] },
        description: isPython ? "Python 脚本" : "JavaScript 脚本",
      }],
    });
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") return "cancelled";
    throw reason;
  }

  const blob = await input.getBlob();
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return "saved";
}

export async function validateAuditScriptFileContent(file: File): Promise<string | null> {
  if (file.size === 0) return "脚本文件不能为空";
  if (file.size > MAX_AUDIT_SCRIPT_FILE_SIZE) return "脚本文件不能超过 1 MiB";

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return "脚本文件读取失败，请重新选择";
  }
  if (bytes.byteLength === 0) return "脚本文件不能为空";
  if (bytes.byteLength > MAX_AUDIT_SCRIPT_FILE_SIZE) return "脚本文件不能超过 1 MiB";

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "脚本文件必须使用 UTF-8 编码";
  }
  return null;
}
