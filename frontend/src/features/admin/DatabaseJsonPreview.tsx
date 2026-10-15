import { useEffect, useRef } from "react";

export function formatJsonContainer(value: string): string | null {
  if (!/^[\s]*[\[{]/.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") return null;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

export function DatabaseJsonPreview({
  field,
  json,
  onClose,
}: {
  field: string;
  json: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const tokens = json.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g);

  return (
    <dialog
      ref={dialog}
      className="database-json-preview"
      aria-labelledby="database-json-preview-title"
      onMouseDown={(event) => event.stopPropagation()}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <header>
        <div>
          <h2 id="database-json-preview-title">{field}</h2>
          <p>JSON 只读预览</p>
        </div>
        <button type="button" aria-label="关闭 JSON 预览" onClick={onClose} autoFocus>×</button>
      </header>
      <pre tabIndex={0} aria-label={`${field} JSON 内容`}><code>{tokens.map((token, index) => {
        if (index % 2 === 0) return token;
        const kind = token.startsWith('"')
          ? token.endsWith(":") ? "key" : "string"
          : /^(true|false|null)$/.test(token) ? "literal" : "number";
        return <span key={index} className={`database-json-${kind}`}>{token}</span>;
      })}</code></pre>
    </dialog>
  );
}
