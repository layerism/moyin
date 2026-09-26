import type { FileReviewConfigHistory, FileReviewStep } from "../../types";

export function rememberReviewSteps(history: FileReviewConfigHistory = {}, steps: FileReviewStep[]): FileReviewConfigHistory {
  const next = { ...history };
  let order = Math.max(0, ...Object.values(next).map(item => item.order));
  for (const step of steps) {
    const scripts = { ...next[step.id]?.scripts };
    if (step.auditScriptId) {
      scripts[step.auditScriptId] = {
        auditScriptParams: { ...step.auditScriptParams },
        auditModelCardId: step.auditModelCardId,
      };
    }
    // Explicit order survives the server's canonical JSON key sorting.
    next[step.id] = { order: ++order, step: { ...step }, scripts };
  }
  return next;
}

export function restoreReviewScript(step: FileReviewStep, patch: Partial<FileReviewStep>, history: FileReviewConfigHistory): FileReviewStep {
  if (!("auditScriptId" in patch)) return { ...step, ...patch };
  const saved = patch.auditScriptId ? history[step.id]?.scripts[patch.auditScriptId] : undefined;
  return {
    ...step,
    ...patch,
    ...(saved ? {
      auditScriptParams: { ...patch.auditScriptParams, ...saved.auditScriptParams },
      auditModelCardId: saved.auditModelCardId,
    } : {}),
  };
}

export function recoverRemovedReviewStep(history: FileReviewConfigHistory, steps: FileReviewStep[], kind: FileReviewStep["kind"]): FileReviewStep | undefined {
  const activeIds = new Set(steps.map(step => step.id));
  const saved = Object.values(history).sort((left, right) => right.order - left.order).find(item => item.step.kind === kind && !activeIds.has(item.step.id));
  return saved ? { ...saved.step } : undefined;
}
