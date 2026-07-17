import assert from "node:assert/strict";
import test from "node:test";

import {
  getAuditScriptOptions,
  getSelectedAuditScriptValue,
  resolveAuditScriptSelection,
  toNodeAuditScriptSelection,
  type AuditScriptSummary,
} from "../src/features/academic-flow/auditScripts.ts";

const globalScript: AuditScriptSummary = {
  description: "校验文件命名与结构",
  id: "script-1",
  language: "js",
  name: "材料审核",
  sha256: "abc123",
  updatedAt: "2026-07-17T10:00:00+00:00",
  version: 3,
};

test("预置脚本选项以不启用开头并标注语言和版本", () => {
  const options = getAuditScriptOptions([globalScript]);

  assert.deepEqual(options[0], { label: "不启用材料审核", value: "" });
  assert.deepEqual(options[1], {
    label: "材料审核（JavaScript，v3）",
    value: "uploaded:script-1:3",
  });
  assert.equal(options.some((option) => option.value === "check_material.py"), false);
  assert.equal(options.some((option) => option.value === "check_filename.mjs"), false);
});

test("选择全局脚本会写入不可变的脚本标识", () => {
  assert.deepEqual(toNodeAuditScriptSelection(globalScript), {
    auditScriptHash: "abc123",
    auditScriptId: "script-1",
    auditScriptName: "材料审核",
    auditScriptType: "js",
    auditScriptVersion: 3,
  });
});

test("不启用脚本会清理上传脚本的标识", () => {
  const cleared = {
    auditScriptHash: undefined,
    auditScriptId: undefined,
    auditScriptName: "",
    auditScriptType: "none",
    auditScriptVersion: undefined,
  };

  assert.deepEqual(toNodeAuditScriptSelection(null), cleared);
  assert.deepEqual(resolveAuditScriptSelection("", [globalScript]), cleared);
});

test("旧版本节点继续回显固定版本，而非自动切换到最新版本", () => {
  const node = {
    auditScriptId: "script-1",
    auditScriptName: "材料审核",
    auditScriptVersion: 2,
  } as Parameters<typeof getSelectedAuditScriptValue>[0];

  assert.equal(getSelectedAuditScriptValue(node), "uploaded:script-1:2");
  assert.deepEqual(getAuditScriptOptions([globalScript], node).at(-1), {
    label: "材料审核（固定 v2）",
    value: "uploaded:script-1:2",
  });
});
