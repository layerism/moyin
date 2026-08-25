import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { AnswerSheetMarkdown } from "./AnswerSheetMarkdown";
import { resolveMarkdownEditorMode } from "./markdownBlurEditor";

export function MarkdownBlurEditor({
  compact = false,
  disabled,
  onChange,
  placeholder = "点击编辑 Markdown",
  value,
}: {
  compact?: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mode = resolveMarkdownEditorMode({ disabled, focused });

  useEffect(() => {
    if (mode === "source") textareaRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (disabled) setFocused(false);
  }, [disabled]);

  if (mode === "source") {
    return (
      <textarea
        aria-label="Markdown 源码"
        className={`markdown-blur-source${compact ? " is-compact" : ""}`}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
        }}
        placeholder={placeholder}
        ref={textareaRef}
        rows={compact ? 1 : 3}
        value={value}
      />
    );
  }

  const beginEditing = () => {
    if (!disabled) setFocused(true);
  };
  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    setFocused(true);
  };

  return (
    <div
      aria-label={disabled ? undefined : "点击编辑 Markdown"}
      className={`markdown-blur-preview${compact ? " is-compact" : ""}${disabled ? " is-disabled" : ""}`}
      onClick={beginEditing}
      onKeyDown={handlePreviewKeyDown}
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? undefined : 0}
    >
      {value.trim() ? (
        <AnswerSheetMarkdown>{value}</AnswerSheetMarkdown>
      ) : (
        <span className="markdown-blur-placeholder">{placeholder}</span>
      )}
    </div>
  );
}
