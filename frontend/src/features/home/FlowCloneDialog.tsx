import { useEffect, useRef } from "react";

import type { AcademicProcess } from "../../types";

export type FlowCloneResult = { id: string; name: string } | null;

export function FlowCloneDialog({
  error,
  name,
  onCancel,
  onConfirm,
  onEdit,
  onNameChange,
  onStay,
  result,
  source,
  submitting,
}: {
  error: string;
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  onEdit: () => void;
  onNameChange: (value: string) => void;
  onStay: () => void;
  result: FlowCloneResult;
  source: AcademicProcess;
  submitting: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!result) inputRef.current?.select();
  }, [result, source.id]);

  const close = result ? onStay : onCancel;

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) close();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [close, submitting]);

  return (
    <div
      className="modal-backdrop flow-clone-backdrop"
      onClick={() => {
        if (!submitting) close();
      }}
    >
      <section
        aria-labelledby="flow-clone-title"
        aria-modal="true"
        className={`flow-clone-dialog${result ? " success" : ""}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button
          aria-label="关闭复制流程弹窗"
          className="flow-clone-close"
          disabled={submitting}
          onClick={close}
          type="button"
        >
          ×
        </button>

        {result ? (
          <div className="flow-clone-success" aria-live="polite">
            <span className="flow-clone-success-icon" aria-hidden="true">✓</span>
            <h2 id="flow-clone-title">流程副本已创建</h2>
            <strong>{result.name}</strong>
            <p>未发布 · 可完整编辑</p>
            <div className="flow-clone-actions">
              <button autoFocus onClick={onStay} type="button">留在流程列表</button>
              <button className="primary-action" onClick={onEdit} type="button">进入编辑</button>
            </div>
          </div>
        ) : (
          <>
            <header className="flow-clone-heading">
              <span className="flow-clone-heading-icon" aria-hidden="true">
                <i />
              </span>
              <div>
                <h2 id="flow-clone-title">复制流程</h2>
                <p>创建一份可独立编辑的新流程</p>
              </div>
            </header>

            <div className="flow-clone-source">
              <span>来源流程</span>
              <strong>{source.name}</strong>
              <em>{source.published ? "已发布" : "未发布"}</em>
            </div>

            <div className="flow-clone-boundaries">
              <p><strong>将复制</strong><span>节点、连线、规则、模板</span></p>
              <p><strong>不会复制</strong><span>学生名单、发布状态、填写数据</span></p>
            </div>

            <label className="flow-clone-name">
              <span>新流程名称</span>
              <input
                autoFocus
                disabled={submitting}
                maxLength={120}
                onChange={(event) => onNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !submitting) onConfirm();
                }}
                ref={inputRef}
                value={name}
              />
            </label>
            {error ? <p className="flow-clone-error" role="alert">{error}</p> : null}

            <div className="flow-clone-actions">
              <button disabled={submitting} onClick={onCancel} type="button">取消</button>
              <button
                className="primary-action"
                disabled={submitting}
                onClick={onConfirm}
                type="button"
              >
                {submitting ? "正在复制模板…" : "创建流程副本"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
