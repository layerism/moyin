import assert from "node:assert/strict";
import test from "node:test";

import {
  getPublishButtonState,
  getRevisionEditing,
} from "../src/features/academic-flow/publishButtonState.ts";

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

test("revision without changes keeps republish disabled", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: false,
      operationLocked: false,
      published: true,
      revisionEditing: true,
      rosterActiveCount: 1,
    }),
    {
      action: "republish",
      disabled: true,
      label: "重新发布",
      title: "当前没有待发布的修订",
    },
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

test("revision editing follows only the local unlock request", () => {
  assert.equal(getRevisionEditing(true, false), false);
  assert.equal(getRevisionEditing(true, true), true);
  assert.equal(getRevisionEditing(false, true), false);
});
