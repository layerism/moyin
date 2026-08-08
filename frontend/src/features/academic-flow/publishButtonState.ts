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

export function getRevisionEditing(published: boolean, revisionEditingRequested: boolean) {
  return published && revisionEditingRequested;
}

export function getPublishButtonState(input: {
  hasUnpublishedChanges: boolean;
  operationLocked: boolean;
  published: boolean;
  revisionEditing: boolean;
  rosterActiveCount: number | null;
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
  const title = input.operationLocked
    ? undefined
    : input.rosterActiveCount === null
      ? "正在读取学生名单"
      : input.rosterActiveCount === 0
        ? "请先导入学生名单"
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
