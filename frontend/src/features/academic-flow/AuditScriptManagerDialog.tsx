import { useEffect, useState, type FormEvent } from "react";

import { workflowApi } from "./api";
import {
  getAuditScriptFormState,
  validateAuditScriptFileContent,
  validateAuditScriptForm,
  type AuditScriptFormMode,
} from "./auditScriptManager";
import type { AuditScriptSummary } from "./auditScripts";

type FormState = AuditScriptFormMode & { description: string; name: string };

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function languageLabel(language: AuditScriptSummary["language"]) {
  return language === "py" ? "Python" : "JavaScript";
}

export function AuditScriptManager({ onClose }: { onClose: () => void }) {
  const [scripts, setScripts] = useState<AuditScriptSummary[] | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<"javascript" | "python" | null>(null);

  const loadScripts = async () => {
    setError("");
    try {
      setScripts(await workflowApi.listAuditScripts());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "审核脚本列表读取失败，请稍后重试");
    }
  };

  useEffect(() => {
    void loadScripts();
  }, []);

  const startForm = (mode: AuditScriptFormMode) => {
    const state = getAuditScriptFormState(mode);
    setError("");
    setFile(null);
    setForm({ ...mode, description: mode.kind === "update" ? mode.script.description : "", name: state.name });
  };

  const downloadTemplate = async (language: "javascript" | "python") => {
    setDownloading(language);
    setError("");
    try {
      const blob = await workflowApi.downloadAuditScriptTemplate(language);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = language === "python" ? "audit_script_template.py" : "audit_script_template.js";
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "模板下载失败，请稍后重试");
    } finally {
      setDownloading(null);
    }
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    const validationError = validateAuditScriptForm({
      mode: form,
      name: form.name,
      description: form.description,
      file,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const contentValidationError = await validateAuditScriptFileContent(file!);
      if (contentValidationError) {
        setError(contentValidationError);
        return;
      }
      const saved = form.kind === "create"
        ? await workflowApi.uploadAuditScript(form.name.trim(), form.description.trim(), file!)
        : await workflowApi.updateAuditScript(form.script.id, form.description.trim(), file!);
      setScripts((current) =>
        form.kind === "create"
          ? [saved, ...(current ?? [])]
          : (current ?? []).map((script) => (script.id === saved.id ? saved : script)),
      );
      setForm(null);
      setFile(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存审核脚本失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) onClose();
  };

  const fileAccept = form?.kind === "update"
    ? form.script.language === "py" ? ".py" : ".js"
    : ".py,.js";

  return (
    <div className="audit-script-backdrop" onMouseDown={close}>
      <section
        aria-labelledby="audit-script-manager-title"
        aria-modal="true"
        className="audit-script-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <p>超级管理员</p>
            <h2 id="audit-script-manager-title">{form ? form.kind === "create" ? "上传审核脚本" : "更新审核脚本版本" : "文件审核脚本"}</h2>
          </div>
          <button aria-label="关闭审核脚本管理" disabled={busy} onClick={close} type="button">×</button>
        </header>

        {error ? <p className="audit-script-message error" role="alert">{error}</p> : null}

        {form ? (
          <form className="audit-script-form" onSubmit={(event) => void submitForm(event)}>
            <label>
              功能名称
              <input
                disabled={busy || form.kind === "update"}
                maxLength={120}
                onChange={(event) => setForm((current) => current ? { ...current, name: event.target.value } : current)}
                required
                value={form.name}
              />
            </label>
            <label>
              功能描述
              <textarea
                disabled={busy}
                maxLength={500}
                onChange={(event) => setForm((current) => current ? { ...current, description: event.target.value } : current)}
                required
                rows={4}
                value={form.description}
              />
              <small>{form.description.trim().length}/500</small>
            </label>
            <label>
              脚本文件{form.kind === "update" ? `（仅 ${languageLabel(form.script.language)}）` : ""}
              <input
                accept={fileAccept}
                disabled={busy}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                required
                type="file"
              />
            </label>
            <footer>
              <button disabled={busy} onClick={() => { setError(""); setForm(null); setFile(null); }} type="button">取消</button>
              <button className="primary-action" disabled={busy} type="submit">{busy ? "正在保存…" : form.kind === "create" ? "上传脚本" : "更新版本"}</button>
            </footer>
          </form>
        ) : (
          <div className="audit-script-list-view">
            <div className="audit-script-tools">
              <button disabled={downloading !== null} onClick={() => void downloadTemplate("python")} type="button">{downloading === "python" ? "下载中…" : "下载 Python 模板"}</button>
              <button disabled={downloading !== null} onClick={() => void downloadTemplate("javascript")} type="button">{downloading === "javascript" ? "下载中…" : "下载 JavaScript 模板"}</button>
              <button className="primary-action" disabled={scripts === null} onClick={() => startForm({ kind: "create" })} type="button">上传新脚本</button>
            </div>
            {scripts === null ? <p className="audit-script-empty">正在读取审核脚本…</p> : (
              <div className="audit-script-table-wrap">
                <table className="audit-script-table">
                  <thead><tr><th>功能名称</th><th>功能描述</th><th>语言</th><th>当前版本</th><th>更新时间</th><th>操作</th></tr></thead>
                  <tbody>
                    {scripts.map((script) => (
                      <tr key={script.id}>
                        <td>{script.name}</td>
                        <td>{script.description}</td>
                        <td>{languageLabel(script.language)}</td>
                        <td>v{script.version}</td>
                        <td>{formatUpdatedAt(script.updatedAt)}</td>
                        <td><button onClick={() => startForm({ kind: "update", script })} type="button">更新版本</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {scripts.length === 0 ? <p className="audit-script-empty">暂无审核脚本，请先上传脚本。</p> : null}
              </div>
            )}
            {scripts === null && error ? <button className="audit-script-retry" onClick={() => void loadScripts()} type="button">重新读取</button> : null}
          </div>
        )}
      </section>
    </div>
  );
}
