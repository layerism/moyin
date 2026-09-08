import { useState } from "react";
import { modelCardsApi, type ModelBalance, type ModelCard } from "./modelCardsApi";

export function ModelCardBalance({ card }: { card: ModelCard }) {
  const [result, setResult] = useState<ModelBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const query = async () => {
    if (loading) return;
    setLoading(true); setError(""); setResult(null);
    try { setResult(await modelCardsApi.balance(card)); }
    catch (err) { setError(err instanceof Error ? err.message : "余额查询失败"); }
    finally { setLoading(false); }
  };
  const capability = card.balanceCapability;
  return <section className="model-card-balance" aria-label="账户余额">
    <div className="model-balance-heading"><span>账户余额</span>{capability.supported ? <button type="button" disabled={loading || !card.hasApiKey} onClick={() => void query()}>{loading ? "查询中…" : result ? "更新余额" : "查看余额"}</button> : <span title={capability.reason}>暂未接入</span>}</div>
    {!capability.supported ? <small>{capability.reason}</small> : null}
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    {result ? <div aria-live="polite">
      {result.balances.map((balance, index) => <div key={`${balance.currency}-${index}`} className="model-balance-detail">
        <strong>{balance.available} <small>{balance.currency}</small></strong>
        <small>充值 / 现金 {balance.cash} · 赠金 / 代金券 {balance.credit}</small>
      </div>)}
      {!result.available ? <p className="dialog-error">账户余额不足</p> : null}
      <small>查询于 {new Date(result.checkedAt).toLocaleString("zh-CN")} · 同账户共享</small>
    </div> : null}
  </section>;
}
