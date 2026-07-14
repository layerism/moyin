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

  const runtimeByKey = useMemo(
    () => new Map(instance?.nodeInstances.map((node) => [node.nodeKey, node]) ?? []),
    [instance],
  );
  const activeNode = instance?.config.nodes.find((node) => node.id === activeNodeKey) ?? null;
  const activeRuntime = activeNodeKey ? runtimeByKey.get(activeNodeKey) ?? null : null;

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
        <div>
          <span className="oa-brand-mark">OA</span>
          <strong>{instance.name}</strong>
        </div>
        <div className="runtime-student-identity">
          <span>{instance.student.name}</span>
          <small>{instance.student.studentNo}</small>
          <button onClick={onHome}>返回首页</button>
        </div>
      </header>
      <section className="student-runtime-intro">
        <div>
          <p>流程说明</p>
          <h1>{instance.name}</h1>
          <span>{instance.description}</span>
        </div>
        <strong className={`runtime-overall-status ${instance.status}`}>
          {instance.status === "completed" ? "全部完成" : "填写中"}
        </strong>
      </section>
      <section className="runtime-notice" aria-live="polite">
        {notice}
      </section>
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
          onSubmit={() => void submit(activeRuntime)}
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
  onSubmit,
  onUpdate,
  runtime,
}: {
  busy: boolean;
  draft: Record<string, unknown>;
  node: AcademicFlowNode;
  onClose: () => void;
  onSave: () => void;
  onSubmit: () => void;
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
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onUpdate("file", { name: file.name, size: file.size, type: file.type });
                  }
                }}
              />
              <small>{(draft.file as { name?: string } | undefined)?.name ?? "尚未选择"}</small>
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
        ) : (
          <p className="runtime-state-hint">{getStateHint(runtime.status)}</p>
        )}
      </section>
    </div>
  );
}

function getStateHint(status: RuntimeNodeStatus) {
  if (status === "locked") return "需等待所有上游节点审核通过。";
  if (status === "expired") return "节点已截止，请联系教师申请延期。";
  if (status === "reviewing" || status === "submitted") return "材料已提交，正在等待审核。";
  if (status === "approved") return "该节点已完成，提交内容已锁定。";
  return "请根据退回意见修改后重新提交。";
}
