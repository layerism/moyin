import { useEffect, useState } from "react";

import { workflowApi } from "./api";
import type { AuditScriptSummary } from "./auditScripts";

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

export function AuditScriptMetadataDialog({ onClose }: { onClose: () => void }) {
  const [scripts, setScripts] = useState<AuditScriptSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<AuditScriptSummary | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadScripts = () => {
    setScripts(null);
    setLoadError("");
    workflowApi
      .listAuditScripts()
      .then(setScripts)
      .catch((error) => {
        setScripts([]);
        setLoadError(error instanceof Error ? error.message : "读取审核脚本失败");
      });
  };

  useEffect(loadScripts, []);

  const startEditing = (script: AuditScriptSummary) => {
    setEditing(script);
    setName(script.name);
    setDescription(script.description);
    setSaveError("");
  };

  const save = async () => {
    if (!editing) return;
    const nextName = name.trim();
    const nextDescription = description.trim();
    if (!nextName || !nextDescription) {
      setSaveError("名称和功能说明均不能为空");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const updated = await workflowApi.updateAuditScriptMetadata(editing.id, {
        name: nextName,
        description: nextDescription,
      });
      setScripts((current) =>
        (current ?? [])
          .map((script) => (script.id === updated.id ? updated : script))
          .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
      );
      setEditing(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存审核脚本元信息失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop audit-script-metadata-backdrop" onClick={saving ? undefined : onClose}>
      <section
        aria-labelledby="audit-script-metadata-title"
        aria-modal="true"
        className="audit-script-metadata-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span>预置脚本</span>
            <h2 id="audit-script-metadata-title">
              {editing ? "编辑审核脚本" : "审核脚本管理"}
            </h2>
          </div>
          <button aria-label="关闭审核脚本管理" disabled={saving} onClick={onClose} type="button">
            ×
          </button>
        </header>

        {editing ? (
          <form
            className="audit-script-metadata-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <p>
              {editing.language === "py" ? "Python" : "JavaScript"} · v{editing.version} · {editing.id}
            </p>
            <label>
              <span>功能名称</span>
              <input
                autoFocus
                disabled={saving}
                maxLength={120}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaveError("");
                }}
                value={name}
              />
            </label>
            <label>
              <span>功能说明</span>
              <textarea
                disabled={saving}
                maxLength={500}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setSaveError("");
                }}
                rows={5}
                value={description}
              />
            </label>
            {saveError ? <p className="dialog-error" role="alert">{saveError}</p> : null}
            <footer>
              <button disabled={saving} onClick={() => setEditing(null)} type="button">取消</button>
              <button className="primary-action" disabled={saving} type="submit">
                {saving ? "保存中…" : "保存"}
              </button>
            </footer>
          </form>
        ) : (
          <div className="audit-script-metadata-content">
            {scripts === null ? <p className="audit-script-metadata-state">正在读取审核脚本…</p> : null}
            {loadError ? (
              <div className="audit-script-metadata-state" role="alert">
                <p>{loadError}</p>
                <button onClick={loadScripts} type="button">重新读取</button>
              </div>
            ) : null}
            {scripts?.length === 0 && !loadError ? (
              <p className="audit-script-metadata-state">`backend/scripts` 下暂无有效审核脚本。</p>
            ) : null}
            {scripts && scripts.length > 0 ? (
              <div className="audit-script-metadata-list">
                {scripts.map((script) => (
                  <article key={script.id}>
                    <div>
                      <strong>{script.name}</strong>
                      <p>{script.description}</p>
                      <small>
                        {script.language === "py" ? "Python" : "JavaScript"} · v{script.version} ·
                        更新于 {formatUpdatedAt(script.updatedAt)}
                      </small>
                    </div>
                    <button onClick={() => startEditing(script)} type="button">编辑</button>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
