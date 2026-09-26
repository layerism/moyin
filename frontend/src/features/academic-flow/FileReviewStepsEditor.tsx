import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { AuditScriptSelector } from "./AuditScriptSelector";
import { toNodeAuditScriptSelection } from "./auditScripts";
import { rememberReviewSteps, restoreReviewScript, recoverRemovedReviewStep } from "./fileReviewConfigHistory";
import { NodeModelSelector } from "./NodeModelSelector";
import { AuditScriptTest } from "./AuditScriptTest";
import type { AcademicFlowNode, FileReviewStep } from "../../types";

export function fileReviewSteps(node: AcademicFlowNode): FileReviewStep[] {
  if (node.kind === "confirmation" && !node.fileReviewSteps) {
    if (!node.scanAuditEnabled) return [];
    const kind = node.scanAuditMode === "score" ? "score" : "ai";
    return [{ id: `legacy-image-${node.id}`, kind,
      auditScriptId: kind === "score" ? "image-visual-score-audit" : "image-visual-audit",
      auditScriptName: kind === "score" ? "图片视觉打分" : "图片视觉审核", auditScriptType: "py",
      auditScriptParams: kind === "score"
        ? { scoringPrompt: node.scanAuditPrompt ?? "", passThreshold: node.scanAuditThreshold ?? 60 }
        : { reviewPrompt: node.scanAuditPrompt ?? "" }, auditModelCardId: node.auditModelCardId }];
  }
  return (node.fileReviewSteps ?? (node.auditScriptId ? ["ai"] : [])).map((step, index) => typeof step === "string" ? {
    id: `legacy-${index}`, kind: step,
    ...(step === "ai" ? { auditScriptId: node.auditScriptId, auditScriptName: node.auditScriptName,
      auditScriptType: node.auditScriptType, auditScriptParams: node.auditScriptParams,
      auditScriptAcceptedExtensions: node.auditScriptAcceptedExtensions, auditModelCardId: node.auditModelCardId } : {}),
  } : step);
}

export function hasSequentialManualReview(node: AcademicFlowNode | undefined): boolean {
  return Boolean(node && ["file", "confirmation"].includes(node.kind)
    && fileReviewSteps(node).some((step) => step.kind === "manual"));
}

function requiresReviewModel(step: FileReviewStep): boolean {
  return step.kind === "score" || ["docx-markdown-completion-audit", "docx-layout-visual-audit", "image-visual-audit"].includes(step.auditScriptId ?? "");
}

export function fileReviewError(node: AcademicFlowNode): string | null {
  for (const [index, step] of fileReviewSteps(node).entries()) {
    if (step.kind === "manual") continue;
    if (!step.auditScriptId) return `请为第 ${index + 1} 步选择审核规则`;
    if (requiresReviewModel(step) && !step.auditModelCardId)
      return `请为第 ${index + 1} 步选择审核模型`;
  }
  return null;
}

export function FileReviewStepsEditor(props: ComponentProps<typeof AuditScriptSelector>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const steps = fileReviewSteps(props.node);
  const titleId = `file-review-config-title-${props.node.id}`;
  useEffect(() => { setOpen(false); }, [props.node.id]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  return <>
    <section className="file-review-steps file-review-summary" aria-label="审核流程">
      <header>
        <div className="file-review-heading">
          <span className="file-review-heading-icon" aria-hidden="true">☑</span><strong>审核</strong>
          <small>{steps.length ? `${steps.length} 个步骤 · 按顺序执行` : "未添加 · 提交后自动通过"}</small>
        </div>
        <button ref={triggerRef} className="file-review-add" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {steps.length ? "配置审核" : props.disabled ? "查看审核" : "＋ 添加审核"}
        </button>
      </header>
    </section>
    {open ? createPortal(
      <div className="file-review-config-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}>
        <section ref={panelRef} className="file-review-config-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
          onKeyDown={(event) => {
            // Nested model and script dialogs retain their own keyboard handling.
            const target = event.target as HTMLElement;
            if (!panelRef.current?.contains(target) && !target.closest(".file-review-add-options")) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
            if (event.key !== "Tab") return;
            const controls = [
              ...Array.from(panelRef.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
              )),
              ...Array.from(document.querySelectorAll<HTMLElement>(".file-review-add-options button:not(:disabled)")),
            ].filter(element => element.getClientRects().length > 0);
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }}>
          <header>
            <div><h2 id={titleId}>审核配置</h2><p>{props.node.title}</p></div>
            <button ref={closeRef} type="button" aria-label="关闭审核配置" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="file-review-config-body"><FileReviewStepsFields {...props} /></div>
          <footer><button type="button" className="primary-action" onClick={() => setOpen(false)}>返回节点设置</button></footer>
        </section>
      </div>, document.body,
    ) : null}
  </>;
}

function FileReviewStepsFields(props: ComponentProps<typeof AuditScriptSelector>) {
  const { node, disabled = false, onChange } = props;
  const [adding, setAdding] = useState(false);
  const steps = fileReviewSteps(node);
  const listRef = useRef<HTMLOListElement>(null);
  const dragRef = useRef<{ id: string; targetId: string; after: boolean } | null>(null);
  const [drag, setDrag] = useState<typeof dragRef.current>(null);
  const cancelDrag = () => { dragRef.current = null; setDrag(null); };
  useEffect(cancelDrag, [node.id, disabled]);
  const legacySteps = !node.fileReviewSteps || node.fileReviewSteps.some((step) => typeof step === "string");
  const history = rememberReviewSteps(node.fileReviewConfigHistory, steps);
  const save = (next: FileReviewStep[]) => {
    const accepted = next.filter((step) => step.kind !== "manual" && step.auditScriptAcceptedExtensions?.length)
      .map((step) => step.auditScriptAcceptedExtensions!);
    const extensions = accepted.length ? accepted[0].filter((ext) => accepted.every((list) => list.includes(ext))) : null;
    onChange({ ...toNodeAuditScriptSelection(null), auditModelCardId: undefined, fileReviewSteps: next,
      fileReviewConfigHistory: rememberReviewSteps(history, next),
      ...(node.kind === "confirmation" ? { scanAuditEnabled: false, scanAuditMode: undefined,
        scanAuditPrompt: "", scanAuditThreshold: undefined } : {}),
      ...(node.kind === "file" && extensions?.length ? { fileExtensions: extensions.map((ext) => ext.replace(/^\./, "")).join(", ") } : {}),
    });
  };
  const update = (id: string, patch: Partial<Omit<FileReviewStep, "kind" | "id">>) => {
    if (disabled && legacySteps) {
      onChange(patch);
      return;
    }
    save(steps.map((step) => step.id === id ? restoreReviewScript(step, patch, history) : step));
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
    if (disabled || index + offset < 0 || index + offset >= steps.length) return;
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
          const recovered = recoverRemovedReviewStep(history, steps, type);
          if (recovered) {
            save([...steps, recovered]); setAdding(false); toggleRef.current?.focus();
            return;
          }
          const id = globalThis.crypto?.randomUUID?.()
            ?? `review-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const image = node.kind === "confirmation";
          const scriptId = image ? (type === "score" ? "image-visual-score-audit" : "image-visual-audit") : "document-score-audit";
          save([...steps, { id, kind: type, ...(type !== "manual" && (image || type === "score") ? {
            auditScriptId: scriptId, auditScriptName: image ? (type === "score" ? "图片视觉打分" : "图片视觉审核") : "DOCX/PDF AI 评分",
            auditScriptType: "py" as const, auditScriptAcceptedExtensions: image ? [".jpg", ".jpeg", ".png", ".pdf"] : [".docx", ".pdf"],
            auditScriptParams: image ? (type === "score" ? { passThreshold: 60, scoringPrompt: "请依据材料完整性和任务要求评分。" } : { reviewPrompt: "请检查扫描图片是否完整、清晰，并符合材料要求。" }) : { passThreshold: 60, scoringPrompt: "# 评分标准\n\n请从内容完整性、逻辑和表达规范三个方面评分，并说明扣分原因。" },
          } : {}) }]); setAdding(false); toggleRef.current?.focus();
        }}><span className="file-review-type-icon" aria-hidden="true">{type !== "manual" ? "✦" : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2Z" /></svg>}</span><span><strong>{type === "ai" ? "AI 通过/不通过" : type === "score" ? "AI 评分 0–100" : "人工审核"}</strong><small>{type === "ai" ? "按所选规则自动检查" : type === "score" ? "评分达到阈值后通过" : "由流程发布者审核"}</small></span></button>)}</div>, document.body) : null}
      </div> : null}
    </header>
    <ol ref={listRef}>{steps.map((step, index) => <li key={step.id} data-review-step-id={step.id}
      className={`${drag?.id === step.id ? "is-dragging" : ""}${drag && drag.targetId === step.id && drag.id !== step.id ? (drag.after ? " drop-after" : " drop-before") : ""}`}>
      <span className="file-review-step-number">{index + 1}</span>
      <div className="file-review-step-body">
        {!disabled ? <button type="button" className="file-review-drag-handle" disabled={steps.length < 2}
          aria-label={`拖动调整第 ${index + 1} 个审核步骤顺序，也可使用上下方向键`} title="拖动排序"
          onKeyDown={event => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault(); event.stopPropagation(); move(index, event.key === "ArrowUp" ? -1 : 1);
            }
          }}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { id: step.id, targetId: step.id, after: false };
            setDrag(dragRef.current);
          }}
          onPointerMove={event => {
            if (!dragRef.current) return;
            const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-review-step-id]");
            if (!row || !listRef.current?.contains(row)) return;
            const rect = row.getBoundingClientRect();
            dragRef.current = { ...dragRef.current, targetId: row.dataset.reviewStepId!, after: event.clientY > rect.top + rect.height / 2 };
            setDrag(dragRef.current);
          }}
          onPointerUp={event => {
            const pending = dragRef.current;
            cancelDrag();
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            if (!pending || pending.id === pending.targetId) return;
            if (!listRef.current?.contains(document.elementFromPoint(event.clientX, event.clientY))) return;
            const moved = steps.find(item => item.id === pending.id);
            const next = steps.filter(item => item.id !== pending.id);
            const target = next.findIndex(item => item.id === pending.targetId);
            if (!moved || target < 0) return;
            next.splice(target + (pending.after ? 1 : 0), 0, moved);
            save(next);
          }}
          onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
          <svg aria-hidden="true" width="12" height="18" viewBox="0 0 12 18" fill="currentColor">{[4, 9, 14].map(y => <g key={y}><circle cx="3" cy={y} r="1.3" /><circle cx="9" cy={y} r="1.3" /></g>)}</svg>
        </button> : null}
        <header><div className="file-review-step-title"><span className="file-review-type-icon" aria-hidden="true">{step.kind !== "manual" ? "✦" : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2Z" /></svg>}</span><div><strong>{step.kind === "ai" ? "AI 通过/不通过" : step.kind === "score" ? "AI 评分 0–100" : "人工审核"}</strong><small>{index === 0 ? "学生提交后开始" : "上一步通过后开始"}</small></div></div><div className="file-review-step-actions">
          <button type="button" disabled={disabled} aria-label="删除审核步骤" onClick={() => save(steps.filter((item) => item.id !== step.id))}>×</button>
        </div></header>
        {step.kind !== "manual" ? <>
          <AuditScriptSelector {...props} parameters={undefined} node={{ ...node, ...step, id: `${node.id}-${step.id}`, kind: node.kind, auditScriptName: step.auditScriptName ?? "", auditScriptType: step.auditScriptType ?? node.auditScriptType }}
            selectionRequired scoreOnly={node.kind === "file" && step.kind === "score"}
            allowedScriptIds={node.kind === "confirmation" ? [step.kind === "score" ? "image-visual-score-audit" : "image-visual-audit"] : undefined}
            onChange={(patch) => {
              const { fileExtensions: _extensions, kind: _kind, id: _id, ...selection } = patch;
              update(step.id, selection);
            }} />
          <div className="file-review-step-model">
            {requiresReviewModel(step) ? <NodeModelSelector value={step.auditModelCardId ?? null} disabled={props.parameterDisabled ?? disabled} onChange={(cardId) => update(step.id, { auditModelCardId: cardId ?? undefined })} /> : null}
            <AuditScriptTest key={`${node.id}-${step.id}-${step.auditScriptId}`} step={step}
              disabled={(props.parameterDisabled ?? disabled) || (requiresReviewModel(step) && !step.auditModelCardId)} />
          </div>
        </> : null}
      </div>
    </li>)}</ol>
    <p className={`file-review-status${steps.length ? " has-steps" : ""}`}><span aria-hidden="true">ⓘ</span>{!steps.length ? "未添加审核，提交后自动通过。" : "任一步退回后暂停后续审核；重新提交从第一步开始。"}</p>
  </section>;
}
