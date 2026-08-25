import { useEffect, useState, type ImgHTMLAttributes } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

import { workflowApi } from "./api";
import { toStandardMathMarkdown } from "./answerSheetMarkdown";

export function AnswerSheetMarkdown({
  children,
  flowId,
  instanceId,
}: {
  children: string;
  flowId?: string;
  instanceId?: string;
}) {
  return (
    <div className="answer-sheet-markdown">
    <Markdown
      components={{
        a: ({ children: linkChildren, ...props }) => (
          <a {...props} rel="noopener noreferrer" target="_blank">{linkChildren}</a>
        ),
        img: (props) => (
          <ContentImage {...props} flowId={flowId} instanceId={instanceId} />
        ),
      }}
      rehypePlugins={[rehypeKatex]}
      remarkPlugins={[remarkMath]}
      urlTransform={(url) => {
        if (/^asset:\/\/[A-Za-z0-9-]+$/.test(url)) return url;
        return /^https:\/\//i.test(url) ? defaultUrlTransform(url) : "";
      }}
    >
      {toStandardMathMarkdown(children)}
    </Markdown>
    </div>
  );
}

function ContentImage({
  alt,
  flowId,
  instanceId,
  src,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { flowId?: string; instanceId?: string }) {
  const assetId = typeof src === "string" ? src.match(/^asset:\/\/([A-Za-z0-9-]+)$/)?.[1] : undefined;
  const [resolvedUrl, setResolvedUrl] = useState(assetId ? "" : src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!assetId) {
      setResolvedUrl(src);
      return;
    }
    let cancelled = false;
    const request = instanceId
      ? workflowApi.getRuntimeContentAsset(instanceId, assetId)
      : flowId
        ? workflowApi.getTeacherAnswerSheetAsset(flowId, assetId)
        : Promise.reject(new Error("缺少题图读取上下文"));
    request.then((asset) => {
      if (!cancelled) setResolvedUrl(asset.url);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [assetId, flowId, instanceId, src]);

  if (failed) return <span className="answer-sheet-image-error">题图加载失败</span>;
  if (!resolvedUrl) return <span className="answer-sheet-image-loading">题图加载中…</span>;
  return <img {...props} alt={alt ?? "题图"} loading="lazy" src={resolvedUrl} />;
}
