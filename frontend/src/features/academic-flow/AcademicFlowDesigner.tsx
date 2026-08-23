import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent } from "react";

import type {
  AcademicFlowEdge,
  AcademicFlowNode,
  AcademicFlowNodeKind,
  AcademicFlowPort,
  AcademicFlowNodeStatus,
  AcademicProcess,
} from "../../types";
import {
  createNode,
  fileTypeRestrictionPresets,
  getFileExtensionsForPreset,
  getNodeSettingCapabilities,
  getFileTypeRestrictionPreset,
  nodeTemplates,
} from "./academicFlowData";
import { ApiError, FLOW_PREVIEW_TOKEN_KEY, workflowApi } from "./api";
import { AuditScriptSelector } from "./AuditScriptSelector";
import {
  getAuditScriptParameterError,
  type NodeAuditPolicy,
} from "./auditScripts";
import {
  bindCtrlWheelListener,
  canvasRectsIntersect,
  constrainCanvasGroupDelta,
  getCanvasArrowKeyDelta,
  getCanvasPanOffset,
  getCanvasViewportZoomState,
  isCanvasKeyboardEditingTarget,
  normalizeCanvasRect,
  shouldStartCanvasPan,
  type CanvasPoint,
  type CanvasPanStart,
  type CanvasRect,
} from "./canvasPan";
import {
  canAddRevisionEdge,
  canDeleteRevisionEdge,
  canDeleteRevisionNode,
  canEditRevisionNodeCore,
  canMoveRevisionNode,
  filterPublishedNodeRevisionPatch,
  filterPublishedRuntimeNodes,
  preservePublishedEdges,
  shouldReloadRevisionAfterConflict,
} from "./flowRevision";
import {
  getPublishButtonState,
  getRevisionEditing,
} from "./publishButtonState";
import { FlowRosterDialog } from "./FlowRosterDialog";
import { FormFieldEditor } from "./FormFieldEditor";
import { validateFormFieldConfig } from "./formFields";
import {
  createCurveGeometry,
  createCurvedEdgeGeometries,
  getOppositePort,
  type CurvedEdgeGeometry,
} from "./edgeCurveGeometry";
import { NodeDateTimePicker } from "./NodeDateTimePicker";
import { NodePackageDownloadDialog } from "./NodePackageDownloadDialog";
import { RevisionImpactDialog } from "./RevisionImpactDialog";
import type { RevisionImpact } from "./runtimeTypes";
import { getAbsoluteShareUrl } from "./shareUrl";
import { StudentLinkDialog } from "./StudentLinkDialog";
import { TeacherProgressPanel } from "./TeacherProgressPanel";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

const statusLabels: Record<AcademicFlowNodeStatus, string> = {
  approved: "已通过",
  disabled: "待开放",
  pending: "审核中",
  ready: "可填写",
};

const kindLabels: Record<AcademicFlowNodeKind, string> = {
  announcement: "通知公告",
  confirmation: "确认承诺",
  file: "文件上传",
  form: "信息填写",
};

const nodeSize = { height: 126, width: 280 };
const canvasGridSize = 16;
const connectionPorts: AcademicFlowPort[] = ["top", "bottom"];

function snapToGrid(value: number) {
  return Math.round(value / canvasGridSize) * canvasGridSize;
}

function snapCanvasPoint(position: { x: number; y: number }) {
  return {
    x: Math.max(canvasGridSize, snapToGrid(position.x)),
    y: Math.max(canvasGridSize, snapToGrid(position.y)),
  };
}

type ConnectionDraft = {
  nodeId: string;
  port: AcademicFlowPort;
};

type CanvasSelectionDraft = {
  current: CanvasPoint;
  start: CanvasPoint;
};

type NodeGroupDrag = {
  anchorId: string;
  pointerStart: CanvasPoint;
  startPositions: Record<string, CanvasPoint>;
};

type NodeContextMenuState = {
  left: number;
  nodeId: string;
  top: number;
};

type FlowNodeLayout = AcademicFlowNode & {
  renderedHeight: number;
};

type PendingNavigation = {
  destination: string;
  run: () => void;
};

function createDraftWorkingProcess(process: AcademicProcess): AcademicProcess {
  return structuredClone({
    ...process,
    edges: process.draftConfig.edges,
    nodes: process.draftConfig.nodes,
  });
}

export function AcademicFlowDesigner({
  onBack,
  onOpenStudent,
  onPublishProcess,
  onProcessChange,
  onSaveProcess,
  process,
}: {
  onBack: () => void;
  onOpenStudent: (shareUrl: string) => void;
  onPublishProcess: (
    process: AcademicProcess,
    expectedDraftConfigHash?: string | null,
    expectedCurrentVersionId?: string | null,
  ) => Promise<AcademicProcess>;
  onProcessChange: (process: AcademicProcess) => void;
  onSaveProcess: (process: AcademicProcess) => Promise<AcademicProcess>;
  process: AcademicProcess;
}) {
  const [workingProcess, setWorkingProcess] = useState(() => createDraftWorkingProcess(process));
  const [activeNodeId, setActiveNodeId] = useState(process.draftConfig.nodes[0]?.id ?? "");
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showStudentLinks, setShowStudentLinks] = useState(false);
  const [rosterActiveCount, setRosterActiveCount] = useState<number | null>(null);
  const [actionNotice, setActionNotice] = useState("");
  const [publishedShareUrl, setPublishedShareUrl] = useState("");
  const [revisionImpact, setRevisionImpact] = useState<RevisionImpact | null>(null);
  const [pendingPublishProcess, setPendingPublishProcess] = useState<AcademicProcess | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [previewCreating, setPreviewCreating] = useState(false);
  const [nodePackageDialogNodeId, setNodePackageDialogNodeId] = useState<string | null>(null);
  const [revisionEditingRequested, setRevisionEditingRequested] = useState(false);
  const [revisionDirty, setRevisionDirty] = useState(false);
  const revisionEditing = getRevisionEditing(
    workingProcess.published,
    revisionEditingRequested,
    workingProcess.hasUnpublishedChanges,
  );
  const operationLocked = saving || previewCreating || revisionImpact !== null || pendingNavigation !== null;
  const editorLocked = operationLocked || (workingProcess.published && !revisionEditing);
  const processEdges = workingProcess.edges ?? [];
  const activeNode =
    workingProcess.nodes.find((node) => node.id === activeNodeId) ??
    workingProcess.nodes[0] ??
    null;
  const inspectorNode =
    workingProcess.nodes.find((node) => node.id === inspectorNodeId) ?? null;
  const nodePackageDialogNode = workingProcess.nodes.find(
    (node) => node.id === nodePackageDialogNodeId,
  ) ?? null;
  const serverFlowId = workingProcess.serverId ?? workingProcess.id;
  const existingNodeIds = workingProcess.nodes.map((node) => node.id);
  const protectedNodeIds = workingProcess.published ? workingProcess.publishedNodeIds : [];
  const protectedEdgeIds = process.published ? process.edges.map((edge) => edge.id) : [];
  const publishedRuntimeNodes = useMemo(
    () => filterPublishedRuntimeNodes(process.nodes, process.publishedNodeIds),
    [process.nodes, process.publishedNodeIds],
  );
  const publishButtonState = getPublishButtonState({
    hasUnpublishedChanges: workingProcess.hasUnpublishedChanges || revisionDirty,
    operationLocked,
    published: workingProcess.published,
    revisionEditing,
    rosterActiveCount,
    nodes: workingProcess.nodes,
  });

  const commitDesignChange = (nextProcess: AcademicProcess) => {
    if (editorLocked) return;
    setWorkingProcess({
      ...nextProcess,
      edges: process.published
        ? preservePublishedEdges(nextProcess.edges, process.edges)
        : nextProcess.edges,
    });
    setRevisionDirty(true);
  };

  const requestNavigation = (destination: string, navigate: () => void) => {
    if (!revisionDirty) {
      navigate();
      return;
    }
    setPendingNavigation({ destination, run: navigate });
  };

  useEffect(() => {
    setWorkingProcess(createDraftWorkingProcess(process));
    setActiveNodeId(process.draftConfig.nodes[0]?.id ?? "");
    setRevisionEditingRequested(false);
    setRevisionDirty(false);
    setRevisionImpact(null);
    setPendingPublishProcess(null);
    setNodePackageDialogNodeId(null);
  }, [process.id, process.publishedVersionId]);

  useEffect(() => {
    if (!process.published) return;
    setWorkingProcess((current) => {
      const edges = preservePublishedEdges(current.edges, process.edges);
      return edges === current.edges ? current : { ...current, edges };
    });
  }, [process.edges, process.published, process.publishedVersionId]);

  useEffect(() => {
    if (!revisionDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [revisionDirty]);

  useEffect(() => {
    let cancelled = false;
    workflowApi
      .getRoster(serverFlowId)
      .then((roster) => {
        if (!cancelled) setRosterActiveCount(roster.activeCount);
      })
      .catch(() => {
        if (!cancelled) setRosterActiveCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [serverFlowId]);

  const saveWorkingDraft = async (
    candidate: AcademicProcess,
    successMessage = "流程已暂存",
  ) => {
    setSaving(true);
    setDraftSaving(true);
    setActionNotice("");
    try {
      const saved = await onSaveProcess(candidate);
      const nextWorking = createDraftWorkingProcess(saved);
      onProcessChange(saved);
      setWorkingProcess(nextWorking);
      setRevisionDirty(false);
      setActionNotice(successMessage);
      return nextWorking;
    } catch (reason) {
      setRevisionDirty(true);
      setActionNotice(reason instanceof Error ? reason.message : "暂存失败");
      return null;
    } finally {
      setDraftSaving(false);
      setSaving(false);
    }
  };

  const publishProcess = async (
    candidate: AcademicProcess,
    expectedDraftConfigHash?: string | null,
    expectedCurrentVersionId?: string | null,
  ) => {
    setSaving(true);
    setActionNotice("");
    setPublishedShareUrl("");
    try {
      const nextProcess = await onPublishProcess(
        candidate,
        expectedDraftConfigHash,
        expectedCurrentVersionId,
      );
      onProcessChange(nextProcess);
      setWorkingProcess(createDraftWorkingProcess(nextProcess));
      setRevisionEditingRequested(false);
      setRevisionDirty(false);
      setRevisionImpact(null);
      setPendingPublishProcess(null);
      setActionNotice(candidate.published ? "重新发布成功，学生链接：" : "发布成功，学生链接：");
      setPublishedShareUrl(getAbsoluteShareUrl(nextProcess.shareUrl, window.location.origin));
    } catch (reason) {
      const shouldReloadRevision =
        reason instanceof ApiError
          ? shouldReloadRevisionAfterConflict(reason.status, expectedDraftConfigHash)
          : false;
      setRevisionImpact(null);
      setPendingPublishProcess(null);
      if (shouldReloadRevision) {
        setActionNotice("发布基准已变化，请重新预览影响");
        return;
      }
      setActionNotice(reason instanceof Error ? reason.message : "发布失败");
    } finally {
      setSaving(false);
    }
  };

  const preparePublish = async () => {
    const candidate = structuredClone(workingProcess);
    const invalidFormNode = candidate.nodes.find(
      (node) => node.kind === "form"
        && Object.keys(validateFormFieldConfig(node.infoFields)).length > 0,
    );
    if (invalidFormNode) {
      setActiveNodeId(invalidFormNode.id);
      setInspectorNodeId(invalidFormNode.id);
      setActionNotice("请先修正表单字段配置");
      return;
    }
    if (!workingProcess.published) {
      await publishProcess(candidate);
      return;
    }

    setSaving(true);
    setActionNotice("");
    setPublishedShareUrl("");
    try {
      const impact = await workflowApi.getRevisionImpact(serverFlowId, candidate);
      setPendingPublishProcess(candidate);
      setRevisionImpact(impact);
    } catch (reason) {
      setPendingPublishProcess(null);
      setActionNotice(reason instanceof Error ? reason.message : "修订影响读取失败");
    } finally {
      setSaving(false);
    }
  };

  const handlePublishButtonClick = () => {
    if (publishButtonState.action === "begin-revision") {
      setRevisionEditingRequested(true);
      return;
    }
    if (publishButtonState.action === "finish-revision") {
      setWorkingProcess(createDraftWorkingProcess(process));
      setRevisionEditingRequested(false);
      setRevisionDirty(false);
      setRevisionImpact(null);
      setPendingPublishProcess(null);
      setPublishedShareUrl("");
      setActionNotice("未检测到改动，已退出编辑");
      return;
    }
    void preparePublish();
  };

  const openPreview = async () => {
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      setActionNotice("请允许本站打开新标签页");
      return;
    }
    setPreviewCreating(true);
    setActionNotice("");
    try {
      const saved = await saveWorkingDraft(workingProcess, "");
      if (!saved) {
        previewWindow.close();
        return;
      }
      const preview = await workflowApi.createPreview(serverFlowId);
      previewWindow.sessionStorage.setItem(FLOW_PREVIEW_TOKEN_KEY, preview.previewToken);
      previewWindow.opener = null;
      previewWindow.location.href = preview.previewUrl;
    } catch (reason) {
      previewWindow.close();
      setActionNotice(reason instanceof Error ? reason.message : "预览创建失败");
    } finally {
      setPreviewCreating(false);
    }
  };

  const addNode = (
    kind: AcademicFlowNodeKind,
    title: string,
    position?: { x: number; y: number },
  ) => {
    if (editorLocked) return;
    const nextNode = createNode(kind, title, position);
    const nextProcess = {
      ...workingProcess,
      nodes: [...workingProcess.nodes, nextNode],
    };
    commitDesignChange(nextProcess);
    setActiveNodeId(nextNode.id);
  };

  const updateNode = (nodeId: string, value: Partial<AcademicFlowNode>) => {
    if (editorLocked) return;
    let nextValue = { ...value };
    if (workingProcess.published && protectedNodeIds.includes(nodeId)) {
      nextValue = filterPublishedNodeRevisionPatch(nextValue);
    }
    if (Object.keys(nextValue).length === 0) {
      return;
    }
    commitDesignChange({
      ...workingProcess,
      nodes: workingProcess.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...nextValue } : node,
      ),
    });
  };

  const applyPublishedAuditPolicy = (
    nodeId: string,
    params: Record<string, string | number | boolean>,
  ) => {
    setWorkingProcess((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? {
        ...node,
        auditScriptParams: params,
        scanAuditMode: params.scanAuditMode as "pass_fail" | "score" | undefined,
        scanAuditPrompt: typeof params.scanAuditPrompt === "string" ? params.scanAuditPrompt : node.scanAuditPrompt,
      } : node),
    }));
  };

  const updateNodePositions = (positions: Record<string, CanvasPoint>) => {
    if (editorLocked) return;
    let changed = false;
    const nextNodes = workingProcess.nodes.map((node) => {
      const position = positions[node.id];
      if (!position || !canMoveRevisionNode(node.id, protectedNodeIds)) return node;
      if (node.x === position.x && node.y === position.y) return node;
      changed = true;
      return { ...node, ...position };
    });
    if (!changed) return;
    commitDesignChange({ ...workingProcess, nodes: nextNodes });
  };

  const connectNodes = (
    source: string,
    target: string,
    sourcePort: AcademicFlowPort,
    targetPort: AcademicFlowPort,
  ) => {
    if (editorLocked) return;
    if (workingProcess.published && !canAddRevisionEdge(source, target, protectedNodeIds)) {
      setActionNotice("新增连线必须至少连接一个本次新增节点");
      return;
    }
    const exists = processEdges.some((edge) => edge.source === source && edge.target === target);
    if (source === target || exists) {
      return;
    }
    const nextEdge = {
      id: `edge-${source}-${target}-${Date.now()}`,
      source,
      sourcePort,
      target,
      targetPort,
    };
    const nextEdges = [...processEdges, nextEdge];
    if (hasCycle(workingProcess.nodes.map((node) => node.id), nextEdges)) {
      return;
    }
    commitDesignChange({ ...workingProcess, edges: nextEdges });
  };

  const uploadNodeTemplate = async (nodeId: string, file: File) => {
    let candidate = workingProcess;
    if (revisionDirty) {
      const saved = await saveWorkingDraft(workingProcess, "");
      if (!saved) return;
      candidate = saved;
    }
    setSaving(true);
    setActionNotice("");
    try {
      const result = await workflowApi.uploadNodeTemplate(serverFlowId, nodeId, file);
      const nextProcess = {
        ...candidate,
        nodes: candidate.nodes.map((node) =>
          node.id === nodeId ? { ...node, templateAsset: result.templateAsset } : node
        ),
      };
      setWorkingProcess(nextProcess);
      setRevisionDirty(true);
      await saveWorkingDraft(nextProcess, "模板已上传，重新发布后供学生下载");
    } catch (reason) {
      setActionNotice(reason instanceof Error ? reason.message : "模板上传失败");
    } finally {
      setSaving(false);
    }
  };

  const deleteNodeTemplate = async (nodeId: string) => {
    setSaving(true);
    setActionNotice("");
    try {
      await workflowApi.deleteNodeTemplate(serverFlowId, nodeId);
      const nextProcess = {
        ...workingProcess,
        nodes: workingProcess.nodes.map((node) =>
          node.id === nodeId ? { ...node, templateAsset: null } : node
        ),
      };
      setWorkingProcess(nextProcess);
      setRevisionDirty(true);
      await saveWorkingDraft(nextProcess, "模板已删除");
    } catch (reason) {
      setActionNotice(reason instanceof Error ? reason.message : "模板删除失败");
    } finally {
      setSaving(false);
    }
  };

  const deleteEdge = (edgeId: string) => {
    if (editorLocked || !canDeleteRevisionEdge(edgeId, protectedEdgeIds)) return;
    commitDesignChange({
      ...workingProcess,
      edges: processEdges.filter((edge) => edge.id !== edgeId),
    });
  };

  const deleteNode = (nodeId: string) => {
    if (
      editorLocked ||
      !canDeleteRevisionNode(nodeId, protectedNodeIds, existingNodeIds)
    ) {
      return;
    }
    const nodes = workingProcess.nodes.filter((node) => node.id !== nodeId);
    const edges = processEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    commitDesignChange({ ...workingProcess, edges, nodes });
    setActiveNodeId(nodes[0]?.id ?? "");
    if (inspectorNodeId === nodeId) {
      setInspectorNodeId(null);
    }
  };

  return (
    <main className="academic-standalone-page">
      <AcademicStandaloneHeader
        currentLabel={workingProcess.name}
        onBack={() => requestNavigation("教务流程列表", onBack)}
      />
      <section className="academic-workspace-main designer-workspace-main">
        <header className="academic-topbar designer-topbar">
          <div className="designer-flow-summary">
            <div className="academic-title-row">
              <h1 title={workingProcess.name}>{workingProcess.name}</h1>
              <span
                className={
                  workingProcess.published
                    ? revisionEditing
                      ? "status-pill revision"
                      : "status-pill ok"
                    : "status-pill"
                }
              >
                {workingProcess.published
                  ? revisionEditing
                    ? "修订中"
                    : "已发布"
                  : "草稿"}
              </span>
            </div>
            <p title={`流程说明：${workingProcess.description}`}>
              流程说明：{workingProcess.description}
            </p>
          </div>
          <div className="academic-actions">
            <button onClick={() => setShowRoster(true)}>
              学生名单{rosterActiveCount === null ? "" : ` (${rosterActiveCount})`}
            </button>
            <button disabled={operationLocked} onClick={() => void openPreview()} type="button">
              {previewCreating ? "正在创建预览" : "预览"}
            </button>
            {workingProcess.published ? (
              <button onClick={() => setShowStudentLinks(true)}>
                学生链接
              </button>
            ) : null}
            {workingProcess.publishedVersionId ? (
              <button onClick={() => setShowProgress(true)}>进度</button>
            ) : null}
            <button
              disabled={editorLocked || !revisionDirty}
              onClick={() => void saveWorkingDraft(workingProcess)}
              type="button"
            >
              {draftSaving ? "暂存中" : "暂存"}
            </button>
            <button
              className="primary-action"
              disabled={publishButtonState.disabled}
              onClick={handlePublishButtonClick}
              title={publishButtonState.title}
            >
              {publishButtonState.label}
            </button>
          </div>
        </header>
        {actionNotice ? (
          <p className="academic-action-notice">
            {actionNotice}
            {publishedShareUrl ? (
              <a href={publishedShareUrl} rel="noreferrer" target="_blank">
                {publishedShareUrl}
              </a>
            ) : null}
          </p>
        ) : null}

        <section className="flow-designer-grid">
          <ComponentPalette locked={editorLocked} onAddNode={addNode} />
          <FlowNodeCanvas
            activeNodeId={activeNode?.id ?? ""}
            canDeleteEdge={(edgeId) => canDeleteRevisionEdge(edgeId, protectedEdgeIds)}
            canDeleteNode={(nodeId) =>
              canDeleteRevisionNode(nodeId, protectedNodeIds, existingNodeIds)
            }
            canMoveNode={(nodeId) => canMoveRevisionNode(nodeId, protectedNodeIds)}
            edges={processEdges}
            locked={editorLocked}
            nodeMovementLocked={workingProcess.published}
            nodes={workingProcess.nodes}
            onAddNode={addNode}
            onConnectNodes={connectNodes}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
            onDownloadNodePackage={setNodePackageDialogNodeId}
            onOpenInspector={setInspectorNodeId}
            onSelectNode={setActiveNodeId}
            onUpdateNodePositions={updateNodePositions}
            publishedNodeIds={protectedNodeIds}
          />
        </section>
        {inspectorNode && (
          <NodeInspector
            editingLocked={editorLocked}
            flowId={serverFlowId}
            nodeCoreLocked={!canEditRevisionNodeCore(inspectorNode.id, protectedNodeIds)}
            node={inspectorNode}
            onClose={() => setInspectorNodeId(null)}
            onDeleteTemplate={() => void deleteNodeTemplate(inspectorNode.id)}
            onUploadTemplate={(file) => void uploadNodeTemplate(inspectorNode.id, file)}
            onUpdateNode={updateNode}
            onAuditPolicySaved={(params) => applyPublishedAuditPolicy(inspectorNode.id, params)}
            publishedAuditPolicy={workingProcess.published && protectedNodeIds.includes(inspectorNode.id)}
            publishedRevision={workingProcess.published && revisionEditing}
          />
        )}
        {showProgress && workingProcess.publishedVersionId ? (
          <TeacherProgressPanel
            nodes={publishedRuntimeNodes}
            onClose={() => setShowProgress(false)}
            versionId={workingProcess.publishedVersionId}
          />
        ) : null}
        {showRoster ? (
          <FlowRosterDialog
            flowId={serverFlowId}
            onClose={() => setShowRoster(false)}
            onRosterChange={(roster) => setRosterActiveCount(roster.activeCount)}
          />
        ) : null}
        {showStudentLinks ? (
          <StudentLinkDialog
            flowName={workingProcess.name}
            onClose={() => setShowStudentLinks(false)}
            onOpen={() =>
              requestNavigation("学生填写页面", () =>
                onOpenStudent(workingProcess.shareUrl),
              )
            }
            shareUrl={workingProcess.shareUrl}
          />
        ) : null}
        {nodePackageDialogNode && workingProcess.publishedVersionId ? (
          <NodePackageDownloadDialog
            nodeKey={nodePackageDialogNode.id}
            onClose={() => setNodePackageDialogNodeId(null)}
            versionId={workingProcess.publishedVersionId}
          />
        ) : null}
        {revisionImpact ? (
          <RevisionImpactDialog
            confirming={saving}
            impact={revisionImpact}
            onCancel={() => {
              setRevisionImpact(null);
              setPendingPublishProcess(null);
            }}
            onConfirm={() => {
              if (!pendingPublishProcess) return;
              void publishProcess(
                pendingPublishProcess,
                revisionImpact.draftConfigHash,
                revisionImpact.currentVersionId,
              );
            }}
          />
        ) : null}
        {pendingNavigation ? (
          <UnsavedChangesDialog
            destination={pendingNavigation.destination}
            onCancel={() => setPendingNavigation(null)}
            onDiscard={() => {
              const navigate = pendingNavigation.run;
              setPendingNavigation(null);
              navigate();
            }}
            onSave={() => {
              void (async () => {
                const saved = await saveWorkingDraft(workingProcess);
                if (!saved || !pendingNavigation) return;
                const navigate = pendingNavigation.run;
                setPendingNavigation(null);
                navigate();
              })();
            }}
            saving={draftSaving}
          />
        ) : null}
      </section>
    </main>
  );
}

export function StudentFlowPage({
  onBack,
  process,
}: {
  onBack: () => void;
  process: AcademicProcess;
}) {
  return (
    <main className="academic-standalone-page">
      <AcademicStandaloneHeader onBack={onBack} />
      <section className="academic-workspace-main">
        <header className="academic-topbar">
          <div>
            <div className="drive-breadcrumb academic-breadcrumb">
              <span>首页</span>
              <span>›</span>
              <button className="breadcrumb-button" onClick={onBack}>
                教务流程
              </button>
              <span>›</span>
              <strong>学生填写</strong>
            </div>
            <div className="academic-title-row">
              <h1>{process.name}</h1>
              <span className="status-pill ok">加密链接</span>
            </div>
            <p>请按节点顺序完成材料提交，审核通过后开放下一节点。</p>
          </div>
        </header>
        <section className="student-preview-shell standalone">
          <StudentFlowPreview process={process} showShareUrl={false} />
        </section>
      </section>
    </main>
  );
}

function AcademicStandaloneHeader({
  currentLabel,
  onBack,
}: {
  currentLabel?: string;
  onBack: () => void;
}) {
  return (
    <header
      className={`academic-standalone-header${currentLabel ? " designer-header" : ""}`}
    >
      <button
        aria-label="返回教务流程"
        className="academic-standalone-back"
        onClick={onBack}
        title="返回教务流程"
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <div className="academic-product-mark">
        <span className="logo-mark">OA</span>
        <strong>教务流程采集设计器</strong>
      </div>
      {currentLabel ? (
        <nav aria-label="当前位置" className="academic-header-breadcrumb">
          <span>首页</span>
          <span>›</span>
          <button onClick={onBack} type="button">
            教务流程
          </button>
          <span>›</span>
          <strong title={currentLabel}>{currentLabel}</strong>
        </nav>
      ) : null}
    </header>
  );
}

function ComponentPalette({
  locked,
  onAddNode,
}: {
  locked: boolean;
  onAddNode: (kind: AcademicFlowNodeKind, title: string) => void;
}) {
  return (
    <aside aria-disabled={locked} className="flow-panel palette-panel">
      <h2>组件库</h2>
      <p>拖拽组件到画布，构建流程节点</p>
      <h3>流程节点</h3>
      <div className="node-template-list">
        {nodeTemplates.map((template) => (
          <button
            className={`node-template ${template.kind}`}
            disabled={locked}
            draggable={!locked}
            key={`${template.kind}-${template.title}`}
            onDragStart={(event) => {
              if (locked) return;
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData("application/x-academic-node-kind", template.kind);
              event.dataTransfer.setData("application/x-academic-node-title", template.title);
            }}
            onClick={() => onAddNode(template.kind, template.title)}
            type="button"
          >
            <span>{getTemplateIcon(template.kind)}</span>
            <strong>{template.title}</strong>
            <small>{template.description}</small>
          </button>
        ))}
      </div>
      <h3>流程控制</h3>
      <div className="node-template-list compact">
        <button disabled={locked} type="button">
          <span>↳</span>
          <strong>条件分支</strong>
          <small>根据条件走不同分支</small>
        </button>
        <button disabled={locked} type="button">
          <span>⇄</span>
          <strong>并行节点</strong>
          <small>多个分支并行进行</small>
        </button>
      </div>
      <div className="palette-hint">
        提示：可将组件拖入画布，节点进入画布后可拖动定位，并通过上下连接点手动连线。
      </div>
    </aside>
  );
}

function FlowNodeCanvas({
  activeNodeId,
  canDeleteEdge,
  canDeleteNode,
  canMoveNode,
  edges,
  locked,
  nodeMovementLocked,
  nodes,
  onAddNode,
  onConnectNodes,
  onDeleteEdge,
  onDeleteNode,
  onDownloadNodePackage,
  onOpenInspector,
  onSelectNode,
  onUpdateNodePositions,
  publishedNodeIds,
}: {
  activeNodeId: string;
  canDeleteEdge: (edgeId: string) => boolean;
  canDeleteNode: (nodeId: string) => boolean;
  canMoveNode: (nodeId: string) => boolean;
  edges: AcademicFlowEdge[];
  locked: boolean;
  nodeMovementLocked: boolean;
  nodes: AcademicFlowNode[];
  onAddNode: (
    kind: AcademicFlowNodeKind,
    title: string,
    position?: { x: number; y: number },
  ) => void;
  onConnectNodes: (
    source: string,
    target: string,
    sourcePort: AcademicFlowPort,
    targetPort: AcademicFlowPort,
  ) => void;
  onDeleteEdge: (edgeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDownloadNodePackage: (nodeId: string) => void;
  onOpenInspector: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onUpdateNodePositions: (positions: Record<string, CanvasPoint>) => void;
  publishedNodeIds: string[];
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);
  const nodeMenuRef = useRef<HTMLDivElement | null>(null);
  const suppressContextMenuUntilRef = useRef(0);
  const connectingFromRef = useRef<ConnectionDraft | null>(null);
  const nodeElementsRef = useRef(new Map<string, HTMLButtonElement>());
  const [connectingFrom, setConnectingFrom] = useState<ConnectionDraft | null>(null);
  const [connectionPreviewPoint, setConnectionPreviewPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [connectionPreviewPort, setConnectionPreviewPort] = useState<AcademicFlowPort | null>(
    null,
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [panStart, setPanStart] = useState<CanvasPanStart | null>(null);
  const [altPressed, setAltPressed] = useState(false);
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null);
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.5);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    () => new Set(activeNodeId ? [activeNodeId] : []),
  );
  const [selectionDraft, setSelectionDraft] = useState<CanvasSelectionDraft | null>(null);
  const [draggingNodes, setDraggingNodes] = useState<NodeGroupDrag | null>(null);
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({});
  const nodeIdKey = nodes.map((node) => node.id).join("|");
  const publishedNodeIdSet = useMemo(() => new Set(publishedNodeIds), [publishedNodeIds]);
  const registerNodeElement = useCallback((nodeId: string, element: HTMLButtonElement | null) => {
    if (element) nodeElementsRef.current.set(nodeId, element);
    else nodeElementsRef.current.delete(nodeId);
  }, []);

  useEffect(() => {
    const updateAltState = (event: KeyboardEvent) => {
      if (event.key === "Alt") setAltPressed(event.type === "keydown");
      if (event.key === "Escape") setNodeContextMenu(null);
    };
    const resetAltState = () => {
      setAltPressed(false);
      setNodeContextMenu(null);
    };
    window.addEventListener("keydown", updateAltState);
    window.addEventListener("keyup", updateAltState);
    window.addEventListener("blur", resetAltState);
    return () => {
      window.removeEventListener("keydown", updateAltState);
      window.removeEventListener("keyup", updateAltState);
      window.removeEventListener("blur", resetAltState);
    };
  }, []);

  useEffect(() => {
    if (!nodeContextMenu) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!nodeMenuRef.current?.contains(event.target as Node)) {
        setNodeContextMenu(null);
      }
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [nodeContextMenu]);

  useEffect(() => {
    const activeNodeIds = new Set(nodeIdKey ? nodeIdKey.split("|") : []);
    setSelectedNodeIds((current) => {
      const next = new Set([...current].filter((nodeId) => activeNodeIds.has(nodeId)));
      return next.size === current.size ? current : next;
    });
    setNodeHeights((current) => {
      const staleIds = Object.keys(current).filter((nodeId) => !activeNodeIds.has(nodeId));
      if (staleIds.length === 0) return current;
      return Object.fromEntries(
        Object.entries(current).filter(([nodeId]) => activeNodeIds.has(nodeId)),
      );
    });

    const observer = new ResizeObserver((entries) => {
      setNodeHeights((current) => {
        let next = current;
        entries.forEach((entry) => {
          const element = entry.target as HTMLButtonElement;
          const nodeId = element.dataset.flowNodeId;
          const height = Math.max(nodeSize.height, Math.ceil(element.offsetHeight));
          if (!nodeId || current[nodeId] === height) return;
          if (next === current) next = { ...current };
          next[nodeId] = height;
        });
        return next;
      });
    });
    nodeElementsRef.current.forEach((element, nodeId) => {
      if (activeNodeIds.has(nodeId)) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [nodeIdKey]);

  useEffect(() => {
    if (!locked) return;
    connectingFromRef.current = null;
    setConnectingFrom(null);
    setConnectionPreviewPoint(null);
    setConnectionPreviewPort(null);
    setDraggingNodes(null);
    setSelectionDraft(null);
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    setNodeContextMenu(null);
  }, [locked]);

  const layoutNodes = useMemo<FlowNodeLayout[]>(() => nodes.map((node) => ({
    ...node,
    renderedHeight: nodeHeights[node.id] ?? nodeSize.height,
  })), [nodeHeights, nodes]);
  const nodeById = useMemo(
    () => new Map(layoutNodes.map((node) => [node.id, node])),
    [layoutNodes],
  );
  const openNodeContextMenu = (nodeId: string, clientX: number, clientY: number) => {
    const menuWidth = 190;
    const menuHeight = 132;
    setSelectedNodeIds(new Set([nodeId]));
    setSelectedEdgeId(null);
    onSelectNode(nodeId);
    setNodeContextMenu({
      left: Math.max(12, Math.min(clientX, window.innerWidth - menuWidth - 12)),
      nodeId,
      top: Math.max(12, Math.min(clientY, window.innerHeight - menuHeight - 12)),
    });
  };
  const curveNodes = useMemo(
    () => layoutNodes.map((node) => ({
      height: node.renderedHeight,
      id: node.id,
      width: nodeSize.width,
      x: node.x,
      y: node.y,
    })),
    [layoutNodes],
  );
  const edgeGeometries = useMemo(
    () => createCurvedEdgeGeometries(edges, curveNodes),
    [curveNodes, edges],
  );
  const selectionRect = useMemo<CanvasRect | null>(
    () => selectionDraft
      ? normalizeCanvasRect(selectionDraft.start, selectionDraft.current)
      : null,
    [selectionDraft],
  );
  const edgeLines = edges
    .map((edge) => {
      const geometry = edgeGeometries.get(edge.id);
      return geometry ? { ...edge, ...geometry } : null;
    })
    .filter((edge): edge is AcademicFlowEdge & CurvedEdgeGeometry => Boolean(edge));
  const selectedEdge = edgeLines.find((edge) => edge.id === selectedEdgeId) ?? null;

  useEffect(() => {
    if (selectedEdgeId && !canDeleteEdge(selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [canDeleteEdge, selectedEdgeId]);

  useEffect(() => {
    const deleteSelectedEdge = (event: KeyboardEvent) => {
      if (
        locked ||
        !selectedEdgeId ||
        !canDeleteEdge(selectedEdgeId) ||
        (event.key !== "Backspace" && event.key !== "Delete")
      ) {
        return;
      }
      event.preventDefault();
      onDeleteEdge(selectedEdgeId);
      setSelectedEdgeId(null);
    };

    window.addEventListener("keydown", deleteSelectedEdge);
    return () => window.removeEventListener("keydown", deleteSelectedEdge);
  }, [canDeleteEdge, locked, onDeleteEdge, selectedEdgeId]);

  useEffect(() => {
    const moveSelectedNodes = (event: KeyboardEvent) => {
      if (
        locked
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || isCanvasKeyboardEditingTarget(event.target)
      ) {
        return;
      }
      const desiredDelta = getCanvasArrowKeyDelta(event.key, canvasGridSize);
      if (!desiredDelta) return;
      const movableNodes = layoutNodes.filter(
        (node) => selectedNodeIds.has(node.id) && canMoveNode(node.id),
      );
      if (movableNodes.length === 0) return;
      event.preventDefault();
      const delta = constrainCanvasGroupDelta(
        movableNodes,
        desiredDelta,
        canvasGridSize,
      );
      if (delta.x === 0 && delta.y === 0) return;
      onUpdateNodePositions(Object.fromEntries(
        movableNodes.map((node) => [node.id, {
          x: node.x + delta.x,
          y: node.y + delta.y,
        }]),
      ));
    };

    window.addEventListener("keydown", moveSelectedNodes);
    return () => window.removeEventListener("keydown", moveSelectedNodes);
  }, [canMoveNode, layoutNodes, locked, onUpdateNodePositions, selectedNodeIds]);

  const getCanvasPoint = (clientX: number, clientY: number) => {
    const rect = canvasSurfaceRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom,
    };
  };

  const zoomCanvas = (event: WheelEvent) => {
    if (!canvasSurfaceRef.current) return;
    setNodeContextMenu(null);
    const surfaceRect = canvasSurfaceRef.current.getBoundingClientRect();
    const next = getCanvasViewportZoomState({
      deltaY: event.deltaY,
      offsetX: viewportOffset.x,
      offsetY: viewportOffset.y,
      pointerX: event.clientX - (surfaceRect.left - viewportOffset.x),
      pointerY: event.clientY - (surfaceRect.top - viewportOffset.y),
      zoom,
    });
    setZoom(next.zoom);
    setViewportOffset({ x: next.offsetX, y: next.offsetY });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return bindCtrlWheelListener(canvas, zoomCanvas);
  }, [viewportOffset, zoom]);

  const findMagnetTarget = (point: { x: number; y: number }, sourceNodeId: string) => {
    const magnetPadding = 36;
    const candidates = layoutNodes
      .filter((node) => node.id !== sourceNodeId)
      .map((node) => {
        const inside =
          point.x >= node.x - magnetPadding &&
          point.x <= node.x + nodeSize.width + magnetPadding &&
          point.y >= node.y - magnetPadding &&
          point.y <= node.y + node.renderedHeight + magnetPadding;
        if (!inside) {
          return null;
        }
        const ports = connectionPorts.map((port) => {
          const portPoint = getPortPoint(node, port);
          return {
            node,
            point: portPoint,
            port,
            distance: Math.hypot(point.x - portPoint.x, point.y - portPoint.y),
          };
        });
        return ports.sort((left, right) => left.distance - right.distance)[0];
      })
      .filter(
        (
          candidate,
        ): candidate is {
          distance: number;
          node: FlowNodeLayout;
          point: { x: number; y: number };
          port: AcademicFlowPort;
        } => Boolean(candidate),
      );

    return candidates.sort((left, right) => left.distance - right.distance)[0] ?? null;
  };

  const dropNode = (event: DragEvent<HTMLDivElement>) => {
    if (locked) {
      return;
    }
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/x-academic-node-kind") as AcademicFlowNodeKind;
    const title = event.dataTransfer.getData("application/x-academic-node-title");
    if (!kind || !title) {
      return;
    }
    const point = getCanvasPoint(event.clientX, event.clientY);
    onAddNode(
      kind,
      title,
      snapCanvasPoint({
        x: point.x - nodeSize.width / 2,
        y: point.y - nodeSize.height / 2,
      }),
    );
  };

  const toggleNodeSelection = (nodeId: string) => {
    const next = new Set(selectedNodeIds);
    if (next.has(nodeId)) {
      next.delete(nodeId);
      if (nodeId === activeNodeId) {
        const nextActiveId = next.values().next().value;
        if (typeof nextActiveId === "string") onSelectNode(nextActiveId);
      }
    } else {
      next.add(nodeId);
      onSelectNode(nodeId);
    }
    setSelectedNodeIds(next);
  };

  const startNodeDrag = (event: PointerEvent<HTMLButtonElement>, node: AcademicFlowNode) => {
    if (
      event.button !== 0 ||
      locked ||
      !canMoveNode(node.id) ||
      (event.target as HTMLElement).closest(".connection-port")
    ) {
      return;
    }
    setNodeContextMenu(null);
    event.stopPropagation();
    if (event.ctrlKey) {
      event.preventDefault();
      toggleNodeSelection(node.id);
      return;
    }
    const dragIds = selectedNodeIds.has(node.id) ? [...selectedNodeIds] : [node.id];
    const startPositions = Object.fromEntries(
      dragIds
        .filter((nodeId) => canMoveNode(nodeId))
        .map((nodeId) => nodeById.get(nodeId))
        .filter((candidate): candidate is FlowNodeLayout => Boolean(candidate))
        .map((candidate) => [candidate.id, { x: candidate.x, y: candidate.y }]),
    );
    if (!startPositions[node.id]) return;
    if (!selectedNodeIds.has(node.id)) {
      setSelectedNodeIds(new Set([node.id]));
    }
    onSelectNode(node.id);
    setDraggingNodes({
      anchorId: node.id,
      pointerStart: getCanvasPoint(event.clientX, event.clientY),
      startPositions,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const dragNode = (event: PointerEvent<HTMLButtonElement>) => {
    if (!draggingNodes || !canMoveNode(draggingNodes.anchorId)) return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    const anchorStart = draggingNodes.startPositions[draggingNodes.anchorId];
    if (!anchorStart) return;
    const desiredAnchor = snapCanvasPoint({
      x: anchorStart.x + point.x - draggingNodes.pointerStart.x,
      y: anchorStart.y + point.y - draggingNodes.pointerStart.y,
    });
    const constrainedDelta = constrainCanvasGroupDelta(
      Object.values(draggingNodes.startPositions),
      {
        x: desiredAnchor.x - anchorStart.x,
        y: desiredAnchor.y - anchorStart.y,
      },
      canvasGridSize,
    );
    if (constrainedDelta.x === 0 && constrainedDelta.y === 0) return;
    onUpdateNodePositions(
      Object.fromEntries(
        Object.entries(draggingNodes.startPositions).map(([nodeId, position]) => [
          nodeId,
          {
            x: position.x + constrainedDelta.x,
            y: position.y + constrainedDelta.y,
          },
        ]),
      ),
    );
  };

  const endNodeDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (draggingNodes) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDraggingNodes(null);
    }
  };

  const setConnectionSource = (source: ConnectionDraft | null) => {
    if (locked && source) {
      return;
    }
    connectingFromRef.current = source;
    setConnectingFrom(source);
    if (!source) {
      setConnectionPreviewPoint(null);
      setConnectionPreviewPort(null);
      return;
    }
    const sourceNode = nodeById.get(source.nodeId);
    setConnectionPreviewPoint(sourceNode ? getPortPoint(sourceNode, source.port) : null);
    setConnectionPreviewPort(null);
  };

  const completeConnection = (targetId: string, targetPort: AcademicFlowPort) => {
    if (locked) {
      setConnectionSource(null);
      return;
    }
    const source = connectingFromRef.current ?? connectingFrom;
    if (source) {
      onConnectNodes(source.nodeId, targetId, source.port, targetPort);
    }
    setConnectionSource(null);
  };

  const updateConnectionPreview = (clientX: number, clientY: number) => {
    if (locked) {
      return;
    }
    const source = connectingFromRef.current;
    if (!source) {
      return;
    }
    const point = getCanvasPoint(clientX, clientY);
    const magnetTarget = findMagnetTarget(point, source.nodeId);
    setConnectionPreviewPoint(magnetTarget?.point ?? point);
    setConnectionPreviewPort(magnetTarget?.port ?? null);
  };

  const finishConnectionAt = (clientX: number, clientY: number) => {
    if (locked) {
      setConnectionSource(null);
      return;
    }
    const source = connectingFromRef.current;
    if (!source) {
      return;
    }
    const explicitTarget = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-port-position]");
    const explicitTargetId = explicitTarget?.dataset.nodeId;
    const explicitTargetPort = explicitTarget?.dataset.portPosition as
      | AcademicFlowPort
      | undefined;
    if (explicitTargetId && explicitTargetPort && explicitTargetId !== source.nodeId) {
      completeConnection(explicitTargetId, explicitTargetPort);
      return;
    }
    const magnetTarget = findMagnetTarget(getCanvasPoint(clientX, clientY), source.nodeId);
    if (magnetTarget) {
      completeConnection(magnetTarget.node.id, magnetTarget.port);
      return;
    }
    setConnectionSource(null);
  };

  const startCanvasPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;
    if (event.altKey && shouldStartCanvasPan({ button: event.button })) {
      event.preventDefault();
      suppressContextMenuUntilRef.current = Date.now() + 1000;
      setNodeContextMenu(null);
      setSelectedEdgeId(null);
      setPanStart({
        clientX: event.clientX,
        clientY: event.clientY,
        offsetX: viewportOffset.x,
        offsetY: viewportOffset.y,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button === 2) return;
    const target = event.target as HTMLElement;
    if (
      event.button !== 0 ||
      locked ||
      connectingFromRef.current ||
      target.closest(
        ".flow-node, .flow-edge-hitbox, .flow-edge-delete",
      )
    ) {
      return;
    }
    event.preventDefault();
    const point = getCanvasPoint(event.clientX, event.clientY);
    setSelectedEdgeId(null);
    setSelectedNodeIds(new Set());
    setSelectionDraft({ current: point, start: point });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveCanvasPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (panStart) {
      setViewportOffset(getCanvasPanOffset(panStart, event));
      return;
    }
    if (selectionDraft) {
      const point = getCanvasPoint(event.clientX, event.clientY);
      const nextRect = normalizeCanvasRect(selectionDraft.start, point);
      const nextIds = layoutNodes
        .filter((node) => canMoveNode(node.id))
        .filter((node) => canvasRectsIntersect(nextRect, {
          x: node.x,
          y: node.y,
          width: nodeSize.width,
          height: node.renderedHeight,
        }))
        .map((node) => node.id);
      setSelectionDraft({ ...selectionDraft, current: point });
      setSelectedNodeIds(new Set(nextIds));
      if (nextIds[0] && nextIds[0] !== activeNodeId) {
        onSelectNode(nextIds[0]);
      }
      return;
    }
    updateConnectionPreview(event.clientX, event.clientY);
  };

  const endCanvasPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (panStart) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setPanStart(null);
      return;
    }
    if (selectionDraft) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setSelectionDraft(null);
      return;
    }
    finishConnectionAt(event.clientX, event.clientY);
  };

  const cancelCanvasPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanStart(null);
    setSelectionDraft(null);
    setConnectionSource(null);
  };
  const previewSourceNode = connectingFrom ? nodeById.get(connectingFrom.nodeId) ?? null : null;
  const previewSourcePoint =
    previewSourceNode && connectingFrom ? getPortPoint(previewSourceNode, connectingFrom.port) : null;
  const previewGeometry =
    previewSourceNode && previewSourcePoint && connectingFrom && connectionPreviewPoint
      ? createCurveGeometry({
          source: previewSourcePoint,
          sourcePort: connectingFrom.port,
          target: connectionPreviewPoint,
          targetPort: connectionPreviewPort ?? getOppositePort(connectingFrom.port),
        })
      : null;
  const previewPath = previewGeometry?.path ?? "";
  const canvasSurfaceHeight = Math.max(
    1000,
    ...layoutNodes.map((node) => node.y + node.renderedHeight + 80),
  );

  return (
    <section className="flow-panel canvas-panel">
      <div className="panel-heading">
        <h2>流程画布</h2>
        <div className="canvas-toolbar">
          <button type="button">{Math.round(zoom * 100)}%</button>
        </div>
      </div>
      <div
        className={`flow-canvas dag-canvas ${altPressed ? "is-pan-tool" : ""} ${panStart ? "is-panning" : ""} ${
          selectionDraft ? "is-selecting" : ""
        }`}
        onContextMenu={(event) => {
          event.preventDefault();
          if (
            event.altKey
            || panStart
            || Date.now() < suppressContextMenuUntilRef.current
          ) return;
          const nodeElement = (event.target as HTMLElement).closest<HTMLElement>("[data-flow-node-id]");
          const nodeId = nodeElement?.dataset.flowNodeId;
          if (!nodeId || !nodeById.has(nodeId)) {
            setNodeContextMenu(null);
            return;
          }
          openNodeContextMenu(nodeId, event.clientX, event.clientY);
        }}
        onDragOver={(event) => {
          if (locked) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          updateConnectionPreview(event.clientX, event.clientY);
        }}
        onDrop={dropNode}
        onPointerCancel={cancelCanvasPointer}
        onPointerDown={startCanvasPointer}
        onPointerMove={moveCanvasPointer}
        onPointerUp={endCanvasPointer}
        ref={canvasRef}
        style={{
          backgroundPosition: `${viewportOffset.x}px ${viewportOffset.y}px`,
          backgroundSize: `${16 * zoom}px ${16 * zoom}px`,
        }}
      >
        <div
          className="canvas-zoom-surface"
          ref={canvasSurfaceRef}
          style={{
            height: canvasSurfaceHeight * zoom,
            transform: `translate(${viewportOffset.x}px, ${viewportOffset.y}px)`,
            width: 1200 * zoom,
          }}
        >
          <div
            className="canvas-zoom-content"
            style={{ height: canvasSurfaceHeight, transform: `scale(${zoom})` }}
          >
            <svg className="flow-edge-layer" style={{ height: canvasSurfaceHeight }}>
          {edgeLines.map((edge) => {
            const path = edge.path;
            const deletable = !locked && canDeleteEdge(edge.id);
            return (
              <g
                className={`flow-edge-group ${deletable ? "deletable" : "protected"} ${
                  edge.id === selectedEdgeId ? "selected" : ""
                }`}
                key={edge.id}
              >
                <path className="flow-edge-line" d={path} />
                <polygon
                  className="flow-edge-arrow"
                  points={createArrowPolygon(edge.targetX, edge.targetY, edge.targetPort)}
                />
                {deletable ? (
                  <path
                    aria-label="选择连接线"
                    className="flow-edge-hitbox"
                    d={path}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedEdgeId(edge.id);
                    }}
                    role="button"
                  />
                ) : null}
              </g>
            );
          })}
          {connectingFrom &&
            connectionPreviewPoint &&
            previewPath && (
              <>
                <path
                  className="flow-edge-preview"
                  d={previewPath}
                />
                {connectionPreviewPort && (
                  <polygon
                    className="flow-edge-preview-arrow"
                    points={createArrowPolygon(
                      connectionPreviewPoint.x,
                      connectionPreviewPoint.y,
                      connectionPreviewPort,
                    )}
                  />
                )}
              </>
            )}
            </svg>
            {selectionRect ? (
              <div
                className="canvas-selection-box"
                style={{
                  height: selectionRect.height,
                  left: selectionRect.x,
                  top: selectionRect.y,
                  width: selectionRect.width,
                }}
              />
            ) : null}
            {!locked && selectedEdge && canDeleteEdge(selectedEdge.id) && (
          <button
            aria-label="删除连接线"
            className="flow-edge-delete"
            onClick={() => {
              onDeleteEdge(selectedEdge.id);
              setSelectedEdgeId(null);
            }}
            style={getEdgeDeleteButtonStyle(selectedEdge)}
            type="button"
          >
            ×
          </button>
            )}
            {layoutNodes.map((node) => (
          <div
            className="canvas-node-stack dag-node-stack"
            key={node.id}
            style={{ left: node.x, top: node.y }}
          >
            <button
              className={`flow-node ${node.status} ${
                canMoveNode(node.id) ? "movable" : "protected"
              } ${selectedNodeIds.has(node.id) ? "selected" : ""}`}
              data-flow-node-id={node.id}
              onClick={(event) => {
                if (event.ctrlKey || selectedNodeIds.has(node.id)) return;
                setSelectedNodeIds(new Set([node.id]));
                onSelectNode(node.id);
              }}
              onDoubleClick={(event) => {
                if (locked || (event.target as HTMLElement).closest(".connection-port")) return;
                onOpenInspector(node.id);
              }}
              onKeyDown={(event) => {
                if (event.shiftKey && event.key === "F10") {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openNodeContextMenu(node.id, rect.right - 12, rect.top + 24);
                }
              }}
              onPointerDown={(event) => startNodeDrag(event, node)}
              onPointerMove={dragNode}
              onPointerCancel={endNodeDrag}
              onPointerUp={endNodeDrag}
              type="button"
              ref={(element) => registerNodeElement(node.id, element)}
              style={{ width: nodeSize.width }}
            >
              {!locked && connectionPorts.map((port) => (
                <span
                  className={`connection-port ${port} ${
                    connectingFrom && connectingFrom.nodeId !== node.id ? "connectable" : ""
                  } ${connectingFrom?.nodeId === node.id && connectingFrom.port === port ? "connecting" : ""}`}
                  data-node-id={node.id}
                  data-port-position={port}
                  key={port}
                  onClick={(event) => {
                    event.stopPropagation();
                    const activeConnection = connectingFromRef.current ?? connectingFrom;
                    if (activeConnection && activeConnection.nodeId !== node.id) {
                      completeConnection(node.id, port);
                      return;
                    }
                    setConnectionSource({ nodeId: node.id, port });
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const source = event.dataTransfer.getData("application/x-academic-edge-source");
                    const sourcePort =
                      (event.dataTransfer.getData(
                        "application/x-academic-edge-source-port",
                      ) as AcademicFlowPort) || "right";
                    if (source) {
                      onConnectNodes(source, node.id, sourcePort, port);
                    }
                    setConnectionSource(null);
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return;
                    }
                    event.stopPropagation();
                    const activeConnection = connectingFromRef.current ?? connectingFrom;
                    if (activeConnection && activeConnection.nodeId !== node.id) {
                      return;
                    }
                    setConnectionSource({ nodeId: node.id, port });
                    updateConnectionPreview(event.clientX, event.clientY);
                  }}
                  onPointerUp={(event) => {
                    event.stopPropagation();
                    if (connectingFrom && connectingFrom.nodeId !== node.id) {
                      completeConnection(node.id, port);
                    }
                  }}
                  draggable
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "link";
                    event.dataTransfer.setData("application/x-academic-edge-source", node.id);
                    event.dataTransfer.setData("application/x-academic-edge-source-port", port);
                    setConnectionSource({ nodeId: node.id, port });
                  }}
                  onDragEnd={(event) => {
                    const target = document
                      .elementFromPoint(event.clientX, event.clientY)
                      ?.closest<HTMLElement>("[data-port-position]");
                    const targetId = target?.dataset.nodeId;
                    const targetPort = target?.dataset.portPosition as AcademicFlowPort | undefined;
                    if (targetId && targetPort) {
                      completeConnection(targetId, targetPort);
                      return;
                    }
                    finishConnectionAt(event.clientX, event.clientY);
                  }}
                  title={`${getPortLabel(port)}连接点`}
                />
              ))}
              <strong>{node.title}</strong>
              <span className="node-meta">
                <em>{kindLabels[node.kind]}</em>
                <i>{statusLabels[node.status]}</i>
              </span>
            </button>
          </div>
            ))}
            {nodes.length === 0 && (
              <div className="canvas-empty">请从左侧组件库拖入第一个流程节点。</div>
            )}
          </div>
        </div>
        {nodeContextMenu && nodeById.has(nodeContextMenu.nodeId) ? (
          <div
            aria-label={`${nodeById.get(nodeContextMenu.nodeId)?.title ?? "节点"}操作`}
            className="node-context-menu"
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
            ref={nodeMenuRef}
            role="menu"
            style={{ left: nodeContextMenu.left, top: nodeContextMenu.top }}
          >
            <button
              disabled={locked}
              onClick={() => {
                if (locked) return;
                setNodeContextMenu(null);
                onOpenInspector(nodeContextMenu.nodeId);
              }}
              role="menuitem"
              title={locked ? "请先解锁编辑" : "设置节点"}
              type="button"
            >
              <span aria-hidden="true">⚙</span><strong>设置</strong>
              {locked ? <small>请先解锁编辑</small> : null}
            </button>
            <button
              className="is-destructive"
              disabled={locked || !canDeleteNode(nodeContextMenu.nodeId)}
              onClick={() => {
                if (locked || !canDeleteNode(nodeContextMenu.nodeId)) return;
                setNodeContextMenu(null);
                onDeleteNode(nodeContextMenu.nodeId);
              }}
              role="menuitem"
              title={
                canDeleteNode(nodeContextMenu.nodeId) && !locked
                  ? "删除节点"
                  : publishedNodeIdSet.has(nodeContextMenu.nodeId)
                    ? "已发布节点不可删除"
                    : "当前不可删除"
              }
              type="button"
            >
              <span aria-hidden="true">×</span><strong>删除</strong>
              {publishedNodeIdSet.has(nodeContextMenu.nodeId) ? (
                <small>已发布节点不可删除</small>
              ) : locked ? <small>当前不可删除</small> : null}
            </button>
            <button
              disabled={!publishedNodeIdSet.has(nodeContextMenu.nodeId)}
              onClick={() => {
                if (!publishedNodeIdSet.has(nodeContextMenu.nodeId)) return;
                setNodeContextMenu(null);
                onDownloadNodePackage(nodeContextMenu.nodeId);
              }}
              role="menuitem"
              title={publishedNodeIdSet.has(nodeContextMenu.nodeId) ? "下载节点资料" : "发布后可下载"}
              type="button"
            >
              <span aria-hidden="true">↓</span><strong>下载</strong>
              {!publishedNodeIdSet.has(nodeContextMenu.nodeId) ? <small>发布后可下载</small> : null}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function NodeInspector({
  editingLocked,
  flowId,
  nodeCoreLocked,
  node,
  onClose,
  onDeleteTemplate,
  onUploadTemplate,
  onUpdateNode,
  onAuditPolicySaved,
  publishedAuditPolicy,
  publishedRevision,
}: {
  editingLocked: boolean;
  flowId: string;
  nodeCoreLocked: boolean;
  node: AcademicFlowNode | null;
  onClose: () => void;
  onDeleteTemplate: () => void;
  onUploadTemplate: (file: File) => void;
  onUpdateNode: (nodeId: string, value: Partial<AcademicFlowNode>) => void;
  onAuditPolicySaved: (params: Record<string, string | number | boolean>) => void;
  publishedAuditPolicy: boolean;
  publishedRevision: boolean;
}) {
  const [timeSettingsOpen, setTimeSettingsOpen] = useState(false);
  const [auditPolicy, setAuditPolicy] = useState<NodeAuditPolicy | null>(null);
  const [auditPolicyParams, setAuditPolicyParams] = useState<Record<string, string | number | boolean>>({});
  const [auditPolicyError, setAuditPolicyError] = useState("");
  const [auditPolicySaving, setAuditPolicySaving] = useState(false);
  const nodeKey = node?.id ?? "";
  const hasPublishedAuditPolicy = Boolean(
    publishedAuditPolicy && node && (node.auditScriptId || node.scanAuditEnabled),
  );

  useEffect(() => {
    setAuditPolicy(null);
    setAuditPolicyParams({});
    setAuditPolicyError("");
    setAuditPolicySaving(false);
    if (!hasPublishedAuditPolicy) return;
    let cancelled = false;
    workflowApi.getNodeAuditPolicy(flowId, nodeKey).then((value) => {
      if (cancelled) return;
      setAuditPolicy(value);
      setAuditPolicyParams(value.params);
    }).catch((reason) => {
      if (!cancelled) {
        setAuditPolicyError(reason instanceof Error ? reason.message : "读取审核规则失败");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [flowId, hasPublishedAuditPolicy, nodeKey]);

  const auditPolicyFieldErrors = auditPolicy ? Object.fromEntries(
    auditPolicy.parameters.map((parameter) => [
      parameter.key,
      getAuditScriptParameterError(parameter, auditPolicyParams[parameter.key]),
    ]).filter(([, value]) => value),
  ) as Record<string, string> : {};
  const auditPolicyChanged = Boolean(auditPolicy?.parameters.some(
    (parameter) => auditPolicyParams[parameter.key] !== auditPolicy.params[parameter.key],
  ));

  const closeInspector = useCallback(async () => {
    if (auditPolicySaving) return;
    if (!hasPublishedAuditPolicy || !auditPolicy || !auditPolicyChanged) {
      onClose();
      return;
    }
    const validationError = Object.values(auditPolicyFieldErrors)[0];
    if (validationError) {
      setAuditPolicyError(`请先修正审核规则：${validationError}`);
      return;
    }
    setAuditPolicySaving(true);
    setAuditPolicyError("");
    try {
      const updated = await workflowApi.updateNodeAuditPolicy(flowId, nodeKey, {
        expectedGeneration: auditPolicy.generation,
        params: auditPolicyParams,
      });
      onAuditPolicySaved(updated.params);
      onClose();
    } catch (reason) {
      setAuditPolicyError(reason instanceof Error ? reason.message : "保存审核规则失败");
    } finally {
      setAuditPolicySaving(false);
    }
  }, [
    auditPolicy,
    auditPolicyChanged,
    auditPolicyFieldErrors,
    auditPolicyParams,
    auditPolicySaving,
    flowId,
    hasPublishedAuditPolicy,
    nodeKey,
    onAuditPolicySaved,
    onClose,
  ]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (timeSettingsOpen) {
        setTimeSettingsOpen(false);
        return;
      }
      void closeInspector();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeInspector, timeSettingsOpen]);

  if (!node) {
    return null;
  }

  const coreSettingsDisabled = editingLocked || nodeCoreLocked;
  const auditControlsNode: AcademicFlowNode = auditPolicy ? {
    ...node,
    auditScriptParams: auditPolicyParams,
    scanAuditMode: auditPolicyParams.scanAuditMode as "pass_fail" | "score" | undefined,
    scanAuditPrompt: typeof auditPolicyParams.scanAuditPrompt === "string"
      ? auditPolicyParams.scanAuditPrompt
      : node.scanAuditPrompt,
  } : node;
  const updateAuditPolicyParameter = (key: string, value: string | number | boolean) => {
    setAuditPolicyError("");
    setAuditPolicyParams((current) => ({ ...current, [key]: value }));
  };
  const settingCapabilities = getNodeSettingCapabilities(node.kind);
  const fileTypeRestrictionPreset = getFileTypeRestrictionPreset(node.fileExtensions);
  const hasFileTypeRestriction = node.fileExtensions.trim().length > 0;
  const scriptLocksFileTypes = Boolean(node.auditScriptAcceptedExtensions?.length);

  return (
    <div className="node-inspector-backdrop">
      <aside
        aria-modal="true"
        className="flow-panel inspector-panel node-inspector-modal"
        role="dialog"
      >
        <header className="node-inspector-toolbar">
          <button
            aria-label="关闭节点设置"
            disabled={auditPolicySaving}
            onClick={() => void closeInspector()}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="node-inspector-fields">
        <label className="node-basic-title-field">
          <input
            aria-label="节点标题"
            disabled={editingLocked}
            maxLength={50}
            placeholder="请添加标题"
            value={node.title}
            onChange={(event) => onUpdateNode(node.id, { title: event.target.value })}
          />
        </label>
        <label className="node-basic-description-field">
          <textarea
            aria-label="节点说明"
            disabled={editingLocked}
            placeholder="添加描述"
            value={node.requirement}
            onChange={(event) => onUpdateNode(node.id, { requirement: event.target.value })}
          />
        </label>
        <div className="node-basic-actions">
          <button
            aria-haspopup="dialog"
            className="node-time-settings-toggle"
            disabled={editingLocked}
            onClick={() => setTimeSettingsOpen(true)}
            type="button"
          >
            <span aria-hidden="true">＋</span>
            定时设置
          </button>
          {node.startAt || node.deadlineAt ? (
            <small>{getTimeWindowStatus(node)}</small>
          ) : null}
        </div>
        {publishedRevision ? (
          <p className="node-inspector-revision-note">
            当前为发布后修订。标题、说明和起止时间重新发布后生效；审核提示词与脚本参数在原位置修改，完成时立即更新未完成审核。
          </p>
        ) : null}
        {settingCapabilities.collectsInformation ? (
          <section className="inspector-section" aria-disabled={coreSettingsDisabled}>
            <FormFieldEditor
              disabled={coreSettingsDisabled}
              fields={node.infoFields}
              onChange={(infoFields) => onUpdateNode(node.id, { infoFields })}
            />
          </section>
        ) : null}

        {settingCapabilities.configuresConfirmationScan ? (
          <ConfirmationScanSettings
            disabled={coreSettingsDisabled}
            node={auditControlsNode}
            onDeleteTemplate={onDeleteTemplate}
            onUpdate={(patch) => {
              if (
                hasPublishedAuditPolicy &&
                typeof patch.scanAuditPrompt === "string"
              ) {
                updateAuditPolicyParameter("scanAuditPrompt", patch.scanAuditPrompt);
                return;
              }
              onUpdateNode(node.id, patch);
            }}
            onUploadTemplate={onUploadTemplate}
            promptDisabled={hasPublishedAuditPolicy
              ? !auditPolicy || auditPolicySaving
              : coreSettingsDisabled}
            promptError={auditPolicyFieldErrors.scanAuditPrompt}
          />
        ) : null}

        {settingCapabilities.configuresMaterialReview ? (
          <>
            <section className="inspector-section">
              <h3>设定限制</h3>
              <div className="file-type-restriction">
                <div className="file-type-restriction-heading">
                  <span>文件类型限制</span>
                  <button
                    aria-checked={hasFileTypeRestriction}
                    aria-label="启用文件类型限制"
                    className={`restriction-switch ${hasFileTypeRestriction ? "is-enabled" : ""}`}
                    disabled={coreSettingsDisabled || scriptLocksFileTypes}
                    onClick={() =>
                      onUpdateNode(node.id, {
                        fileExtensions: hasFileTypeRestriction
                          ? ""
                          : getFileExtensionsForPreset("document"),
                      })
                    }
                    role="switch"
                    type="button"
                  >
                    <span />
                  </button>
                </div>
                {hasFileTypeRestriction ? (
                  <select
                    aria-label="文件类型预设"
                    disabled={coreSettingsDisabled || scriptLocksFileTypes}
                    value={fileTypeRestrictionPreset}
                    onChange={(event) =>
                      onUpdateNode(node.id, {
                        fileExtensions: getFileExtensionsForPreset(event.target.value),
                      })
                    }
                  >
                    {fileTypeRestrictionPreset === "custom" ? (
                      <option value="custom">保留当前类型配置</option>
                    ) : null}
                    {fileTypeRestrictionPresets.map((preset) => (
                      <option key={preset.value} value={preset.value}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                {scriptLocksFileTypes ? (
                  <small className="audit-script-format-hint">文件格式由审核脚本固定。</small>
                ) : null}
              </div>
              <label className="file-size-limit-field">
                <span>单个文件大小上限（M）</span>
                <span className="file-size-input">
                  <input
                    aria-label="单个文件大小上限（MB）"
                    inputMode="decimal"
                    max="300"
                    min="0.1"
                    placeholder="请输入 0.1–300 的数值"
                    step="0.1"
                    type="number"
                    disabled={coreSettingsDisabled}
                    value={node.fileLimitMb}
                    onChange={(event) => onUpdateNode(node.id, { fileLimitMb: event.target.value })}
                  />
                  <strong>MB</strong>
                </span>
              </label>
            </section>

            <section className="inspector-section node-template-card">
              <h3>学生填写模板</h3>
              {node.templateAsset ? (
                <div className="node-template-file">
                  <span aria-hidden="true" className="node-template-file-icon">
                    {formatTemplateType(node.templateAsset.originalName)}
                  </span>
                  <div className="node-template-file-copy">
                    <strong title={node.templateAsset.originalName}>{node.templateAsset.originalName}</strong>
                    <small>{formatTemplateSize(node.templateAsset.sizeBytes)}</small>
                  </div>
                  {coreSettingsDisabled ? <span>已随发布版本固化</span> : <div className="node-template-actions">
                    <label>
                      替换模板
                      <input
                        accept={node.fileExtensions.split(",").map((value) => `.${value.trim().replace(/^\./, "")}`).join(",")}
                        type="file"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) onUploadTemplate(file);
                        }}
                      />
                    </label>
                    <button onClick={onDeleteTemplate} type="button">删除模板</button>
                  </div>}
                </div>
              ) : coreSettingsDisabled ? (
                <p className="muted-line">该节点发布时未配置模板，当前不可新增。</p>
              ) : (
                <label className="node-template-upload">
                  <input
                    accept={node.fileExtensions.split(",").map((value) => `.${value.trim().replace(/^\./, "")}`).join(",")}
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (file) onUploadTemplate(file);
                    }}
                  />
                  <strong>选择模板文件</strong>
                  <small>可选；格式和大小须符合本节点上传限制</small>
                </label>
              )}
            </section>

            <AuditScriptSelector
              disabled={coreSettingsDisabled}
              node={auditControlsNode}
              onChange={(patch) => {
                if (hasPublishedAuditPolicy && patch.auditScriptParams) {
                  setAuditPolicyError("");
                  setAuditPolicyParams(patch.auditScriptParams);
                  return;
                }
                onUpdateNode(node.id, patch);
              }}
              parameterDisabled={hasPublishedAuditPolicy
                ? !auditPolicy || auditPolicySaving
                : coreSettingsDisabled}
              parameters={hasPublishedAuditPolicy ? auditPolicy?.parameters : undefined}
            />
          </>
        ) : null}
        </div>
        <footer className="node-inspector-footer">
          <span
            className={auditPolicyError ? "node-inspector-footer-error" : undefined}
            role={auditPolicyError ? "alert" : undefined}
          >
            {auditPolicyError
              ? auditPolicyError
              : hasPublishedAuditPolicy && !auditPolicy
                ? "正在读取已发布审核规则…"
                : auditPolicySaving
                  ? "正在保存审核规则…"
                  : hasPublishedAuditPolicy && auditPolicyChanged
                    ? "点击完成后，审核规则立即更新未完成审核。"
                    : publishedRevision
                      ? "标题、说明和时间重新发布后生效；审核规则在完成时立即保存。"
                      : hasPublishedAuditPolicy
                        ? "审核提示词和脚本参数可在原位置修改，完成时立即保存。"
                        : "修改仅保存在当前页面，提交发布后写入流程版本。"}
          </span>
          <button
            className="primary-action"
            disabled={auditPolicySaving}
            onClick={() => void closeInspector()}
            type="button"
          >
            {auditPolicySaving ? "保存中…" : "完成"}
          </button>
        </footer>
      </aside>
      {timeSettingsOpen ? (
        <NodeTimeSettingsDialog
          node={node}
          onCancel={() => setTimeSettingsOpen(false)}
          onConfirm={(startAt, deadlineAt) => {
            onUpdateNode(node.id, { deadlineAt, startAt });
            setTimeSettingsOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function NodeTimeSettingsDialog({
  node,
  onCancel,
  onConfirm,
}: {
  node: AcademicFlowNode;
  onCancel: () => void;
  onConfirm: (startAt: string | null, deadlineAt: string | null) => void;
}) {
  const [startAt, setStartAt] = useState<string | null>(node.startAt ?? null);
  const [deadlineAt, setDeadlineAt] = useState<string | null>(node.deadlineAt ?? null);
  const invalid = Boolean(
    startAt
    && deadlineAt
    && new Date(startAt).getTime() >= new Date(deadlineAt).getTime(),
  );
  const draftNode = { ...node, deadlineAt, startAt };

  return (
    <div
      className="node-time-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        aria-labelledby="node-time-dialog-title"
        aria-modal="true"
        className="node-time-dialog"
        role="dialog"
      >
        <header>
          <h2 id="node-time-dialog-title">定时设置</h2>
          <button aria-label="关闭定时设置" autoFocus onClick={onCancel} type="button">×</button>
        </header>
        <div className="node-time-dialog-body">
          <div className="node-time-window-fields">
            <div className="node-time-window-field">
              <span>起始时间</span>
              <NodeDateTimePicker
                ariaLabel="起始时间"
                onConfirm={setStartAt}
                value={startAt}
              />
              {startAt ? (
                <button onClick={() => setStartAt(null)} type="button">清除</button>
              ) : null}
            </div>
            <i aria-hidden="true" />
            <div className="node-time-window-field">
              <span>截止时间</span>
              <NodeDateTimePicker
                ariaLabel="截止时间"
                onConfirm={setDeadlineAt}
                value={deadlineAt}
              />
              {deadlineAt ? (
                <button onClick={() => setDeadlineAt(null)} type="button">清除</button>
              ) : null}
            </div>
          </div>
          <p className={invalid ? "node-time-dialog-error" : "node-time-dialog-summary"}>
            {getTimeWindowSummary(draftNode)}
          </p>
        </div>
        <footer>
          <button onClick={onCancel} type="button">取消</button>
          <button
            className="primary-action"
            disabled={invalid}
            onClick={() => onConfirm(startAt, deadlineAt)}
            type="button"
          >确定</button>
        </footer>
      </section>
    </div>
  );
}

function ConfirmationScanSettings({
  disabled,
  node,
  onDeleteTemplate,
  onUpdate,
  onUploadTemplate,
  promptDisabled,
  promptError,
}: {
  disabled: boolean;
  node: AcademicFlowNode;
  onDeleteTemplate: () => void;
  onUpdate: (patch: Partial<AcademicFlowNode>) => void;
  onUploadTemplate: (file: File) => void;
  promptDisabled: boolean;
  promptError?: string;
}) {
  const enabled = Boolean(node.scanAuditEnabled);
  const selectTemplate = (file: File | undefined, input: HTMLInputElement) => {
    input.value = "";
    if (file) onUploadTemplate(file);
  };
  return (
    <section className="inspector-section confirmation-scan-settings">
      <div className="file-type-restriction-heading">
        <div><h3>扫描件提交与审核</h3><small>学生下载模板并上传签署扫描件，教师可选择直接通过或 AI 审核。</small></div>
      </div>
      <div className="node-template-card">
        <h3>签署文件模板（DOCX）</h3>
        {node.templateAsset ? <div className="node-template-file">
          <span aria-hidden="true" className="node-template-file-icon">DOCX</span>
          <div className="node-template-file-copy">
            <strong title={node.templateAsset.originalName}>{node.templateAsset.originalName}</strong>
            <small>{formatTemplateSize(node.templateAsset.sizeBytes)}</small>
          </div>
          {disabled ? <span>已随发布版本固化</span> : <div className="node-template-actions">
            <label>替换模板<input accept=".docx" type="file" onChange={(event) => selectTemplate(event.target.files?.[0], event.currentTarget)} /></label>
            <button onClick={onDeleteTemplate} type="button">删除模板</button>
          </div>}
        </div> : disabled ? <p className="muted-line">该节点发布时未配置模板。</p> : <label className="node-template-upload">
          <input accept=".docx" type="file" onChange={(event) => selectTemplate(event.target.files?.[0], event.currentTarget)} />
          <strong>选择 DOCX 模板</strong><small>教师模板必须为 .docx 文件</small>
        </label>}
      </div>
      <fieldset className="scan-audit-mode" disabled={disabled}>
        <legend>审核方式</legend>
        <label><input checked={!enabled} name={`scan-mode-${node.id}`} onChange={() => onUpdate({ scanAuditEnabled: false, scanAuditMode: undefined, scanAuditPrompt: "" })} type="radio" />上传后直接通过</label>
        <label><input checked={enabled && node.scanAuditMode === "pass_fail"} name={`scan-mode-${node.id}`} onChange={() => onUpdate({ scanAuditEnabled: true, scanAuditMode: "pass_fail" })} type="radio" />AI 通过 / 不通过</label>
        <label><input checked={enabled && node.scanAuditMode === "score"} name={`scan-mode-${node.id}`} onChange={() => onUpdate({ scanAuditEnabled: true, scanAuditMode: "score" })} type="radio" />AI 评分（0–100 分）</label>
      </fieldset>
      {enabled ? <>
        <label>
          <span>{node.scanAuditMode === "score" ? "评分标准" : "形式审核标准"}</span>
          <textarea disabled={promptDisabled} maxLength={2000} placeholder="请说明 AI 应检查的项目和判定标准" value={node.scanAuditPrompt ?? ""} onChange={(event) => onUpdate({ scanAuditPrompt: event.target.value })} />
          <small className={promptError ? "audit-script-error" : undefined}>
            {promptError || `${(node.scanAuditPrompt ?? "").length}/2000`}
          </small>
        </label>
      </> : null}
      <p className="muted-line">学生最多上传 10 个文件、合计 20 页；单文件 10 MB，整组 30 MB。支持 JPG、JPEG、PNG。</p>
    </section>
  );
}

function StudentFlowPreview({
  process,
  showShareUrl,
}: {
  process: AcademicProcess;
  showShareUrl: boolean;
}) {
  const pendingNode = useMemo(
    () => process.nodes.find((node) => node.status === "pending") ?? null,
    [process.nodes],
  );

  return (
    <section className="student-flow-card">
      <div className="student-flow-head">
        <div>
          <h2>{process.name}</h2>
          <p>多节点 OA 采集流程，需按审核顺序逐步完成。</p>
        </div>
        {showShareUrl && (
          <div className="share-url">
            <span>学生端加密链接</span>
            <strong>{process.shareUrl}</strong>
          </div>
        )}
      </div>
      <div className="student-flow-list">
        {process.nodes.map((node) => (
          <StudentNode key={node.id} node={node} />
        ))}
      </div>
      {pendingNode && (
        <div className="audit-waiting-modal">
          <strong>等待审核通过</strong>
          <p>{pendingNode.title} 正在审核中，审核通过后才能进入下一步。</p>
          <button type="button">我知道了</button>
        </div>
      )}
    </section>
  );
}

function StudentNode({ node }: { node: AcademicFlowNode }) {
  const isDisabled = node.status === "disabled";
  const isPending = node.status === "pending";
  return (
    <button
      className={`student-node ${node.status}`}
      disabled={isDisabled}
      type="button"
      aria-disabled={isDisabled}
    >
      <span>
        <strong>{node.title}</strong>
      </span>
      <em>
        {isDisabled
          ? "需等待上游审核通过"
          : isPending
            ? "强制等待审核"
            : statusLabels[node.status]}
      </em>
    </button>
  );
}

function getTemplateIcon(kind: AcademicFlowNodeKind) {
  if (kind === "file") {
    return "⇧";
  }
  if (kind === "confirmation") {
    return "☑";
  }
  if (kind === "announcement") {
    return "◫";
  }
  return "▤";
}

function getTimeWindowStatus(node: AcademicFlowNode) {
  const now = Date.now();
  const start = node.startAt ? new Date(node.startAt).getTime() : null;
  const deadline = node.deadlineAt ? new Date(node.deadlineAt).getTime() : null;
  if (deadline !== null && deadline <= now) return "已截止";
  if (start !== null && start > now) return "定时开放";
  if (start === null && deadline === null) return "未设置";
  return "开放中";
}

function getTimeWindowSummary(node: AcademicFlowNode) {
  if (node.startAt && node.deadlineAt) {
    const duration = new Date(node.deadlineAt).getTime() - new Date(node.startAt).getTime();
    if (duration <= 0) return "起始时间必须早于截止时间";
    const hours = Math.round(duration / 3_600_000 * 10) / 10;
    return `开放时长：${hours} 小时；还需满足所有前置节点已通过。`;
  }
  if (node.startAt) return "到达起始时间且所有前置节点通过后开放。";
  if (node.deadlineAt) return "前置节点通过后立即开放，并在截止时间关闭。";
  return "前置节点通过后立即开放，不自动截止。";
}

function formatTemplateSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatTemplateType(filename: string) {
  const extension = filename.split(".").pop()?.trim().toUpperCase();
  return extension && extension.length <= 5 ? extension : "FILE";
}

function getPortLabel(port: AcademicFlowPort) {
  if (port === "top") {
    return "上";
  }
  if (port === "bottom") {
    return "下";
  }
  if (port === "left") {
    return "左";
  }
  return "右";
}

function getPortPoint(node: FlowNodeLayout, port: AcademicFlowPort) {
  if (port === "top") {
    return { x: node.x + nodeSize.width / 2, y: node.y };
  }
  if (port === "bottom") {
    return { x: node.x + nodeSize.width / 2, y: node.y + node.renderedHeight };
  }
  if (port === "left") {
    return { x: node.x, y: node.y + node.renderedHeight / 2 };
  }
  return { x: node.x + nodeSize.width, y: node.y + node.renderedHeight / 2 };
}

function createArrowPolygon(x: number, y: number, targetPort: AcademicFlowPort) {
  const size = 9;
  const half = 5;
  if (targetPort === "top") {
    return `${x},${y} ${x - half},${y - size} ${x + half},${y - size}`;
  }
  if (targetPort === "bottom") {
    return `${x},${y} ${x - half},${y + size} ${x + half},${y + size}`;
  }
  if (targetPort === "left") {
    return `${x},${y} ${x - size},${y - half} ${x - size},${y + half}`;
  }
  return `${x},${y} ${x + size},${y - half} ${x + size},${y + half}`;
}

function getEdgeDeleteButtonStyle(edge: {
  midX: number;
  midY: number;
}) {
  return {
    left: edge.midX,
    top: edge.midY,
  };
}

function hasCycle(nodeIds: string[], edges: AcademicFlowEdge[]) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const nextNodes = new Map<string, string[]>();

  nodeIds.forEach((id) => nextNodes.set(id, []));
  edges.forEach((edge) => {
    nextNodes.get(edge.source)?.push(edge.target);
  });

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    visiting.add(nodeId);
    for (const target of nextNodes.get(nodeId) ?? []) {
      if (visit(target)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  return nodeIds.some((nodeId) => visit(nodeId));
}
