import assert from "node:assert/strict";
import test from "node:test";

import { getScanSubmitBlocker } from "../src/features/academic-flow/ScanUploadWorkspace.tsx";

test("scan submission requires template, confirmation and an uploaded file", () => {
  const base = { confirmed: true, scanRequired: true, scans: [], templateDownloaded: true, uploading: false };
  assert.match(getScanSubmitBlocker({ ...base, confirmed: false }) ?? "", /确认/);
  assert.match(getScanSubmitBlocker({ ...base, templateDownloaded: false }) ?? "", /模板/);
  assert.match(getScanSubmitBlocker(base) ?? "", /上传/);
  assert.equal(getScanSubmitBlocker({ ...base, scans: [{ fileId: "f", originalName: "a.jpg", contentType: "image/jpeg", sizeBytes: 1, pageCount: 1, order: 0 }] }), null);
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
