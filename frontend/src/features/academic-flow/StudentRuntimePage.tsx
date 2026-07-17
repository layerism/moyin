import { useEffect, useMemo, useState } from "react";

import type { AcademicFlowNode } from "../../types";
import { workflowApi } from "./api";
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

  const runtimeByKey = useMemo(
    () => new Map(instance?.nodeInstances.map((node) => [node.nodeKey, node]) ?? []),
    [instance],
  );
  const activeNode = instance?.config.nodes.find((node) => node.id === activeNodeKey) ?? null;
  const activeRuntime = activeNodeKey ? runtimeByKey.get(activeNodeKey) ?? null : null;

  useEffect(() => {
    if (activeRuntime?.status === "approved") setActiveNodeKey(null);
  }, [activeRuntime?.status]);

  const updateDraft = (runtimeId: string, field: string, value: unknown) => {
    setDrafts((current) => ({
      ...current,
      [runtimeId]: { ...(current[runtimeId] ?? {}), [field]: value },
    }));
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
      setNotice(reason instanceof Error ? reason.message : "文件上传失败");
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
      const submittedNode = next.nodeInstances.find((node) => node.id === runtime.id);
      if (submittedNode?.status === "approved") {
        setActiveNodeKey(null);
        setNotice("自动审核通过，后续节点已按流程规则开放");
      } else {
        setNotice("节点已提交，正在自动审核");
      }
    } catch (reason) {
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
          node={activeNode}
          onClose={() => setActiveNodeKey(null)}
          onSave={() => void save(activeRuntime)}
          onRetryAudit={() => void retryAudit(activeRuntime)}
          onSubmit={() => void submit(activeRuntime)}
          onUploadFile={(file) => void uploadFile(activeRuntime, file)}
          onUpdate={(field, value) => updateDraft(activeRuntime.id, field, value)}
          runtime={activeRuntime}
        />
      ) : null}
    </main>
  );
}

function RuntimeNodeDialog({
  busy,
  draft,
  node,
  onClose,
  onSave,
  onRetryAudit,
  onSubmit,
  onUploadFile,
  onUpdate,
  runtime,
}: {
  busy: boolean;
  draft: Record<string, unknown>;
  node: AcademicFlowNode;
  onClose: () => void;
  onSave: () => void;
  onRetryAudit: () => void;
  onSubmit: () => void;
  onUploadFile: (file: File) => void;
  onUpdate: (field: string, value: unknown) => void;
  runtime: RuntimeNodeInstance;
}) {
  const writable = writableStatuses.has(runtime.status);
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
        {runtime.audit ? <AuditResult audit={runtime.audit} /> : null}
        {writable ? (
          <div className="runtime-node-form">
          {node.kind === "form"
            ? node.infoFields.map((field) => (
                <label key={field}>
                  <span>{field}</span>
                  <input
                    value={String(draft[field] ?? "")}
                    onChange={(event) => onUpdate(field, event.target.value)}
                  />
                </label>
              ))
            : null}
          {node.kind === "file" ? (
            <label className="runtime-file-input">
              <span>选择文件</span>
              <input
                disabled={busy}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onUploadFile(file);
                  }
                }}
              />
              <small>{getDraftFileName(draft.file)}</small>
            </label>
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
            <button disabled={busy} onClick={onSave}>暂存</button>
            <button className="primary-action" disabled={busy} onClick={onSubmit}>
              {busy ? "处理中" : "提交节点"}
            </button>
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
    </div>
  );
}

function getStateHint(status: RuntimeNodeStatus) {
  if (status === "locked") return "需等待所有上游节点审核通过。";
  if (status === "expired") return "节点已截止，请联系教师申请延期。";
  if (status === "reviewing" || status === "submitted") return "材料已提交，正在等待审核。";
  if (status === "audit_error") return "自动审核暂时失败，可直接重新审核，无需重新上传文件。";
  if (status === "approved") return "该节点已完成，提交内容已锁定。";
  return "请根据退回意见修改后重新提交。";
}

function AuditResult({ audit }: { audit: NonNullable<RuntimeNodeInstance["audit"]> }) {
  if (!audit.reason && !audit.details && audit.status !== "reviewing") return null;
  return (
    <section className={`runtime-audit-result ${audit.status}`}>
      <strong>
        {audit.status === "reviewing" ? `自动审核中（第 ${audit.attemptCount || 1} 次执行）` : "审核结果"}
      </strong>
      {audit.reason ? <p>{audit.reason}</p> : null}
      {audit.details ? <pre>{JSON.stringify(audit.details, null, 2)}</pre> : null}
    </section>
  );
}

function getDraftFileName(file: unknown): string {
  if (!file || typeof file !== "object") return "尚未选择";
  const value = file as { name?: unknown; originalName?: unknown };
  if (typeof value.originalName === "string" && value.originalName) return value.originalName;
  if (typeof value.name === "string" && value.name) return value.name;
  return "尚未选择";
}
