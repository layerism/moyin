import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import Markdown from "react-markdown";

import type { AcademicFlowNode } from "../../types";
import { ApiError, FLOW_PREVIEW_TOKEN_KEY, workflowApi } from "./api";
import { validateFormAnswers } from "./formFields";
import { answerSheetMaxScore, validateAnswerSheetSubmission } from "./answerSheet";
import { AnswerSheetGradeResult, RuntimeAnswerSheet } from "./RuntimeAnswerSheet";
import { ReadonlyFormFields, RuntimeFormFields } from "./RuntimeFormFields";
import {
  getScanFilenameError,
  getScanSubmitBlocker,
  ScanUploadWorkspace,
} from "./ScanUploadWorkspace";
import type {
  RuntimeFlowInstance,
  RuntimeNodeInstance,
  RuntimeScanFile,
  RuntimeNodeStatus,
} from "./runtimeTypes";
import { StudentFlowTopology } from "./StudentFlowTopology";

const statusLabels: Record<RuntimeNodeStatus, string> = {
  approved: "已通过",
  audit_error: "审核异常",
  available: "可填写",
  draft: "已暂存",
  expired: "已截止",
  locked: "待开放",
  rejected: "已退回",
  reviewing: "审核中",
  scheduled: "定时开放",
  submitted: "已提交",
};

const writableStatuses = new Set<RuntimeNodeStatus>(["available", "draft", "rejected"]);

export function StudentRuntimePage({
  initialInstance,
  instanceId,
  onHome,
  preview = false,
}: {
  initialInstance?: RuntimeFlowInstance | null;
  instanceId: string;
  onHome: () => void;
  preview?: boolean;
}) {
  const [instance, setInstance] = useState<RuntimeFlowInstance | null>(initialInstance ?? null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [notice, setNotice] = useState("");
  const [actionWarning, setActionWarning] = useState("");
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [activeNodeKey, setActiveNodeKey] = useState<string | null>(null);
  const [amendingNodeId, setAmendingNodeId] = useState<string | null>(null);
  const [fieldErrorsByNode, setFieldErrorsByNode] = useState<
    Record<string, Record<string, string>>
  >({});

  useEffect(() => {
    if (initialInstance?.id === instanceId) return;
    let cancelled = false;
    workflowApi
      .getInstance(instanceId)
      .then((value) => {
        if (!cancelled) setInstance(value);
      })
      .catch((reason: Error) => {
        if (!cancelled) setNotice(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [initialInstance, instanceId]);

  useEffect(() => {
    if (!instance) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const node of instance.nodeInstances) {
        if (!(node.id in next)) {
          const configNode = instance.config.nodes.find((item) => item.id === node.nodeKey);
          next[node.id] = (
            configNode?.kind === "answer_sheet"
            && node.status === "rejected"
            && Object.keys(node.draft).length === 0
          ) ? node.submission : configNode?.kind === "answer_sheet"
            && Object.keys(node.draft).length === 0
            ? { answers: {} }
            : node.draft;
        }
      }
      return next;
    });
  }, [instance]);

  const isAwaitingReview =
    instance?.nodeInstances.some(
      (node) => node.status === "reviewing" || node.status === "submitted",
    ) ?? false;

  useEffect(() => {
    if (!isAwaitingReview) return;
    let cancelled = false;
    const poll = () => {
      workflowApi
        .getInstance(instanceId)
        .then((value) => {
          if (!cancelled) {
            setInstance(value);
            setNotice("");
          }
        })
        .catch(() => {
          if (!cancelled) setNotice("审核状态暂时无法刷新，系统将自动重试");
        });
    };
    const timer = window.setInterval(poll, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [instanceId, isAwaitingReview]);

  useEffect(() => {
    const nextStart = instance?.nodeInstances
      .filter((node) => node.status === "scheduled" && node.effectiveStartAt)
      .map((node) => new Date(node.effectiveStartAt as string).getTime())
      .filter((value) => Number.isFinite(value) && value > Date.now())
      .sort((left, right) => left - right)[0];
    if (!nextStart) return;
    const delay = Math.min(nextStart - Date.now() + 250, 2_147_000_000);
    const timer = window.setTimeout(() => {
      workflowApi.getInstance(instanceId).then(setInstance).catch((reason: Error) => setNotice(reason.message));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [instance, instanceId]);

  const runtimeByKey = useMemo(
    () => new Map(instance?.nodeInstances.map((node) => [node.nodeKey, node]) ?? []),
    [instance],
  );
  const activeNode = instance?.config.nodes.find((node) => node.id === activeNodeKey) ?? null;
  const activeRuntime = activeNodeKey ? runtimeByKey.get(activeNodeKey) ?? null : null;

  const beginFormAmendment = (runtime: RuntimeNodeInstance) => {
    const initialDraft = Object.keys(runtime.draft).length > 0
      ? runtime.draft
      : runtime.submission;
    setDrafts((current) => ({
      ...current,
      [runtime.id]: structuredClone(initialDraft),
    }));
    setAmendingNodeId(runtime.id);
  };

  const updateDraft = (
    runtimeId: string,
    field: string,
    value: unknown,
    fieldId?: string,
  ) => {
    setDrafts((current) => ({
      ...current,
      [runtimeId]: { ...(current[runtimeId] ?? {}), [field]: value },
    }));
    if (fieldId) {
      setFieldErrorsByNode((current) => {
        if (!current[runtimeId]?.[fieldId]) return current;
        const nextNodeErrors = { ...current[runtimeId] };
        delete nextNodeErrors[fieldId];
        return { ...current, [runtimeId]: nextNodeErrors };
      });
    }
  };

  const save = async (runtime: RuntimeNodeInstance) => {
    setBusyNodeId(runtime.id);
    setNotice("");
    setActionWarning("");
    try {
      setInstance(await workflowApi.saveNodeDraft(runtime.id, drafts[runtime.id] ?? {}));
      setNotice(
        runtime.status === "approved"
          ? "修改内容已暂存，原通过内容仍然有效"
          : "当前节点已暂存",
      );
    } catch (reason) {
      setActionWarning(reason instanceof Error ? reason.message : "暂存失败");
    } finally {
      setBusyNodeId(null);
    }
  };

  const uploadFile = async (runtime: RuntimeNodeInstance, file: File) => {
    setBusyNodeId(runtime.id);
    setNotice("正在上传文件");
    try {
      const uploaded = await workflowApi.uploadFile(runtime.id, file);
      setDrafts((current) => ({
        ...current,
        [runtime.id]: {
          ...(current[runtime.id] ?? {}),
          file: {
            fileId: uploaded.fileId,
            name: uploaded.originalName,
            size: uploaded.sizeBytes,
            type: uploaded.contentType,
          },
        },
      }));
      setNotice("文件上传成功，可以提交节点");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "文件上传失败";
      setNotice("");
      throw reason instanceof Error ? reason : new Error(message);
    } finally {
      setBusyNodeId(null);
    }
  };

  const submit = async (runtime: RuntimeNodeInstance) => {
    const approvedFormAmendment = runtime.status === "approved"
      && instance?.config.nodes.find((node) => node.id === runtime.nodeKey)?.kind === "form";
    setBusyNodeId(runtime.id);
    setNotice("");
    setActionWarning("");
    try {
      const next = await workflowApi.submitNode(
        runtime.id,
        drafts[runtime.id] ?? {},
        `${runtime.id}-${Date.now()}`,
      );
      setInstance(next);
      setFieldErrorsByNode((current) => ({ ...current, [runtime.id]: {} }));
      const submittedNode = next.nodeInstances.find((node) => node.id === runtime.id);
      if (submittedNode?.status === "approved") {
        setActiveNodeKey(null);
        setAmendingNodeId(null);
        setNotice(
          approvedFormAmendment
            ? "表单修改已提交并通过"
            : "自动审核通过，后续节点已按流程规则开放",
        );
      } else if (submittedNode?.status === "rejected" && submittedNode.grade) {
        setNotice(
          `本次得分 ${submittedNode.grade.score} / ${submittedNode.grade.maxScore}，未达到及格要求`,
        );
      } else {
        setNotice("节点已提交，正在自动审核");
      }
    } catch (reason) {
      if (reason instanceof ApiError && Object.keys(reason.fieldErrors).length > 0) {
        setFieldErrorsByNode((current) => ({
          ...current,
          [runtime.id]: reason.fieldErrors,
        }));
      }
      setActionWarning(reason instanceof Error ? reason.message : "提交失败");
    } finally {
      setBusyNodeId(null);
    }
  };

  const retryAudit = async (runtime: RuntimeNodeInstance) => {
    setBusyNodeId(runtime.id);
    setNotice("");
    setActionWarning("");
    try {
      setInstance(await workflowApi.retryAudit(runtime.id));
      setNotice("已重新发起自动审核");
    } catch (reason) {
      setActionWarning(reason instanceof Error ? reason.message : "重新审核失败");
    } finally {
      setBusyNodeId(null);
    }
  };

  const downloadTemplate = async (runtime: RuntimeNodeInstance) => {
    setBusyNodeId(runtime.id);
    setNotice("");
    setActionWarning("");
    try {
      const result = await workflowApi.downloadNodeTemplate(runtime.id);
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.download = result.originalName;
      anchor.rel = "noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setInstance(await workflowApi.getInstance(instanceId));
      setNotice("模板已下载，请填写后上传");
    } catch (reason) {
      setActionWarning(reason instanceof Error ? reason.message : "模板下载失败");
    } finally {
      setBusyNodeId(null);
    }
  };

  const downloadFile = async (runtime: RuntimeNodeInstance, fileId: string) => {
    setBusyNodeId(runtime.id);
    setNotice("");
    setActionWarning("");
    try {
      const result = await workflowApi.downloadNodeFile(fileId);
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.download = result.originalName;
      anchor.rel = "noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setNotice("文件下载已开始");
    } catch (reason) {
      setActionWarning(reason instanceof Error ? reason.message : "文件下载失败");
    } finally {
      setBusyNodeId(null);
    }
  };

  if (!instance) {
    return (
      <main className="student-runtime-page">
        <section className="runtime-loading">
          <strong>正在读取填写进度</strong>
          <p>{notice || "请稍候"}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="student-runtime-page">
      <header className="student-runtime-header">
        <button
          aria-label="返回首页"
          className="runtime-home-button"
          onClick={() => {
            if (!preview) {
              onHome();
              return;
            }
            window.sessionStorage.removeItem(FLOW_PREVIEW_TOKEN_KEY);
            window.close();
          }}
          title={preview ? "关闭预览" : "返回首页"}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="runtime-flow-summary">
          <span className="oa-brand-mark">OA</span>
          <div className="runtime-flow-copy">
            <small>流程说明</small>
            <strong>{instance.name}</strong>
            <p>{instance.description}</p>
          </div>
          <strong className={`runtime-overall-status ${instance.status}`}>
            {instance.status === "completed" ? "全部完成" : "填写中"}
          </strong>
        </div>
        <div className="runtime-student-identity">
          <span aria-hidden="true" className="runtime-student-avatar">
            {instance.student.name.slice(0, 1) || "学"}
          </span>
          <div className="runtime-student-details">
            <strong>{instance.student.name}</strong>
            <small>{instance.student.studentNo}</small>
          </div>
        </div>
      </header>
      {notice ? (
        <section className="runtime-notice" aria-live="polite">
          {notice}
        </section>
      ) : null}
      <StudentFlowTopology
        edges={instance.config.edges}
        nodes={instance.config.nodes}
        onOpenNode={setActiveNodeKey}
        runtimeNodes={instance.nodeInstances}
      />
      {activeNode && activeRuntime ? (
        <RuntimeNodeDialog
          amendingApprovedForm={amendingNodeId === activeRuntime.id}
          busy={busyNodeId === activeRuntime.id}
          draft={drafts[activeRuntime.id] ?? {}}
          fieldErrors={fieldErrorsByNode[activeRuntime.id] ?? {}}
          key={activeRuntime.id}
          instanceId={instance.id}
          node={activeNode}
          onBeginFormAmendment={() => beginFormAmendment(activeRuntime)}
          onClose={() => {
            setActiveNodeKey(null);
            setAmendingNodeId(null);
          }}
          onDownloadFile={(fileId) => void downloadFile(activeRuntime, fileId)}
          onDownloadTemplate={() => void downloadTemplate(activeRuntime)}
          onSave={() => void save(activeRuntime)}
          onRetryAudit={() => void retryAudit(activeRuntime)}
          onSubmit={() => void submit(activeRuntime)}
          onUploadFile={(file) => uploadFile(activeRuntime, file)}
          onUpdate={(field, value, fieldId) => updateDraft(
            activeRuntime.id,
            field,
            value,
            fieldId,
          )}
          runtime={activeRuntime}
        />
      ) : null}
      {actionWarning ? (
        <RuntimeWarningDialog
          category="操作提示"
          idPrefix="runtime-action-warning"
          message={actionWarning}
          onClose={() => setActionWarning("")}
          title="操作未完成"
        />
      ) : null}
    </main>
  );
}

function RuntimeNodeDialog({
  amendingApprovedForm,
  busy,
  draft,
  fieldErrors,
  instanceId,
  node,
  onBeginFormAmendment,
  onClose,
  onDownloadFile,
  onDownloadTemplate,
  onSave,
  onRetryAudit,
  onSubmit,
  onUploadFile,
  onUpdate,
  runtime,
}: {
  amendingApprovedForm: boolean;
  busy: boolean;
  draft: Record<string, unknown>;
  fieldErrors: Record<string, string>;
  instanceId: string;
  node: AcademicFlowNode;
  onBeginFormAmendment: () => void;
  onClose: () => void;
  onDownloadFile: (fileId: string) => void;
  onDownloadTemplate: () => void;
  onSave: () => void;
  onRetryAudit: () => void;
  onSubmit: () => void;
  onUploadFile: (file: File) => Promise<void>;
  onUpdate: (field: string, value: unknown, fieldId?: string) => void;
  runtime: RuntimeNodeInstance;
}) {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [fileWarning, setFileWarning] = useState<{
    message: string;
    title: string;
  } | null>(null);
  const [uploadingFileName, setUploadingFileName] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [confirmationAttempted, setConfirmationAttempted] = useState(false);
  const [templateDownloadAttention, setTemplateDownloadAttention] = useState(false);
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const templateDownloadButtonRef = useRef<HTMLButtonElement>(null);
  const templateDownloadAttentionFrameRef = useRef<number | null>(null);
  const templateDownloadAttentionTimerRef = useRef<number | null>(null);
  const [touchedFieldIds, setTouchedFieldIds] = useState<Set<string>>(() => new Set());
  const [scanState, setScanState] = useState<{ scans: RuntimeScanFile[]; uploading: boolean }>({ scans: [], uploading: false });
  const updateScanState = useCallback((value: { scans: RuntimeScanFile[]; uploading: boolean }) => setScanState(value), []);
  const approvedForm = runtime.status === "approved" && node.kind === "form";
  const awaitingReview = runtime.status === "reviewing" || runtime.status === "submitted";
  const deadlinePassed = Boolean(
    runtime.effectiveDeadline
      && new Date(runtime.effectiveDeadline).getTime() <= clock,
  );
  const canAmendApprovedForm = approvedForm && !deadlinePassed;
  const writable = writableStatuses.has(runtime.status) || (
    approvedForm && amendingApprovedForm && !deadlinePassed
  );
  const answerSheetAttemptsExhausted = node.kind === "answer_sheet"
    && runtime.attemptsRemaining === 0;
  const effectivelyWritable = writable && !answerSheetAttemptsExhausted;
  const expiredAnswerSheetSubmission = node.kind === "answer_sheet"
    && runtime.status === "expired"
    && Object.keys(runtime.submission).length > 0;
  const readonly = (runtime.status === "approved" || expiredAnswerSheetSubmission) && !writable;
  const completionLabel = expiredAnswerSheetSubmission
    ? "已截止 · 最后一次提交"
    : approvedForm ? "已完成 · 当前通过内容" : "已完成 · 提交内容已锁定";
  const answerSheetGradeCompletion = readonly && node.kind === "answer_sheet" && runtime.grade
    ? { label: completionLabel, submittedAt: formatDateTime(runtime.submittedAt) }
    : undefined;
  const displayedPayload = readonly ? runtime.submission : draft;
  const answerSheetTotalScore = node.kind === "answer_sheet" && node.answerSheet
    ? answerSheetMaxScore(node.answerSheet)
    : 0;
  const draftFile = getDraftFile(draft.file);
  const submittedFile = getDraftFile(runtime.submission.file);
  const needsFileReplacement = runtime.status === "rejected" && Boolean(
    submittedFile?.fileId
      && (!draftFile?.fileId || draftFile.fileId === submittedFile.fileId),
  );
  const pendingFile = needsFileReplacement ? null : draftFile;
  const fileReady = Boolean(pendingFile?.fileId);
  const downloadableFile = pendingFile ?? submittedFile;
  const downloadableFileId = typeof downloadableFile?.fileId === "string"
    ? downloadableFile.fileId
    : null;
  const downloadingPreviousFile = Boolean(
    downloadableFileId
      && downloadableFileId === submittedFile?.fileId
      && !fileReady,
  );
  const templateRequired = Boolean(runtime.template);
  const uploadUnlocked = !templateRequired || runtime.templateDownloaded;
  const fileBusy = busy || isUploadingFile || !uploadUnlocked;
  const confirmationRequired = node.kind === "confirmation" || node.kind === "announcement";
  const confirmationMissing = confirmationRequired && draft.confirmed !== true;
  const confirmationInvalid = confirmationAttempted && confirmationMissing;
  const scanRequired = node.kind === "confirmation" && (
    Boolean(runtime.template) || node.scanAuditEnabled === true
  );
  const scanBlocker = getScanSubmitBlocker({
    confirmed: draft.confirmed === true,
    scanRequired,
    scans: scanState.scans,
    templateDownloaded: !runtime.template || runtime.templateDownloaded,
    uploading: scanState.uploading,
  });
  const scanFilenameError = scanRequired
    ? getScanFilenameError({
        filenames: scanState.scans.map((scan) => scan.originalName),
        templateFilename: runtime.template?.originalName ?? null,
      })
    : null;
  const submitDisabled = busy
    || (node.kind === "file" && (!uploadUnlocked || !fileReady || isUploadingFile))
    || Boolean(scanBlocker && !confirmationMissing);
  const clientFieldErrors = node.kind === "form"
    ? validateFormAnswers(node.infoFields, draft)
    : node.kind === "answer_sheet" && node.answerSheet
      ? validateAnswerSheetSubmission(node.answerSheet, draft, true)
      : {};
  const visibleFieldErrors = Object.fromEntries(
    Object.entries({ ...clientFieldErrors, ...fieldErrors }).filter(([fieldId]) =>
      submitAttempted || touchedFieldIds.has(fieldId) || Boolean(fieldErrors[fieldId]),
    ),
  );

  useEffect(() => {
    if (
      runtime.status !== "scheduled"
      && !(approvedForm && runtime.effectiveDeadline)
    ) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [approvedForm, runtime.effectiveDeadline, runtime.status]);

  useEffect(() => {
    if (!runtime.templateDownloaded) return;
    if (templateDownloadAttentionFrameRef.current !== null) {
      window.cancelAnimationFrame(templateDownloadAttentionFrameRef.current);
      templateDownloadAttentionFrameRef.current = null;
    }
    if (templateDownloadAttentionTimerRef.current !== null) {
      window.clearTimeout(templateDownloadAttentionTimerRef.current);
      templateDownloadAttentionTimerRef.current = null;
    }
    setTemplateDownloadAttention(false);
  }, [runtime.templateDownloaded]);

  useEffect(() => () => {
    if (templateDownloadAttentionFrameRef.current !== null) {
      window.cancelAnimationFrame(templateDownloadAttentionFrameRef.current);
      templateDownloadAttentionFrameRef.current = null;
    }
    if (templateDownloadAttentionTimerRef.current !== null) {
      window.clearTimeout(templateDownloadAttentionTimerRef.current);
      templateDownloadAttentionTimerRef.current = null;
    }
  }, []);

  const uploadSelectedFile = async (file: File) => {
    setFileWarning(null);
    setUploadingFileName(file.name);
    setIsUploadingFile(true);
    try {
      await onUploadFile(file);
    } catch (reason) {
      setFileWarning({
        message: reason instanceof Error ? reason.message : "文件上传失败",
        title: "文件上传未通过",
      });
    } finally {
      setIsUploadingFile(false);
      setUploadingFileName("");
    }
  };

  const handleFileDrop = (event: ReactDragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDraggingFile(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !fileBusy) void uploadSelectedFile(file);
  };

  const handleTemplateRequired = () => {
    if (templateDownloadAttentionFrameRef.current !== null) {
      window.cancelAnimationFrame(templateDownloadAttentionFrameRef.current);
      templateDownloadAttentionFrameRef.current = null;
    }
    if (templateDownloadAttentionTimerRef.current !== null) {
      window.clearTimeout(templateDownloadAttentionTimerRef.current);
      templateDownloadAttentionTimerRef.current = null;
    }
    setTemplateDownloadAttention(false);
    templateDownloadAttentionFrameRef.current = window.requestAnimationFrame(() => {
      templateDownloadAttentionFrameRef.current = null;
      setTemplateDownloadAttention(true);
      templateDownloadButtonRef.current?.focus();
      templateDownloadAttentionTimerRef.current = window.setTimeout(() => {
        setTemplateDownloadAttention(false);
        templateDownloadAttentionTimerRef.current = null;
      }, 600);
    });
  };

  const handleSubmit = () => {
    if ((node.kind === "form" || node.kind === "answer_sheet") && Object.keys(clientFieldErrors).length > 0) {
      setSubmitAttempted(true);
      const firstFieldId = Object.keys(clientFieldErrors)[0];
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(
          `[data-form-field-id="${firstFieldId}"]`,
        )?.focus();
      });
      return;
    }
    if (confirmationMissing) {
      setConfirmationAttempted(true);
      window.requestAnimationFrame(() => confirmationInputRef.current?.focus());
      return;
    }
    if (scanFilenameError) {
      setFileWarning({ message: scanFilenameError, title: "文件提交未通过" });
      return;
    }
    onSubmit();
  };
  return (
    <div className="runtime-node-dialog-backdrop" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className={`runtime-node-dialog ${runtime.status}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span>{statusLabels[runtime.status]}</span>
            <h2>{node.title}</h2>
            <p>{node.requirement}</p>
            {node.kind === "answer_sheet" ? (
              <div className="runtime-answer-sheet-header-meta">
                <span>
                  总分 {answerSheetTotalScore} 分
                </span>
                <span>
                  {runtime.attemptsRemaining === null ? "截止前不限次" : `剩余 ${runtime.attemptsRemaining} 次`}
                </span>
              </div>
            ) : null}
          </div>
          <button aria-label="关闭填写窗口" onClick={onClose} type="button">×</button>
        </header>
        {runtime.effectiveDeadline ? (
          <p className="runtime-deadline">
            截止时间：{new Date(runtime.effectiveDeadline).toLocaleString("zh-CN")}
          </p>
        ) : null}
        {runtime.status === "scheduled" && runtime.effectiveStartAt ? (
          <p className="runtime-scheduled-time">
            开放时间：{new Date(runtime.effectiveStartAt).toLocaleString("zh-CN")} · {formatCountdown(runtime.effectiveStartAt, clock)}
          </p>
        ) : null}
        {runtime.audit && !awaitingReview ? <AuditResult audit={runtime.audit} /> : null}
        {node.kind === "answer_sheet" && runtime.grade ? (
          <AnswerSheetGradeResult
            completion={answerSheetGradeCompletion}
            grade={runtime.grade}
            node={node}
          />
        ) : null}
        {readonly ? (
          <>
            {answerSheetGradeCompletion ? null : (
              <section className="runtime-completion-banner">
                <strong>{completionLabel}</strong>
                <span>提交时间：{formatDateTime(runtime.submittedAt)}</span>
              </section>
            )}
            <ReadonlySubmission instanceId={instanceId} node={node} onDownloadFile={onDownloadFile} payload={displayedPayload} submittedAt={runtime.submittedAt} />
            {canAmendApprovedForm ? (
              <div className="runtime-node-actions runtime-node-actions-readonly">
                <button
                  className="primary-action"
                  onClick={onBeginFormAmendment}
                  type="button"
                >
                  {Object.keys(runtime.draft).length > 0 ? "继续修改" : "修改内容"}
                </button>
              </div>
            ) : approvedForm ? (
              <p className="runtime-state-hint">节点已截止，如需修改请联系教师延期。</p>
            ) : null}
          </>
        ) : awaitingReview ? (
          <ReviewingSubmission instanceId={instanceId} node={node} onDownloadFile={onDownloadFile} runtime={runtime} />
        ) : effectivelyWritable ? (
          <div className="runtime-node-form">
          {node.kind === "form" ? (
            <RuntimeFormFields
              errors={visibleFieldErrors}
              fields={node.infoFields}
              onBlur={(fieldId) => setTouchedFieldIds((current) => new Set(current).add(fieldId))}
              onUpdate={(answerKey, value, fieldId) => onUpdate(answerKey, value, fieldId)}
              payload={draft}
            />
          ) : null}
          {node.kind === "answer_sheet" ? (
            <RuntimeAnswerSheet
              errors={visibleFieldErrors}
              instanceId={instanceId}
              node={node}
              onChange={(answers, fieldId) => onUpdate("answers", answers, fieldId)}
              payload={draft}
              readonly={false}
            />
          ) : null}
          {node.kind === "file" ? (
            <div className={`runtime-template-steps${templateRequired ? " has-template" : ""}`}>
            {runtime.template ? (
              <section className="runtime-template-download">
                <span>1</span>
                <div>
                  <strong>{runtime.templateDownloaded ? "模板已下载" : "下载填写模板"}</strong>
                  <small>{runtime.template.originalName} · {formatFileSize(runtime.template.sizeBytes)}</small>
                </div>
                <button disabled={busy} onClick={onDownloadTemplate} type="button">
                  {runtime.templateDownloaded ? "重新下载" : "下载填写模板"}
                </button>
              </section>
            ) : null}
            {runtime.template ? <strong className="runtime-upload-step-title">2 上传已填写文件</strong> : null}
            <label
              className={`runtime-file-workspace${isDraggingFile ? " is-dragging" : ""}${isUploadingFile ? " is-uploading" : ""}${needsFileReplacement ? " is-rejected" : ""}${fileReady ? " is-ready" : ""}${fileBusy ? " is-busy" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!fileBusy) setIsDraggingFile(true);
              }}
              onDragLeave={() => setIsDraggingFile(false)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleFileDrop}
            >
              <input
                disabled={fileBusy}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void uploadSelectedFile(file);
                }}
              />
              <span aria-hidden="true" className="runtime-file-workspace-icon">
                {needsFileReplacement ? "!" : fileReady ? "✓" : "↑"}
              </span>
              <span className="runtime-file-workspace-copy" aria-live="polite">
                <strong>
                  {!uploadUnlocked
                    ? "请先下载填写模板"
                    : isUploadingFile
                      ? "正在上传文件"
                      : needsFileReplacement
                        ? "审核未通过，请重新上传文件"
                        : fileReady
                          ? "文件已上传，可提交"
                          : "点击选择或拖拽文件到此处"}
                </strong>
                <small>
                  {!uploadUnlocked
                    ? "下载成功后自动解锁上传"
                    : isUploadingFile
                      ? `${uploadingFileName}，请勿关闭窗口`
                      : needsFileReplacement
                        ? `${getDraftFileName(runtime.submission.file)} · ${formatFileSize(submittedFile?.size)}`
                        : fileReady
                          ? `${getDraftFileName(draft.file)} · ${formatFileSize(pendingFile?.size)}`
                          : "选择后将自动上传"}
                </small>
              </span>
              {fileReady || needsFileReplacement ? (
                <span className="runtime-file-workspace-action">
                  {needsFileReplacement ? "重新上传" : "更换文件"}
                </span>
              ) : null}
            </label>
            {downloadableFileId ? (
              <div className="runtime-uploaded-file-actions">
                <button
                  disabled={busy}
                  onClick={() => onDownloadFile(downloadableFileId)}
                  type="button"
                >
                  {downloadingPreviousFile ? "下载上次提交文件" : "下载已上传文件"}
                </button>
              </div>
            ) : null}
            </div>
          ) : null}
          {node.kind === "confirmation" || node.kind === "announcement" ? (
            <div className="runtime-confirmation-field">
              <label className={`runtime-confirmation${confirmationInvalid ? " is-invalid" : ""}`}>
                <input
                  aria-describedby={confirmationInvalid ? "runtime-confirmation-error" : undefined}
                  aria-invalid={confirmationInvalid || undefined}
                  checked={Boolean(draft.confirmed)}
                  ref={confirmationInputRef}
                  type="checkbox"
                  onChange={(event) => {
                    if (event.target.checked) setConfirmationAttempted(false);
                    onUpdate("confirmed", event.target.checked);
                  }}
                />
                <span>我已阅读并确认以上内容</span>
              </label>
              {confirmationInvalid ? (
                <p id="runtime-confirmation-error" role="alert">请先勾选确认</p>
              ) : null}
            </div>
          ) : null}
          {node.kind === "confirmation" && scanRequired ? (
            <div className={`runtime-template-steps${runtime.template ? " has-template" : ""}`}>
              {runtime.template ? (
                <section
                  className={`runtime-template-download${templateDownloadAttention ? " needs-attention" : ""}`}
                >
                  <span>1</span>
                  <div>
                    <strong>{runtime.templateDownloaded ? "模板已下载" : "下载签署文件模板"}</strong>
                    <small>{runtime.template.originalName} · {formatFileSize(runtime.template.sizeBytes)}</small>
                  </div>
                  <button disabled={busy} onClick={onDownloadTemplate} ref={templateDownloadButtonRef} type="button">
                    {runtime.templateDownloaded ? "重新下载" : "下载模板"}
                  </button>
                </section>
              ) : null}
              <strong className="runtime-upload-step-title">
                {runtime.template ? "2 上传签署后的扫描件" : "上传图片材料"}
              </strong>
              <ScanUploadWorkspace
                disabled={busy}
                nodeInstanceId={runtime.id}
                onDownload={onDownloadFile}
                onStateChange={updateScanState}
                onTemplateRequired={handleTemplateRequired}
                templateFilename={runtime.template?.originalName ?? null}
                templateLocked={Boolean(runtime.template && !runtime.templateDownloaded)}
              />
            </div>
          ) : null}
          <div className="runtime-node-actions">
            <button disabled={fileBusy} onClick={onSave}>
              {amendingApprovedForm ? "暂存修改" : "暂存"}
            </button>
            <div className="runtime-submit-control">
              <button className="primary-action" disabled={submitDisabled} onClick={handleSubmit}>
                {isUploadingFile
                  ? "正在上传"
                  : busy
                    ? "处理中"
                    : amendingApprovedForm
                      ? "重新提交"
                      : "提交节点"}
              </button>
              {node.kind === "file" && !fileReady ? (
                <small>{needsFileReplacement ? "请重新上传文件" : "请先上传文件"}</small>
              ) : null}
            </div>
          </div>
          </div>
        ) : answerSheetAttemptsExhausted ? (
          <p className="runtime-state-hint">已达到最大作答次数，当前成绩不能继续重答。</p>
        ) : runtime.status === "audit_error" && runtime.audit?.canRetry ? (
          <div className="runtime-audit-retry">
            <p>{getStateHint(runtime.status)}</p>
            <button className="primary-action" disabled={busy} onClick={onRetryAudit}>
              {busy ? "正在发起" : "重新审核"}
            </button>
          </div>
        ) : <p className="runtime-state-hint">{getStateHint(runtime.status)}</p>}
      </section>
      {fileWarning ? (
        <RuntimeWarningDialog
          category="文件校验"
          idPrefix="runtime-file-warning"
          message={fileWarning.message}
          onClose={() => setFileWarning(null)}
          title={fileWarning.title}
        />
      ) : null}
    </div>
  );
}

function ReviewingSubmission({
  instanceId,
  node,
  onDownloadFile,
  runtime,
}: {
  instanceId: string;
  node: AcademicFlowNode;
  onDownloadFile: (fileId: string) => void;
  runtime: RuntimeNodeInstance;
}) {
  const attemptCount = Math.max(1, runtime.audit?.attemptCount || 1);
  const submittedAt = formatDateTime(runtime.submittedAt);
  const submittedAtLabel = submittedAt === "未记录"
    ? "提交时间暂未记录"
    : `提交于 ${submittedAt}`;
  return (
    <div className="runtime-reviewing-content">
      <section aria-live="polite" className="runtime-reviewing-card">
        <span aria-hidden="true" className="runtime-reviewing-spinner" />
        <div className="runtime-reviewing-copy">
          <span>审核处理中</span>
          <h3>材料已提交，正在自动审核</h3>
          <p>第 {attemptCount} 次审核 · {submittedAtLabel}</p>
          <small>审核结果会自动刷新，你可以先关闭此窗口处理其他事项。</small>
        </div>
      </section>
      <h3 className="runtime-reviewing-submission-title">本次提交内容</h3>
      <ReadonlySubmission
        instanceId={instanceId}
        node={node}
        onDownloadFile={onDownloadFile}
        payload={runtime.submission}
        submittedAt={runtime.submittedAt}
      />
    </div>
  );
}

function RuntimeWarningDialog({
  category,
  idPrefix,
  message,
  onClose,
  title,
}: {
  category: string;
  idPrefix: string;
  message: string;
  onClose: () => void;
  title: string;
}) {
  const messageId = `${idPrefix}-message`;
  const titleId = `${idPrefix}-title`;
  return (
    <div
      className="runtime-warning-backdrop"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <section
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="runtime-warning-dialog"
        role="alertdialog"
      >
        <span aria-hidden="true" className="runtime-warning-icon">
          <svg fill="none" viewBox="0 0 24 24">
            <path d="M12 8v5" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            <path d="M12 16.5h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
            <path d="M10.3 4.4 3.2 17a2 2 0 0 0 1.75 3h14.1a2 2 0 0 0 1.75-3L13.7 4.4a1.95 1.95 0 0 0-3.4 0Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
          </svg>
        </span>
        <div className="runtime-warning-copy">
          <span>{category}</span>
          <h3 id={titleId}>{title}</h3>
          <p id={messageId}>{message}</p>
        </div>
        <footer>
          <button autoFocus onClick={onClose} type="button">我知道了</button>
        </footer>
      </section>
    </div>
  );
}

function ReadonlySubmission({
  instanceId,
  node,
  onDownloadFile,
  payload,
  submittedAt,
}: {
  instanceId: string;
  node: AcademicFlowNode;
  onDownloadFile?: (fileId: string) => void;
  payload: Record<string, unknown>;
  submittedAt: string | null;
}) {
  if (node.kind === "answer_sheet") {
    return (
      <RuntimeAnswerSheet
        errors={{}}
        instanceId={instanceId}
        node={node}
        payload={payload}
        readonly
      />
    );
  }
  if (node.kind === "form") {
    return <ReadonlyFormFields fields={node.infoFields} payload={payload} />;
  }
  if (node.kind === "file") {
    const file = payload.file;
    const fileData = file && typeof file === "object" ? file as Record<string, unknown> : {};
    return (
      <section className="runtime-file-summary">
        <strong>已提交文件</strong>
        <dl>
          <div><dt>文件名</dt><dd>{formatSubmittedValue(fileData.name)}</dd></div>
          <div><dt>文件大小</dt><dd>{formatFileSize(fileData.size)}</dd></div>
          <div><dt>提交时间</dt><dd>{formatDateTime(submittedAt)}</dd></div>
        </dl>
      </section>
    );
  }
  if (node.kind === "confirmation" && Array.isArray(payload.scans)) {
    const scans = Array.isArray(payload.scans) ? payload.scans : [];
    return <section className="runtime-readonly-submission runtime-readonly-confirmation">
      <strong>{payload.confirmed === true ? "已阅读并确认" : "未记录确认状态"}</strong>
      <ul className="runtime-submitted-scan-list">{scans.map((value, index) => {
        const scan = value && typeof value === "object" ? value as Record<string, unknown> : {};
        const fileId = typeof scan.fileId === "string" ? scan.fileId : "";
        return <li key={fileId || index}><span>{formatSubmittedValue(scan.name)} · {formatSubmittedValue(scan.pageCount)} 页</span>{fileId && onDownloadFile ? <button onClick={() => onDownloadFile(fileId)} type="button">下载扫描件</button> : null}</li>;
      })}</ul>
    </section>;
  }
  return (
    <section className="runtime-readonly-submission runtime-readonly-confirmation">
      <strong>{payload.confirmed === true ? "已阅读并确认" : "未记录确认状态"}</strong>
    </section>
  );
}

function getStateHint(status: RuntimeNodeStatus) {
  if (status === "locked") return "需等待所有上游节点审核通过。";
  if (status === "scheduled") return "前置节点已完成，请等待到达起始时间。";
  if (status === "expired") return "节点已截止，请联系教师申请延期。";
  if (status === "reviewing" || status === "submitted") return "材料已提交，正在等待审核。";
  if (status === "audit_error") return "自动审核暂时失败，可直接重新审核，无需重新上传文件。";
  if (status === "approved") return "该节点已完成，提交内容已锁定。";
  return "请根据退回意见修改后重新提交。";
}

function formatCountdown(value: string, now: number) {
  const remaining = Math.max(0, new Date(value).getTime() - now);
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `约 ${minutes} 分钟后开放`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `约 ${hours} 小时后开放`;
  return `约 ${Math.ceil(hours / 24)} 天后开放`;
}

function formatSubmittedValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未记录";
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "未记录";
}

function formatDateTime(value: string | null): string {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未记录" : date.toLocaleString("zh-CN");
}

function formatFileSize(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "未记录";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function AuditMarkdown({ value }: { value: string }) {
  return (
    <div className="runtime-audit-markdown">
      <Markdown
        skipHtml
        components={{
          a({ node: _node, ...props }) {
            return <a {...props} rel="noopener noreferrer" target="_blank" />;
          },
          img() {
            return null;
          },
        }}
      >
        {value}
      </Markdown>
    </div>
  );
}

function AuditResult({ audit }: { audit: NonNullable<RuntimeNodeInstance["audit"]> }) {
  const reason = audit.reason?.trim() ?? "";
  const visibleReason = audit.status === "reviewing"
    ? ""
    : reason || (
      audit.status === "rejected"
        ? "审核未提供具体说明，请根据节点要求修改后重新提交。"
        : ""
    );
  if (!visibleReason && audit.status !== "reviewing") return null;
  return (
    <section className={`runtime-audit-result ${audit.status}`}>
      <strong>
        {audit.status === "reviewing" ? `自动审核中（第 ${audit.attemptCount || 1} 次执行）` : "审核结果"}
      </strong>
      {visibleReason ? <AuditMarkdown value={visibleReason} /> : null}
    </section>
  );
}

function getDraftFile(file: unknown): {
  fileId?: unknown;
  name?: unknown;
  originalName?: unknown;
  size?: unknown;
} | null {
  if (!file || typeof file !== "object") return null;
  return file as {
    fileId?: unknown;
    name?: unknown;
    originalName?: unknown;
    size?: unknown;
  };
}

function getDraftFileName(file: unknown): string {
  const value = getDraftFile(file);
  if (!value) return "尚未选择";
  if (typeof value.originalName === "string" && value.originalName) return value.originalName;
  if (typeof value.name === "string" && value.name) return value.name;
  return "尚未选择";
}
