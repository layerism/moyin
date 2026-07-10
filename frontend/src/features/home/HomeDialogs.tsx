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
  onCancel,
  onConfirm,
  onValueChange,
  placeholder,
  title,
  value,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  onValueChange: (value: string) => void;
  placeholder: string;
  title: string;
  value: string;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <section className="rename-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <input
          autoFocus
          placeholder={placeholder}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onConfirm();
            }
          }}
        />
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

export function FlowArchiveDialog({
  name,
  onCancel,
  onConfirm,
  submitting,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <section className="rename-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>确认删除流程</h2>
        <p className="confirm-text">确定删除流程“{name}”吗？</p>
        <p className="archive-retention-note">删除后将从列表隐藏，历史数据不会清除。</p>
        <div className="dialog-actions">
          <button disabled={submitting} onClick={onCancel}>取消</button>
          <button className="danger-action" disabled={submitting} onClick={onConfirm}>
            {submitting ? "处理中" : "确认删除"}
          </button>
        </div>
      </section>
    </div>
  );
}
