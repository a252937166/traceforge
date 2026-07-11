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
  assert.match(page, /Local gate/);
  assert.match(page, /15 focused candidate tests \+ 7 differential scenarios/);
  assert.match(page, /55 candidate-safe tests \+ 4 separate replay guards/);
  assert.match(page, /metric-tests/);
  assert.match(page, /Local executable/);
  assert.match(page, /snapshot\.localReleaseCommit/);
});

test("embedded browser script is syntactically executable", () => {
  const page = renderLocalPage({ nonce: "test-nonce", csrfToken: "test-csrf" });
  const script = page.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "expected the Local Runner inline script");
  assert.doesNotThrow(() => new Function(script));
});
