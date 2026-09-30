import { useEffect, useRef } from "react";

export function NoChangesDialog({ action, onClose }: { action: "save" | "publish"; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="node-progress-dialog np-confirm" aria-labelledby="no-changes-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="no-changes-title">没有变化</h2><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
    <section className="np-body">{action === "save" ? "当前内容与已暂存的草稿一致，无需保存。" : "当前内容与已发布版本一致，无需重新发布。"}</section>
    <footer><span /><button type="button" className="np-primary" autoFocus onClick={onClose}>知道了</button></footer>
  </dialog>;
}
