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

function ScriptCapabilityIcons({ script }: { script: AuditScriptManagementSummary }) {
  const formats = new Map<string, string[]>();
  for (const extension of script.acceptedExtensions) {
    const format = extension.replace(/^\./, "").toLowerCase();
    const kind = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].includes(format)
      ? "图片" : ["doc", "docx"].includes(format) ? "Word" : format.toUpperCase();
    formats.set(kind, [...(formats.get(kind) ?? []), format.toUpperCase()]);
  }
  return <span className="audit-script-capabilities">
    {script.usesAi ? <span className="audit-script-capability is-ai" role="img" aria-label="调用 AI 接口" title="调用 AI 接口">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></svg>
      <span>AI</span>
    </span> : null}
    {[...formats].map(([kind, extensions]) => <span className="audit-script-capability" key={kind} role="img" aria-label={`支持 ${extensions.join("、")}`} title={`支持 ${extensions.join("、")}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        {kind === "图片" ? <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></> : <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></>}
      </svg>
      <span>{kind}</span>
    </span>)}
  </span>;
}

export function AuditScriptMetadataDialog({ onClose }: { onClose: () => void }) {
  const [scripts, setScripts] = useState<AuditScriptManagementSummary[] | null>(null);
  const [search, setSearch] = useState("");
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

  const query = search.trim().toLocaleLowerCase();
  const filteredScripts = (scripts ?? []).filter((script) =>
    `${script.name} ${script.description}`.toLocaleLowerCase().includes(query)
  );

  return (
    <div className="modal-backdrop audit-script-metadata-backdrop">
      <section
        aria-labelledby="audit-script-metadata-title"
        aria-modal="true"
        className={`audit-script-metadata-dialog${detail ? "" : " is-list"}`}
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
              <small>{detail.language === "py" ? "Python" : "JavaScript"} · 代际 {detail.generation} · {detail.id} · 更新于 {formatUpdatedAt(detail.updatedAt)}</small>
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
            <div className="audit-script-search-toolbar">
              <input
                aria-label="搜索脚本名称或说明"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索脚本名称或说明"
                type="search"
                value={search}
              />
              <span aria-live="polite">{scripts === null ? "读取中" : query ? `${filteredScripts.length} / ${scripts.length} 个脚本` : `共 ${scripts.length} 个脚本`}</span>
            </div>
            <div className="audit-script-list-scroll">

            {detailLoading ? <p className="audit-script-metadata-state">正在读取脚本配置…</p> : null}
            {!detailLoading && scripts === null ? <p className="audit-script-metadata-state">正在读取审核脚本…</p> : null}
            {saveError && !detailLoading ? <p className="dialog-error" role="alert">{saveError}</p> : null}
            {loadError ? <div className="audit-script-metadata-state" role="alert">
              <p>{loadError}</p>
              <button onClick={loadScripts} type="button">重新读取</button>
            </div> : null}
            {!detailLoading && scripts?.length === 0 && !loadError ? (
              <p className="audit-script-metadata-state">暂无可用审核脚本。</p>
            ) : null}
            {!detailLoading && scripts && scripts.length > 0 ? <div className="audit-script-metadata-list">
              {filteredScripts.map((script) => {
                const configurableCount = script.parameterCount + script.runtimeSettingCount;
                return <article key={script.id}>
                  <div>
                    <div className="audit-script-list-heading">
                      <strong title={script.name}>{script.name}</strong>
                      <ScriptCapabilityIcons script={script} />
                      <small>{script.language === "py" ? "Python" : "JavaScript"} · {configurableCount} 项可调配置</small>
                    </div>
                    <p title={script.description}>{script.description}</p>
                  </div>
                  <div className="audit-script-metadata-actions">
                    <button onClick={() => void openEditor(script)} type="button">
                      配置
                    </button>
                  </div>
                </article>;
              })}
            </div> : null}
            {!detailLoading && !loadError && scripts && scripts.length > 0 && filteredScripts.length === 0 ? (
              <div className="audit-script-metadata-state">
                <p>未找到匹配的脚本</p>
                <button onClick={() => setSearch("")} type="button">清除搜索</button>
              </div>
            ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
