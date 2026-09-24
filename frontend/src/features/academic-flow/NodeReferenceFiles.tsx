import { useRef } from "react";
import type { NodeTemplateAsset } from "../../types";
import { FileFormatIcon } from "./FileFormatIcon";

export function NodeReferenceFiles({ assets, disabled, replaceOnly = false, onUpload, onRemove, label = "填写参考" }: {
  assets: NodeTemplateAsset[];
  disabled: boolean;
  replaceOnly?: boolean;
  onUpload: (files: File[], replaceAssetId?: string) => void;
  onRemove: (assetId: string) => void;
  label?: string;
}) {
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
        <div className="node-file-row-copy"><strong title={asset.originalName}>{asset.originalName}</strong>
          <small>{asset.sizeBytes < 1024 * 1024 ? `${Math.max(1, Math.round(asset.sizeBytes / 1024))} KB` : `${(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB`}</small>
        </div>
      </div>
      {!disabled && <div className="node-file-row-actions">
        <button type="button" aria-label={`替换${label} ${asset.originalName}`} onClick={() => {
          replacementAssetId.current = asset.assetId;
          replacementInput.current?.click();
        }}>替换</button>
        {!replaceOnly ? <button type="button" className="node-file-row-remove"
          aria-label={`移除${label} ${asset.originalName}`} onClick={() => onRemove(asset.assetId)}>移除</button> : null}
      </div>}
    </div>)}
    <input ref={input} hidden multiple disabled={disabled} aria-label={`上传${label}`} type="file"
      accept=".docx,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        if (files.length) onUpload(files);
      }} />
    <input ref={replacementInput} hidden disabled={disabled} aria-label={`替换${label}`} type="file"
      accept=".docx,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        const assetId = replacementAssetId.current;
        event.currentTarget.value = "";
        replacementAssetId.current = null;
        if (file && assetId) onUpload([file], assetId);
      }} />
  </section>;
}
