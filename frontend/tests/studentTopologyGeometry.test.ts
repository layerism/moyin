import assert from "node:assert/strict";
import test from "node:test";

import {
  createStudentEdgeGeometries,
  getStudentCanvasBounds,
} from "../src/features/academic-flow/studentTopologyGeometry.ts";

const nodes = [
  { id: "n1", x: 32, y: 48 },
  { id: "n2", x: 480, y: 400 },
];

test("student canvas bounds include every saved node position", () => {
  assert.deepEqual(getStudentCanvasBounds(nodes), { height: 622, width: 856 });
});

test("student edge path uses a cubic curve between node borders", () => {
  const geometry = createStudentEdgeGeometries(
    [{
      id: "e1",
      source: "n1",
      sourcePort: "bottom",
      target: "n2",
      targetPort: "top",
    }],
    nodes,
  ).get("e1");

  assert.ok(geometry);
  assert.equal(geometry.path.includes(" C "), true);
  assert.equal(geometry.sourceY, 174);
  assert.equal(geometry.targetY, 400);
});

test("shared ports fan out and fan in for a two-by-two dependency graph", () => {
  const graphNodes = [
    { id: "a", x: 32, y: 48 },
    { id: "b", x: 480, y: 48 },
    { id: "1", x: 32, y: 400 },
    { id: "2", x: 480, y: 400 },
  ];
  const geometries = createStudentEdgeGeometries([
    { id: "a-1", source: "a", sourcePort: "bottom", target: "1", targetPort: "top" },
    { id: "a-2", source: "a", sourcePort: "bottom", target: "2", targetPort: "top" },
    { id: "b-1", source: "b", sourcePort: "bottom", target: "1", targetPort: "top" },
    { id: "b-2", source: "b", sourcePort: "bottom", target: "2", targetPort: "top" },
  ], graphNodes);

  const a1 = geometries.get("a-1");
  const a2 = geometries.get("a-2");
  const b1 = geometries.get("b-1");
  assert.ok(a1 && a2 && b1);

  assert.notEqual(a1.sourceX, a2.sourceX);
  assert.notEqual(a1.targetX, b1.targetX);
  assert.equal([...geometries.values()].every(({ path }) => path.includes(" C ")), true);
});
