import { useEffect } from "react";

export function UnsavedChangesDialog({
  destination,
  onCancel,
  onConfirm,
}: {
  destination: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="unsaved-changes-backdrop" role="presentation">
      <section
        aria-labelledby="unsaved-changes-title"
        aria-modal="true"
        className="unsaved-changes-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span>未发布修改</span>
            <h2 id="unsaved-changes-title">放弃未发布的修改？</h2>
          </div>
          <button aria-label="继续编辑" onClick={onCancel} type="button">
            ×
          </button>
        </header>

        <p className="unsaved-changes-warning">
          当前修改仅保存在本页面。离开后将无法恢复，但已发布版本不会受到影响。
        </p>
        <p className="unsaved-changes-destination">
          <span>即将前往</span>
          <strong>{destination}</strong>
        </p>

        <footer>
          <button autoFocus onClick={onCancel} type="button">
            继续编辑
          </button>
          <button className="danger-action" onClick={onConfirm} type="button">
            放弃修改并离开
          </button>
        </footer>
      </section>
    </div>
  );
}
