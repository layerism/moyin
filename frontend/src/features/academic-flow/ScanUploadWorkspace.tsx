import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import { FileFormatIcon } from "./FileFormatIcon";
import { workflowApi } from "./api";
import type { RuntimeScanFile } from "./runtimeTypes";


export function getScanSubmitBlocker(input: {
  scanRequired: boolean;
  scans: RuntimeScanFile[];
  templateDownloaded: boolean;
  uploading: boolean;
}): string | null {
  if (!input.scanRequired) return null;
  if (!input.templateDownloaded) return "请先下载签署文件模板";
  if (input.uploading) return "扫描件正在上传";
  if (!input.scans.length) return "请至少上传一个扫描件";
  return null;
}

export function getScanFilenameError(input: {
  filenames: string[];
  templateFilename: string | null;
}): string | null {
  const template = getFilenameIdentity(input.templateFilename ?? "");
  const hasTemplate = input.templateFilename !== null;
  if (hasTemplate && (!template.stem || template.suffix !== ".docx")) {
    return "当前节点模板配置异常，请联系教师";
  }
  const invalidFilename = input.filenames.find((filename) => {
    const scan = getFilenameIdentity(filename);
    return ![".jpg", ".jpeg", ".png", ".pdf"].includes(scan.suffix)
      || (hasTemplate && !scan.stem.startsWith(template.stem));
  });
  if (invalidFilename) {
    if (!hasTemplate) {
      return `文件“${normalizeFilename(invalidFilename)}”格式不符合要求，`
        + "请上传 JPG、JPEG、PNG 图片或 PDF。";
    }
    return `文件“${normalizeFilename(invalidFilename)}”名称不符合要求，`
      + `请改为以“${template.stem}”开头后重新上传。`;
  }
  return null;
}

export function shouldPromptTemplateDownload(input: {
  disabled: boolean;
  templateLocked: boolean;
}) {
  return !input.disabled && input.templateLocked;
}

function normalizeFilename(value: string) {
  const parts = value.replace(/\\/g, "/").split("/");
  return (parts[parts.length - 1] ?? "").trim().normalize("NFC");
}

function getFilenameIdentity(value: string) {
  const filename = normalizeFilename(value);
  const extensionIndex = filename.lastIndexOf(".");
  return extensionIndex > 0
    ? {
        stem: filename.slice(0, extensionIndex),
        suffix: filename.slice(extensionIndex).toLowerCase(),
      }
    : { stem: filename, suffix: "" };
}

export function ScanUploadWorkspace({
  disabled,
  nodeInstanceId,
  onDownload,
  onStateChange,
  onTemplateRequired,
  onFilenameWarning,
  templateFilename,
  templateLocked,
}: {
  disabled: boolean;
  nodeInstanceId: string;
  onDownload: (fileId: string) => void;
  onStateChange: (state: { scans: RuntimeScanFile[]; uploading: boolean }) => void;
  onTemplateRequired: () => void;
  onFilenameWarning: (message: string) => void;
  templateFilename: string | null;
  templateLocked: boolean;
}) {
  const [scans, setScans] = useState<RuntimeScanFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (disabled || templateLocked) return;
    setMessage("");
    let active = true;
    workflowApi.listScans(nodeInstanceId)
      .then((value) => { if (active) setScans(value); })
      .catch((error: Error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [disabled, nodeInstanceId, templateLocked]);

  useEffect(() => onStateChange({ scans, uploading }), [onStateChange, scans, uploading]);

  const upload = async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files);
    const filenameError = getScanFilenameError({
      filenames: selectedFiles.map((file) => file.name),
      templateFilename,
    });
    if (filenameError) {
      setMessage("");
      onFilenameWarning(filenameError);
      return;
    }
    setUploading(true);
    setMessage("");
    try {
      let next = scans;
      for (const file of selectedFiles) {
        const uploaded = await workflowApi.uploadScan(nodeInstanceId, file);
        next = [...next, uploaded];
        setScans(next);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "扫描件上传失败");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (fileId: string) => {
    setMessage("");
    try {
      await workflowApi.deleteScan(nodeInstanceId, fileId);
      setScans((current) => current.filter((item) => item.fileId !== fileId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "扫描件删除失败");
    }
  };

  const replace = async (scan: RuntimeScanFile, file: File) => {
    const filenameError = getScanFilenameError({
      filenames: [file.name],
      templateFilename,
    });
    if (filenameError) {
      setMessage("");
      onFilenameWarning(filenameError);
      return;
    }
    setUploading(true);
    setMessage("");
    try {
      await workflowApi.deleteScan(nodeInstanceId, scan.fileId);
      const uploaded = await workflowApi.uploadScan(nodeInstanceId, file);
      const next = scans.map((item) => item.fileId === scan.fileId ? uploaded : item);
      setScans(await workflowApi.reorderScans(nodeInstanceId, next.map((item) => item.fileId)));
    } catch (error) {
      const current = await workflowApi.listScans(nodeInstanceId).catch(() => []);
      setScans(current);
      setMessage(error instanceof Error ? error.message : "扫描件替换失败，请重新上传");
    } finally {
      setUploading(false);
    }
  };

  const promptTemplateDownload = () => {
    if (!shouldPromptTemplateDownload({ disabled, templateLocked })) return false;
    onTemplateRequired();
    return true;
  };

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (promptTemplateDownload()) return;
    if (!disabled && event.dataTransfer.files.length) void upload(event.dataTransfer.files);
  };

  const activateWithKeyboard = (event: KeyboardEvent<HTMLLabelElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!promptTemplateDownload() && !disabled) fileInputRef.current?.click();
  };

  return <section className="runtime-scan-workspace">
    <label
      aria-disabled={disabled || templateLocked || undefined}
      className={`runtime-scan-dropzone${templateLocked ? " is-locked" : ""}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={(event) => {
        if (promptTemplateDownload()) event.preventDefault();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
      onKeyDown={activateWithKeyboard}
    >
      <input accept=".jpg,.jpeg,.png,.pdf" disabled={disabled || templateLocked || uploading} multiple ref={fileInputRef} type="file" onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        if (files.length) void upload(files);
      }} />
      <strong>{uploading ? "正在逐个上传扫描件" : "选择或拖拽扫描件"}</strong>
      <small>
        JPG、JPEG、PNG、PDF；最多 10 个文件、20 页
        {templateFilename === null ? "；文件名不限" : ""}
      </small>
    </label>
    {scans.length ? <ol className="runtime-scan-list">
      {scans.map((scan) => <li key={scan.fileId}>
        <FileFormatIcon filename={scan.originalName} />
        <div className="runtime-scan-copy"><strong title={scan.originalName}>{scan.originalName}</strong><small>{scan.pageCount} 页 · {formatSize(scan.sizeBytes)}</small></div>
        <div className="runtime-scan-actions">
          <button aria-label={`下载 ${scan.originalName}`} title="下载" onClick={() => onDownload(scan.fileId)} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /></svg></button>
          <label className="runtime-scan-replace" title="替换" aria-disabled={disabled || uploading}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 7h-9l3-3M4 17h9l-3 3M20 7l-3 3M4 17l3-3" /></svg><input aria-label={`替换 ${scan.originalName}`} accept=".jpg,.jpeg,.png,.pdf" disabled={disabled || uploading} type="file" onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (file) void replace(scan, file);
          }} /></label>
          <button className="danger-text" aria-label={`删除 ${scan.originalName}`} title="删除" disabled={disabled || uploading} onClick={() => void remove(scan.fileId)} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></svg></button>
        </div>
      </li>)}
    </ol> : null}
    {message ? <p className="form-field-error">{message}</p> : null}
  </section>;
}

function formatSize(value: number) {
  return value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}
