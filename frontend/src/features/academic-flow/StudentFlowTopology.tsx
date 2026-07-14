import { useMemo, useRef, useState, type WheelEvent } from "react";

import type { AcademicFlowEdge, AcademicFlowNode, AcademicFlowPort } from "../../types";
import type { RuntimeNodeInstance, RuntimeNodeStatus } from "./runtimeTypes";
import {
  createStudentEdgePath,
  getStudentCanvasBounds,
  getStudentEdgeTarget,
  studentNodeSize,
} from "./studentTopologyGeometry";
import { getCanvasZoomState } from "./canvasPan";

const statusLabels: Record<RuntimeNodeStatus, string> = {
  approved: "已通过",
  available: "可填写",
  draft: "已暂存",
  expired: "已截止",
  locked: "待开放",
  rejected: "已退回",
  reviewing: "自动审核中",
  submitted: "已提交",
};

const writableStatuses = new Set<RuntimeNodeStatus>(["available", "draft", "rejected"]);

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
  const runtimeByKey = useMemo(
    () => new Map(runtimeNodes.map((runtime) => [runtime.nodeKey, runtime])),
    [runtimeNodes],
  );
  const bounds = getStudentCanvasBounds(nodes);
  const approvedCount = runtimeNodes.filter((runtime) => runtime.status === "approved").length;
  const zoomCanvas = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey || !viewportRef.current) return;
    event.preventDefault();
    const rect = viewportRef.current.getBoundingClientRect();
    const next = getCanvasZoomState({
      deltaY: event.deltaY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      scrollLeft: viewportRef.current.scrollLeft,
      scrollTop: viewportRef.current.scrollTop,
      zoom,
    });
    setZoom(next.zoom);
    viewportRef.current.scrollLeft = next.scrollLeft;
    viewportRef.current.scrollTop = next.scrollTop;
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
        <span className="approved">已通过</span>
        <span className="locked">待开放</span>
        <span className="expired">已截止</span>
      </div>
      <div className="student-topology-viewport" onWheel={zoomCanvas} ref={viewportRef}>
        <div
          className="student-topology-zoom-surface"
          style={{ height: Number(bounds.height) * zoom, width: Number(bounds.width) * zoom }}
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
            const writable = writableStatuses.has(runtime.status);
            return (
              <button
                aria-label={`${node.title}，${statusLabels[runtime.status]}`}
                className={`student-topology-node ${runtime.status}`}
                disabled={!writable}
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
                <small>{node.requirement}</small>
                <span className="student-topology-node-meta">
                  <em>{getKindLabel(node)}</em>
                  <i>{statusLabels[runtime.status]}</i>
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

function createArrowPolygon(x: number, y: number, port: AcademicFlowPort) {
  if (port === "top") return `${x},${y} ${x - 6},${y - 10} ${x + 6},${y - 10}`;
  if (port === "bottom") return `${x},${y} ${x - 6},${y + 10} ${x + 6},${y + 10}`;
  if (port === "left") return `${x},${y} ${x - 10},${y - 6} ${x - 10},${y + 6}`;
  return `${x},${y} ${x + 10},${y - 6} ${x + 10},${y + 6}`;
}
