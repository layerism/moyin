export function createFlowCloneName(sourceName: string): string {
  return `${sourceName.trim()} - 副本`;
}

export function getFlowCloneNameError(
  value: string,
  sourceName: string,
  existingNames: string[],
): string {
  const name = value.trim();
  if (!name) return "请输入新流程名称";
  if (name.length > 120) return "流程名称不能超过 120 个字符";
  if (name === sourceName.trim()) return "副本名称不能与原流程相同";
  if (existingNames.some((existing) => existing.trim() === name)) return "已存在同名流程";
  return "";
}
