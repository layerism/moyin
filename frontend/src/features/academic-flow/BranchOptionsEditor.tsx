import type { AcademicFlowNode } from "../../types";
import { createBranchOptionId } from "./academicFlowData";

type Branches = NonNullable<AcademicFlowNode["branches"]>;

export function BranchOptionsEditor({ branches, disabled, onChange }: {
  branches: Branches;
  disabled: boolean;
  onChange: (branches: Branches) => void;
}) {
  const move = (index: number, offset: number) => {
    const next = [...branches];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return <section className="inspector-section branch-options-editor">
    <div className="branch-options-heading"><h3>分支选项</h3><span>{branches.length} 个出口</span></div>
    {branches.map((option, index) => <div className="branch-option-row" key={option.id}>
      <span className="branch-option-index">{index + 1}</span>
      <input aria-label={`分支 ${index + 1} 名称`} disabled={disabled} value={option.label}
        placeholder="输入分支名称" onChange={(event) => onChange(branches.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item))} />
      <button type="button" aria-label="上移分支" disabled={disabled || index === 0} onClick={() => move(index, -1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 11 5-5 5 5M10 6v10" /></svg></button>
      <button type="button" aria-label="下移分支" disabled={disabled || index === branches.length - 1} onClick={() => move(index, 1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 9 5 5 5-5M10 4v10" /></svg></button>
      <button type="button" aria-label={`删除分支 ${option.label}`} title="删除分支及其连线" disabled={disabled || branches.length <= 2}
        onClick={() => onChange(branches.filter((item) => item.id !== option.id))}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg></button>
    </div>)}
    <button type="button" className="branch-add-option" disabled={disabled}
      onClick={() => onChange([...branches, { id: createBranchOptionId(), label: `分支 ${branches.length + 1}` }])}>＋ 添加分支</button>
    <small>提交后选择锁定；删除分支会移除对应连线。</small>
  </section>;
}
