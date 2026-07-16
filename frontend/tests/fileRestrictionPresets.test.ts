import assert from "node:assert/strict";
import test from "node:test";

import {
  getFileExtensionsForPreset,
  getFileTypeRestrictionPreset,
} from "../src/features/academic-flow/academicFlowData.ts";

test("文字文档预设只允许 PDF 和 Word 文件", () => {
  assert.equal(getFileExtensionsForPreset("document"), "pdf, doc, docx");
  assert.equal(getFileTypeRestrictionPreset("pdf, doc, docx"), "document");
});

test("空的文件类型配置表示不限制类型", () => {
  assert.equal(getFileTypeRestrictionPreset(""), "none");
});
