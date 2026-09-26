import { useEffect, useRef, useState } from "react";
import { modelCardsApi, type ModelBalance, type ModelCard } from "./modelCardsApi";

const amountFormat = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
function formatAmount(value: string): string {
  const amount = Number(value);
  return value.trim() && Number.isFinite(amount) ? amountFormat.format(amount) : value;
}

export function ModelCardBalance({ card }: { card: ModelCard }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target as Node)) details.open = false;
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      const details = detailsRef.current;
      if (event.key === "Escape" && details?.open) {
        const restoreFocus = details.contains(document.activeElement);
        details.open = false;
        if (restoreFocus) details.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, []);
  const [result, setResult] = useState<ModelBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const query = async () => {
    if (loading) return;
    setLoading(true); setError("");
    try { setResult(await modelCardsApi.balance(card)); }
    catch (err) { setError(err instanceof Error ? err.message : "余额查询失败"); }
    finally { setLoading(false); }
  };
  const capability = card.balanceCapability;
  const summary = loading ? "查询中…" : error ? "查询失败" : result ? result.balances.map((item) => `${formatAmount(item.available)} ${item.currency}`).join(" / ") : capability.supported ? "未查询" : ["doubao", "zhipu", "minimax"].includes(card.vendor) ? "待配财务凭据" : "暂未接入";
  return <section className="model-card-balance" aria-label="账户余额">
    <span>账户余额</span>
    <details ref={detailsRef} className="model-balance-info">
      <summary className={error ? "is-error" : ""} title={summary} aria-label={`账户余额：${summary}，点击查看详情`}>{summary}</summary>
      <div className="model-card-popover">
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        {result ? <>{result.balances.map((balance, index) => <div key={index}><strong>{formatAmount(balance.available)} {balance.currency}</strong>
          {(balance.details ?? [{ label: "充值 / 现金", value: balance.cash ?? "—" }, { label: "赠金 / 代金券", value: balance.credit ?? "—" }]).map((item) => <small key={item.label}>{item.label}：{formatAmount(item.value)}</small>)}
        </div>)}<small>{error || loading ? "上次成功查询" : "查询时间"}：{new Date(result.checkedAt).toLocaleString("zh-CN")}</small></> : null}
        <small>{result && !result.available ? "账户余额不足。" : ""}{capability.reason}</small>
      </div>
    </details>
    {capability.supported ? <button className="model-balance-refresh" type="button" disabled={loading} aria-label={result ? "更新余额" : "查看余额"} title={result ? "更新余额" : "查看余额"} onClick={() => void query()}>↻</button> : <span className="model-balance-placeholder" />}
  </section>;
}
