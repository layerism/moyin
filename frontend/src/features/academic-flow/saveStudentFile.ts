import { applyPreviewHeaders } from "./api";

import { saveDownload } from "./download";

export async function saveStudentFile(kind: "file" | "template" | "reference" | "feedback", id: string, filename: string, assetId?: string): Promise<boolean> {
  const headers = new Headers();
  applyPreviewHeaders(headers);
  return saveDownloadFile(`/api/student/downloads/${kind}/${encodeURIComponent(id)}${assetId ? `?asset_id=${encodeURIComponent(assetId)}` : ""}`, filename, headers);
}

export async function saveDownloadFile(endpoint: string, filename: string, headers?: Headers): Promise<boolean> {
  const response = await fetch(endpoint, { credentials: "include", headers });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.detail === "string" ? error.detail : "文件下载失败，请重试");
  }
  const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  const container = dialogs.length ? dialogs[dialogs.length - 1] : document.body;
  saveDownload(await response.blob(), filename || "下载文件", container);
  return true;
}
