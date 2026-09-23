import { useEffect, useMemo, useRef, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { findContentAssetIds } from "./answerSheetMarkdown";
import { workflowApi } from "./api";

const assetUrl = /^asset:\/\/([A-Za-z0-9-]+)$/;

export function AnnouncementMarkdown({
  children,
  flowId,
  instanceId,
}: {
  children: string;
  flowId?: string;
  instanceId?: string;
}) {
  const assetKeys = useMemo(() => findContentAssetIds(children).sort().join(","), [children]);
  const [urls, setUrls] = useState<Map<string, string | null>>(new Map());
  const [expanded, setExpanded] = useState<{ alt: string; url: string } | null>(null);
  const imageDialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const ids = assetKeys ? assetKeys.split(",") : [];
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
  }, [assetKeys, flowId, instanceId]);

  return (
    <div className="announcement-markdown">
      <Markdown
        components={{
          a: ({ href, children: label }) => href?.startsWith("asset://")
            ? <span>{label}</span>
            : <a href={href} rel="noopener noreferrer" target="_blank">{label}</a>,
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
