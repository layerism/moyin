import { useEffect, useRef, useState, type ComponentProps } from "react";
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
  const pickerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setAdding(false); }, [node.id, disabled]);
  useEffect(() => {
    if (!adding) return;
    const outside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setAdding(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [adding]);
  const move = (index: number, offset: number) => {
    const next = [...steps];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange({ fileReviewSteps: next });
  };
  return <section className="file-review-steps" aria-label="审核流程">
    <header>
      <div className="file-review-heading"><span className="file-review-heading-icon" aria-hidden="true">☑</span><strong>审核</strong>
        {steps.length ? <small>{steps.length} 个步骤 · 按顺序执行</small> : <small className="file-review-optional">可选</small>}
      </div>
      {!disabled && steps.length < 2 ? <div className="file-review-picker" ref={pickerRef} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAdding(false);
      }} onKeyDown={(event) => {
        if (event.key === "Escape" && adding) { event.stopPropagation(); setAdding(false); toggleRef.current?.focus(); }
      }}>
        <button ref={toggleRef} className="file-review-add" type="button" aria-expanded={adding} onClick={() => setAdding(!adding)}>＋ 添加审核 <span aria-hidden="true">⌄</span></button>
        {adding ? <div className="file-review-add-options" role="group" aria-label="选择审核类型">{(["ai", "manual"] as const).filter((type) => !steps.includes(type)).map((type) => <button key={type} type="button" onClick={() => {
          onChange({ fileReviewSteps: [...steps, type] }); setAdding(false); toggleRef.current?.focus();
        }}><span className="file-review-type-icon" aria-hidden="true">{type === "ai" ? "✦" : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2Z" /></svg>}</span><span><strong>{type === "ai" ? "AI 预审核" : "人工审核"}</strong><small>{type === "ai" ? "按所选规则自动检查" : "由流程发布者审核"}</small></span></button>)}</div> : null}
      </div> : null}
    </header>
    <ol>{steps.map((step, index) => <li key={step}>
      <span className="file-review-step-number">{index + 1}</span>
      <div className="file-review-step-body">
        <header><div className="file-review-step-title"><span className="file-review-type-icon" aria-hidden="true">{step === "ai" ? "✦" : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2Z" /></svg>}</span><div><strong>{step === "ai" ? "AI 预审核" : "人工审核"}</strong><small>{index === 0 ? "学生提交后开始" : "上一步通过后开始"}</small></div></div><div className="file-review-step-actions">
          <button type="button" disabled={disabled || index === 0} aria-label="上移审核步骤" onClick={() => move(index, -1)}>↑</button>
          <button type="button" disabled={disabled || index === steps.length - 1} aria-label="下移审核步骤" onClick={() => move(index, 1)}>↓</button>
          <button type="button" disabled={disabled} aria-label="删除审核步骤" onClick={() => onChange({
            ...(step === "ai" ? toNodeAuditScriptSelection(null) : {}),
            fileReviewSteps: steps.filter((item) => item !== step),
          })}>×</button>
        </div></header>
        {step === "ai" ? <AuditScriptSelector {...props} selectionRequired onChange={(patch) => onChange({ ...patch, ...(!disabled ? { fileReviewSteps: steps } : {}) })} /> : <div className="file-review-assignee"><span>审核人</span><div><strong>流程发布者本人</strong><small>评语必填 · 支持上传审核材料</small></div></div>}
      </div>
    </li>)}</ol>
    <p className={`file-review-status${steps.length ? " has-steps" : ""}`}><span aria-hidden="true">ⓘ</span>{!steps.length ? "未添加审核，提交后自动通过。" : "任一步退回后暂停后续审核；重新提交从第一步开始。"}</p>
  </section>;
}
