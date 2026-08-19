import assert from "node:assert/strict";
import test from "node:test";

import { getAcademicFlowStatus } from "../src/features/academic-flow/academicFlowStatus.ts";

test("marks flows that have never been published as drafts", () => {
  assert.deepEqual(
    getAcademicFlowStatus({ published: false, hasUnpublishedChanges: false }),
    { label: "草稿", tone: "draft" },
  );
});

test("marks unchanged published flows as published", () => {
  assert.deepEqual(
    getAcademicFlowStatus({ published: true, hasUnpublishedChanges: false }),
    { label: "已发布", tone: "published" },
  );
});

test("marks published flows with draft changes as changed", () => {
  assert.deepEqual(
    getAcademicFlowStatus({ published: true, hasUnpublishedChanges: true }),
    { label: "已发布 · 有待发布修改", tone: "changed" },
  );
});
