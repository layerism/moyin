import { nodeReferences } from "./nodeReferences";
import { NodeReferenceFiles } from "./NodeReferenceFiles";
import { resolveFlowSchedule, getFlowTimeIssues } from "./flowDeadlines";
import { NodeFileRow } from "./NodeFileRow";
import { fileReviewError, fileReviewSteps, FileReviewStepsEditor, hasSequentialManualReview } from "./FileReviewStepsEditor";
import { FileReviewDialog } from "./FileReviewDialog";
import { NodeModelSelector } from "./NodeModelSelector";
import { ManualReviewDialog } from "./ManualReviewDialog";
import { FlowNodeIcon } from "./FlowNodeIcon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent } from "react";

import type {
  AcademicFlowEdge,
  AcademicFlowNode,
  AcademicFlowNodeKind,
  AcademicFlowPort,
  AcademicFlowNodeStatus,
  AcademicProcess,
  FileReviewStep,
} from "../../types";
import {
  createNode,
  fileTypeRestrictionPresets,
  getFileExtensionsForPreset,
  getNodeSettingCapabilities,
  getFileTypeRestrictionPreset,
  nodeTemplates,
} from "./academicFlowData";
import { ApiError, FLOW_PREVIEW_TOKEN_KEY, workflowApi, type AnswerKeyPolicy, type ReviewStepPolicy } from "./api";
import {
  getAuditScriptParameterError,
  type NodeAuditPolicy,
} from "./auditScripts";
import {
  bindCanvasZoomWheelListener,
  constrainCanvasGroupDelta,
  getCanvasArrowKeyDelta,
  getCanvasEdgePanDelta,
  getCanvasPanOffset,
  getCanvasViewportZoomState,
  isCanvasControlModifierActive,
  isCanvasKeyboardEditingTarget,
  shouldStartCanvasPan,
  type CanvasPoint,
  type CanvasPanStart,
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
  getScanAuditConfigError,
} from "./publishButtonState";
import { FlowRosterDialog } from "./FlowRosterDialog";
import { FormFieldEditor } from "./FormFieldEditor";
import { validateFormFieldConfig } from "./formFields";
import { createPrivateAnswer } from "./answerSheet";
import {
  getAnswerSheetPublishIssue,
  type AnswerSheetPublishIssue,
} from "./answerSheetPublishPreflight";
import { AnswerSheetEditor } from "./AnswerSheetEditor";
import { AnnouncementEditor } from "./AnnouncementEditor";
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
import { TeacherProgressPanel } from "./TeacherProgressPanel";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

import { branchPort, branchPortFraction, nodePorts } from "./branch";
import { BranchOptionsEditor } from "./BranchOptionsEditor";

const statusLabels: Record<AcademicFlowNodeStatus, string> = {
  approved: "已通过",
  disabled: "待开放",
  pending: "审核中",
  ready: "可填写",
};

const kindLabels: Record<AcademicFlowNodeKind, string> = {
  branch: "条件分支",
  or_gate: "或节点",
  announcement: "通知公告",
  answer_sheet: "答题卡",
  confirmation: "视觉审核",
  file: "文件上传",
  form: "信息填写",
};

const nodeSize = { height: 126, width: 280 };
const canvasGridSize = 16;
const canvasMinimumSize = { height: 1000, width: 1200 };
const canvasConnectionPadding = 240;
const connectionEdgePanSize = 48;
const connectionEdgePanMaxStep = 14;

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
  templateMode = false,
  onBack,
  onPublishProcess,
  onProcessChange,
  onSaveProcess,
  process,
}: {
  templateMode?: boolean;
  onBack: () => void;
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
  const [rosterActiveCount, setRosterActiveCount] = useState<number | null>(null);
  const [actionNotice, setActionNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const showActionError = (message: string) => { setActionNotice(""); setActionError(message); };
  const [publishIssue, setPublishIssue] = useState<AnswerSheetPublishIssue | null>(null);
  const [revisionImpact, setRevisionImpact] = useState<RevisionImpact | null>(null);
  const [pendingPublishProcess, setPendingPublishProcess] = useState<AcademicProcess | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [copyingNode, setCopyingNode] = useState(false);
  const copyingNodeRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [announcementUploads, setAnnouncementUploads] = useState(0);
  const persistedNodeIds = useRef(new Set(process.draftConfig.nodes.map((node) => node.id)));
  const pendingAnnouncementNodeSave = useRef<Promise<void> | null>(null);
  const [previewCreating, setPreviewCreating] = useState(false);
  const [manualReviewNodeId, setManualReviewNodeId] = useState<string | null>(null);
  const [nodePackageDialogNodeId, setNodePackageDialogNodeId] = useState<string | null>(null);
  const [revisionEditingRequested, setRevisionEditingRequested] = useState(false);
  const [revisionDirty, setRevisionDirty] = useState(false);
  const revisionEditing = getRevisionEditing(
    workingProcess.published,
    revisionEditingRequested,
    workingProcess.hasUnpublishedChanges,
  );
  const baseOperationLocked = copyingNode || saving || previewCreating || revisionImpact !== null || pendingNavigation !== null;
  const announcementEditingLocked = baseOperationLocked || (workingProcess.published && !revisionEditing);
  const operationLocked = baseOperationLocked || announcementUploads > 0;
  const editorLocked = operationLocked || (workingProcess.published && !revisionEditing);
  const processEdges = workingProcess.edges ?? [];
  const schedule = resolveFlowSchedule(workingProcess.nodes, processEdges);
  const timeIssues = getFlowTimeIssues(workingProcess.nodes, processEdges);
  const [timeFocus, setTimeFocus] = useState<{ nodeId: string; attempt: number } | null>(null);
  const validateTimeSettings = (candidate: AcademicProcess) => {
    const issues = getFlowTimeIssues(candidate.nodes, candidate.edges ?? []);
    const issue = issues.entries().next().value;
    if (!issue) return true;
    const [nodeId] = issue;
    setActionError("");
    setActionNotice("");
    setRevisionImpact(null);
    setPendingNavigation(null);
    setActiveNodeId(nodeId);
    setTimeFocus((current) => ({ nodeId, attempt: (current?.attempt ?? 0) + 1 }));
    setInspectorNodeId(null);
    return false;
  };
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
    if (announcementUploads > 0) {
      showActionError("请等待公告图片上传完成后再离开");
      return;
    }
    if (!revisionDirty) {
      navigate();
      return;
    }
    setPendingNavigation({ destination, run: navigate });
  };

  useEffect(() => {
    setWorkingProcess(createDraftWorkingProcess(process));
    persistedNodeIds.current = new Set(process.draftConfig.nodes.map((node) => node.id));
    pendingAnnouncementNodeSave.current = null;
    setActiveNodeId(process.draftConfig.nodes[0]?.id ?? "");
    setRevisionEditingRequested(false);
    setRevisionDirty(false);
    setRevisionImpact(null);
    setPendingPublishProcess(null);
    setPublishIssue(null);
    setNodePackageDialogNodeId(null);
    setManualReviewNodeId(null);
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
    if (templateMode) return;
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
  }, [serverFlowId, templateMode]);

  const saveWorkingDraft = async (
    candidate: AcademicProcess,
    successMessage = "流程已暂存",
  ) => {
    if (!validateTimeSettings(candidate)) return null;
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
      showActionError(reason instanceof Error ? reason.message : "暂存失败");
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
    if (!validateTimeSettings(candidate)) return;
    setSaving(true);
    setActionNotice("");
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
      setActionNotice(templateMode ? "模板已更新" : candidate.published ? "重新发布成功" : "发布成功");
    } catch (reason) {
      const shouldReloadRevision =
        reason instanceof ApiError
          ? shouldReloadRevisionAfterConflict(reason.status, reason.message)
          : false;
      setRevisionImpact(null);
      setPendingPublishProcess(null);
      if (shouldReloadRevision) {
        showActionError("发布基准已变化，请重新预览影响");
        return;
      }
      showActionError(reason instanceof Error ? reason.message : "发布失败");
    } finally {
      setSaving(false);
    }
  };

  const preparePublish = async () => {
    const candidate = structuredClone(workingProcess);
    if (!validateTimeSettings(candidate)) return;
    setPublishIssue(null);
    const invalidBranch = candidate.nodes.find((node) => node.kind === "branch" && (
      (node.branches?.length ?? 0) < 2 || node.branches?.some((option) => !option.label.trim()
        || !candidate.edges.some((edge) => edge.source === node.id && edge.sourcePort === branchPort(option.id)))
    ));
    if (invalidBranch) {
      setActiveNodeId(invalidBranch.id);
      setInspectorNodeId(invalidBranch.id);
      showActionError("条件分支至少需要两个选项，请填写名称并为每个选项连接下游节点");
      return;
    }
    const invalidOrGate = candidate.nodes.find((node) => node.kind === "or_gate" && (
      new Set(candidate.edges.filter((edge) => edge.target === node.id).map((edge) => edge.source)).size < 2
      || !candidate.edges.some((edge) => edge.source === node.id)
    ));
    if (invalidOrGate) {
      setActiveNodeId(invalidOrGate.id);
      setInspectorNodeId(invalidOrGate.id);
      showActionError("或节点至少需要两个不同上游和一个下游");
      return;
    }
    const missingFileAudit = candidate.nodes.find((node) => ["file", "confirmation"].includes(node.kind) && fileReviewError(node));
    if (missingFileAudit) {
      setInspectorNodeId(missingFileAudit.id);
      showActionError(fileReviewError(missingFileAudit) ?? "请完善审核配置");
      return;
    }
    const invalidFormNode = candidate.nodes.find(
      (node) => node.kind === "form"
        && Object.keys(validateFormFieldConfig(node.infoFields)).length > 0,
    );
    if (invalidFormNode) {
      setActiveNodeId(invalidFormNode.id);
      setInspectorNodeId(invalidFormNode.id);
      showActionError("请先修正表单字段配置");
      return;
    }
    const publishSchedule = resolveFlowSchedule(candidate.nodes, candidate.edges ?? []);
    const publishDeadlines = publishSchedule.deadlines;
    const answerSheetIssue = getAnswerSheetPublishIssue(
      candidate.nodes.map((node) => ({ ...node, deadlineAt: publishDeadlines.get(node.id) })),
      candidate.answerSheetKeys,
    );
    if (answerSheetIssue) {
      setPublishIssue(answerSheetIssue);
      showActionError(answerSheetIssue.message);
      return;
    }
    if (!workingProcess.published) {
      await publishProcess(candidate);
      return;
    }

    setSaving(true);
    setActionNotice("");
    try {
      const impact = await workflowApi.getRevisionImpact(serverFlowId, candidate);
      setPendingPublishProcess(candidate);
      setRevisionImpact(impact);
    } catch (reason) {
      setPendingPublishProcess(null);
      showActionError(reason instanceof Error ? reason.message : "修订影响读取失败");
    } finally {
      setSaving(false);
    }
  };

  const handlePublishButtonClick = () => {
    if (templateMode) { void publishProcess(workingProcess); return; }
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
      setActionNotice("未检测到改动，已退出编辑");
      return;
    }
    void preparePublish();
  };

  const openPreview = async () => {
    if (!validateTimeSettings(workingProcess)) return;
    const auditIssue = workingProcess.nodes
      .map((node) => ({ message: getScanAuditConfigError(node), node }))
      .find((issue) => issue.message);
    if (auditIssue) {
      setActiveNodeId(auditIssue.node.id);
      setInspectorNodeId(auditIssue.node.id);
      showActionError(auditIssue.message ?? "请先修正扫描审核配置");
      return;
    }
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      showActionError("请允许本站打开新标签页");
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
      showActionError(reason instanceof Error ? reason.message : "预览创建失败");
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
    const answerSheetKeys = nextNode.kind === "answer_sheet" && nextNode.answerSheet
      ? {
          ...workingProcess.answerSheetKeys,
          [nextNode.id]: {
            answers: Object.fromEntries(nextNode.answerSheet.questions.map((question) => [
              question.id,
              createPrivateAnswer(question),
            ])),
            graderVersion: "answer-sheet-v3" as const,
            schemaVersion: "3.0" as const,
          },
        }
      : workingProcess.answerSheetKeys;
    const nextProcess = {
      ...workingProcess,
      answerSheetKeys,
      nodes: [...workingProcess.nodes, nextNode],
    };
    commitDesignChange(nextProcess);
    setActiveNodeId(nextNode.id);
  };

  const copyNode = async (nodeId: string): Promise<string | null> => {
    if (editorLocked || copyingNodeRef.current) return null;
    const source = workingProcess.nodes.find((node) => node.id === nodeId);
    if (!source) return null;
    copyingNodeRef.current = true;
    setCopyingNode(true);
    setActionError("");
    try {
      const copied = await workflowApi.copyNode(serverFlowId, source);
      const x = source.x + nodeSize.width + 40;
      let y = source.y;
      while (workingProcess.nodes.some((node) => Math.abs(node.x - x) < nodeSize.width + 20 && Math.abs(node.y - y) < nodeSize.height + 40)) {
        y += nodeSize.height + 40;
      }
      const nextNode = { ...copied, x, y };
      const key = workingProcess.answerSheetKeys[source.id];
      setWorkingProcess((current) => ({
        ...current,
        nodes: [...current.nodes, nextNode],
        answerSheetKeys: key ? { ...current.answerSheetKeys, [nextNode.id]: structuredClone(key) } : current.answerSheetKeys,
      }));
      setRevisionDirty(true);
      setActiveNodeId(nextNode.id);
      setActionNotice("节点已复制");
      return nextNode.id;
    } catch (reason) {
      showActionError(reason instanceof Error ? reason.message : "节点复制失败");
      return null;
    } finally {
      copyingNodeRef.current = false;
      setCopyingNode(false);
    }
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
      edges: nextValue.branches ? workingProcess.edges.filter((edge) => edge.source !== nodeId
        || nextValue.branches!.some((option) => edge.sourcePort === `branch:${option.id}`)) : workingProcess.edges,
      nodes: workingProcess.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...nextValue } : node,
      ),
    });
  };

  const updateAnnouncementRequirement = (
    nodeId: string,
    value: string | ((current: string) => string),
  ) => {
    if (announcementEditingLocked) return;
    setWorkingProcess((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId
        ? { ...node, requirement: typeof value === "function" ? value(node.requirement) : value }
        : node),
    }));
    setRevisionDirty(true);
  };

  const updateAnswerSheet = (
    nodeId: string,
    answerSheet: NonNullable<AcademicFlowNode["answerSheet"]>,
    gradingKey: AcademicProcess["answerSheetKeys"][string],
  ) => {
    if (editorLocked || protectedNodeIds.includes(nodeId)) return;
    setWorkingProcess((current) => ({
      ...current,
      answerSheetKeys: { ...current.answerSheetKeys, [nodeId]: gradingKey },
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, answerSheet } : node),
    }));
    setRevisionDirty(true);
  };

  const applyPublishedAuditPolicy = (
    nodeId: string,
    policy: NodeAuditPolicy,
  ) => {
    const params = policy.params;
    setWorkingProcess((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? {
        ...node,
        auditScriptParams: params,
        auditModelCardId: policy.modelCardId ?? undefined,
        scanAuditMode: params.scanAuditMode as "pass_fail" | "score" | undefined,
        scanAuditPrompt: typeof params.scanAuditPrompt === "string" ? params.scanAuditPrompt : node.scanAuditPrompt,
        scanAuditThreshold: typeof params.scanAuditThreshold === "number"
          ? params.scanAuditThreshold
          : undefined,
      } : node),
    }));
  };

  const applyPublishedAnswerKeyPolicy = (
    nodeId: string,
    policy: AnswerKeyPolicy,
  ) => {
    setWorkingProcess((current) => ({
      ...current,
      answerSheetKeys: {
        ...current.answerSheetKeys,
        [nodeId]: policy.gradingKey,
      },
    }));
    setActionNotice(
      `标准答案已更新，已重新判定 ${policy.regradedSubmissionCount ?? 0} 份答卷`,
    );
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
      showActionError("新增连线必须至少连接一个本次新增节点");
      return;
    }
    const sourceNode = workingProcess.nodes.find((node) => node.id === source);
    const targetNode = workingProcess.nodes.find((node) => node.id === target);
    if ((sourceNode?.kind === "branch" && !sourcePort.startsWith("branch:"))
      || (targetNode?.kind === "branch" && targetPort !== "top") || targetPort.startsWith("branch:")) {
      showActionError("请从分支选项的输出点连接到下游输入点");
      return;
    }
    const exists = processEdges.some((edge) => edge.source === source && edge.target === target && edge.sourcePort === sourcePort);
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

  const uploadNodeTemplate = async (nodeId: string, files: File[], reference = false, replaceAssetId?: string) => {
    if (reference && files.some((file) => !/\.(docx|pdf|png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name) || file.size === 0 || file.size > 50 * 1024 * 1024)) {
      showActionError("填写参考仅支持 DOCX、PDF 或图片，文件须非空且不超过 50 MB");
      return;
    }
    let candidate = workingProcess;
    if (revisionDirty) {
      const saved = await saveWorkingDraft(workingProcess, "");
      if (!saved) return;
      candidate = saved;
    }
    setSaving(true);
    setActionNotice("");
    try {
      for (const file of files) {
        const asset = reference
          ? (await workflowApi.uploadNodeReference(serverFlowId, nodeId, file, replaceAssetId)).referenceAsset
          : (await workflowApi.uploadNodeTemplate(serverFlowId, nodeId, file)).templateAsset;
        candidate = {
          ...candidate,
          nodes: candidate.nodes.map((node) => node.id !== nodeId ? node : reference
            ? { ...node, referenceAsset: null, referenceAssets: replaceAssetId
              ? nodeReferences(node).map((item) => item.assetId === replaceAssetId ? asset : item)
              : [...nodeReferences(node), asset] }
            : { ...node, templateAsset: asset }),
        };
        setWorkingProcess(candidate);
        setRevisionDirty(true);
      }
      const publishLabel = workingProcess.published ? "重新发布" : "发布";
      await saveWorkingDraft(candidate, `${reference ? "填写参考" : "模板"}已暂存，${publishLabel}后供学生下载`);
    } catch (reason) {
      showActionError(reason instanceof Error ? reason.message : "模板上传失败");
    } finally {
      setSaving(false);
    }
  };

  const uploadAnnouncementImage = async (nodeId: string, file: File) => {
    setAnnouncementUploads((count) => count + 1);
    try {
      if (!persistedNodeIds.current.has(nodeId)) {
        if (!pendingAnnouncementNodeSave.current) {
          pendingAnnouncementNodeSave.current = onSaveProcess(workingProcess).then((saved) => {
            onProcessChange(saved);
            setWorkingProcess((current) => ({
              ...current,
              draftConfig: saved.draftConfig,
              hasUnpublishedChanges: saved.hasUnpublishedChanges,
              serverId: saved.serverId,
            }));
            persistedNodeIds.current = new Set(saved.draftConfig.nodes.map((node) => node.id));
          }).finally(() => { pendingAnnouncementNodeSave.current = null; });
        }
        await pendingAnnouncementNodeSave.current;
      }
      return await workflowApi.uploadAnnouncementImage(serverFlowId, nodeId, file);
    } finally {
      setAnnouncementUploads((count) => count - 1);
    }
  };

  const deleteNodeTemplate = async (nodeId: string, assetId?: string) => {
    const reference = assetId !== undefined;
    setSaving(true);
    setActionNotice("");
    try {
      if (assetId !== undefined) await workflowApi.deleteNodeReference(serverFlowId, nodeId, assetId);
      else await workflowApi.deleteNodeTemplate(serverFlowId, nodeId);
      const nextProcess = {
        ...workingProcess,
        nodes: workingProcess.nodes.map((node) =>
          node.id !== nodeId ? node : reference
            ? { ...node, referenceAsset: null, referenceAssets: nodeReferences(node).filter((asset) => asset.assetId !== assetId) }
            : { ...node, templateAsset: null }
        ),
      };
      setWorkingProcess(nextProcess);
      setRevisionDirty(true);
      await saveWorkingDraft(nextProcess, reference ? "填写参考已删除" : "模板已删除");
    } catch (reason) {
      showActionError(reason instanceof Error ? reason.message : "模板删除失败");
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
    const answerSheetKeys = { ...workingProcess.answerSheetKeys };
    delete answerSheetKeys[nodeId];
    commitDesignChange({ ...workingProcess, answerSheetKeys, edges, nodes });
    setActiveNodeId(nodes[0]?.id ?? "");
    if (inspectorNodeId === nodeId) {
      setInspectorNodeId(null);
    }
  };

  return (
    <main className="academic-standalone-page designer-standalone-page">
      <AcademicStandaloneHeader
        currentLabel={workingProcess.name}
        parentLabel={templateMode ? "流程模板" : "教务流程"}
        onBack={() => requestNavigation(templateMode ? "模板列表" : "教务流程列表", onBack)}
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
          </div>
          <div className="academic-actions">
            {!templateMode ? <button onClick={() => setShowRoster(true)}>
              学生名单{rosterActiveCount === null ? "" : ` (${rosterActiveCount})`}
            </button> : null}
            <button disabled={operationLocked} onClick={() => void openPreview()} type="button">
              {previewCreating ? "正在创建预览" : "预览"}
            </button>
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
              disabled={templateMode ? operationLocked : publishButtonState.disabled}
              onClick={handlePublishButtonClick}
              title={templateMode ? "保存并更新模板库中的版本" : publishButtonState.title}
            >
              {templateMode ? (saving ? "正在更新…" : "更新模板") : publishButtonState.label}
            </button>
          </div>
        </header>
        <section className="flow-designer-grid">
          <ComponentPalette locked={editorLocked} onAddNode={addNode} />
          <FlowNodeCanvas
            timeIssues={timeIssues}
            timeFocus={timeFocus}
            actionNotice={actionNotice}
            actionNoticeTargetNodeId={
              publishIssue?.message === actionNotice ? publishIssue.nodeId : null
            }
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
            onCopyNode={copyNode}
            copyBlocked={inspectorNodeId !== null || showRoster || showProgress || manualReviewNodeId !== null || nodePackageDialogNodeId !== null}
            onConnectNodes={connectNodes}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
            onManualReview={setManualReviewNodeId}
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
            announcementEditingLocked={announcementEditingLocked}
            flowId={serverFlowId}
            nodeCoreLocked={!canEditRevisionNodeCore(inspectorNode.id, protectedNodeIds)}
            minimumDeadline={schedule.minimumDeadlines.get(inspectorNode.id) ?? null}
            node={inspectorNode}
            answerSheetKey={workingProcess.answerSheetKeys[inspectorNode.id]}
            onClose={() => { if (announcementUploads === 0) setInspectorNodeId(null); }}
            onDeleteTemplate={() => void deleteNodeTemplate(inspectorNode.id)}
            onUploadTemplate={(file) => void uploadNodeTemplate(inspectorNode.id, [file])}
            onUploadReference={(files, replaceAssetId) => void uploadNodeTemplate(inspectorNode.id, files, true, replaceAssetId)}
            onUploadAnnouncementImage={uploadAnnouncementImage}
            onUpdateAnnouncementRequirement={updateAnnouncementRequirement}
            onDeleteReference={(assetId) => void deleteNodeTemplate(inspectorNode.id, assetId)}
            onUpdateNode={updateNode}
            onUpdateAnswerSheet={updateAnswerSheet}
            onAuditPolicySaved={(policy) => applyPublishedAuditPolicy(inspectorNode.id, policy)}
            onAnswerKeyPolicySaved={(policy) => applyPublishedAnswerKeyPolicy(inspectorNode.id, policy)}
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
        {actionError ? <DesignerErrorDialog message={actionError} onClose={() => setActionError("")} /> : null}
        {manualReviewNodeId && workingProcess.publishedVersionId ? (hasSequentialManualReview(workingProcess.nodes.find((node) => node.id === manualReviewNodeId))
          ? <FileReviewDialog nodeKey={manualReviewNodeId} versionId={workingProcess.publishedVersionId} onClose={() => setManualReviewNodeId(null)} />
          : <ManualReviewDialog nodeKey={manualReviewNodeId} versionId={workingProcess.publishedVersionId} onClose={() => setManualReviewNodeId(null)} />) : null}
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

function AcademicStandaloneHeader({
  parentLabel = "教务流程",
  currentLabel,
  onBack,
}: {
  currentLabel?: string;
  parentLabel?: string;
  onBack: () => void;
}) {
  return (
    <header
      className={`academic-standalone-header${currentLabel ? " designer-header" : ""}`}
    >
      <button
        aria-label={`返回${parentLabel}`}
        className="academic-standalone-back"
        onClick={onBack}
        title={`返回${parentLabel}`}
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
            {parentLabel}
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
      <h3>流程节点</h3>
      <div className="node-template-list">
        {nodeTemplates.map((template) => (
          <button
            className={`node-template ${template.kind} node-function-colors`}
            data-node-kind={template.kind}
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
            <span aria-hidden="true"><FlowNodeIcon kind={template.kind} /></span>
            <strong>{template.title}</strong>
            <small>{template.description}</small>
          </button>
        ))}
      </div>
      <h3>流程控制</h3>
      <div className="node-template-list compact">
        <button className="node-function-colors" data-node-kind="branch" disabled={locked} type="button"
          draggable={!locked} onClick={() => onAddNode("branch", "条件分支")}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("application/x-academic-node-kind", "branch");
            event.dataTransfer.setData("application/x-academic-node-title", "条件分支");
          }}>
          <span aria-hidden="true">↳</span>
          <strong>条件分支</strong>
          <small>学生选择后进入对应流程</small>
        </button>
        <button className="node-function-colors" data-node-kind="or_gate" disabled={locked} type="button"
          draggable={!locked} onClick={() => onAddNode("or_gate", "或节点")}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("application/x-academic-node-kind", "or_gate");
            event.dataTransfer.setData("application/x-academic-node-title", "或节点");
          }}>
          <span aria-hidden="true"><FlowNodeIcon kind="or_gate" /></span>
          <strong>或节点</strong>
          <small>任一上游通过即可继续</small>
        </button>
      </div>
      <div className="palette-hint">
        提示：可将组件拖入画布，节点进入画布后可拖动定位，并通过上下连接点手动连线。
      </div>
    </aside>
  );
}

function FlowNodeCanvas({
  timeIssues,
  timeFocus,
  actionNotice,
  actionNoticeTargetNodeId,
  activeNodeId,
  canDeleteEdge,
  canDeleteNode,
  canMoveNode,
  edges,
  locked,
  nodeMovementLocked,
  nodes,
  onAddNode,
  onCopyNode,
  copyBlocked,
  onConnectNodes,
  onDeleteEdge,
  onDeleteNode,
  onManualReview,
  onDownloadNodePackage,
  onOpenInspector,
  onSelectNode,
  onUpdateNodePositions,
  publishedNodeIds,
}: {
  timeIssues: Map<string, string>;
  timeFocus: { nodeId: string; attempt: number } | null;
  onCopyNode: (nodeId: string) => Promise<string | null>;
  copyBlocked: boolean;
  actionNotice: string;
  actionNoticeTargetNodeId: string | null;
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
  onManualReview: (nodeId: string) => void;
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
  const connectionPointerRef = useRef<CanvasPoint | null>(null);
  const connectionPreviewPortRef = useRef<AcademicFlowPort | null>(null);
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
  const [controlPressed, setControlPressed] = useState(false);
  const marqueeStartRef = useRef<(CanvasPoint & { pointerId: number }) | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const cancelMarquee = useCallback(() => {
    const start = marqueeStartRef.current;
    marqueeStartRef.current = null;
    setSelectionBox(null);
    if (start && canvasRef.current?.hasPointerCapture(start.pointerId)) {
      canvasRef.current.releasePointerCapture(start.pointerId);
    }
  }, []);
  useEffect(() => {
    const updateModifier = (event: KeyboardEvent) => {
      setControlPressed(isCanvasControlModifierActive(event));
      if (event.key === "Escape" && !isCanvasKeyboardEditingTarget(event.target)
        && !document.querySelector('[role="dialog"], dialog[open], [role="alertdialog"]')) {
        cancelMarquee();
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(null);
        connectingFromRef.current = null;
        setConnectingFrom(null);
        setConnectionPreviewPoint(null);
      }
    };
    const blur = () => { setControlPressed(false); cancelMarquee(); };
    window.addEventListener("keydown", updateModifier);
    window.addEventListener("keyup", updateModifier);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", updateModifier);
      window.removeEventListener("keyup", updateModifier);
      window.removeEventListener("blur", blur);
    };
  }, [cancelMarquee]);
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState | null>(null);
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.5);
  useEffect(() => {
    if (!timeFocus) return;
    const element = nodeElementsRef.current.get(timeFocus.nodeId);
    if (!element) return;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const animation = element.animate([0, -8, 8, -6, 6, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 500 });
      return () => animation.cancel();
    }
  }, [timeFocus]);

  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
  const cancelZoomEditRef = useRef(false);

  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  const zoomMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!zoomMenuOpen) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !zoomMenuRef.current?.contains(event.target)) setZoomMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setZoomMenuOpen(false); zoomMenuButtonRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [zoomMenuOpen]);

  const applyZoom = (value: number) => {
    if (Number.isFinite(value) && canvasRef.current && canvasSurfaceRef.current) {
      const nextZoom = Math.min(1.5, Math.max(0.25, value));
      const viewport = canvasRef.current.getBoundingClientRect();
      const surface = canvasSurfaceRef.current.getBoundingClientRect();
      const x = viewport.left + viewport.width / 2 - surface.left;
      const y = viewport.top + viewport.height / 2 - surface.top;
      setViewportOffset(current => ({
        x: current.x + x * (1 - nextZoom / zoom),
        y: current.y + y * (1 - nextZoom / zoom),
      }));
      setZoom(nextZoom);
    }
  };
  const applyZoomDraft = () => {
    if (!cancelZoomEditRef.current && zoomDraft?.trim()) applyZoom(Number(zoomDraft) / 100);
    setZoomDraft(null);
  };
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    () => new Set(activeNodeId ? [activeNodeId] : []),
  );
  useEffect(() => {
    const duplicateSelectedNode = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "d" || !(event.ctrlKey || event.metaKey)
        || event.altKey || event.shiftKey || locked || copyBlocked
        || selectedNodeIds.size !== 1 || isCanvasKeyboardEditingTarget(event.target)
        || document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      if (event.repeat) return;
      const nodeId = [...selectedNodeIds][0];
      void onCopyNode(nodeId).then((newId) => {
        setSelectedNodeIds(new Set([newId ?? nodeId]));
        if (newId) requestAnimationFrame(() => {
          nodeElementsRef.current.get(newId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
      });
    };
    window.addEventListener("keydown", duplicateSelectedNode);
    return () => window.removeEventListener("keydown", duplicateSelectedNode);
  }, [locked, copyBlocked, selectedNodeIds, onCopyNode]);
  const [draggingNodes, setDraggingNodes] = useState<NodeGroupDrag | null>(null);
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({});
  const nodeIdKey = nodes.map((node) => node.id).join("|");
  const publishedNodeIdSet = useMemo(() => new Set(publishedNodeIds), [publishedNodeIds]);
  const registerNodeElement = useCallback((nodeId: string, element: HTMLButtonElement | null) => {
    if (element) nodeElementsRef.current.set(nodeId, element);
    else nodeElementsRef.current.delete(nodeId);
  }, []);

  useEffect(() => {
    const closeContextMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNodeContextMenu(null);
    };
    const closeContextMenuOnBlur = () => setNodeContextMenu(null);
    window.addEventListener("keydown", closeContextMenuOnEscape);
    window.addEventListener("blur", closeContextMenuOnBlur);
    return () => {
      window.removeEventListener("keydown", closeContextMenuOnEscape);
      window.removeEventListener("blur", closeContextMenuOnBlur);
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
    cancelMarquee();
    connectingFromRef.current = null;
    connectionPointerRef.current = null;
    connectionPreviewPortRef.current = null;
    setConnectingFrom(null);
    setConnectionPreviewPoint(null);
    setConnectionPreviewPort(null);
    setDraggingNodes(null);
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    setNodeContextMenu(null);
  }, [locked, cancelMarquee]);

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
      branches: node.branches,
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
        || isCanvasControlModifierActive(event)
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
    if (!canvasSurfaceRef.current || marqueeStartRef.current) return;
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
    return bindCanvasZoomWheelListener(canvas, zoomCanvas);
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
        const ports = nodePorts(node).filter((port) => !port.startsWith("branch:")).map((port) => {
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
    if (isCanvasControlModifierActive(event)) {
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
    connectionPointerRef.current = null;
    connectionPreviewPortRef.current = null;
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
    connectionPointerRef.current = { x: clientX, y: clientY };
    const point = getCanvasPoint(clientX, clientY);
    const magnetTarget = findMagnetTarget(point, source.nodeId);
    connectionPreviewPortRef.current = magnetTarget?.port ?? null;
    setConnectionPreviewPoint(magnetTarget?.point ?? point);
    setConnectionPreviewPort(magnetTarget?.port ?? null);
  };

  useEffect(() => {
    if (!connectingFrom || locked || panStart) return;
    let frameId = 0;
    const autoPanConnection = () => {
      const canvas = canvasRef.current;
      const pointer = connectionPointerRef.current;
      if (canvas && pointer && !connectionPreviewPortRef.current) {
        const rect = canvas.getBoundingClientRect();
        const delta = getCanvasEdgePanDelta({
          bounds: {
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            top: rect.top,
          },
          clientX: pointer.x,
          clientY: pointer.y,
          edgeSize: connectionEdgePanSize,
          maxStep: connectionEdgePanMaxStep,
        });
        if (delta.x !== 0 || delta.y !== 0) {
          setViewportOffset((current) => ({
            x: current.x + delta.x,
            y: current.y + delta.y,
          }));
          setConnectionPreviewPoint((current) => current ? ({
            x: current.x - delta.x / zoom,
            y: current.y - delta.y / zoom,
          }) : current);
        }
      }
      frameId = window.requestAnimationFrame(autoPanConnection);
    };
    frameId = window.requestAnimationFrame(autoPanConnection);
    return () => window.cancelAnimationFrame(frameId);
  }, [connectingFrom, locked, panStart, zoom]);

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
    if (marqueeStartRef.current) return;
    const target = event.target;
    const blankCanvas = target instanceof Element && !target.closest(
      ".flow-node, .connection-port, .flow-edge-hitbox, .flow-edge-delete, .node-context-menu, button, input, [role='menu']",
    );
    if (event.button === 0 && blankCanvas && !isCanvasControlModifierActive(event)) {
      setSelectedNodeIds(new Set());
      setSelectedEdgeId(null);
    }
    if (event.button === 0 && blankCanvas && !locked && !connectingFromRef.current && isCanvasControlModifierActive(event)) {
      event.preventDefault();
      const start = getCanvasPoint(event.clientX, event.clientY);
      marqueeStartRef.current = { ...start, pointerId: event.pointerId };
      setSelectionBox({ left: start.x, top: start.y, width: 0, height: 0 });
      setNodeContextMenu(null);
      setSelectedEdgeId(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (
      (event.button === 0 && blankCanvas && !connectingFromRef.current)
      || (isCanvasControlModifierActive(event)
      && shouldStartCanvasPan({ button: event.button }))
    ) {
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
  };

  const moveCanvasPointer = (event: PointerEvent<HTMLDivElement>) => {
    const start = marqueeStartRef.current;
    if (start) {
      if (event.pointerId !== start.pointerId) return;
      const point = getCanvasPoint(event.clientX, event.clientY);
      setSelectionBox({ left: Math.min(start.x, point.x), top: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) });
      return;
    }
    if (panStart) {
      setViewportOffset(getCanvasPanOffset(panStart, event));
      return;
    }
    updateConnectionPreview(event.clientX, event.clientY);
  };

  const endCanvasPointer = (event: PointerEvent<HTMLDivElement>) => {
    const start = marqueeStartRef.current;
    if (start) {
      if (event.pointerId !== start.pointerId) return;
      const point = getCanvasPoint(event.clientX, event.clientY);
      const left = Math.min(start.x, point.x);
      const top = Math.min(start.y, point.y);
      const right = Math.max(start.x, point.x);
      const bottom = Math.max(start.y, point.y);
      const selected = layoutNodes.filter((node) => right > left && bottom > top
        && node.x < right && node.x + nodeSize.width > left
        && node.y < bottom && node.y + node.renderedHeight > top);
      setSelectedNodeIds(new Set(selected.map((node) => node.id)));
      if (selected[0]) onSelectNode(selected[0].id);
      cancelMarquee();
      return;
    }
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
    cancelMarquee();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanStart(null);
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
  const canvasSurfaceWidth = Math.max(
    canvasMinimumSize.width,
    ...layoutNodes.map((node) => node.x + nodeSize.width + canvasConnectionPadding),
    connectionPreviewPoint ? connectionPreviewPoint.x + canvasConnectionPadding : 0,
  );
  const canvasSurfaceHeight = Math.max(
    canvasMinimumSize.height,
    ...layoutNodes.map(
      (node) => node.y + node.renderedHeight + canvasConnectionPadding,
    ),
    connectionPreviewPoint ? connectionPreviewPoint.y + canvasConnectionPadding : 0,
  );
  return (
    <section className="flow-panel canvas-panel">
      <div className="panel-heading canvas-panel-heading">
        <div className="canvas-heading-summary">
          <h2>流程画布</h2>
          {selectedNodeIds.size > 0 && <span className="canvas-selection-count" role="status">已选 {selectedNodeIds.size} 个节点 · Esc 取消</span>}
          {actionNotice ? (
            <p className="academic-action-notice" title={actionNotice}>
              <span className="academic-action-notice-text">{actionNotice}</span>
              {actionNoticeTargetNodeId ? (
                <button
                  onClick={() => {
                    onSelectNode(actionNoticeTargetNodeId);
                    onOpenInspector(actionNoticeTargetNodeId);
                  }}
                  type="button"
                >
                  前往修正
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="canvas-toolbar">
          <div className="canvas-tool-group" role="group" aria-label="画布缩放">
          <button type="button" aria-label="缩小" title="缩小 10%" disabled={zoom <= .25} onClick={() => applyZoom(Math.round(zoom * 100 - 10) / 100)}>−</button>
          {zoomDraft === null ? (
            <button className="canvas-zoom-value" type="button" title="修改缩放比例（25%–150%）" onClick={() => {
              cancelZoomEditRef.current = false;
              setZoomDraft(String(Math.round(zoom * 100)));
            }}>{Math.round(zoom * 100)}%</button>
          ) : (
            <label className="canvas-zoom-editor">
              <input autoFocus aria-label="缩放百分比" type="text" inputMode="decimal"
                value={zoomDraft} onFocus={event => event.currentTarget.select()}
                onChange={event => setZoomDraft(event.target.value)} onBlur={applyZoomDraft}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelZoomEditRef.current = event.key === "Escape";
                    event.currentTarget.blur();
                  }
                }} />
              <span>%</span>
            </label>
          )}
          <div className="canvas-zoom-presets" ref={zoomMenuRef}>
            <button type="button" ref={zoomMenuButtonRef} aria-label="快捷缩放比例" aria-expanded={zoomMenuOpen} title="快捷比例" onClick={() => setZoomMenuOpen(!zoomMenuOpen)}>⌄</button>
            {zoomMenuOpen && <div className="canvas-zoom-menu" role="group" aria-label="快捷缩放比例">
              {[25, 50, 75, 100, 150].map(value => <button key={value} type="button" className={Math.round(zoom * 100) === value ? "active" : ""} aria-pressed={Math.round(zoom * 100) === value} onClick={() => { applyZoom(value / 100); setZoomMenuOpen(false); zoomMenuButtonRef.current?.focus(); }}>{value}%</button>)}
            </div>}
          </div>
          <button type="button" aria-label="放大" title="放大 10%" disabled={zoom >= 1.5} onClick={() => applyZoom(Math.round(zoom * 100 + 10) / 100)}>＋</button>
          </div>
        </div>
      </div>
      <div
        className={`flow-canvas dag-canvas ${panStart ? "is-panning" : ""} ${selectionBox ? "is-selecting" : ""} ${controlPressed ? "is-control-pressed" : ""}`}
        onContextMenu={(event) => {
          event.preventDefault();
          if (
            isCanvasControlModifierActive(event)
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
        onPointerEnter={(event) => setControlPressed(isCanvasControlModifierActive(event))}
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
            width: canvasSurfaceWidth * zoom,
          }}
        >
          <div
            className="canvas-zoom-content"
            style={{
              height: canvasSurfaceHeight,
              transform: `scale(${zoom})`,
              width: canvasSurfaceWidth,
            }}
          >
            {selectionBox ? <div className="canvas-selection-box" style={selectionBox} aria-hidden="true" /> : null}
            <svg
              className="flow-edge-layer"
              style={{ height: canvasSurfaceHeight, width: canvasSurfaceWidth }}
            >
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
              className={`flow-node node-function-colors ${node.status} ${
                canMoveNode(node.id) ? "movable" : "protected"
              } ${selectedNodeIds.has(node.id) ? "selected" : ""} ${timeIssues.has(node.id) ? "has-time-error" : ""}`}
              data-node-kind={node.kind}
              data-flow-node-id={node.id}
              onClick={(event) => {
                if (
                  isCanvasControlModifierActive(event)
                  || selectedNodeIds.has(node.id)
                ) return;
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
              {timeIssues.has(node.id) && <span className="flow-node-time-warning" role="img" aria-label={timeIssues.get(node.id)} title={timeIssues.get(node.id)}>!</span>}
              {!locked && nodePorts(node).map((port) => (
                <span
                  className={`connection-port ${port.startsWith("branch:") ? "bottom branch-port" : port} ${
                    connectingFrom && connectingFrom.nodeId !== node.id ? "connectable" : ""
                  } ${connectingFrom?.nodeId === node.id && connectingFrom.port === port ? "connecting" : ""}`}
                  style={port.startsWith("branch:") ? { left: `${branchPortFraction(node.branches, port) * 100}%` } : undefined}
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
                    updateConnectionPreview(event.clientX, event.clientY);
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
              {locked && node.kind === "branch" ? <>
                <span className="branch-static-port top" />
                {node.branches?.map((option) => <span className="branch-static-port bottom" key={option.id}
                  style={{ left: `${branchPortFraction(node.branches, branchPort(option.id)) * 100}%` }} />)}
              </> : null}
              <span className="flow-node-heading"><span className="flow-node-kind-icon" aria-hidden="true"><FlowNodeIcon kind={node.kind} /></span><strong>{node.title}</strong></span>
              {node.kind === "branch" ? <>
                <span className="branch-node-caption">单选 · {node.branches?.length ?? 0} 个分支</span>
                <span className="branch-node-options">{node.branches?.map((option) => <span key={option.id} title={option.label} style={{ left: `${branchPortFraction(node.branches, branchPort(option.id)) * 100}%`, width: `${90 / ((node.branches?.length ?? 0) + 1)}%` }}>{option.label}</span>)}</span>
              </> : null}
              {node.kind === "or_gate" ? <span className="branch-node-caption">任一上游通过即可继续</span> : null}
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
            {hasSequentialManualReview(nodeById.get(nodeContextMenu.nodeId)) ? <button
              disabled={!publishedNodeIdSet.has(nodeContextMenu.nodeId)} role="menuitem" type="button"
              onClick={() => { onManualReview(nodeContextMenu.nodeId); setNodeContextMenu(null); }}>
              <span aria-hidden="true">✓</span><strong>审核</strong>
              {!publishedNodeIdSet.has(nodeContextMenu.nodeId) ? <small>发布后可审核</small> : null}
            </button> : null}
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
  minimumDeadline,
  answerSheetKey,
  editingLocked,
  announcementEditingLocked,
  flowId,
  nodeCoreLocked,
  node,
  onClose,
  onDeleteTemplate,
  onUploadTemplate,
  onUploadReference,
  onUploadAnnouncementImage,
  onUpdateAnnouncementRequirement,
  onDeleteReference,
  onUpdateNode,
  onUpdateAnswerSheet,
  onAnswerKeyPolicySaved,
  onAuditPolicySaved,
  publishedAuditPolicy,
  publishedRevision,
}: {
  minimumDeadline: string | null;
  answerSheetKey?: AcademicProcess["answerSheetKeys"][string];
  editingLocked: boolean;
  announcementEditingLocked: boolean;
  flowId: string;
  nodeCoreLocked: boolean;
  node: AcademicFlowNode | null;
  onClose: () => void;
  onDeleteTemplate: () => void;
  onUploadTemplate: (file: File) => void;
  onUploadReference: (files: File[], replaceAssetId?: string) => void;
  onUploadAnnouncementImage: (nodeId: string, file: File) => Promise<{ assetId: string }>;
  onUpdateAnnouncementRequirement: (
    nodeId: string,
    value: string | ((current: string) => string),
  ) => void;
  onDeleteReference: (assetId: string) => void;
  onUpdateNode: (nodeId: string, value: Partial<AcademicFlowNode>) => void;
  onUpdateAnswerSheet: (
    nodeId: string,
    config: NonNullable<AcademicFlowNode["answerSheet"]>,
    gradingKey: AcademicProcess["answerSheetKeys"][string],
  ) => void;
  onAnswerKeyPolicySaved: (policy: AnswerKeyPolicy) => void;
  onAuditPolicySaved: (policy: NodeAuditPolicy) => void;
  publishedAuditPolicy: boolean;
  publishedRevision: boolean;
}) {
  const [timeSettingsOpen, setTimeSettingsOpen] = useState(false);
  const [auditPolicy, setAuditPolicy] = useState<NodeAuditPolicy | null>(null);
  const [auditPolicyParams, setAuditPolicyParams] = useState<Record<string, string | number | boolean>>({});
  const [auditModelCardId, setAuditModelCardId] = useState<string | null>(null);
  const [modelValidationAttempt, setModelValidationAttempt] = useState(0);
  const [auditPolicyError, setAuditPolicyError] = useState("");
  const [auditPolicySaving, setAuditPolicySaving] = useState(false);
  const [reviewStepPolicy, setReviewStepPolicy] = useState<ReviewStepPolicy | null>(null);
  const [reviewStepDraft, setReviewStepDraft] = useState<FileReviewStep[]>([]);
  const [answerKeyPolicy, setAnswerKeyPolicy] = useState<AnswerKeyPolicy | null>(null);
  const [answerKeyDraft, setAnswerKeyDraft] = useState<AcademicProcess["answerSheetKeys"][string] | null>(null);
  const [answerKeyError, setAnswerKeyError] = useState("");
  const [answerKeySaving, setAnswerKeySaving] = useState(false);
  const [answerKeyConfirmOpen, setAnswerKeyConfirmOpen] = useState(false);
  const nodeKey = node?.id ?? "";
  const hasPublishedAuditPolicy = Boolean(
    publishedAuditPolicy && node && (node.auditScriptId || node.scanAuditEnabled),
  );
  const hasPublishedReviewStepPolicy = Boolean(
    publishedAuditPolicy && node?.fileReviewSteps?.some((step) => typeof step === "object" && step.kind !== "manual"),
  );
  const hasPublishedAnswerKeyPolicy = Boolean(
    publishedAuditPolicy && node?.kind === "answer_sheet",
  );

  useEffect(() => {
    setAuditPolicy(null);
    setModelValidationAttempt(0);
    setAuditPolicyParams({});
    setAuditModelCardId(null);
    setAuditPolicyError("");
    setAuditPolicySaving(false);
    if (!hasPublishedAuditPolicy) return;
    let cancelled = false;
    workflowApi.getNodeAuditPolicy(flowId, nodeKey).then((value) => {
      if (cancelled) return;
      setAuditPolicy(value);
      setAuditPolicyParams(value.params);
      setAuditModelCardId(value.modelCardId);
    }).catch((reason) => {
      if (!cancelled) {
        setAuditPolicyError(reason instanceof Error ? reason.message : "读取审核规则失败");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [flowId, hasPublishedAuditPolicy, nodeKey]);

  useEffect(() => {
    setReviewStepPolicy(null);
    setReviewStepDraft([]);
    if (!hasPublishedReviewStepPolicy) return;
    let cancelled = false;
    workflowApi.getReviewStepPolicy(flowId, nodeKey).then((value) => {
      if (cancelled) return;
      setReviewStepPolicy(value);
      setReviewStepDraft(value.steps);
      setAuditPolicyError("");
    }).catch((reason) => {
      if (!cancelled) setAuditPolicyError(reason instanceof Error ? reason.message : "读取审核步骤失败");
    });
    return () => { cancelled = true; };
  }, [flowId, hasPublishedReviewStepPolicy, nodeKey]);

  useEffect(() => {
    setAnswerKeyPolicy(null);
    setAnswerKeyDraft(null);
    setAnswerKeyError("");
    setAnswerKeySaving(false);
    setAnswerKeyConfirmOpen(false);
    if (!hasPublishedAnswerKeyPolicy) return;
    let cancelled = false;
    workflowApi.getNodeAnswerKeyPolicy(flowId, nodeKey).then((value) => {
      if (cancelled) return;
      setAnswerKeyPolicy(value);
      setAnswerKeyDraft(value.gradingKey);
    }).catch((reason) => {
      if (!cancelled) {
        setAnswerKeyError(reason instanceof Error ? reason.message : "读取标准答案失败");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [flowId, hasPublishedAnswerKeyPolicy, nodeKey]);

  const auditPolicyFieldErrors = auditPolicy ? Object.fromEntries(
    auditPolicy.parameters.filter((parameter) => (
      parameter.key !== "scanAuditThreshold" || auditPolicyParams.scanAuditMode === "score"
    )).map((parameter) => [
      parameter.key,
      getAuditScriptParameterError(parameter, auditPolicyParams[parameter.key]),
    ]).filter(([, value]) => value),
  ) as Record<string, string> : {};
  const auditPolicyChanged = Boolean(auditPolicy && (
    auditModelCardId !== auditPolicy.modelCardId || auditPolicy.parameters.some(
      (parameter) => auditPolicyParams[parameter.key] !== auditPolicy.params[parameter.key],
    )
  ));
  const reviewStepChanged = Boolean(reviewStepPolicy && reviewStepDraft.some((step, index) => (
    step.kind !== "manual" && (
      JSON.stringify(step.auditScriptParams ?? {}) !== JSON.stringify(reviewStepPolicy.steps[index]?.auditScriptParams ?? {})
      || (step.auditModelCardId ?? null) !== (reviewStepPolicy.steps[index]?.auditModelCardId ?? null)
    )
  )));
  const answerKeyChanged = Boolean(
    answerKeyPolicy
    && answerKeyDraft
    && JSON.stringify(answerKeyDraft) !== JSON.stringify(answerKeyPolicy.gradingKey)
  );

  const requiresAuditModel = Boolean(node?.kind === "confirmation" && node.scanAuditEnabled);
  const missingAuditModel = requiresAuditModel && !(hasPublishedAuditPolicy ? auditModelCardId : node?.auditModelCardId);

  const persistPoliciesAndClose = useCallback(async (saveAnswerKey: boolean) => {
    setAuditPolicySaving(auditPolicyChanged || reviewStepChanged);
    setAnswerKeySaving(saveAnswerKey && answerKeyChanged);
    setAuditPolicyError("");
    setAnswerKeyError("");
    let answerKeySaved = false;
    try {
      if (saveAnswerKey && answerKeyChanged && answerKeyPolicy && answerKeyDraft) {
        const updatedAnswerKey = await workflowApi.updateNodeAnswerKeyPolicy(flowId, nodeKey, {
          expectedGeneration: answerKeyPolicy.generation,
          gradingKey: answerKeyDraft,
        });
        setAnswerKeyPolicy(updatedAnswerKey);
        setAnswerKeyDraft(updatedAnswerKey.gradingKey);
        onAnswerKeyPolicySaved(updatedAnswerKey);
        answerKeySaved = true;
      }
      if (hasPublishedAuditPolicy && auditPolicy && auditPolicyChanged) {
        const updatedAuditPolicy = await workflowApi.updateNodeAuditPolicy(flowId, nodeKey, {
          modelCardId: auditModelCardId,
          expectedGeneration: auditPolicy.generation,
          params: auditPolicyParams,
        });
        setAuditPolicy(updatedAuditPolicy);
        onAuditPolicySaved(updatedAuditPolicy);
      }
      if (hasPublishedReviewStepPolicy && reviewStepPolicy && reviewStepChanged) {
        const updatedReviewSteps = await workflowApi.updateReviewStepPolicy(flowId, nodeKey, {
          expectedGeneration: reviewStepPolicy.generation,
          steps: reviewStepDraft.filter((step) => step.kind !== "manual").map((step) => ({
            id: step.id,
            auditScriptParams: step.auditScriptParams ?? {},
            auditModelCardId: step.auditModelCardId,
          })),
        });
        setReviewStepPolicy(updatedReviewSteps);
        setReviewStepDraft(updatedReviewSteps.steps);
      }
      onClose();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "保存节点配置失败";
      if (saveAnswerKey && answerKeyChanged && !answerKeySaved) setAnswerKeyError(message);
      else setAuditPolicyError(message);
    } finally {
      setAuditPolicySaving(false);
      setAnswerKeySaving(false);
      setAnswerKeyConfirmOpen(false);
    }
  }, [
    answerKeyChanged,
    answerKeyDraft,
    answerKeyPolicy,
    auditModelCardId,
    auditPolicy,
    auditPolicyChanged,
    auditPolicyParams,
    hasPublishedReviewStepPolicy,
    reviewStepChanged,
    reviewStepDraft,
    reviewStepPolicy,
    flowId,
    hasPublishedAuditPolicy,
    nodeKey,
    onAnswerKeyPolicySaved,
    onAuditPolicySaved,
    onClose,
  ]);

  const closeInspector = useCallback(async (requireModel = false) => {
    if (auditPolicySaving || answerKeySaving) return;
    if (requireModel && hasPublishedAnswerKeyPolicy && !answerKeyPolicy) return;
    if (requireModel && hasPublishedAuditPolicy && !auditPolicy) return;
    if (requireModel && hasPublishedReviewStepPolicy && !reviewStepPolicy) return;
    if (requireModel && node && ["file", "confirmation"].includes(node.kind)) {
      const reviewNode = hasPublishedReviewStepPolicy && reviewStepPolicy
        ? { ...node, fileReviewSteps: reviewStepDraft }
        : hasPublishedAuditPolicy ? { ...node, auditModelCardId: auditModelCardId ?? undefined } : node;
      const error = fileReviewError(reviewNode);
      if (error) {
        setAuditPolicyError(error);
        return;
      }
    }
    if (requireModel && missingAuditModel) {
      setModelValidationAttempt((current) => current + 1);
      return;
    }
    if (hasPublishedAuditPolicy && auditPolicy && auditPolicyChanged) {
      const validationError = Object.values(auditPolicyFieldErrors)[0];
      if (validationError) {
        setAuditPolicyError(`请先修正审核规则：${validationError}`);
        return;
      }
    }
    if (answerKeyChanged) {
      setAnswerKeyConfirmOpen(true);
      return;
    }
    await persistPoliciesAndClose(false);
  }, [
    answerKeyChanged,
    answerKeyPolicy,
    answerKeySaving,
    auditPolicy,
    auditPolicyChanged,
    node,
    missingAuditModel,
    auditPolicyFieldErrors,
    auditPolicyParams,
    auditModelCardId,
    auditPolicySaving,
    hasPublishedAnswerKeyPolicy,
    hasPublishedAuditPolicy,
    hasPublishedReviewStepPolicy,
    reviewStepDraft,
    reviewStepPolicy,
    persistPoliciesAndClose,
  ]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (answerKeyConfirmOpen) {
        if (!answerKeySaving) setAnswerKeyConfirmOpen(false);
        return;
      }
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
  }, [answerKeyConfirmOpen, answerKeySaving, closeInspector, timeSettingsOpen]);

  if (!node) {
    return null;
  }

  const coreSettingsDisabled = editingLocked || nodeCoreLocked;
  const materialSettingsDisabled = editingLocked || (nodeCoreLocked && node.kind !== "file");
  const auditControlsNode: AcademicFlowNode = reviewStepPolicy ? {
    ...node,
    fileReviewSteps: reviewStepDraft,
  } : auditPolicy ? {
    ...node,
    auditScriptParams: auditPolicyParams,
    auditModelCardId: auditModelCardId ?? undefined,
    scanAuditMode: auditPolicyParams.scanAuditMode as "pass_fail" | "score" | undefined,
    scanAuditPrompt: typeof auditPolicyParams.scanAuditPrompt === "string"
      ? auditPolicyParams.scanAuditPrompt
      : node.scanAuditPrompt,
    scanAuditThreshold: typeof auditPolicyParams.scanAuditThreshold === "number"
      ? auditPolicyParams.scanAuditThreshold
      : undefined,
  } : node;
  const updateAuditPolicyParameter = (
    key: string,
    value: string | number | boolean | undefined,
  ) => {
    setAuditPolicyError("");
    setAuditPolicyParams((current) => {
      if (value !== undefined) return { ...current, [key]: value };
      const next = { ...current };
      delete next[key];
      return next;
    });
  };
  const settingCapabilities = getNodeSettingCapabilities(node.kind);
  const timeSettingsLabel = getTimeSettingsLabel(node);
  const fileTypeRestrictionPreset = getFileTypeRestrictionPreset(node.fileExtensions);
  const hasFileTypeRestriction = node.fileExtensions.trim().length > 0;
  const stepExtensions = node.kind === "file" ? fileReviewSteps(node).filter((step) => step.kind !== "manual" && step.auditScriptAcceptedExtensions?.length).map((step) => step.auditScriptAcceptedExtensions!) : [];
  const effectiveExtensions = stepExtensions.length ? stepExtensions[0].filter((ext) => stepExtensions.every((list) => list.includes(ext))) : node.auditScriptAcceptedExtensions;
  const scriptLocksFileTypes = Boolean(effectiveExtensions?.length);
  const lockedFileTypeLabel = (effectiveExtensions ?? [])
    .map((extension) => extension.replace(/^\./, "").toUpperCase())
    .join(" · ");

  return (
    <div className="node-inspector-backdrop">
      <aside
        aria-modal="true"
        className="flow-panel inspector-panel node-inspector-modal"
        role="dialog"
      >
        <div className="node-inspector-fields">
        <header className="node-inspector-toolbar">
          <label className="node-basic-title-field" title={editingLocked ? undefined : "点击修改节点标题"}>
              <input
                aria-label="节点标题"
                disabled={editingLocked}
                maxLength={50}
                placeholder="请添加标题"
                value={node.title}
                onChange={(event) => onUpdateNode(node.id, { title: event.target.value })}
              />
          </label>
          <button
            aria-label="关闭节点设置"
            disabled={auditPolicySaving || (hasPublishedAuditPolicy && !auditPolicy)}
            onClick={() => void closeInspector(true)}
            type="button"
          >
            ×
          </button>
        </header>
        {node.kind === "announcement" ? (
          <AnnouncementEditor
            disabled={announcementEditingLocked}
            flowId={flowId}
            key={node.id}
            nodeId={node.id}
            onChange={(requirement) => onUpdateAnnouncementRequirement(node.id, requirement)}
            onUpload={onUploadAnnouncementImage}
            value={node.requirement}
          />
        ) : (
          <label className="node-basic-description-field" title={editingLocked ? undefined : "点击修改节点说明"}>
            <textarea
              aria-label="节点说明"
              rows={2}
              disabled={editingLocked}
              placeholder="添加描述"
              value={node.requirement}
              onChange={(event) => onUpdateNode(node.id, { requirement: event.target.value })}
            />
          </label>
        )}
        {node.kind !== "branch" && node.kind !== "or_gate" ? <div className="node-basic-actions">
          <button
            aria-haspopup="dialog"
            className="node-time-settings-toggle"
            disabled={editingLocked}
            onClick={() => setTimeSettingsOpen(true)}
            type="button"
          >
            <span aria-hidden="true">
              {timeSettingsLabel === "定时设置" ? "＋" : "◷"}
            </span>
            {timeSettingsLabel}
          </button>
        {node.kind === "confirmation" && node.scanAuditEnabled ? (
          <NodeModelSelector
            validationAttempt={missingAuditModel ? modelValidationAttempt : 0}
            value={hasPublishedAuditPolicy ? auditModelCardId : node.auditModelCardId ?? null}
            disabled={hasPublishedAuditPolicy ? !auditPolicy || auditPolicySaving : coreSettingsDisabled}
            onChange={(cardId) => {
              if (hasPublishedAuditPolicy) {
                setAuditPolicyError("");
                setAuditModelCardId(cardId);
              } else {
                onUpdateNode(node.id, { auditModelCardId: cardId ?? undefined });
              }
            }}
          />
        ) : null}
          {node.startAt || node.deadlineAt ? (
            <small>{getTimeWindowStatus(node)}</small>
          ) : null}
        </div> : <p className="branch-activation-hint">{node.kind === "or_gate" ? "任一上游通过后自动开放下游，其他上游保持原状态。" : "有效上游全部通过后立即开放，无需设置时间。"}</p>}
        {publishedRevision ? (
          <div className="node-inspector-revision-strip" role="note">
            <strong className="revision-strip-title">
              <span aria-hidden="true">↻</span>
              发布后修订
            </strong>
            <span className="revision-strip-detail">{node.kind === "file" || node.kind === "confirmation" ? "基本信息/材料/时间" : node.kind === "branch" || node.kind === "or_gate" ? "基本信息" : "基本信息/时间"} · 重新发布生效</span>
            <span className="revision-strip-detail is-immediate">
              <i aria-hidden="true">⚡</i>
              审核规则 · 完成立即生效
            </span>
          </div>
        ) : null}
        {node.kind === "branch" ? <BranchOptionsEditor branches={node.branches ?? []} disabled={coreSettingsDisabled}
          onChange={(branches) => onUpdateNode(node.id, { branches })} /> : null}
        {settingCapabilities.collectsInformation ? (
          <section className="inspector-section" aria-disabled={coreSettingsDisabled}>
            <FormFieldEditor
              disabled={coreSettingsDisabled}
              fields={node.infoFields}
              onChange={(infoFields) => onUpdateNode(node.id, { infoFields })}
            />
          </section>
        ) : null}

        {node.kind === "answer_sheet" && node.answerSheet && answerSheetKey ? (
          <AnswerSheetEditor
            answerDisabled={hasPublishedAnswerKeyPolicy
              ? editingLocked || !answerKeyPolicy || answerKeySaving
              : coreSettingsDisabled}
            config={node.answerSheet}
            deadlineAt={node.deadlineAt}
            gradingKey={hasPublishedAnswerKeyPolicy
              ? answerKeyDraft ?? answerSheetKey
              : answerSheetKey}
            onChange={(config, gradingKey) => {
              if (hasPublishedAnswerKeyPolicy) {
                setAnswerKeyError("");
                setAnswerKeyDraft(gradingKey);
                return;
              }
              onUpdateAnswerSheet(node.id, config, gradingKey);
            }}
            structureDisabled={coreSettingsDisabled}
          />
        ) : null}

        {settingCapabilities.configuresConfirmationScan ? (
          <ConfirmationScanSettings
            disabled={coreSettingsDisabled}
            templateDisabled={editingLocked || (nodeCoreLocked && !node.templateAsset)}
            templateRemovable={!nodeCoreLocked}
            referenceDisabled={editingLocked}
            referenceReplaceOnly={nodeCoreLocked}
            publishedMaterialRevision={publishedRevision && nodeCoreLocked}
            node={auditControlsNode}
            onDeleteTemplate={onDeleteTemplate}
            onDeleteReference={onDeleteReference}
            onUploadReference={onUploadReference}
            onUpdate={(patch) => {
              if (
                hasPublishedAuditPolicy &&
                (typeof patch.scanAuditPrompt === "string"
                  || "scanAuditThreshold" in patch)
              ) {
                if (typeof patch.scanAuditPrompt === "string") {
                  updateAuditPolicyParameter("scanAuditPrompt", patch.scanAuditPrompt);
                } else {
                  updateAuditPolicyParameter("scanAuditThreshold", patch.scanAuditThreshold);
                }
                return;
              }
              onUpdateNode(node.id, patch);
            }}
            onUploadTemplate={onUploadTemplate}
          />
        ) : null}

        {settingCapabilities.configuresMaterialReview ? (
          <>
            <section aria-label="文件限制" className="node-material-limits">
              <strong className="node-material-limits-title">限制</strong>
              <div className="file-type-restriction">
                <span className="node-material-limit-label">
                  <i aria-hidden="true">▣</i>
                  文件类型
                </span>
                {scriptLocksFileTypes ? (
                  <span
                    className="locked-file-types"
                    title={`文件格式由审核脚本固定为 ${lockedFileTypeLabel}`}
                  >
                    <b>{lockedFileTypeLabel}</b>
                    <small>脚本锁定</small>
                    <i aria-hidden="true">🔒</i>
                  </span>
                ) : (
                  <>
                    <button
                      aria-checked={hasFileTypeRestriction}
                      aria-label="启用文件类型限制"
                      className={`restriction-switch ${hasFileTypeRestriction ? "is-enabled" : ""}`}
                      disabled={coreSettingsDisabled}
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
                    {hasFileTypeRestriction ? (
                      <select
                        aria-label="文件类型预设"
                        disabled={coreSettingsDisabled}
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
                    ) : (
                      <small className="unrestricted-file-types">不限格式</small>
                    )}
                  </>
                )}
              </div>
              <label className="file-size-limit-field">
                <span className="node-material-limit-label">
                  <i aria-hidden="true">↕</i>
                  单文件
                </span>
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

            <section aria-label="材料配置" className="inspector-section node-file-material-settings">
              <header className="node-file-material-heading">
                <strong>
                  <i aria-hidden="true">▤</i>
                  材料配置
                </strong>
                <small>{publishedRevision && nodeCoreLocked ? "重新发布后学生需重交" : "文件节点"}</small>
              </header>
              <NodeFileRow label="文件模板" asset={node.templateAsset}
                accept={node.fileExtensions.split(",").filter((value) => value.trim()).map((value) => `.${value.trim().replace(/^\./, "")}`).join(",")}
                hint="可选；须符合上传限制" disabled={materialSettingsDisabled} removable={!nodeCoreLocked}
                onUpload={onUploadTemplate} onRemove={onDeleteTemplate} />
              <NodeReferenceFiles assets={nodeReferences(node)} disabled={materialSettingsDisabled} replaceOnly={nodeCoreLocked}
                onUpload={onUploadReference} onRemove={onDeleteReference} />

              <FileReviewStepsEditor
                disabled={coreSettingsDisabled}
                node={auditControlsNode}
                onChange={(patch) => {
                  if (hasPublishedReviewStepPolicy) {
                    if (patch.fileReviewSteps?.every((step) => typeof step === "object")) {
                      setAuditPolicyError("");
                      setReviewStepDraft(patch.fileReviewSteps as FileReviewStep[]);
                    }
                    return;
                  }
                  if (hasPublishedAuditPolicy && "auditModelCardId" in patch && !("fileReviewSteps" in patch)) {
                    setAuditPolicyError("");
                    setAuditModelCardId(patch.auditModelCardId ?? null);
                    return;
                  }
                  if (hasPublishedAuditPolicy && patch.auditScriptParams) {
                    setAuditPolicyError("");
                    setAuditPolicyParams(patch.auditScriptParams);
                    return;
                  }
                  onUpdateNode(node.id, patch);
                }}
                parameterDisabled={hasPublishedReviewStepPolicy
                  ? !reviewStepPolicy || auditPolicySaving
                  : hasPublishedAuditPolicy ? !auditPolicy || auditPolicySaving : coreSettingsDisabled}
                parameters={hasPublishedAuditPolicy ? auditPolicy?.parameters : undefined}
              />
            </section>
          </>
        ) : null}
        </div>
        <footer className="node-inspector-footer">
          <span
            className={answerKeyError || auditPolicyError ? "node-inspector-footer-error" : undefined}
            role={answerKeyError || auditPolicyError ? "alert" : undefined}
          >
            {answerKeyError
              ? answerKeyError
              : auditPolicyError
              ? auditPolicyError
              : hasPublishedAnswerKeyPolicy && !answerKeyPolicy
                ? "正在读取已发布标准答案…"
              : hasPublishedAuditPolicy && !auditPolicy
                ? "正在读取已发布审核规则…"
              : hasPublishedReviewStepPolicy && !reviewStepPolicy
                ? "正在读取已发布审核步骤…"
                : answerKeySaving || auditPolicySaving
                  ? "正在保存并更新相关结果…"
                  : answerKeyChanged
                    ? "点击完成后，标准答案立即更新并重新判定全部历史答卷。"
                  : hasPublishedAuditPolicy && auditPolicyChanged
                    ? "点击完成后，审核规则立即更新未完成审核。"
                  : hasPublishedReviewStepPolicy && reviewStepChanged
                    ? "点击完成后，新提交将使用更新后的审核参数；已提交批次保持原规则。"
                    : publishedRevision && hasPublishedAnswerKeyPolicy
                      ? "标题、说明和时间重新发布后生效；标准答案在完成时立即保存并重新判分。"
                      : publishedRevision
                        ? "标题、说明和时间重新发布后生效；审核规则在完成时立即保存。"
                      : hasPublishedAuditPolicy
                        ? "审核提示词和脚本参数可在原位置修改，完成时立即保存。"
                        : hasPublishedReviewStepPolicy
                          ? "审核参数和模型可修改；步骤与脚本保持发布锁定。"
                        : hasPublishedAnswerKeyPolicy
                          ? "正确答案可修改；题目结构保持发布锁定。"
                        : "修改仅保存在当前页面，提交发布后写入流程版本。"}
          </span>
          <button
            className="primary-action"
            disabled={answerKeySaving || auditPolicySaving
              || (hasPublishedAnswerKeyPolicy && !answerKeyPolicy)
              || (hasPublishedAuditPolicy && !auditPolicy)
              || (hasPublishedReviewStepPolicy && !reviewStepPolicy)}
            onClick={() => void closeInspector(true)}
            type="button"
          >
            {answerKeySaving || auditPolicySaving ? "保存中…" : "完成"}
          </button>
        </footer>
      </aside>
      {timeSettingsOpen && node.kind !== "branch" && node.kind !== "or_gate" ? (
        <NodeTimeSettingsDialog
          minimumDeadline={minimumDeadline}
          node={node}
          onCancel={() => setTimeSettingsOpen(false)}
          onConfirm={(startAt, deadlineAt) => {
            onUpdateNode(node.id, { deadlineAt, startAt });
            setTimeSettingsOpen(false);
          }}
        />
      ) : null}
      {answerKeyConfirmOpen ? (
        <div
          className="node-time-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !answerKeySaving) {
              setAnswerKeyConfirmOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="answer-key-confirm-title"
            aria-modal="true"
            className="node-time-dialog answer-key-confirm-dialog"
            role="dialog"
          >
            <header>
              <h2 id="answer-key-confirm-title">确认修改标准答案</h2>
              <button
                aria-label="取消修改标准答案"
                disabled={answerKeySaving}
                onClick={() => setAnswerKeyConfirmOpen(false)}
                type="button"
              >×</button>
            </header>
            <div className="node-time-dialog-body">
              <p>保存后，系统会立即使用新答案重新判定该节点的全部历史答卷，学生看到的成绩也会随之更新。</p>
              <p>学生的作答次数、提交记录、节点状态和后续流程不会改变；旧成绩将保留用于审计。</p>
            </div>
            <footer>
              <button disabled={answerKeySaving} onClick={() => setAnswerKeyConfirmOpen(false)} type="button">取消</button>
              <button
                className="primary-action"
                disabled={answerKeySaving}
                onClick={() => void persistPoliciesAndClose(true)}
                type="button"
              >{answerKeySaving ? "重新判分中…" : "确认保存并重新判分"}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function NodeTimeSettingsDialog({
  minimumDeadline,
  node,
  onCancel,
  onConfirm,
}: {
  minimumDeadline: string | null;
  node: AcademicFlowNode;
  onCancel: () => void;
  onConfirm: (startAt: string | null, deadlineAt: string | null) => void;
}) {
  const [startAt, setStartAt] = useState<string | null>(node.startAt ?? null);
  const [deadlineAt, setDeadlineAt] = useState<string | null>(node.deadlineAt ?? null);
  const upstreamConflict = Boolean(deadlineAt && minimumDeadline
    && new Date(deadlineAt).getTime() < new Date(minimumDeadline).getTime());
  const invalid = upstreamConflict || Boolean(
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
                minValue={minimumDeadline}
                onConfirm={setDeadlineAt}
                value={deadlineAt}
              />
              {deadlineAt ? (
                <button onClick={() => setDeadlineAt(null)} type="button">清除</button>
              ) : null}
            </div>
          </div>
          <p className={invalid ? "node-time-dialog-error" : "node-time-dialog-summary"}>
            {upstreamConflict ? `截止时间不得早于上游：${formatNodeScheduleDateTime(minimumDeadline)}。` : getTimeWindowSummary(draftNode)}
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
  templateDisabled,
  templateRemovable,
  referenceDisabled,
  referenceReplaceOnly,
  publishedMaterialRevision,
  node,
  onDeleteTemplate,
  onDeleteReference,
  onUpdate,
  onUploadTemplate,
  onUploadReference,
}: {
  disabled: boolean;
  templateDisabled: boolean;
  templateRemovable: boolean;
  referenceDisabled: boolean;
  referenceReplaceOnly: boolean;
  publishedMaterialRevision: boolean;
  node: AcademicFlowNode;
  onDeleteTemplate: () => void;
  onDeleteReference: (assetId: string) => void;
  onUpdate: (patch: Partial<AcademicFlowNode>) => void;
  onUploadTemplate: (file: File) => void;
  onUploadReference: (files: File[], replaceAssetId?: string) => void;
}) {
  return (
    <section className="inspector-section confirmation-scan-settings">
      <header className="confirmation-scan-heading">
        <strong>
          <i aria-hidden="true">✓</i>
          扫描件提交与审核
        </strong>
        <small>{publishedMaterialRevision ? "材料变更后需重新提交" : "视觉审核"}</small>
      </header>
      <NodeFileRow label="文件模板" asset={node.templateAsset} accept=".docx"
        hint="可选；DOCX，不提供时直接上传图片" disabled={templateDisabled} removable={templateRemovable}
        onUpload={onUploadTemplate} onRemove={onDeleteTemplate} />
      <NodeReferenceFiles label="参考示例" assets={nodeReferences(node)} disabled={referenceDisabled}
        replaceOnly={referenceReplaceOnly}
        onUpload={onUploadReference} onRemove={onDeleteReference} />
      <div className="confirmation-audit-row"><span
          className="confirmation-upload-limits"
          title="学生最多上传 10 个文件、合计 20 页；单文件 10 MB，整组 30 MB；支持 JPG、JPEG、PNG"
        >
          <i aria-hidden="true">⇧</i>
          10 文件 · 20 页 · 10 MB/文件 · 30 MB/组 · JPG/JPEG/PNG
        </span></div>
      <FileReviewStepsEditor node={node} disabled={disabled} onChange={onUpdate} />
    </section>
  );
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

function getTimeSettingsLabel(node: AcademicFlowNode) {
  const startAt = formatNodeScheduleDateTime(node.startAt);
  const deadlineAt = formatNodeScheduleDateTime(node.deadlineAt);
  if (startAt && deadlineAt) return `${startAt} → ${deadlineAt}`;
  if (startAt) return `${startAt} 开放`;
  if (deadlineAt) return `${deadlineAt} 截止`;
  return "定时设置";
}

function formatNodeScheduleDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
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

function getPortLabel(port: AcademicFlowPort) {
  if (port.startsWith("branch:")) return "分支输出";
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
  if (port.startsWith("branch:")) return { x: node.x + nodeSize.width * branchPortFraction(node.branches, port), y: node.y + node.renderedHeight };
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


function DesignerErrorDialog({ message, onClose }: { message: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={ref} className="designer-error-dialog" role="alertdialog" aria-labelledby="designer-error-title" aria-describedby="designer-error-message"
    onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => event.stopPropagation()}>
    <header><span aria-hidden="true">!</span><h2 id="designer-error-title">操作未完成</h2></header>
    <p id="designer-error-message">{message}</p>
    <footer><button type="button" autoFocus onClick={onClose}>返回修改</button></footer>
  </dialog>;
}
