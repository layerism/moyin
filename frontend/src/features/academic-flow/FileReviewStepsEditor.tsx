import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { AuditScriptSelector } from "./AuditScriptSelector";
import { toNodeAuditScriptSelection } from "./auditScripts";
import { NodeModelSelector } from "./NodeModelSelector";
import type { AcademicFlowNode, FileReviewStep } from "../../types";

export function fileReviewSteps(node: AcademicFlowNode): FileReviewStep[] {
  return (node.fileReviewSteps ?? (node.auditScriptId ? ["ai"] : [])).map((step, index) => typeof step === "string" ? {
    id: `legacy-${index}`, kind: step,
    ...(step === "ai" ? { auditScriptId: node.auditScriptId, auditScriptName: node.auditScriptName,
      auditScriptType: node.auditScriptType, auditScriptParams: node.auditScriptParams,
      auditScriptAcceptedExtensions: node.auditScriptAcceptedExtensions, auditModelCardId: node.auditModelCardId } : {}),
  } : step);
}

export function hasFileManualReview(node: AcademicFlowNode | undefined): boolean {
  return node?.kind === "file" && fileReviewSteps(node).some((step) => step.kind === "manual");
}

export function fileReviewError(node: AcademicFlowNode): string | null {
  for (const [index, step] of fileReviewSteps(node).entries()) {
    if (step.kind === "manual") continue;
    if (!step.auditScriptId) return `请为第 ${index + 1} 步选择审核规则`;
    if ((step.kind === "score" || step.auditScriptId === "docx-markdown-completion-audit") && !step.auditModelCardId)
      return `请为第 ${index + 1} 步选择审核模型`;
  }
  return null;
}

export function FileReviewStepsEditor(props: ComponentProps<typeof AuditScriptSelector>) {
  const { node, disabled = false, onChange } = props;
  const [adding, setAdding] = useState(false);
  const steps = fileReviewSteps(node);
  const save = (next: FileReviewStep[]) => {
    const accepted = next.filter((step) => step.kind !== "manual" && step.auditScriptAcceptedExtensions?.length)
      .map((step) => step.auditScriptAcceptedExtensions!);
    const extensions = accepted.length ? accepted[0].filter((ext) => accepted.every((list) => list.includes(ext))) : null;
    onChange({ ...toNodeAuditScriptSelection(null), auditModelCardId: undefined, fileReviewSteps: next,
      ...(extensions?.length ? { fileExtensions: extensions.map((ext) => ext.replace(/^\./, "")).join(", ") } : {}),
    });
  };
  const update = (id: string, patch: Partial<Omit<FileReviewStep, "kind" | "id">>) => {
    if (disabled && node.fileReviewSteps?.some((step) => typeof step === "string")) {
      onChange(patch);
      return;
    }
    save(steps.map((step) => step.id === id ? { ...step, ...patch } : step));
  };
  const pickerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setAdding(false); }, [node.id, disabled]);
  useEffect(() => {
    if (!adding) return;
    const outside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setAdding(false);
    };
    const close = () => setAdding(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [adding]);
  const move = (index: number, offset: number) => {
    const next = [...steps];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    save(next);
  };
  return <section className="file-review-steps" aria-label="审核流程">
    <header>
      <div className="file-review-heading"><span className="file-review-heading-icon" aria-hidden="true">☑</span><strong>审核</strong>
        {steps.length ? <small>{steps.length} 个步骤 · 按顺序执行</small> : <small className="file-review-optional">可选</small>}
      </div>
      {!disabled ? <div className="file-review-picker" ref={pickerRef} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !menuRef.current?.contains(event.relatedTarget as Node | null)) setAdding(false);
      }} onKeyDown={(event) => {
        if (event.key === "Escape" && adding) { event.stopPropagation(); setAdding(false); toggleRef.current?.focus(); }
      }}>
        <button ref={toggleRef} className="file-review-add" type="button" aria-expanded={adding} onClick={() => {
          const rect = toggleRef.current!.getBoundingClientRect();
          const height = 3 * 66 + 16;
          setMenuPosition({ left: Math.max(8, Math.min(rect.right - 222, window.innerWidth - 230)), top: rect.bottom + height + 8 < window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6) });
          setAdding(!adding);
        }}>＋ 添加审核 <span aria-hidden="true">⌄</span></button>
        {adding ? createPortal(<div ref={menuRef} style={menuPosition} className="file-review-add-options" role="group" aria-label="选择审核类型">{(["ai", "score", "manual"] as const).map((type) => <button key={type} type="button" onClick={() => {
          save([...steps, { id: crypto.randomUUID(), kind: type, ...(type === "score" ? { auditScriptId: "document-score-audit", auditScriptName: "文档 AI 评分", auditScriptType: "py" as const, auditScriptAcceptedExtensions: [".docx", ".pdf"], auditScriptParams: { passThreshold: 60, scoringPrompt: "# 评分标准\n\n请从内容完整性、逻辑和表达规范三个方面评分，并说明扣分原因。" } } : {}) }]); setAdding(false); toggleRef.current?.focus();
        }}><span className="file-review-type-icon" aria-hidden="true">{type !== "manual" ? "✦" : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2Z" /></svg>}</span><span><strong>{type === "ai" ? "AI 通过/不通过" : type === "score" ? "AI 评分 0–100" : "人工审核"}</strong><small>{type === "ai" ? "按所选规则自动检查" : type === "score" ? "评分达到阈值后通过" : "由流程发布者审核"}</small></span></button>)}</div>, document.body) : null}
      </div> : null}
    </header>
    <ol>{steps.map((step, index) => <li key={step.id}>
      <span className="file-review-step-number">{index + 1}</span>
      <div className="file-review-step-body">
        <header><div className="file-review-step-title"><span className="file-review-type-icon" aria-hidden="true">{step.kind !== "manual" ? "✦" : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2Z" /></svg>}</span><div><strong>{step.kind === "ai" ? "AI 通过/不通过" : step.kind === "score" ? "AI 评分 0–100" : "人工审核"}</strong><small>{index === 0 ? "学生提交后开始" : "上一步通过后开始"}</small></div></div><div className="file-review-step-actions">
          <button type="button" disabled={disabled || index === 0} aria-label="上移审核步骤" onClick={() => move(index, -1)}>↑</button>
          <button type="button" disabled={disabled || index === steps.length - 1} aria-label="下移审核步骤" onClick={() => move(index, 1)}>↓</button>
          <button type="button" disabled={disabled} aria-label="删除审核步骤" onClick={() => save(steps.filter((item) => item.id !== step.id))}>×</button>
        </div></header>
        {step.kind !== "manual" ? <>
          <AuditScriptSelector {...props} parameters={undefined} node={{ ...node, ...step, id: `${node.id}-${step.id}`, kind: "file", auditScriptName: step.auditScriptName ?? "", auditScriptType: step.auditScriptType ?? node.auditScriptType }}
            selectionRequired scoreOnly={step.kind === "score"} onChange={(patch) => {
              const { fileExtensions: _extensions, kind: _kind, id: _id, ...selection } = patch;
              update(step.id, selection);
            }} />
          {(step.kind === "score" || step.auditScriptId === "docx-markdown-completion-audit") ? <div className="file-review-step-model"><NodeModelSelector value={step.auditModelCardId ?? null} disabled={disabled} onChange={(cardId) => update(step.id, { auditModelCardId: cardId ?? undefined })} /></div> : null}
        </> : null}
      </div>
    </li>)}</ol>
    <p className={`file-review-status${steps.length ? " has-steps" : ""}`}><span aria-hidden="true">ⓘ</span>{!steps.length ? "未添加审核，提交后自动通过。" : "任一步退回后暂停后续审核；重新提交从第一步开始。"}</p>
  </section>;
}
