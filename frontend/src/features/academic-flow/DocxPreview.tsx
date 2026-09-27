import { useEffect, useRef, useState } from "react";

export function DocxPreview({ url, filename }: { url: string; filename: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    const controller = new AbortController();
    let active = true;
    root.replaceChildren();
    setLoading(true); setError(""); setZoom(1);
    void (async () => {
      const response = await fetch(url, { credentials: "include", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? "登录已失效或无权查看此文件，请重新登录后重试。"
        : "DOCX 加载失败，请重新打开审核页或下载原件查看。");
      const data = await response.blob();
      const { renderAsync } = await import("docx-preview");
      if (!active) return;
      const body = document.createElement("div");
      const styles = document.createElement("div");
      await renderAsync(data, body, styles, { useBase64URL: true, renderAltChunks: false, ignoreWidth: true, ignoreHeight: true });
      if (!active) return;
      const pageSize = document.createElement("style");
      pageSize.textContent = "section.docx { width: 210mm; min-height: 297mm; box-sizing: border-box; }";
      root.replaceChildren(styles, pageSize, body);
      setLoading(false);
    })().catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "DOCX 预览失败，请下载原件查看。");
      setLoading(false);
    });
    return () => { active = false; controller.abort(); root.replaceChildren(); };
  }, [url]);

  return <section className="file-review-docx-preview" aria-label={`DOCX 预览：${filename}`}>
    <div className="pdf-preview-toolbar">
      <span>DOCX 预览</span>
      <button type="button" disabled={loading || Boolean(error) || zoom <= 0.5} aria-label="缩小" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button>
      <button type="button" disabled={loading || Boolean(error)} title="恢复原始比例" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" disabled={loading || Boolean(error) || zoom >= 2} aria-label="放大" onClick={() => setZoom((value) => Math.min(2, value + 0.25))}>＋</button>
    </div>
    <div className="docx-preview-viewport" aria-busy={loading}>
      {loading ? <p role="status">正在加载 DOCX…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div ref={host} style={{ zoom, display: loading || error ? "none" : "block" }} />
    </div>
  </section>;
}
