import { useEffect, useRef, useState } from "react";
import type { AcademicProcess } from "../../types";
import { workflowApi } from "../academic-flow/api";

export function PublishWorkflowDialog({ process, onClose, onPublished }: {
  process: AcademicProcess;
  onClose: () => void;
  onPublished: (name: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submittingRef = useRef(false);
  const [name, setName] = useState(process.name);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const publish = async () => {
    if (submittingRef.current || !name.trim()) return;
    submittingRef.current = true;
    setBusy(true);
    setError("");
    try {
      await workflowApi.publishWorkflowTemplate({
        sourceFlowId: process.serverId ?? process.id,
        name: name.trim(),
        description: description.trim(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发布失败，请重试");
      submittingRef.current = false;
      setBusy(false);
      return;
    }
    onPublished(name.trim());
  };

  return (
    <dialog ref={dialogRef} className="workflow-template-editor workflow-inline-publish"
      aria-labelledby="inline-publish-title" aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (!submittingRef.current) onClose(); }}>
      <header><h2 id="inline-publish-title">发布流程模板</h2><button type="button" aria-label="关闭" disabled={busy} onClick={onClose}>×</button></header>
      <form onSubmit={(event) => { event.preventDefault(); void publish(); }}>
        <label>来源流程<input readOnly value={process.name} /></label>
        <label>模板名称<input autoFocus required maxLength={120} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>模板简介<textarea maxLength={500} rows={3} disabled={busy} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <p>保存来源流程的当前草稿及附件；不包含学生数据，开始和截止时间会清空。已创建的流程不受影响。</p>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-action" type="submit" disabled={busy || !name.trim()}>{busy ? "正在发布…" : "确认发布"}</button></footer>
      </form>
    </dialog>
  );
}
