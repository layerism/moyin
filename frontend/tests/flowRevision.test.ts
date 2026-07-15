import assert from "node:assert/strict";
import test from "node:test";

import {
  canDeleteRevisionEdge,
  canEditRevisionNodeDeadline,
  canDeleteRevisionNode,
  createFlowConfig,
  createPublishRequestPayload,
  filterPublishedRuntimeNodes,
  layoutRevisionNodes,
  preservePublishedEdges,
  shouldReloadRevisionAfterConflict,
} from "../src/features/academic-flow/flowRevision.ts";
import type { AcademicProcess } from "../src/types.ts";

test("published nodes cannot be deleted from a revision", () => {
  assert.equal(canDeleteRevisionNode("old", ["old"]), false);
});

test("new unpublished nodes can be deleted", () => {
  assert.equal(canDeleteRevisionNode("new", ["old"]), true);
});

test("only edges added in the current revision can be deleted", () => {
  assert.equal(canDeleteRevisionEdge("published-edge", ["published-edge"]), false);
  assert.equal(canDeleteRevisionEdge("new-edge", ["published-edge"]), true);
});

test("missing published edges are restored while revision edges are retained", () => {
  const published = [{ id: "old", source: "a", target: "b" }];
  const revision = [{ id: "new", source: "b", target: "c" }];

  assert.deepEqual(preservePublishedEdges(revision, published), [
    published[0],
    revision[0],
  ]);
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

test("publish payload binds the previewed draft and current version baseline", () => {
  assert.deepEqual(createPublishRequestPayload("draft-sha256", "version-current"), {
    expectedDraftConfigHash: "draft-sha256",
    expectedCurrentVersionId: "version-current",
  });
  assert.deepEqual(createPublishRequestPayload(), {
    expectedDraftConfigHash: null,
    expectedCurrentVersionId: null,
  });
});

test("preview and publish share the exact process configuration", () => {
  const process = {
    edges: [{ id: "edge", source: "one", target: "two" }],
    nodes: [{ id: "one" }, { id: "two" }],
  } as unknown as AcademicProcess;

  assert.deepEqual(createFlowConfig(process), {
    edges: process.edges,
    nodes: process.nodes,
  });
});

test("revision baseline conflicts require a server reload", () => {
  assert.equal(shouldReloadRevisionAfterConflict(409, "draft-sha256", "version-current"), true);
  assert.equal(shouldReloadRevisionAfterConflict(409, undefined, undefined), true);
  assert.equal(shouldReloadRevisionAfterConflict(422, "draft-sha256", "version-current"), false);
});

test("only unpublished revision nodes allow draft deadline editing", () => {
  const currentNodes = ["published", "new"];

  assert.equal(canEditRevisionNodeDeadline("published", ["published"], currentNodes), false);
  assert.equal(canEditRevisionNodeDeadline("new", ["published"], currentNodes), true);
  assert.equal(canEditRevisionNodeDeadline("published", undefined, currentNodes), false);
  assert.equal(canEditRevisionNodeDeadline("new", undefined, currentNodes), false);
});
