import type { AcademicFlowNode } from "../../types";
import { fileReviewError } from "./FileReviewStepsEditor";

export type PublishButtonAction = "publish" | "republish";

export type PublishButtonState = {
  action: PublishButtonAction;
  disabled: boolean;
  label: "提交发布" | "重新发布";
  title: string | undefined;
};

export function getPublishButtonState(input: {
  hasUnpublishedChanges: boolean;
  operationLocked: boolean;
  published: boolean;
  rosterActiveCount: number | null;
  nodes?: AcademicFlowNode[];
}): PublishButtonState {
  const action = input.published ? "republish" : "publish";
  const label = input.published ? "重新发布" : "提交发布";
  const scanError = input.nodes?.map(getScanAuditConfigError).find(Boolean);
  const title = input.operationLocked
    ? undefined
    : input.rosterActiveCount === null
      ? "正在读取学生名单"
      : input.rosterActiveCount === 0
        ? "请先导入学生名单"
        : scanError
          ? scanError
          : input.published && !input.hasUnpublishedChanges
            ? "当前没有待发布的修订"
            : undefined;

  return {
    action,
    disabled: input.operationLocked || title !== undefined,
    label,
    title,
  };
}

export function getScanAuditConfigError(node: AcademicFlowNode): string | undefined {
  if (node.kind !== "confirmation") return undefined;
  if (node.fileReviewSteps) {
    const error = fileReviewError(node);
    return error ? `节点“${node.title}”：${error}` : undefined;
  }
  if (!node.scanAuditEnabled) return undefined;
  if (!node.scanAuditMode) return `节点“${node.title}”需要选择审核模式`;
  if (
    node.scanAuditMode === "score"
    && (!Number.isInteger(node.scanAuditThreshold)
      || node.scanAuditThreshold! < 0
      || node.scanAuditThreshold! > 100)
  ) {
    return `节点“${node.title}”需要填写 0–100 的整数评分阈值`;
  }
  if (!node.scanAuditPrompt?.trim()) return `节点“${node.title}”需要填写审核标准`;
  return undefined;
}
