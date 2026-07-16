import type { Dispatch, SetStateAction } from "react";

export type Screen =
  | "authForgot"
  | "authLogin"
  | "authRegister"
  | "adminDatabase"
  | "home"
  | "academicFlow"
  | "academicFlowDetail"
  | "academicFlowShared"
  | "academicFlowStudent"
  | "academicFlowStudentRuntime"
  | "login"
  | "reset"
  | "changePassword"
  | "studentHome"
  | "workspace";
export type Tab = "edit" | "stats" | "settings" | "fill";
export type Source = "导入" | "临时添加";
export type SubmitStatus = "未提交" | "已提交" | "已覆盖";
export type CheckStatus = "-" | "待检查" | "检查中" | "检查成功" | "检查失败";

export type HomeMenu =
  | { kind: "cloud"; x: number; y: number }
  | { fileId: string; kind: "file"; x: number; y: number }
  | { folder: string; kind: "folder"; x: number; y: number };

export type FolderDialog = { mode: "create" } | { mode: "rename"; target: string };
export type FileDialog =
  | { fileId: string; mode: "move" | "rename" }
  | { mode: "createAi" | "createNormal" };
export type DeleteDialog =
  | { folder: string; kind: "folder" }
  | { fileId: string; fileName: string; kind: "file" };

export type HomeFile = {
  action: "编辑" | "学生填写";
  editedAt: string;
  folder: string | null;
  id: string;
  name: string;
  owner: string;
  size: string;
};

export type Student = {
  name: string;
  studentNo: string;
  className: string;
  source: Source;
  submitStatus: SubmitStatus;
  checkStatus: CheckStatus;
  fileName?: string;
  submitCount: number;
};

export type DraftStudent = {
  name: string;
  studentNo: string;
  className: string;
};

export type StudentAccount = {
  name: string;
  password: string;
  studentNo: string;
};

export type AuditScriptType = "js" | "mjs" | "none" | "py";
export type AcademicFlowNodeStatus = "approved" | "disabled" | "pending" | "ready";
export type AcademicFlowNodeKind = "announcement" | "confirmation" | "file" | "form";
export type AcademicFlowPort = "bottom" | "left" | "right" | "top";

export type AcademicFlowNode = {
  auditScriptHash?: string;
  auditScriptId?: string;
  auditScriptName: string;
  auditScriptType: AuditScriptType;
  auditScriptVersion?: number;
  deadlineAt?: string | null;
  fileExtensions: string;
  fileLimitMb: string;
  id: string;
  infoFields: string[];
  kind: AcademicFlowNodeKind;
  requirement: string;
  status: AcademicFlowNodeStatus;
  title: string;
  x: number;
  y: number;
};

export type AcademicFlowEdge = {
  id: string;
  source: string;
  sourcePort?: AcademicFlowPort;
  target: string;
  targetPort?: AcademicFlowPort;
};

export type AcademicProcess = {
  createdAt: string;
  description: string;
  edges: AcademicFlowEdge[];
  encryptedSlug: string;
  hasUnpublishedChanges: boolean;
  id: string;
  name: string;
  nodes: AcademicFlowNode[];
  published: boolean;
  publishedNodeIds: string[];
  publishedVersionId?: string;
  publishedVersionNo?: number;
  serverId?: string;
  shareUrl: string;
};

export type Stats = {
  failed: number;
  overwritten: number;
  submitted: number;
  temporary: number;
  total: number;
  unsubmitted: number;
};

export type StateSetter<T> = Dispatch<SetStateAction<T>>;
