import { useEffect, useState } from "react";
import { modelCardsApi, type ModelCard } from "../admin/modelCardsApi";

export function NodeModelSelector({ value, disabled, onChange }: {
  value: string | null;
  disabled: boolean;
  onChange: (cardId: string | null) => void;
}) {
  const [cards, setCards] = useState<ModelCard[] | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setCards(null);
    setError("");
    modelCardsApi.list().then((state) => {
      if (!cancelled) setCards(state.cards);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "读取模型卡失败");
    });
    return () => { cancelled = true; };
  }, [reload]);

  return <section className="node-model-settings" aria-label="审核模型">
    <label className="audit-script-config-field">审核模型
      <select disabled={disabled || cards === null} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">请选择自己的模型卡</option>
        {value && !cards?.some((card) => card.id === value) ? <option value={value} disabled>{cards === null ? "正在读取已选模型…" : "模型卡不可用，请重新选择"}</option> : null}
        {cards?.map((card) => <option key={card.id} value={card.id} disabled={!card.hasApiKey || !card.apiUrl || !card.model}>{card.name} · {card.model || "未填写型号"}</option>)}
      </select>
      <small>仅用于当前节点，费用由所选模型卡的 API Key 账户承担。未配置时暂停 AI 审核。</small>
    </label>
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    <div className="node-model-actions">
      <a href="/admin/models" target="_blank" rel="noopener noreferrer">管理我的模型卡 ↗</a>
      <button type="button" disabled={disabled} onClick={() => setReload((current) => current + 1)}>刷新模型卡</button>
    </div>
  </section>;
}
