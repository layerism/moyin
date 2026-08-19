import assert from "node:assert/strict";
import test from "node:test";

import { filterPublishedNodeRevisionPatch } from "../src/features/academic-flow/flowRevision.ts";

test("published revision patches discard audit changes saved through the policy endpoint", () => {
  assert.deepEqual(
    filterPublishedNodeRevisionPatch({
      scanAuditMode: "score",
      scanAuditPrompt: "检查签名、日期和印章是否完整",
    }),
    {},
  );
});
