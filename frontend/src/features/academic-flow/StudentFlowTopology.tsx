import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { AcademicFlowEdge, AcademicFlowNode, AcademicFlowPort } from "../../types";
import type { RuntimeNodeInstance, RuntimeNodeStatus } from "./runtimeTypes";
import {
  createStudentEdgePath,
  getStudentCanvasBounds,
  getStudentEdgeTarget,
  studentNodeSize,
} from "./studentTopologyGeometry";
import {
  bindCtrlWheelListener,
  getCanvasPanOffset,
  getCanvasViewportZoomState,
  shouldStartCanvasPan,
  type CanvasPanStart,
} from "./canvasPan";

const statusLabels: Record<RuntimeNodeStatus, string> = {
  approved: "已通过",
  audit_error: "审核异常",
  available: "可填写",
  draft: "已暂存",
  expired: "已截止",
  locked: "待开放",
  rejected: "已退回",
  reviewing: "自动审核中",
  scheduled: "定时开放",
  submitted: "已提交",
};

const openableStatuses = new Set<RuntimeNodeStatus>([
  "approved",
  "available",
  "audit_error",
  "draft",
  "rejected",
  "reviewing",
  "scheduled",
]);

export function StudentFlowTopology({
  edges,
  nodes,
  onOpenNode,
  runtimeNodes,
}: {
  edges: AcademicFlowEdge[];
  nodes: AcademicFlowNode[];
  onOpenNode: (nodeKey: string) => void;
  runtimeNodes: RuntimeNodeInstance[];
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState<CanvasPanStart | null>(null);
  const runtimeByKey = useMemo(
    () => new Map(runtimeNodes.map((runtime) => [runtime.nodeKey, runtime])),
    [runtimeNodes],
  );
  const bounds = getStudentCanvasBounds(nodes);
  const approvedCount = runtimeNodes.filter((runtime) => runtime.status === "approved").length;
  const zoomCanvas = (event: WheelEvent) => {
    if (!viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const next = getCanvasViewportZoomState({
      deltaY: event.deltaY,
      offsetX: viewportOffset.x,
      offsetY: viewportOffset.y,
      pointerX: event.clientX - rect.left,
      pointerY: event.clientY - rect.top,
      zoom,
    });
    setZoom(next.zoom);
    setViewportOffset({ x: next.offsetX, y: next.offsetY });
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    return bindCtrlWheelListener(viewport, zoomCanvas);
  }, [viewportOffset, zoom]);

  const startCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!shouldStartCanvasPan({ button: event.button })) return;
    event.preventDefault();
    setPanStart({
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: viewportOffset.x,
      offsetY: viewportOffset.y,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveCanvas = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panStart) return;
    setViewportOffset(getCanvasPanOffset(panStart, event));
  };

  const endCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panStart) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanStart(null);
  };

  return (
    <section className="student-topology-section">
      <div className="student-topology-heading">
        <div>
          <p>我的流程</p>
          <h2>办理拓扑</h2>
        </div>
        <strong>{approvedCount}/{runtimeNodes.length} 个节点已通过</strong>
      </div>
      <div className="student-topology-legend" aria-label="节点状态图例">
        <span className="available">可填写</span>
        <span className="reviewing">自动审核中</span>
        <span className="audit_error">审核异常</span>
        <span className="approved">已通过</span>
        <span className="locked">待开放</span>
        <span className="expired">已截止</span>
      </div>
      <div
        className={`student-topology-viewport ${panStart ? "is-panning" : ""}`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerCancel={endCanvasPan}
        onPointerDown={startCanvasPan}
        onPointerMove={moveCanvas}
        onPointerUp={endCanvasPan}
        ref={viewportRef}
        style={{
          backgroundPosition: `${viewportOffset.x}px ${viewportOffset.y}px`,
          backgroundSize: `${16 * zoom}px ${16 * zoom}px`,
        }}
      >
        <div
          className="student-topology-zoom-surface"
          style={{
            height: Number(bounds.height) * zoom,
            transform: `translate(${viewportOffset.x}px, ${viewportOffset.y}px)`,
            width: Number(bounds.width) * zoom,
          }}
        >
          <div
            className="student-topology-canvas student-topology-zoom-content"
            style={{ ...bounds, transform: `scale(${zoom})` }}
          >
          <svg
            aria-hidden="true"
            className="student-topology-edges"
            height={bounds.height}
            width={bounds.width}
          >
            {edges.map((edge) => {
              const path = createStudentEdgePath(edge, nodes);
              const target = getStudentEdgeTarget(edge, nodes);
              if (!path || !target) return null;
              const targetRuntime = runtimeByKey.get(edge.target);
              const edgeState = targetRuntime?.status === "approved" ? "approved" : "default";
              return (
                <g className={edgeState} key={edge.id}>
                  <path d={path} />
                  <polygon points={createArrowPolygon(target.x, target.y, target.port)} />
                </g>
              );
            })}
          </svg>
          {nodes.map((node, index) => {
            const runtime = runtimeByKey.get(node.id);
            if (!runtime) return null;
            const openable = openableStatuses.has(runtime.status);
            return (
              <button
                aria-label={`${node.title}，${statusLabels[runtime.status]}`}
                className={`student-topology-node ${runtime.status}`}
                disabled={!openable}
                key={node.id}
                onClick={() => onOpenNode(node.id)}
                style={{
                  height: studentNodeSize.height,
                  left: node.x,
                  top: node.y,
                  width: studentNodeSize.width,
                }}
                type="button"
              >
                <span className="student-topology-node-index">{index + 1}</span>
                <strong>{node.title}</strong>
                <span className="student-topology-node-meta">
                  <em>{getKindLabel(node)}</em>
                  <i>{getTopologyStatusLabel(runtime.status, node.kind)}</i>
                </span>
              </button>
            );
          })}
          {nodes.length === 0 ? <p className="student-topology-empty">该流程暂无节点。</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function getKindLabel(node: AcademicFlowNode) {
  if (node.kind === "file") return "文件上传";
  if (node.kind === "confirmation") return "确认承诺";
  if (node.kind === "announcement") return "通知公告";
  return "信息填写";
}

function getTopologyStatusLabel(
  status: RuntimeNodeStatus,
  kind: AcademicFlowNode["kind"],
): string {
  if (status === "approved") {
    return kind === "form" ? "✓ 已完成 · 可修改" : "✓ 已完成 · 可查看";
  }
  if (status === "available" || status === "draft") return "→ 可填写";
  if (status === "rejected" || status === "audit_error") return "! 需处理";
  if (status === "reviewing" || status === "submitted") return "◌ 审核中";
  if (status === "expired") return "× 已截止";
  if (status === "scheduled") return "◷ 定时开放";
  return "• 待开放";
}

function createArrowPolygon(x: number, y: number, port: AcademicFlowPort) {
  if (port === "top") return `${x},${y} ${x - 6},${y - 10} ${x + 6},${y - 10}`;
  if (port === "bottom") return `${x},${y} ${x - 6},${y + 10} ${x + 6},${y + 10}`;
  if (port === "left") return `${x},${y} ${x - 10},${y - 6} ${x - 10},${y + 6}`;
  return `${x},${y} ${x + 10},${y - 6} ${x + 10},${y + 6}`;
}
