import { useId, useRef, useState } from "react";
import { modelCardsApi, type ModelCardDraft } from "./modelCardsApi";

export function ModelNamePicker({ cardId, draft, disabled, onChange }: {
  cardId: string | null; draft: ModelCardDraft; disabled: boolean; onChange: (model: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const load = () => {
    setOpen(true);
    if (models !== null || pending.current || disabled) return;
    if (!draft.apiUrl.trim()) { setError("请先填写 Base URL。"); return; }
    pending.current = true;
    setLoading(true); setError("");
    modelCardsApi.models(cardId, draft).then(({ models: next }) => setModels(draft.vendor === "doubao" ? next.filter((model) => model.startsWith("doubao-seed")) : next))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "获取模型列表失败。"))
      .finally(() => { pending.current = false; setLoading(false); });
  };
  return <div className="model-name-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); }
  }}>
    <label className="audit-script-config-field">模型名称
      <input required maxLength={200} autoComplete="off" placeholder="点击选择或手动输入模型 ID" disabled={disabled}
        value={draft.model} aria-expanded={open} aria-controls={open ? listId : undefined}
        onClick={load} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); load(); } }}
        onChange={(event) => onChange(event.target.value)} />
    </label>
    {open ? <div className="model-name-options" id={listId} aria-label="可用模型">
      {loading ? <p role="status">正在获取模型列表…</p> : null}
      {error ? <><p role="alert">{error}</p><button type="button" disabled={disabled} onClick={load}>重试</button></> : null}
      {models?.length === 0 ? <p>未返回可用模型，可手动输入。</p> : null}
      {models?.map((model) => <button type="button" key={model} disabled={disabled} aria-pressed={draft.model === model}
        onClick={() => { onChange(model); setOpen(false); }}>{model}</button>)}
    </div> : null}
  </div>;
}
