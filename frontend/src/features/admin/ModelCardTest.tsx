import { useState } from "react";
import { modelCardsApi, type ModelCard, type ModelTestResult } from "./modelCardsApi";

export function ModelCardTest({ card, disabled }: { card: ModelCard; disabled: boolean }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [open, setOpen] = useState(false);
  const run = async () => {
    if (loading) return;
    setLoading(true); setOpen(false);
    try { setResult(await modelCardsApi.test(card)); }
    catch (err) { setResult({ success: false, detail: err instanceof Error ? err.message : "测试请求失败", elapsedMs: null }); }
    finally { setLoading(false); setOpen(true); }
  };
  return <div className="model-test-control" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" className="model-test-button" disabled={disabled || loading || !card.hasApiKey} onClick={() => void run()} title="使用已保存配置发送简短文本，可能产生少量调用费用">{loading ? "测试中…" : "测试"}</button>
    {result ? <button type="button" className={`model-test-result${result.success ? " is-success" : " is-error"}`} aria-label="查看测试结果" aria-expanded={open} onClick={() => setOpen(!open)}>{result.success ? "✓" : "!"}</button> : null}
    {open && result ? <div className="model-card-popover" role="status"><strong>{result.success ? "测试通过" : "测试失败"}{result.elapsedMs !== null ? ` · ${(result.elapsedMs / 1000).toFixed(2)} 秒` : ""}</strong><p>{result.detail}</p><small>文本连通性测试，不验证图片输入或审核效果。</small><button type="button" onClick={() => setOpen(false)}>关闭</button></div> : null}
  </div>;
}
