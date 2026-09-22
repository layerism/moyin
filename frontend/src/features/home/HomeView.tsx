import { useEffect, useMemo, useRef, useState } from "react";

import type { AcademicProcess } from "../../types";
import type { WorkflowGroup } from "../academic-flow/api";
import { createFlowCloneName, getFlowCloneNameError } from "../academic-flow/flowClone";
import type { AuthIdentity } from "../auth/authApi";
import { TeacherAccountMenu } from "../auth/TeacherAccountMenu";
import { CompactWorkflowRow } from "./CompactWorkflowRow";
import { DriveNavIcon } from "./DriveNavIcon";
import { FlowCloneDialog, type FlowCloneResult } from "./FlowCloneDialog";
import { FlowDeleteDialog, NameDialog } from "./HomeDialogs";
import { PersonalDriveUploadButton } from "./PersonalDriveUploadButton";
import { WorkflowGroupDialog } from "./WorkflowGroupDialog";
import {
  WorkflowGroupSection,
  type WorkflowGroupView,
} from "./WorkflowGroupSection";

const UNGROUPED_KEY = "__ungrouped__";

export function AcademicFlowView({
  initiallyCreate = false,
  onCloneProcess,
  onCreateGroup,
  onCreateProcess,
  onDeleteGroup,
  onDeleteProcess,
  onMoveProcess,
  onOpenProcess,
  onOssCloud,
  onProfile,
  onRenameGroup,
  onRenameProcess,
  onWorkflowTemplates,
  processes,
  teacherIdentity,
  workflowGroups,
}: {
  initiallyCreate?: boolean;
  onCloneProcess: (source: AcademicProcess, name: string) => Promise<AcademicProcess>;
  onCreateGroup: (name: string) => Promise<WorkflowGroup>;
  onCreateProcess: (name: string, groupId: string | null) => Promise<void> | void;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onDeleteProcess: (process: AcademicProcess) => Promise<void>;
  onMoveProcess: (processId: string, groupId: string | null) => Promise<void>;
  onOpenProcess: (processId: string) => void;
  onOssCloud: () => void;
  onProfile: () => void;
  onRenameGroup: (groupId: string, name: string) => Promise<void>;
  onRenameProcess: (process: AcademicProcess, name: string) => Promise<AcademicProcess>;
  onWorkflowTemplates: (sourceId?: string) => void;
  processes: AcademicProcess[];
  teacherIdentity: AuthIdentity;
  workflowGroups: WorkflowGroup[];
}) {
  const storageKey = `academic-flow-collapsed-groups:${teacherIdentity.id}`;
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      return new Set(Array.isArray(saved) ? saved.filter((item) => typeof item === "string") : []);
    } catch {
      return new Set();
    }
  });
  const [searchValue, setSearchValue] = useState("");
  const [processDialogOpen, setProcessDialogOpen] = useState(initiallyCreate);
  const [createTargetGroupId, setCreateTargetGroupId] = useState<string | null>(null);
  const [processNameValue, setProcessNameValue] = useState("");
  const [processCreateError, setProcessCreateError] = useState("");
  const [processCreating, setProcessCreating] = useState(false);
  const [deleteProcess, setDeleteProcess] = useState<AcademicProcess | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [cloneSource, setCloneSource] = useState<AcademicProcess | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneError, setCloneError] = useState("");
  const [cloneSubmitting, setCloneSubmitting] = useState(false);
  const [cloneResult, setCloneResult] = useState<FlowCloneResult>(null);
  const [renameProcess, setRenameProcess] = useState<AcademicProcess | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [highlightedProcessId, setHighlightedProcessId] = useState<string | null>(null);
  const [groupDialog, setGroupDialog] = useState<{ mode: "create" | "rename"; groupId: string | null } | null>(null);
  const [groupNameValue, setGroupNameValue] = useState("");
  const [groupError, setGroupError] = useState("");
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [deleteGroup, setDeleteGroup] = useState<WorkflowGroupView | null>(null);
  const [deleteGroupError, setDeleteGroupError] = useState("");
  const [deleteGroupSubmitting, setDeleteGroupSubmitting] = useState(false);
  const [draggingProcessId, setDraggingProcessId] = useState<string | null>(null);
  const [movingProcessIds, setMovingProcessIds] = useState<Set<string>>(new Set());
  const [pageError, setPageError] = useState("");
  const cloneTriggerRef = useRef<HTMLButtonElement | null>(null);
  const movingProcessIdsRef = useRef<Set<string>>(new Set());

  const groupViews = useMemo<WorkflowGroupView[]>(() => [
    ...[...workflowGroups]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((group) => ({ id: group.id, name: group.name, system: false })),
    { id: null, name: "未分组", system: true },
  ], [workflowGroups]);
  const groupOptions = groupViews.map(({ id, name }) => ({ id, name }));
  const visibleProcesses = useMemo(() => {
    const query = searchValue.trim().toLocaleLowerCase();
    return query ? processes.filter((process) => process.name.toLocaleLowerCase().includes(query)) : processes;
  }, [processes, searchValue]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify([...collapsedGroupKeys]));
  }, [collapsedGroupKeys, storageKey]);

  useEffect(() => {
    const existing = new Set(workflowGroups.map((group) => group.id));
    setCollapsedGroupKeys((current) => {
      const next = new Set([...current].filter((key) => key === UNGROUPED_KEY || existing.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [workflowGroups]);

  useEffect(() => {
    if (!highlightedProcessId) return;
    const timer = window.setTimeout(() => setHighlightedProcessId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [highlightedProcessId]);

  useEffect(() => {
    if (initiallyCreate) window.history.replaceState(window.history.state, "", "/academic-flow");
  }, [initiallyCreate]);

  const groupKey = (groupId: string | null) => groupId ?? UNGROUPED_KEY;
  const setGroupCollapsed = (groupId: string | null, collapsed: boolean) => {
    setCollapsedGroupKeys((current) => {
      const next = new Set(current);
      if (collapsed) next.add(groupKey(groupId));
      else next.delete(groupKey(groupId));
      return next;
    });
  };

  const startCreateProcess = (groupId: string | null = null) => {
    setCreateTargetGroupId(groupId);
    setProcessNameValue("");
    setProcessCreateError("");
    setProcessDialogOpen(true);
  };

  const confirmCreateProcess = async () => {
    const nextName = processNameValue.trim();
    if (!nextName) return;
    if (processes.some((process) => process.name.trim() === nextName)) {
      setProcessCreateError("已存在同名流程");
      return;
    }
    setProcessCreating(true);
    setProcessCreateError("");
    try {
      await onCreateProcess(nextName, createTargetGroupId);
      setGroupCollapsed(createTargetGroupId, false);
      setProcessDialogOpen(false);
      setProcessNameValue("");
    } catch (error) {
      setProcessCreateError(error instanceof Error ? error.message : "创建失败，请稍后重试");
    } finally {
      setProcessCreating(false);
    }
  };

  const moveProcess = async (processId: string, targetGroupId: string | null) => {
    const process = processes.find((item) => item.id === processId);
    if (!process || process.groupId === targetGroupId || movingProcessIdsRef.current.has(processId)) return;
    movingProcessIdsRef.current.add(processId);
    setMovingProcessIds((current) => new Set(current).add(processId));
    setPageError("");
    try {
      await onMoveProcess(processId, targetGroupId);
      setGroupCollapsed(targetGroupId, false);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "移动流程失败，请稍后重试");
    } finally {
      movingProcessIdsRef.current.delete(processId);
      setMovingProcessIds((current) => {
        const next = new Set(current);
        next.delete(processId);
        return next;
      });
      setDraggingProcessId(null);
    }
  };

  const confirmDeleteProcess = async () => {
    if (!deleteProcess) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDeleteProcess(deleteProcess);
      setDeleteProcess(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除失败，请稍后重试");
    } finally {
      setDeleting(false);
    }
  };

  const confirmGroup = async () => {
    if (!groupDialog) return;
    const name = groupNameValue.trim();
    if (!name || name.length > 60) {
      setGroupError("分组名称不能为空且不能超过 60 个字符");
      return;
    }
    setGroupSubmitting(true);
    setGroupError("");
    try {
      if (groupDialog.mode === "create") {
        const group = await onCreateGroup(name);
        setGroupCollapsed(group.id, false);
        window.setTimeout(() => {
          document.querySelector<HTMLElement>(
            `[data-workflow-group-key="${CSS.escape(group.id)}"] .workflow-group-collapse`,
          )?.focus();
        }, 0);
      } else if (groupDialog.groupId) {
        await onRenameGroup(groupDialog.groupId, name);
      }
      setGroupDialog(null);
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : "保存分组失败，请稍后重试");
    } finally {
      setGroupSubmitting(false);
    }
  };

  const confirmDeleteGroup = async () => {
    if (!deleteGroup?.id) return;
    setDeleteGroupSubmitting(true);
    setDeleteGroupError("");
    try {
      await onDeleteGroup(deleteGroup.id);
      setDeleteGroup(null);
    } catch (error) {
      setDeleteGroupError(error instanceof Error ? error.message : "删除分组失败，请稍后重试");
    } finally {
      setDeleteGroupSubmitting(false);
    }
  };

  const closeCloneDialog = (restoreFocus = true) => {
    setCloneSource(null);
    setCloneResult(null);
    setCloneError("");
    if (restoreFocus) window.setTimeout(() => cloneTriggerRef.current?.focus(), 0);
  };

  const confirmCloneProcess = async () => {
    if (!cloneSource) return;
    const error = getFlowCloneNameError(cloneName, cloneSource.name, processes.map((process) => process.name));
    if (error) {
      setCloneError(error);
      return;
    }
    setCloneSubmitting(true);
    setCloneError("");
    try {
      const cloned = await onCloneProcess(cloneSource, cloneName.trim());
      setCloneResult({ id: cloned.id, name: cloned.name });
      setGroupCollapsed(cloned.groupId, false);
    } catch (error) {
      setCloneError(error instanceof Error ? error.message : "复制失败，请稍后重试");
    } finally {
      setCloneSubmitting(false);
    }
  };

  const confirmRenameProcess = async () => {
    if (!renameProcess) return;
    const nextName = renameName.trim();
    if (!nextName || nextName.length > 120) {
      setRenameError("流程名称不能为空且不能超过 120 个字符");
      return;
    }
    if (nextName === renameProcess.name.trim()) {
      setRenameError("新名称不能与当前流程名称相同");
      return;
    }
    if (processes.some((process) => process.id !== renameProcess.id && process.name.trim() === nextName)) {
      setRenameError("已存在同名流程");
      return;
    }
    setRenameSubmitting(true);
    setRenameError("");
    try {
      await onRenameProcess(renameProcess, nextName);
      setRenameProcess(null);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "重命名失败，请稍后重试");
    } finally {
      setRenameSubmitting(false);
    }
  };

  return (
    <main className="home-page">
      <aside className="drive-sidebar">
        <div className="drive-logo"><span className="logo-mark">T</span><strong>材料收集</strong></div>
        <button className="drive-primary" type="button" onClick={() => startCreateProcess(null)}>+ 新建</button>
        <PersonalDriveUploadButton onUploaded={onOssCloud} />
        <nav className="drive-nav" aria-label="主导航">
          <button className="selected"><DriveNavIcon kind="flow" />教务流程</button>
          <button onClick={() => onWorkflowTemplates()}><DriveNavIcon kind="template" />流程模板</button>
          <button onClick={onOssCloud} onContextMenu={(event) => { event.preventDefault(); onOssCloud(); }}><DriveNavIcon kind="cloud" />OSS 云盘</button>
        </nav>
      </aside>

      <section className="drive-main">
        <header className="drive-topbar">
          <label className="drive-search"><span>⌕</span><input onChange={(event) => setSearchValue(event.target.value)} placeholder="搜索教务流程" value={searchValue} /></label>
          <TeacherAccountMenu identity={teacherIdentity} onProfile={onProfile} />
        </header>
        <section className="drive-panel academic-flow-panel" aria-label="教务流程">
          <div className="drive-breadcrumb"><span>首页</span><span>›</span><strong>教务流程</strong></div>
          <div className="drive-tools workflow-page-tools">
            <button className="workflow-new-group" onClick={() => { setGroupDialog({ mode: "create", groupId: null }); setGroupNameValue(""); setGroupError(""); }} type="button">▱＋ 新建组</button>
            <button className="ai-create" onClick={() => startCreateProcess(null)} type="button">创建流程</button>
          </div>
          {pageError ? <p className="workflow-page-error" role="alert">{pageError}</p> : null}
          <div className="academic-flow-groups" aria-label="采集流程分组">
            {groupViews.map((group) => {
              const allGroupProcesses = processes.filter((process) => process.groupId === group.id);
              const groupProcesses = visibleProcesses.filter((process) => process.groupId === group.id);
              return (
                <WorkflowGroupSection
                  collapsed={collapsedGroupKeys.has(groupKey(group.id))}
                  count={allGroupProcesses.length}
                  draggingProcessId={draggingProcessId}
                  group={group}
                  key={groupKey(group.id)}
                  onCollapsedChange={(collapsed) => setGroupCollapsed(group.id, collapsed)}
                  onCreateProcess={() => startCreateProcess(group.id)}
                  onDelete={() => { setDeleteGroup(group); setDeleteGroupError(""); }}
                  onDropProcess={(processId) => void moveProcess(processId, group.id)}
                  onRename={() => { setGroupDialog({ mode: "rename", groupId: group.id }); setGroupNameValue(group.name); setGroupError(""); }}
                  visibleCount={groupProcesses.length}
                >
                  {groupProcesses.map((process) => (
                    <CompactWorkflowRow
                      groups={groupOptions}
                      highlighted={highlightedProcessId === process.id}
                      key={process.id}
                      moving={movingProcessIds.has(process.id)}
                      onClone={(trigger) => { cloneTriggerRef.current = trigger; setCloneSource(process); setCloneName(createFlowCloneName(process.name)); setCloneError(""); setCloneResult(null); }}
                      onDelete={() => { setDeleteError(""); setDeleteProcess(process); }}
                      onDragEnd={() => setDraggingProcessId(null)}
                      onDragStart={setDraggingProcessId}
                      onMove={(groupId) => moveProcess(process.id, groupId)}
                      onOpen={() => onOpenProcess(process.id)}
                      onPublishTemplate={() => onWorkflowTemplates(process.serverId ?? process.id)}
                      onRename={() => { setRenameProcess(process); setRenameName(process.name); setRenameError(""); }}
                      process={process}
                      teacherIdentity={teacherIdentity}
                    />
                  ))}
                </WorkflowGroupSection>
              );
            })}
          </div>
        </section>
      </section>

      {processDialogOpen ? <NameDialog error={processCreateError} title="创建流程" value={processNameValue} placeholder="请输入采集流程名称" onCancel={() => setProcessDialogOpen(false)} onConfirm={() => void confirmCreateProcess()} onValueChange={(value) => { setProcessNameValue(value); setProcessCreateError(""); }} submitting={processCreating} /> : null}
      {groupDialog ? <WorkflowGroupDialog error={groupError} mode={groupDialog.mode} onCancel={() => setGroupDialog(null)} onConfirm={() => void confirmGroup()} onValueChange={(value) => { setGroupNameValue(value); setGroupError(""); }} submitting={groupSubmitting} value={groupNameValue} /> : null}
      {deleteGroup ? (
        <div className="modal-backdrop" onClick={() => { if (!deleteGroupSubmitting) setDeleteGroup(null); }}>
          <section aria-labelledby="workflow-group-delete-title" className="rename-dialog workflow-group-delete-dialog" onClick={(event) => event.stopPropagation()} role="alertdialog">
            <h2 id="workflow-group-delete-title">删除空分组</h2>
            <p>确认删除“{deleteGroup.name}”？流程不会被删除；只有空分组能够执行此操作。</p>
            {deleteGroupError ? <p className="dialog-error" role="alert">{deleteGroupError}</p> : null}
            <div className="dialog-actions"><button disabled={deleteGroupSubmitting} onClick={() => setDeleteGroup(null)}>取消</button><button className="danger-action" disabled={deleteGroupSubmitting} onClick={() => void confirmDeleteGroup()}>{deleteGroupSubmitting ? "正在删除" : "删除分组"}</button></div>
          </section>
        </div>
      ) : null}
      {deleteProcess ? <FlowDeleteDialog error={deleteError} name={deleteProcess.name} onCancel={() => setDeleteProcess(null)} onConfirm={() => void confirmDeleteProcess()} submitting={deleting} /> : null}
      {renameProcess ? <NameDialog error={renameError} onCancel={() => { setRenameProcess(null); setRenameError(""); }} onConfirm={() => void confirmRenameProcess()} onValueChange={(value) => { setRenameName(value); setRenameError(""); }} placeholder="请输入新的流程名称" selectOnFocus submitting={renameSubmitting} submittingLabel="保存中" title="重命名流程" value={renameName} /> : null}
      {cloneSource ? <FlowCloneDialog error={cloneError} name={cloneName} onCancel={() => closeCloneDialog()} onConfirm={() => void confirmCloneProcess()} onEdit={() => { if (!cloneResult) return; const processId = cloneResult.id; closeCloneDialog(false); onOpenProcess(processId); }} onNameChange={(value) => { setCloneName(value); setCloneError(""); }} onStay={() => { if (cloneResult) setHighlightedProcessId(cloneResult.id); closeCloneDialog(); }} result={cloneResult} source={cloneSource} submitting={cloneSubmitting} /> : null}
    </main>
  );
}
