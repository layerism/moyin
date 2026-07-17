import { useEffect, useState } from "react";

import type { AcademicFlowNode } from "../../types";
import { workflowApi } from "./api";
import {
  getAuditScriptOptions,
  getSelectedAuditScriptValue,
  resolveAuditScriptSelection,
  type AuditScriptSummary,
} from "./auditScripts";

export function AuditScriptSelector({
  node,
  onChange,
}: {
  node: AcademicFlowNode;
  onChange: (patch: Partial<AcademicFlowNode>) => void;
}) {
  const [scripts, setScripts] = useState<AuditScriptSummary[]>([]);
  const [error, setError] = useState("");

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

  const options = getAuditScriptOptions(scripts, node);
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
      {error ? <p className="audit-script-error" role="alert">{error}</p> : null}
    </section>
  );
}
