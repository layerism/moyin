import { useEffect, useState } from "react";

import type { AcademicFlowNode } from "../../types";
import { workflowApi } from "./api";
import {
  getAuditScriptOptions,
  getSelectedAuditScriptValue,
  resolveAuditScriptSelection,
  toNodeAuditScriptSelection,
  type AuditScriptSummary,
} from "./auditScripts";

export function AuditScriptSelector({
  isSuperAdmin,
  node,
  onChange,
}: {
  isSuperAdmin: boolean;
  node: AcademicFlowNode;
  onChange: (patch: Partial<AcademicFlowNode>) => void;
}) {
  const [scripts, setScripts] = useState<AuditScriptSummary[]>([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    workflowApi
      .listAuditScripts()
      .then((items) => {
        if (!cancelled) setScripts(items);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "脚本列表加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const downloadTemplate = async (language: "javascript" | "python") => {
    setError("");
    try {
      const blob = await workflowApi.downloadAuditScriptTemplate(language);
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = language === "python" ? "audit_script_template.py" : "audit_script_template.js";
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "模板下载失败");
    }
  };

  const uploadScript = async (file: File | null) => {
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const name = file.name.replace(/\.(js|py)$/i, "").trim();
      const script = await workflowApi.uploadAuditScript(name, file);
      setScripts((current) => [...current, script]);
      onChange(toNodeAuditScriptSelection(script));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "脚本上传失败");
    } finally {
      setUploading(false);
    }
  };

  const options = getAuditScriptOptions(scripts);
  const selectedValue = getSelectedAuditScriptValue(node);

  return (
    <section className="inspector-section audit-script-section">
      <h3>标准审核脚本</h3>
      <label>
        <span>材料审核脚本</span>
        <select
          aria-label="材料审核脚本"
          value={selectedValue}
          onChange={(event) => onChange(resolveAuditScriptSelection(event.target.value, scripts))}
        >
          {options.map((option) => (
            <option key={option.value || "none"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {isSuperAdmin ? (
        <div className="audit-script-actions">
          <button onClick={() => void downloadTemplate("python")} type="button">
            下载 Python 模板
          </button>
          <button onClick={() => void downloadTemplate("javascript")} type="button">
            下载 JavaScript 模板
          </button>
          <label className="audit-script-upload">
            <span>{uploading ? "正在上传…" : "上传审核脚本"}</span>
            <input
              accept=".py,.js"
              aria-label="上传审核脚本"
              disabled={uploading}
              onChange={(event) => {
                void uploadScript(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
              type="file"
            />
          </label>
        </div>
      ) : null}
      {error ? <p className="audit-script-error" role="alert">{error}</p> : null}
    </section>
  );
}
