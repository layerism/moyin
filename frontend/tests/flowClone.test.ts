import assert from "node:assert/strict";
import test from "node:test";

import {
  createFlowCloneName,
  getFlowCloneNameError,
} from "../src/features/academic-flow/flowClone.ts";

test("creates the required default clone name", () => {
  assert.equal(createFlowCloneName("实习流程"), "实习流程 - 副本");
});

test("validates trimmed clone names", () => {
  assert.equal(getFlowCloneNameError("   ", "实习流程", []), "请输入新流程名称");
  assert.equal(
    getFlowCloneNameError("实习流程", "实习流程", []),
    "副本名称不能与原流程相同",
  );
  assert.equal(
    getFlowCloneNameError("其他流程", "实习流程", ["其他流程"]),
    "已存在同名流程",
  );
  assert.equal(
    getFlowCloneNameError("新流程", "实习流程", []),
    "",
  );
  assert.equal(
    getFlowCloneNameError("x".repeat(121), "实习流程", []),
    "流程名称不能超过 120 个字符",
  );
});
