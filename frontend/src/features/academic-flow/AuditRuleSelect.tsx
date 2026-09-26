import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AuditScriptOption, AuditScriptSummary } from "./auditScripts";

export function AuditRuleSelect({ options, scripts, value, disabled, selectionRequired, onChange }: {
  options: AuditScriptOption[];
  scripts: AuditScriptSummary[];
  value: string;
  disabled: boolean;
  selectionRequired: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 300, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();
  const label = (option: AuditScriptOption) => scripts.find(script => `uploaded:${script.id}` === option.value)?.name
    ?? (selectionRequired && !option.value ? "请选择审核规则" : option.label);
  const selected = options.find(option => option.value === value);
  const show = () => {
    setActive(Math.max(0, options.findIndex(option => option.value === value)));
    setOpen(true);
  };
  const choose = (index: number) => {
    if (!options[index]) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => { setOpen(false); }, [value, disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current!.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const upward = below < Math.min(menu.current!.scrollHeight, 320) && above > below;
    const maxHeight = Math.min(320, upward ? above : below);
    const height = Math.min(menu.current!.scrollHeight + 2, maxHeight);
    const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 16);
    setPosition({ width, maxHeight,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: upward ? rect.top - height - 6 : rect.bottom + 6,
    });
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = (event: Event) => {
      if (event.type === "scroll" && menu.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  return <>
    <button ref={trigger} type="button" className={`audit-rule-trigger${value ? " has-value" : ""}`} role="combobox"
      aria-label="材料审核脚本" aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${active}` : undefined} disabled={disabled}
      onClick={() => open ? setOpen(false) : show()}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (!open) { show(); return; }
          setActive(index => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
            : Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
        } else if (open && ["Enter", " "].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); choose(active);
        } else if (open && event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); setOpen(false);
        } else if (event.key === "Tab") setOpen(false);
      }}>
      <span className="audit-rule-trigger-icon" aria-hidden="true">▤</span>
      <span className="audit-rule-trigger-label">{selected ? label(selected) : "请选择审核规则"}</span>
      <span className="audit-rule-chevron" aria-hidden="true">⌄</span>
    </button>
    {open ? createPortal(<div ref={menu} className="audit-rule-menu" style={position} onMouseDown={event => event.preventDefault()}>
      <div className="audit-rule-menu-heading">审核规则<small>{options.filter(option => option.value).length} 项可选</small></div>
      <div id={listId} role="listbox" aria-label="材料审核脚本" className="audit-rule-options">
        {options.map((option, index) => {
          const script = scripts.find(item => `uploaded:${item.id}` === option.value);
          return <div id={`${listId}-${index}`} key={option.value || "none"} role="option" aria-selected={option.value === value}
            className={`audit-rule-option${index === active ? " is-active" : ""}${option.value === value ? " is-selected" : ""}`}
            onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
            <span className="audit-rule-option-icon" aria-hidden="true">{option.value ? "▤" : "−"}</span>
            <span className="audit-rule-option-copy"><strong>{label(option)}</strong>
              <small>{script?.description || (option.value ? "使用已配置的审核规则" : selectionRequired ? "暂不选择，稍后配置" : "提交材料后自动通过")}</small>
            </span><span className="audit-rule-option-check" aria-hidden="true">{option.value === value ? "✓" : ""}</span>
          </div>;
        })}
      </div>
    </div>, document.body) : null}
  </>;
}
