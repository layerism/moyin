import { useEffect, useState } from "react";

import { ApiError, workflowApi } from "./api";
import { AuditScriptConfigForm } from "./AuditScriptConfigForm";
import {
  createParameterDefaultDraft,
  createRuntimeSettingDraft,
  getAuditScriptConfigErrors,
  hasAuditScriptConfigChanges,
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
  const [detail, setDetail] = useState<AuditScriptConfigDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parameterDefaults, setParameterDefaults] = useState<Record<string, AuditScriptValue>>({});
  const [runtimeSettings, setRuntimeSettings] = useState<Record<string, AuditScriptValue>>({});
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [partialSaveNotice, setPartialSaveNotice] = useState("");
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

  const clearSaveMessages = () => {
    setSaveError("");
    setSaveNotice("");
    setPartialSaveNotice("");
  };

  const openEditor = async (script: AuditScriptManagementSummary) => {
    setDetailLoading(true);
    clearSaveMessages();
    try {
      const nextDetail = await workflowApi.getAuditScriptConfig(script.id);
      setDetail(nextDetail);
      setName(nextDetail.name);
      setDescription(nextDetail.description);
      setParameterDefaults(createParameterDefaultDraft(nextDetail));
      setRuntimeSettings(createRuntimeSettingDraft(nextDetail));
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
    clearSaveMessages();
  };

  const metadataChanged = Boolean(
    detail?.metadataEditable
    && (name.trim() !== detail.name || description.trim() !== detail.description),
  );
  const configChanged = detail
    ? hasAuditScriptConfigChanges(detail, parameterDefaults, runtimeSettings)
    : false;
  const configErrors = detail
    ? getAuditScriptConfigErrors(detail, parameterDefaults, runtimeSettings)
    : {};
  const nameError = Boolean(detail?.metadataEditable && !name.trim());
  const descriptionError = Boolean(detail?.metadataEditable && !description.trim());
  const metadataValid = !nameError && !descriptionError;
  const canSave = (metadataChanged || configChanged)
    && metadataValid
    && Object.keys(configErrors).length === 0
    && !saving;

  const saveChanges = async () => {
    if (!detail || !canSave) return;
    setSaving(true);
    clearSaveMessages();
    let currentDetail = detail;
    let configSaved = false;
    try {
      if (configChanged) {
        const updatedConfig = await workflowApi.updateAuditScriptConfig(detail.id, {
          expectedConfigSha256: detail.configSha256,
          parameterDefaults,
          runtimeSettings,
        });
        currentDetail = updatedConfig;
        configSaved = true;
        setDetail(updatedConfig);
        setParameterDefaults(createParameterDefaultDraft(updatedConfig));
        setRuntimeSettings(createRuntimeSettingDraft(updatedConfig));
        setScripts((current) => (current ?? []).map((script) =>
          script.id === updatedConfig.id
            ? { ...script, updatedAt: updatedConfig.updatedAt }
            : script
        ));
      }

      if (metadataChanged) {
        const updatedMetadata = await workflowApi.updateAuditScriptMetadata(detail.id, {
          name: name.trim(),
          description: description.trim(),
        });
        currentDetail = {
          ...currentDetail,
          name: updatedMetadata.name,
          description: updatedMetadata.description,
          updatedAt: updatedMetadata.updatedAt,
        };
        setDetail(currentDetail);
        setName(updatedMetadata.name);
        setDescription(updatedMetadata.description);
        setScripts((current) =>
          (current ?? [])
            .map((script) => script.id === updatedMetadata.id
              ? {
                  ...script,
                  description: updatedMetadata.description,
                  name: updatedMetadata.name,
                  updatedAt: updatedMetadata.updatedAt,
                }
              : script)
            .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
        );
      }

      setSaveNotice("修改已保存");
    } catch (error) {
      const message = error instanceof ApiError && error.status === 409 && configChanged && !configSaved
        ? "配置已被其他管理员修改，请重新加载"
        : error instanceof Error
          ? error.message
          : "保存审核脚本失败";
      if (configSaved) {
        setPartialSaveNotice(`运行配置已保存，但基本信息保存失败：${message}`);
      } else {
        setSaveError(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    clearSaveMessages();
  };

  const hasEditableConfig = Boolean(
    detail && (detail.parameters.length > 0 || detail.runtimeSettings.length > 0),
  );
  const hasEditableContent = Boolean(detail?.metadataEditable || hasEditableConfig);

  return (
    <div className="modal-backdrop audit-script-metadata-backdrop">
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
              {detail ? (hasEditableContent ? "编辑审核脚本" : "查看审核脚本") : "审核脚本管理"}
            </h2>
          </div>
          <button aria-label="关闭审核脚本管理" disabled={saving} onClick={onClose} type="button">×</button>
        </header>

        {detail ? (
          <form className="audit-script-metadata-form audit-script-config-form" onSubmit={(event) => {
            event.preventDefault();
            void saveChanges();
          }}>
            <div className="audit-script-config-heading">
              <small>{detail.language === "py" ? "Python" : "JavaScript"} · v1 · {detail.id}</small>
            </div>

            <section className="audit-script-basic-section">
              <div>
                <h3>基本信息</h3>
                <p>{detail.metadataEditable ? "用于流程设计器中的脚本名称和功能说明。" : "内部脚本的基本信息由代码维护，仅供查看。"}</p>
              </div>
              {detail.metadataEditable ? (
                <div className="audit-script-basic-fields">
                  <label>
                    <span>功能名称</span>
                    <input
                      aria-invalid={nameError}
                      disabled={saving}
                      maxLength={120}
                      onChange={(event) => {
                        setName(event.target.value);
                        clearSaveMessages();
                      }}
                      value={name}
                    />
                    {nameError ? <small className="audit-script-config-error">功能名称不能为空</small> : null}
                  </label>
                  <label>
                    <span>功能说明</span>
                    <textarea
                      aria-invalid={descriptionError}
                      disabled={saving}
                      maxLength={500}
                      onChange={(event) => {
                        setDescription(event.target.value);
                        clearSaveMessages();
                      }}
                      rows={4}
                      value={description}
                    />
                    {descriptionError ? <small className="audit-script-config-error">功能说明不能为空</small> : null}
                  </label>
                </div>
              ) : (
                <div className="audit-script-basic-readonly">
                  <strong>{detail.name}</strong>
                  <p>{detail.description}</p>
                </div>
              )}
            </section>

            {hasEditableConfig ? <AuditScriptConfigForm
              disabled={saving}
              errors={configErrors}
              onParameterChange={(key, value) => updateDraft("parameter", key, value)}
              onSettingChange={(key, value) => updateDraft("setting", key, value)}
              parameterDefaults={parameterDefaults}
              parameters={detail.parameters}
              runtimeSettings={detail.runtimeSettings}
              settingValues={runtimeSettings}
            /> : null}
            {hasEditableConfig ? <p className="audit-script-config-warning">
              配置变更会更新脚本 v1 哈希；已有预览需重新打开，已发布流程需重新发布。
            </p> : null}
            {saveError ? <p className="dialog-error" role="alert">{saveError}</p> : null}
            {partialSaveNotice ? <p className="audit-script-partial-save" role="alert">{partialSaveNotice}</p> : null}
            {saveNotice ? <p className="audit-script-config-success" role="status">{saveNotice}</p> : null}
            <footer>
              <button disabled={saving} onClick={closeDetail} type="button">返回</button>
              {hasEditableContent ? <button className="primary-action" disabled={!canSave} type="submit">
                {saving ? "保存中…" : "保存修改"}
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
                    <button onClick={() => void openEditor(script)} type="button">
                      {script.metadataEditable || configurableCount > 0 ? "编辑" : "查看"}
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
