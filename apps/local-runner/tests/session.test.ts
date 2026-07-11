import assert from "node:assert/strict";
import test from "node:test";
import { createCodexTurnFailureError } from "../src/local-repair.js";
import { LocalRunnerSession, type LocalRunnerActions } from "../src/session.js";

function actionsThatFailRun(error: Error): LocalRunnerActions {
  return {
    async preflight() {
      return { codexVersion: "codex-cli 0.144.1", releaseCommit: "a".repeat(40), signedIn: true, modelAvailable: true };
    },
    async login() {},
    async run(_signal, onProgress) {
      onProgress({ phase: "codex", message: "Codex is writing" });
      throw error;
    },
    async cleanup() {},
  };
}

test("preflight usage exhaustion fails before Start with a fixed diagnostic", async () => {
  const actions = actionsThatFailRun(new Error("LOCAL_TEST_RUN_NOT_EXPECTED"));
  actions.preflight = async () => {
    throw new Error("LOCAL_CODEX_USAGE_LIMIT");
  };
  const session = new LocalRunnerSession(actions);
  await session.initialize();

  const snapshot = session.snapshot();
  assert.equal(snapshot.phase, "failed");
  assert.equal(snapshot.errorCode, "LOCAL_CODEX_USAGE_LIMIT");
  assert.match(snapshot.detail ?? "", /No build was started/);
  await assert.rejects(session.start(), /LOCAL_BUILD_NOT_READY/);
});

test("a turn-time reauth failure returns the session to needs-auth without raw details", async () => {
  const raw = "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.";
  const session = new LocalRunnerSession(
    actionsThatFailRun(createCodexTurnFailureError("failed", raw)),
  );
  await session.initialize();
  await session.start();

  const serialized = JSON.stringify(session.snapshot());
  assert.equal(session.snapshot().phase, "needs-auth");
  assert.equal(session.snapshot().errorCode, "LOCAL_CODEX_REAUTH_REQUIRED");
  assert.doesNotMatch(serialized, /refresh token|revoked|log out/i);
});

test("reauthentication clears failed run state before a clean retry", async () => {
  let runCount = 0;
  const actions: LocalRunnerActions = {
    async preflight() {
      return {
        codexVersion: "codex-cli 0.144.1",
        releaseCommit: "b".repeat(40),
        signedIn: true,
        modelAvailable: true,
        accountLabel: "ChatGPT plus",
      };
    },
    async login() {},
    async run(_signal, onProgress) {
      runCount += 1;
      onProgress({
        phase: "codex",
        message: "Codex is writing",
        threadId: `thread-${runCount}`,
      });
      if (runCount === 1) {
        throw createCodexTurnFailureError(
          "failed",
          "localized auth failure",
          "unauthorized",
        );
      }
      return {
        proof: { status: "PASSED" },
        diff: "candidate diff",
        summary: {
          status: "PASSED",
          proofDigest: `sha256:${"1".repeat(64)}`,
          diffDigest: `sha256:${"2".repeat(64)}`,
          threadId: "thread-2",
          model: "gpt-5.6-sol",
          testsPassed: 15,
          testsTotal: 15,
          scenariosPassed: 7,
          scenariosTotal: 7,
          assertionsPassed: 35,
          assertionCount: 35,
          mismatchCount: 0,
          changedFiles: ["apps/api/src/candidates/generated-return-workflow.ts"],
        },
      };
    },
    async cleanup() {},
  };
  const session = new LocalRunnerSession(actions);
  await session.initialize();
  await session.start();
  assert.equal(session.snapshot().phase, "needs-auth");
  assert.equal(session.snapshot().provenance.proof, "failed");

  await session.login();
  const ready = session.snapshot();
  assert.equal(ready.phase, "ready");
  assert.equal(ready.errorCode, undefined);
  assert.equal(ready.detail, undefined);
  assert.equal(ready.startedAt, undefined);
  assert.equal(ready.threadId, undefined);
  assert.equal(ready.result, undefined);
  assert.deepEqual(ready.provenance, {
    evidence: "recorded",
    codex: "waiting",
    verifier: "waiting",
    proof: "waiting",
  });

  await session.start();
  assert.equal(session.snapshot().phase, "passed");
  assert.equal(session.snapshot().threadId, "thread-2");
  assert.equal(session.snapshot().provenance.proof, "passed");
});

test("a turn-time usage failure exposes only its fixed code and safe copy", async () => {
  const raw = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:28 AM.";
  const session = new LocalRunnerSession(
    actionsThatFailRun(createCodexTurnFailureError("failed", raw)),
  );
  await session.initialize();
  await session.start();

  const serialized = JSON.stringify(session.snapshot());
  assert.equal(session.snapshot().phase, "failed");
  assert.equal(session.snapshot().errorCode, "LOCAL_CODEX_USAGE_LIMIT");
  assert.match(session.snapshot().detail ?? "", /No proof was issued/);
  assert.doesNotMatch(serialized, /chatgpt\.com|2:28|purchase more credits/i);
});

test("a completed verifier mismatch fails the proof without claiming verifier failure", async () => {
  const actions: LocalRunnerActions = {
    async preflight() {
      return { codexVersion: "codex-cli 0.144.1", releaseCommit: "a".repeat(40), signedIn: true, modelAvailable: true };
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
          testsPassed: 15,
          testsTotal: 15,
          scenariosPassed: 4,
          scenariosTotal: 7,
          assertionsPassed: 28,
          assertionCount: 35,
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
  assert.equal(snapshot.localReleaseCommit, "a".repeat(40));
  assert.equal(snapshot.title, "Fresh local proof issued — candidate does not conform");
  assert.match(snapshot.message, /4\/7 scenarios passed/);
  assert.equal(snapshot.provenance.verifier, "passed");
  assert.equal(snapshot.provenance.proof, "failed");
  assert.match(snapshot.detail ?? "", /verifier completed/);
});
