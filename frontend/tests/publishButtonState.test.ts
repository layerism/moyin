import assert from "node:assert/strict";
import test from "node:test";

import {
  getScanAuditConfigError,
  getPublishButtonState,
  getRevisionEditing,
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
      revisionEditing: false,
      rosterActiveCount: 1,
    }),
    { action: "publish", disabled: false, label: "提交发布", title: undefined },
  );
});

test("locked published flow uses the unlock edit action", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: false,
      operationLocked: false,
      published: true,
      revisionEditing: false,
      rosterActiveCount: 1,
    }),
    { action: "begin-revision", disabled: false, label: "解锁编辑", title: undefined },
  );
});

test("revision without changes offers a local revision exit", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: false,
      operationLocked: false,
      published: true,
      revisionEditing: true,
      rosterActiveCount: 0,
    }),
    {
      action: "finish-revision",
      disabled: false,
      label: "退出编辑",
      title: undefined,
    },
  );
});

test("staged revision remains available for republishing", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: true,
      operationLocked: false,
      published: true,
      revisionEditing: true,
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
    revisionEditing: false,
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

test("revision editing follows local unlock or a staged server revision", () => {
  assert.equal(getRevisionEditing(true, false, true), true);
  assert.equal(getRevisionEditing(true, false, false), false);
  assert.equal(getRevisionEditing(true, true, false), true);
  assert.equal(getRevisionEditing(false, true, true), false);
});
