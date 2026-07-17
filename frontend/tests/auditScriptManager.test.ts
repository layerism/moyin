import assert from "node:assert/strict";
import test from "node:test";

import {
  getAuditScriptFormState,
  validateAuditScriptForm,
  type AuditScriptFormMode,
} from "../src/features/academic-flow/auditScriptManager.ts";

const pythonScript = {
  description: "校验材料内容",
  id: "script-1",
  language: "py" as const,
  name: "材料审核",
  sha256: "abc123",
  updatedAt: "2026-07-17T10:00:00+00:00",
  version: 2,
};

const file = (name: string) => ({ name }) as File;

test("功能名称去除首尾空格后必须填写且最多 120 个字符", () => {
  const mode: AuditScriptFormMode = { kind: "create" };

  assert.equal(validateAuditScriptForm({ mode, name: "   ", description: "说明", file: file("audit.py") }), "请填写功能名称");
  assert.equal(validateAuditScriptForm({ mode, name: "a".repeat(121), description: "说明", file: file("audit.py") }), "功能名称不能超过 120 个字符");
});

test("功能描述必须填写且最多 500 个字符", () => {
  const mode: AuditScriptFormMode = { kind: "create" };

  assert.equal(validateAuditScriptForm({ mode, name: "审核", description: " ", file: file("audit.py") }), "请填写功能描述");
  assert.equal(validateAuditScriptForm({ mode, name: "审核", description: "a".repeat(501), file: file("audit.py") }), "功能描述不能超过 500 个字符");
});

test("新增仅接受 Python 或 JavaScript 脚本", () => {
  const mode: AuditScriptFormMode = { kind: "create" };

  assert.equal(validateAuditScriptForm({ mode, name: "审核", description: "说明", file: file("audit.py") }), null);
  assert.equal(validateAuditScriptForm({ mode, name: "审核", description: "说明", file: file("audit.js") }), null);
  assert.equal(validateAuditScriptForm({ mode, name: "审核", description: "说明", file: file("audit.txt") }), "请选择 .py 或 .js 脚本文件");
});

test("更新时必须保持原脚本语言", () => {
  const mode: AuditScriptFormMode = { kind: "update", script: pythonScript };

  assert.equal(validateAuditScriptForm({ mode, name: pythonScript.name, description: "更新说明", file: file("audit.js") }), "更新版本必须保持 Python 语言");
  assert.equal(validateAuditScriptForm({ mode, name: pythonScript.name, description: "更新说明", file: file("audit.py") }), null);
});

test("更新表单锁定功能名称但允许修改描述", () => {
  const mode: AuditScriptFormMode = { kind: "update", script: pythonScript };

  assert.deepEqual(getAuditScriptFormState(mode), { name: "材料审核", nameLocked: true });
  assert.equal(validateAuditScriptForm({ mode, name: pythonScript.name, description: "新的功能描述", file: file("audit.py") }), null);
});
