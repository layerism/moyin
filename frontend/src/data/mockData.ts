import type { Student, StudentAccount } from "../types";

export const questionTypes = [
  "问答题",
  "单选题",
  "多选题",
  "时间题",
  "图片题",
  "文件题",
  "下拉选择",
  "签名题",
];

export const advancedTypes = ["多级选项", "量表题", "评分题", "表格题", "矩阵题", "分节标题"];

export const initialStudents: Student[] = [
  {
    name: "张三",
    studentNo: "20240001",
    className: "2023软件5班",
    source: "导入",
    submitStatus: "已提交",
    checkStatus: "检查成功",
    fileName: "20240001-张三-DOCX材料.docx",
    submitCount: 1,
  },
  {
    name: "李四",
    studentNo: "20240002",
    className: "2023软件5班",
    source: "导入",
    submitStatus: "已覆盖",
    checkStatus: "检查中",
    fileName: "20240002-李四-DOCX材料.docx",
    submitCount: 2,
  },
  {
    name: "王五",
    studentNo: "20240003",
    className: "2023软件6班",
    source: "导入",
    submitStatus: "未提交",
    checkStatus: "-",
    submitCount: 0,
  },
  {
    name: "赵六",
    studentNo: "20249999",
    className: "临时",
    source: "临时添加",
    submitStatus: "未提交",
    checkStatus: "-",
    submitCount: 0,
  },
];

export const initialAccounts: StudentAccount[] = initialStudents.map((student) => ({
  name: student.name,
  studentNo: student.studentNo,
  password: `${student.studentNo.slice(-4)}Aa`,
}));
