import { useEffect } from "react";

export function UnsavedChangesDialog({
  destination,
  onCancel,
  onDiscard,
  onSave,
  saving,
}: {
  destination: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, saving]);

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
            <span>未暂存修改</span>
            <h2 id="unsaved-changes-title">当前修改尚未暂存</h2>
          </div>
          <button
            aria-label="继续编辑"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            ×
          </button>
        </header>

        <p className="unsaved-changes-warning">
          你可以先暂存到服务器后离开，或放弃本页面尚未暂存的修改。已发布版本不会受到影响。
        </p>
        <p className="unsaved-changes-destination">
          <span>即将前往</span>
          <strong>{destination}</strong>
        </p>

        <footer>
          <button autoFocus disabled={saving} onClick={onCancel} type="button">
            继续编辑
          </button>
          <button
            className="danger-action"
            disabled={saving}
            onClick={onDiscard}
            type="button"
          >
            不暂存并离开
          </button>
          <button
            className="primary-action"
            disabled={saving}
            onClick={onSave}
            type="button"
          >
            {saving ? "暂存中" : "暂存并离开"}
          </button>
        </footer>
      </section>
    </div>
  );
}
