import { useState } from "react";

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
