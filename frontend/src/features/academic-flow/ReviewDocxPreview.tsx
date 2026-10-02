import { useEffect, useRef, useState } from "react";
import { DocxPreview } from "./DocxPreview";
import { PdfPreview } from "./PdfPreview";

export function ReviewDocxPreview({ url, filename }: { url: string; filename: string }) {
  const [mode, setMode] = useState<"docx" | "pdf">("docx");
  const [pdfUrl, setPdfUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const cached = useRef("");

  useEffect(() => () => {
    request.current?.abort();
    if (cached.current) URL.revokeObjectURL(cached.current);
  }, [url]);

  const showPdf = async () => {
    setMode("pdf");
    if (cached.current || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch(`${url}?pdf=true`, { credentials: "include", signal: controller.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === "string" ? body.detail : "PDF 转换失败，请重试或使用 DOCX 预览。");
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      cached.current = URL.createObjectURL(blob);
      setPdfUrl(cached.current);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "PDF 转换失败");
    } finally {
      if (!controller.signal.aborted) { setLoading(false); request.current = null; }
    }
  };

  const modeSwitch = <div className="review-docx-switch" role="group" aria-label="切换 DOCX 或 PDF 预览">
    <button type="button" aria-pressed={mode === "docx"} onClick={() => setMode("docx")}>DOCX</button>
    <button type="button" aria-pressed={mode === "pdf"} onClick={() => void showPdf()}>PDF</button>
  </div>;

  return <section className="review-docx-modes" aria-label="文档预览方式">
    <div className="review-docx-pane" hidden={mode !== "docx"}><DocxPreview url={url} filename={filename} toolbarPrefix={modeSwitch} /></div>
    <div className="review-docx-pane" hidden={mode !== "pdf"}>
      {!pdfUrl ? <div className="pdf-preview-toolbar is-unified">{modeSwitch}</div> : null}
      {loading ? <p className="file-review-muted" role="status">正在转换 PDF，请稍候…</p> : null}
      {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => void showPdf()}>重新转换</button></div> : null}
      {pdfUrl ? <PdfPreview toolbarPrefix={modeSwitch} url={pdfUrl} filename={filename.replace(/\.docx$/i, ".pdf")} /> : null}
    </div>
  </section>;
}
