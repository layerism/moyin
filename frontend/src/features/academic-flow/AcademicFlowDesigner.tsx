import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent } from "react";

import type {
  AcademicFlowEdge,
  AcademicFlowNode,
  AcademicFlowNodeKind,
  AcademicFlowPort,
  AcademicFlowNodeStatus,
  AcademicProcess,
  AuditScriptType,
} from "../../types";
import { createNode, getAuditScriptLabel, nodeTemplates } from "./academicFlowData";
import { ApiError, workflowApi } from "./api";
import {
  bindCtrlWheelListener,
  getCanvasPanScroll,
  getCanvasZoomState,
  shouldStartCanvasPan,
  type CanvasPanStart,
} from "./canvasPan";
import {
  canDeleteRevisionEdge,
  canDeleteRevisionNode,
  filterPublishedRuntimeNodes,
  layoutRevisionNodes,
  shouldReloadRevisionAfterConflict,
} from "./flowRevision";
import {
  getPublishButtonState,
  getRevisionEditing,
} from "./publishButtonState";
import { FlowRosterDialog } from "./FlowRosterDialog";
import { RevisionImpactDialog } from "./RevisionImpactDialog";
import type { RevisionImpact } from "./runtimeTypes";
import { getAbsoluteShareUrl } from "./shareUrl";
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

type PendingNavigation = {
  destination: string;
  run: () => void;
};

export function AcademicFlowDesigner({
  onBack,
  onHome,
  onOpenStudent,
  onPublishProcess,
  onProcessChange,
  process,
}: {
  onBack: () => void;
  onHome: () => void;
  onOpenStudent: (shareUrl: string) => void;
  onPublishProcess: (
    process: AcademicProcess,
    expectedDraftConfigHash?: string | null,
    expectedCurrentVersionId?: string | null,
  ) => Promise<AcademicProcess>;
  onProcessChange: (process: AcademicProcess) => void;
  process: AcademicProcess;
}) {
  const [workingProcess, setWorkingProcess] = useState(() => structuredClone(process));
  const [activeNodeId, setActiveNodeId] = useState(process.nodes[0]?.id ?? "");
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [rosterActiveCount, setRosterActiveCount] = useState<number | null>(null);
  const [actionNotice, setActionNotice] = useState("");
  const [publishedShareUrl, setPublishedShareUrl] = useState("");
  const [revisionImpact, setRevisionImpact] = useState<RevisionImpact | null>(null);
  const [pendingPublishProcess, setPendingPublishProcess] = useState<AcademicProcess | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [saving, setSaving] = useState(false);
  const [revisionEditingRequested, setRevisionEditingRequested] = useState(false);
  const [revisionDirty, setRevisionDirty] = useState(false);
  const revisionEditing = getRevisionEditing(
    workingProcess.published,
    revisionEditingRequested,
  );
  const operationLocked = saving || revisionImpact !== null || pendingNavigation !== null;
  const editorLocked = operationLocked || (workingProcess.published && !revisionEditing);
  const processEdges = workingProcess.edges ?? [];
  const activeNode =
    workingProcess.nodes.find((node) => node.id === activeNodeId) ??
    workingProcess.nodes[0] ??
    null;
  const inspectorNode =
    workingProcess.nodes.find((node) => node.id === inspectorNodeId) ?? null;
  const serverFlowId = workingProcess.serverId ?? workingProcess.id;
  const existingNodeIds = workingProcess.nodes.map((node) => node.id);
  const protectedNodeIds = workingProcess.published ? workingProcess.publishedNodeIds : [];
  const protectedEdgeIds = process.published ? process.edges.map((edge) => edge.id) : [];
  const publishedRuntimeNodes = useMemo(
    () => filterPublishedRuntimeNodes(process.nodes, process.publishedNodeIds),
    [process.nodes, process.publishedNodeIds],
  );
  const publishButtonState = getPublishButtonState({
    hasUnpublishedChanges: revisionDirty,
    operationLocked,
    published: workingProcess.published,
    revisionEditing,
    rosterActiveCount,
  });

  const commitDesignChange = (nextProcess: AcademicProcess) => {
    if (editorLocked) return;
    setWorkingProcess({ ...nextProcess, hasUnpublishedChanges: true });
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
    setWorkingProcess(structuredClone(process));
    setActiveNodeId(process.nodes[0]?.id ?? "");
    setRevisionEditingRequested(false);
    setRevisionDirty(false);
    setRevisionImpact(null);
    setPendingPublishProcess(null);
  }, [process.id, process.publishedVersionId]);

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
      setWorkingProcess(structuredClone(nextProcess));
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
    void preparePublish();
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
    const nextValue = { ...value };
    if (workingProcess.published) {
      delete nextValue.deadlineAt;
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

  const connectNodes = (
    source: string,
    target: string,
    sourcePort: AcademicFlowPort,
    targetPort: AcademicFlowPort,
  ) => {
    if (editorLocked) return;
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

  const deleteEdge = (edgeId: string) => {
    if (editorLocked || !canDeleteRevisionEdge(edgeId, protectedEdgeIds)) return;
    commitDesignChange({
      ...workingProcess,
      edges: processEdges.filter((edge) => edge.id !== edgeId),
    });
  };

  const moveNode = (nodeId: string, direction: -1 | 1) => {
    if (editorLocked) return;
    const currentIndex = workingProcess.nodes.findIndex((node) => node.id === nodeId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= workingProcess.nodes.length) {
      return;
    }

    const nodes = [...workingProcess.nodes];
    const [target] = nodes.splice(currentIndex, 1);
    nodes.splice(nextIndex, 0, target);
    commitDesignChange({ ...workingProcess, nodes });
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

  const autoLayoutNodes = () => {
    if (editorLocked) return;
    commitDesignChange({
      ...workingProcess,
      nodes: layoutRevisionNodes(workingProcess.nodes),
    });
  };

  return (
    <main className="academic-standalone-page">
      <AcademicStandaloneHeader
        onBack={() => requestNavigation("教务流程列表", onBack)}
        onHome={() => requestNavigation("首页", onHome)}
      />
      <section className="academic-workspace-main">
        <header className="academic-topbar">
          <div>
            <div className="drive-breadcrumb academic-breadcrumb">
              <span>首页</span>
              <span>›</span>
              <button
                className="breadcrumb-button"
                onClick={() => requestNavigation("教务流程列表", onBack)}
              >
                教务流程
              </button>
              <span>›</span>
              <strong>{workingProcess.name}</strong>
            </div>
            <div className="academic-title-row">
              <h1>{workingProcess.name}</h1>
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
            <p>流程说明：{workingProcess.description}</p>
          </div>
          <div className="academic-actions">
            <button onClick={() => setShowRoster(true)}>
              学生名单{rosterActiveCount === null ? "" : ` (${rosterActiveCount})`}
            </button>
            {workingProcess.published ? (
              <button
                onClick={() =>
                  requestNavigation("学生填写页面", () =>
                    onOpenStudent(workingProcess.shareUrl),
                  )
                }
              >
                打开学生链接
              </button>
            ) : null}
            {workingProcess.publishedVersionId ? (
              <button onClick={() => setShowProgress(true)}>填写进度</button>
            ) : null}
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
            edges={processEdges}
            locked={editorLocked}
            nodes={workingProcess.nodes}
            onAddNode={addNode}
            onAutoLayout={autoLayoutNodes}
            onConnectNodes={connectNodes}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
            onMoveNode={moveNode}
            onOpenInspector={setInspectorNodeId}
            onSelectNode={setActiveNodeId}
            onUpdateNode={updateNode}
          />
        </section>
        {inspectorNode && (
          <NodeInspector
            deadlineReadOnly={workingProcess.published}
            editingLocked={editorLocked}
            node={inspectorNode}
            onClose={() => setInspectorNodeId(null)}
            onOpenProgress={() => {
              setInspectorNodeId(null);
              setShowProgress(true);
            }}
            onUpdateNode={updateNode}
          />
        )}
        {showProgress && workingProcess.publishedVersionId ? (
          <TeacherProgressPanel
            nodes={publishedRuntimeNodes}
            onClose={() => setShowProgress(false)}
            onDeadlineChange={() => undefined}
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
            onConfirm={() => {
              const navigate = pendingNavigation.run;
              setPendingNavigation(null);
              navigate();
            }}
          />
        ) : null}
      </section>
    </main>
  );
}

export function StudentFlowPage({
  onBack,
  onHome,
  process,
}: {
  onBack: () => void;
  onHome: () => void;
  process: AcademicProcess;
}) {
  return (
    <main className="academic-standalone-page">
      <AcademicStandaloneHeader onBack={onBack} onHome={onHome} />
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

function AcademicStandaloneHeader({ onBack, onHome }: { onBack: () => void; onHome: () => void }) {
  return (
    <header className="academic-standalone-header">
      <div className="academic-product-mark">
        <span className="logo-mark">OA</span>
        <strong>教务流程采集设计器</strong>
      </div>
      <nav aria-label="流程页面导航">
        <button onClick={onBack}>返回教务流程</button>
        <button onClick={onHome}>返回首页</button>
      </nav>
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
  edges,
  locked,
  nodes,
  onAddNode,
  onAutoLayout,
  onConnectNodes,
  onDeleteEdge,
  onDeleteNode,
  onMoveNode,
  onOpenInspector,
  onSelectNode,
  onUpdateNode,
}: {
  activeNodeId: string;
  canDeleteEdge: (edgeId: string) => boolean;
  canDeleteNode: (nodeId: string) => boolean;
  edges: AcademicFlowEdge[];
  locked: boolean;
  nodes: AcademicFlowNode[];
  onAddNode: (
    kind: AcademicFlowNodeKind,
    title: string,
    position?: { x: number; y: number },
  ) => void;
  onAutoLayout: () => void;
  onConnectNodes: (
    source: string,
    target: string,
    sourcePort: AcademicFlowPort,
    targetPort: AcademicFlowPort,
  ) => void;
  onDeleteEdge: (edgeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, direction: -1 | 1) => void;
  onOpenInspector: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onUpdateNode: (nodeId: string, value: Partial<AcademicFlowNode>) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const connectingFromRef = useRef<ConnectionDraft | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<ConnectionDraft | null>(null);
  const [connectionPreviewPoint, setConnectionPreviewPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [connectionPreviewPort, setConnectionPreviewPort] = useState<AcademicFlowPort | null>(
    null,
  );
  const [connectionPreviewTargetId, setConnectionPreviewTargetId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [panToolActive, setPanToolActive] = useState(false);
  const [panStart, setPanStart] = useState<CanvasPanStart | null>(null);
  const [zoom, setZoom] = useState(1);
  const [draggingNode, setDraggingNode] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  useEffect(() => {
    if (!locked) return;
    connectingFromRef.current = null;
    setConnectingFrom(null);
    setConnectionPreviewPoint(null);
    setConnectionPreviewPort(null);
    setConnectionPreviewTargetId(null);
    setDraggingNode(null);
    setSelectedEdgeId(null);
  }, [locked]);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const edgeLines = edges
    .map((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) {
        return null;
      }
      const ports = resolveEdgePorts(edge, source, target);
      return { ...edge, ...ports };
    })
    .filter((edge): edge is AcademicFlowEdge & {
      sourceX: number;
      sourceY: number;
      targetX: number;
      targetY: number;
      sourcePort: AcademicFlowPort;
      targetPort: AcademicFlowPort;
    } => Boolean(edge));
  const selectedEdge = edgeLines.find((edge) => edge.id === selectedEdgeId) ?? null;

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

  const getCanvasPoint = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: (clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0)) / zoom,
      y: (clientY - rect.top + (canvasRef.current?.scrollTop ?? 0)) / zoom,
    };
  };

  const zoomCanvas = (event: WheelEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const next = getCanvasZoomState({
      deltaY: event.deltaY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      scrollLeft: canvasRef.current.scrollLeft,
      scrollTop: canvasRef.current.scrollTop,
      zoom,
    });
    setZoom(next.zoom);
    canvasRef.current.scrollLeft = next.scrollLeft;
    canvasRef.current.scrollTop = next.scrollTop;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return bindCtrlWheelListener(canvas, zoomCanvas);
  }, [zoom]);

  const findMagnetTarget = (point: { x: number; y: number }, sourceNodeId: string) => {
    const magnetPadding = 36;
    const candidates = nodes
      .filter((node) => node.id !== sourceNodeId)
      .map((node) => {
        const inside =
          point.x >= node.x - magnetPadding &&
          point.x <= node.x + nodeSize.width + magnetPadding &&
          point.y >= node.y - magnetPadding &&
          point.y <= node.y + nodeSize.height + magnetPadding;
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
          node: AcademicFlowNode;
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

  const startNodeDrag = (event: PointerEvent<HTMLButtonElement>, node: AcademicFlowNode) => {
    if (locked || (event.target as HTMLElement).closest(".connection-port")) {
      return;
    }
    const point = getCanvasPoint(event.clientX, event.clientY);
    setDraggingNode({ id: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const dragNode = (event: PointerEvent<HTMLButtonElement>) => {
    if (!draggingNode) {
      return;
    }
    const point = getCanvasPoint(event.clientX, event.clientY);
    const nextPosition = snapCanvasPoint({
      x: point.x - draggingNode.offsetX,
      y: point.y - draggingNode.offsetY,
    });
    const currentNode = nodeById.get(draggingNode.id);
    if (currentNode?.x === nextPosition.x && currentNode?.y === nextPosition.y) {
      return;
    }
    onUpdateNode(draggingNode.id, nextPosition);
  };

  const endNodeDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (draggingNode) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      setDraggingNode(null);
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
      setConnectionPreviewTargetId(null);
      return;
    }
    const sourceNode = nodeById.get(source.nodeId);
    setConnectionPreviewPoint(sourceNode ? getPortPoint(sourceNode, source.port) : null);
    setConnectionPreviewPort(null);
    setConnectionPreviewTargetId(null);
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
    setConnectionPreviewTargetId(magnetTarget?.node.id ?? null);
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

  const autoLayout = () => {
    if (locked) return;
    onAutoLayout();
  };

  const startCanvasPan = (event: PointerEvent<HTMLDivElement>) => {
    const interactiveTarget =
      event.target instanceof Element &&
      Boolean(event.target.closest(".canvas-node-stack, .flow-edge-group, .flow-edge-delete"));
    if (
      !shouldStartCanvasPan({
        button: event.button,
        interactiveTarget,
        panToolActive,
      }) ||
      !canvasRef.current
    ) {
      return;
    }
    event.preventDefault();
    setSelectedEdgeId(null);
    setPanStart({
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: canvasRef.current.scrollLeft,
      scrollTop: canvasRef.current.scrollTop,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveCanvasPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (panStart && canvasRef.current) {
      const nextScroll = getCanvasPanScroll(panStart, event);
      canvasRef.current.scrollLeft = nextScroll.left;
      canvasRef.current.scrollTop = nextScroll.top;
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
    finishConnectionAt(event.clientX, event.clientY);
  };

  const cancelCanvasPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanStart(null);
    setConnectionSource(null);
  };
  const previewSourceNode = connectingFrom ? nodeById.get(connectingFrom.nodeId) ?? null : null;
  const previewSourcePoint =
    previewSourceNode && connectingFrom ? getPortPoint(previewSourceNode, connectingFrom.port) : null;
  const previewPath =
    previewSourceNode && previewSourcePoint && connectingFrom && connectionPreviewPoint
      ? connectionPreviewPort && connectionPreviewTargetId
        ? createOrthogonalPath(
            {
              source: previewSourceNode.id,
              sourcePort: connectingFrom.port,
              sourceX: previewSourcePoint.x,
              sourceY: previewSourcePoint.y,
              target: connectionPreviewTargetId,
              targetPort: connectionPreviewPort,
              targetX: connectionPreviewPoint.x,
              targetY: connectionPreviewPoint.y,
            },
            nodes,
          )
        : createPreviewPath(previewSourceNode, connectingFrom.port, connectionPreviewPoint)
      : "";

  return (
    <section className="flow-panel canvas-panel">
      <div className="panel-heading">
        <h2>流程画布</h2>
        <div className="canvas-toolbar">
          <button
            aria-label="手形工具"
            aria-pressed={panToolActive}
            className={`canvas-pan-tool ${panToolActive ? "active" : ""}`}
            onClick={() => setPanToolActive((active) => !active)}
            title="拖动画布"
            type="button"
          >
            <span aria-hidden="true">✋</span>
          </button>
          <button type="button">{Math.round(zoom * 100)}%</button>
          <button disabled={locked} onClick={autoLayout} type="button">
            自动布局
          </button>
        </div>
      </div>
      <div
        className={`flow-canvas dag-canvas ${panToolActive ? "pan-tool-active" : ""} ${panStart ? "is-panning" : ""}`}
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
        onPointerDown={startCanvasPan}
        onPointerMove={moveCanvasPointer}
        onPointerUp={endCanvasPointer}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setSelectedEdgeId(null);
          }
        }}
        ref={canvasRef}
      >
        <div className="canvas-zoom-surface" style={{ height: 1000 * zoom, width: 1200 * zoom }}>
          <div className="canvas-zoom-content" style={{ transform: `scale(${zoom})` }}>
            <svg className="flow-edge-layer">
          {edgeLines.map((edge) => {
            const path = createOrthogonalPath(edge, nodes);
            return (
              <g className={`flow-edge-group ${edge.id === selectedEdgeId ? "selected" : ""}`} key={edge.id}>
                <path className="flow-edge-line" d={path} />
                <polygon
                  className="flow-edge-arrow"
                  points={createArrowPolygon(edge.targetX, edge.targetY, edge.targetPort)}
                />
                {!locked ? (
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
            {nodes.map((node, index) => (
          <div
            className="canvas-node-stack dag-node-stack"
            key={node.id}
            style={{ left: node.x, top: node.y }}
          >
            <button
              className={`flow-node ${node.status} ${node.id === activeNodeId ? "selected" : ""}`}
              onClick={() => onSelectNode(node.id)}
              onPointerDown={(event) => startNodeDrag(event, node)}
              onPointerMove={dragNode}
              onPointerUp={endNodeDrag}
              type="button"
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
              <span className="node-index">{index + 1}</span>
              <strong>{node.title}</strong>
              <small>{node.requirement}</small>
              <span className="node-meta">
                <em>{kindLabels[node.kind]}</em>
                <i>{statusLabels[node.status]}</i>
              </span>
            </button>
            {!locked && node.id === activeNodeId && (
              <div className="node-quick-actions" aria-label="节点操作">
                <button
                  className="node-config-action"
                  onClick={() => onOpenInspector(node.id)}
                  title="配置节点"
                  type="button"
                >
                  ⚙
                </button>
                <button onClick={() => onMoveNode(node.id, -1)} type="button">
                  ↑
                </button>
                <button onClick={() => onMoveNode(node.id, 1)} type="button">
                  ↓
                </button>
                {canDeleteNode(node.id) ? (
                  <button
                    aria-label="删除节点"
                    onClick={() => onDeleteNode(node.id)}
                    title="删除节点"
                    type="button"
                  >
                    ×
                  </button>
                ) : (
                  <span
                    aria-label="已发布节点不可删除"
                    className="node-delete-lock"
                    role="img"
                    title="已发布节点不可删除"
                  >
                    锁
                  </span>
                )}
              </div>
            )}
          </div>
            ))}
            {nodes.length === 0 && (
              <div className="canvas-empty">请从左侧组件库拖入第一个流程节点。</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function NodeInspector({
  deadlineReadOnly,
  editingLocked,
  node,
  onClose,
  onOpenProgress,
  onUpdateNode,
}: {
  deadlineReadOnly: boolean;
  editingLocked: boolean;
  node: AcademicFlowNode | null;
  onClose: () => void;
  onOpenProgress: () => void;
  onUpdateNode: (nodeId: string, value: Partial<AcademicFlowNode>) => void;
}) {
  if (!node) {
    return null;
  }

  const addInfoField = () => {
    onUpdateNode(node.id, { infoFields: [...node.infoFields, "新增字段"] });
  };

  const updateInfoField = (index: number, value: string) => {
    onUpdateNode(node.id, {
      infoFields: node.infoFields.map((field, fieldIndex) =>
        fieldIndex === index ? value : field,
      ),
    });
  };

  const deleteInfoField = (index: number) => {
    onUpdateNode(node.id, {
      infoFields: node.infoFields.filter((_, fieldIndex) => fieldIndex !== index),
    });
  };

  return (
    <div className="node-inspector-backdrop" onMouseDown={onClose}>
      <aside
        aria-modal="true"
        className="flow-panel inspector-panel node-inspector-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="panel-heading inspector-modal-heading">
          <div>
            <h2>节点设置</h2>
            <span>{kindLabels[node.kind]}</span>
          </div>
          <button aria-label="关闭节点设置" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <fieldset className="node-inspector-fields" disabled={editingLocked}>
        <label>
          <span>节点标题</span>
          <input
            maxLength={50}
            value={node.title}
            onChange={(event) => onUpdateNode(node.id, { title: event.target.value })}
          />
        </label>
        <label>
          <span>节点说明</span>
          <textarea
            value={node.requirement}
            onChange={(event) => onUpdateNode(node.id, { requirement: event.target.value })}
          />
        </label>
        <label>
          <span>截止时间</span>
          <input
            disabled={deadlineReadOnly}
            readOnly={deadlineReadOnly}
            type="datetime-local"
            value={node.deadlineAt ? toLocalDateTime(node.deadlineAt) : ""}
            onChange={(event) =>
              onUpdateNode(node.id, {
                deadlineAt: event.target.value ? new Date(event.target.value).toISOString() : null,
              })
            }
          />
          {deadlineReadOnly ? (
            <small className="deadline-runtime-hint">
              截止时间由运行时管理，请在
              <button onClick={onOpenProgress} type="button">
                填写进度
              </button>
              中设置统一截止时间或个别延期。
            </small>
          ) : null}
        </label>
        <label className="inspector-checkbox-row">
          <input
            checked={node.autoApprove ?? true}
            type="checkbox"
            onChange={(event) => onUpdateNode(node.id, { autoApprove: event.target.checked })}
          />
          <span>提交后自动通过</span>
        </label>
        <label>
          <span>审核状态</span>
          <select
            value={node.status}
            onChange={(event) =>
              onUpdateNode(node.id, { status: event.target.value as AcademicFlowNodeStatus })
            }
          >
            <option value="approved">已通过</option>
            <option value="ready">可填写</option>
            <option value="pending">审核中</option>
            <option value="disabled">待开放</option>
          </select>
        </label>

        <section className="inspector-section">
          <div className="section-heading">
            <h3>采集用户信息</h3>
            <button onClick={addInfoField} type="button">
              + 添加字段
            </button>
          </div>
          {node.infoFields.map((field, index) => (
            <div className="field-row" key={`${field}-${index}`}>
              <span>☰</span>
              <input value={field} onChange={(event) => updateInfoField(index, event.target.value)} />
              <em>必填</em>
              <button onClick={() => deleteInfoField(index)} type="button">
                ×
              </button>
            </div>
          ))}
          {node.infoFields.length === 0 && <p className="muted-line">该节点暂无用户信息字段。</p>}
        </section>

        <section className="inspector-section">
          <h3>文件上传要求</h3>
          <label>
            <span>文件类型限制</span>
            <input
              value={node.fileExtensions}
              onChange={(event) => onUpdateNode(node.id, { fileExtensions: event.target.value })}
              placeholder="pdf, doc, docx, zip"
            />
          </label>
          <label>
            <span>单个文件大小上限</span>
            <input
              value={node.fileLimitMb}
              onChange={(event) => onUpdateNode(node.id, { fileLimitMb: event.target.value })}
              placeholder="50"
            />
          </label>
        </section>

        <section className="inspector-section">
          <h3>审核脚本（文件规范校验）</h3>
          <label>
            <span>脚本类型</span>
            <select
              value={node.auditScriptType}
              onChange={(event) =>
                onUpdateNode(node.id, { auditScriptType: event.target.value as AuditScriptType })
              }
            >
              <option value="none">{getAuditScriptLabel("none")}</option>
              <option value="py">{getAuditScriptLabel("py")}</option>
              <option value="mjs">{getAuditScriptLabel("mjs")}</option>
            </select>
          </label>
          <label>
            <span>脚本文件</span>
            <input
              disabled={node.auditScriptType === "none"}
              value={node.auditScriptName}
              onChange={(event) => onUpdateNode(node.id, { auditScriptName: event.target.value })}
              placeholder="check_material.py"
            />
          </label>
        </section>
        </fieldset>
      </aside>
    </div>
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
        {process.nodes.map((node, index) => (
          <StudentNode key={node.id} node={node} order={index + 1} />
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

function StudentNode({ node, order }: { node: AcademicFlowNode; order: number }) {
  const isDisabled = node.status === "disabled";
  const isPending = node.status === "pending";
  return (
    <button
      className={`student-node ${node.status}`}
      disabled={isDisabled}
      type="button"
      aria-disabled={isDisabled}
    >
      <span className="student-node-index">{order}</span>
      <span>
        <strong>{node.title}</strong>
        <small>{node.requirement}</small>
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

function toLocalDateTime(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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

function getPortPoint(node: AcademicFlowNode, port: AcademicFlowPort) {
  if (port === "top") {
    return { x: node.x + nodeSize.width / 2, y: node.y };
  }
  if (port === "bottom") {
    return { x: node.x + nodeSize.width / 2, y: node.y + nodeSize.height };
  }
  if (port === "left") {
    return { x: node.x, y: node.y + nodeSize.height / 2 };
  }
  return { x: node.x + nodeSize.width, y: node.y + nodeSize.height / 2 };
}

function getFallbackPorts(source: AcademicFlowNode, target: AcademicFlowNode) {
  const sourceCenterX = source.x + nodeSize.width / 2;
  const sourceCenterY = source.y + nodeSize.height / 2;
  const targetCenterX = target.x + nodeSize.width / 2;
  const targetCenterY = target.y + nodeSize.height / 2;
  const horizontalGap = Math.abs(targetCenterX - sourceCenterX);
  const verticalGap = Math.abs(targetCenterY - sourceCenterY);

  if (verticalGap >= horizontalGap) {
    return targetCenterY >= sourceCenterY
      ? ({ sourcePort: "bottom", targetPort: "top" } as const)
      : ({ sourcePort: "top", targetPort: "bottom" } as const);
  }

  return targetCenterX >= sourceCenterX
    ? ({ sourcePort: "right", targetPort: "left" } as const)
    : ({ sourcePort: "left", targetPort: "right" } as const);
}

function resolveEdgePorts(edge: AcademicFlowEdge, source: AcademicFlowNode, target: AcademicFlowNode) {
  const fallback = getFallbackPorts(source, target);
  const sourcePort = edge.sourcePort ?? fallback.sourcePort;
  const targetPort = edge.targetPort ?? fallback.targetPort;
  const sourcePoint = getPortPoint(source, sourcePort);
  const targetPoint = getPortPoint(target, targetPort);

  return {
    sourcePort,
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetPort,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
  };
}

function createOrthogonalPath(edge: {
  source: string;
  sourcePort: AcademicFlowPort;
  sourceX: number;
  sourceY: number;
  target: string;
  targetPort: AcademicFlowPort;
  targetX: number;
  targetY: number;
}, nodes: AcademicFlowNode[]) {
  const sourceOffset = offsetPoint(edge.sourceX, edge.sourceY, edge.sourcePort, 22);
  const targetOffset = offsetPoint(edge.targetX, edge.targetY, edge.targetPort, 22);
  const sourceIsHorizontal = edge.sourcePort === "left" || edge.sourcePort === "right";
  const targetIsHorizontal = edge.targetPort === "left" || edge.targetPort === "right";
  const canvasLeft = Math.min(...nodes.map((node) => node.x)) - 80;
  const canvasRight = Math.max(...nodes.map((node) => node.x + nodeSize.width)) + 80;
  const canvasTop = Math.min(...nodes.map((node) => node.y)) - 80;
  const canvasBottom = Math.max(...nodes.map((node) => node.y + nodeSize.height)) + 80;
  const targetNode = nodes.find((node) => node.id === edge.target);
  const bypassYs = targetNode
    ? [targetNode.y - 40, targetNode.y + nodeSize.height + 40]
    : [(sourceOffset.y + targetOffset.y) / 2];
  const sideXs = edge.sourcePort === "left" ? [canvasLeft, canvasRight] : [canvasRight, canvasLeft];
  const candidates = [
    [
      { x: edge.sourceX, y: edge.sourceY },
      sourceOffset,
      ...getOrthogonalMidpoints(sourceOffset, targetOffset, edge.sourcePort, edge.targetPort),
      targetOffset,
      { x: edge.targetX, y: edge.targetY },
    ],
  ];

  if (sourceIsHorizontal && targetIsHorizontal) {
    sideXs.forEach((sideX) => {
      bypassYs.forEach((bypassY) => {
        candidates.push([
          { x: edge.sourceX, y: edge.sourceY },
          sourceOffset,
          { x: sideX, y: sourceOffset.y },
          { x: sideX, y: bypassY },
          { x: targetOffset.x, y: bypassY },
          targetOffset,
          { x: edge.targetX, y: edge.targetY },
        ]);
      });
    });
  }

  if (!sourceIsHorizontal && !targetIsHorizontal) {
    sideXs.forEach((sideX) => {
      candidates.push([
        { x: edge.sourceX, y: edge.sourceY },
        sourceOffset,
        { x: sideX, y: sourceOffset.y },
        { x: sideX, y: targetOffset.y },
        targetOffset,
        { x: edge.targetX, y: edge.targetY },
      ]);
    });
  }

  if (!sourceIsHorizontal && targetIsHorizontal) {
    const targetSideXs =
      edge.targetPort === "left" ? [canvasLeft, canvasRight] : [canvasRight, canvasLeft];
    targetSideXs.forEach((sideX) => {
      candidates.push([
        { x: edge.sourceX, y: edge.sourceY },
        sourceOffset,
        { x: sideX, y: sourceOffset.y },
        { x: sideX, y: targetOffset.y },
        targetOffset,
        { x: edge.targetX, y: edge.targetY },
      ]);
    });
  }

  if (sourceIsHorizontal && !targetIsHorizontal) {
    const targetSideYs =
      edge.targetPort === "top" ? [canvasTop, canvasBottom] : [canvasBottom, canvasTop];
    targetSideYs.forEach((sideY) => {
      candidates.push([
        { x: edge.sourceX, y: edge.sourceY },
        sourceOffset,
        { x: sourceOffset.x, y: sideY },
        { x: targetOffset.x, y: sideY },
        targetOffset,
        { x: edge.targetX, y: edge.targetY },
      ]);
    });
  }

  const points = candidates
    .map((candidate) => dedupePoints(candidate))
    .sort((left, right) => {
      const leftScore = getRouteCollisionCount(left, nodes, edge.source, edge.target);
      const rightScore = getRouteCollisionCount(right, nodes, edge.source, edge.target);
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return getRouteLength(left) - getRouteLength(right);
    })[0];
  const [first, ...rest] = dedupePoints(points);

  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
}

function getRouteCollisionCount(
  points: Array<{ x: number; y: number }>,
  nodes: AcademicFlowNode[],
  sourceId: string,
  targetId: string,
) {
  return points.slice(1).reduce((count, point, index) => {
    const segment = { a: points[index], b: point };
    const isFirstSegment = index === 0;
    const isLastSegment = index === points.length - 2;
    return (
      count +
      nodes.filter((node) => {
        if (node.id === sourceId && isFirstSegment) {
          return false;
        }
        if (node.id === targetId && isLastSegment) {
          return false;
        }
        return segmentIntersectsNodeInterior(segment, node);
      }).length
    );
  }, 0);
}

function segmentIntersectsNodeInterior(
  segment: { a: { x: number; y: number }; b: { x: number; y: number } },
  node: AcademicFlowNode,
) {
  const margin = 6;
  const left = node.x + margin;
  const right = node.x + nodeSize.width - margin;
  const top = node.y + margin;
  const bottom = node.y + nodeSize.height - margin;
  const minX = Math.min(segment.a.x, segment.b.x);
  const maxX = Math.max(segment.a.x, segment.b.x);
  const minY = Math.min(segment.a.y, segment.b.y);
  const maxY = Math.max(segment.a.y, segment.b.y);

  if (segment.a.y === segment.b.y) {
    return segment.a.y > top && segment.a.y < bottom && maxX > left && minX < right;
  }
  if (segment.a.x === segment.b.x) {
    return segment.a.x > left && segment.a.x < right && maxY > top && minY < bottom;
  }
  return false;
}

function getRouteLength(points: Array<{ x: number; y: number }>) {
  return points.slice(1).reduce((length, point, index) => {
    const previous = points[index];
    return length + Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
  }, 0);
}

function createPreviewPath(
  sourceNode: AcademicFlowNode,
  sourcePort: AcademicFlowPort,
  target: { x: number; y: number },
) {
  const source = getPortPoint(sourceNode, sourcePort);
  const sourceOffset = offsetPoint(source.x, source.y, sourcePort, 22);
  const points =
    sourcePort === "top" || sourcePort === "bottom"
      ? [source, sourceOffset, { x: sourceOffset.x, y: target.y }, target]
      : [source, sourceOffset, { x: target.x, y: sourceOffset.y }, target];
  const [first, ...rest] = dedupePoints(points);

  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
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
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}) {
  return {
    left: (edge.sourceX + edge.targetX) / 2,
    top: (edge.sourceY + edge.targetY) / 2,
  };
}

function getOrthogonalMidpoints(
  source: { x: number; y: number },
  target: { x: number; y: number },
  sourcePort: AcademicFlowPort,
  targetPort: AcademicFlowPort,
) {
  if (source.x === target.x || source.y === target.y) {
    return [];
  }

  const sourceIsHorizontal = sourcePort === "left" || sourcePort === "right";
  const targetIsHorizontal = targetPort === "left" || targetPort === "right";
  if (sourceIsHorizontal && targetIsHorizontal) {
    const movingRight = sourcePort === "right";
    const targetFacesSource =
      (sourcePort === "right" && targetPort === "left" && source.x < target.x) ||
      (sourcePort === "left" && targetPort === "right" && source.x > target.x);
    const midX = targetFacesSource
      ? (source.x + target.x) / 2
      : movingRight
        ? Math.max(source.x, target.x) + 80
        : Math.min(source.x, target.x) - 80;
    return [
      { x: midX, y: source.y },
      { x: midX, y: target.y },
    ];
  }

  if (sourceIsHorizontal && !targetIsHorizontal) {
    return [{ x: target.x, y: source.y }];
  }

  if (!sourceIsHorizontal && targetIsHorizontal) {
    return [{ x: source.x, y: target.y }];
  }

  const midY = (source.y + target.y) / 2;
  return [
    { x: source.x, y: midY },
    { x: target.x, y: midY },
  ];
}

function offsetPoint(x: number, y: number, port: AcademicFlowPort, distance: number) {
  if (port === "top") {
    return { x, y: y - distance };
  }
  if (port === "bottom") {
    return { x, y: y + distance };
  }
  if (port === "left") {
    return { x: x - distance, y };
  }
  return { x: x + distance, y };
}

function dedupePoints(points: Array<{ x: number; y: number }>) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
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
