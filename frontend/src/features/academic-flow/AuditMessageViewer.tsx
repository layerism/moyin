import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AuditLLMMessage } from "./api";

export function AuditMessageViewer({ message, index }: { message: AuditLLMMessage; index: number }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const text = typeof message.content === "string" ? message.content
    : message.content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n\n");
  const imageCount = typeof message.content === "string" ? 0 : message.content.filter(part => part.type === "image_url").length;
  const copyText = typeof message.content === "string" ? message.content : JSON.stringify(message.content, null, 2);
  const preview = text.trim().replace(/\s+/g, " ");

  return <article className="audit-test-message audit-message-summary">
    <header><strong>{message.role}</strong><small>消息 {index + 1}{imageCount ? ` · ${imageCount} 张图片` : ""}</small></header>
    <div className="audit-message-summary-row">
      <p>{preview ? preview.length > 48 ? `${preview.slice(0, 48)}…` : preview : imageCount ? "图片消息" : "空消息"}</p>
      <button type="button" aria-haspopup="dialog" onClick={() => {
        setCopied(false); setError("");
        dialog.current?.showModal();
        if (body.current) body.current.scrollTop = 0;
      }}>查看完整内容</button>
    </div>
    {createPortal(<dialog ref={dialog} className="node-script-config-dialog audit-message-dialog" aria-labelledby={titleId}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); dialog.current?.close(); }}>
      <header><div><h2 id={titleId}>{message.role} 消息</h2><p>消息 {index + 1} · 实际发送的内容，只读查看</p></div>
        <button type="button" aria-label="关闭消息" onClick={() => dialog.current?.close()}>×</button>
      </header>
      <div ref={body} className="node-script-config-body audit-message-content audit-test-message">
        {typeof message.content === "string" ? <pre tabIndex={0}>{message.content}</pre> : message.content.map((part, partIndex) => {
          if (part.type === "text") return <pre key={partIndex} tabIndex={0}>{part.text}</pre>;
          if (part.type === "image_url" && part.image_url && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(part.image_url.url)) {
            return <figure key={partIndex}><img src={part.image_url.url} alt={`消息中的图片 ${partIndex + 1}`} loading="lazy" /><figcaption>图片消息{part.image_url.detail ? ` · ${part.image_url.detail}` : ""}</figcaption></figure>;
          }
          return <pre key={partIndex} tabIndex={0}>{JSON.stringify(part, null, 2)}</pre>;
        })}
      </div>
      <footer><small>{error || (imageCount ? "复制内容包含完整图片数据。" : `${text.length.toLocaleString()} 字符`)}</small><div>
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(copyText); setCopied(true); setError(""); }
          catch { setError("复制失败，请选中内容手动复制。"); }
        }}>{copied ? "已复制" : "复制内容"}</button>
        <button type="button" className="primary-action" onClick={() => dialog.current?.close()}>返回审核测试</button>
      </div></footer>
    </dialog>, document.body)}
  </article>;
}
