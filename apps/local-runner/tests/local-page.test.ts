import assert from "node:assert/strict";
import test from "node:test";
import { renderLocalPage } from "../src/local-page.js";

test("failed verification diagnostics use only fixed command labels and commands", () => {
  const page = renderLocalPage({ nonce: "test-nonce", csrfToken: "test-csrf" });
  assert.match(page, /Verification command exited non-zero/);
  assert.match(page, /Candidate-safe API tests/);
  assert.match(page, /corepack pnpm --filter @traceforge\/api exec node --test/);
  assert.match(page, /Command output is not displayed; only its digests are included in the proof/);
  assert.doesNotMatch(page, /stdout\s*\+|stderr\s*\+/);
});
