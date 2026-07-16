import assert from "node:assert/strict";
import test from "node:test";

import {
  getNodeSettingCapabilities,
  resolveStandardAuditScript,
} from "../src/features/academic-flow/academicFlowData.ts";

test("节点设置不提供运行时提交或审核状态配置", () => {
  assert.deepEqual(getNodeSettingCapabilities("announcement"), {
    collectsInformation: false,
    configuresMaterialReview: false,
  });
  assert.deepEqual(getNodeSettingCapabilities("file"), {
    collectsInformation: false,
    configuresMaterialReview: true,
  });
});

test("信息填写只配置采集信息，材料上传只由文件节点配置", () => {
  assert.equal(getNodeSettingCapabilities("form").collectsInformation, true);
  assert.equal(getNodeSettingCapabilities("form").configuresMaterialReview, false);
  assert.equal(getNodeSettingCapabilities("file").configuresMaterialReview, true);
});

test("标准材料审核脚本以可选的标识同步返回脚本类型", () => {
  assert.deepEqual(resolveStandardAuditScript("check_material.py"), {
    name: "check_material.py",
    type: "py",
  });
  assert.deepEqual(resolveStandardAuditScript("check_filename.mjs"), {
    name: "check_filename.mjs",
    type: "mjs",
  });
});
