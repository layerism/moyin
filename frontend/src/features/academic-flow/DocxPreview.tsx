import { useEffect, useRef, useState, type ReactNode } from "react";
import { paginateDocx } from "./docxPagination";
import { applyDocxLineSpacing, supplementDocxLayout } from "./docxLayout";
import { prepareDocxPageNumbers, updateDocxPageNumbers } from "./docxPageNumbers";
import { applyProjectDocxFonts } from "./docxFonts";
import { prepareDocxFontConfig } from "./docxFontConfig";
import type { HElement } from "docx-preview";

export function DocxPreview({ url, filename, toolbarPrefix }: { url: string; filename: string; toolbarPrefix?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(0.5);
  const [pageCount, setPageCount] = useState(0);
  const [paper, setPaper] = useState<"original" | "A4" | "A3">("original");

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    const controller = new AbortController();
    let active = true;
    let releaseFonts: (() => void) | undefined;
    root.replaceChildren();
    setLoading(true); setError(""); setZoom(0.5); setPageCount(0);
    void (async () => {
      const response = await fetch(url, { credentials: "include", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? "登录已失效或无权查看此文件，请重新登录后重试。"
        : "DOCX 加载失败，请重新打开审核页或下载原件查看。");
      const data = await response.arrayBuffer();
      const { parseAsync, renderDocument, defaultOptions } = await import("docx-preview");
      if (!active) return;
      const body = document.createElement("div");
      const styles = document.createElement("div");
      const options = {
        useBase64URL: true, renderAltChunks: false, breakPages: true,
        ignoreLastRenderedPageBreak: false, ignoreWidth: false, ignoreHeight: false, ignoreFonts: true,
        h: (value: HElement | Node | string) => {
          const result = defaultOptions.h(value);
          if ((result instanceof HTMLElement || result instanceof SVGElement || result instanceof MathMLElement) && typeof value === "object" && !(value instanceof Node)
            && typeof value.style === "object") {
            for (const [name, content] of Object.entries(value.style)) {
              if (name.startsWith("--docx-")) result.style.setProperty(name, content);
            }
            // w:sym specifies its own font, independent of the run's four script slots.
            const symbolFont = value.style.fontFamily;
            if (symbolFont) result.style.setProperty("--docx-font-symbol", JSON.stringify(symbolFont.replace(/^(['"])(.*)\1$/, "$2")));
          }
          return result;
        },
      };
      const parsed = await parseAsync(data, options);
      supplementDocxLayout(data, parsed);
      const fontTheme = prepareDocxFontConfig(data, parsed);
      const numbering = prepareDocxPageNumbers(parsed);
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
      for (const page of Array.from(body.querySelectorAll<HTMLElement>("section.docx"))) {
        const height = paper === "original" ? page.style.minHeight || "297mm" : paper === "A3" ? "420mm" : "297mm";
        page.style.width = paper === "original" ? page.style.width || "210mm" : paper === "A3" ? "297mm" : "210mm";
        page.style.height = page.style.minHeight = height;
      }
      const pageSize = document.createElement("style");
      pageSize.textContent = `
        section.docx { flex-shrink: 0; box-sizing: border-box; font-synthesis: weight style; }
        docx-text { display: inline; }
        section.docx > article { flex: none; margin-bottom: 0; }
        section.docx > header, section.docx > footer { flex: none; }
        section.docx > footer { margin-top: auto !important; }
        p[data-page-continuation]::before { display: none !important; }
        p[data-page-continuation] { list-style-type: none !important; }
        [data-docx-project-before]::before { font-family: var(--docx-project-before-fonts) !important; }
        [data-docx-project-after]::after { font-family: var(--docx-project-after-fonts) !important; }
        [data-docx-project-marker]::marker { font-family: var(--docx-project-marker-fonts) !important; }
      `;
      root.replaceChildren(styles, pageSize, body);
      // The host remains laid out (but invisible) while measuring pagination.
      releaseFonts = await applyProjectDocxFonts(body, fontTheme);
      if (!active) { releaseFonts(); return; }
      await Promise.all(Array.from(body.querySelectorAll("img"), (image) => image.decode().catch(() => undefined)));
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!active) return;
      applyDocxLineSpacing(body);
      setPageCount(paginateDocx(body));
      updateDocxPageNumbers(body, numbering);
      setLoading(false);
    })().catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "DOCX 预览失败，请下载原件查看。");
      setLoading(false);
    });
    return () => { active = false; controller.abort(); releaseFonts?.(); root.replaceChildren(); };
  }, [url, paper]);

  return <section className="file-review-docx-preview" aria-label={`DOCX 预览：${filename}`}>
    <div className={`pdf-preview-toolbar${toolbarPrefix ? " is-unified" : ""}`}>
      {toolbarPrefix}
      {!toolbarPrefix ? <span>DOCX 预览</span> : null}
      <select aria-label="DOCX 纸张大小" value={paper} onChange={(event) => setPaper(event.target.value === "A3" ? "A3" : event.target.value === "A4" ? "A4" : "original")}>
        <option value="original">原始</option>
        <option value="A4">A4</option>
        <option value="A3">A3</option>
      </select>
      {pageCount > 0 ? <span title="按浏览器实际排版推断，可能与 Word 页码不同">{toolbarPrefix ? "" : `${paper === "original" ? "原始版式" : `${paper} 重排`} · `}{pageCount} 页</span> : null}
      <div className="preview-zoom-group" role="group" aria-label="缩放">
      <button className="preview-zoom-start" type="button" disabled={loading || Boolean(error) || zoom <= 0.5} aria-label="缩小" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button>
      <button type="button" disabled={loading || Boolean(error)} title="恢复原始比例" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" disabled={loading || Boolean(error) || zoom >= 2} aria-label="放大" onClick={() => setZoom((value) => Math.min(2, value + 0.25))}>＋</button>
      </div>
    </div>
    <div className="docx-preview-viewport" aria-busy={loading}>
      {loading ? <p role="status">正在加载 DOCX…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div ref={host} style={{ zoom: loading ? 1 : zoom, display: error ? "none" : "block", visibility: loading ? "hidden" : "visible", position: loading ? "absolute" : "relative", pointerEvents: loading ? "none" : undefined }} />
    </div>
  </section>;
}
