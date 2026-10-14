import type { RevisionImpact } from "./runtimeTypes";

export function RevisionImpactDialog({
  confirming,
  impact,
  onCancel,
  onConfirm,
}: {
  confirming: boolean;
  impact: RevisionImpact;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const currentVersion = impact.currentVersionNo === null ? "无" : `v${impact.currentVersionNo}`;

  return (
    <div
      className="revision-impact-backdrop"
      onMouseDown={() => {
        if (!confirming) onCancel();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="revision-impact-title"
        aria-modal="true"
        className="revision-impact-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span>重新发布影响确认</span>
            <h2 id="revision-impact-title">确认发布流程修订</h2>
          </div>
          <button aria-label="关闭影响确认" disabled={confirming} onClick={onCancel} type="button">
            ×
          </button>
        </header>

        <div className="revision-version-change">
          <strong>{currentVersion}</strong>
          <span aria-hidden="true">→</span>
          <strong>v{impact.nextVersionNo}</strong>
        </div>

        <dl className="revision-impact-metrics">
          <div>
            <dt>内容变更节点</dt>
            <dd>{impact.changedNodeIds.length}</dd>
          </div>
          <div>
            <dt>新增节点</dt>
            <dd>{impact.addedNodeIds.length}</dd>
          </div>
          <div>
            <dt>需重新提交节点</dt>
            <dd>{impact.invalidatedNodeIds.length}</dd>
          </div>
          <div>
            <dt>需重做学生</dt>
            <dd>{impact.affectedStudentCount}</dd>
          </div>
        </dl>

        <p className="revision-impact-warning">
          {impact.invalidatedNodeIds.length > 0
            ? "重新发布后，列入重做范围的节点及下游需重新完成。仅修改信息表单的标题、说明或时间不会触发重做；操作资格仍按新时间条件判断。"
            : "重新发布后配置更新，已有完成结果和提交记录保留，无需重新提交；未完成节点的操作资格按生效的时间条件判断。"}
        </p>

        <footer>
          <button disabled={confirming} onClick={onCancel} type="button">
            取消
          </button>
          <button
            className="danger-action"
            disabled={confirming}
            onClick={onConfirm}
            type="button"
          >
            {confirming ? "正在重新发布" : "确认重新发布"}
          </button>
        </footer>
      </section>
    </div>
  );
}
