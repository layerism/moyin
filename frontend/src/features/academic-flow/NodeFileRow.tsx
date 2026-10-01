import { useRef, useState } from "react";
import type { NodeTemplateAsset } from "../../types";
import { FileFormatIcon } from "./FileFormatIcon";

import { MaterialFileName } from "./MaterialFileName";
import { MaterialPreviewDialog, type MaterialPreviewContext } from "./MaterialPreviewDialog";

export function NodeFileRow({ label, asset, accept, hint, disabled, removable = true, onUpload, onRemove, previewContext }: {
  previewContext?: MaterialPreviewContext;
  label: string;
  asset?: NodeTemplateAsset | null;
  accept: string;
  hint: string;
  disabled: boolean;
  removable?: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const size = asset ? (asset.sizeBytes < 1024 * 1024 ? `${Math.max(1, Math.round(asset.sizeBytes / 1024))} KB` : `${(asset.sizeBytes / (1024 * 1024)).toFixed(1)} MB`) : "";
  return <section className="node-file-row" aria-label={label}>
    <strong className="node-file-row-label">{label}</strong>
    {asset ? <div className="node-file-row-content">
      <FileFormatIcon filename={asset.originalName} />
      <div className="node-file-row-copy"><MaterialFileName name={asset.originalName} /><small>{size}</small></div>
    </div> : <div className="node-file-row-content">
      {disabled ? <span className="node-file-row-hint">未配置文件</span> : <button type="button" className="node-file-row-select" onClick={() => input.current?.click()} aria-label={`选择${label}`}>
        <span aria-hidden="true">＋</span><strong>选择文件</strong><small>{hint}</small>
      </button>}
    </div>}
    {asset || disabled ? <div className="node-file-row-actions">
      {asset && previewContext ? <button type="button" onClick={() => setPreviewOpen(true)} aria-label={`预览${label} ${asset.originalName}`}>预览</button> : null}
      {disabled ? <span className="node-file-row-lock" title="已发布节点的文件配置不可修改">🔒 已锁定</span> : asset ? <>
        <button type="button" onClick={() => input.current?.click()} aria-label={`替换${label}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></svg>替换</button>
        {removable ? <button type="button" className="node-file-row-remove" onClick={onRemove} aria-label={`移除${label}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></svg>移除</button> : null}
      </> : null}
    </div> : null}
    {previewOpen && asset && previewContext ? <MaterialPreviewDialog context={previewContext} assets={[asset]} initialId={asset.assetId} label={label} onClose={() => setPreviewOpen(false)} /> : null}
    <input ref={input} hidden disabled={disabled} aria-label={`上传${label}`} type="file" accept={accept} onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) onUpload(file);
    }} />
  </section>;
}
