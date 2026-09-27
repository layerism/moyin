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
  const viewport = useRef<HTMLDivElement>(null);

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

  const goToPage = (number: number) => {
    viewport.current?.querySelector(`[data-pdf-page="${number}"]`)?.scrollIntoView({ block: "start" });
    setPageNumber(number);
  };

  return <section className="file-review-pdf-preview" aria-label={`原件预览：${filename}`}>
    <div className="pdf-preview-toolbar">
      <button type="button" disabled={!document || pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)} aria-label="上一页">‹</button>
      <span>{document ? `${pageNumber} / ${document.numPages}` : "加载中…"}</span>
      <button type="button" disabled={!document || pageNumber >= document.numPages} onClick={() => goToPage(pageNumber + 1)} aria-label="下一页">›</button>
      <button type="button" disabled={!document || zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} aria-label="缩小">−</button>
      <button type="button" disabled={!document} onClick={() => setZoom(1)} title="恢复适合宽度">{Math.round(zoom * 100)}%</button>
      <button type="button" disabled={!document || zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.25))} aria-label="放大">＋</button>
    </div>
    <div className="pdf-preview-viewport" ref={viewport} aria-busy={!error && !document}>
      {error ? <p role="alert">{error}</p> : !document ? <p role="status">正在加载 PDF…</p> : null}
      {document && width > 0 ? Array.from({ length: document.numPages }, (_, index) => <PdfPage key={index} document={document} number={index + 1} width={width} zoom={zoom} onVisible={setPageNumber} />) : null}
    </div>
  </section>;
}

function PdfPage({ document, number, width, zoom, onVisible }: {
  document: PDFDocumentProxy; number: number; width: number; zoom: number; onVisible: (number: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [nearby, setNearby] = useState(false);
  const [aspect, setAspect] = useState(Math.SQRT2);
  const [error, setError] = useState("");
  const displayWidth = Math.max(1, width - 24) * zoom;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const preload = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), { rootMargin: "800px 0px" });
    const visible = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) onVisible(number); }, { threshold: 0.1 });
    preload.observe(element); visible.observe(element);
    return () => { preload.disconnect(); visible.disconnect(); };
  }, [number, onVisible]);

  useEffect(() => {
    if (!nearby) return;
    let active = true;
    let task: RenderTask | undefined;
    const target = canvas.current;
    if (!target) return;
    setError("");
    void document.getPage(number).then(async (page) => {
      if (!active) return;
      const base = page.getViewport({ scale: 1 });
      setAspect(base.height / base.width);
      const display = page.getViewport({ scale: displayWidth / base.width });
      const ratio = window.devicePixelRatio || 1;
      target.width = Math.ceil(display.width * ratio);
      target.height = Math.ceil(display.height * ratio);
      task = page.render({ canvas: target, viewport: display, transform: [ratio, 0, 0, ratio, 0, 0] });
      await task.promise;
    }).catch(() => { if (active) setError(`第 ${number} 页加载失败，请下载原件查看。`); });
    return () => { active = false; task?.cancel(); target.width = 0; target.height = 0; };
  }, [document, number, nearby, displayWidth]);

  return <div ref={container} className="pdf-preview-page" data-pdf-page={number} style={{ width: displayWidth, height: displayWidth * aspect }}>
    {nearby ? <canvas ref={canvas} aria-label={`第 ${number} 页`} /> : <span>第 {number} 页</span>}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
