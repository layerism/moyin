import assert from "node:assert/strict";
import test from "node:test";

import {
  getScanAuditConfigError,
  getPublishButtonState,
} from "../src/features/academic-flow/publishButtonState.ts";

test("scan audit allows no template but still requires mode and prompt", () => {
  const node = {
    id: "confirm", kind: "confirmation" as const, title: "承诺书",
    scanAuditEnabled: true,
  } as Parameters<typeof getScanAuditConfigError>[0];
  assert.match(getScanAuditConfigError(node) ?? "", /审核模式/);
  node.scanAuditMode = "score";
  assert.match(getScanAuditConfigError(node) ?? "", /审核标准/);
  node.scanAuditPrompt = "按完整性评分";
  assert.equal(getScanAuditConfigError(node), undefined);
});

test("signing template can publish without AI review", () => {
  const node = {
    id: "confirm", kind: "confirmation" as const, title: "承诺书",
    scanAuditEnabled: false,
    templateAsset: { assetId: "a", contentType: "", originalName: "承诺书.docx", sha256: "a", sizeBytes: 1 },
  } as Parameters<typeof getScanAuditConfigError>[0];

  assert.equal(getScanAuditConfigError(node), undefined);
});

test("new draft uses the submit publish action", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: true,
      operationLocked: false,
      published: false,
      rosterActiveCount: 1,
    }),
    { action: "publish", disabled: false, label: "提交发布", title: undefined },
  );
});

test("published flow without changes disables republishing", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: false,
      operationLocked: false,
      published: true,
      rosterActiveCount: 1,
    }),
    { action: "republish", disabled: true, label: "重新发布", title: "当前没有待发布的修订" },
  );
});

test("published flow still requires students for republishing", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: false,
      operationLocked: false,
      published: true,
      rosterActiveCount: 0,
    }),
    {
      action: "republish",
      disabled: true,
      label: "重新发布",
      title: "请先导入学生名单",
    },
  );
});

test("staged revision remains available for republishing", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: true,
      operationLocked: false,
      published: true,
      rosterActiveCount: 1,
    }),
    { action: "republish", disabled: false, label: "重新发布", title: undefined },
  );
});

test("publish explains roster and operation locks", () => {
  const base = {
    hasUnpublishedChanges: true,
    operationLocked: false,
    published: false,
  };

  assert.deepEqual(getPublishButtonState({ ...base, rosterActiveCount: null }), {
    action: "publish",
    disabled: true,
    label: "提交发布",
    title: "正在读取学生名单",
  });
  assert.deepEqual(getPublishButtonState({ ...base, rosterActiveCount: 0 }), {
    action: "publish",
    disabled: true,
    label: "提交发布",
    title: "请先导入学生名单",
  });
  assert.equal(
    getPublishButtonState({
      ...base,
      operationLocked: true,
      rosterActiveCount: 1,
    }).disabled,
    true,
  );
});
