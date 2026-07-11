import assert from "node:assert/strict";
import test from "node:test";
import { LocalRunnerSession, type LocalRunnerActions } from "../src/session.js";

test("a completed verifier mismatch fails the proof without claiming verifier failure", async () => {
  const actions: LocalRunnerActions = {
    async preflight() {
      return { codexVersion: "codex-cli 0.144.1", signedIn: true, modelAvailable: true };
    },
    async login() {},
    async run() {
      return {
        proof: { status: "FAILED" },
        diff: "candidate diff",
        summary: {
          status: "FAILED",
          proofDigest: `sha256:${"1".repeat(64)}`,
          diffDigest: `sha256:${"2".repeat(64)}`,
          threadId: "thread-mismatch",
          model: "gpt-5.6-sol",
          scenariosPassed: 4,
          scenariosTotal: 6,
          assertionsPassed: 28,
          assertionCount: 30,
          mismatchCount: 2,
          changedFiles: ["apps/api/src/candidates/generated-return-workflow.ts"],
          failedCommand: "generatedSuite",
          failureCode: "DIFFERENTIAL_SUITE_FAILED",
        },
      };
    },
    async cleanup() {},
  };
  const session = new LocalRunnerSession(actions);
  await session.initialize();
  await session.start();

  const snapshot = session.snapshot();
  assert.equal(snapshot.phase, "failed");
  assert.equal(snapshot.title, "Fresh local proof issued — candidate does not conform");
  assert.match(snapshot.message, /4\/6 scenarios passed/);
  assert.equal(snapshot.provenance.verifier, "passed");
  assert.equal(snapshot.provenance.proof, "failed");
  assert.match(snapshot.detail ?? "", /verifier completed/);
});
