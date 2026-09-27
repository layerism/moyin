import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfPreview({ url, filename }: { url: string; filename: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    setDocument(null); setError(""); setPageNumber(1); setZoom(1);
    const task = getDocument({ url, withCredentials: true });
    task.promise.then((value) => { if (active) setDocument(value); }).catch(() => {
      if (active) setError("PDF 加载失败，请重新打开审核页或下载原件查看。");
    });
    return () => { active = false; void task.destroy(); };
  }, [url]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document || !width || !canvas.current) return;
    let active = true;
    let task: RenderTask | undefined;
    setRendering(true); setError("");
    void document.getPage(pageNumber).then(async (page) => {
      if (!active || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const display = page.getViewport({ scale: Math.max(1, width - 24) / base.width * zoom });
      const ratio = window.devicePixelRatio || 1;
      const target = canvas.current;
      target.width = Math.ceil(display.width * ratio);
      target.height = Math.ceil(display.height * ratio);
      target.style.width = `${display.width}px`;
      target.style.height = `${display.height}px`;
      task = page.render({ canvas: target, viewport: display, transform: [ratio, 0, 0, ratio, 0, 0] });
      await task.promise;
      if (active) setRendering(false);
    }).catch(() => {
      if (active) { setError("此页渲染失败，请下载原件查看。"); setRendering(false); }
    });
    return () => { active = false; task?.cancel(); };
  }, [document, pageNumber, width, zoom]);

  return <section className="file-review-pdf-preview" aria-label={`原件预览：${filename}`}>
    <div className="pdf-preview-toolbar">
      <button type="button" disabled={!document || pageNumber <= 1} onClick={() => setPageNumber((value) => value - 1)} aria-label="上一页">‹</button>
      <span>{document ? `${pageNumber} / ${document.numPages}` : "加载中…"}</span>
      <button type="button" disabled={!document || pageNumber >= document.numPages} onClick={() => setPageNumber((value) => value + 1)} aria-label="下一页">›</button>
      <button type="button" disabled={!document || zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} aria-label="缩小">−</button>
      <button type="button" disabled={!document} onClick={() => setZoom(1)} title="恢复适合宽度">{Math.round(zoom * 100)}%</button>
      <button type="button" disabled={!document || zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.25))} aria-label="放大">＋</button>
    </div>
    <div className="pdf-preview-viewport" ref={viewport} aria-busy={!error && (!document || rendering)}>
      {error ? <p role="alert">{error}</p> : !document ? <p role="status">正在加载 PDF…</p> : null}
      <canvas ref={canvas} aria-label={`${filename} 第 ${pageNumber} 页`} style={{ visibility: document && !error && !rendering ? "visible" : "hidden" }} />
    </div>
  </section>;
}
