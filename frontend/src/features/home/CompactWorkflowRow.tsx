import { useRef, useState, type ReactNode } from "react";

import type { AcademicProcess } from "../../types";
import type { AuthIdentity } from "../auth/authApi";
import { getAcademicFlowStatus } from "../academic-flow/academicFlowStatus";
import { MoveWorkflowMenu, type WorkflowGroupOption } from "./MoveWorkflowMenu";

export function CompactWorkflowRow({
  groups,
  highlighted,
  moving,
  onClone,
  onDelete,
  onDragEnd,
  onDragStart,
  onMove,
  onOpen,
  onPublishTemplate,
  onRename,
  process,
  teacherIdentity,
}: {
  groups: WorkflowGroupOption[];
  highlighted: boolean;
  moving: boolean;
  onClone: (trigger: HTMLButtonElement) => void;
  onDelete: () => void;
  onDragEnd: () => void;
  onDragStart: (processId: string) => void;
  onMove: (groupId: string | null) => Promise<void> | void;
  onOpen: () => void;
  onPublishTemplate: () => void;
  onRename: () => void;
  process: AcademicProcess;
  teacherIdentity: AuthIdentity;
}) {
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const dragHandleRef = useRef<HTMLButtonElement | null>(null);
  const status = getAcademicFlowStatus(process);

  const iconButton = (label: string, children: ReactNode, onClick: () => void) => (
    <button
      aria-label={`${label} ${process.name}`}
      className="workflow-row-action"
      disabled={moving}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );

  return (
    <div
      aria-busy={moving}
      className={`academic-flow-item compact status-${status.tone}${
        highlighted ? " cloned-highlight" : ""
      }${moving ? " is-moving" : ""}`}
      role="listitem"
    >
      <button
        aria-label={`移动流程 ${process.name}`}
        className="workflow-drag-handle"
        disabled={moving}
        draggable={!moving}
        onDragEnd={onDragEnd}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", process.id);
          event.dataTransfer.effectAllowed = "move";
          onDragStart(process.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setMoveMenuOpen(true);
          }
        }}
        ref={dragHandleRef}
        title="拖动流程；按 Enter 可选择分组"
        type="button"
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <button className="academic-flow-open compact" disabled={moving} onClick={onOpen} type="button">
        <span className="academic-flow-icon">流</span>
        <span className="academic-flow-copy">
          <span className="academic-flow-title">
            <strong>{process.name}</strong>
            {process.publishedVersionNo ? <span className="workflow-version">v{process.publishedVersionNo}</span> : null}
            <span className={`academic-flow-status ${status.tone}`}>{status.label}</span>
          </span>
          <small>创建时间：{process.createdAt}</small>
        </span>
      </button>
      <div className="academic-flow-actions">
        {iconButton("进入流程", <span aria-hidden="true">↗</span>, onOpen)}
        {teacherIdentity.role === "super_admin"
          ? iconButton("发布为模板", <span aria-hidden="true">☆</span>, onPublishTemplate)
          : null}
        {iconButton("复制流程", <span aria-hidden="true">⧉</span>, () => {
          const trigger = document.activeElement;
          if (trigger instanceof HTMLButtonElement) onClone(trigger);
        })}
        {iconButton("重命名流程", <span aria-hidden="true">✎</span>, onRename)}
        {iconButton("删除流程", <span aria-hidden="true">×</span>, onDelete)}
      </div>
      {moveMenuOpen ? (
        <MoveWorkflowMenu
          currentGroupId={process.groupId}
          groups={groups}
          onClose={() => {
            setMoveMenuOpen(false);
            window.setTimeout(() => dragHandleRef.current?.focus(), 0);
          }}
          onMove={(groupId) => {
            setMoveMenuOpen(false);
            void onMove(groupId);
            window.setTimeout(() => dragHandleRef.current?.focus(), 0);
          }}
        />
      ) : null}
    </div>
  );
}
