import { useRef, useState } from "react";
import { workflowApi } from "../academic-flow/api";

export function PersonalDriveUploadButton({ onUploaded }: { onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = async (file: File) => {
    setError("");
    if (file.size > 100 * 1024 * 1024) {
      setError("单个文件不能超过 100 MB");
      return;
    }
    setUploading(true);
    try {
      await workflowApi.uploadPersonalFile(file);
      onUploaded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败，请重试");
    } finally {
      setUploading(false);
    }
  };

  return <>
    <button className="drive-secondary" disabled={uploading} onClick={() => input.current?.click()} type="button" title="上传到个人云盘，单个文件不超过 100 MB">
      {uploading ? "上传中…" : "上传"}
    </button>
    <input ref={input} type="file" hidden aria-label="上传个人文件" onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void upload(file);
    }} />
    {error ? <p className="personal-upload-error" role="alert">{error}</p> : null}
  </>;
}
