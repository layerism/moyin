import assert from "node:assert/strict";
import test from "node:test";

import { getAbsoluteShareUrl } from "../src/features/academic-flow/shareUrl.ts";

test("converts a relative student share path into a complete URL", () => {
  assert.equal(
    getAbsoluteShareUrl("/s/high-entropy-token", "http://localhost:5173"),
    "http://localhost:5173/s/high-entropy-token",
  );
});

test("keeps an already complete student share URL", () => {
  assert.equal(
    getAbsoluteShareUrl("https://oa.example.edu/s/high-entropy-token", "http://localhost:5173"),
    "https://oa.example.edu/s/high-entropy-token",
  );
});
