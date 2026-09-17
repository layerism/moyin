import { applyPreviewHeaders } from "./api";

type SaveHandle = { createWritable(): Promise<WritableStream<Uint8Array>> };
type SaveWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveHandle> };

/** Must be called directly from the click handler, before any network await. */
export async function saveStudentFile(kind: "file" | "template" | "reference" | "feedback", id: string, filename: string): Promise<boolean> {
  const picker = (window as SaveWindow).showSaveFilePicker;
  let handle: SaveHandle | undefined;
  if (picker) {
    try { handle = await picker.call(window, { suggestedName: filename || "下载文件" }); }
    catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      throw error;
    }
  }
  const headers = new Headers();
  applyPreviewHeaders(headers);
  const response = await fetch(`/api/student/downloads/${kind}/${encodeURIComponent(id)}`, { credentials: "include", headers });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.detail === "string" ? error.detail : "文件下载失败，请重试");
  }
  if (handle) {
    if (!response.body) throw new Error("文件内容为空，请重试");
    await response.body.pipeTo(await handle.createWritable());
  } else {
    // Browsers without a picker use their own download-location preference.
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename || "下载文件";
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return true;
}
