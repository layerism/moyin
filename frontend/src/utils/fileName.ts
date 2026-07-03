import type { Student } from "../types";

export function makeFileName(pattern: string, student: Student, materialName: string) {
  return [
    ["学号", student.studentNo],
    ["姓名", student.name],
    ["班级", student.className],
    ["材料名称", materialName],
    ["提交时间", "20260703"],
  ].reduce((value, [token, replacement]) => value.split(token).join(replacement), pattern);
}
