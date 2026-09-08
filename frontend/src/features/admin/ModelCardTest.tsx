import { useState } from "react";
import { modelCardsApi, type ModelCard, type ModelTestResult } from "./modelCardsApi";

export function ModelCardTest({ card, disabled }: { card: ModelCard; disabled: boolean }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [open, setOpen] = useState(false);
  const run = async () => {
    if (loading) return;
    setLoading(true); setOpen(false); setResult(null);
    try { setResult(await modelCardsApi.test(card)); }
    catch (err) { setResult({ success: false, detail: err instanceof Error ? err.message : "测试请求失败", elapsedMs: null }); }
    finally { setLoading(false); }
  };
  return <div className="model-test-control" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" className="model-test-button" disabled={disabled || loading || !card.hasApiKey} onClick={() => void run()} title="使用已保存配置发送简短文本，可能产生少量调用费用">{loading ? "测试中…" : "测试"}</button>
    {result?.success ? <span className="model-test-result is-success" role="status" title={result.detail}>✓{result.elapsedMs !== null ? ` ${(result.elapsedMs / 1000).toFixed(2)}s` : ""}</span> : null}
    {result && !result.success ? <button type="button" className="model-test-result is-error" aria-expanded={open} onClick={() => setOpen(!open)}>! 测试失败</button> : null}
    {open && result && !result.success ? <div className="model-card-popover model-test-error" role="status">{result.detail}</div> : null}
  </div>;
}
