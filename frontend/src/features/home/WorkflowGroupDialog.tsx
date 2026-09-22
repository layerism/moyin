import { NameDialog } from "./HomeDialogs";

export function WorkflowGroupDialog({
  error,
  mode,
  onCancel,
  onConfirm,
  onValueChange,
  submitting,
  value,
}: {
  error: string;
  mode: "create" | "rename";
  onCancel: () => void;
  onConfirm: () => void;
  onValueChange: (value: string) => void;
  submitting: boolean;
  value: string;
}) {
  return (
    <NameDialog
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
      onValueChange={onValueChange}
      placeholder="请输入分组名称"
      selectOnFocus={mode === "rename"}
      submitting={submitting}
      submittingLabel="保存中"
      title={mode === "create" ? "新建流程组" : "重命名流程组"}
      value={value}
    />
  );
}
