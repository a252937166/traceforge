import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_RUNNER_MANIFEST,
  LOCAL_RUNNER_RELEASE_TAG,
  LOCAL_RUNNER_VERSION,
  validateLocalRunnerManifest,
} from "../src/manifest.js";

test("the release candidate identifies Local Runner v0.1.10", () => {
  assert.equal(LOCAL_RUNNER_VERSION, "0.1.10");
  assert.equal(LOCAL_RUNNER_RELEASE_TAG, "local-runner-v0.1.10");
  assert.equal(LOCAL_RUNNER_MANIFEST.runnerVersion, LOCAL_RUNNER_VERSION);
  assert.equal(LOCAL_RUNNER_MANIFEST.releaseTag, LOCAL_RUNNER_RELEASE_TAG);
});

test("the fixed local demo manifest accepts only its exact pinned values", () => {
  assert.doesNotThrow(() => validateLocalRunnerManifest(structuredClone(LOCAL_RUNNER_MANIFEST)));

  const mutated = structuredClone(LOCAL_RUNNER_MANIFEST) as unknown as Record<string, unknown>;
  mutated.baseCommit = "HEAD";
  assert.throws(() => validateLocalRunnerManifest(mutated), /LOCAL_MANIFEST_BASECOMMIT_INVALID/);

  const expanded = { ...structuredClone(LOCAL_RUNNER_MANIFEST), command: "rm -rf" };
  assert.throws(() => validateLocalRunnerManifest(expanded), /LOCAL_MANIFEST_FIELDS_INVALID/);
});
