import { useEffect, useRef, useState } from "react";

import type { AcademicProcess } from "../../types";
import type { AuthIdentity } from "../auth/authApi";
import { TeacherAccountMenu } from "../auth/TeacherAccountMenu";
import { AuditScriptMetadataDialog } from "../academic-flow/AuditScriptMetadataDialog";
import { getAcademicFlowStatus } from "../academic-flow/academicFlowStatus";
import { createFlowCloneName, getFlowCloneNameError } from "../academic-flow/flowClone";
import { FlowCloneDialog, type FlowCloneResult } from "./FlowCloneDialog";
import { FlowDeleteDialog, NameDialog } from "./HomeDialogs";

export function AcademicFlowView({
  processes,
  onCreateProcess,
  onCloneProcess,
  onDatabaseAdmin,
  onDeleteProcess,
  onOssCloud,
  onOpenProcess,
  onRenameProcess,
  onTeacherLogout,
  onTeacherInvitations,
  teacherIdentity,
}: {
  processes: AcademicProcess[];
  onCreateProcess: (name: string) => Promise<void> | void;
  onCloneProcess: (source: AcademicProcess, name: string) => Promise<AcademicProcess>;
  onDatabaseAdmin: () => void;
  onDeleteProcess: (process: AcademicProcess) => Promise<void>;
  onOssCloud: () => void;
  onOpenProcess: (processId: string) => void;
  onRenameProcess: (process: AcademicProcess, name: string) => Promise<AcademicProcess>;
  onTeacherLogout: () => void;
  onTeacherInvitations: () => void;
  teacherIdentity: AuthIdentity;
}) {
  const [processDialogOpen, setProcessDialogOpen] = useState(false);
  const [processNameValue, setProcessNameValue] = useState("");
  const [processCreateError, setProcessCreateError] = useState("");
  const [processCreating, setProcessCreating] = useState(false);
  const [deleteProcess, setDeleteProcess] = useState<AcademicProcess | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [scriptManagerOpen, setScriptManagerOpen] = useState(false);
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
  const cloneTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!highlightedProcessId) return;
    const timer = window.setTimeout(() => setHighlightedProcessId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [highlightedProcessId]);

  const startCreateProcess = () => {
    setProcessNameValue("");
    setProcessCreateError("");
    setProcessDialogOpen(true);
  };

  const confirmCreateProcess = async () => {
    const nextName = processNameValue.trim();
    if (!nextName) {
      return;
    }
    if (processes.some((process) => process.name.trim() === nextName)) {
      setProcessCreateError("已存在同名流程");
      return;
    }
    setProcessCreating(true);
    setProcessCreateError("");
    try {
      await onCreateProcess(nextName);
      setProcessDialogOpen(false);
      setProcessNameValue("");
    } catch (error) {
      setProcessCreateError(error instanceof Error ? error.message : "创建失败，请稍后重试");
    } finally {
      setProcessCreating(false);
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

  const closeCloneDialog = (restoreFocus = true) => {
    setCloneSource(null);
    setCloneResult(null);
    setCloneError("");
    if (restoreFocus) window.setTimeout(() => cloneTriggerRef.current?.focus(), 0);
  };

  const confirmCloneProcess = async () => {
    if (!cloneSource) return;
    const error = getFlowCloneNameError(
      cloneName,
      cloneSource.name,
      processes.map((process) => process.name),
    );
    if (error) {
      setCloneError(error);
      return;
    }
    setCloneSubmitting(true);
    setCloneError("");
    try {
      const cloned = await onCloneProcess(cloneSource, cloneName.trim());
      setCloneResult({ id: cloned.id, name: cloned.name });
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
    if (processes.some(
      (process) => process.id !== renameProcess.id && process.name.trim() === nextName,
    )) {
      setRenameError("已存在同名流程");
      return;
    }
    setRenameSubmitting(true);
    setRenameError("");
    try {
      await onRenameProcess(renameProcess, nextName);
      setRenameProcess(null);
      setRenameName("");
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "重命名失败，请稍后重试");
    } finally {
      setRenameSubmitting(false);
    }
  };

  return (
    <main className="home-page">
      <aside className="drive-sidebar">
        <div className="drive-logo">
          <span className="logo-mark">T</span>
          <strong>材料收集</strong>
        </div>
        <button className="drive-primary">+ 新建</button>
        <button className="drive-secondary">上传</button>
        <nav className="drive-nav" aria-label="主导航">
          <button className="selected">教务流程</button>
          <button
            onClick={onOssCloud}
            onContextMenu={(event) => {
              event.preventDefault();
              onOssCloud();
            }}
          >
            ▾ OSS 云盘
          </button>
        </nav>
      </aside>

      <section className="drive-main">
        <header className="drive-topbar">
          <label className="drive-search">
            <span>⌕</span>
            <input placeholder="搜索教务流程" />
          </label>
          <TeacherAccountMenu
            identity={teacherIdentity}
            onDatabaseAdmin={onDatabaseAdmin}
            onLogout={onTeacherLogout}
            onTeacherInvitations={onTeacherInvitations}
          />
        </header>

        <section className="drive-panel academic-flow-panel" aria-label="教务流程">
          <div className="drive-breadcrumb">
            <span>首页</span>
            <span>›</span>
            <strong>教务流程</strong>
          </div>
          <div className="drive-tools">
            <button className="ai-create" onClick={startCreateProcess}>
              创建流程
            </button>
            {teacherIdentity.role === "super_admin" ? (
              <button onClick={() => setScriptManagerOpen(true)}>审核脚本</button>
            ) : null}
          </div>
          <div className="academic-flow-list" role="list" aria-label="采集流程列表">
            {processes.map((process) => {
              const status = getAcademicFlowStatus(process);

              return (
                <div
                  className={`academic-flow-item status-${status.tone}${
                    highlightedProcessId === process.id ? " cloned-highlight" : ""
                  }`}
                  key={process.id}
                  role="listitem"
                >
                  <button className="academic-flow-open" onClick={() => onOpenProcess(process.id)}>
                    <span className="academic-flow-icon">流</span>
                    <span className="academic-flow-copy">
                      <span className="academic-flow-title">
                        <strong>{process.name}</strong>
                        <span className={`academic-flow-status ${status.tone}`}>
                          {status.label}
                        </span>
                      </span>
                      <small>创建时间：{process.createdAt}</small>
                    </span>
                    <em>进入</em>
                  </button>
                  <div className="academic-flow-actions">
                    <button
                      aria-label={`复制流程 ${process.name}`}
                      className="academic-flow-clone"
                      onClick={(event) => {
                        cloneTriggerRef.current = event.currentTarget;
                        setCloneSource(process);
                        setCloneName(createFlowCloneName(process.name));
                        setCloneError("");
                        setCloneResult(null);
                      }}
                      type="button"
                    >
                      <span aria-hidden="true" className="clone-stack-icon"><i /></span>
                      <span>复制</span>
                    </button>
                    <button
                      aria-label={`重命名流程 ${process.name}`}
                      className="academic-flow-rename"
                      onClick={() => {
                        setRenameProcess(process);
                        setRenameName(process.name);
                        setRenameError("");
                      }}
                      title="重命名流程"
                      type="button"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M4 20h4L19 9l-4-4L4 16v4Zm10-13 4 4" />
                      </svg>
                    </button>
                    <button
                      aria-label={`删除流程 ${process.name}`}
                      className="academic-flow-delete"
                      onClick={() => {
                        setDeleteError("");
                        setDeleteProcess(process);
                      }}
                      title="删除流程"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
            {processes.length === 0 && (
              <div className="empty-folder">
                暂无采集流程。点击“创建流程”后输入名称，可新增一条采集流程。
              </div>
            )}
          </div>
        </section>
      </section>
      {processDialogOpen && (
        <NameDialog
          error={processCreateError}
          title="创建流程"
          value={processNameValue}
          placeholder="请输入采集流程名称"
          onCancel={() => setProcessDialogOpen(false)}
          onConfirm={() => void confirmCreateProcess()}
          onValueChange={(value) => {
            setProcessNameValue(value);
            setProcessCreateError("");
          }}
          submitting={processCreating}
        />
      )}
      {deleteProcess ? (
        <FlowDeleteDialog
          error={deleteError}
          name={deleteProcess.name}
          onCancel={() => setDeleteProcess(null)}
          onConfirm={() => void confirmDeleteProcess()}
          submitting={deleting}
        />
      ) : null}
      {renameProcess ? (
        <NameDialog
          error={renameError}
          onCancel={() => {
            setRenameProcess(null);
            setRenameError("");
          }}
          onConfirm={() => void confirmRenameProcess()}
          onValueChange={(value) => {
            setRenameName(value);
            setRenameError("");
          }}
          placeholder="请输入新的流程名称"
          selectOnFocus
          submitting={renameSubmitting}
          submittingLabel="保存中"
          title="重命名流程"
          value={renameName}
        />
      ) : null}
      {cloneSource ? (
        <FlowCloneDialog
          error={cloneError}
          name={cloneName}
          onCancel={() => closeCloneDialog()}
          onConfirm={() => void confirmCloneProcess()}
          onEdit={() => {
            if (!cloneResult) return;
            const processId = cloneResult.id;
            closeCloneDialog(false);
            onOpenProcess(processId);
          }}
          onNameChange={(value) => {
            setCloneName(value);
            setCloneError("");
          }}
          onStay={() => {
            if (cloneResult) setHighlightedProcessId(cloneResult.id);
            closeCloneDialog();
          }}
          result={cloneResult}
          source={cloneSource}
          submitting={cloneSubmitting}
        />
      ) : null}
      {scriptManagerOpen ? (
        <AuditScriptMetadataDialog onClose={() => setScriptManagerOpen(false)} />
      ) : null}
    </main>
  );
}
