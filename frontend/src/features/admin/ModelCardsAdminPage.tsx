import { ModelNamePicker } from "./ModelNamePicker";
import { ModelCardTest } from "./ModelCardTest";
import { ModelCardBalance } from "./ModelCardBalance";
import { VendorLogo } from "./VendorLogo";
import { ModelThinkingFields, thinkingLabel } from "./ModelThinkingFields";
import { useEffect, useRef, useState } from "react";
import type { AuthIdentity } from "../auth/authApi";
import { MODEL_VENDORS, modelCardsApi, modelConsoleUrl, type ModelCard, type ModelCardDraft, type ModelCardsState, type ModelVendor } from "./modelCardsApi";

const vendorName = (id: ModelVendor) => MODEL_VENDORS.find((vendor) => vendor.id === id)?.name ?? "自定义";
const emptyDraft: ModelCardDraft = { vendor: "custom", name: "", apiUrl: "", apiKey: "", billingAccessKey: "", billingSecretKey: "", billingConsoleToken: "", clearBilling: false, model: "", revision: 0, thinking: { mode: "default", effort: "default", budget: null } };

export function ModelCardsAdminPage({ identity, onBack }: { identity: AuthIdentity; onBack: () => void }) {
  const [data, setData] = useState<ModelCardsState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{ card: ModelCard | null; draft: ModelCardDraft } | null>(null);
  const [editorError, setEditorError] = useState("");
  const [deleting, setDeleting] = useState<ModelCard | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const modalOpen = editor !== null || deleting !== null;
  const accept = (state: ModelCardsState) => {
    setData(state);
  };
  const load = () => {
    setLoading(true);
    setError("");
    modelCardsApi.list().then(accept).catch((err: unknown) => setError(err instanceof Error ? err.message : "读取失败")).finally(() => setLoading(false));
  };
  useEffect(() => { if (identity.role === "super_admin") load(); }, [identity.role]);
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { setEditor(null); setDeleting(null); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']") ?? []);
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [modalOpen, busy]);
  const openEditor = (card: ModelCard | null) => {
    setEditorError("");
    setEditor({ card, draft: card ? { vendor: card.vendor, name: card.name, apiUrl: card.apiUrl, apiKey: "", billingAccessKey: "", billingSecretKey: "", billingConsoleToken: "", clearBilling: false, model: card.model, revision: card.revision, thinking: card.thinking } : { ...emptyDraft } });
  };
  const save = async () => {
    if (!editor || busy) return;
    setBusy(true); setEditorError("");
    try {
      accept(await modelCardsApi.save(editor.card?.id ?? null, editor.draft));
      setEditor(null); setError(""); setNotice("模型卡已保存，对新启动的审核生效。");
    } catch (err) { setEditorError(err instanceof Error ? err.message : "保存失败"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleting || busy) return;
    setBusy(true); setEditorError("");
    try { accept(await modelCardsApi.delete(deleting)); setDeleting(null); setNotice("模型卡已删除。"); }
    catch (err) { setEditorError(err instanceof Error ? err.message : "删除失败"); }
    finally { setBusy(false); }
  };
  if (identity.role !== "super_admin") return <main className="database-admin-denied"><h1>仅超级管理员可访问</h1><button onClick={onBack} type="button">返回</button></main>;
  return <main className="model-admin-page">
    <header className="database-admin-header"><div><strong>大模型配置</strong><small>管理模型连接、思考模式与档位</small></div><button disabled={busy} onClick={onBack} type="button">返回教务流程</button></header>
    <div className="model-admin-content">
      <section className="model-admin-toolbar"><div><h1>模型卡</h1><p>仅支持 OpenAI Chat Completions 格式</p></div><div className="model-admin-actions"><button disabled={busy || loading} onClick={load} type="button">刷新</button><button className="primary-action" disabled={busy || loading} onClick={() => openEditor(null)} type="button"><span aria-hidden="true">＋</span> 新增模型</button></div></section>
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
      {notice ? <p className="model-admin-notice" role="status">{notice}</p> : null}
      {loading ? <p role="status">正在读取模型配置…</p> : null}
      {!loading && data?.cards.length === 0 ? <div className="model-admin-empty"><h2>还没有模型卡</h2><p>添加模型连接后，即可供审核脚本选择。</p></div> : null}
      <div className="model-card-grid">
        {data?.cards.map((card) => {
          const consoleUrl = modelConsoleUrl(card);
          const uses = data.bindings.filter((binding) => binding.cardId === card.id);
          const ready = card.hasApiKey && Boolean(card.apiUrl && card.model);
          return <article className="model-card" key={card.id}>
            <header><VendorLogo vendor={card.vendor} /><div>{consoleUrl ? <a className="model-console-link" href={consoleUrl} target="_blank" rel="noopener noreferrer" title="打开厂商控制台"><h2>{card.name} <span aria-hidden="true">↗</span></h2><span>{vendorName(card.vendor)}</span></a> : <><h2>{card.name}</h2><span>{vendorName(card.vendor)}</span></>}</div><div className="model-card-header-actions"><span className={`model-card-status${ready ? " is-ready" : ""}`}>{ready ? "已配置" : "待完善"}</span><ModelCardTest key={`${card.id}:${card.revision}`} card={card} disabled={busy || loading || !ready} /></div></header>
            <dl><div><dt>模型</dt><dd title={card.model}>{card.model || "未填写"}</dd></div><div><dt>思考</dt><dd>{thinkingLabel(card.thinking, card.thinkingProfile)}</dd></div></dl>
            <div className="model-card-usage">{uses.length ? uses.map((binding) => <span key={binding.scriptId}>{binding.name}</span>) : <small>暂未用于审核脚本</small>}</div>
            <ModelCardBalance key={`${card.id}:${card.revision}`} card={card} />
            <footer><button type="button" disabled={busy || loading} onClick={() => openEditor(card)}>编辑配置</button><button className="model-delete" type="button" disabled={busy || loading || uses.length > 0} title={uses.length ? "请先更换审核脚本使用的模型" : "删除模型卡"} onClick={() => { setEditorError(""); setDeleting(card); }}>删除</button></footer>
          </article>;
        })}
      </div>
    </div>
    {editor ? <div className="modal-backdrop model-card-backdrop"><section ref={dialogRef} className="model-card-dialog model-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="model-editor-title"><header><div><h2 id="model-editor-title">{editor.card ? "编辑模型卡" : "新增模型卡"}</h2><p>OpenAI Chat Completions</p></div><button type="button" disabled={busy} aria-label="关闭" onClick={() => setEditor(null)}>×</button></header>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="model-editor-body">
        <fieldset disabled={busy}><legend>选择厂商</legend><div className="model-vendor-options">{MODEL_VENDORS.map((vendor) => <button key={vendor.id} type="button" aria-pressed={editor.draft.vendor === vendor.id} onClick={() => { if (editor.draft.vendor !== vendor.id) setEditor({ ...editor, draft: { ...editor.draft, vendor: vendor.id, billingAccessKey: "", billingSecretKey: "", billingConsoleToken: "", clearBilling: false, thinking: { ...emptyDraft.thinking } } }); }}><VendorLogo vendor={vendor.id} /><span>{vendor.name}</span></button>)}</div></fieldset>
        <section className="model-editor-connection" aria-labelledby="model-connection-title">
          <h3 id="model-connection-title">连接配置</h3>
          <div className="model-editor-name-row">
        <label className="audit-script-config-field">配置名称<input autoComplete="off" required maxLength={100} placeholder="例如：材料视觉审核" disabled={busy} value={editor.draft.name} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, name: event.target.value } })} /></label>
        <ModelNamePicker key={JSON.stringify([editor.card?.id, editor.draft.vendor, editor.draft.apiUrl, editor.draft.apiKey])} cardId={editor.card?.id ?? null} draft={editor.draft} disabled={busy} onChange={(model) => setEditor({ ...editor, draft: { ...editor.draft, model, thinking: { ...emptyDraft.thinking } } })} />
          </div>
        <label className="audit-script-config-field">Base URL<input type="url" required maxLength={2048} placeholder="填写兼容接口的基础地址" disabled={busy} value={editor.draft.apiUrl} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, apiUrl: event.target.value } })} /><small>保留版本路径，系统自动添加 /chat/completions。</small></label>
        <label className="audit-script-config-field">API Key<input type="password" autoComplete="new-password" required={!editor.card?.hasApiKey} maxLength={4096} placeholder={editor.card?.hasApiKey ? "留空保留原密钥，输入新密钥替换" : "填写 API Key"} disabled={busy} value={editor.draft.apiKey} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, apiKey: event.target.value } })} /></label>
        </section>
        {["doubao", "zhipu"].includes(editor.draft.vendor) ? <section className="model-editor-connection model-billing-fields" aria-labelledby="model-billing-title">
          <h3 id="model-billing-title">财务凭据 <small>{editor.card?.vendor === editor.draft.vendor && editor.card.hasBillingCredentials ? "已保存" : "可选"}</small></h3>
          {editor.draft.vendor === "doubao" ? <>
          <p>仅查询火山云账户余额；填写具有余额查询权限的 AK/SK。两项留空保留原凭据。</p>
          <div className="model-editor-name-row">
            <label className="audit-script-config-field">Access Key ID<input type="password" autoComplete="new-password" maxLength={256} disabled={busy || editor.draft.clearBilling} value={editor.draft.billingAccessKey} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, billingAccessKey: event.target.value } })} placeholder="填写或替换 AK" /></label>
            <label className="audit-script-config-field">Secret Access Key<input type="password" autoComplete="new-password" maxLength={4096} disabled={busy || editor.draft.clearBilling} value={editor.draft.billingSecretKey} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, billingSecretKey: event.target.value } })} placeholder="填写或替换 SK" /></label>
          </div>
          </> : <>
            <p>使用控制台登录 Token 查询现金余额，过期后需更新。</p>
            <label className="audit-script-config-field">控制台 Token<input type="password" autoComplete="new-password" maxLength={8192} disabled={busy || editor.draft.clearBilling} value={editor.draft.billingConsoleToken} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, billingConsoleToken: event.target.value } })} placeholder="留空保留原 Token，输入新值替换" /><small>登录智谱控制台，在浏览器开发者工具的 Cookie 中复制 bigmodel_token_production 的值，不加 Bearer。</small></label>
          </>}
          {editor.card?.vendor === editor.draft.vendor && editor.card.hasBillingCredentials ? <label className="model-billing-clear"><input type="checkbox" disabled={busy} checked={editor.draft.clearBilling} onChange={(event) => setEditor({ ...editor, draft: { ...editor.draft, clearBilling: event.target.checked, billingAccessKey: "", billingSecretKey: "", billingConsoleToken: "" } })} />保存时清除财务凭据</label> : null}
        </section> : null}
        <ModelThinkingFields vendor={editor.draft.vendor} model={editor.draft.model} value={editor.draft.thinking} disabled={busy} onChange={(thinking) => setEditor({ ...editor, draft: { ...editor.draft, thinking } })} />
        {editorError ? <p className="dialog-error" role="alert">{editorError}</p> : null}
        </div>
        <footer><button type="button" disabled={busy} onClick={() => setEditor(null)}>取消</button><button className="primary-action" type="submit" disabled={busy}>{busy ? "保存中…" : "保存模型卡"}</button></footer>
      </form></section></div> : null}
    {deleting ? <div className="modal-backdrop model-card-backdrop"><section ref={dialogRef} className="model-card-dialog model-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="model-delete-title"><h2 id="model-delete-title">删除模型卡</h2><p>确定删除“{deleting.name}”及其保存的连接配置？</p>{editorError ? <p className="dialog-error" role="alert">{editorError}</p> : null}<footer><button disabled={busy} onClick={() => setDeleting(null)} type="button">取消</button><button disabled={busy} className="model-delete" onClick={() => void remove()} type="button">确认删除</button></footer></section></div> : null}
  </main>;
}
