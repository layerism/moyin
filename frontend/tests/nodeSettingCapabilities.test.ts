import assert from "node:assert/strict";
import test from "node:test";

import {
  createNode,
  getNodeSettingCapabilities,
} from "../src/features/academic-flow/academicFlowData.ts";

test("节点设置不提供运行时提交或审核状态配置", () => {
  assert.deepEqual(getNodeSettingCapabilities("announcement"), {
    collectsInformation: false,
    configuresConfirmationScan: false,
    configuresMaterialReview: false,
  });
  assert.deepEqual(getNodeSettingCapabilities("file"), {
    collectsInformation: false,
    configuresConfirmationScan: false,
    configuresMaterialReview: true,
  });
  assert.deepEqual(getNodeSettingCapabilities("confirmation"), {
    collectsInformation: false,
    configuresConfirmationScan: true,
    configuresMaterialReview: false,
  });
});

test("信息填写只配置采集信息，材料上传只由文件节点配置", () => {
  assert.equal(getNodeSettingCapabilities("form").collectsInformation, true);
  assert.equal(getNodeSettingCapabilities("form").configuresMaterialReview, false);
  assert.equal(getNodeSettingCapabilities("file").configuresMaterialReview, true);
});

test("新建文件节点默认不绑定已移除的内置审核脚本", () => {
  const node = createNode("file", "文件上传");

  assert.equal(node.auditScriptName, "");
  assert.equal(node.auditScriptType, "none");
  assert.equal(node.auditScriptId, undefined);
  assert.equal(node.auditScriptVersion, undefined);
});
