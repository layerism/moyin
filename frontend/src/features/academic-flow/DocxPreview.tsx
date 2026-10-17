import { useEffect, useRef, useState } from "react";
import { paginateDocx } from "./docxPagination";
import { applyDocxCharacterSpacing } from "./docxCharacterSpacing";
import { applyDocxLineSpacing, applyDocxUnderlines, applyDocxTabs, createDocxXmlContext, prepareDocxBreaks, supplementDocxLayout } from "./docxLayout";
import { prepareDocxPageNumbers, updateDocxPageNumbers } from "./docxPageNumbers";
import { applyDocxMirrorMargins, prepareDocxPageMargins } from "./docxPageMargins";
import { applyProjectDocxFonts } from "./docxFonts";
import { prepareDocxFontConfig } from "./docxFontConfig";
import type { HElement } from "docx-preview";

export function DocxPreview({ url, filename }: { url: string; filename: string }) {
  const host = useRef<HTMLDivElement>(null);
  const sourceFile = useRef<{ url: string; data: ArrayBuffer } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fontWarnings, setFontWarnings] = useState<string[]>([]);
  const [zoom, setZoom] = useState(0.75);
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
    setLoading(true); setError(""); setFontWarnings([]); setZoom(0.75); setPageCount(0);
    void (async () => {
      const timings: Record<string, number> = {};
      let stageStart = performance.now();
      const stage = (name: string) => { timings[name] = performance.now() - stageStart; stageStart = performance.now(); };
      let data = sourceFile.current?.url === url ? sourceFile.current.data : undefined;
      if (!data) {
        sourceFile.current = null;
        const response = await fetch(url, { credentials: "include", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403
          ? "登录已失效或无权查看此文件，请重新登录后重试。"
          : "DOCX 加载失败，请重新打开审核页或下载原件查看。");
        data = await response.arrayBuffer();
        if (!active) return;
        // One component session only; no cross-user or cross-open document cache.
        sourceFile.current = { url, data };
      }
      stage("download");
      const { parseAsync, renderDocument, defaultOptions } = await import("docx-preview");
      if (!active) return;
      const body = document.createElement("div");
      const styles = document.createElement("div");
      const options = {
        useBase64URL: true, renderAltChunks: false, breakPages: true, keepOrigin: true,
        ignoreLastRenderedPageBreak: true, ignoreWidth: false, ignoreHeight: false, ignoreFonts: true,
        h: (value: HElement | Node | string) => {
          // docx-preview renders w:tab as a generated EM SPACE string. Represent its
          // advance with measured XML tab stops, without requesting a generated glyph.
          // Literal document text arrives here as a Text node inside its run.
          if (typeof value === "object" && !(value instanceof Node) && value.tagName === "span"
            && value.children?.length === 1 && value.children[0] === "\u2003" && !value.style) {
            return defaultOptions.h({ tagName: "docx-tab", "aria-hidden": "true",
              style: { display: "inline-block", width: "0", height: "0" } });
          }
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
      const xml = createDocxXmlContext(parsed);
      supplementDocxLayout(xml, parsed);
      const pageMargins = prepareDocxPageMargins(xml, parsed);
      const fontTheme = prepareDocxFontConfig(xml, parsed);
      const numbering = prepareDocxPageNumbers(parsed);
      prepareDocxBreaks(parsed);
      stage("parse");
      const nodes = await renderDocument(parsed, options);
      stage("render");
      for (const node of nodes) (node.nodeName === "STYLE" ? styles : body).appendChild(node);
      if (!active) return;
      for (const page of Array.from(body.querySelectorAll<HTMLElement>("section.docx"))) {
        if (paper === "original") {
          if (page.style.minHeight) page.style.height = page.style.minHeight;
          else page.dataset.docxUnpaged = "true";
        } else {
          page.style.width = paper === "A3" ? "297mm" : "210mm";
          page.style.height = page.style.minHeight = paper === "A3" ? "420mm" : "297mm";
        }
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
        [data-docx-project-before]::before {
          font-family: var(--docx-project-before-fonts) !important;
          font-weight: var(--docx-project-before-weight, inherit) !important;
          font-style: var(--docx-project-before-style, inherit) !important;
          letter-spacing: var(--docx-project-before-spacing) !important;
          font-kerning: var(--docx-project-before-kerning) !important;
        }
        [data-docx-project-after]::after {
          font-family: var(--docx-project-after-fonts) !important;
          font-weight: var(--docx-project-after-weight, inherit) !important;
          font-style: var(--docx-project-after-style, inherit) !important;
          letter-spacing: var(--docx-project-after-spacing) !important;
          font-kerning: var(--docx-project-after-kerning) !important;
        }
        [data-docx-project-marker]::marker {
          font-family: var(--docx-project-marker-fonts) !important;
          font-weight: var(--docx-project-marker-weight, inherit) !important;
          font-style: var(--docx-project-marker-style, inherit) !important;
          letter-spacing: var(--docx-project-marker-spacing) !important;
          font-kerning: var(--docx-project-marker-kerning) !important;
        }
        [data-docx-project-before-content]::before { content: var(--docx-project-before-content) !important; }
        [data-docx-project-after-content]::after { content: var(--docx-project-after-content) !important; }
        [data-docx-project-marker-content]::marker { content: var(--docx-project-marker-content) !important; }
      `;
      root.replaceChildren(styles, pageSize, body);
      // The host remains laid out (but invisible) while measuring pagination.
      const fonts = await applyProjectDocxFonts(body, fontTheme);
      stage("fonts");
      releaseFonts = fonts.release;
      if (!active) { releaseFonts(); return; }
      setFontWarnings(fonts.warnings);
      await Promise.all(Array.from(body.querySelectorAll("img"), (image) => image.decode().catch(() => undefined)));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!active) return;
      applyDocxCharacterSpacing(body);
      const layoutWarnings = [...pageMargins.warnings, ...applyDocxLineSpacing(body), ...applyDocxTabs(body)];
      stage("layout");
      const pagination = await paginateDocx(body, controller.signal);
      stage("pagination");
      if (!active) return;
      applyDocxMirrorMargins(body, pageMargins.mirror);
      updateDocxPageNumbers(body, numbering);
      const decorationWarnings = applyDocxUnderlines(body);
      stage("decoration");
      setFontWarnings([...fonts.warnings, ...layoutWarnings, ...pagination.warnings, ...decorationWarnings]);
      setPageCount(pagination.pageCount);
      // Inspectable without logging document content or adding product controls.
      body.dataset.docxTimings = JSON.stringify(timings);
      setLoading(false);
    })().catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "DOCX 预览失败，请下载原件查看。");
      setLoading(false);
    });
    return () => { active = false; controller.abort(); releaseFonts?.(); root.replaceChildren(); };
  }, [url, paper]);

  return <section className="file-review-docx-preview" aria-label={`DOCX 预览：${filename}`}>
    <div className="pdf-preview-toolbar">
      <span>DOCX 预览</span>
      <select aria-label="DOCX 纸张大小" value={paper} onChange={(event) => setPaper(event.target.value === "A3" ? "A3" : event.target.value === "A4" ? "A4" : "original")}>
        <option value="original">原始</option>
        <option value="A4">A4</option>
        <option value="A3">A3</option>
      </select>
      {pageCount > 0 ? <span title="按浏览器实际排版推断，可能与 Word 页码不同">{paper === "original" ? "原始版式" : `${paper} 重排`} · {pageCount} 页</span> : null}
      <div className="preview-zoom-group" role="group" aria-label="缩放">
      <button className="preview-zoom-start" type="button" disabled={loading || Boolean(error) || zoom <= 0.5} aria-label="缩小" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button>
      <button type="button" disabled={loading || Boolean(error)} title="恢复原始比例" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" disabled={loading || Boolean(error) || zoom >= 2} aria-label="放大" onClick={() => setZoom((value) => Math.min(2, value + 0.25))}>＋</button>
      </div>
    </div>
    {!loading && !error && fontWarnings.length > 0 ? <details className="file-review-muted" style={{ padding: "8px 12px", maxHeight: 120, overflow: "auto", flexShrink: 0 }}>
      <summary>预览差异说明</summary>
      <ul>{fontWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
    </details> : null}
    <div className="docx-preview-viewport" aria-busy={loading}>
      {loading ? <p role="status">正在加载 DOCX…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div ref={host} style={{ zoom: loading ? 1 : zoom, display: error ? "none" : "block", visibility: loading ? "hidden" : "visible", position: loading ? "absolute" : "relative", pointerEvents: loading ? "none" : undefined }} />
    </div>
  </section>;
}
