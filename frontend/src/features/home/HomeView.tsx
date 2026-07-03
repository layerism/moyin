import { useState, type MouseEvent } from "react";

import type {
  DeleteDialog,
  FileDialog,
  FolderDialog,
  HomeFile,
  HomeMenu,
  StateSetter,
} from "../../types";
import {
  ContextMenu,
  DeleteConfirmDialog,
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
          <button className="selected">⌂ 首页</button>
          <button onClick={onAcademicFlow}>教务流程</button>
          <button
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
          <button className="avatar">卢</button>
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

export function AcademicFlowView({ onHome }: { onHome: () => void }) {
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
          <button>▾ OSS 云盘</button>
        </nav>
      </aside>

      <section className="drive-main">
        <header className="drive-topbar">
          <label className="drive-search">
            <span>⌕</span>
            <input placeholder="搜索教务流程" />
          </label>
          <button className="avatar">卢</button>
        </header>

        <section className="drive-panel academic-flow-panel" aria-label="教务流程">
          <div className="drive-breadcrumb">
            <span>首页</span>
            <span>›</span>
            <strong>教务流程</strong>
          </div>
        </section>
      </section>
    </main>
  );
}
