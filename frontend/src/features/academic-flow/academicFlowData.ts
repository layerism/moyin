import type {
  AcademicFlowNode,
  AcademicFlowNodeKind,
  AcademicProcess,
  AuditScriptType,
} from "../../types";
import { createDefaultAnswerSheet } from "./answerSheet";

export const nodeTemplates: Array<{
  description: string;
  kind: AcademicFlowNodeKind;
  title: string;
}> = [
  { kind: "form", title: "表单填写", description: "自定义文本输入，支持单选与多选题" },
  { kind: "answer_sheet", title: "答题卡", description: "Markdown 题目与自动判分" },
  { kind: "file", title: "文件上传", description: "上传文件，支持类型与大小限制" },
  { kind: "confirmation", title: "视觉审核", description: "上传扫描件并由 AI 进行视觉审核" },
  { kind: "manual_review", title: "人工审核", description: "教师查看前置材料并确认通过" },
  { kind: "announcement", title: "通知公告", description: "展示说明、提醒或公告内容" },
];

export const fileTypeRestrictionPresets = [
  { extensions: "pdf, docx", label: "文字文档（.pdf、.docx）", value: "document" },
  {
    extensions: "pdf, docx, zip",
    label: "常用材料（.pdf、.docx、.zip）",
    value: "common-document",
  },
  { extensions: "xlsx", label: "表格文档（.xlsx）", value: "spreadsheet" },
  { extensions: "ppt, pptx", label: "演示文稿（.ppt、.pptx）", value: "presentation" },
  { extensions: "jpg, jpeg, png", label: "图片文件（.jpg、.jpeg、.png）", value: "image" },
  { extensions: "zip", label: "压缩文件（.zip）", value: "archive" },
];

export function createAcademicProcess(name: string, id = `academic-${Date.now()}`): AcademicProcess {
  const encryptedSlug = createEncryptedSlug();
  return {
    answerSheetKeys: {},
    createdAt: "刚刚",
    description: `用于“${name}”的分阶段提交与审核。`,
    draftConfig: { edges: [], nodes: [] },
    edges: [],
    encryptedSlug,
    hasUnpublishedChanges: false,
    id,
    name,
    nodes: [],
    published: false,
    publishedNodeIds: [],
    publishedVersionNo: undefined,
    shareUrl: `/academic-flow/${encodeURIComponent(id)}/student/${encryptedSlug}`,
  };
}

export function createFallbackAcademicProcess(id: string): AcademicProcess {
  return createAcademicProcess("未命名 OA 流程", id);
}

export function createNode(
  kind: AcademicFlowNodeKind,
  title: string,
  position = { x: 208, y: 80 },
): AcademicFlowNode {
  const answerSheet = kind === "answer_sheet" ? createDefaultAnswerSheet().config : undefined;
  return {
    answerSheet,
    branches: kind === "branch" ? [{ id: crypto.randomUUID(), label: "分支 1" }, { id: crypto.randomUUID(), label: "分支 2" }] : undefined,
    auditScriptName: "",
    auditScriptType: "none",
    fileReviewSteps: kind === "file" ? ["ai", "manual"] : undefined,
    deadlineAt: null,
    fileExtensions: kind === "file" ? "pdf, docx, zip" : "",
    fileLimitMb: kind === "file" ? "50" : "",
    id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    infoFields: [],
    kind,
    requirement: getDefaultRequirement(kind, title),
    scanAuditEnabled: false,
    scanAuditMode: undefined,
    scanAuditPrompt: "",
    startAt: null,
    status: "disabled",
    templateAsset: null,
    title,
    x: position.x,
    y: position.y,
  };
}

export function getAuditScriptLabel(value: AuditScriptType) {
  if (value === "py") {
    return "Python (.py)";
  }
  if (value === "mjs") {
    return "Node.js (.mjs)";
  }
  if (value === "js") {
    return "JavaScript (.js)";
  }
  return "不启用脚本";
}

export function hasFileUploadSettings(kind: AcademicFlowNodeKind) {
  return getNodeSettingCapabilities(kind).configuresMaterialReview;
}

export function getFileExtensionsForPreset(value: string) {
  return fileTypeRestrictionPresets.find((preset) => preset.value === value)?.extensions ?? "";
}

export function getFileTypeRestrictionPreset(extensions: string) {
  const normalizedExtensions = extensions
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .join(", ");
  if (!normalizedExtensions) return "none";
  return (
    fileTypeRestrictionPresets.find((preset) => preset.extensions === normalizedExtensions)?.value ??
    "custom"
  );
}

export function getNodeSettingCapabilities(kind: AcademicFlowNodeKind) {
  return {
    collectsInformation: kind === "form",
    configuresConfirmationScan: kind === "confirmation",
    configuresMaterialReview: kind === "file",
  };
}

function createEncryptedSlug() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultRequirement(kind: AcademicFlowNodeKind, title: string) {
  if (kind === "branch") return "请选择一个分支，提交后将开放对应任务，选择不可更改。";
  if (kind === "manual_review") return "请核对前置节点的材料与信息。教师审核通过后才能进入下一阶段。";
  if (kind === "answer_sheet") {
    return `请完成“${title}”中的题目，提交后系统将自动判分。`;
  }
  if (kind === "file") {
    return `请按要求上传“${title}”相关文件，提交后等待系统审核。`;
  }
  if (kind === "confirmation") {
    return "请按要求上传扫描件，提交后等待 AI 视觉审核。";
  }
  if (kind === "announcement") {
    return `请阅读“${title}”说明，按后续节点要求完成材料采集。`;
  }
  return `请完整填写“${title}”所需信息，必填项不得为空。`;
}
