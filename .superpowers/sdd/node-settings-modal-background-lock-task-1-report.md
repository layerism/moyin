# 节点设置弹窗背景锁定：任务 1 实现报告

## 状态

DONE

## 实际改动

- `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`
  - 在 `NodeInspector` 的条件返回之前增加 `useEffect`：挂载时保存 `document.body.style.overflow` 的原值并设置为 `hidden`，卸载时恢复保存的精确值。
  - 移除 `.node-inspector-backdrop` 的 `onMouseDown={onClose}`，并移除弹窗 `aside` 上用于阻断该事件的 `onMouseDown`。
  - 保留标题栏“×”与页脚“完成”的既有 `onClick={onClose}`，未新增关闭入口。
- `frontend/src/styles.css`
  - 为 `.node-inspector-fields` 保留 `overflow: auto`，并加入 `overscroll-behavior: contain`。

## 业务逻辑静态审计

- `useEffect` 位于 `if (!node) return null` 之前，Hook 调用顺序稳定。
- `NodeInspector` 仅在 `inspectorNode` 存在时渲染，因此滚动锁的挂载周期与节点设置弹窗可见周期一致。
- 清理函数恢复挂载前保存的 `document.body.style.overflow` 精确值。
- 遮罩层与弹窗容器均不存在用于关闭的 `onMouseDown`、`onClick` 或其他关闭回调。
- 标题栏“×”和页脚“完成”仍使用既有 `onClose`。
- 未修改其他弹窗、流程画布或其事件处理函数。

## 静态检查命令与结果

```bash
git diff --check -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
```

结果：无输出，退出码 `0`。

```bash
git diff --stat
git diff -- frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
```

结果：目标源码差异仅包含节点设置弹窗生命周期/JSX 与内容区 CSS；工作区中另有用户既有的 `AGENTS.md`、`docs/05_oa_graph.md` 及未跟踪文件，均未修改。

## 未验证边界

- 遵循任务约束，未运行自动化测试、构建、Browser，也未启动或重启服务。
- 需要由用户手动验证：遮罩点击不关闭、背景不可滚动/缩放/拖动、字段区滚动到边界不向背景传递，以及两个显式关闭按钮均可关闭弹窗。

## 关注事项

- 此实现按需求只恢复内联 `body.style.overflow`；如外部逻辑在弹窗存续期间也需要改写同一内联属性，最后卸载的逻辑将恢复弹窗打开前保存的值。
