# Node Date-Time Picker Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-native node time inputs and their adjacent confirmation buttons with a dependency-free custom date-time popover whose only exit is its internal confirmation button.

**Architecture:** Add a focused `NodeDateTimePicker` React component that owns temporary calendar and time state, renders through a portal above the node settings modal, traps interaction and focus, and returns one confirmed ISO value. `NodeInspector` remains responsible for mapping that value to `startAt` or `deadlineAt`; existing status, summary, clear, persistence, and publication paths remain unchanged.

**Tech Stack:** React 18 hooks, React DOM portal, TypeScript, JavaScript `Date`, CSS Grid, Vite.

## Global Constraints

- Work on the current branch.
- Preserve the existing user changes in `AGENTS.md`, `docs/05_oa_graph.md`, and `.superpowers/`.
- Follow `docs/superpowers/specs/2026-07-25-node-date-time-picker-confirmation-design.md`; it supersedes the 2026-07-24 adjacent-confirm design.
- Modify only `frontend/src/features/academic-flow/NodeDateTimePicker.tsx`, `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx`, and `frontend/src/styles.css`.
- Do not modify backend files, API signatures, `AcademicFlowNode`, `commitDesignChange`, database state, or publication rules.
- Do not add dependencies, a general component library, global state, or a second date-time implementation.
- Remove the existing field-adjacent confirmation buttons and their draft state.
- Keep “清除” beside each field and preserve its immediate `null` update.
- The custom picker must contain month navigation, a fixed 6×7 calendar, hour `00`–`23`, minute `00`–`59`, and its internal “确认”.
- An open picker must not close through backdrop click, outside scrolling or touch, `Escape`, a cancel button, or a close button.
- Only the picker may be operated while it is open; `Tab` and `Shift+Tab` must remain within it.
- Confirmation must close only the picker, update only its own node field, and keep the node settings modal open.
- Existing values initialize from that field; empty values initialize from the current local minute.
- Preserve local-time display and convert the confirmed local minute to an ISO string with seconds and milliseconds set to zero.
- Preserve the existing time status, validation summary, revision permissions, and outer `fieldset` locking.
- Desktop positioning must prefer below the trigger, fall back above it, and stay inside viewport margins.
- Narrow layouts must keep the picker inside the viewport, allow only picker-internal scrolling, and keep “确认” reachable.
- Follow the existing white panel, gray border, blue primary action, and radius language.
- Do not run automated tests, builds, TypeScript compilation, browser automation, or Browser-plugin validation.
- Perform only static state-flow, date-boundary, focus, portal, and responsive-style inspection; then clean project caches and restart local services without Docker.
- Create one final implementation commit after all code changes; do not make intermediate implementation commits.

---

### Task 1: Build and integrate the mandatory-confirm date-time popover

**Files:**
- Create: `frontend/src/features/academic-flow/NodeDateTimePicker.tsx`
- Modify: `frontend/src/features/academic-flow/AcademicFlowDesigner.tsx:1-45,1361-1520,1735-1750`
- Modify: `frontend/src/styles.css:2285-2390,4960-5010`
- Reference: `docs/superpowers/specs/2026-07-25-node-date-time-picker-confirmation-design.md`

**Interfaces:**
- Produces:

```ts
export type NodeDateTimePickerProps = {
  ariaLabel: string;
  disabled?: boolean;
  onConfirm: (value: string) => void;
  value: string | null;
};

export function NodeDateTimePicker(props: NodeDateTimePickerProps): JSX.Element;
```

- Consumes: an ISO string or `null`, the browser viewport, and a field-local `onConfirm`.
- Returns: one ISO string created from the selected local year, month, day, hour, and minute.
- Integrates as:

```tsx
<NodeDateTimePicker
  ariaLabel="起始时间"
  onConfirm={(startAt) => onUpdateNode(node.id, { startAt })}
  value={node.startAt}
/>
```

and equivalently for `deadlineAt`.

- [ ] **Step 1: Reconfirm the implementation boundary before editing**

Run:

```bash
git branch --show-current
git status --short
git diff -- frontend/src/features/academic-flow/NodeDateTimePicker.tsx frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
```

Expected:

- The branch is the current project branch rather than `main` or `master`.
- Existing unrelated changes remain present but unstaged.
- `AcademicFlowDesigner.tsx` and `styles.css` contain no new uncommitted user changes after commit `04caa5d`.
- `NodeDateTimePicker.tsx` does not yet exist.
- If a target file has overlapping uncommitted changes, stop and reconcile the overlap before editing.

- [ ] **Step 2: Create the component types, constants, and local date helpers**

Create `frontend/src/features/academic-flow/NodeDateTimePicker.tsx` with these imports, types, and constants:

```tsx
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type NodeDateTimePickerProps = {
  ariaLabel: string;
  disabled?: boolean;
  onConfirm: (value: string) => void;
  value: string | null;
};

type PickerPosition = {
  left: number;
  top: number;
  visible: boolean;
};

const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
const hours = Array.from({ length: 24 }, (_, index) => index);
const minutes = Array.from({ length: 60 }, (_, index) => index);
const focusableSelector = "button:not(:disabled)";
const viewportMargin = 12;
const pickerGap = 8;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function normalizeToLocalMinute(source: Date) {
  return new Date(
    source.getFullYear(),
    source.getMonth(),
    source.getDate(),
    source.getHours(),
    source.getMinutes(),
    0,
    0,
  );
}

function getInitialDate(value: string | null) {
  const parsed = value ? new Date(value) : new Date();
  return normalizeToLocalMinute(
    Number.isNaN(parsed.getTime()) ? new Date() : parsed,
  );
}

function formatLocalDateTime(value: string | null) {
  if (!value) return "年/月/日 --:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "年/月/日 --:--";
  return [
    `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
}

function sameLocalDate(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function shiftMonth(source: Date, offset: number) {
  const targetMonthStart = new Date(
    source.getFullYear(),
    source.getMonth() + offset,
    1,
  );
  const targetLastDay = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0,
  ).getDate();
  return new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth(),
    Math.min(source.getDate(), targetLastDay),
    source.getHours(),
    source.getMinutes(),
    0,
    0,
  );
}

function buildCalendar(selected: Date) {
  const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const gridStart = new Date(
    selected.getFullYear(),
    selected.getMonth(),
    1 - monthStart.getDay(),
  );
  return Array.from({ length: 42 }, (_, index) => new Date(
    gridStart.getFullYear(),
    gridStart.getMonth(),
    gridStart.getDate() + index,
  ));
}

function replaceLocalDate(source: Date, selectedDay: Date) {
  return new Date(
    selectedDay.getFullYear(),
    selectedDay.getMonth(),
    selectedDay.getDate(),
    source.getHours(),
    source.getMinutes(),
    0,
    0,
  );
}

function replaceLocalTime(
  source: Date,
  next: { hour?: number; minute?: number },
) {
  return new Date(
    source.getFullYear(),
    source.getMonth(),
    source.getDate(),
    next.hour ?? source.getHours(),
    next.minute ?? source.getMinutes(),
    0,
    0,
  );
}
```

These helpers intentionally use local `Date` constructors. Do not parse a hand-built date string, because browser parsing differences would change the timezone semantics.

- [ ] **Step 3: Add picker state, opening, positioning, focus, and mandatory-close behavior**

Add the component shell:

```tsx
export function NodeDateTimePicker({
  ariaLabel,
  disabled = false,
  onConfirm,
  value,
}: NodeDateTimePickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const selectedDayRef = useRef<HTMLButtonElement>(null);
  const selectedHourRef = useRef<HTMLButtonElement>(null);
  const selectedMinuteRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(() => getInitialDate(value));
  const [position, setPosition] = useState<PickerPosition>({
    left: viewportMargin,
    top: viewportMargin,
    visible: false,
  });

  const calendarDays = useMemo(() => buildCalendar(selected), [selected]);
  const today = normalizeToLocalMinute(new Date());

  const openPicker = () => {
    setSelected(getInitialDate(value));
    setPosition((current) => ({ ...current, visible: false }));
    setOpen(true);
  };

  const confirmSelection = () => {
    onConfirm(normalizeToLocalMinute(selected).toISOString());
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
```

Add a layout effect that positions the fixed portal panel after it renders and recalculates on viewport resize:

```tsx
  useLayoutEffect(() => {
    if (!open) return undefined;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const dialog = dialogRef.current;
      if (!trigger || !dialog) return;

      const triggerRect = trigger.getBoundingClientRect();
      const dialogRect = dialog.getBoundingClientRect();
      const maximumLeft = Math.max(
        viewportMargin,
        window.innerWidth - dialogRect.width - viewportMargin,
      );
      const left = Math.min(
        Math.max(viewportMargin, triggerRect.left),
        maximumLeft,
      );
      const below = triggerRect.bottom + pickerGap;
      const above = triggerRect.top - dialogRect.height - pickerGap;
      const top = below + dialogRect.height <= window.innerHeight - viewportMargin
        ? below
        : Math.max(viewportMargin, above);

      setPosition({ left, top, visible: true });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open]);
```

Add initial focus and selected time-list centering:

```tsx
  useEffect(() => {
    if (!open || !position.visible) return;
    selectedDayRef.current?.focus();
    selectedHourRef.current?.scrollIntoView({ block: "center" });
    selectedMinuteRef.current?.scrollIntoView({ block: "center" });
  }, [open, position.visible]);
```

Add the keyboard boundary:

```tsx
  const containKeyboardFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>(focusableSelector) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
```

Do not add a backdrop close handler, cancel action, close icon, or `Escape` close path.

- [ ] **Step 4: Render the trigger and portal calendar**

Return a trigger button whose display is always based on the confirmed `value`:

```tsx
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className="node-date-time-trigger"
        disabled={disabled}
        onClick={openPicker}
        ref={triggerRef}
        type="button"
      >
        <span>{formatLocalDateTime(value)}</span>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
        </svg>
      </button>
      {open ? createPortal(
        <div
          className="node-date-time-picker-overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              dialogRef.current?.focus();
            }
          }}
          onTouchMove={(event) => {
            if (event.target === event.currentTarget) event.preventDefault();
          }}
          onWheel={(event) => {
            if (event.target === event.currentTarget) event.preventDefault();
          }}
        >
          <section
            aria-label={`${ariaLabel}选择器`}
            aria-modal="true"
            className="node-date-time-picker"
            onKeyDown={containKeyboardFocus}
            ref={dialogRef}
            role="dialog"
            style={{
              left: position.left,
              top: position.top,
              visibility: position.visible ? "visible" : "hidden",
            }}
            tabIndex={-1}
          >
            <div className="node-date-time-picker-body">
              <div className="node-date-time-calendar">
                <header>
                  <strong>
                    {selected.getFullYear()}年{pad(selected.getMonth() + 1)}月
                  </strong>
                  <div>
                    <button
                      aria-label="上一个月"
                      onClick={() => setSelected((current) => shiftMonth(current, -1))}
                      type="button"
                    >
                      ‹
                    </button>
                    <button
                      aria-label="下一个月"
                      onClick={() => setSelected((current) => shiftMonth(current, 1))}
                      type="button"
                    >
                      ›
                    </button>
                  </div>
                </header>
                <div className="node-date-time-weekdays" aria-hidden="true">
                  {weekDays.map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="node-date-time-days">
                  {calendarDays.map((day) => {
                    const selectedDay = sameLocalDate(day, selected);
                    const currentMonth = day.getMonth() === selected.getMonth();
                    const isToday = sameLocalDate(day, today);
                    return (
                      <button
                        aria-label={`${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日`}
                        aria-pressed={selectedDay}
                        className={[
                          selectedDay ? "is-selected" : "",
                          currentMonth ? "" : "is-adjacent",
                          isToday ? "is-today" : "",
                        ].filter(Boolean).join(" ")}
                        key={`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`}
                        onClick={() => setSelected((current) => replaceLocalDate(current, day))}
                        ref={selectedDay ? selectedDayRef : undefined}
                        type="button"
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
```

Continue the same body with two scrollable time lists:

```tsx
              <div className="node-date-time-time">
                <div>
                  <strong>小时</strong>
                  <div className="node-date-time-options" role="listbox" aria-label="小时">
                    {hours.map((hour) => {
                      const active = selected.getHours() === hour;
                      return (
                        <button
                          aria-selected={active}
                          className={active ? "is-selected" : ""}
                          key={hour}
                          onClick={() => setSelected((current) => replaceLocalTime(current, { hour }))}
                          ref={active ? selectedHourRef : undefined}
                          role="option"
                          type="button"
                        >
                          {pad(hour)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <strong>分钟</strong>
                  <div className="node-date-time-options" role="listbox" aria-label="分钟">
                    {minutes.map((minute) => {
                      const active = selected.getMinutes() === minute;
                      return (
                        <button
                          aria-selected={active}
                          className={active ? "is-selected" : ""}
                          key={minute}
                          onClick={() => setSelected((current) => replaceLocalTime(current, { minute }))}
                          ref={active ? selectedMinuteRef : undefined}
                          role="option"
                          type="button"
                        >
                          {pad(minute)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            <footer className="node-date-time-picker-footer">
              <span>
                {selected.getFullYear()}/{pad(selected.getMonth() + 1)}/{pad(selected.getDate())}
                {" "}
                {pad(selected.getHours())}:{pad(selected.getMinutes())}
              </span>
              <button onClick={confirmSelection} type="button">确认</button>
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
```

The overlay is deliberately transparent. It exists to intercept interaction, not to introduce another visual modal layer over the node settings panel.

- [ ] **Step 5: Replace both native inputs and adjacent confirm actions in `NodeInspector`**

Add the import beside the other academic-flow feature imports:

```tsx
import { NodeDateTimePicker } from "./NodeDateTimePicker";
```

Remove all obsolete field-draft code:

```tsx
const [startAtDraft, setStartAtDraft] = useState("");
const [deadlineAtDraft, setDeadlineAtDraft] = useState("");
```

Remove both draft synchronization effects and the `confirmedStartAt` / `confirmedDeadlineAt` strings.

Replace the start-time label with:

```tsx
<div className="node-time-window-field">
  <span>起始时间</span>
  <NodeDateTimePicker
    ariaLabel="起始时间"
    onConfirm={(startAt) => onUpdateNode(node.id, { startAt })}
    value={node.startAt}
  />
  {node.startAt ? (
    <button
      onClick={() => onUpdateNode(node.id, { startAt: null })}
      type="button"
    >
      清除
    </button>
  ) : null}
</div>
```

Replace the deadline label with:

```tsx
<div className="node-time-window-field">
  <span>截止时间</span>
  <NodeDateTimePicker
    ariaLabel="截止时间"
    onConfirm={(deadlineAt) => onUpdateNode(node.id, { deadlineAt })}
    value={node.deadlineAt}
  />
  {node.deadlineAt ? (
    <button
      onClick={() => onUpdateNode(node.id, { deadlineAt: null })}
      type="button"
    >
      清除
    </button>
  ) : null}
</div>
```

Do not pass `editingLocked`: the existing disabled `fieldset` disables the trigger and clear buttons in their normal DOM location. The picker cannot already be open when the user changes this lock through the blocked background UI.

After replacement, run:

```bash
rg -n "toLocalDateTime" frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
```

Expected: only the now-unused helper definition remains. Remove that helper completely. Do not remove `useState`, because `AcademicFlowDesigner.tsx` uses it elsewhere.

- [ ] **Step 6: Replace the field-adjacent confirm CSS with field and trigger styles**

Replace the current `.node-time-window-fields label` through `.node-time-window-confirm:disabled` block with:

```css
.node-time-window-field {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  color: #334155;
  font-size: 13px;
  font-weight: 750;
}

.node-time-window-field > span {
  grid-column: 1 / -1;
}

.node-time-window-field > button:not(.node-date-time-trigger) {
  padding: 0 9px;
  border: 1px solid #94a3b8;
  border-radius: 5px;
  background: #fff;
  color: #475569;
  font-weight: 700;
}

.node-date-time-trigger {
  min-width: 0;
  min-height: 36px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid #d7dfe9;
  border-radius: 5px;
  background: #fff;
  color: #1f2937;
  text-align: left;
}

.node-date-time-trigger > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-date-time-trigger > svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}
```

The adjacent “确认” styles must be deleted. Do not leave `.node-time-window-confirm` in the stylesheet.

- [ ] **Step 7: Add portal overlay, calendar, time-list, and confirmation styles**

Add these styles after the node time-window field styles:

```css
.node-date-time-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: none;
}

.node-date-time-picker {
  position: fixed;
  width: min(560px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  overscroll-behavior: contain;
  touch-action: auto;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  outline: none;
  background: #fff;
  box-shadow: 0 22px 64px rgba(15, 23, 42, 0.28);
}

.node-date-time-picker-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 176px;
  min-height: 330px;
}

.node-date-time-calendar {
  padding: 18px;
}

.node-date-time-calendar > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.node-date-time-calendar > header > div {
  display: flex;
  gap: 6px;
}

.node-date-time-calendar > header button {
  width: 34px;
  height: 34px;
  border: 1px solid #d7dfe9;
  border-radius: 5px;
  background: #fff;
  color: #334155;
  font-size: 22px;
}

.node-date-time-weekdays,
.node-date-time-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}

.node-date-time-weekdays {
  margin-bottom: 5px;
  color: #64748b;
  font-size: 12px;
  text-align: center;
}

.node-date-time-days button {
  aspect-ratio: 1;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #1f2937;
}

.node-date-time-days button:hover,
.node-date-time-calendar > header button:hover {
  border-color: #93b4ea;
  background: #eff6ff;
}

.node-date-time-days button.is-adjacent {
  color: #94a3b8;
}

.node-date-time-days button.is-today {
  border-color: #93b4ea;
}

.node-date-time-days button.is-selected {
  border-color: #2874f6;
  background: #2874f6;
  color: #fff;
  font-weight: 800;
}

.node-date-time-time {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 18px 14px;
  border-left: 1px solid #e2e8f0;
  background: #f8fafc;
}

.node-date-time-time > div {
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  text-align: center;
}

.node-date-time-options {
  max-height: 282px;
  display: grid;
  gap: 4px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.node-date-time-options button {
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #334155;
}

.node-date-time-options button:hover {
  border-color: #93b4ea;
  background: #eff6ff;
}

.node-date-time-options button.is-selected {
  border-color: #2874f6;
  background: #2874f6;
  color: #fff;
  font-weight: 800;
}

.node-date-time-picker-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 12px 18px;
  border-top: 1px solid #e2e8f0;
  background: #fff;
}

.node-date-time-picker-footer > span {
  color: #475569;
  font-variant-numeric: tabular-nums;
  font-weight: 750;
}

.node-date-time-picker-footer > button {
  min-width: 84px;
  min-height: 36px;
  border: 1px solid #2874f6;
  border-radius: 5px;
  background: #2874f6;
  color: #fff;
  font-weight: 800;
}
```

Do not give the overlay a visible backdrop color. The existing node settings modal and its page backdrop must remain visually unchanged.

- [ ] **Step 8: Replace obsolete narrow-screen field rules and add picker responsiveness**

Inside the existing `@media (max-width: 760px)` block, delete:

```css
.node-time-window-fields label {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.node-time-window-fields label > input {
  grid-column: 1 / -1;
}

.node-time-window-fields label > button {
  width: 100%;
}

.node-time-window-fields label > button:only-of-type {
  grid-column: 1 / -1;
}
```

Add:

```css
.node-time-window-field > button {
  min-height: 38px;
}

.node-date-time-picker {
  width: calc(100vw - 24px);
}

.node-date-time-picker-body {
  grid-template-columns: 1fr;
}

.node-date-time-time {
  min-height: 190px;
  border-top: 1px solid #e2e8f0;
  border-left: 0;
}

.node-date-time-options {
  max-height: 140px;
}

.node-date-time-picker-footer {
  justify-content: space-between;
}
```

The trigger plus optional clear button remain in one field row. The picker itself may scroll internally if the viewport is shorter than its content.

- [ ] **Step 9: Perform the project-approved static audit**

Run:

```bash
rg -n "NodeDateTimePicker|createPortal|buildCalendar|shiftMonth|replaceLocalDate|replaceLocalTime|confirmSelection|focusableSelector" frontend/src/features/academic-flow/NodeDateTimePicker.tsx frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
rg -n "datetime-local|startAtDraft|deadlineAtDraft|confirmedStartAt|confirmedDeadlineAt|node-time-window-confirm|toLocalDateTime" frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
rg -n "onConfirm=|startAt: null|deadlineAt: null|getTimeWindowStatus\\(node\\)|getTimeWindowSummary\\(node\\)" frontend/src/features/academic-flow/AcademicFlowDesigner.tsx
rg -n "node-date-time-picker|node-date-time-trigger|node-time-window-field" frontend/src/styles.css
git diff --check -- frontend/src/features/academic-flow/NodeDateTimePicker.tsx frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
git diff -- frontend/src/features/academic-flow/NodeDateTimePicker.tsx frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
```

Expected:

- The first search shows one focused picker component and two field integrations.
- The obsolete-symbol search produces no output.
- `buildCalendar` always creates 42 dates.
- `shiftMonth` clamps the selected day to the target month’s last valid day and naturally handles year boundaries.
- All constructed confirmed dates set seconds and milliseconds to zero before `toISOString()`.
- The trigger display reads only confirmed `value`; temporary selection remains inside the picker.
- The overlay has no outside-close callback, cancel control, or close control.
- `Escape` is prevented and stopped.
- The focus selector stays inside `dialogRef`; selected date, hour, and minute receive refs.
- Confirmation calls one `onConfirm`, closes only local picker state, and returns focus to the trigger.
- `NodeInspector` maps each picker to only its own field.
- Clear actions still immediately write `null`.
- Status and summary still read the confirmed `node`.
- The portal has a higher z-index than `.node-inspector-backdrop` (`40`).
- Desktop and narrow CSS keep picker content inside viewport limits with internal overflow.
- `git diff --check` produces no output.
- The diff contains only the three approved frontend files.

Do not run `npm test`, `npm run build`, TypeScript compilation, Playwright, Browser-plugin actions, or browser automation.

- [ ] **Step 10: Clean project-generated caches without touching the virtual environment**

Enumerate only project caches outside `backend/.venv`:

```bash
find backend frontend \
  -path 'backend/.venv' -prune -o \
  -type d \( -name '.pytest_cache' -o -name '__pycache__' -o -name '*.egg-info' \) \
  -print
```

Remove only the exact paths printed by that command. Do not remove anything inside `backend/.venv`, `frontend/node_modules`, or the user-owned `.superpowers` tree.

- [ ] **Step 11: Restart local services without Docker**

Resolve exact listeners:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Send `TERM` only to the PIDs returned for those two ports. Then start:

```bash
cd backend
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

Confirm listener ownership:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Expected: Uvicorn listens on `127.0.0.1:8000` and Vite listens on `127.0.0.1:5173`. Do not use Docker and do not open or automate a browser.

- [ ] **Step 12: Create the single final implementation checkpoint**

Reconfirm exact scope:

```bash
git status --short
git diff -- frontend/src/features/academic-flow/NodeDateTimePicker.tsx frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
git add frontend/src/features/academic-flow/NodeDateTimePicker.tsx frontend/src/features/academic-flow/AcademicFlowDesigner.tsx frontend/src/styles.css
git diff --cached --name-only
git diff --cached --stat
git diff --cached --check
```

Expected: only the three approved frontend files are staged; all pre-existing user changes remain unstaged.

Commit:

```bash
git commit -m "feat: confirm node time inside custom picker"
```

Hand the restarted application to the user for manual verification against all fifteen acceptance criteria in the design document.
