import { useState, type ComponentProps } from "react";
import { AuditScriptSelector } from "./AuditScriptSelector";
import { toNodeAuditScriptSelection } from "./auditScripts";
import type { AcademicFlowNode } from "../../types";

export function fileReviewSteps(node: AcademicFlowNode): Array<"ai" | "manual"> {
  return node.fileReviewSteps ?? (node.auditScriptId ? ["ai"] : []);
}

export function hasFileManualReview(node: AcademicFlowNode | undefined): boolean {
  return node?.kind === "file" && Boolean(node.fileReviewSteps?.includes("manual"));
}

export function FileReviewStepsEditor(props: ComponentProps<typeof AuditScriptSelector>) {
  const { node, disabled, onChange } = props;
  const [adding, setAdding] = useState(false);
  const steps = fileReviewSteps(node);
  const move = (index: number, offset: number) => {
    const next = [...steps];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange({ fileReviewSteps: next });
  };
  return <section className="file-review-steps" aria-label="审核流程">
    <header><strong className="node-file-material-label">审核</strong><small>按顺序执行，全部通过后完成节点</small></header>
    <ol>{steps.map((step, index) => <li key={step}>
      <span className="file-review-step-number">{index + 1}</span>
      <div className="file-review-step-body">
        <header><strong>{step === "ai" ? "AI 预审核" : "人工审核"}</strong><div>
          <button type="button" disabled={disabled || index === 0} aria-label="上移审核步骤" onClick={() => move(index, -1)}>↑</button>
          <button type="button" disabled={disabled || index === steps.length - 1} aria-label="下移审核步骤" onClick={() => move(index, 1)}>↓</button>
          <button type="button" disabled={disabled} aria-label="删除审核步骤" onClick={() => onChange({
            ...(step === "ai" ? toNodeAuditScriptSelection(null) : {}),
            fileReviewSteps: steps.filter((item) => item !== step),
          })}>×</button>
        </div></header>
        <small>{index === 0 ? "学生提交后开始" : "上一步通过后开始"}</small>
        {step === "ai" ? <AuditScriptSelector {...props} selectionRequired onChange={(patch) => onChange({ ...patch, ...(!disabled ? { fileReviewSteps: steps } : {}) })} /> : <p>由流程发布者本人审核<br /><small>评语必填 · 通过或退回 · 支持上传审核材料</small></p>}
      </div>
    </li>)}</ol>
    {!disabled && steps.length < 2 ? <>
      <button className="file-review-add" type="button" aria-expanded={adding} onClick={() => setAdding(!adding)}>＋ 添加审核步骤</button>
      {adding ? <div className="file-review-add-options">{(["ai", "manual"] as const).filter((type) => !steps.includes(type)).map((type) => <button key={type} type="button" onClick={() => { onChange({ fileReviewSteps: [...steps, type] }); setAdding(false); }}>{type === "ai" ? "AI 预审核" : "人工审核"}</button>)}</div> : null}
    </> : null}
    {!steps.length ? <small>未配置审核，提交后自动通过。</small> : <small>任一步退回后暂停后续审核；重新提交从第一步开始。</small>}
  </section>;
}
