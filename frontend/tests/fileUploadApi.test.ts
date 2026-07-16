import assert from "node:assert/strict";
import test from "node:test";

import { createFileUploadBody } from "../src/features/academic-flow/fileUpload.ts";

test("createFileUploadBody creates multipart data with the selected file", () => {
  const body = createFileUploadBody(new File(["abc"], "材料.pdf", { type: "application/pdf" }));
  assert.ok(body instanceof FormData);
  assert.equal(body.get("file")?.name, "材料.pdf");
});
