import { VendorLogo } from "../admin/VendorLogo";
import { thinkingLabel } from "../admin/ModelThinkingFields";
import { useEffect, useRef, useState } from "react";

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
  const language = script.language === "py" ? "Python" : "JavaScript";
  const configurableCount = script.parameterCount + script.runtimeSettingCount;
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
    <span className="audit-script-capability" role="img" aria-label={language} title={language}>
      {script.language === "py" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#3776ab" d="M12 2C7 2 7 3 7 6v2h6v1H5c-4 0-4 8 0 8h1v-3c0-3 2-4 5-4h5V6c0-3-1-4-4-4Z" />
          <path fill="#ffd343" d="M12 22c5 0 5-1 5-4v-2h-6v-1h8c4 0 4-8 0-8h-1v3c0 3-2 4-5 4H8v4c0 3 1 4 4 4Z" />
          <circle cx="10" cy="5" r="1" fill="#fff" /><circle cx="14" cy="19" r="1" fill="#fff" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2" fill="#f7df1e" /><text x="21" y="19" textAnchor="end" fontSize="12" fontWeight="700" fontFamily="sans-serif" fill="#202733">JS</text></svg>
      )}
    </span>
    <span className="audit-script-capability" role="img" aria-label={`${configurableCount} 项可调配置`} title={`${configurableCount} 项可调配置`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h4m4 0h10" />
        <circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="9" cy="18" r="2" />
      </svg>
      <span>{configurableCount}</span>
    </span>
  </span>;
}

export function AuditScriptMetadataDialog({ onClose }: { onClose: () => void }) {
  const modelPickerRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const picker = modelPickerRef.current;
      if (picker?.open && event.target instanceof Node && !picker.contains(event.target)) picker.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const [scripts, setScripts] = useState<AuditScriptManagementSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState("");
  const [detail, setDetail] = useState<AuditScriptConfigDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [parameterDefaults, setParameterDefaults] = useState<Record<string, AuditScriptValue>>({});
  const [runtimeSettings, setRuntimeSettings] = useState<Record<string, AuditScriptValue>>({});
  const [maxConcurrency, setMaxConcurrency] = useState(4);
  const [modelCardId, setModelCardId] = useState("");
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
      setModelCardId(nextDetail.modelSelection?.cardId ?? "");
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
  const modelChanged = Boolean(detail?.modelSelection && modelCardId !== detail.modelSelection.cardId);
  const selectedModel = detail?.modelSelection?.cards.find((card) => card.id === modelCardId);
  const validModel = !detail?.modelSelection || Boolean(selectedModel?.hasApiKey && selectedModel.apiUrl && selectedModel.model);
  const canSave = (configChanged || modelChanged)
    && validModel
    && !concurrencyError
    && Object.keys(configErrors).length === 0
    && !saving;

  const saveChanges = async () => {
    if (!detail || !canSave) return;
    setSaving(true);
    clearSaveMessages();
    try {
      await workflowApi.updateAuditScriptConfig(detail.id, {
        modelCardId: detail.modelSelection ? modelCardId : null,
        expectedModelRevision: detail.modelSelection?.revision ?? null,
        expectedEditorHash: detail.editorHash,
        maxConcurrency,
        parameterDefaults,
        runtimeSettings,
      });
      onClose();
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

  const query = search.trim().toLocaleLowerCase();
  const filteredScripts = (scripts ?? []).filter((script) =>
    `${script.name} ${script.description}`.toLocaleLowerCase().includes(query)
  );

  return (
    <div className="modal-backdrop audit-script-metadata-backdrop">
      <section
        aria-labelledby="audit-script-metadata-title"
        aria-modal="true"
        className={`audit-script-metadata-dialog${detail ? " is-editor" : " is-list"}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span>{detail ? `${detail.language === "py" ? "Python" : "JavaScript"} · 更新于 ${formatUpdatedAt(detail.updatedAt)}` : "预置脚本"}</span>
            <h2 id="audit-script-metadata-title">
              {detail ? detail.name : "审核脚本管理"}
            </h2>
          </div>
          <button aria-label="关闭审核脚本管理" disabled={saving} onClick={onClose} type="button">×</button>
        </header>

        {detail ? (
          <form className="audit-script-metadata-form audit-script-config-form" onSubmit={(event) => {
            event.preventDefault();
            void saveChanges();
          }}>
            <div className="script-editor-scroll">
              {detail.modelSelection ? <section className="script-model-section">
                <div className="script-section-heading"><h3>使用模型</h3><span>思考设置由模型卡管理</span></div>
                <details ref={modelPickerRef} className="script-model-picker" onKeyDown={(event) => {
                  if (event.key === "Escape" && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
                }}>
                  <summary aria-label="选择审核模型">{selectedModel ? <><VendorLogo vendor={selectedModel.vendor} /><span><strong>{selectedModel.name}</strong><small>{selectedModel.model} · {thinkingLabel(selectedModel.thinking)}</small></span></> : <span>请选择已配置的模型</span>}<span className="script-picker-arrow" aria-hidden="true">⌄</span></summary>
                  <fieldset disabled={saving}><legend>选择模型卡</legend>{detail.modelSelection.cards.map((card) => <label className="script-model-option" key={card.id}>
                    <input type="radio" name="script-model" value={card.id} checked={modelCardId === card.id} disabled={!card.hasApiKey || !card.apiUrl || !card.model} onChange={() => { setModelCardId(card.id); clearSaveMessages(); const picker = modelPickerRef.current; if (picker) { picker.querySelector("summary")?.focus(); picker.open = false; } }} />
                    <VendorLogo vendor={card.vendor} /><span><strong>{card.name}</strong><small>{card.model || "尚未填写模型"} · {card.hasApiKey && card.apiUrl && card.model ? thinkingLabel(card.thinking) : "配置未完成"}</small></span>
                  </label>)}</fieldset>
                </details>
                {!validModel ? <p className="dialog-error" role="alert">请先由管理员完善模型配置，再选择模型。</p> : null}
              </section> : null}
              <AuditScriptConfigForm
                disabled={saving} errors={configErrors}
                onParameterChange={(key, value) => updateDraft("parameter", key, value)}
                onSettingChange={(key, value) => updateDraft("setting", key, value)}
                parameterDefaults={parameterDefaults} parameters={detail.parameters}
                runtimeSettings={detail.runtimeSettings} settingValues={runtimeSettings}
                concurrency={<label className="audit-script-config-field"><span>最大并发数</span>
                  <input aria-invalid={concurrencyError} disabled={saving} max={32} min={1} step={1} onChange={(event) => { setMaxConcurrency(Number(event.target.value)); clearSaveMessages(); }} type="number" value={maxConcurrency} />
                  {concurrencyError ? <small className="audit-script-config-error">请输入 1–32 的整数</small> : null}
                </label>}
              />
            </div>
            {saveError ? <p className="dialog-error" role="alert">{saveError}</p> : null}
            <footer>
              <p>{configChanged ? "参数修改会使未完成审核失效，需重新提交。" : "模型选择对新启动的审核生效。"}</p>
              <button disabled={saving} onClick={closeDetail} type="button">返回</button>
              <button className="primary-action" disabled={!canSave} type="submit">
                {saving ? "保存中…" : "保存修改"}
              </button>
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
                return <article key={script.id}>
                  <div>
                    <div className="audit-script-list-heading">
                      <strong title={script.name}>{script.name}</strong>
                      <ScriptCapabilityIcons script={script} />
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
