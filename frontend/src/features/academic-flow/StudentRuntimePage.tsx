import { useEffect, useMemo, useState, type DragEvent as ReactDragEvent } from "react";
import Markdown from "react-markdown";

import type { AcademicFlowNode } from "../../types";
import { ApiError, workflowApi } from "./api";
import { validateFormAnswers } from "./formFields";
import { ReadonlyFormFields, RuntimeFormFields } from "./RuntimeFormFields";
import type {
  RuntimeFlowInstance,
  RuntimeNodeInstance,
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
}: {
  initialInstance?: RuntimeFlowInstance | null;
  instanceId: string;
  onHome: () => void;
}) {
  const [instance, setInstance] = useState<RuntimeFlowInstance | null>(initialInstance ?? null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [notice, setNotice] = useState("");
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [activeNodeKey, setActiveNodeKey] = useState<string | null>(null);
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
        if (!(node.id in next)) next[node.id] = node.draft;
      }
      return next;
    });
  }, [instance]);

  const isReviewing =
    instance?.nodeInstances.some((node) => node.status === "reviewing") ?? false;

  useEffect(() => {
    if (!isReviewing) return;
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
  }, [instanceId, isReviewing]);

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
    try {
      setInstance(await workflowApi.saveNodeDraft(runtime.id, drafts[runtime.id] ?? {}));
      setNotice("当前节点已暂存");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "暂存失败");
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
    setBusyNodeId(runtime.id);
    setNotice("");
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
        setNotice("自动审核通过，后续节点已按流程规则开放");
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
      setNotice(reason instanceof Error ? reason.message : "提交失败");
    } finally {
      setBusyNodeId(null);
    }
  };

  const retryAudit = async (runtime: RuntimeNodeInstance) => {
    setBusyNodeId(runtime.id);
    setNotice("");
    try {
      setInstance(await workflowApi.retryAudit(runtime.id));
      setNotice("已重新发起自动审核");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "重新审核失败");
    } finally {
      setBusyNodeId(null);
    }
  };

  const downloadTemplate = async (runtime: RuntimeNodeInstance) => {
    setBusyNodeId(runtime.id);
    setNotice("");
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
      setNotice(reason instanceof Error ? reason.message : "模板下载失败");
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
          onClick={onHome}
          title="返回首页"
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
          busy={busyNodeId === activeRuntime.id}
          draft={drafts[activeRuntime.id] ?? {}}
          fieldErrors={fieldErrorsByNode[activeRuntime.id] ?? {}}
          key={activeRuntime.id}
          node={activeNode}
          onClose={() => setActiveNodeKey(null)}
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
    </main>
  );
}

function RuntimeNodeDialog({
  busy,
  draft,
  fieldErrors,
  node,
  onClose,
  onDownloadTemplate,
  onSave,
  onRetryAudit,
  onSubmit,
  onUploadFile,
  onUpdate,
  runtime,
}: {
  busy: boolean;
  draft: Record<string, unknown>;
  fieldErrors: Record<string, string>;
  node: AcademicFlowNode;
  onClose: () => void;
  onDownloadTemplate: () => void;
  onSave: () => void;
  onRetryAudit: () => void;
  onSubmit: () => void;
  onUploadFile: (file: File) => Promise<void>;
  onUpdate: (field: string, value: unknown, fieldId?: string) => void;
  runtime: RuntimeNodeInstance;
}) {
  const writable = writableStatuses.has(runtime.status);
  const readonly = runtime.status === "approved";
  const displayedPayload = readonly ? runtime.submission : draft;
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadWarning, setUploadWarning] = useState("");
  const [uploadingFileName, setUploadingFileName] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touchedFieldIds, setTouchedFieldIds] = useState<Set<string>>(() => new Set());
  const draftFile = getDraftFile(draft.file);
  const fileReady = Boolean(draftFile?.fileId);
  const templateRequired = Boolean(runtime.template);
  const uploadUnlocked = !templateRequired || runtime.templateDownloaded;
  const fileBusy = busy || isUploadingFile || !uploadUnlocked;
  const submitDisabled = busy || (
    node.kind === "file" && (!uploadUnlocked || !fileReady || isUploadingFile)
  );
  const clientFieldErrors = node.kind === "form"
    ? validateFormAnswers(node.infoFields, draft)
    : {};
  const visibleFieldErrors = Object.fromEntries(
    Object.entries({ ...clientFieldErrors, ...fieldErrors }).filter(([fieldId]) =>
      submitAttempted || touchedFieldIds.has(fieldId) || Boolean(fieldErrors[fieldId]),
    ),
  );

  useEffect(() => {
    if (runtime.status !== "scheduled") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [runtime.status]);

  const uploadSelectedFile = async (file: File) => {
    setUploadWarning("");
    setUploadingFileName(file.name);
    setIsUploadingFile(true);
    try {
      await onUploadFile(file);
    } catch (reason) {
      setUploadWarning(reason instanceof Error ? reason.message : "文件上传失败");
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

  const handleSubmit = () => {
    if (node.kind === "form" && Object.keys(clientFieldErrors).length > 0) {
      setSubmitAttempted(true);
      const firstFieldId = Object.keys(clientFieldErrors)[0];
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(
          `[data-form-field-id="${firstFieldId}"]`,
        )?.focus();
      });
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
        {runtime.audit ? <AuditResult audit={runtime.audit} /> : null}
        {readonly ? (
          <>
            <section className="runtime-completion-banner">
              <strong>已完成 · 提交内容已锁定</strong>
              <span>提交时间：{formatDateTime(runtime.submittedAt)}</span>
            </section>
            <ReadonlySubmission node={node} payload={displayedPayload} submittedAt={runtime.submittedAt} />
          </>
        ) : writable ? (
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
              className={`runtime-file-workspace${isDraggingFile ? " is-dragging" : ""}${isUploadingFile ? " is-uploading" : ""}${fileReady ? " is-ready" : ""}${fileBusy ? " is-busy" : ""}`}
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
                {fileReady ? "✓" : "↑"}
              </span>
              <span className="runtime-file-workspace-copy" aria-live="polite">
                <strong>
                  {!uploadUnlocked ? "请先下载填写模板" : isUploadingFile ? "正在上传文件" : fileReady ? "文件已上传，可提交" : "点击选择或拖拽文件到此处"}
                </strong>
                <small>
                  {!uploadUnlocked
                    ? "下载成功后自动解锁上传"
                    : isUploadingFile
                    ? `${uploadingFileName}，请勿关闭窗口`
                    : fileReady
                      ? `${getDraftFileName(draft.file)} · ${formatFileSize(draftFile?.size)}`
                      : "选择后将自动上传"}
                </small>
              </span>
              {fileReady ? <span className="runtime-file-workspace-action">更换文件</span> : null}
            </label>
            </div>
          ) : null}
          {node.kind === "confirmation" || node.kind === "announcement" ? (
            <label className="runtime-confirmation">
              <input
                checked={Boolean(draft.confirmed)}
                type="checkbox"
                onChange={(event) => onUpdate("confirmed", event.target.checked)}
              />
              <span>我已阅读并确认以上内容</span>
            </label>
          ) : null}
          <div className="runtime-node-actions">
            <button disabled={fileBusy} onClick={onSave}>暂存</button>
            <div className="runtime-submit-control">
              <button className="primary-action" disabled={submitDisabled} onClick={handleSubmit}>
                {isUploadingFile ? "正在上传" : busy ? "处理中" : "提交节点"}
              </button>
              {node.kind === "file" && !fileReady ? <small>请先上传文件</small> : null}
            </div>
          </div>
          </div>
        ) : runtime.status === "audit_error" && runtime.audit?.canRetry ? (
          <div className="runtime-audit-retry">
            <p>{getStateHint(runtime.status)}</p>
            <button className="primary-action" disabled={busy} onClick={onRetryAudit}>
              {busy ? "正在发起" : "重新审核"}
            </button>
          </div>
        ) : <p className="runtime-state-hint">{getStateHint(runtime.status)}</p>}
      </section>
      {uploadWarning ? (
        <div
          className="runtime-upload-warning-backdrop"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <section
            aria-describedby="runtime-upload-warning-message"
            aria-labelledby="runtime-upload-warning-title"
            aria-modal="true"
            className="runtime-upload-warning-dialog"
            role="alertdialog"
          >
            <span aria-hidden="true" className="runtime-upload-warning-icon">
              <svg fill="none" viewBox="0 0 24 24">
                <path d="M12 8v5" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
                <path d="M12 16.5h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
                <path d="M10.3 4.4 3.2 17a2 2 0 0 0 1.75 3h14.1a2 2 0 0 0 1.75-3L13.7 4.4a1.95 1.95 0 0 0-3.4 0Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            </span>
            <div className="runtime-upload-warning-copy">
              <span>文件校验</span>
              <h3 id="runtime-upload-warning-title">文件上传未通过</h3>
              <p id="runtime-upload-warning-message">{uploadWarning}</p>
            </div>
            <footer>
              <button autoFocus onClick={() => setUploadWarning("")} type="button">
                我知道了
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ReadonlySubmission({
  node,
  payload,
  submittedAt,
}: {
  node: AcademicFlowNode;
  payload: Record<string, unknown>;
  submittedAt: string | null;
}) {
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
