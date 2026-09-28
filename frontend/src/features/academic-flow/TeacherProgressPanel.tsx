import { FileReviewDialog } from "./FileReviewDialog";
import { hasSequentialManualReview } from "./FileReviewStepsEditor";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import type { AcademicFlowNode } from "../../types";
import { workflowApi } from "./api";
import { saveDownload } from "./download";
import type { TeacherSubmissionDetail, WorkflowProgress, WorkflowProgressNode, WorkflowProgressStudent } from "./runtimeTypes";

type ProgressFilter = "all" | "completed" | "in_progress" | "overdue";

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
  downloadingPackage,
  onOpenExportTasks,
  onDownloadPackage,
  nodes,
  onClose,
  versionId,
}: {
  downloadingPackage: boolean;
  onOpenExportTasks: () => void;
  onDownloadPackage: (versionId: string) => void;
  nodes: AcademicFlowNode[];
  onClose: () => void;
  versionId: string;
}) {
  const [progress, setProgress] = useState<WorkflowProgress | null>(null);
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  const [activityDescending, setActivityDescending] = useState(true);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({});
  const [notice, setNotice] = useState("");
  const [editingInstanceId, setEditingInstanceId] = useState<string | null>(null);
  const [savingExtension, setSavingExtension] = useState(false);
  const [submissionDetail, setSubmissionDetail] = useState<TeacherSubmissionDetail | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [downloadingNodeId, setDownloadingNodeId] = useState<string | null>(null);
  const [fileReview, setFileReview] = useState<{ nodeKey: string; studentNo: string } | null>(null);
  const [manualApprovalOpen, setManualApprovalOpen] = useState(false);
  const [manualReason, setManualReason] = useState("");
  const [manualError, setManualError] = useState("");
  const [detailNotice, setDetailNotice] = useState("");
  const [savingManualApproval, setSavingManualApproval] = useState(false);
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
  const materialNodes = nodes.filter(
    (node) => node.kind === "file" || (node.kind === "confirmation" && Boolean(node.templateAsset)),
  );
  const materialNodeKeys = new Set(materialNodes.map((node) => node.id));
  const deadlineAnswerReleaseNodeKeys = new Set(
    nodes.filter((node) => (
      node.kind === "answer_sheet"
      && node.answerSheet?.gradingPolicy.feedback === "full_after_deadline"
    )).map((node) => node.id),
  );
  const canExtendNode = (node: WorkflowProgressNode) => Boolean(
    node.effectiveDeadline
      && !(
        deadlineAnswerReleaseNodeKeys.has(node.nodeKey)
        && new Date(node.effectiveDeadline).getTime() <= Date.now()
      )
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
      if (event.key !== "Escape") return;
      if (manualApprovalOpen) {
        setManualApprovalOpen(false);
      } else {
        setSubmissionDetail(null);
        setManualReason("");
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = previousOverflow;
    };
  }, [manualApprovalOpen, submissionDetail]);

  useEffect(() => {
    if (!openActionMenuId) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-progress-action-menu]")) return;
      setOpenActionMenuId(null);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const trigger = triggerRefs.current.get(openActionMenuId);
      setOpenActionMenuId(null);
      window.requestAnimationFrame(() => trigger?.focus());
    };
    const closeOnResize = () => setOpenActionMenuId(null);
    window.addEventListener("resize", closeOnResize);
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", closeOnResize);
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openActionMenuId]);

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
    setOpenActionMenuId(null);
    setEditingInstanceId(student.instanceId);
    setExtension({
      deadline: "",
      nodeKey: eligibleNodes[0]?.nodeKey ?? "",
      reason: "批准个别延期",
    });
  };

  const openSubmissionDetail = async (nodeInstanceId: string) => {
    setOpenActionMenuId(null);
    setLoadingDetailId(nodeInstanceId);
    setNotice("");
    setDetailNotice("");
    try {
      setSubmissionDetail(await workflowApi.getSubmissionDetail(nodeInstanceId));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "审核详情读取失败");
    } finally {
      setLoadingDetailId(null);
    }
  };

  const closeSubmissionDetail = () => {
    setSubmissionDetail(null);
    setManualApprovalOpen(false);
    setManualReason("");
    setManualError("");
    setDetailNotice("");
  };

  const downloadNodeMaterials = async (nodeInstanceId: string) => {
    setDownloadingNodeId(nodeInstanceId);
    setDetailNotice("");
    try {
      const download = await workflowApi.downloadTeacherNodeMaterials(nodeInstanceId);
      saveDownload(download.blob, download.filename);
    } catch (reason) {
      setDetailNotice(reason instanceof Error ? reason.message : "材料下载失败");
    } finally {
      setDownloadingNodeId(null);
    }
  };

  const approveManually = async () => {
    if (!submissionDetail?.submissionId) {
      setNotice("当前提交已变化，请刷新后重试");
      return;
    }
    const cleanReason = manualReason.trim();
    if (!cleanReason) {
      setNotice("请填写人工审核备注");
      return;
    }
    setSavingManualApproval(true);
    setManualError("");
    try {
      await workflowApi.manualApproveSubmission(
        submissionDetail.nodeInstanceId,
        submissionDetail.submissionId,
        cleanReason,
      );
      const nodeInstanceId = submissionDetail.nodeInstanceId;
      setManualApprovalOpen(false);
      setManualReason("");
      setManualError("");
      setNotice("已人工审核通过");
      try {
        const [detail] = await Promise.all([
          workflowApi.getSubmissionDetail(nodeInstanceId),
          refresh(),
        ]);
        setSubmissionDetail(detail);
      } catch (reason) {
        setSubmissionDetail(null);
        setNotice(`已人工审核通过，但页面刷新失败：${reason instanceof Error ? reason.message : "请求失败"}`);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "人工审核失败";
      setManualError(message);
      try {
        const detail = await workflowApi.getSubmissionDetail(submissionDetail.nodeInstanceId);
        setSubmissionDetail(detail);
        if (!detail.canManualApprove) {
          setManualApprovalOpen(false);
          setNotice(message);
        }
      } catch {
        // 保留原提交详情和明确的人工审核错误，避免掩盖首要失败原因。
      }
    } finally {
      setSavingManualApproval(false);
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
  const progressStudents = progress?.students ?? [];
  const completedStudentCount = progressStudents.filter(
    (student) => student.status === "completed",
  ).length;
  const overdueStudentCount = progressStudents.filter(
    (student) => student.expiredCount > 0,
  ).length;
  const visibleStudents = progressStudents.filter((student) => (
    progressFilter === "all"
    || (progressFilter === "overdue" ? student.expiredCount > 0
      : progressFilter === "completed" ? student.status === "completed"
        : student.status !== "completed")
  )).sort((a, b) => {
    const difference = new Date(a.lastActiveAt).getTime() - new Date(b.lastActiveAt).getTime();
    return (activityDescending ? -difference : difference) || a.studentNo.localeCompare(b.studentNo);
  });
  const progressSummary: { filter: ProgressFilter; label: string; tone: string; value: number | string }[] = [
    { filter: "all", label: "全部", tone: "neutral", value: progress ? progressStudents.length : "—" },
    { filter: "completed", label: "已完成", tone: "success", value: progress ? completedStudentCount : "—" },
    {
      filter: "in_progress",
      label: "进行中",
      tone: "accent",
      value: progress ? progressStudents.length - completedStudentCount : "—",
    },
    {
      filter: "overdue",
      label: "有逾期",
      tone: overdueStudentCount > 0 ? "danger" : "neutral",
      value: progress ? overdueStudentCount : "—",
    },
  ];

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
          aria-hidden={editingStudent || submissionDetail ? true : undefined}
          className="teacher-progress-panel"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="progress-panel-header">
            <div className="progress-panel-heading">
              <h2>学生填写进度</h2>
              {progress ? <span title={progress.name}>{progress.name}</span> : null}
            </div>
            <button
              aria-label="关闭进度面板"
              className="progress-panel-close"
              onClick={onClose}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M4 4l12 12M16 4L4 16" />
              </svg>
            </button>
          </header>
          <div className="progress-panel-content">
            {notice ? (
              <div className="progress-notice" role="alert">
                <svg aria-hidden="true" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="8" />
                  <path d="M10 5.8v5.1M10 14.1v.1" />
                </svg>
                <span>{notice}</span>
              </div>
            ) : null}

            <section className="progress-summary" aria-label="学生进度概览">
              {progressSummary.map((item) => (
                <button
                  aria-pressed={progressFilter === item.filter}
                  className={`progress-summary-item is-${item.tone}`}
                  key={item.filter}
                  onClick={() => { setProgressFilter(item.filter); setOpenActionMenuId(null); }}
                  type="button"
                >
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </button>
              ))}
            </section>

            {nodes.length > 0 ? (
              <section className="progress-operations" aria-label="全部节点资料导出">
                <button
                  className="progress-operation-button"
                  disabled={downloadingPackage}
                  onClick={() => onDownloadPackage(versionId)}
                  type="button"
                >
                  <span aria-hidden="true">↓ </span>
                  {downloadingPackage ? "正在打包全部材料…" : "打包导出全部材料"}
                </button>
                <button className="progress-operation-button" type="button" onClick={onOpenExportTasks}>查看导出任务</button>
                <span className="progress-export-hint">后台打包 · 退出流程后可在导出任务中下载</span>
              </section>
            ) : null}
            <section className="progress-table-wrap" onScroll={() => setOpenActionMenuId(null)}>
              <table className="progress-table">
              <thead>
                <tr>
                  <th>学生 / 学号</th><th>状态</th><th>完成进度</th>
                  <th aria-sort={activityDescending ? "descending" : "ascending"}>
                    <button className="progress-activity-sort" type="button"
                      onClick={() => { setActivityDescending((current) => !current); setOpenActionMenuId(null); }}>
                      最后活动 <span aria-hidden="true">{activityDescending ? "↓" : "↑"}</span>
                    </button>
                  </th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleStudents.map((student) => {
                  const availableMaterialNodes = student.nodes.filter(
                    (node) => materialNodeKeys.has(node.nodeKey)
                      && ["reviewing", "approved", "rejected", "audit_error"].includes(node.status),
                  );
                  const menuOpen = openActionMenuId === student.instanceId;
                  const completionPercent = student.totalCount > 0
                    ? Math.min(100, Math.round((student.approvedCount / student.totalCount) * 100))
                    : 0;
                  const completed = student.status === "completed";
                  return (
                    <tr key={student.instanceId}>
                      <td className="progress-student-cell">
                        <strong>{student.name}</strong>
                        <small>{student.studentNo}</small>
                      </td>
                      <td>
                        <span className={`progress-status-tag ${completed ? "is-completed" : "is-active"}`}>
                          {completed ? "已完成" : "进行中"}
                        </span>
                        {student.expiredCount > 0 ? (
                          <span className="progress-overdue-count">逾期 {student.expiredCount} 个节点</span>
                        ) : null}
                      </td>
                      <td>
                        <div className={`progress-completion${completed ? " is-completed" : ""}`}>
                          <strong>{student.approvedCount}/{student.totalCount}</strong>
                          <span
                            aria-label={`完成度 ${completionPercent}%`}
                            aria-valuemax={100}
                            aria-valuemin={0}
                            aria-valuenow={completionPercent}
                            className="progress-completion-track"
                            role="progressbar"
                          >
                            <span style={{ width: `${completionPercent}%` }} />
                          </span>
                        </div>
                      </td>
                      <td>
                        <time className="progress-last-active" dateTime={student.lastActiveAt}
                          title={new Date(student.lastActiveAt).toLocaleString("zh-CN")}>
                          {new Date(student.lastActiveAt).toLocaleString("zh-CN", {
                            month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
                          })}
                        </time>
                      </td>
                      <td className="progress-actions-cell">
                        <div className="progress-row-actions" data-progress-action-menu>
                          <button
                            aria-expanded={menuOpen}
                            aria-haspopup="menu"
                            aria-label={`${student.name}的操作`}
                            className="progress-action-menu-trigger"
                            onClick={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              const openAbove = rect.bottom > window.innerHeight / 2;
                              setMenuPosition({
                                right: Math.max(12, window.innerWidth - rect.right),
                                top: openAbove ? undefined : rect.bottom + 6,
                                bottom: openAbove ? window.innerHeight - rect.top + 6 : undefined,
                                maxHeight: Math.max(80, Math.min(320, openAbove ? rect.top - 18 : window.innerHeight - rect.bottom - 18)),
                              });
                              setOpenActionMenuId((current) => current === student.instanceId ? null : student.instanceId);
                            }}
                            ref={(element) => {
                              if (element) {
                                triggerRefs.current.set(student.instanceId, element);
                              } else {
                                triggerRefs.current.delete(student.instanceId);
                              }
                            }}
                            title="更多操作"
                            type="button"
                          >
                            <svg aria-hidden="true" viewBox="0 0 16 16">
                              <circle cx="3" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="13" cy="8" r="1" />
                            </svg>
                          </button>
                          {menuOpen ? (
                            <div
                              aria-label={`${student.name}的操作`}
                              className="progress-row-action-menu"
                              style={menuPosition}
                              role="menu"
                            >
                              <button onClick={() => openExtension(student)} role="menuitem" type="button">
                                设置延期
                              </button>
                              {availableMaterialNodes.map((node) => {
                                const loading = loadingDetailId === node.nodeInstanceId;
                                const embeddedReview = hasSequentialManualReview(nodes.find((item) => item.id === node.nodeKey));
                                const label = `${embeddedReview ? "人工审核" : "查看材料"} · ${node.title}`;
                                return (
                                  <button
                                    disabled={loading}
                                    key={node.nodeInstanceId}
                                    onClick={() => {
                                      if (embeddedReview) { setFileReview({ nodeKey: node.nodeKey, studentNo: student.studentNo }); setOpenActionMenuId(null); }
                                      else void openSubmissionDetail(node.nodeInstanceId);
                                    }}
                                    role="menuitem"
                                    title={label}
                                    type="button"
                                  >
                                    {loading ? "读取中" : label}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleStudents.length === 0 ? (
                  <tr className="progress-table-empty"><td colSpan={5}>
                    {!progress ? (notice ? "进度加载失败" : "正在加载学生进度…")
                      : progressStudents.length === 0 ? "尚无学生进入该流程" : "当前筛选下暂无学生"}
                  </td></tr>
                ) : null}
              </tbody>
              </table>
            </section>
            <footer className="progress-panel-footer" aria-live="polite">
              {progress ? `显示 ${visibleStudents.length} / ${progressStudents.length} 位学生` : notice ? "进度加载失败" : "正在读取进度"}
            </footer>
          </div>
        </aside>
      </div>
      {fileReview ? <FileReviewDialog nodeKey={fileReview.nodeKey} versionId={versionId} initialStudentNo={fileReview.studentNo} onClose={() => { setFileReview(null); void refresh().catch((reason: Error) => setNotice(reason.message)); }} /> : null}
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
      {submissionDetail ? <div className="student-extension-backdrop" role="presentation" onMouseDown={closeSubmissionDetail}>
        <section aria-modal="true" className="student-extension-dialog submission-detail-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
          <header><div><span>材料提交详情</span><h3>{submissionDetail.nodeTitle}</h3><p>{submissionDetail.student.name}（{submissionDetail.student.studentNo}）</p></div><button aria-label="关闭提交详情" onClick={closeSubmissionDetail} type="button">×</button></header>
          <div className="student-extension-dialog-body">
            {detailNotice ? <p className="submission-detail-notice">{detailNotice}</p> : null}
            <dl className="submission-detail-summary">
              <div><dt>状态</dt><dd>{submissionDetail.status}</dd></div>
              <div><dt>模式</dt><dd>{submissionDetail.reviewSource === "manual" ? "人工审核" : submissionDetail.mode === "answer_sheet" ? "答题卡自动判分" : submissionDetail.mode === "score" ? "AI 评分" : submissionDetail.mode === "pass_fail" ? "AI 通过 / 不通过" : "直接通过"}</dd></div>
              {submissionDetail.mode === "answer_sheet" ? <><div><dt>分数</dt><dd>{submissionDetail.answerSheetGrade ? `${submissionDetail.answerSheetGrade.score} / ${submissionDetail.answerSheetGrade.maxScore} 分` : "尚未生成"}</dd></div><div><dt>判定</dt><dd>{submissionDetail.passed ? "及格" : "未及格"}</dd></div></> : submissionDetail.reviewSource === "manual" ? <div><dt>审核结论</dt><dd>通过</dd></div> : submissionDetail.mode === "score" ? <><div><dt>分数</dt><dd>{submissionDetail.score === null ? "尚未生成" : `${submissionDetail.score} 分`}</dd></div><div><dt>通过阈值</dt><dd>{submissionDetail.threshold === null ? "未配置" : `${submissionDetail.threshold} 分`}</dd></div><div><dt>审核结论</dt><dd>{submissionDetail.passed === null ? "尚未生成" : submissionDetail.passed ? "通过" : "不通过"}</dd></div></> : submissionDetail.mode === "pass_fail" ? <div><dt>审核结论</dt><dd>{submissionDetail.passed === null ? "尚未生成" : submissionDetail.passed ? "通过" : "不通过"}</dd></div> : <div><dt>提交结论</dt><dd>已通过</dd></div>}
              {submissionDetail.mode === "answer_sheet" ? <div><dt>提交次数</dt><dd>第 {submissionDetail.attemptNo} 次</dd></div> : null}
            </dl>
            {submissionDetail.answerSheetGrade?.questionResults?.length ? <section className="submission-detail-reason"><strong>逐题得分</strong><p>{submissionDetail.answerSheetGrade.questionResults.map((result, index) => `第 ${index + 1} 题 ${result.awardedPoints}/${result.maxPoints} 分`).join("；")}</p></section> : null}
            {submissionDetail.reason ? <section className="submission-detail-reason"><strong>{submissionDetail.reviewSource !== "manual" && submissionDetail.mode === "score" ? "评分说明" : "审核原因"}</strong><p>{submissionDetail.reason}</p></section> : null}
            <ul className="runtime-submitted-scan-list">{submissionDetail.scans.map((scan) => <li key={scan.fileId}><span>{scan.originalName} · {scan.pageCount} 页</span><a href={scan.url} rel="noreferrer" target="_blank">下载</a></li>)}</ul>
          </div>
          <footer className="student-extension-actions submission-detail-actions">
            <button
              className="student-extension-cancel"
              disabled={submissionDetail.scans.length === 0 || downloadingNodeId === submissionDetail.nodeInstanceId}
              onClick={() => void downloadNodeMaterials(submissionDetail.nodeInstanceId)}
              type="button"
            >
              {downloadingNodeId === submissionDetail.nodeInstanceId ? "正在打包…" : "下载本节点全部材料"}
            </button>
            {submissionDetail.canManualApprove ? (
              <button className="primary-action" onClick={() => { setManualError(""); setManualApprovalOpen(true); }} type="button">人工审核通过</button>
            ) : null}
          </footer>
        </section>
      </div> : null}
      {submissionDetail && manualApprovalOpen ? (
        <div className="student-extension-backdrop manual-approval-backdrop" role="presentation" onMouseDown={() => setManualApprovalOpen(false)}>
          <section aria-modal="true" className="student-extension-dialog manual-approval-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <header>
              <div><span>人工审核</span><h3>确认人工审核通过</h3><p>{submissionDetail.student.name}（{submissionDetail.student.studentNo}）· {submissionDetail.nodeTitle}</p></div>
              <button aria-label="关闭人工审核确认" onClick={() => setManualApprovalOpen(false)} type="button">×</button>
            </header>
            <div className="student-extension-dialog-body">
              <p className="manual-approval-warning">确认后将按审核通过处理，并开放后续节点。</p>
              {manualError ? <p className="submission-detail-notice">{manualError}</p> : null}
              <label className="student-extension-field">
                <span>人工审核备注</span>
                <textarea autoFocus maxLength={500} rows={4} value={manualReason} onChange={(event) => setManualReason(event.target.value)} placeholder="请填写人工核验说明" />
                <small>{manualReason.length}/500</small>
              </label>
            </div>
            <footer className="student-extension-actions">
              <button className="student-extension-cancel" onClick={() => setManualApprovalOpen(false)} type="button">取消</button>
              <button className="primary-action" disabled={savingManualApproval || !manualReason.trim()} onClick={() => void approveManually()} type="button">{savingManualApproval ? "处理中…" : "确认人工通过"}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
