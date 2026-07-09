import type {
  AcademicFlowNode,
  AcademicFlowNodeKind,
  AcademicProcess,
  AuditScriptType,
} from "../../types";

export const nodeTemplates: Array<{
  description: string;
  kind: AcademicFlowNodeKind;
  title: string;
}> = [
  { kind: "form", title: "信息填写", description: "填写文本、数字、日期等信息" },
  { kind: "form", title: "表单填写", description: "自定义表单，包含多种题型" },
  { kind: "file", title: "文件上传", description: "上传文件，支持类型与大小限制" },
  { kind: "confirmation", title: "确认承诺", description: "签署承诺书或确认协议" },
  { kind: "announcement", title: "通知公告", description: "展示说明、提醒或公告内容" },
];

export function createAcademicProcess(name: string, id = `academic-${Date.now()}`): AcademicProcess {
  const encryptedSlug = createEncryptedSlug();
  return {
    createdAt: "刚刚",
    description: `用于“${name}”的分阶段提交与审核。`,
    edges: [],
    encryptedSlug,
    id,
    name,
    nodes: [],
    published: false,
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
    auditScriptName: kind === "file" ? "check_material.py" : "",
    auditScriptType: kind === "file" ? "py" : "none",
    fileExtensions: kind === "file" ? "pdf, doc, docx, zip" : "",
    fileLimitMb: kind === "file" ? "50" : "",
    id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    infoFields: kind === "form" ? ["学号", "姓名", "联系电话"] : [],
    kind,
    requirement: getDefaultRequirement(kind, title),
    status: "disabled",
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
  return "不启用脚本";
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
