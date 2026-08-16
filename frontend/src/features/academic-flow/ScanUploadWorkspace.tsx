import { useEffect, useState, type DragEvent } from "react";

import { workflowApi } from "./api";
import type { RuntimeScanFile } from "./runtimeTypes";


export function getScanSubmitBlocker(input: {
  confirmed: boolean;
  scanRequired: boolean;
  scans: RuntimeScanFile[];
  templateDownloaded: boolean;
  uploading: boolean;
}): string | null {
  if (!input.scanRequired) return null;
  if (!input.templateDownloaded) return "请先下载签署文件模板";
  if (!input.confirmed) return "请先确认承诺内容";
  if (input.uploading) return "扫描件正在上传";
  if (!input.scans.length) return "请至少上传一个扫描件";
  return null;
}

export function ScanUploadWorkspace({
  disabled,
  nodeInstanceId,
  onDownload,
  onStateChange,
}: {
  disabled: boolean;
  nodeInstanceId: string;
  onDownload: (fileId: string) => void;
  onStateChange: (state: { scans: RuntimeScanFile[]; uploading: boolean }) => void;
}) {
  const [scans, setScans] = useState<RuntimeScanFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (disabled) return;
    let active = true;
    workflowApi.listScans(nodeInstanceId)
      .then((value) => { if (active) setScans(value); })
      .catch((error: Error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [disabled, nodeInstanceId]);

  useEffect(() => onStateChange({ scans, uploading }), [onStateChange, scans, uploading]);

  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    setMessage("");
    try {
      let next = scans;
      for (const file of Array.from(files)) {
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

  const move = async (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= scans.length) return;
    const previous = scans;
    const next = [...scans];
    [next[index], next[target]] = [next[target], next[index]];
    setScans(next.map((item, order) => ({ ...item, order })));
    try {
      setScans(await workflowApi.reorderScans(nodeInstanceId, next.map((item) => item.fileId)));
    } catch (error) {
      setScans(previous);
      setMessage(error instanceof Error ? error.message : "扫描件排序失败");
    }
  };

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!disabled && event.dataTransfer.files.length) void upload(event.dataTransfer.files);
  };

  return <section className="runtime-scan-workspace">
    <label className="runtime-scan-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
      <input accept=".jpg,.jpeg,.png" disabled={disabled || uploading} multiple type="file" onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        if (files.length) void upload(files);
      }} />
      <strong>{uploading ? "正在逐个上传扫描件" : "选择或拖拽扫描件"}</strong>
      <small>JPG、JPEG、PNG；最多 10 个文件、20 页</small>
    </label>
    {scans.length ? <ol className="runtime-scan-list">
      {scans.map((scan, index) => <li key={scan.fileId}>
        <div><strong title={scan.originalName}>{scan.originalName}</strong><small>{scan.pageCount} 页 · {formatSize(scan.sizeBytes)}</small></div>
        <div className="runtime-scan-actions">
          <button aria-label={`上移 ${scan.originalName}`} disabled={disabled || index === 0} onClick={() => void move(index, -1)} type="button">↑</button>
          <button aria-label={`下移 ${scan.originalName}`} disabled={disabled || index === scans.length - 1} onClick={() => void move(index, 1)} type="button">↓</button>
          <button onClick={() => onDownload(scan.fileId)} type="button">下载</button>
          <label className="runtime-scan-replace">替换<input accept=".jpg,.jpeg,.png" disabled={disabled} type="file" onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (file) void replace(scan, file);
          }} /></label>
          <button className="danger-text" disabled={disabled} onClick={() => void remove(scan.fileId)} type="button">删除</button>
        </div>
      </li>)}
    </ol> : null}
    {message ? <p className="form-field-error">{message}</p> : null}
  </section>;
}

function formatSize(value: number) {
  return value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}
