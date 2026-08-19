import assert from "node:assert/strict";
import test from "node:test";

import { filterPublishedNodeRevisionPatch } from "../src/features/academic-flow/flowRevision.ts";

test("published nodes keep prompt revisions while discarding locked audit changes", () => {
  assert.deepEqual(
    filterPublishedNodeRevisionPatch({
      scanAuditMode: "score",
      scanAuditPrompt: "检查签名、日期和印章是否完整",
    }),
    { scanAuditPrompt: "检查签名、日期和印章是否完整" },
  );
});
