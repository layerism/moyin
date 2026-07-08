import { useMemo, useRef, useState } from "react";
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
const connectionPorts: AcademicFlowPort[] = ["top", "right", "bottom", "left"];

type ConnectionDraft = {
  nodeId: string;
  port: AcademicFlowPort;
};

export function AcademicFlowDesigner({
  onBack,
  onHome,
  onOpenStudent,
  onProcessChange,
  process,
}: {
  onBack: () => void;
  onHome: () => void;
  onOpenStudent: (shareUrl: string) => void;
  onProcessChange: (process: AcademicProcess) => void;
  process: AcademicProcess;
}) {
  const [mode, setMode] = useState<"student" | "teacher">("teacher");
  const [activeNodeId, setActiveNodeId] = useState(process.nodes[0]?.id ?? "");
  const processEdges = process.edges ?? [];
  const activeNode =
    process.nodes.find((node) => node.id === activeNodeId) ?? process.nodes[0] ?? null;

  const publishProcess = () => {
    const nextProcess = { ...process, published: true };
    onProcessChange(nextProcess);
    onOpenStudent(nextProcess.shareUrl);
  };

  const addNode = (
    kind: AcademicFlowNodeKind,
    title: string,
    position?: { x: number; y: number },
  ) => {
    const nextNode = createNode(kind, title, position);
    const nextProcess = { ...process, nodes: [...process.nodes, nextNode] };
    onProcessChange(nextProcess);
    setActiveNodeId(nextNode.id);
    setMode("teacher");
  };

  const updateNode = (nodeId: string, value: Partial<AcademicFlowNode>) => {
    onProcessChange({
      ...process,
      nodes: process.nodes.map((node) => (node.id === nodeId ? { ...node, ...value } : node)),
    });
  };

  const connectNodes = (
    source: string,
    target: string,
    sourcePort: AcademicFlowPort,
    targetPort: AcademicFlowPort,
  ) => {
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
    if (hasCycle(process.nodes.map((node) => node.id), nextEdges)) {
      return;
    }
    onProcessChange({ ...process, edges: nextEdges });
  };

  const deleteEdge = (edgeId: string) => {
    onProcessChange({ ...process, edges: processEdges.filter((edge) => edge.id !== edgeId) });
  };

  const moveNode = (nodeId: string, direction: -1 | 1) => {
    const currentIndex = process.nodes.findIndex((node) => node.id === nodeId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= process.nodes.length) {
      return;
    }

    const nodes = [...process.nodes];
    const [target] = nodes.splice(currentIndex, 1);
    nodes.splice(nextIndex, 0, target);
    onProcessChange({ ...process, nodes });
  };

  const deleteNode = (nodeId: string) => {
    const nodes = process.nodes.filter((node) => node.id !== nodeId);
    const edges = processEdges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    onProcessChange({ ...process, edges, nodes });
    setActiveNodeId(nodes[0]?.id ?? "");
  };

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
              <strong>{process.name}</strong>
            </div>
            <div className="academic-title-row">
              <h1>{process.name}</h1>
              <span className={process.published ? "status-pill ok" : "status-pill"}>草稿</span>
            </div>
            <p>流程说明：用于教务材料的分阶段提交与审核。</p>
          </div>
          <div className="academic-actions">
            <button onClick={() => setMode("student")}>预览学生端</button>
            <button onClick={publishProcess}>发布与分享</button>
            <button>保存草稿</button>
            <button className="primary-action">保存并退出</button>
          </div>
        </header>

        <div className="mode-switch" role="tablist" aria-label="流程视图">
          <button
            className={mode === "teacher" ? "active" : ""}
            onClick={() => setMode("teacher")}
            role="tab"
            type="button"
          >
            教师设计
          </button>
          <button
            className={mode === "student" ? "active" : ""}
            onClick={() => setMode("student")}
            role="tab"
            type="button"
          >
            学生预览
          </button>
        </div>

        {mode === "teacher" ? (
          <section className="flow-designer-grid">
            <ComponentPalette onAddNode={addNode} />
            <FlowNodeCanvas
              activeNodeId={activeNode?.id ?? ""}
              edges={processEdges}
              nodes={process.nodes}
              onAddNode={addNode}
              onConnectNodes={connectNodes}
              onDeleteNode={deleteNode}
              onDeleteEdge={deleteEdge}
              onMoveNode={moveNode}
              onSelectNode={setActiveNodeId}
              onUpdateNode={updateNode}
            />
            <NodeInspector node={activeNode} onUpdateNode={updateNode} />
          </section>
        ) : (
          <section className="student-preview-shell">
            <StudentFlowPreview process={process} showShareUrl />
          </section>
        )}
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
  onAddNode,
}: {
  onAddNode: (kind: AcademicFlowNodeKind, title: string) => void;
}) {
  return (
    <aside className="flow-panel palette-panel">
      <h2>组件库</h2>
      <p>拖拽组件到画布，构建流程节点</p>
      <h3>流程节点</h3>
      <div className="node-template-list">
        {nodeTemplates.map((template) => (
          <button
            className={`node-template ${template.kind}`}
            draggable
            key={`${template.kind}-${template.title}`}
            onDragStart={(event) => {
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
        <button type="button">
          <span>↳</span>
          <strong>条件分支</strong>
          <small>根据条件走不同分支</small>
        </button>
        <button type="button">
          <span>⇄</span>
          <strong>并行节点</strong>
          <small>多个分支并行进行</small>
        </button>
      </div>
      <div className="palette-hint">
        提示：可将组件拖入画布，节点进入画布后可拖动定位，并通过左右连接点手动连线。
      </div>
    </aside>
  );
}

function FlowNodeCanvas({
  activeNodeId,
  edges,
  nodes,
  onAddNode,
  onConnectNodes,
  onDeleteEdge,
  onDeleteNode,
  onMoveNode,
  onSelectNode,
  onUpdateNode,
}: {
  activeNodeId: string;
  edges: AcademicFlowEdge[];
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
  onMoveNode: (nodeId: string, direction: -1 | 1) => void;
  onSelectNode: (nodeId: string) => void;
  onUpdateNode: (nodeId: string, value: Partial<AcademicFlowNode>) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const connectingFromRef = useRef<ConnectionDraft | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<ConnectionDraft | null>(null);
  const [draggingNode, setDraggingNode] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

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

  const getCanvasPoint = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: clientX - rect.left + (canvasRef.current?.scrollLeft ?? 0),
      y: clientY - rect.top + (canvasRef.current?.scrollTop ?? 0),
    };
  };

  const dropNode = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/x-academic-node-kind") as AcademicFlowNodeKind;
    const title = event.dataTransfer.getData("application/x-academic-node-title");
    if (!kind || !title) {
      return;
    }
    const point = getCanvasPoint(event.clientX, event.clientY);
    onAddNode(kind, title, {
      x: Math.max(24, point.x - nodeSize.width / 2),
      y: Math.max(24, point.y - nodeSize.height / 2),
    });
  };

  const startNodeDrag = (event: PointerEvent<HTMLButtonElement>, node: AcademicFlowNode) => {
    if ((event.target as HTMLElement).closest(".connection-port")) {
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
    onUpdateNode(draggingNode.id, {
      x: Math.max(16, point.x - draggingNode.offsetX),
      y: Math.max(16, point.y - draggingNode.offsetY),
    });
  };

  const endNodeDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (draggingNode) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      setDraggingNode(null);
    }
  };

  const setConnectionSource = (source: ConnectionDraft | null) => {
    connectingFromRef.current = source;
    setConnectingFrom(source);
  };

  const completeConnection = (targetId: string, targetPort: AcademicFlowPort) => {
    const source = connectingFromRef.current ?? connectingFrom;
    if (source) {
      onConnectNodes(source.nodeId, targetId, source.port, targetPort);
    }
    setConnectionSource(null);
  };

  const autoLayout = () => {
    nodes.forEach((node, index) => {
      onUpdateNode(node.id, {
        x: 170 + (index % 2) * 330,
        y: 70 + Math.floor(index / 2) * 185,
      });
    });
  };

  return (
    <section className="flow-panel canvas-panel">
      <div className="panel-heading">
        <h2>流程画布</h2>
        <div className="canvas-toolbar">
          <button>⌖</button>
          <button>100%</button>
          <button onClick={autoLayout} type="button">
            自动布局
          </button>
        </div>
      </div>
      <div
        className="flow-canvas dag-canvas"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={dropNode}
        ref={canvasRef}
      >
        <svg className="flow-edge-layer" aria-hidden="true">
          <defs>
            <marker id="flow-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
              <path d="M0,0 L8,4 L0,8 Z" fill="#64748b" />
            </marker>
          </defs>
          {edgeLines.map((edge) => {
            const path = createOrthogonalPath(edge);
            return (
              <path
                className="flow-edge-line"
                d={path}
                key={edge.id}
                markerEnd="url(#flow-arrow)"
              />
            );
          })}
        </svg>
        <div className="edge-delete-list" aria-label="连接线列表">
          {edges.map((edge) => (
            <button key={edge.id} onClick={() => onDeleteEdge(edge.id)} type="button">
              删除连接 {nodeById.get(edge.source)?.title ?? "节点"} → {nodeById.get(edge.target)?.title ?? "节点"}
            </button>
          ))}
        </div>
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
              {connectionPorts.map((port) => (
                <span
                  className={`connection-port ${port} ${
                    connectingFrom && connectingFrom.nodeId !== node.id ? "connectable" : ""
                  } ${connectingFrom?.nodeId === node.id && connectingFrom.port === port ? "connecting" : ""}`}
                  data-node-id={node.id}
                  data-port-position={port}
                  key={port}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (connectingFrom && connectingFrom.nodeId !== node.id) {
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
                    setConnectionSource({ nodeId: node.id, port });
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
                    setConnectionSource(null);
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
            {node.id === activeNodeId && (
              <div className="node-quick-actions" aria-label="节点操作">
                <button onClick={() => onMoveNode(node.id, -1)} type="button">
                  ↑
                </button>
                <button onClick={() => onMoveNode(node.id, 1)} type="button">
                  ↓
                </button>
                <button onClick={() => onDeleteNode(node.id)} type="button">
                  ×
                </button>
              </div>
            )}
          </div>
        ))}
        {nodes.length === 0 && (
          <div className="canvas-empty">请从左侧组件库拖入第一个流程节点。</div>
        )}
      </div>
    </section>
  );
}

function NodeInspector({
  node,
  onUpdateNode,
}: {
  node: AcademicFlowNode | null;
  onUpdateNode: (nodeId: string, value: Partial<AcademicFlowNode>) => void;
}) {
  if (!node) {
    return (
      <aside className="flow-panel inspector-panel">
        <h2>节点设置</h2>
        <p>请选择或新增一个流程节点。</p>
      </aside>
    );
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
    <aside className="flow-panel inspector-panel">
      <div className="panel-heading">
        <h2>节点设置</h2>
        <span>{kindLabels[node.kind]}</span>
      </div>
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
    </aside>
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
  sourcePort: AcademicFlowPort;
  sourceX: number;
  sourceY: number;
  targetPort: AcademicFlowPort;
  targetX: number;
  targetY: number;
}) {
  const sourceOffset = offsetPoint(edge.sourceX, edge.sourceY, edge.sourcePort, 22);
  const targetOffset = offsetPoint(edge.targetX, edge.targetY, edge.targetPort, 22);
  const points = [
    { x: edge.sourceX, y: edge.sourceY },
    sourceOffset,
    ...getOrthogonalMidpoints(sourceOffset, targetOffset),
    targetOffset,
    { x: edge.targetX, y: edge.targetY },
  ];
  const [first, ...rest] = dedupePoints(points);

  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
}

function getOrthogonalMidpoints(
  source: { x: number; y: number },
  target: { x: number; y: number },
) {
  if (source.x === target.x || source.y === target.y) {
    return [];
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
