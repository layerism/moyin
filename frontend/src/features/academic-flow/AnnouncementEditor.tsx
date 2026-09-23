import { useRef, useState } from "react";

import { AnnouncementMarkdown } from "./AnnouncementMarkdown";

export function AnnouncementEditor({
  disabled,
  flowId,
  nodeId,
  onChange,
  onUpload,
  value,
}: {
  disabled: boolean;
  flowId: string;
  nodeId: string;
  onChange: (value: string) => void;
  onUpload: (nodeId: string, file: File) => Promise<{ assetId: string }>;
  value: string;
}) {
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const insertImage = async (file: File) => {
    if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size === 0 || file.size > 5 * 1024 * 1024) {
      setUploadError("仅支持不超过 5 MB 的 PNG、JPEG 或 WebP 图片");
      return;
    }
    const start = textareaRef.current?.selectionStart ?? value.length;
    const end = textareaRef.current?.selectionEnd ?? start;
    setUploading(true);
    setUploadError("");
    try {
      const asset = await onUpload(nodeId, file);
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[\[\]()!]/g, "").trim() || "公告图片";
      const image = `\n![${alt}](asset://${asset.assetId})\n`;
      onChange(value.slice(0, start) + image + value.slice(end));
      setPreview(true);
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "图片上传失败，请稍后重试");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <section className="announcement-editor" aria-label="公告正文">
      <div className="announcement-editor-toolbar">
        <strong>公告正文</strong>
        <div>
          <button aria-pressed={!preview} onClick={() => setPreview(false)} type="button">编辑</button>
          <button aria-pressed={preview} onClick={() => setPreview(true)} type="button">预览</button>
          <button disabled={disabled || uploading} onClick={() => fileInputRef.current?.click()} type="button">
            {uploading ? "正在上传…" : "插入图片"}
          </button>
        </div>
      </div>
      <input
        accept="image/png,image/jpeg,image/webp"
        aria-label="选择公告图片"
        disabled={disabled || uploading}
        hidden
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertImage(file); }}
        ref={fileInputRef}
        type="file"
      />
      {preview ? (
        <div className="announcement-editor-preview">
          <AnnouncementMarkdown flowId={flowId}>{value}</AnnouncementMarkdown>
        </div>
      ) : (
        <textarea
          aria-label="公告正文 Markdown"
          disabled={disabled || uploading}
          onChange={(event) => onChange(event.target.value)}
          placeholder="输入公告内容；可在光标位置插入图片"
          ref={textareaRef}
          rows={6}
          value={value}
        />
      )}
      {uploadError ? <p className="announcement-editor-error" role="alert">{uploadError}</p> : null}
      <small>图片保存在私有 OSS；发布后，学生打开公告即可查看。</small>
    </section>
  );
}
