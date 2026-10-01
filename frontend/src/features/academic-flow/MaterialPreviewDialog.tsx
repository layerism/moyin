import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NodeTemplateAsset } from "../../types";
import { DocxPreview } from "./DocxPreview";
import { PdfPreview } from "./PdfPreview";
import { FileFormatIcon } from "./FileFormatIcon";
import { saveDownloadFile } from "./saveStudentFile";

export type MaterialPreviewContext = { flowId: string; nodeKey: string };

export function MaterialPreviewDialog({ context, assets, initialId, label, onClose }: {
  context: MaterialPreviewContext;
  assets: NodeTemplateAsset[];
  initialId: string;
  label: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState(initialId);
  const [revision, setRevision] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const asset = assets.find((item) => item.assetId === selectedId) ?? assets[0];
  useEffect(() => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); target?.focus(); };
  }, []);
  if (!asset) return null;
  const endpoint = `/api/workflows/${encodeURIComponent(context.flowId)}/nodes/${encodeURIComponent(context.nodeKey)}/materials/${encodeURIComponent(asset.assetId)}/download`;
  const url = `${endpoint}?preview=true`;
  const extension = asset.originalName.split(".").pop()?.toLowerCase();
  const download = async () => {
    setDownloading(true); setDownloadError("");
    try { await saveDownloadFile(endpoint, asset.originalName); }
    catch (error) { setDownloadError(error instanceof Error ? error.message : "下载失败，请重试"); }
    finally { setDownloading(false); }
  };
  return createPortal(<dialog ref={dialog} className="material-preview-dialog" aria-labelledby="material-preview-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
    <header className="material-preview-header">
      <FileFormatIcon filename={asset.originalName} />
      <div className="material-preview-heading"><h2 id="material-preview-title" title={asset.originalName}>{asset.originalName}</h2>
        <small>{label} · {asset.sizeBytes < 1048576 ? `${Math.max(1, Math.round(asset.sizeBytes / 1024))} KB` : `${(asset.sizeBytes / 1048576).toFixed(1)} MB`}</small></div>
      <button type="button" disabled={downloading} onClick={() => void download()}>{downloading ? "下载中…" : "下载原件"}</button>
      <button type="button" onClick={onClose} aria-label="关闭预览">×</button>
    </header>
    <div className="material-preview-body">
      {assets.length > 1 ? <nav className="material-preview-files" aria-label={label}>
        {assets.map((item) => <button type="button" key={item.assetId} title={item.originalName}
          aria-current={asset.assetId === item.assetId ? "true" : undefined}
          onClick={() => { setSelectedId(item.assetId); setDownloadError(""); }}>
          <FileFormatIcon filename={item.originalName} /><span>{item.originalName}</span>
        </button>)}
      </nav> : null}
      <div className="material-preview-content" key={`${asset.assetId}-${revision}`}>
        {extension === "docx" ? <DocxPreview url={url} filename={asset.originalName} />
          : extension === "pdf" ? <PdfPreview url={url} filename={asset.originalName} />
          : ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(extension ?? "")
            ? <MaterialImagePreview url={url} filename={asset.originalName} />
            : <p className="material-preview-message">此格式暂不支持在线预览，请下载原件查看。</p>}
      </div>
    </div>
    <footer className="material-preview-footer">
      <span>{extension === "docx" ? "DOCX 为浏览器排版预览，实际效果以原文件为准。" : ""}</span>
      {downloadError ? <span role="alert">{downloadError}</span> : null}
      <button type="button" onClick={() => setRevision((value) => value + 1)}>重新加载</button>
    </footer>
  </dialog>, document.body);
}

function MaterialImagePreview({ url, filename }: { url: string; filename: string }) {
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  return <section className="material-image-preview" aria-label={`图片预览：${filename}`}>
    <div className="pdf-preview-toolbar">
      <button type="button" disabled={zoom <= .5} onClick={() => setZoom((v) => v - .25)} aria-label="缩小">−</button>
      <button type="button" onClick={() => setZoom(1)} title="恢复适合宽度">{Math.round(zoom * 100)}%</button>
      <button type="button" disabled={zoom >= 2} onClick={() => setZoom((v) => v + .25)} aria-label="放大">＋</button>
    </div>
    <div className="material-image-viewport" aria-busy={loading}>
      {loading ? <p role="status">正在加载图片…</p> : null}
      {error ? <p role="alert">图片加载失败，请重新加载或下载原件查看。</p> :
        <img src={url} alt={filename} style={{ width: `${zoom * 100}%`, visibility: loading ? "hidden" : "visible" }}
          onLoad={() => setLoading(false)} onError={() => { setLoading(false); setError(true); }} />}
    </div>
  </section>;
}
