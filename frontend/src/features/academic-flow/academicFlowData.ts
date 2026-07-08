import type {
  AcademicFlowEdge,
  AcademicFlowNode,
  AcademicFlowNodeKind,
  AcademicFlowNodeStatus,
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

const statusCycle: AcademicFlowNodeStatus[] = ["approved", "approved", "pending", "disabled"];

export function createAcademicProcess(name: string, id = `academic-${Date.now()}`): AcademicProcess {
  const encryptedSlug = createEncryptedSlug();
  return {
    createdAt: "刚刚",
    edges: createDefaultEdges(),
    encryptedSlug,
    id,
    name,
    nodes: createDefaultNodes(),
    published: false,
    shareUrl: `/academic-flow/${encodeURIComponent(id)}/student/${encryptedSlug}`,
  };
}

export function createFallbackAcademicProcess(id: string): AcademicProcess {
  return createAcademicProcess("毕业论文材料提交流程", id);
}

export function createNode(
  kind: AcademicFlowNodeKind,
  title: string,
  position = { x: 210, y: 80 },
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

function createDefaultNodes(): AcademicFlowNode[] {
  return [
    {
      ...createNode("form", "基本信息填写"),
      auditScriptType: "none",
      id: "default-basic-info",
      infoFields: ["学号", "姓名", "联系电话", "指导教师"],
      status: statusCycle[0],
      x: 170,
      y: 70,
    },
    {
      ...createNode("file", "开题报告提交"),
      auditScriptName: "check_proposal.py",
      id: "default-proposal",
      requirement: "上传开题报告文件（PDF），系统检查命名与格式。",
      status: statusCycle[1],
      x: 170,
      y: 250,
    },
    {
      ...createNode("file", "中期检查材料提交"),
      auditScriptName: "check_midterm.py",
      id: "default-midterm",
      requirement: "上传中期检查相关材料，包含进度报告与阶段性成果。",
      status: statusCycle[2],
      x: 170,
      y: 430,
    },
    {
      ...createNode("file", "终稿提交"),
      auditScriptName: "check_final.mjs",
      auditScriptType: "mjs",
      id: "default-final",
      requirement: "上传论文终稿及相关材料，等待前置节点审核通过后开放。",
      status: statusCycle[3],
      x: 170,
      y: 610,
    },
  ];
}

function createDefaultEdges(): AcademicFlowEdge[] {
  return [
    {
      id: "edge-default-basic-info-default-proposal",
      source: "default-basic-info",
      target: "default-proposal",
    },
    {
      id: "edge-default-proposal-default-midterm",
      source: "default-proposal",
      target: "default-midterm",
    },
    {
      id: "edge-default-midterm-default-final",
      source: "default-midterm",
      target: "default-final",
    },
  ];
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
