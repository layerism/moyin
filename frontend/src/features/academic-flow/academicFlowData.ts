import type {
  AcademicFlowNode,
  AcademicFlowNodeKind,
  AcademicProcess,
  AuditScriptType,
} from "../../types";
import { createFormField } from "./formFields";

export const nodeTemplates: Array<{
  description: string;
  kind: AcademicFlowNodeKind;
  title: string;
}> = [
  { kind: "form", title: "信息填写", description: "填写基础文本信息" },
  { kind: "form", title: "表单填写", description: "自定义文本与选择题" },
  { kind: "file", title: "文件上传", description: "上传文件，支持类型与大小限制" },
  { kind: "confirmation", title: "确认承诺", description: "签署承诺书或确认协议" },
  { kind: "announcement", title: "通知公告", description: "展示说明、提醒或公告内容" },
];

export const fileTypeRestrictionPresets = [
  { extensions: "pdf, doc, docx", label: "文字文档（.pdf、.doc、.docx）", value: "document" },
  {
    extensions: "pdf, doc, docx, zip",
    label: "常用材料（.pdf、.doc、.docx、.zip）",
    value: "common-document",
  },
  { extensions: "xls, xlsx", label: "表格文档（.xls、.xlsx）", value: "spreadsheet" },
  { extensions: "ppt, pptx", label: "演示文稿（.ppt、.pptx）", value: "presentation" },
  { extensions: "jpg, jpeg, png", label: "图片文件（.jpg、.jpeg、.png）", value: "image" },
  { extensions: "zip", label: "压缩文件（.zip）", value: "archive" },
];

export function createAcademicProcess(name: string, id = `academic-${Date.now()}`): AcademicProcess {
  const encryptedSlug = createEncryptedSlug();
  return {
    createdAt: "刚刚",
    description: `用于“${name}”的分阶段提交与审核。`,
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
  return {
    auditScriptName: "",
    auditScriptType: "none",
    deadlineAt: null,
    fileExtensions: kind === "file" ? "pdf, doc, docx, zip" : "",
    fileLimitMb: kind === "file" ? "50" : "",
    id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    infoFields: kind === "form"
      ? ["学号", "姓名", "联系电话"].map((label) => ({
          ...createFormField("text"),
          label,
        }))
      : [],
    kind,
    requirement: getDefaultRequirement(kind, title),
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
    configuresMaterialReview: kind === "file",
  };
}

function createEncryptedSlug() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultRequirement(kind: AcademicFlowNodeKind, title: string) {
  if (kind === "file") {
    return `请按要求上传“${title}”相关文件，提交后等待系统审核。`;
  }
  if (kind === "confirmation") {
    return `请阅读并确认“${title}”内容，确认后进入下一节点。`;
  }
  if (kind === "announcement") {
    return `请阅读“${title}”说明，按后续节点要求完成材料采集。`;
  }
  return `请完整填写“${title}”所需信息，必填项不得为空。`;
}
