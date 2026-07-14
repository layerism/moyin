import assert from "node:assert/strict";
import test from "node:test";

import {
  getInitialRevisionEditing,
  getPublishButtonState,
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

test("clean published flow uses the begin revision action", () => {
  assert.deepEqual(
    getPublishButtonState({
      hasUnpublishedChanges: false,
      operationLocked: false,
      published: true,
      revisionEditing: false,
      rosterActiveCount: 1,
    }),
    { action: "begin-revision", disabled: false, label: "流程修改", title: undefined },
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

test("published draft changes restore revision editing on load", () => {
  assert.equal(getInitialRevisionEditing(true, true), true);
  assert.equal(getInitialRevisionEditing(true, false), false);
  assert.equal(getInitialRevisionEditing(false, true), false);
});
