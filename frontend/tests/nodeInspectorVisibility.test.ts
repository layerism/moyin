import assert from "node:assert/strict";
import test from "node:test";

import { hasFileUploadSettings } from "../src/features/academic-flow/academicFlowData.ts";

test("信息填写节点不提供文件上传设置", () => {
  assert.equal(hasFileUploadSettings("form"), false);
});

test("文件上传节点保留文件上传设置", () => {
  assert.equal(hasFileUploadSettings("file"), true);
});
