import { useEffect, useState } from "react";
import { workflowApi } from "./api";

export interface ModelConnection {
  provider: "document" | "vision";
  apiUrl: string;
  hasApiKey: boolean;
  model: string;
  revision: number;
}

export function ModelConnectionsForm({ onBack, onSavingChange }: {
  onBack: () => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const [connections, setConnections] = useState<ModelConnection[] | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = () => {
    setError("");
    setMessage("");
    setKeys({});
    setConnections(null);
    workflowApi.listModelConnections().then(setConnections).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "读取配置失败");
    });
  };
  useEffect(load, []);
  const update = (provider: string, field: "apiUrl" | "model", value: string) => {
    setConnections((current) => current?.map((item) => item.provider === provider ? { ...item, [field]: value } : item) ?? null);
    setMessage("");
    setError("");
  };
  const save = async (item: ModelConnection) => {
    setSaving(true);
    onSavingChange(true);
    setError("");
    setMessage("");
    try {
      const saved = await workflowApi.updateModelConnection(item, keys[item.provider] ?? "");
      setConnections((current) => current?.map((entry) => entry.provider === saved.provider ? saved : entry) ?? null);
      setKeys((current) => ({ ...current, [item.provider]: "" }));
      setMessage(`${item.provider === "document" ? "文档" : "视觉"}审核连接已保存`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存配置失败");
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  };
  return <div className="audit-script-metadata-form audit-script-config-form model-connections-form">
    <p>配置供对应审核脚本共用，保存后对新启动的审核生效。API Key 留空表示保留已保存的密钥。</p>
    {connections === null && !error ? <p>正在读取配置…</p> : null}
    {connections?.map((item) => <form key={item.provider} className="audit-script-basic-section" onSubmit={(event) => { event.preventDefault(); void save(item); }}>
      <div><h3>{item.provider === "document" ? "文档审核" : "视觉审核"}</h3>
        <p>{item.provider === "vision" ? "模型名称和请求超时在对应审核脚本中设置。" : "用于文档内容审核的大模型连接。"}</p></div>
      <label className="audit-script-config-field"><span>{item.provider === "vision" ? "接口基础地址（Base URL）" : "接口地址（API URL）"}</span>
        <input type="url" required maxLength={2048} value={item.apiUrl} disabled={saving} onChange={(event) => update(item.provider, "apiUrl", event.target.value)} /></label>
      <label className="audit-script-config-field"><span>API Key · {item.hasApiKey ? "已配置" : "未配置"}</span>
        <input type="password" autoComplete="new-password" required={!item.hasApiKey} maxLength={4096} value={keys[item.provider] ?? ""} disabled={saving} placeholder={item.hasApiKey ? "留空保留，输入新密钥替换" : "请输入 API Key"} onChange={(event) => { setKeys((current) => ({ ...current, [item.provider]: event.target.value })); setMessage(""); }} /></label>
      {item.provider === "document" ? <label className="audit-script-config-field"><span>模型名称</span><input required maxLength={200} value={item.model} disabled={saving} onChange={(event) => update(item.provider, "model", event.target.value)} /></label> : null}
      <footer><button className="primary-action" disabled={saving} type="submit">{saving ? "保存中…" : "保存连接"}</button></footer>
    </form>)}
    {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <footer><button type="button" disabled={saving} onClick={onBack}>返回</button><button type="button" disabled={saving} onClick={load}>重新读取</button></footer>
  </div>;
}
