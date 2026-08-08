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

  const closePicker = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const confirmSelection = () => {
    onConfirm(normalizeToLocalMinute(selected).toISOString());
    closePicker();
  };

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

  useEffect(() => {
    if (!open || !position.visible) return;
    selectedDayRef.current?.focus();
    selectedHourRef.current?.scrollIntoView({ block: "center" });
    selectedMinuteRef.current?.scrollIntoView({ block: "center" });
  }, [open, position.visible]);

  const containKeyboardFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    const focusable = Array.from(
      dialog?.querySelectorAll<HTMLButtonElement>(focusableSelector) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!dialog?.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

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
              event.stopPropagation();
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
              <div className="node-date-time-picker-actions">
                <button onClick={closePicker} type="button">取消</button>
                <button onClick={confirmSelection} type="button">确认</button>
              </div>
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
