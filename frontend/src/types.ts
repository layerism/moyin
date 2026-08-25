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
export type AcademicFlowNodeKind = "announcement" | "answer_sheet" | "confirmation" | "file" | "form";
export type AcademicFlowPort = "bottom" | "left" | "right" | "top";
export type FormFieldType = "text" | "textarea" | "radio" | "checkbox";

export type AnswerSheetQuestionType = "fill_blank" | "multiple_choice" | "single_choice";

export type AnswerSheetOption = {
  content: string;
  id: string;
};

export type AnswerSheetSelectionQuestion = {
  content: string;
  id: string;
  options: AnswerSheetOption[];
  points: number;
  required: boolean;
  type: "multiple_choice" | "single_choice";
};

export type AnswerSheetBlank = {
  id: string;
  points: number;
};

export type AnswerSheetFillBlankQuestion = {
  blanks: AnswerSheetBlank[];
  content: string;
  id: string;
  required: boolean;
  type: "fill_blank";
};

export type AnswerSheetQuestion = AnswerSheetSelectionQuestion | AnswerSheetFillBlankQuestion;

export type AnswerSheetConfig = {
  gradingPolicy: {
    feedback: "full_after_deadline" | "question_result" | "score_only";
    maxAttempts: number | null;
    passingScore: number;
  };
  questions: AnswerSheetQuestion[];
  schemaVersion: "1.0";
};

export type AnswerSheetPrivateAnswer =
  | { correctOptionId: string; type: "single_choice" }
  | { correctOptionIds: string[]; mode: "exact_set"; type: "multiple_choice" }
  | {
      blanks: Record<string, { acceptedAnswers: string[]; caseSensitive: boolean }>;
      type: "fill_blank";
    };

export type AnswerSheetPrivateKey = {
  answers: Record<string, AnswerSheetPrivateAnswer>;
  graderVersion: "answer-sheet-v1";
  schemaVersion: "1.0";
};

export type AnswerSheetQuestionResult = {
  awardedPoints: number;
  blankResults?: Array<{
    awardedPoints: number;
    blankId: string;
    correct: boolean;
    maxPoints: number;
  }>;
  correct: boolean;
  maxPoints: number;
  questionId: string;
};

export type AnswerSheetGrade = {
  graderVersion: "answer-sheet-v1";
  maxScore: number;
  passed: boolean;
  passingScore: number;
  questionResults?: AnswerSheetQuestionResult[];
  schemaVersion: "1.0";
  score: number;
  standardAnswers?: Record<string, AnswerSheetPrivateAnswer>;
};

export type FormFieldOption = {
  id: string;
  label: string;
};

export type FormField = {
  allowOther?: boolean;
  id: string;
  label: string;
  maxLength?: number;
  maxSelections?: number;
  minLength?: number;
  minSelections?: number;
  options?: FormFieldOption[];
  required: boolean;
  type: FormFieldType;
};

export type FormFieldConfig = string | FormField;

export type NodeTemplateAsset = {
  assetId: string;
  contentType: string;
  originalName: string;
  sha256: string;
  sizeBytes: number;
};

export type AcademicFlowNode = {
  answerSheet?: AnswerSheetConfig;
  auditScriptAcceptedExtensions?: string[];
  auditScriptId?: string;
  auditScriptName: string;
  auditScriptType: AuditScriptType;
  auditScriptParams?: Record<string, string | number | boolean>;
  deadlineAt?: string | null;
  fileExtensions: string;
  fileLimitMb: string;
  id: string;
  infoFields: FormFieldConfig[];
  kind: AcademicFlowNodeKind;
  requirement: string;
  scanAuditEnabled?: boolean;
  scanAuditMode?: "pass_fail" | "score";
  scanAuditPrompt?: string;
  startAt?: string | null;
  status: AcademicFlowNodeStatus;
  templateAsset?: NodeTemplateAsset | null;
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

export type AcademicFlowConfig = {
  edges: AcademicFlowEdge[];
  nodes: AcademicFlowNode[];
};

export type AcademicProcess = {
  answerSheetKeys: Record<string, AnswerSheetPrivateKey>;
  createdAt: string;
  description: string;
  draftConfig: AcademicFlowConfig;
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
