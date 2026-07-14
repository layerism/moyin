import { readSheet } from "read-excel-file/browser";

export type RosterField = "班级" | "学号" | "姓名";
export type RosterColumns = Record<RosterField, string>;
export type FlowRosterEntry = { studentNo: string; name: string };
export type FlowRosterParseResult = {
  columns: RosterColumns;
  entries: FlowRosterEntry[];
  errors: string[];
};

const rosterColumnAliases: Record<RosterField, string[]> = {
  班级: ["班级", "行政班", "专业班级", "class", "Class"],
  学号: ["学号", "学生学号", "student_no", "studentNo", "学籍号"],
  姓名: ["姓名", "学生姓名", "name", "Name"],
};

function matchRosterColumn(headers: string[], aliases: string[]) {
  return headers.find((header) =>
    aliases.some((alias) => header.trim().toLowerCase() === alias.toLowerCase()),
  );
}

export function matchRosterColumns(headers: string[]): RosterColumns {
  return {
    班级: matchRosterColumn(headers, rosterColumnAliases.班级) ?? "",
    学号: matchRosterColumn(headers, rosterColumnAliases.学号) ?? "",
    姓名: matchRosterColumn(headers, rosterColumnAliases.姓名) ?? "",
  };
}

export function normalizeFlowRosterRows(rows: unknown[][]): FlowRosterParseResult {
  const headers = (rows[0] ?? []).map((value) => String(value ?? "").trim());
  const columns = matchRosterColumns(headers);
  const errors: string[] = [];
  if (!columns.姓名) errors.push("未识别到姓名列");
  if (!columns.学号) errors.push("未识别到学号列");
  if (errors.length > 0) return { columns, entries: [], errors };

  const nameIndex = headers.indexOf(columns.姓名);
  const studentNoIndex = headers.indexOf(columns.学号);
  const entriesByStudentNo = new Map<string, string>();
  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const studentNo = String(row[studentNoIndex] ?? "").trim();
    const name = String(row[nameIndex] ?? "").trim();
    if (!studentNo && !name) return;
    if (!studentNo) {
      errors.push(`第 ${rowNumber} 行：学号不能为空`);
      return;
    }
    if (!name) {
      errors.push(`第 ${rowNumber} 行：姓名不能为空`);
      return;
    }
    const existingName = entriesByStudentNo.get(studentNo);
    if (existingName && existingName !== name) {
      errors.push(`第 ${rowNumber} 行：学号 ${studentNo} 对应多个姓名`);
      return;
    }
    entriesByStudentNo.set(studentNo, name);
  });

  return {
    columns,
    entries: Array.from(entriesByStudentNo, ([studentNo, name]) => ({ studentNo, name })),
    errors,
  };
}

async function readRosterRows(file: File): Promise<unknown[][]> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    const text = await file.text();
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => line.split(",").map((value) => value.trim()));
  }
  return readSheet(file);
}

export async function parseFlowRoster(file: File): Promise<FlowRosterParseResult> {
  return normalizeFlowRosterRows(await readRosterRows(file));
}

export async function parseRosterHeaders(file: File) {
  const rows = await readRosterRows(file);
  return (rows[0] ?? []).map((header) => String(header ?? "").trim());
}
