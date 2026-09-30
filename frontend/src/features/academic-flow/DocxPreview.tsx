import { useEffect, useRef, useState } from "react";
import { paginateDocx } from "./docxPagination";

export function DocxPreview({ url, filename }: { url: string; filename: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [paper, setPaper] = useState<"A4" | "A3">("A4");

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    const controller = new AbortController();
    let active = true;
    root.replaceChildren();
    setLoading(true); setError(""); setZoom(1); setPageCount(0);
    void (async () => {
      const response = await fetch(url, { credentials: "include", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? "登录已失效或无权查看此文件，请重新登录后重试。"
        : "DOCX 加载失败，请重新打开审核页或下载原件查看。");
      const data = await response.blob();
      const { parseAsync, renderDocument } = await import("docx-preview");
      if (!active) return;
      const body = document.createElement("div");
      const styles = document.createElement("div");
      const options = { useBase64URL: true, renderAltChunks: false, breakPages: true, ignoreLastRenderedPageBreak: false, ignoreWidth: true, ignoreHeight: true };
      const parsed = await parseAsync(data, options);
      // docx-preview 0.4.1 merges equal-sized sections when saved page breaks
      // are enabled. Preserve next-page section boundaries explicitly; an
      // omitted section type means nextPage in WordprocessingML.
      for (const paragraph of parsed.documentPart.body.children) {
        if (paragraph.type !== "paragraph" || !paragraph.sectionProps) continue;
        const sectionType = paragraph.sectionProps.type ?? "nextPage";
        if (!["nextPage", "evenPage", "oddPage"].includes(sectionType)) continue;
        const hasBreak = paragraph.children?.some((run: { children?: { type: string; break?: string }[] }) =>
          run.children?.some((child) => child.type === "break" && ["page", "lastRenderedPageBreak"].includes(child.break ?? "")));
        if (!hasBreak) {
          (paragraph.children ??= []).push({ type: "run", children: [{ type: "break", break: "page" }] });
        }
      }
      const nodes = await renderDocument(parsed, options);
      for (const node of nodes) (node.nodeName === "STYLE" ? styles : body).appendChild(node);
      if (!active) return;
      const [width, height] = paper === "A3" ? [297, 420] : [210, 297];
      const pageSize = document.createElement("style");
      pageSize.textContent = `
        section.docx { width: ${width}mm; height: ${height}mm; min-height: ${height}mm; flex-shrink: 0; box-sizing: border-box; }
        section.docx > article { flex: none; margin-bottom: 0; }
        section.docx > header, section.docx > footer { flex: none; }
        section.docx > footer { margin-top: auto !important; }
        p[data-page-continuation]::before { display: none !important; }
        p[data-page-continuation] { list-style-type: none !important; }
      `;
      root.replaceChildren(styles, pageSize, body);
      // The host remains laid out (but invisible) while measuring pagination.
      await Promise.all(Array.from(body.querySelectorAll("img"), (image) => image.decode().catch(() => undefined)));
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!active) return;
      setPageCount(paginateDocx(body));
      setLoading(false);
    })().catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "DOCX 预览失败，请下载原件查看。");
      setLoading(false);
    });
    return () => { active = false; controller.abort(); root.replaceChildren(); };
  }, [url, paper]);

  return <section className="file-review-docx-preview" aria-label={`DOCX 预览：${filename}`}>
    <div className="pdf-preview-toolbar">
      <span>DOCX 预览</span>
      <select aria-label="DOCX 纸张大小" value={paper} onChange={(event) => setPaper(event.target.value === "A3" ? "A3" : "A4")}>
        <option value="A4">A4</option>
        <option value="A3">A3</option>
      </select>
      {pageCount > 0 ? <span title="按浏览器实际排版推断，可能与 Word 页码不同">{paper} 推断 · {pageCount} 页</span> : null}
      <button type="button" disabled={loading || Boolean(error) || zoom <= 0.5} aria-label="缩小" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button>
      <button type="button" disabled={loading || Boolean(error)} title="恢复原始比例" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" disabled={loading || Boolean(error) || zoom >= 2} aria-label="放大" onClick={() => setZoom((value) => Math.min(2, value + 0.25))}>＋</button>
    </div>
    <div className="docx-preview-viewport" aria-busy={loading}>
      {loading ? <p role="status">正在加载 DOCX…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div ref={host} style={{ zoom: loading ? 1 : zoom, display: error ? "none" : "block", visibility: loading ? "hidden" : "visible", position: loading ? "absolute" : "relative", pointerEvents: loading ? "none" : undefined }} />
    </div>
  </section>;
}
