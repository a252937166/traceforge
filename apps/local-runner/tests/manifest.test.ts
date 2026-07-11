import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_RUNNER_MANIFEST,
  validateLocalRunnerManifest,
} from "../src/manifest.js";

test("the fixed local demo manifest accepts only its exact pinned values", () => {
  assert.doesNotThrow(() => validateLocalRunnerManifest(structuredClone(LOCAL_RUNNER_MANIFEST)));

  const mutated = structuredClone(LOCAL_RUNNER_MANIFEST) as unknown as Record<string, unknown>;
  mutated.baseCommit = "HEAD";
  assert.throws(() => validateLocalRunnerManifest(mutated), /LOCAL_MANIFEST_BASECOMMIT_INVALID/);

  const expanded = { ...structuredClone(LOCAL_RUNNER_MANIFEST), command: "rm -rf" };
  assert.throws(() => validateLocalRunnerManifest(expanded), /LOCAL_MANIFEST_FIELDS_INVALID/);
});

