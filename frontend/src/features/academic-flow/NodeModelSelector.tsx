import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { modelCardsApi, type ModelCard } from "../admin/modelCardsApi";
import { VendorLogo } from "../admin/VendorLogo";

export function NodeModelSelector({ value, disabled, onChange }: {
  value: string | null;
  disabled: boolean;
  onChange: (cardId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(value);
  const [cards, setCards] = useState<ModelCard[] | null>(null);
  const [error, setError] = useState("");
  const [request, setRequest] = useState(0);
  const [loading, setLoading] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    modelCardsApi.list().then((state) => {
      if (!cancelled) setCards(state.cards);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "读取模型卡失败");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [request]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]") ?? []);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); trigger.current?.focus(); };
  }, [open]);
  const selected = cards?.find((card) => card.id === draft);
  const valid = draft === null || Boolean(selected?.hasApiKey && selected.apiUrl && selected.model);

  return <>
    <button ref={trigger} className={`node-time-settings-toggle node-model-toggle${value ? " is-configured" : ""}`} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => {
      setDraft(value);
      setOpen(true);
      if (!request) setRequest(1);
    }}><span className="node-model-status" aria-hidden="true">{value ? "" : "＋"}</span>模型配置{value ? <span className="node-model-sr-only">（已选择）</span> : null}</button>
    {open ? createPortal(<div className="node-time-dialog-backdrop node-model-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section ref={dialog} className="node-time-dialog node-model-dialog" role="dialog" aria-modal="true" aria-labelledby="node-model-dialog-title">
        <header><div><h2 id="node-model-dialog-title">审核模型</h2><p>为当前节点选择你的模型卡</p></div><button aria-label="关闭模型配置" type="button" onClick={() => setOpen(false)}>×</button></header>
        <div className="node-model-dialog-body">
          <div className="node-model-actions"><a href="/admin/models" target="_blank" rel="noopener noreferrer">管理模型卡 ↗</a><button type="button" disabled={loading} onClick={() => setRequest((current) => current + 1)}>{loading ? "读取中…" : "刷新"}</button></div>
          {error ? <p className="dialog-error" role="alert">{error}</p> : null}
          {!cards && loading ? <p role="status">正在读取模型卡…</p> : null}
          {cards?.length === 0 ? <p className="node-model-empty">还没有模型卡，请先添加模型连接。</p> : null}
          <fieldset className="node-model-options" disabled={loading || disabled}><legend className="node-model-sr-only">选择审核模型</legend>
            {cards?.map((card) => {
              const ready = card.hasApiKey && Boolean(card.apiUrl && card.model);
              return <label key={card.id} className={`node-model-option${draft === card.id ? " is-selected" : ""}${!ready ? " is-unavailable" : ""}`}>
                <input type="radio" name="node-audit-model" value={card.id} checked={draft === card.id} disabled={!ready} onChange={() => setDraft(card.id)} />
                <VendorLogo vendor={card.vendor} /><span className="node-model-option-copy"><strong>{card.name}</strong><small>{card.model || "未填写型号"}</small></span><span className="node-model-option-check" aria-hidden="true">{draft === card.id ? "✓" : ""}</span>
                {!ready ? <small>待完善</small> : null}
              </label>;
            })}
            <label className="node-model-none"><input type="radio" name="node-audit-model" checked={draft === null} onChange={() => setDraft(null)} />暂不配置模型</label>
          </fieldset>
          {!valid && !loading ? <p className="dialog-error">已选模型不可用，请重新选择。</p> : null}
          <p className="node-model-note">费用由所选模型卡账户承担。未配置时暂停 AI 审核。</p>
        </div>
        <footer><button type="button" onClick={() => setOpen(false)}>取消</button><button type="button" className="primary-action" disabled={disabled || loading || !valid} onClick={() => { onChange(draft); setOpen(false); }}>确定</button></footer>
      </section>
    </div>, document.body) : null}
  </>;
}
