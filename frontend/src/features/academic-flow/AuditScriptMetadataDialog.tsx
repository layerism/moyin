import { useEffect, useState } from "react";

import { ApiError, workflowApi } from "./api";
import { AuditScriptConfigForm } from "./AuditScriptConfigForm";
import {
  createParameterDefaultDraft,
  createRuntimeSettingDraft,
  getAuditScriptConfigErrors,
  type AuditScriptConfigDetail,
  type AuditScriptManagementSummary,
  type AuditScriptValue,
} from "./auditScriptConfig";

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

export function AuditScriptMetadataDialog({ onClose }: { onClose: () => void }) {
  const [scripts, setScripts] = useState<AuditScriptManagementSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<AuditScriptManagementSummary | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [detail, setDetail] = useState<AuditScriptConfigDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [parameterDefaults, setParameterDefaults] = useState<Record<string, AuditScriptValue>>({});
  const [runtimeSettings, setRuntimeSettings] = useState<Record<string, AuditScriptValue>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const loadScripts = () => {
    setScripts(null);
    setLoadError("");
    workflowApi
      .listManageableAuditScripts()
      .then(setScripts)
      .catch((error) => {
        setScripts([]);
        setLoadError(error instanceof Error ? error.message : "读取审核脚本失败");
      });
  };

  useEffect(loadScripts, []);

  const startEditing = (script: AuditScriptManagementSummary) => {
    setEditing(script);
    setName(script.name);
    setDescription(script.description);
    setSaveError("");
    setSaveNotice("");
  };

  const saveMetadata = async () => {
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
          .map((script) => script.id === updated.id
            ? { ...script, description: updated.description, name: updated.name, updatedAt: updated.updatedAt }
            : script)
          .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
      );
      setEditing(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存审核脚本元信息失败");
    } finally {
      setSaving(false);
    }
  };

  const startConfiguring = async (script: AuditScriptManagementSummary) => {
    setDetailLoading(true);
    setSaveError("");
    setSaveNotice("");
    try {
      const nextDetail = await workflowApi.getAuditScriptConfig(script.id);
      setDetail(nextDetail);
      setParameterDefaults(createParameterDefaultDraft(nextDetail));
      setRuntimeSettings(createRuntimeSettingDraft(nextDetail));
      setFieldErrors({});
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "读取脚本配置失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const updateDraft = (
    target: "parameter" | "setting",
    key: string,
    value: AuditScriptValue,
  ) => {
    if (target === "parameter") {
      setParameterDefaults((current) => ({ ...current, [key]: value }));
    } else {
      setRuntimeSettings((current) => ({ ...current, [key]: value }));
    }
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`${target}:${key}`];
      return next;
    });
    setSaveError("");
    setSaveNotice("");
  };

  const saveConfig = async () => {
    if (!detail) return;
    const errors = getAuditScriptConfigErrors(detail, parameterDefaults, runtimeSettings);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError("请先修正标红的配置项");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveNotice("");
    try {
      const updated = await workflowApi.updateAuditScriptConfig(detail.id, {
        expectedConfigSha256: detail.configSha256,
        parameterDefaults,
        runtimeSettings,
      });
      setDetail(updated);
      setParameterDefaults(createParameterDefaultDraft(updated));
      setRuntimeSettings(createRuntimeSettingDraft(updated));
      setScripts((current) => (current ?? []).map((script) =>
        script.id === updated.id ? { ...script, updatedAt: updated.updatedAt } : script
      ));
      setSaveNotice("配置已保存");
    } catch (error) {
      setSaveError(
        error instanceof ApiError && error.status === 409
          ? "配置已被其他管理员修改，请重新加载"
          : error instanceof Error
            ? error.message
            : "保存审核脚本配置失败",
      );
    } finally {
      setSaving(false);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setSaveError("");
    setSaveNotice("");
    setFieldErrors({});
  };

  const hasEditableConfig = Boolean(
    detail && (detail.parameters.length > 0 || detail.runtimeSettings.length > 0),
  );

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
              {editing ? "编辑审核脚本" : detail ? "脚本配置" : "审核脚本管理"}
            </h2>
          </div>
          <button aria-label="关闭审核脚本管理" disabled={saving} onClick={onClose} type="button">×</button>
        </header>

        {editing ? (
          <form
            className="audit-script-metadata-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveMetadata();
            }}
          >
            <p>{editing.language === "py" ? "Python" : "JavaScript"} · v1 · {editing.id}</p>
            <label>
              <span>功能名称</span>
              <input autoFocus disabled={saving} maxLength={120} onChange={(event) => {
                setName(event.target.value);
                setSaveError("");
              }} value={name} />
            </label>
            <label>
              <span>功能说明</span>
              <textarea disabled={saving} maxLength={500} onChange={(event) => {
                setDescription(event.target.value);
                setSaveError("");
              }} rows={5} value={description} />
            </label>
            {saveError ? <p className="dialog-error" role="alert">{saveError}</p> : null}
            <footer>
              <button disabled={saving} onClick={() => setEditing(null)} type="button">取消</button>
              <button className="primary-action" disabled={saving} type="submit">{saving ? "保存中…" : "保存"}</button>
            </footer>
          </form>
        ) : detail ? (
          <form className="audit-script-metadata-form audit-script-config-form" onSubmit={(event) => {
            event.preventDefault();
            void saveConfig();
          }}>
            <div className="audit-script-config-heading">
              <strong>{detail.name}</strong>
              <p>{detail.description}</p>
              <small>{detail.language === "py" ? "Python" : "JavaScript"} · v1 · {detail.id}</small>
            </div>
            <AuditScriptConfigForm
              disabled={saving}
              errors={fieldErrors}
              onParameterChange={(key, value) => updateDraft("parameter", key, value)}
              onSettingChange={(key, value) => updateDraft("setting", key, value)}
              parameterDefaults={parameterDefaults}
              parameters={detail.parameters}
              runtimeSettings={detail.runtimeSettings}
              settingValues={runtimeSettings}
            />
            {hasEditableConfig ? <p className="audit-script-config-warning">
              配置变更会更新脚本 v1 哈希；已有预览需重新打开，已发布流程需重新发布。
            </p> : null}
            {saveError ? <p className="dialog-error" role="alert">{saveError}</p> : null}
            {saveNotice ? <p className="audit-script-config-success" role="status">{saveNotice}</p> : null}
            <footer>
              <button disabled={saving} onClick={closeDetail} type="button">返回</button>
              {hasEditableConfig ? <button className="primary-action" disabled={saving} type="submit">
                {saving ? "保存中…" : "保存配置"}
              </button> : null}
            </footer>
          </form>
        ) : (
          <div className="audit-script-metadata-content">
            {detailLoading ? <p className="audit-script-metadata-state">正在读取脚本配置…</p> : null}
            {!detailLoading && scripts === null ? <p className="audit-script-metadata-state">正在读取审核脚本…</p> : null}
            {saveError && !detailLoading ? <p className="dialog-error" role="alert">{saveError}</p> : null}
            {loadError ? <div className="audit-script-metadata-state" role="alert">
              <p>{loadError}</p>
              <button onClick={loadScripts} type="button">重新读取</button>
            </div> : null}
            {!detailLoading && scripts?.length === 0 && !loadError ? (
              <p className="audit-script-metadata-state">`backend/scripts` 下暂无有效审核脚本。</p>
            ) : null}
            {!detailLoading && scripts && scripts.length > 0 ? <div className="audit-script-metadata-list">
              {scripts.map((script) => {
                const configurableCount = script.parameterCount + script.runtimeSettingCount;
                return <article key={script.id}>
                  <div>
                    <strong>{script.name}</strong>
                    <p>{script.description}</p>
                    <small>
                      {script.language === "py" ? "Python" : "JavaScript"} · v1 ·
                      {configurableCount > 0 ? ` ${configurableCount} 项可调配置 ·` : " 暂无可调参数 ·"}
                      更新于 {formatUpdatedAt(script.updatedAt)}
                    </small>
                  </div>
                  <div className="audit-script-metadata-actions">
                    {script.metadataEditable ? <button onClick={() => startEditing(script)} type="button">编辑信息</button> : null}
                    <button onClick={() => void startConfiguring(script)} type="button">
                      {configurableCount > 0 ? "配置" : "查看"}
                    </button>
                  </div>
                </article>;
              })}
            </div> : null}
          </div>
        )}
      </section>
    </div>
  );
}
