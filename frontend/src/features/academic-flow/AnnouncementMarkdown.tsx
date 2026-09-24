import { useEffect, useMemo, useRef, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { workflowApi } from "./api";

const assetUrl = /^asset:\/\/([A-Za-z0-9-]+)$/;
const imageReference = /!\[[^\]]*\]\(asset:\/\/([A-Za-z0-9-]+)\)/g;
const fileReference = /(?<!!)\[[^\]]*\]\(asset:\/\/([A-Za-z0-9-]+)\)/g;

type AnnouncementFile = {
  assetId: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
};

function fileTypeLabel(contentType: string): string {
  if (contentType === "application/pdf") return "PDF";
  if (contentType.includes("wordprocessingml")) return "Word";
  if (contentType.includes("spreadsheetml")) return "Excel";
  return "PPT";
}

function fileSizeLabel(sizeBytes: number): string {
  return sizeBytes >= 1024 * 1024
    ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(sizeBytes / 1024))} KB`;
}

function AnnouncementFileCard({
  assetId,
  file,
  flowId,
  instanceId,
  nodeId,
}: {
  assetId: string;
  file: AnnouncementFile | null | undefined;
  flowId?: string;
  instanceId?: string;
  nodeId: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const download = async () => {
    setDownloading(true);
    setError("");
    try {
      const result = instanceId
        ? await workflowApi.downloadStudentAnnouncementFile(instanceId, nodeId, assetId)
        : await workflowApi.downloadTeacherAnnouncementFile(flowId!, nodeId, assetId);
      const link = document.createElement("a");
      link.href = result.url;
      link.download = result.originalName;
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setError("下载失败，请重试");
    } finally {
      setDownloading(false);
    }
  };

  if (file === undefined) return <span className="announcement-file-unavailable">附件加载中…</span>;
  if (file === null) return <span className="announcement-file-unavailable">附件暂无法获取</span>;
  return (
    <span className="announcement-file-card">
      <span className="announcement-file-type">{fileTypeLabel(file.contentType)}</span>
      <span className="announcement-file-details">
        <span className="announcement-file-name" title={file.originalName}>{file.originalName}</span>
        <span className="announcement-file-size">{fileSizeLabel(file.sizeBytes)}</span>
        {error ? <span className="announcement-file-error" role="alert">{error}</span> : null}
      </span>
      <button disabled={downloading} onClick={() => void download()} type="button">
        {downloading ? "获取中…" : "下载"}
      </button>
    </span>
  );
}

export function AnnouncementMarkdown({
  children,
  flowId,
  instanceId,
  nodeId,
}: {
  children: string;
  flowId?: string;
  instanceId?: string;
  nodeId: string;
}) {
  const imageKeys = useMemo(() => [...new Set([...children.matchAll(imageReference)].map((match) => match[1]))].sort().join(","), [children]);
  const fileKeys = useMemo(() => [...new Set([...children.matchAll(fileReference)].map((match) => match[1]))].sort().join(","), [children]);
  const [urls, setUrls] = useState<Map<string, string | null>>(new Map());
  const [files, setFiles] = useState<Map<string, AnnouncementFile | null>>(new Map());
  const [expanded, setExpanded] = useState<{ alt: string; url: string } | null>(null);
  const imageDialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const ids = imageKeys ? imageKeys.split(",") : [];
    if (ids.length === 0 || (!flowId && !instanceId)) {
      setUrls(new Map());
      return;
    }
    let active = true;
    const load = async () => {
      const resolved = await Promise.all(ids.map(async (id): Promise<[string, string | null]> => {
        try {
          const asset = instanceId
            ? await workflowApi.getStudentContentImage(instanceId, id)
            : await workflowApi.getTeacherContentImage(flowId!, id);
          return [id, asset.url];
        } catch {
          return [id, null];
        }
      }));
      if (active) setUrls(new Map(resolved));
    };
    void load();
    const refresh = window.setInterval(() => void load(), 8 * 60 * 1000);
    return () => { active = false; window.clearInterval(refresh); };
  }, [imageKeys, flowId, instanceId]);

  useEffect(() => {
    const ids = fileKeys ? fileKeys.split(",") : [];
    if (ids.length === 0 || (!flowId && !instanceId)) {
      setFiles(new Map());
      return;
    }
    let active = true;
    void Promise.all(ids.map(async (id): Promise<[string, AnnouncementFile | null]> => {
      try {
        const file = instanceId
          ? await workflowApi.getStudentAnnouncementFile(instanceId, nodeId, id)
          : await workflowApi.getTeacherAnnouncementFile(flowId!, nodeId, id);
        return [id, file];
      } catch {
        return [id, null];
      }
    })).then((resolved) => { if (active) setFiles(new Map(resolved)); });
    return () => { active = false; };
  }, [fileKeys, flowId, instanceId, nodeId]);

  return (
    <div className="announcement-markdown">
      <Markdown
        components={{
          a: ({ href, children: label }) => {
            if (!href?.startsWith("asset://")) {
              return <a href={href} rel="noopener noreferrer" target="_blank">{label}</a>;
            }
            const match = assetUrl.exec(href);
            return match
              ? <AnnouncementFileCard assetId={match[1]} file={files.get(match[1])} flowId={flowId} instanceId={instanceId} nodeId={nodeId} />
              : <span className="announcement-file-unavailable">附件引用无效</span>;
          },
          img: ({ src, alt }) => {
            const match = assetUrl.exec(src ?? "");
            if (!match) return <span className="announcement-image-message">请上传图片后插入公告</span>;
            const url = urls.get(match[1]);
            if (url === undefined) return <span className="announcement-image-message">图片加载中…</span>;
            if (url === null) return <span className="announcement-image-message">图片暂无法显示</span>;
            return (
              <button
                aria-label={`放大查看${alt || "公告图片"}`}
                className="announcement-image-button"
                onClick={() => { setExpanded({ alt: alt || "公告图片", url }); imageDialogRef.current?.showModal(); }}
                type="button"
              >
                <img alt={alt || "公告图片"} loading="lazy" src={url} />
              </button>
            );
          },
        }}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => url.startsWith("asset://") ? url : defaultUrlTransform(url)}
      >
        {children}
      </Markdown>
      <dialog
        aria-label="公告图片预览"
        className="announcement-image-dialog"
        onClick={(event) => { if (event.target === event.currentTarget) imageDialogRef.current?.close(); }}
        onClose={() => setExpanded(null)}
        ref={imageDialogRef}
      >
        <button aria-label="关闭图片预览" onClick={() => imageDialogRef.current?.close()} type="button">×</button>
        {expanded ? <img alt={expanded.alt} src={expanded.url} /> : null}
      </dialog>
    </div>
  );
}
