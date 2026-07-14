import assert from "node:assert/strict";
import test from "node:test";

import {
  createStudentEdgePath,
  getStudentCanvasBounds,
} from "../src/features/academic-flow/studentTopologyGeometry.ts";

const nodes = [
  { id: "n1", x: 32, y: 48 },
  { id: "n2", x: 480, y: 400 },
];

test("student canvas bounds include every saved node position", () => {
  assert.deepEqual(getStudentCanvasBounds(nodes), { height: 622, width: 856 });
});

test("student edge path uses orthogonal line segments between node borders", () => {
  const path = createStudentEdgePath(
    {
      id: "e1",
      source: "n1",
      sourcePort: "bottom",
      target: "n2",
      targetPort: "top",
    },
    nodes,
  );

  assert.equal(path, "M 172 174 L 172 287 L 620 287 L 620 400");
  assert.equal(path.includes("C"), false);
});
