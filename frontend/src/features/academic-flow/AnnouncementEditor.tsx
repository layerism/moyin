import { useRef, useState } from "react";

import { AnnouncementMarkdown } from "./AnnouncementMarkdown";

export function AnnouncementEditor({
  disabled,
  flowId,
  nodeId,
  onChange,
  onUpload,
  onUploadFile,
  value,
}: {
  disabled: boolean;
  flowId: string;
  nodeId: string;
  onChange: (value: string | ((current: string) => string)) => void;
  onUpload: (nodeId: string, file: File) => Promise<{ assetId: string }>;
  onUploadFile: (nodeId: string, file: File) => Promise<{ assetId: string }>;
  value: string;
}) {
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const nextUploadId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const insertImage = async (file: File) => {
    if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size === 0 || file.size > 5 * 1024 * 1024) {
      setUploadError("仅支持不超过 5 MB 的 PNG、JPEG 或 WebP 图片");
      return;
    }
    const start = textareaRef.current?.selectionStart ?? value.length;
    const end = textareaRef.current?.selectionEnd ?? start;
    const marker = `⟦图片上传中 ${++nextUploadId.current}⟧`;
    setPreview(false);
    onChange((current) => current.slice(0, start) + `\n${marker}\n` + current.slice(end));
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const caret = start + marker.length + 2;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
    setUploading((count) => count + 1);
    setUploadError("");
    try {
      const asset = await onUpload(nodeId, file);
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[\[\]()!]/g, "").trim() || "公告图片";
      const image = `![${alt}](asset://${asset.assetId})`;
      onChange((current) => current.includes(marker)
        ? current.replace(marker, image)
        : `${current}\n${image}\n`);
    } catch (reason) {
      onChange((current) => current.replace(marker, ""));
      setUploadError(reason instanceof Error ? reason.message : "图片上传失败，请稍后重试");
    } finally {
      setUploading((count) => count - 1);
    }
  };

  const insertFile = async (file: File) => {
    if (!/\.(pdf|docx|xlsx|pptx)$/i.test(file.name) || file.size === 0 || file.size > 50 * 1024 * 1024) {
      setUploadError("仅支持不超过 50 MB 的 PDF、DOCX、XLSX 或 PPTX 文件");
      return;
    }
    const start = textareaRef.current?.selectionStart ?? value.length;
    const end = textareaRef.current?.selectionEnd ?? start;
    const marker = `⟦文件上传中 ${++nextUploadId.current}⟧`;
    setPreview(false);
    onChange((current) => current.slice(0, start) + `\n${marker}\n` + current.slice(end));
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const caret = start + marker.length + 2;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
    setUploading((count) => count + 1);
    setUploadError("");
    try {
      const asset = await onUploadFile(nodeId, file);
      const label = file.name.replace(/[\[\]()\r\n]/g, "").trim() || "公告附件";
      onChange((current) => current.replace(marker, `[${label}](asset://${asset.assetId})`));
    } catch (reason) {
      onChange((current) => current.replace(marker, ""));
      setUploadError(reason instanceof Error ? reason.message : "附件上传失败，请稍后重试");
    } finally {
      setUploading((count) => count - 1);
    }
  };

  return (
    <section className="announcement-editor" aria-label="公告正文">
      <div className="announcement-editor-toolbar">
        <strong>公告正文</strong>
        <div>
          <button aria-pressed={!preview} onClick={() => setPreview(false)} type="button">编辑</button>
          <button aria-pressed={preview} disabled={uploading > 0} onClick={() => setPreview(true)} type="button">预览</button>
          <button disabled={disabled} onClick={() => fileInputRef.current?.click()} type="button">
            插入图片
          </button>
          <button disabled={disabled} onClick={() => attachmentInputRef.current?.click()} type="button">
            插入文件
          </button>
        </div>
      </div>
      <input
        accept="image/png,image/jpeg,image/webp"
        aria-label="选择公告图片"
        disabled={disabled}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void insertImage(file);
        }}
        ref={fileInputRef}
        type="file"
      />
      <input
        accept=".pdf,.docx,.xlsx,.pptx"
        aria-label="选择公告附件"
        disabled={disabled}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void insertFile(file);
        }}
        ref={attachmentInputRef}
        type="file"
      />
      {preview ? (
        <div className="announcement-editor-preview">
          <AnnouncementMarkdown flowId={flowId} nodeId={nodeId}>{value}</AnnouncementMarkdown>
        </div>
      ) : (
        <textarea
          aria-label="公告正文 Markdown"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="输入公告内容；可在光标位置插入图片或文件"
          ref={textareaRef}
          rows={6}
          value={value}
        />
      )}
      {uploadError ? <p className="announcement-editor-error" role="alert">{uploadError}</p> : null}
      {uploading > 0 ? <p className="announcement-editor-uploading" role="status">正在上传 {uploading} 个资源，可继续编辑正文。</p> : null}
      <small>图片和文件保存在私有 OSS；发布后学生可查看图片、下载文件。</small>
    </section>
  );
}
