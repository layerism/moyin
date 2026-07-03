import { readSheet } from "read-excel-file/browser";

export type RosterField = "班级" | "学号" | "姓名";
export type RosterColumns = Record<RosterField, string>;

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

export async function parseRosterHeaders(file: File) {
  if (file.name.toLowerCase().endsWith(".csv")) {
    const text = await file.text();
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    return firstLine.split(",").map((header) => header.trim());
  }

  const rows = await readSheet(file);
  return (rows[0] ?? []).map((header) => String(header ?? "").trim());
}
