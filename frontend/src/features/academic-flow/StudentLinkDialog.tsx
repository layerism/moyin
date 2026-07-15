import { useState } from "react";

import { getAbsoluteShareUrl } from "./shareUrl";

export function StudentLinkDialog({
  flowName,
  onClose,
  onOpen,
  shareUrl,
}: {
  flowName: string;
  onClose: () => void;
  onOpen: () => void;
  shareUrl: string;
}) {
  const [copyState, setCopyState] = useState<"copied" | "error" | "idle">("idle");
  const absoluteUrl = getAbsoluteShareUrl(shareUrl, window.location.origin);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <div className="student-link-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="student-link-dialog-title"
        aria-modal="true"
        className="student-link-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span>学生访问入口</span>
            <h2 id="student-link-dialog-title">“{flowName}”的学生链接</h2>
          </div>
          <button aria-label="关闭学生链接" onClick={onClose} type="button">
            ×
          </button>
        </header>

        <div className="student-link-list">
          <article>
            <div>
              <strong>学生填写页面</strong>
              <small>名单中的学生通过该链接登录并办理流程。</small>
            </div>
            <a href={absoluteUrl} rel="noreferrer" target="_blank">
              {absoluteUrl}
            </a>
            <div className="student-link-actions">
              <button onClick={() => void copyLink()} type="button">
                {copyState === "copied" ? "已复制" : "复制链接"}
              </button>
              <button className="primary-action" onClick={onOpen} type="button">
                打开链接
              </button>
            </div>
            {copyState === "error" ? (
              <p role="alert">复制失败，请手动选择上方链接。</p>
            ) : null}
          </article>
        </div>
      </section>
    </div>
  );
}
