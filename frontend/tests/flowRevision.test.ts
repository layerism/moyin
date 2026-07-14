import assert from "node:assert/strict";
import test from "node:test";

import {
  canDeleteRevisionNode,
  filterPublishedRuntimeNodes,
  layoutRevisionNodes,
} from "../src/features/academic-flow/flowRevision.ts";

test("published nodes cannot be deleted from a revision", () => {
  assert.equal(canDeleteRevisionNode("old", ["old"]), false);
});

test("new unpublished nodes can be deleted", () => {
  assert.equal(canDeleteRevisionNode("new", ["old"]), true);
});

test("missing published metadata fails closed for existing nodes", () => {
  assert.equal(canDeleteRevisionNode("old", undefined, ["old", "new"]), false);
  assert.equal(canDeleteRevisionNode("new", undefined, ["old", "new"]), false);
});

test("runtime controls include only nodes from the current published version", () => {
  const nodes = [
    { id: "old", title: "已发布节点" },
    { id: "new", title: "修订新增节点" },
  ];

  assert.deepEqual(filterPublishedRuntimeNodes(nodes, ["old"]), [nodes[0]]);
  assert.deepEqual(filterPublishedRuntimeNodes(nodes, undefined), []);
});

test("automatic layout merges all node positions in one immutable result", () => {
  const nodes = [
    { id: "one", title: "节点一", x: 0, y: 0 },
    { id: "two", title: "节点二", x: 0, y: 0 },
    { id: "three", title: "节点三", x: 0, y: 0 },
  ];

  const result = layoutRevisionNodes(nodes);

  assert.deepEqual(
    result.map(({ id, x, y }) => ({ id, x, y })),
    [
      { id: "one", x: 176, y: 64 },
      { id: "two", x: 496, y: 64 },
      { id: "three", x: 176, y: 256 },
    ],
  );
  assert.equal(result[0].title, "节点一");
  assert.notEqual(result, nodes);
});
