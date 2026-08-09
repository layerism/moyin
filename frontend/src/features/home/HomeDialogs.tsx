import { useState } from "react";

import type { DeleteDialog, HomeMenu } from "../../types";

export function ContextMenu({
  menu,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onDeleteFolder,
  onMoveFile,
  onMoveFolder,
  onRenameFile,
  onRenameFolder,
}: {
  menu: HomeMenu;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onDeleteFile: (fileId: string) => void;
  onDeleteFolder: (folder: string) => void;
  onMoveFile: (fileId: string) => void;
  onMoveFolder: (folder: string) => void;
  onRenameFile: (fileId: string) => void;
  onRenameFolder: (folder: string) => void;
}) {
  return (
    <div
      className="context-menu"
      onClick={(event) => event.stopPropagation()}
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.kind === "cloud" && (
        <>
          <button onClick={onCreateFolder}>新建文件夹</button>
          <button onClick={onCreateFile}>新建收集表</button>
        </>
      )}
      {menu.kind === "folder" && (
        <>
          <button onClick={() => onMoveFolder(menu.folder)}>移动</button>
          <button onClick={() => onRenameFolder(menu.folder)}>重命名</button>
          <button className="danger" onClick={() => onDeleteFolder(menu.folder)}>
            删除
          </button>
        </>
      )}
      {menu.kind === "file" && (
        <>
          <button onClick={() => onMoveFile(menu.fileId)}>移动</button>
          <button onClick={() => onRenameFile(menu.fileId)}>重命名</button>
          <button className="danger" onClick={() => onDeleteFile(menu.fileId)}>
            删除
          </button>
        </>
      )}
    </div>
  );
}

export function NameDialog({
  error = "",
  onCancel,
  onConfirm,
  onValueChange,
  placeholder,
  selectOnFocus = false,
  submitting = false,
  submittingLabel = "创建中",
  title,
  value,
}: {
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
  onValueChange: (value: string) => void;
  placeholder: string;
  selectOnFocus?: boolean;
  submitting?: boolean;
  submittingLabel?: string;
  title: string;
  value: string;
}) {
  return (
    <div className="modal-backdrop" onClick={() => {
      if (!submitting) onCancel();
    }}>
      <section className="rename-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <input
          autoFocus
          placeholder={placeholder}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={(event) => {
            if (selectOnFocus) event.currentTarget.select();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !submitting) {
              onConfirm();
            }
          }}
        />
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button disabled={submitting} onClick={onCancel}>取消</button>
          <button className="primary small" disabled={submitting} onClick={onConfirm}>
            {submitting ? submittingLabel : "确定"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function MoveFileDialog({
  folders,
  moveTarget,
  onCancel,
  onConfirm,
  onMoveTargetChange,
}: {
  folders: string[];
  moveTarget: string;
  onCancel: () => void;
  onConfirm: () => void;
  onMoveTargetChange: (value: string) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <section className="rename-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>移动收集表</h2>
        <select value={moveTarget} onChange={(event) => onMoveTargetChange(event.target.value)}>
          <option value="__root__">OSS 云盘根目录</option>
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
        <div className="dialog-actions">
          <button onClick={onCancel}>取消</button>
          <button className="primary small" onClick={onConfirm}>
            确定
          </button>
        </div>
      </section>
    </div>
  );
}

export function DeleteConfirmDialog({
  deleteDialog,
  onCancel,
  onConfirm,
}: {
  deleteDialog: DeleteDialog;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <section className="rename-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>确认删除</h2>
        <p className="confirm-text">
          {deleteDialog.kind === "folder"
            ? `确定删除文件夹“${deleteDialog.folder}”及其中的收集表吗？`
            : `确定删除收集表“${deleteDialog.fileName}”吗？`}
        </p>
        <div className="dialog-actions">
          <button onClick={onCancel}>取消</button>
          <button className="danger-action" onClick={onConfirm}>
            删除
          </button>
        </div>
      </section>
    </div>
  );
}

export function FlowDeleteDialog({
  error,
  name,
  onCancel,
  onConfirm,
  submitting,
}: {
  error: string;
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation.trim() === name;

  return (
    <div className="modal-backdrop" onClick={() => {
      if (!submitting) onCancel();
    }}>
      <section
        aria-labelledby="flow-delete-title"
        className="rename-dialog flow-delete-dialog"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
      >
        <div className="flow-delete-heading">
          <span aria-hidden="true">!</span>
          <div>
            <h2 id="flow-delete-title">永久删除流程</h2>
            <p>此操作无法撤销。</p>
          </div>
        </div>
        <div className="flow-delete-warning">
          <strong>删除“{name}”后，下列数据将被永久清除：</strong>
          <ul>
            <li>流程草稿、发布版本和分享链接</li>
            <li>全部学生填写进度、草稿和提交记录</li>
            <li>节点运行配置和学生截止时间特例</li>
          </ul>
        </div>
        <label className="flow-delete-confirmation">
          <span>请输入流程名称 <strong>{name}</strong> 以确认</span>
          <input
            autoComplete="off"
            autoFocus
            disabled={submitting}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="输入完整流程名称"
            value={confirmation}
          />
        </label>
        {error ? <p className="flow-delete-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button disabled={submitting} onClick={onCancel}>取消</button>
          <button
            className="danger-action"
            disabled={submitting || !confirmed}
            onClick={onConfirm}
          >
            {submitting ? "正在删除" : "永久删除"}
          </button>
        </div>
      </section>
    </div>
  );
}
