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
  const [parameterDefaults, setParameterDefaults] = useState<Record<string, AuditScriptValue>>({});
  const [runtimeSettings, setRuntimeSettings] = useState<Record<string, AuditScriptValue>>({});
  const [maxConcurrency, setMaxConcurrency] = useState(4);
  const [saveError, setSaveError] = useState("");
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
  };

  const openEditor = async (script: AuditScriptManagementSummary) => {
    setDetailLoading(true);
    clearSaveMessages();
    try {
      const nextDetail = await workflowApi.getAuditScriptConfig(script.id);
      setDetail(nextDetail);
      setParameterDefaults(createParameterDefaultDraft(nextDetail));
      setRuntimeSettings(createRuntimeSettingDraft(nextDetail));
      setMaxConcurrency(nextDetail.maxConcurrency);
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

  const configChanged = detail
    ? hasAuditScriptConfigChanges(detail, parameterDefaults, runtimeSettings, maxConcurrency)
    : false;
  const configErrors = detail
    ? getAuditScriptConfigErrors(detail, parameterDefaults, runtimeSettings)
    : {};
  const concurrencyError = !Number.isInteger(maxConcurrency)
    || maxConcurrency < 1
    || maxConcurrency > 32;
  const canSave = configChanged
    && !concurrencyError
    && Object.keys(configErrors).length === 0
    && !saving;

  const saveChanges = async () => {
    if (!detail || !canSave) return;
    setSaving(true);
    clearSaveMessages();
    try {
      const updated = await workflowApi.updateAuditScriptConfig(detail.id, {
        expectedEditorHash: detail.editorHash,
        maxConcurrency,
        parameterDefaults,
        runtimeSettings,
      });
      setDetail(updated);
      setMaxConcurrency(updated.maxConcurrency);
      setParameterDefaults(createParameterDefaultDraft(updated));
      setRuntimeSettings(createRuntimeSettingDraft(updated));
      setScripts((current) => (current ?? []).map((script) =>
        script.id === updated.id ? { ...script, ...updated } : script
      ).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")));
    } catch (error) {
      const message = error instanceof ApiError && error.status === 409
        ? "审核脚本已被其他管理员修改，请重新加载"
        : error instanceof Error
          ? error.message
          : "保存审核脚本失败";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    clearSaveMessages();
  };

  const hasEditableConfig = Boolean(
    detail && (
      detail.parameters.length > 0
      || detail.runtimeSettings.length > 0
    ),
  );
  const hasEditableContent = Boolean(detail);

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
              {detail ? "配置审核脚本" : "审核脚本管理"}
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
              <small>{detail.language === "py" ? "Python" : "JavaScript"} · 代际 {detail.generation} · {detail.id}</small>
            </div>

            <section className="audit-script-basic-section">
              <div>
                <h3>基本信息</h3>
                <p>脚本基本信息由服务器代码维护，管理端仅提供配置修改。</p>
              </div>
              <div className="audit-script-basic-readonly">
                <strong>{detail.name}</strong>
                <p>{detail.description}</p>
              </div>
            </section>

            <section className="audit-script-basic-section">
              <div><h3>并发配置</h3><p>配置保存后立即生效；未完成审核将要求学生重新提交。</p></div>
              <label><span>单脚本最大并发数</span>
                <input aria-invalid={concurrencyError} disabled={saving} max={32} min={1} onChange={(event) => { setMaxConcurrency(Number(event.target.value)); clearSaveMessages(); }} type="number" value={maxConcurrency} />
                {concurrencyError ? <small className="audit-script-config-error">请输入 1–32 的整数</small> : null}
              </label>
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
            {saveError ? <p className="dialog-error" role="alert">{saveError}</p> : null}
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
                      {script.language === "py" ? "Python" : "JavaScript"} · 代际 {script.generation} ·
                      {configurableCount > 0 ? ` ${configurableCount} 项可调配置 ·` : " 暂无可调参数 ·"}
                      更新于 {formatUpdatedAt(script.updatedAt)}
                    </small>
                  </div>
                  <div className="audit-script-metadata-actions">
                    <button onClick={() => void openEditor(script)} type="button">
                      配置
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
