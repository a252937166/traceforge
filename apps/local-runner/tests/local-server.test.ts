import assert from "node:assert/strict";
import test from "node:test";
import { startLocalRunnerServer } from "../src/local-server.js";
import {
  LocalRunnerSession,
  type LocalRunnerActions,
} from "../src/session.js";

function fakeActions(): LocalRunnerActions {
  return {
    async preflight() {
      return {
        codexVersion: "codex-cli 0.144.1",
        signedIn: true,
        accountLabel: "Codex signed in",
        modelAvailable: true,
      };
    },
    async login() {},
    async run(_signal, onProgress) {
      onProgress({ phase: "codex", message: "Codex is writing", threadId: "thread_local_1" });
      onProgress({ phase: "verifying", message: "Verifier is running" });
      return {
        diff: "diff --git a/candidate.ts b/candidate.ts\n",
        proof: { version: "traceforge.local-proof.v1", digest: "sha256:proof" },
        summary: {
          status: "PASSED",
          proofDigest: `sha256:${"1".repeat(64)}`,
          diffDigest: `sha256:${"2".repeat(64)}`,
          threadId: "thread_local_1",
          model: "gpt-5.6-sol",
          scenariosPassed: 6,
          scenariosTotal: 6,
          assertionsPassed: 30,
          assertionCount: 30,
          mismatchCount: 0,
          changedFiles: ["apps/api/src/candidates/generated-return-workflow.ts"],
        },
      };
    },
    async cleanup() {},
  };
}

test("localhost UI requires bootstrap auth and rejects cross-origin mutations", async (t) => {
  const session = new LocalRunnerSession(fakeActions());
  await session.initialize();
  const server = await startLocalRunnerServer(session, { closeOnDelete: false });
  t.after(() => server.close());

  const unauthorized = await fetch(`${server.origin}/local`);
  assert.equal(unauthorized.status, 401);

  const bootstrap = await fetch(server.url, { redirect: "manual" });
  assert.equal(bootstrap.status, 303);
  assert.equal(bootstrap.headers.get("location"), "/local");
  const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);

  const page = await fetch(`${server.origin}/local`, { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  const html = await page.text();
  assert.match(html, /Build one bounded workflow on this machine/);
  const csrf = /const csrf = "([A-Za-z0-9_-]+)";/.exec(html)?.[1];
  assert.ok(csrf);

  const crossOrigin = await fetch(`${server.origin}/api/start`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "https://traceforge.axiqo.xyz",
      "Content-Type": "application/json",
      "X-TraceForge-CSRF": csrf,
    },
    body: "{}",
  });
  assert.equal(crossOrigin.status, 403);

  const start = await fetch(`${server.origin}/api/start`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: server.origin,
      "Content-Type": "application/json",
      "X-TraceForge-CSRF": csrf,
    },
    body: "{}",
  });
  assert.equal(start.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 20));
  const stateResponse = await fetch(`${server.origin}/api/state`, { headers: { Cookie: cookie } });
  const state = await stateResponse.json() as { phase: string; result?: { scenariosPassed: number } };
  assert.equal(state.phase, "passed");
  assert.equal(state.result?.scenariosPassed, 6);

  const proof = await fetch(`${server.origin}/api/proof`, { headers: { Cookie: cookie } });
  assert.equal(proof.status, 200);
  assert.equal((await proof.json() as { version: string }).version, "traceforge.local-proof.v1");

  const proofView = await fetch(`${server.origin}/api/proof?view=html`, { headers: { Cookie: cookie } });
  assert.equal(proofView.status, 200);
  assert.match(proofView.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await proofView.text(), /Passing local proof/);

  const diffView = await fetch(`${server.origin}/api/diff?view=html`, { headers: { Cookie: cookie } });
  assert.equal(diffView.status, 200);
  assert.match(await diffView.text(), /Bounded candidate diff/);
});

test("failed runs expose only fixed diagnostics and keep failed proof inspectable", async (t) => {
  const secret = "sk-do-not-expose-12345678";
  const actions: LocalRunnerActions = {
    async preflight() {
      return { codexVersion: "codex-cli 0.144.1", signedIn: true, modelAvailable: true };
    },
    async login() {},
    async run(_signal, onProgress) {
      onProgress({
        phase: "verifying",
        message: "Verifier is running",
        detail: `Authorization: Bearer ${secret}`,
      });
      return {
        diff: "diff --git a/candidate.ts b/candidate.ts\n",
        proof: {
          version: "traceforge.local-proof.v1",
          status: "FAILED",
          verification: {
            commands: [{
              name: "apiTests",
              exitCode: 1,
              diagnosticCode: "CANDIDATE_TESTS_FAILED",
              stdoutDigest: `sha256:${"3".repeat(64)}`,
              stderrDigest: `sha256:${"4".repeat(64)}`,
            }],
          },
        },
        summary: {
          status: "FAILED",
          proofDigest: `sha256:${"1".repeat(64)}`,
          diffDigest: `sha256:${"2".repeat(64)}`,
          threadId: "thread_failed_local",
          model: "gpt-5.6-sol",
          scenariosPassed: 0,
          scenariosTotal: 0,
          assertionsPassed: 0,
          assertionCount: 0,
          mismatchCount: 0,
          changedFiles: ["apps/api/src/candidates/generated-return-workflow.ts"],
          failedCommand: "apiTests",
          failureCode: "CANDIDATE_TESTS_FAILED",
        },
      };
    },
    async cleanup() {},
  };
  const session = new LocalRunnerSession(actions);
  await session.initialize();
  await session.start();
  const server = await startLocalRunnerServer(session, { closeOnDelete: false });
  t.after(() => server.close());

  const bootstrap = await fetch(server.url, { redirect: "manual" });
  const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const stateResponse = await fetch(`${server.origin}/api/state`, { headers: { Cookie: cookie } });
  const rawState = await stateResponse.text();
  const state = JSON.parse(rawState) as {
    phase: string;
    detail: string;
    result?: { failedCommand?: string; failureCode?: string };
  };
  assert.equal(state.phase, "failed");
  assert.equal(state.result?.failedCommand, "apiTests");
  assert.equal(state.result?.failureCode, "CANDIDATE_TESTS_FAILED");
  assert.match(state.detail, /proof remains FAILED/);
  assert.doesNotMatch(rawState, new RegExp(secret));

  const proofView = await fetch(`${server.origin}/api/proof?view=html`, { headers: { Cookie: cookie } });
  assert.equal(proofView.status, 200);
  assert.match(await proofView.text(), /Failed local proof/);
});
