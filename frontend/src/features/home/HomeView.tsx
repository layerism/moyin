import { useEffect, useRef, useState, type MouseEvent } from "react";

import type {
  DeleteDialog,
  FileDialog,
  FolderDialog,
  HomeFile,
  HomeMenu,
  AcademicProcess,
  StateSetter,
} from "../../types";
import type { AuthIdentity } from "../auth/authApi";
import { TeacherAccountMenu } from "../auth/TeacherAccountMenu";
import { AuditScriptMetadataDialog } from "../academic-flow/AuditScriptMetadataDialog";
import { createFlowCloneName, getFlowCloneNameError } from "../academic-flow/flowClone";
import { FlowCloneDialog, type FlowCloneResult } from "./FlowCloneDialog";
import {
  ContextMenu,
  DeleteConfirmDialog,
  FlowDeleteDialog,
  MoveFileDialog,
  NameDialog,
} from "./HomeDialogs";

export function HomeView({
  activeFolder,
  files,
  folders,
  onAdminDemo,
  onActiveFolderChange,
  onAcademicFlow,
  onFilesChange,
  onFoldersChange,
  onLogin,
  onDatabaseAdmin,
  onTeacherLogout,
  teacherIdentity,
}: {
  activeFolder: string | null;
  files: HomeFile[];
  folders: string[];
  onAdminDemo: (collectionTitle?: string) => void;
  onActiveFolderChange: StateSetter<string | null>;
  onAcademicFlow: () => void;
  onFilesChange: StateSetter<HomeFile[]>;
  onFoldersChange: StateSetter<string[]>;
  onLogin: () => void;
  onDatabaseAdmin: () => void;
  onTeacherLogout: () => void;
  teacherIdentity: AuthIdentity;
}) {
  const [menu, setMenu] = useState<HomeMenu | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null);
  const [folderNameValue, setFolderNameValue] = useState("");
  const [fileDialog, setFileDialog] = useState<FileDialog | null>(null);
  const [fileNameValue, setFileNameValue] = useState("");
  const [moveTarget, setMoveTarget] = useState("__root__");
  const [cloudExpanded, setCloudExpanded] = useState(true);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialog | null>(null);

  const startCreateFolder = () => {
    setFolderDialog({ mode: "create" });
    setFolderNameValue("");
    setMenu(null);
  };

  const confirmFolderName = () => {
    const nextName = folderNameValue.trim();
    if (!folderDialog || !nextName) {
      return;
    }

    if (folderDialog.mode === "create") {
      onFoldersChange((current) => [...current, nextName]);
    } else {
      onFoldersChange((current) =>
        current.map((item) => (item === folderDialog.target ? nextName : item)),
      );
    }
    setFolderDialog(null);
    setFolderNameValue("");
  };

  const startCreateFile = () => {
    setFileDialog({ mode: "createNormal" });
    setFileNameValue("");
    setMenu(null);
  };

  const confirmCreateFile = () => {
    const nextName = fileNameValue.trim();
    if (!fileDialog || fileDialog.mode !== "createNormal" || !nextName) {
      return;
    }
    onFilesChange((current) => [
      ...current,
      {
        id: `file-${Date.now()}`,
        name: nextName,
        owner: "我",
        editedAt: "刚刚 我",
        size: "-",
        action: "编辑",
        folder: activeFolder,
      },
    ]);
    setFileDialog(null);
    setFileNameValue("");
  };

  const startCreateAiCollection = () => {
    setFileDialog({ mode: "createAi" });
    setFileNameValue("");
  };

  const confirmCreateAiCollection = () => {
    const nextName = fileNameValue.trim();
    if (!fileDialog || fileDialog.mode !== "createAi" || !nextName) {
      return;
    }
    onFilesChange((current) => [
      ...current,
      {
        id: `ai-${Date.now()}`,
        name: nextName,
        owner: "我",
        editedAt: "刚刚 我",
        size: "-",
        action: "编辑",
        folder: activeFolder,
      },
    ]);
    setFileDialog(null);
    setFileNameValue("");
  };

  const openCloudMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setMenu({ kind: "cloud", x: event.clientX, y: event.clientY });
  };

  const openFolderMenu = (folder: string, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setMenu({ folder, kind: "folder", x: event.clientX, y: event.clientY });
  };

  const openFileMenu = (fileId: string, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMenu({ fileId, kind: "file", x: event.clientX, y: event.clientY });
  };

  const moveFolder = (folder: string) => {
    onFoldersChange((current) => [...current.filter((item) => item !== folder), folder]);
    setMenu(null);
  };

  const startRenameFolder = (folder: string) => {
    setFolderDialog({ mode: "rename", target: folder });
    setFolderNameValue(folder);
    setMenu(null);
  };

  const startDeleteFolder = (folder: string) => {
    setDeleteDialog({ folder, kind: "folder" });
    setMenu(null);
  };

  const confirmDeleteFolder = (folder: string) => {
    onFoldersChange((current) => current.filter((item) => item !== folder));
    onFilesChange((current) => current.filter((file) => file.folder !== folder));
    if (activeFolder === folder) {
      onActiveFolderChange(null);
    }
    setDeleteDialog(null);
  };

  const startRenameFile = (fileId: string) => {
    const file = files.find((item) => item.id === fileId);
    if (!file) {
      return;
    }
    setFileDialog({ fileId, mode: "rename" });
    setFileNameValue(file.name);
    setMenu(null);
  };

  const confirmRenameFile = () => {
    const nextName = fileNameValue.trim();
    if (!fileDialog || fileDialog.mode !== "rename" || !nextName) {
      return;
    }
    onFilesChange((current) =>
      current.map((file) => (file.id === fileDialog.fileId ? { ...file, name: nextName } : file)),
    );
    setFileDialog(null);
    setFileNameValue("");
  };

  const startMoveFile = (fileId: string) => {
    const file = files.find((item) => item.id === fileId);
    if (!file) {
      return;
    }
    setFileDialog({ fileId, mode: "move" });
    setMoveTarget(file.folder ?? "__root__");
    setMenu(null);
  };

  const confirmMoveFile = () => {
    if (!fileDialog || fileDialog.mode !== "move") {
      return;
    }
    const nextFolder = moveTarget === "__root__" ? null : moveTarget;
    onFilesChange((current) =>
      current.map((file) =>
        file.id === fileDialog.fileId ? { ...file, folder: nextFolder } : file,
      ),
    );
    setFileDialog(null);
  };

  const startDeleteFile = (fileId: string) => {
    const file = files.find((item) => item.id === fileId);
    if (!file) {
      return;
    }
    setDeleteDialog({ fileId, fileName: file.name, kind: "file" });
    setMenu(null);
  };

  const confirmDeleteFile = (fileId: string) => {
    onFilesChange((current) => current.filter((file) => file.id !== fileId));
    setSelectedFileIds((current) => current.filter((id) => id !== fileId));
    setDeleteDialog(null);
  };

  const visibleFiles = files.filter((file) => file.folder === activeFolder);
  const currentTitle = activeFolder ?? "OSS 云盘";
  const allVisibleSelected =
    visibleFiles.length > 0 && visibleFiles.every((file) => selectedFileIds.includes(file.id));

  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId],
    );
  };

  const toggleAllVisibleFiles = () => {
    if (allVisibleSelected) {
      setSelectedFileIds((current) =>
        current.filter((id) => !visibleFiles.some((file) => file.id === id)),
      );
      return;
    }

    setSelectedFileIds((current) => [
      ...current,
      ...visibleFiles.filter((file) => !current.includes(file.id)).map((file) => file.id),
    ]);
  };

  return (
    <main className="home-page" onClick={() => setMenu(null)}>
      <aside className="drive-sidebar">
        <div className="drive-logo">
          <span className="logo-mark">T</span>
          <strong>材料收集</strong>
        </div>
        <button className="drive-primary" onClick={startCreateFile}>
          + 新建
        </button>
        <button className="drive-secondary" onClick={() => onAdminDemo()}>
          上传
        </button>
        <nav className="drive-nav" aria-label="首页导航">
          <button>⌂ 首页</button>
          <button onClick={onAcademicFlow}>教务流程</button>
          <button
            className={activeFolder === null ? "selected" : undefined}
            onClick={() => {
              setCloudExpanded((current) => !current);
              onActiveFolderChange(null);
            }}
            onContextMenu={openCloudMenu}
          >
            {cloudExpanded ? "▾" : "▸"} OSS 云盘
          </button>
          {cloudExpanded &&
            folders.map((folder) => (
              <button
                className={folder === activeFolder ? "folder active" : "folder"}
                key={folder}
                onClick={() => onActiveFolderChange(folder)}
                onContextMenu={(event) => openFolderMenu(folder, event)}
              >
                <span>▸</span>
                <span>📁</span>
                {folder}
              </button>
            ))}
        </nav>
      </aside>

      <section className="drive-main">
        <header className="drive-topbar">
          <label className="drive-search">
            <span>⌕</span>
            <input placeholder="搜索收集表、文件夹、学生材料" />
          </label>
          <TeacherAccountMenu
            identity={teacherIdentity}
            onDatabaseAdmin={onDatabaseAdmin}
            onLogout={onTeacherLogout}
          />
        </header>

        <section className="drive-panel">
          <div className="drive-breadcrumb">
            <span>OSS 云盘</span>
            {activeFolder && <span>›</span>}
            <strong>{currentTitle}</strong>
          </div>
          <div className="drive-tools">
            <button className="ai-create" onClick={startCreateAiCollection}>
              新建 AI 收集表
            </button>
            <button>更多</button>
          </div>
          <div className="file-table" role="table" aria-label="收集表列表">
            <div className="file-row file-head" role="row">
              <input
                aria-label="选择当前目录全部收集表"
                checked={allVisibleSelected}
                onChange={toggleAllVisibleFiles}
                type="checkbox"
              />
              <span>名称</span>
              <span>所有者</span>
              <span>最近编辑</span>
              <span>文档大小</span>
              <span>操作</span>
            </div>
            {visibleFiles.map((file) => (
              <div
                className="file-row"
                key={file.id}
                onContextMenu={(event) => openFileMenu(file.id, event)}
                role="row"
              >
                <input
                  aria-label={`选择 ${file.name}`}
                  checked={selectedFileIds.includes(file.id)}
                  onChange={() => toggleFileSelection(file.id)}
                  type="checkbox"
                />
                <button className="file-name" onClick={() => onAdminDemo(file.name)}>
                  <span className="file-icon">✓</span>
                  <span>{file.name}</span>
                </button>
                <span>{file.owner}</span>
                <span>{file.editedAt}</span>
                <span>{file.size}</span>
                <button
                  className="link-button"
                  onClick={file.action === "学生填写" ? onLogin : () => onAdminDemo(file.name)}
                >
                  {file.action}
                </button>
              </div>
            ))}
            {visibleFiles.length === 0 && (
              <div className="empty-folder">
                {activeFolder
                  ? "当前文件夹为空，可新建 AI 收集表，或右键 OSS 云盘新建文件夹。"
                  : "OSS 云盘根目录暂无收集表，可新建 AI 收集表。"}
              </div>
            )}
          </div>
        </section>
      </section>
      {menu && (
        <ContextMenu
          menu={menu}
          onCreateFile={startCreateFile}
          onCreateFolder={startCreateFolder}
          onDeleteFile={startDeleteFile}
          onDeleteFolder={startDeleteFolder}
          onMoveFile={startMoveFile}
          onMoveFolder={moveFolder}
          onRenameFile={startRenameFile}
          onRenameFolder={startRenameFolder}
        />
      )}
      {folderDialog && (
        <NameDialog
          title={folderDialog.mode === "create" ? "新建文件夹" : "重命名文件夹"}
          value={folderNameValue}
          placeholder="请输入文件夹名称"
          onCancel={() => setFolderDialog(null)}
          onConfirm={confirmFolderName}
          onValueChange={setFolderNameValue}
        />
      )}
      {fileDialog && fileDialog.mode === "rename" && (
        <NameDialog
          title="重命名收集表"
          value={fileNameValue}
          placeholder="请输入收集表名称"
          onCancel={() => setFileDialog(null)}
          onConfirm={confirmRenameFile}
          onValueChange={setFileNameValue}
        />
      )}
      {fileDialog && fileDialog.mode === "createAi" && (
        <NameDialog
          title="新建 AI 收集表"
          value={fileNameValue}
          placeholder="请输入收集表名称"
          onCancel={() => setFileDialog(null)}
          onConfirm={confirmCreateAiCollection}
          onValueChange={setFileNameValue}
        />
      )}
      {fileDialog && fileDialog.mode === "createNormal" && (
        <NameDialog
          title="新建收集表"
          value={fileNameValue}
          placeholder="请输入收集表名称"
          onCancel={() => setFileDialog(null)}
          onConfirm={confirmCreateFile}
          onValueChange={setFileNameValue}
        />
      )}
      {fileDialog && fileDialog.mode === "move" && (
        <MoveFileDialog
          folders={folders}
          moveTarget={moveTarget}
          onCancel={() => setFileDialog(null)}
          onConfirm={confirmMoveFile}
          onMoveTargetChange={setMoveTarget}
        />
      )}
      {deleteDialog && (
        <DeleteConfirmDialog
          deleteDialog={deleteDialog}
          onCancel={() => setDeleteDialog(null)}
          onConfirm={() =>
            deleteDialog.kind === "folder"
              ? confirmDeleteFolder(deleteDialog.folder)
              : confirmDeleteFile(deleteDialog.fileId)
          }
        />
      )}
    </main>
  );
}

export function AcademicFlowView({
  processes,
  onCreateProcess,
  onCloneProcess,
  onDatabaseAdmin,
  onDeleteProcess,
  onHome,
  onOssCloud,
  onOpenProcess,
  onRenameProcess,
  onTeacherLogout,
  teacherIdentity,
}: {
  processes: AcademicProcess[];
  onCreateProcess: (name: string) => Promise<void> | void;
  onCloneProcess: (source: AcademicProcess, name: string) => Promise<AcademicProcess>;
  onDatabaseAdmin: () => void;
  onDeleteProcess: (process: AcademicProcess) => Promise<void>;
  onHome: () => void;
  onOssCloud: () => void;
  onOpenProcess: (processId: string) => void;
  onRenameProcess: (process: AcademicProcess, name: string) => Promise<AcademicProcess>;
  onTeacherLogout: () => void;
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
        <nav className="drive-nav" aria-label="首页导航">
          <button onClick={onHome}>⌂ 首页</button>
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
            {processes.map((process) => (
              <div
                className={`academic-flow-item${
                  highlightedProcessId === process.id ? " cloned-highlight" : ""
                }`}
                key={process.id}
                role="listitem"
              >
                <button className="academic-flow-open" onClick={() => onOpenProcess(process.id)}>
                  <span className="academic-flow-icon">流</span>
                  <span>
                    <strong>{process.name}</strong>
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
            ))}
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
