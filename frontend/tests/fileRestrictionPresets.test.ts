import assert from "node:assert/strict";
import test from "node:test";

import {
  fileTypeRestrictionPresets,
  getFileExtensionsForPreset,
  getFileTypeRestrictionPreset,
} from "../src/features/academic-flow/academicFlowData.ts";

test("文字文档预设只允许 PDF 和 Word 文件", () => {
  assert.equal(getFileExtensionsForPreset("document"), "pdf, doc, docx");
  assert.equal(getFileTypeRestrictionPreset("pdf, doc, docx"), "document");
});

test("文件类型预设名称列出对应文件后缀", () => {
  assert.equal(
    fileTypeRestrictionPresets.find((preset) => preset.value === "document")?.label,
    "文字文档（.pdf、.doc、.docx）",
  );
  assert.equal(
    fileTypeRestrictionPresets.find((preset) => preset.value === "image")?.label,
    "图片文件（.jpg、.jpeg、.png）",
  );
});

test("空的文件类型配置表示不限制类型", () => {
  assert.equal(getFileTypeRestrictionPreset(""), "none");
});
