import { useEffect, useRef } from "react";

export type WorkflowGroupOption = {
  id: string | null;
  name: string;
};

export function MoveWorkflowMenu({
  currentGroupId,
  groups,
  onClose,
  onMove,
}: {
  currentGroupId: string | null;
  groups: WorkflowGroupOption[];
  onClose: () => void;
  onMove: (groupId: string | null) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [onClose]);

  return (
    <div
      aria-label="移动到组"
      className="workflow-move-menu"
      onKeyDown={(event) => {
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
        );
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const offset = event.key === "ArrowDown" ? 1 : -1;
          items[(index + offset + items.length) % items.length]?.focus();
        }
      }}
      ref={menuRef}
      role="menu"
    >
      <strong>移动到组</strong>
      {groups.map((group) => (
        <button
          disabled={group.id === currentGroupId}
          key={group.id ?? "__ungrouped__"}
          onClick={() => onMove(group.id)}
          role="menuitem"
          type="button"
        >
          <span aria-hidden="true">▱</span>{group.name}
        </button>
      ))}
    </div>
  );
}
