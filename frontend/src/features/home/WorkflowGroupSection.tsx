import { useEffect, useRef, useState, type ReactNode } from "react";
import { WorkflowIcon } from "./WorkflowIcon";

export type WorkflowGroupView = {
  id: string | null;
  name: string;
  system: boolean;
};

export function WorkflowGroupSection({
  children,
  collapsed,
  count,
  draggingProcessId,
  group,
  onCollapsedChange,
  onCreateProcess,
  onDelete,
  onDropProcess,
  onRename,
  visibleCount,
}: {
  children: ReactNode;
  collapsed: boolean;
  count: number;
  draggingProcessId: string | null;
  group: WorkflowGroupView;
  onCollapsedChange: (collapsed: boolean) => void;
  onCreateProcess: () => void;
  onDelete: () => void;
  onDropProcess: (processId: string) => void;
  onRename: () => void;
  visibleCount: number;
}) {
  const [dropActive, setDropActive] = useState(false);
  const expandTimerRef = useRef<number | null>(null);

  const clearExpandTimer = () => {
    if (expandTimerRef.current !== null) {
      window.clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  };

  useEffect(() => clearExpandTimer, []);

  useEffect(() => {
    if (draggingProcessId !== null) return;
    clearExpandTimer();
    setDropActive(false);
  }, [draggingProcessId]);

  return (
    <section
      className={`workflow-group${dropActive ? " is-drop-target" : ""}`}
      data-workflow-group-key={group.id ?? "__ungrouped__"}
      onDragEnter={(event) => {
        if (!draggingProcessId) return;
        event.preventDefault();
        setDropActive(true);
        if (collapsed && expandTimerRef.current === null) {
          expandTimerRef.current = window.setTimeout(() => {
            onCollapsedChange(false);
            expandTimerRef.current = null;
          }, 600);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropActive(false);
        clearExpandTimer();
      }}
      onDragOver={(event) => {
        if (!draggingProcessId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const processId = event.dataTransfer.getData("text/plain");
        setDropActive(false);
        clearExpandTimer();
        if (processId) onDropProcess(processId);
      }}
    >
      <header className="workflow-group-header">
        <button
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "展开" : "折叠"}${group.name}`}
          className="workflow-group-collapse"
          onClick={() => onCollapsedChange(!collapsed)}
          title={collapsed ? "展开分组" : "折叠分组"}
          type="button"
        >
          <WorkflowIcon name="chevron" />
        </button>
        <span aria-hidden="true" className="workflow-group-folder"><WorkflowIcon name="folder" /></span>
        <strong>{group.name}</strong>
        <span className="workflow-group-count">{count}</span>
        {group.system ? <span className="workflow-system-badge">系统分组</span> : null}
        <div className="workflow-group-actions">
          <button aria-label={`在 ${group.name} 中创建流程`} onClick={onCreateProcess} title="在组内创建流程" type="button"><WorkflowIcon name="plus" /></button>
          {!group.system ? <button aria-label={`重命名 ${group.name}`} onClick={onRename} title="重命名分组" type="button"><WorkflowIcon name="edit" /></button> : null}
          {!group.system ? (
            <button
              aria-label={`删除 ${group.name}`}
              disabled={count > 0}
              onClick={onDelete}
              title={count > 0 ? "组内有流程，不能删除" : "删除分组"}
              type="button"
            ><WorkflowIcon name="trash" /></button>
          ) : null}
        </div>
      </header>
      {!collapsed ? (
        <div className="workflow-group-content" role="list">
          {visibleCount ? children : (
            <div className="workflow-group-empty">
              {count ? "当前分组没有匹配的流程" : "拖动流程到这里，或点击右上角＋创建"}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
