export type UploadedFile = {
  contentType: string;
  fileId: string;
  originalName: string;
  sha256?: string;
  sizeBytes: number;
  storageKey: string;
};

export function createFileUploadBody(file: File): FormData {
  const body = new FormData();
  body.append("file", file);
  return body;
}
