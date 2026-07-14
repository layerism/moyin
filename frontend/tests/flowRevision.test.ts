import assert from "node:assert/strict";
import test from "node:test";

import { canDeleteRevisionNode } from "../src/features/academic-flow/flowRevision.ts";

test("published nodes cannot be deleted from a revision", () => {
  assert.equal(canDeleteRevisionNode("old", ["old"]), false);
});

test("new unpublished nodes can be deleted", () => {
  assert.equal(canDeleteRevisionNode("new", ["old"]), true);
});
