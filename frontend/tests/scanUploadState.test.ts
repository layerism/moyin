import assert from "node:assert/strict";
import test from "node:test";

import {
  getScanFilenameError,
  getScanSubmitBlocker,
  shouldPromptTemplateDownload,
} from "../src/features/academic-flow/ScanUploadWorkspace.tsx";

test("scan submission requires template, confirmation and an uploaded file", () => {
  const base = {
    confirmed: true,
    scanRequired: true,
    scans: [],
    templateDownloaded: true,
    uploading: false,
  };
  assert.match(getScanSubmitBlocker({ ...base, confirmed: false }) ?? "", /确认/);
  assert.match(getScanSubmitBlocker({ ...base, templateDownloaded: false }) ?? "", /模板/);
  assert.match(getScanSubmitBlocker(base) ?? "", /上传/);
});

test("scan filename error identifies the first file that does not match the template", () => {
  const scan = (fileId: string, originalName: string) => ({
    contentType: "image/jpeg",
    fileId,
    order: 0,
    originalName,
    pageCount: 1,
    sizeBytes: 1,
  });
  const base = {
    templateFilename: "安全责任书.docx",
  };

  assert.equal(getScanFilenameError({ ...base, filenames: ["安全责任书.jpg"] }), null);
  assert.equal(getScanFilenameError({ ...base, filenames: ["安全责任书第1页.png"] }), null);
  assert.equal(getScanFilenameError({
    ...base,
    filenames: ["安全责任书第1页.jpg", "安全责任书(2).jpeg"],
  }), null);
  assert.equal(getScanFilenameError({
    ...base,
    filenames: ["A\u030A承诺书第1页.PNG"],
    templateFilename: "Å承诺书.docx",
  }), null);
  assert.match(getScanFilenameError({
    ...base,
    filenames: ["安全责任书第1页.jpg", "扫描件2.jpg"],
  }) ?? "", /文件“扫描件2\.jpg”.*安全责任书/);
  assert.equal(getScanSubmitBlocker({
    confirmed: true,
    scanRequired: true,
    scans: [scan("2", "扫描件2.jpg")],
    templateDownloaded: true,
    uploading: false,
  }), null);
});

test("scan filename validation rejects a mixed selected batch before upload", () => {
  assert.match(getScanFilenameError({
    filenames: ["安全责任书第1页.jpg", "其他材料.png", "安全责任书第3页.jpeg"],
    templateFilename: "安全责任书.docx",
  }) ?? "", /文件“其他材料\.png”.*安全责任书/);
});

test("confirmation without a signing template does not require scans", () => {
  assert.equal(getScanSubmitBlocker({
    confirmed: true,
    scanRequired: false,
    scans: [],
    templateDownloaded: false,
    uploading: false,
  }), null);
});

test("template download reminder only handles an otherwise interactive locked upload zone", () => {
  assert.equal(shouldPromptTemplateDownload({ disabled: false, templateLocked: true }), true);
  assert.equal(shouldPromptTemplateDownload({ disabled: true, templateLocked: true }), false);
  assert.equal(shouldPromptTemplateDownload({ disabled: false, templateLocked: false }), false);
});
