import assert from "node:assert/strict";
import test from "node:test";

import {
  getAuditScriptOptions,
  getSelectedAuditScriptValue,
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

test("全局脚本显示在内置脚本之后并标注语言和版本", () => {
  const options = getAuditScriptOptions([globalScript]);

  assert.equal(options.at(-1)?.label, "材料审核（JavaScript，v3）");
  assert.equal(options.at(-1)?.value, "uploaded:script-1:3");
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
  assert.deepEqual(toNodeAuditScriptSelection(null), {
    auditScriptHash: undefined,
    auditScriptId: undefined,
    auditScriptName: "",
    auditScriptType: "none",
    auditScriptVersion: undefined,
  });
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
