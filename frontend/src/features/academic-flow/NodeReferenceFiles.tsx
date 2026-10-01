import { MaterialActionIcon } from "./MaterialActionIcon";
import { useRef, useState } from "react";
import type { NodeTemplateAsset } from "../../types";
import { FileFormatIcon } from "./FileFormatIcon";

import { MaterialFileName } from "./MaterialFileName";
import { MaterialPreviewDialog, type MaterialPreviewContext } from "./MaterialPreviewDialog";

export function NodeReferenceFiles({ assets, disabled, replaceOnly = false, onUpload, onRemove, label = "填写参考", previewContext }: {
  previewContext?: MaterialPreviewContext;
  assets: NodeTemplateAsset[];
  disabled: boolean;
  replaceOnly?: boolean;
  onUpload: (files: File[], replaceAssetId?: string) => void;
  onRemove: (assetId: string) => void;
  label?: string;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const replacementInput = useRef<HTMLInputElement>(null);
  const replacementAssetId = useRef<string | null>(null);
  return <section className="node-reference-files" aria-label={label}>
    <div className="node-file-row">
      <strong className="node-file-row-label">{label}</strong>
      <div className="node-file-row-content">
        {disabled ? <span className="node-file-row-hint">{assets.length ? "已配置参考文件" : "未配置文件"}</span> :
          <button type="button" className="node-file-row-select" onClick={() => input.current?.click()}>
            <span aria-hidden="true">＋</span><strong>添加参考</strong><small>可多选 · DOCX、PDF、图片 · 单份 ≤50 MB</small>
          </button>}
      </div>
    </div>
    {assets.map((asset) => <div key={asset.assetId} className="node-file-row">
      <div className="node-file-row-content">
        <FileFormatIcon filename={asset.originalName} />
        <div className="node-file-row-copy"><MaterialFileName name={asset.originalName} />
          <small>{asset.sizeBytes < 1024 * 1024 ? `${Math.max(1, Math.round(asset.sizeBytes / 1024))} KB` : `${(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB`}</small>
        </div>
      </div>
      <div className="node-file-row-actions">
        {previewContext ? <button type="button" onClick={() => setPreviewId(asset.assetId)} title="预览" aria-label={`预览${label} ${asset.originalName}`}><MaterialActionIcon action="preview" /></button> : null}
        {!disabled ? <>
        <button type="button" title="替换" aria-label={`替换${label} ${asset.originalName}`} onClick={() => {
          replacementAssetId.current = asset.assetId;
          replacementInput.current?.click();
        }}><MaterialActionIcon action="replace" /></button>
        {!replaceOnly ? <button type="button" className="node-file-row-remove"
          title="移除" aria-label={`移除${label} ${asset.originalName}`} onClick={() => onRemove(asset.assetId)}><MaterialActionIcon action="remove" /></button> : null}
        </> : null}
      </div>
    </div>)}
    {previewId && previewContext ? <MaterialPreviewDialog context={previewContext} assets={assets} initialId={previewId} label={label} onClose={() => setPreviewId(null)} /> : null}
    <input ref={input} hidden multiple disabled={disabled} aria-label={`上传${label}`} type="file"
      accept=".docx,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        if (files.length) onUpload(files);
      }} />
    <input ref={replacementInput} hidden disabled={disabled} title="替换" aria-label={`替换${label}`} type="file"
      accept=".docx,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        const assetId = replacementAssetId.current;
        event.currentTarget.value = "";
        replacementAssetId.current = null;
        if (file && assetId) onUpload([file], assetId);
      }} />
  </section>;
}
