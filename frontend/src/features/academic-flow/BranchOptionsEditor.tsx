import type { AcademicFlowNode } from "../../types";

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
    <h3>分支选项</h3>
    <p>每个选项对应一个输出连接点。</p>
    {branches.map((option, index) => <div className="branch-option-row" key={option.id}>
      <span className="branch-option-index">{index + 1}</span>
      <input aria-label={`分支 ${index + 1} 名称`} disabled={disabled} value={option.label}
        placeholder="输入分支名称" onChange={(event) => onChange(branches.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item))} />
      <button type="button" aria-label="上移分支" disabled={disabled || index === 0} onClick={() => move(index, -1)}>↑</button>
      <button type="button" aria-label="下移分支" disabled={disabled || index === branches.length - 1} onClick={() => move(index, 1)}>↓</button>
      <button type="button" aria-label={`删除分支 ${option.label}`} title="删除分支及其连线" disabled={disabled || branches.length <= 2}
        onClick={() => onChange(branches.filter((item) => item.id !== option.id))}>×</button>
    </div>)}
    <button type="button" className="branch-add-option" disabled={disabled}
      onClick={() => onChange([...branches, { id: crypto.randomUUID(), label: `分支 ${branches.length + 1}` }])}>＋ 添加分支</button>
    <small>学生提交后不可更改选择。删除选项会同时删除对应连线。</small>
  </section>;
}
