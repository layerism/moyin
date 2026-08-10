import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { AcademicFlowNode } from "../../types";
import { workflowApi } from "./api";
import type { TeacherSubmissionDetail, WorkflowProgress, WorkflowProgressNode, WorkflowProgressStudent } from "./runtimeTypes";

function toLocalDateTimeInput(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function minimumExtensionValue(effectiveDeadline: string) {
  const floor = Math.max(Date.now(), new Date(effectiveDeadline).getTime());
  const nextMinute = Math.floor(floor / 60_000) * 60_000 + 60_000;
  return toLocalDateTimeInput(nextMinute);
}

export function TeacherProgressPanel({
  nodes,
  onClose,
  versionId,
}: {
  nodes: AcademicFlowNode[];
  onClose: () => void;
  versionId: string;
}) {
  const [progress, setProgress] = useState<WorkflowProgress | null>(null);
  const [notice, setNotice] = useState("");
  const [editingInstanceId, setEditingInstanceId] = useState<string | null>(null);
  const [savingExtension, setSavingExtension] = useState(false);
  const [submissionDetail, setSubmissionDetail] = useState<TeacherSubmissionDetail | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [extension, setExtension] = useState({
    deadline: "",
    nodeKey: "",
    reason: "批准个别延期",
  });
  const formNodeKeys = new Set(
    nodes.filter((node) => node.kind === "form").map((node) => node.id),
  );
  const scanNodeKeys = new Set(
    nodes.filter((node) => node.kind === "confirmation" && Boolean(node.templateAsset)).map((node) => node.id),
  );
  const canExtendNode = (node: WorkflowProgressNode) => Boolean(
    node.effectiveDeadline
      && (node.status !== "approved" || formNodeKeys.has(node.nodeKey)),
  );

  const refresh = async () => {
    const value = await workflowApi.getProgress(versionId);
    setProgress(value);
  };

  useEffect(() => {
    void refresh().catch((reason: Error) => setNotice(reason.message));
  }, [versionId]);

  useEffect(() => {
    if (!editingInstanceId) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
    };
  }, [editingInstanceId]);

  useEffect(() => {
    if (!submissionDetail) return;
    const previousOverflow = document.body.style.overflow;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSubmissionDetail(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = previousOverflow;
    };
  }, [submissionDetail]);

  const clearExtension = () => {
    const trigger = editingInstanceId
      ? triggerRefs.current.get(editingInstanceId)
      : undefined;
    setEditingInstanceId(null);
    setExtension({ deadline: "", nodeKey: "", reason: "批准个别延期" });
    if (trigger) {
      window.requestAnimationFrame(() => trigger.focus());
    }
  };

  const openExtension = (student: WorkflowProgressStudent) => {
    const eligibleNodes = student.nodes.filter(canExtendNode);
    setEditingInstanceId(student.instanceId);
    setExtension({
      deadline: "",
      nodeKey: eligibleNodes[0]?.nodeKey ?? "",
      reason: "批准个别延期",
    });
  };

  const openSubmissionDetail = async (nodeInstanceId: string) => {
    setLoadingDetailId(nodeInstanceId);
    setNotice("");
    try {
      setSubmissionDetail(await workflowApi.getSubmissionDetail(nodeInstanceId));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "审核详情读取失败");
    } finally {
      setLoadingDetailId(null);
    }
  };

  const saveExtension = async (instanceId: string, currentNode: WorkflowProgressNode | undefined) => {
    if (!currentNode || !currentNode.effectiveDeadline) {
      setNotice("请选择可延期节点");
      return;
    }
    if (!extension.deadline) {
      setNotice("请选择新的截止时间");
      return;
    }
    const cleanReason = extension.reason.trim();
    if (!cleanReason) {
      setNotice("请填写延期原因");
      return;
    }
    const newDeadline = new Date(extension.deadline).getTime();
    const currentDeadline = new Date(currentNode.effectiveDeadline).getTime();
    if (!Number.isFinite(newDeadline) || newDeadline <= currentDeadline) {
      setNotice("新的截止时间必须晚于当前生效截止时间");
      return;
    }
    if (newDeadline <= Date.now()) {
      setNotice("新的截止时间必须晚于当前时间");
      return;
    }
    setSavingExtension(true);
    try {
      await workflowApi.setStudentDeadline(
        instanceId,
        currentNode.nodeKey,
        new Date(extension.deadline).toISOString(),
        cleanReason,
      );
      setNotice("个别学生延期已保存");
      clearExtension();
      try {
        await refresh();
      } catch (reason) {
        setNotice(`延期已保存，但进度刷新失败：${reason instanceof Error ? reason.message : "请求失败"}`);
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "延期失败");
    } finally {
      setSavingExtension(false);
    }
  };

  const editingStudent = progress?.students.find(
    (student) => student.instanceId === editingInstanceId,
  ) ?? null;
  const eligibleNodes = editingStudent?.nodes.filter(canExtendNode) ?? [];
  const currentNode = eligibleNodes.find((node) => node.nodeKey === extension.nodeKey);

  const handleExtensionDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex=\"-1\"])",
    ));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    if (event.shiftKey && (document.activeElement === event.currentTarget || document.activeElement === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === event.currentTarget || document.activeElement === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className="inspector-backdrop" role="presentation" onMouseDown={onClose}>
        <aside
          aria-hidden={editingStudent ? true : undefined}
          className="teacher-progress-panel"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header>
            <div>
              <span>流程运行管理</span>
              <h2>学生填写进度</h2>
            </div>
            <button aria-label="关闭进度面板" onClick={onClose}>×</button>
          </header>
          <p className="progress-notice">{notice}</p>
          <section className="progress-table-wrap">
            <table className="progress-table">
              <thead>
                <tr><th>学生</th><th>状态</th><th>完成</th><th>逾期</th><th>最后活动</th><th>操作</th></tr>
              </thead>
              <tbody>
                {progress?.students.map((student) => (
                  <tr key={student.instanceId}>
                    <td><strong>{student.name}</strong><small>{student.studentNo}</small></td>
                    <td>{student.status === "completed" ? "已完成" : "进行中"}</td>
                    <td>{student.approvedCount}/{student.totalCount}</td>
                    <td>{student.expiredCount}</td>
                    <td>{new Date(student.lastActiveAt).toLocaleString("zh-CN")}</td>
                    <td>
                      <button
                        aria-haspopup="dialog"
                        className="progress-extension-trigger"
                        onClick={() => openExtension(student)}
                        ref={(element) => {
                          if (element) {
                            triggerRefs.current.set(student.instanceId, element);
                          } else {
                            triggerRefs.current.delete(student.instanceId);
                          }
                        }}
                        type="button"
                      >
                        设置延期
                      </button>
                      {student.nodes.filter((node) => scanNodeKeys.has(node.nodeKey) && ["reviewing", "approved", "rejected", "audit_error"].includes(node.status)).map((node) => (
                        <button className="progress-extension-trigger" disabled={loadingDetailId === node.nodeInstanceId} key={node.nodeInstanceId} onClick={() => void openSubmissionDetail(node.nodeInstanceId)} type="button">
                          {loadingDetailId === node.nodeInstanceId ? "读取中" : `查看扫描件 · ${node.title}`}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
                {progress?.students.length === 0 ? <tr><td colSpan={6}>尚无学生进入该流程</td></tr> : null}
              </tbody>
            </table>
          </section>
        </aside>
      </div>
      {editingStudent ? (
        <div className="student-extension-backdrop" role="presentation">
          <section
            aria-labelledby="student-extension-dialog-title"
            aria-modal="true"
            className="student-extension-dialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
            onKeyDown={handleExtensionDialogKeyDown}
          >
            <header>
              <div>
                <span>个别节点延期</span>
                <h3 id="student-extension-dialog-title">设置节点延期</h3>
                <p>{editingStudent.name}（{editingStudent.studentNo}）</p>
              </div>
              <button
                aria-label="关闭节点延期设置"
                onClick={clearExtension}
                type="button"
              >
                ×
              </button>
            </header>

            <div className="student-extension-dialog-body">
              {eligibleNodes.length === 0 ? (
                <p className="student-extension-empty">该学生当前没有可延期节点</p>
              ) : (
                <div className="student-extension-fields">
                  <label className="student-extension-field">
                    <span>节点</span>
                    <select
                      value={extension.nodeKey}
                      onChange={(event) => setExtension({
                        ...extension,
                        nodeKey: event.target.value,
                        deadline: "",
                      })}
                    >
                      {eligibleNodes.map((node) => (
                        <option key={node.nodeKey} value={node.nodeKey}>
                          {node.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="student-extension-field">
                    <span>当前生效截止时间</span>
                    <output className="student-extension-deadline">
                      {currentNode?.effectiveDeadline
                        ? new Date(currentNode.effectiveDeadline).toLocaleString("zh-CN")
                        : "未设置"}
                    </output>
                  </div>
                  <label className="student-extension-field">
                    <span>新截止时间</span>
                    <input
                      min={currentNode?.effectiveDeadline
                        ? minimumExtensionValue(currentNode.effectiveDeadline)
                        : undefined}
                      type="datetime-local"
                      value={extension.deadline}
                      onChange={(event) => setExtension({
                        ...extension,
                        deadline: event.target.value,
                      })}
                    />
                  </label>
                  <label className="student-extension-field">
                    <span>延期原因</span>
                    <input
                      maxLength={500}
                      value={extension.reason}
                      onChange={(event) => setExtension({
                        ...extension,
                        reason: event.target.value,
                      })}
                    />
                  </label>
                </div>
              )}
            </div>

            <footer className="student-extension-actions">
              <button
                className="student-extension-cancel"
                onClick={clearExtension}
                type="button"
              >
                取消
              </button>
              {eligibleNodes.length > 0 ? (
                <button
                  className="primary-action"
                  disabled={savingExtension}
                  onClick={() => void saveExtension(editingStudent.instanceId, currentNode)}
                  type="button"
                >
                  {savingExtension ? "保存中…" : "保存延期"}
                </button>
              ) : null}
            </footer>
          </section>
        </div>
      ) : null}
      {submissionDetail ? <div className="student-extension-backdrop" role="presentation" onMouseDown={() => setSubmissionDetail(null)}>
        <section aria-modal="true" className="student-extension-dialog submission-detail-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
          <header><div><span>扫描件提交详情</span><h3>{submissionDetail.nodeTitle}</h3><p>{submissionDetail.student.name}（{submissionDetail.student.studentNo}）</p></div><button aria-label="关闭提交详情" onClick={() => setSubmissionDetail(null)} type="button">×</button></header>
          <div className="student-extension-dialog-body">
            <dl className="submission-detail-summary">
              <div><dt>状态</dt><dd>{submissionDetail.status}</dd></div>
              <div><dt>模式</dt><dd>{submissionDetail.mode === "score" ? "AI 评分" : submissionDetail.mode === "pass_fail" ? "AI 通过 / 不通过" : "直接通过"}</dd></div>
              {submissionDetail.mode === "score" ? <div><dt>分数</dt><dd>{submissionDetail.score === null ? "尚未生成" : `${submissionDetail.score} 分`}</dd></div> : submissionDetail.mode === "pass_fail" ? <div><dt>审核结论</dt><dd>{submissionDetail.passed === null ? "尚未生成" : submissionDetail.passed ? "通过" : "不通过"}</dd></div> : <div><dt>提交结论</dt><dd>已通过</dd></div>}
            </dl>
            {submissionDetail.reason ? <section className="submission-detail-reason"><strong>{submissionDetail.mode === "score" ? "评分说明" : "审核原因"}</strong><p>{submissionDetail.reason}</p></section> : null}
            <ul className="runtime-submitted-scan-list">{submissionDetail.scans.map((scan) => <li key={scan.fileId}><span>{scan.originalName} · {scan.pageCount} 页</span><a href={scan.url} rel="noreferrer" target="_blank">下载</a></li>)}</ul>
          </div>
        </section>
      </div> : null}
    </>
  );
}
