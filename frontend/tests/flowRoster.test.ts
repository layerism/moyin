import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFlowRosterRows } from "../src/utils/roster.ts";

test("normalizes name and student number while ignoring class", () => {
  const result = normalizeFlowRosterRows([
    ["班级", "学生学号", "学生姓名"],
    ["软件 1 班", "001", " 学生甲 "],
    ["软件 2 班", "002", "学生乙"],
  ]);

  assert.deepEqual(result.entries, [
    { studentNo: "001", name: "学生甲" },
    { studentNo: "002", name: "学生乙" },
  ]);
  assert.deepEqual(result.errors, []);
});

test("deduplicates identical rows and reports conflicting names", () => {
  const result = normalizeFlowRosterRows([
    ["学号", "姓名"],
    ["001", "学生甲"],
    ["001", "学生甲"],
    ["001", "另一姓名"],
    ["002", ""],
  ]);

  assert.deepEqual(result.entries, [{ studentNo: "001", name: "学生甲" }]);
  assert.deepEqual(result.errors, [
    "第 4 行：学号 001 对应多个姓名",
    "第 5 行：姓名不能为空",
  ]);
});

test("requires student number and name headers", () => {
  const result = normalizeFlowRosterRows([
    ["班级", "联系电话"],
    ["软件 1 班", "13800000000"],
  ]);

  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.errors, ["未识别到姓名列", "未识别到学号列"]);
});
