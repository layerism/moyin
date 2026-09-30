import { nodeReferences } from "./nodeReferences";
import type { NodeTemplateAsset } from "../../types";
import { saveStudentFile } from "./saveStudentFile";
import { FileReviewDialog } from "./FileReviewDialog";
import { hasSequentialManualReview } from "./FileReviewStepsEditor";
import { FeedbackDownload, ManualFeedbackList } from "./ManualFeedbackList";
import { ManualReviewDialog } from "./ManualReviewDialog";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import Markdown from "react-markdown";
import { CompletedReviewFeedback, ReviewProgress } from "./ReviewProgress";
import { AnnouncementMarkdown } from "./AnnouncementMarkdown";
import { FileFormatIcon } from "./FileFormatIcon";

import type { AcademicFlowNode } from "../../types";
import { ApiError, FLOW_PREVIEW_TOKEN_KEY, workflowApi } from "./api";
import { validateFormAnswers } from "./formFields";
import { answerSheetMaxScore, validateAnswerSheetSubmission } from "./answerSheet";
import { AnswerSheetGradeResult, countUnansweredQuestions, RuntimeAnswerSheet } from "./RuntimeAnswerSheet";
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
  skipped: "未选择",
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
  const seenRejections = useRef<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [notice, setNotice] = useState("");
  const [actionWarning, setActionWarning] = useState("");
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [previewReviewNode, setPreviewReviewNode] = useState<string | null>(null);
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
    const newlyRejected = new Set(instance.nodeInstances.filter((node) => node.manualRejection && seenRejections.current[node.id] !== node.manualRejection.id).map((node) => node.id));
    for (const node of instance.nodeInstances) {
      if (node.manualRejection) seenRejections.current[node.id] = node.manualRejection.id;
    }
    setDrafts((current) => {
      const next = { ...current };
      for (const node of instance.nodeInstances) {
        if (!(node.id in next) || newlyRejected.has(node.id)) {
          const configNode = instance.config.nodes.find((item) => item.id === node.nodeKey);
          next[node.id] = configNode?.kind === "branch" && node.requiresResubmission && node.draft.branchId
            ? node.draft
            : configNode?.kind === "branch" && node.submission.branchId
            ? node.submission
            : configNode?.kind === "answer_sheet" && Object.keys(node.draft).length === 0
              ? node.submission
              : node.draft;
        }
      }
      return next;
    });
  }, [instance]);

  const isAwaitingReview = Boolean(
    instance?.nodeInstances.some(
      (node) => node.status === "reviewing" || node.status === "submitted",
    ),
  );

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
    } catch (reason) {
      setActionWarning(reason instanceof Error ? reason.message : "暂存失败");
    } finally {
      setBusyNodeId(null);
    }
  };

  const uploadFile = async (runtime: RuntimeNodeInstance, file: File) => {
    setBusyNodeId(runtime.id);
    setNotice("");
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
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "文件上传失败";
      setNotice("");
      throw reason instanceof Error ? reason : new Error(message);
    } finally {
      setBusyNodeId(null);
    }
  };

  const submit = async (runtime: RuntimeNodeInstance) => {
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
      const submittedConfigNode = next.config.nodes.find((node) => node.id === runtime.nodeKey);
      if (submittedConfigNode?.kind === "answer_sheet" && submittedNode) {
        setDrafts((current) => ({
          ...current,
          [runtime.id]: Object.keys(submittedNode.draft).length > 0
            ? submittedNode.draft
            : submittedNode.submission,
        }));
      }
      if (submittedNode?.status === "approved") {
        setAmendingNodeId(null);
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
      if (!await saveStudentFile("template", runtime.id, runtime.template?.originalName || "填写模板")) return;
      await workflowApi.downloadNodeTemplate(runtime.id);
      setInstance(await workflowApi.getInstance(instanceId));
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
      const candidates = [runtime.draft.file, runtime.submission.file, ...(Array.isArray(runtime.submission.scans) ? runtime.submission.scans : [])];
      const file = candidates.find((item) => item && typeof item === "object" && "fileId" in item && item.fileId === fileId) as { name?: string } | undefined;
      await saveStudentFile("file", fileId, file?.name || "下载文件");
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
      <header className="student-runtime-header runtime-header-redesign">
        <button
          aria-label={preview ? "关闭预览" : "返回我的流程"}
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
        <h1 className="runtime-inline-title" title={instance.name}>{instance.name}</h1>
        <strong className={`runtime-overall-status ${instance.status}`}>{instance.status === "completed" ? "全部完成" : "填写中"}</strong>
        <span className="runtime-inline-progress">{instance.nodeInstances.filter(node => node.status === "approved").length} / {instance.nodeInstances.filter(node => node.status !== "skipped").length}<span> 已通过</span></span>
        {instance.description && <details className="runtime-header-description">
          <summary aria-label="流程说明"><span aria-hidden="true">ⓘ</span><span className="runtime-description-label">说明</span></summary>
          <p>{instance.description}</p>
        </details>}
        <div className="runtime-inline-identity" aria-label={preview ? "学生预览身份" : "学生身份"}>
          <span aria-hidden="true" className="runtime-student-avatar">{instance.student.name.slice(0, 1) || "学"}</span>
          <strong>{instance.student.name}</strong><small>{instance.student.studentNo}</small>
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
        preview={preview}
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
          onPreviewReview={preview && hasSequentialManualReview(activeNode) ? () => setPreviewReviewNode(activeNode.id) : undefined}
          runtime={activeRuntime}
        />
      ) : null}
      {previewReviewNode ? (() => {
        const closeReview = () => { setPreviewReviewNode(null); void workflowApi.getInstance(instanceId).then(setInstance).catch((reason: Error) => setNotice(reason.message)); };
        return hasSequentialManualReview(instance.config.nodes.find((node) => node.id === previewReviewNode))
          ? <FileReviewDialog nodeKey={previewReviewNode} versionId={instance.flowVersionId} allowBulkDownload={false} onClose={closeReview} />
          : <ManualReviewDialog nodeKey={previewReviewNode} versionId={instance.flowVersionId} onClose={closeReview} />;
      })() : null}
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
  onPreviewReview,
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
  onPreviewReview?: () => void;
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
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (document.querySelector('dialog[open], [role="alertdialog"]')) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [fileWarning, setFileWarning] = useState<{
    message: string;
    title: string;
  } | null>(null);
  const [uploadingFileName, setUploadingFileName] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const gradeDialogRef = useRef<HTMLDialogElement>(null);
  const submitConfirmationRef = useRef<HTMLDialogElement>(null);
  const [templateDownloadAttention, setTemplateDownloadAttention] = useState(false);
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
  const canRetryApprovedAnswerSheet = runtime.status === "approved"
    && node.kind === "answer_sheet"
    && runtime.attemptsRemaining !== 0
    && !deadlinePassed;
  const writable = writableStatuses.has(runtime.status) || (
    approvedForm && amendingApprovedForm && !deadlinePassed
  ) || canRetryApprovedAnswerSheet;
  const answerSheetAttemptsExhausted = node.kind === "answer_sheet"
    && runtime.attemptsRemaining === 0;
  const effectivelyWritable = writable && !answerSheetAttemptsExhausted;
  const expiredAnswerSheetSubmission = node.kind === "answer_sheet"
    && runtime.status === "expired"
    && Object.keys(runtime.submission).length > 0;
  const readonly = (runtime.status === "approved" || expiredAnswerSheetSubmission) && !writable;
  const completedBranch = readonly && node.kind === "branch";
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
  const needsFileReplacement = (runtime.status === "rejected" || runtime.requiresResubmission) && Boolean(
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
  const referenceFiles = nodeReferences(node);
  const uploadUnlocked = !templateRequired || runtime.templateDownloaded;
  const fileBusy = busy || isUploadingFile || !uploadUnlocked;
  const scanRequired = node.kind === "confirmation" && (
    Boolean(runtime.template) || node.scanAuditEnabled === true || Boolean(node.fileReviewSteps?.length)
  );
  const scanBlocker = getScanSubmitBlocker({
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
  const unansweredCount = node.kind === "answer_sheet"
    ? countUnansweredQuestions(node.answerSheet?.questions ?? [], draft)
    : 0;
  const answerSheetQuestionCount = node.answerSheet?.questions.length ?? 0;
  const answeredCount = node.kind === "answer_sheet"
    ? answerSheetQuestionCount - countUnansweredQuestions(node.answerSheet?.questions ?? [], displayedPayload)
    : 0;
  const submitDisabled = busy
    || (node.kind === "branch" && !node.branches?.some((option) => option.id === draft.branchId))
    || (node.kind === "file" && (!uploadUnlocked || !fileReady || isUploadingFile))
    || Boolean(scanBlocker);
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
    setSubmitAttempted(false);
    setTouchedFieldIds(new Set());
  }, [runtime.attemptNo]);

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

  const handleFileDrop = (event: ReactDragEvent<HTMLDivElement>) => {
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
    if (submitDisabled || !effectivelyWritable) return;
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
    if (scanFilenameError) {
      setFileWarning({ message: scanFilenameError, title: "文件提交未通过" });
      return;
    }
    submitConfirmationRef.current?.showModal();
  };
  const materialsSection = <>
    {runtime.template || referenceFiles.length ? (
      <section className="runtime-materials" aria-label="填写资料">
        <h3>填写资料</h3>
        {referenceFiles.map((asset) => <NodeReferenceCard key={asset.assetId} asset={asset} nodeInstanceId={runtime.id} label={node.kind === "confirmation" ? "参考示例" : "填写参考"} compact />)}
        {runtime.template ? <section className={`runtime-material-row${templateDownloadAttention ? " needs-attention" : ""}`} aria-label="填写模板">
          <FileFormatIcon filename={runtime.template.originalName} />
          <div className="runtime-material-copy">
            <strong>{node.kind === "confirmation" ? "签署模板" : "填写模板"}</strong>
            <p title={`${runtime.template.originalName} · ${formatFileSize(runtime.template.sizeBytes)}`}>{runtime.template.originalName}</p>
          </div>
          <small className={`runtime-material-status${runtime.templateDownloaded ? " is-downloaded" : ""}`}>{runtime.templateDownloaded ? "已下载" : "待下载"}</small>
          <button disabled={busy} onClick={onDownloadTemplate} ref={templateDownloadButtonRef} type="button">
            {runtime.templateDownloaded ? "重新下载" : "下载模板"}
          </button>
        </section> : null}
      </section>
    ) : null}
    {referenceFiles.length ? <small className="runtime-material-note">填写参考为可选资料，不影响材料提交。</small> : null}
  </>;
  return (
    <div className="runtime-node-dialog-backdrop" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className={`runtime-node-dialog ${runtime.status}${node.kind === "file" ? " runtime-file-dialog" : ""}${node.kind === "file" || (node.kind === "confirmation" && scanRequired) ? " runtime-material-dialog" : ""}${completedBranch ? " runtime-branch-completed-dialog" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            {completedBranch ? null : <span>{statusLabels[runtime.status]}</span>}
            <h2>{node.title}</h2>
            {node.kind !== "announcement" && node.requirement?.trim() ? <div className="runtime-node-description">
              <span className="runtime-description-icon" aria-hidden="true">!</span>
              <p>{node.requirement}</p>
            </div> : null}
            {completedBranch ? <p className="runtime-branch-requirement">分支选择已完成，可返回流程查看对应任务。</p> : null}
            {node.kind === "answer_sheet" ? (
              <div className="runtime-answer-sheet-header-meta">
                <span>
                  总分 {answerSheetTotalScore} 分
                </span>
                <span>
                  {runtime.attemptsRemaining === null ? "截止前不限次" : `剩余 ${runtime.attemptsRemaining} 次`}
                </span>
                <span aria-live="polite">已答 {answeredCount} / {answerSheetQuestionCount}</span>
                {runtime.grade ? (
                  <button className="runtime-grade-trigger" onClick={() => gradeDialogRef.current?.showModal()} type="button">
                    查看节点分数
                  </button>
                ) : null}
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
        {runtime.manualRejection ? <section className="runtime-manual-rejection" aria-label="教师审核意见">
          <header><strong>教师审核未通过</strong><small>{formatDateTime(runtime.manualRejection.reviewedAt)}</small></header>
          <p>{runtime.manualRejection.remark}</p>
          <small>请根据审核意见修改本节点内容，并重新提交。</small>
          {runtime.manualRejection.files.map((file) => <div className="manual-feedback-published-file" key={file.id}>
            <span><strong>{file.name}</strong><small>对应原件：{file.sourceName}</small></span>
            <FeedbackDownload fileId={file.id} filename={file.name} student>下载批改件</FeedbackDownload>
          </div>)}
        </section> : null}
        {runtime.progressResetReason != null ? <p className="runtime-state-hint">教师已撤销通过，需要重新完成。{runtime.progressResetReason ? `原因：${runtime.progressResetReason}` : ""}</p> : null}
        {runtime.requiresResubmission && runtime.progressResetReason == null && !runtime.manualRejection && runtime.status !== "approved" ? <p className="runtime-state-hint">前置材料已变更，本节点需要重新完成，原提交记录仍保留。</p> : null}
        {runtime.audit && !awaitingReview && !(["file", "confirmation"].includes(node.kind) && runtime.reviewTimeline?.length && runtime.status !== "audit_error") ? <AuditResult audit={runtime.audit} /> : null}
        {(node.kind === "file" || (node.kind === "confirmation" && Boolean(node.fileReviewSteps?.length))) && !awaitingReview ? <ReviewProgress runtime={runtime} onPreviewReview={onPreviewReview} /> : null}
        {["file", "confirmation"].includes(node.kind) && runtime.status === "approved" ? <CompletedReviewFeedback runtime={runtime} /> : null}
        {["file", "confirmation"].includes(node.kind) && !runtime.reviewTimeline?.length ? <ManualFeedbackList feedback={(runtime.feedback ?? []).filter((item) => !item.historical)} student /> : null}
        {node.kind === "confirmation" && !scanRequired && writable ? referenceFiles.map((asset) => <NodeReferenceCard key={asset.assetId} asset={asset} nodeInstanceId={runtime.id} label="参考示例" />) : null}
        {node.kind === "announcement" && node.requirement?.trim() ? (
          <section aria-label="公告正文" className="runtime-announcement-body runtime-node-description">
            <span className="runtime-description-icon" aria-hidden="true">!</span>
            <div className="runtime-description-content">
            <AnnouncementMarkdown instanceId={instanceId} nodeId={node.id}>{node.requirement}</AnnouncementMarkdown>
            </div>
          </section>
        ) : null}
        {completedBranch ? (
          <>
            <div className="runtime-branch-result">
              <span className="runtime-branch-approved"><span aria-hidden="true">✓</span> 已通过</span>
              <ReadonlySubmission instanceId={instanceId} node={node} payload={displayedPayload} submittedAt={runtime.submittedAt} />
              <div className="runtime-branch-submitted"><span>提交时间</span><span>{formatDateTime(runtime.submittedAt)}</span></div>
              <p className="runtime-branch-locked">
                <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                提交内容已锁定，分支不可更改
              </p>
            </div>
            <footer className="runtime-branch-footer"><button className="primary-action" onClick={onClose} type="button">返回流程</button></footer>
          </>
        ) : readonly ? (
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
          <ReviewingSubmission instanceId={instanceId} node={node} onDownloadFile={onDownloadFile} runtime={runtime} onPreviewReview={onPreviewReview} />
        ) : effectivelyWritable ? (
          <div className="runtime-node-form">
          {node.kind === "branch" ? <fieldset className="runtime-branch-options" disabled={!effectivelyWritable || busy}>
            <legend>请选择一个分支</legend>
            {node.branches?.map((option) => <label key={option.id} className={draft.branchId === option.id ? "selected" : ""}>
              <input type="radio" name={`branch-${node.id}`} checked={draft.branchId === option.id}
                disabled={!runtime.requiresResubmission && Boolean(runtime.submission.branchId) && runtime.submission.branchId !== option.id}
                onChange={() => onUpdate("branchId", option.id)} />
              <span>{option.label}</span>
            </label>)}
            <small>{runtime.requiresResubmission ? "原选择已撤销，可重新选择分支。" : "提交后不可更改选择。"}</small>
          </fieldset> : null}
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
            {materialsSection}
            <strong className="runtime-upload-step-title">上传已填写文件</strong>
            <div
              className={`runtime-file-workspace${isDraggingFile ? " is-dragging" : ""}${isUploadingFile ? " is-uploading" : ""}${needsFileReplacement ? " is-rejected" : ""}${fileReady ? " is-ready" : ""}${fileBusy ? " is-busy" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!fileBusy) setIsDraggingFile(true);
              }}
              onDragLeave={() => setIsDraggingFile(false)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleFileDrop}
            >
              <label className="runtime-file-workspace-select">
              <input
                id={`runtime-file-input-${runtime.id}`}
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
              </label>
              <div className="runtime-file-inline-actions">
              {fileReady || needsFileReplacement ? (
                <button type="button" disabled={fileBusy} className="runtime-file-workspace-action" onClick={() => document.getElementById(`runtime-file-input-${runtime.id}`)?.click()}>
                  {needsFileReplacement ? "重新上传" : "更换文件"}
                </button>
              ) : null}
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
            </div>
            </div>
          ) : null}
          {node.kind === "confirmation" && scanRequired ? (
            <div className={`runtime-template-steps${runtime.template ? " has-template" : ""}`}>
              {materialsSection}
              <strong className="runtime-upload-step-title">
                {runtime.template ? "上传签署后的扫描件" : "上传图片材料"}
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
              <button className="primary-action" disabled={submitDisabled || (node.kind === "answer_sheet" && Object.keys(clientFieldErrors).length > 0)} onClick={handleSubmit}>
                {isUploadingFile
                  ? "正在上传"
                  : busy
                    ? "处理中"
                    : amendingApprovedForm
                      ? "重新提交"
                      : "提交节点"}
              </button>
              {node.kind === "answer_sheet" && unansweredCount === 0 && Object.keys(clientFieldErrors).length > 0 ? (
                <small>请检查答案后再提交</small>
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
      <dialog
        aria-labelledby="runtime-submit-confirm-title"
        aria-describedby="runtime-submit-confirm-message"
        className="runtime-submit-confirm-dialog"
        onKeyDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        ref={submitConfirmationRef}
      >
        <h3 id="runtime-submit-confirm-title">确认提交此节点？</h3>
        <div id="runtime-submit-confirm-message">
          <p className="runtime-submit-confirm-target">提交节点：<strong>{node.title}</strong></p>
          <SubmitConfirmationMessage
            amendingApprovedForm={amendingApprovedForm}
            draft={draft}
            node={node}
            runtime={runtime}
          />
        </div>
        <footer>
          <button autoFocus onClick={() => submitConfirmationRef.current?.close()} type="button">返回检查</button>
          <button
            className="primary-action"
            disabled={submitDisabled || !effectivelyWritable}
            onClick={() => {
              const dialog = submitConfirmationRef.current;
              if (!dialog?.open || submitDisabled || !effectivelyWritable) return;
              dialog.close();
              onSubmit();
            }}
            type="button"
          >确认提交</button>
        </footer>
      </dialog>
      {node.kind === "answer_sheet" && runtime.grade ? (
        <dialog
          aria-label="节点分数"
          className="runtime-grade-dialog"
          onKeyDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) gradeDialogRef.current?.close();
          }}
          ref={gradeDialogRef}
        >
          <header>
            <h3>节点分数</h3>
            <button aria-label="关闭节点分数" onClick={() => gradeDialogRef.current?.close()} type="button">×</button>
          </header>
          <AnswerSheetGradeResult completion={answerSheetGradeCompletion} grade={runtime.grade} node={node} />
        </dialog>
      ) : null}
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

function SubmitConfirmationMessage({
  amendingApprovedForm,
  draft,
  node,
  runtime,
}: {
  amendingApprovedForm: boolean;
  draft: Record<string, unknown>;
  node: AcademicFlowNode;
  runtime: RuntimeNodeInstance;
}) {
  if (node.kind === "branch") {
    return (
      <>
        <p className="runtime-submit-confirm-detail">
          选择分支：<strong>{node.branches?.find((option) => option.id === draft.branchId)?.label}</strong>
        </p>
        <p>分支提交后不可更改，请确认选择无误。</p>
      </>
    );
  }
  if (node.kind === "answer_sheet") {
    return <p>{runtime.attemptsRemaining === null
      ? "系统将记录本次作答并立即判分，请确认答案无误。"
      : `本次提交将消耗 1 次作答机会，提交后剩余 ${Math.max(0, runtime.attemptsRemaining - 1)} 次。`}</p>;
  }
  if (node.auditScriptId || node.scanAuditEnabled || node.fileReviewSteps?.length) {
    return <p>提交后材料将进入审核流程，审核期间不能修改。</p>;
  }
  if (amendingApprovedForm) {
    return <p>重新提交后将更新当前通过内容，请确认修改无误。</p>;
  }
  return <p>提交后系统将保存当前内容并处理后续节点，请确认内容无误。</p>;
}

function ReviewingSubmission({
  instanceId,
  node,
  onDownloadFile,
  runtime,
  onPreviewReview,
}: {
  instanceId: string;
  node: AcademicFlowNode;
  onDownloadFile: (fileId: string) => void;
  runtime: RuntimeNodeInstance;
  onPreviewReview?: () => void;
}) {
  const manual = runtime.reviewStage === "manual";
  const attemptCount = Math.max(1, runtime.audit?.attemptCount || 1);
  const submittedAt = formatDateTime(runtime.submittedAt);
  const submittedAtLabel = submittedAt === "未记录"
    ? "提交时间暂未记录"
    : `提交于 ${submittedAt}`;
  return (
    <div className="runtime-reviewing-content">
      {node.kind !== "file" && !(node.kind === "confirmation" && runtime.reviewTimeline?.length) ? <section aria-live="polite" className="runtime-reviewing-card">
        <span aria-hidden="true" className="runtime-reviewing-spinner" />
        <div className="runtime-reviewing-copy">
          <span>{manual ? "等待教师审核" : "审核处理中"}</span>
          <h3>{manual ? "材料已提交，等待流程发布者审核" : "材料已提交，正在自动审核"}</h3>
          <p>{manual ? submittedAtLabel : `第 ${attemptCount} 次审核 · ${submittedAtLabel}`}</p>
          <small>审核结果会自动刷新，你可以先关闭此窗口处理其他事项。</small>
        </div>
      </section> : null}
      {node.kind === "file" || (node.kind === "confirmation" && Boolean(node.fileReviewSteps?.length)) ? <ReviewProgress runtime={runtime} onPreviewReview={onPreviewReview} /> : null}
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
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

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

function SubmissionDownloadButton({ filename, onDownload }: { filename: string; onDownload: () => void }) {
  return <button className="runtime-attachment-download" type="button" onClick={onDownload}
    title="下载文件" aria-label={`下载文件：${filename}`}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /></svg>
  </button>;
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
  if (node.kind === "branch") return (
    <div className="runtime-branch-summary">
      <span className="runtime-branch-icon" aria-hidden="true">
        <svg fill="none" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M6 7v10M18 7a9 9 0 0 1-9 9H6" /></svg>
      </span>
      <div className="runtime-branch-selection"><span>已选择的分支</span><strong>{node.branches?.find((option) => option.id === payload.branchId)?.label ?? "未选择"}</strong></div>
      <svg className="runtime-branch-check" aria-hidden="true" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
    </div>
  );
  if (node.kind === "form") {
    return <ReadonlyFormFields fields={node.infoFields} payload={payload} />;
  }
  if (node.kind === "file") {
    const file = payload.file;
    const fileData = file && typeof file === "object" ? file as Record<string, unknown> : {};
    const filename = formatSubmittedValue(fileData.name);
    const extension = typeof fileData.name === "string" ? fileData.name.match(/\.([a-z0-9]{1,6})$/i)?.[1].toUpperCase() : undefined;
    return (
      <section className="runtime-file-summary" aria-label="已提交文件">
        <div className="runtime-attachment-type" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M14 3H6v18h12V7l-4-4Zm0 0v5h4M9 12h6m-6 4h6" /></svg>
          <span>{extension || "FILE"}</span>
        </div>
        <div className="runtime-attachment-details">
          <strong>{filename}</strong>
          <span>{formatFileSize(fileData.size)} · 已提交</span>
          <small>提交于 {formatDateTime(submittedAt)}</small>
        </div>
        {typeof fileData.fileId === "string" && onDownloadFile ? (
          <SubmissionDownloadButton filename={filename} onDownload={() => onDownloadFile(fileData.fileId as string)} />
        ) : null}
      </section>
    );
  }

  if (node.kind === "confirmation" && Array.isArray(payload.scans)) {
    const scans = Array.isArray(payload.scans) ? payload.scans : [];
    return <section className="runtime-readonly-submission runtime-readonly-confirmation runtime-submitted-files">
      <h3>已提交文件</h3>
      <ul className="runtime-submitted-scan-list">{scans.map((value, index) => {
        const scan = value && typeof value === "object" ? value as Record<string, unknown> : {};
        const fileId = typeof scan.fileId === "string" ? scan.fileId : "";
        return <li key={fileId || index}><FileFormatIcon filename={formatSubmittedValue(scan.name)} /><span className="runtime-submitted-file-name" title={formatSubmittedValue(scan.name)}>{formatSubmittedValue(scan.name)}</span><small>{formatSubmittedValue(scan.pageCount)} 页</small>{fileId && onDownloadFile ? <SubmissionDownloadButton filename={formatSubmittedValue(scan.name)} onDownload={() => onDownloadFile(fileId)} /> : null}</li>;
      })}</ul>
    </section>;
  }
  return (
    <section className="runtime-readonly-submission runtime-readonly-confirmation">
      <strong>已提交</strong>
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


function NodeReferenceCard({ asset, nodeInstanceId, label, compact = false }: { asset: NodeTemplateAsset; nodeInstanceId: string; label: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const download = async () => {
    setBusy(true); setError("");
    try {
      await saveStudentFile("reference", nodeInstanceId, asset.originalName || label, asset.assetId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "参考文件下载失败"); }
    finally { setBusy(false); }
  };
  return <section className={compact ? "runtime-material-row" : "runtime-node-reference"} aria-label={label}>
    {compact ? <FileFormatIcon filename={asset.originalName} /> : null}
    <div className={compact ? "runtime-material-copy" : undefined}><strong>{label}</strong><p title={asset.originalName}>{asset.originalName}</p>{compact ? null : <small>可选参考资料，不影响材料提交。</small>}</div>
    {compact ? <small className="runtime-material-status">可选</small> : null}
    <button type="button" disabled={busy} onClick={() => void download()}>{busy ? "正在下载…" : "下载参考"}</button>
    {error ? <p role="alert" className="dialog-error">{error}</p> : null}
  </section>;
}
