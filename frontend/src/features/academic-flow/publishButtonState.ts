import type { AcademicFlowNode } from "../../types";

export type PublishButtonAction =
  | "publish"
  | "begin-revision"
  | "finish-revision"
  | "republish";

export type PublishButtonState = {
  action: PublishButtonAction;
  disabled: boolean;
  label: "提交发布" | "解锁编辑" | "重新发布";
  title: string | undefined;
};

export function getRevisionEditing(
  published: boolean,
  revisionEditingRequested: boolean,
  hasUnpublishedChanges: boolean,
) {
  return published && (revisionEditingRequested || hasUnpublishedChanges);
}

export function getPublishButtonState(input: {
  hasUnpublishedChanges: boolean;
  operationLocked: boolean;
  published: boolean;
  revisionEditing: boolean;
  rosterActiveCount: number | null;
  nodes?: AcademicFlowNode[];
}): PublishButtonState {
  if (input.published && !input.revisionEditing) {
    return {
      action: "begin-revision",
      disabled: input.operationLocked,
      label: "解锁编辑",
      title: undefined,
    };
  }

  if (input.published && input.revisionEditing && !input.hasUnpublishedChanges) {
    return {
      action: "finish-revision",
      disabled: input.operationLocked,
      label: "重新发布",
      title: undefined,
    };
  }

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
  if (!node.scanAuditEnabled) {
    return node.templateAsset ? `节点“${node.title}”已关闭扫描审核，请删除模板` : undefined;
  }
  if (!node.templateAsset?.originalName.toLowerCase().endsWith(".docx")) {
    return `节点“${node.title}”需要上传 DOCX 签署文件模板`;
  }
  if (!node.scanAuditMode) return `节点“${node.title}”需要选择审核模式`;
  if (!node.scanAuditPrompt?.trim()) return `节点“${node.title}”需要填写审核标准`;
  return undefined;
}
