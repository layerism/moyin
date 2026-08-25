export type MarkdownEditorMode = "preview" | "source";

export function resolveMarkdownEditorMode({
  disabled,
  focused,
}: {
  disabled: boolean;
  focused: boolean;
}): MarkdownEditorMode {
  return disabled || !focused ? "preview" : "source";
}
