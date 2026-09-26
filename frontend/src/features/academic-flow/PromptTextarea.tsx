import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

type Snapshot = { value: string; start: number; end: number; direction: "forward" | "backward" | "none" };
const snapshot = (element: HTMLTextAreaElement): Snapshot => ({
  value: element.value, start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection,
});

export function PromptTextarea({ value, onChange, disabled, minLength, maxLength }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  minLength: number;
  maxLength: number;
}) {
  const elementRef = useRef<HTMLTextAreaElement>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const current = useRef<Snapshot>({ value, start: 0, end: 0, direction: "none" });
  const before = useRef<Snapshot | null>(null);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const composition = useRef<Snapshot | null>(null);
  const group = useRef<{ type: string; time: number; start: number; end: number } | null>(null);

  const restore = useCallback((forward: boolean) => {
    const element = elementRef.current;
    if (!element || element.disabled || composition.current) return;
    const from = forward ? redo.current : undo.current;
    const previous = from.pop();
    if (!previous) return;
    (forward ? undo.current : redo.current).push(snapshot(element));
    group.current = null;
    before.current = null;
    current.current = previous;
    element.value = previous.value;
    element.setSelectionRange(previous.start, previous.end, previous.direction);
    callback.current(previous.value);
  }, []);

  useLayoutEffect(() => {
    // A different externally supplied value starts a new editing history.
    if (current.current.value === value) return;
    current.current = { value, start: 0, end: 0, direction: "none" };
    undo.current = [];
    redo.current = [];
    group.current = null;
    before.current = null;
  }, [value]);

  useEffect(() => {
    const element = elementRef.current!;
    const capture = (event: InputEvent) => {
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        event.preventDefault();
        restore(event.inputType === "historyRedo");
      } else if (!composition.current) before.current = snapshot(element);
    };
    element.addEventListener("beforeinput", capture);
    return () => element.removeEventListener("beforeinput", capture);
  }, [restore]);

  return <textarea ref={elementRef} value={value} disabled={disabled} minLength={minLength} maxLength={maxLength}
    onPointerDown={() => { group.current = null; }}
    onBlur={() => { group.current = null; }}
    onSelect={(event) => { current.current = snapshot(event.currentTarget); }}
    onCompositionStart={(event) => {
      composition.current = snapshot(event.currentTarget);
      before.current = null;
      group.current = null;
    }}
    onCompositionEnd={(event) => {
      const after = snapshot(event.currentTarget);
      if (composition.current && composition.current.value !== after.value) {
        undo.current.push(composition.current);
        redo.current = [];
      }
      composition.current = null;
      current.current = after;
      before.current = null;
      group.current = null;
      callback.current(after.value);
    }}
    onKeyDown={(event) => {
      if (composition.current || event.nativeEvent.isComposing) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === "z" || key === "y")) {
        event.preventDefault();
        event.stopPropagation();
        restore(key === "y" || event.shiftKey);
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        group.current = null;
      }
    }}
    onChange={(event) => {
      const after = snapshot(event.currentTarget);
      const previous = before.current ?? current.current;
      before.current = null;
      if (after.value !== previous.value && !composition.current) {
        const type = (event.nativeEvent as InputEvent).inputType;
        const continuous = previous.start === previous.end
          && ["insertText", "deleteContentBackward", "deleteContentForward"].includes(type);
        const time = Date.now();
        const merge = continuous && group.current?.type === type && time - group.current.time < 1000
          && group.current.start === previous.start && group.current.end === previous.end;
        if (!merge) undo.current.push(previous);
        redo.current = [];
        group.current = continuous ? { type, time, start: after.start, end: after.end } : null;
      }
      current.current = after;
      callback.current(after.value);
    }}
  />;
}
