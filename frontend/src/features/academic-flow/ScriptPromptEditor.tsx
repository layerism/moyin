import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ScriptPromptEditor({ label, value, disabled, minimumLength = 0, maximumLength, error, onChange }: {
  label: string;
  value: string;
  disabled: boolean;
  minimumLength?: number;
  maximumLength?: number;
  error: string;
  onChange: (value: string) => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [length, setLength] = useState(value.length);
  const valid = length >= minimumLength && (maximumLength === undefined || length <= maximumLength);
  const count = (size: number) => `${size.toLocaleString()}${maximumLength === undefined ? "" : ` / ${maximumLength.toLocaleString()}`} 字符`;

  return <div className="audit-script-config-field script-prompt-field">
    <span>{label}</span>
    <div className="script-prompt-summary">
      <div><p>{value.trim().split("\n")[0] || "尚未填写提示词"}</p><small>{count(value.length)}</small></div>
      <button type="button" disabled={disabled} aria-haspopup="dialog" onClick={() => {
        if (!input.current) return;
        input.current.value = value;
        setLength(value.length);
        dialog.current?.showModal();
        input.current.focus();
        input.current.setSelectionRange(0, 0);
        input.current.scrollTop = 0;
      }}>编辑提示词</button>
    </div>
    {error ? <small className="audit-script-config-error" role="alert">{error}</small> : null}
    {createPortal(<dialog ref={dialog} className="script-config-dialog script-prompt-dialog" aria-labelledby={titleId}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); dialog.current?.close(); }}>
      <header><div><h2 id={titleId}>{label}</h2><span>纯文本编辑，保留原始换行和缩进。</span></div>
        <button type="button" aria-label="关闭提示词编辑" onClick={() => dialog.current?.close()}>×</button>
      </header>
      <div className="script-prompt-body">
        <textarea ref={input} aria-label={label} spellCheck={false} maxLength={maximumLength}
          minLength={minimumLength} onChange={event => setLength(event.currentTarget.value.length)} />
      </div>
      <footer><div><small>{count(length)}</small><p>应用后回填配置，点击外层“保存修改”后生效。</p>
        {!valid ? <p className="audit-script-config-error" role="alert">请输入符合字符长度限制的提示词。</p> : null}</div>
        <div className="script-prompt-actions"><button type="button" onClick={() => dialog.current?.close()}>取消</button>
          <button type="button" className="primary-action" disabled={!valid || disabled} onClick={() => {
            onChange(input.current?.value ?? value);
            dialog.current?.close();
          }}>应用修改</button></div>
      </footer>
    </dialog>, document.body)}
  </div>;
}
