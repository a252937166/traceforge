import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  GENERATED_CANDIDATE_PATH,
  runCommand,
} from "../../api/src/codex-adapter.js";
import { cleanupLocalFixture, prepareLocalFixture } from "../src/fixture.js";
import {
  createCodexTurnFailureError,
  diagnoseLocalCommand,
  parseEvidenceBoundaryVerification,
  runBoundedTrustedHostCommand,
  runLocalRepair,
  verifyLocalProofDigest,
  type AppServerNotification,
  type LocalRepairAppServerClient,
} from "../src/local-repair.js";
import {
  TRACEFORGE_BUILD_PROFILE_ID,
  TRACEFORGE_VERIFY_PROFILE_ID,
} from "../src/permissions.js";
import { LOCAL_RUNNER_RELEASE_TAG } from "../src/manifest.js";
import {
  createReleaseTaggedCheckout,
  gitOutput,
} from "./release-checkout.js";

const generatedFunctionInput = "export function executeGeneratedReturnWorkflow(rawInput: unknown): WorkflowExecution {\n  const input = validateWorkflowInput(rawInput);\n";
const evidenceBoundaryGuard = `  if (input.itemCondition !== "DAMAGED") {\n    throw Object.assign(\n      new Error("input is outside the evidence-bounded DAMAGED-only contract"),\n      { code: "OUTSIDE_EVIDENCE_BOUNDARY" },\n    );\n  }\n`;

function withEvidenceBoundaryGuard(source: string): string {
  const guarded = source.replace(
    generatedFunctionInput,
    `${generatedFunctionInput}${evidenceBoundaryGuard}`,
  );
  assert.notEqual(guarded, source);
  return guarded;
}

test("Codex turn auth and usage failures collapse to fixed safe codes", () => {
  const reauthRaw = "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.";
  const usageRaw = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:28 AM.";

  const reauth = createCodexTurnFailureError("failed", reauthRaw);
  const usage = createCodexTurnFailureError("failed", usageRaw);
  assert.equal(reauth.message, "LOCAL_CODEX_REAUTH_REQUIRED");
  assert.equal(usage.message, "LOCAL_CODEX_USAGE_LIMIT");
  assert.doesNotMatch(`${reauth.message}\n${usage.message}`, /refresh token|chatgpt\.com|2:28/i);

  assert.equal(
    createCodexTurnFailureError("cancelled", "A different failure").message,
    "LOCAL_CODEX_TURN_CANCELLED:A different failure",
  );

  assert.equal(
    createCodexTurnFailureError("failed", "localized auth failure", "unauthorized").message,
    "LOCAL_CODEX_REAUTH_REQUIRED",
  );
  assert.equal(
    createCodexTurnFailureError("failed", "localized quota failure", "usageLimitExceeded").message,
    "LOCAL_CODEX_USAGE_LIMIT",
  );
});

class FakeBuildClient implements LocalRepairAppServerClient {
  private readonly listeners = new Set<(notification: AppServerNotification) => void>();

  constructor(
    private readonly writerRoot: string,
    private readonly repairedSource: string,
  ) {}

  onNotification(listener: (notification: AppServerNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request<T>(method: string): Promise<T> {
    if (method === "config/read") {
      return { config: { default_permissions: TRACEFORGE_BUILD_PROFILE_ID } } as T;
    }
    if (method === "thread/start") {
      return { thread: { id: "thread_fake_local" } } as T;
    }
    if (method === "turn/start") {
      await writeFile(join(this.writerRoot, GENERATED_CANDIDATE_PATH), this.repairedSource, "utf8");
      queueMicrotask(() => {
        const finalResponse = JSON.stringify({
          summary: "Rebuilt the complete bounded decision tree.",
          diagnosis: "The seeded candidate missed damaged inventory and rule priority.",
          changedFile: GENERATED_CANDIDATE_PATH,
          verificationIntent: "Run the independent differential suite.",
        });
        for (const listener of this.listeners) {
          listener({
            method: "item/completed",
            params: {
              threadId: "thread_fake_local",
              turnId: "turn_fake_local",
              item: { type: "agentMessage", text: finalResponse },
            },
          });
          listener({
            method: "turn/completed",
            params: {
              threadId: "thread_fake_local",
              turn: { id: "turn_fake_local", status: "completed", items: [] },
            },
          });
        }
      });
      return { turn: { id: "turn_fake_local" } } as T;
    }
    if (method === "turn/interrupt") return {} as T;
    throw new Error(`UNEXPECTED_BUILD_METHOD:${method}`);
  }
}

class FakeVerifyClient implements LocalRepairAppServerClient {
  onNotification(): () => void {
    return () => undefined;
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (method === "config/read") {
      return { config: { default_permissions: TRACEFORGE_VERIFY_PROFILE_ID } } as T;
    }
    if (method === "command/exec") {
      const value = params as {
        command: string[];
        cwd: string;
        env: Record<string, string>;
      };
      const result = await runCommand(
        value.command[0] ?? "",
        value.command.slice(1),
        value.cwd,
        value.env,
      );
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      } as T;
    }
    throw new Error(`UNEXPECTED_VERIFY_METHOD:${method}`);
  }
}

test("command diagnostics expose a safe architecture code without raw output", () => {
  const diagnostic = diagnoseLocalCommand(
    "apiTests",
    1,
    "You installed esbuild for another platform than the one currently in use. sk-do-not-show",
    "Authorization: Bearer do-not-show",
  );
  assert.equal(diagnostic, "TOOLCHAIN_ARCHITECTURE_MISMATCH");
  assert.doesNotMatch(diagnostic, /sk-do-not-show|Bearer/);
});

test("boundary probe parser accepts only the exact fail-closed evidence", () => {
  const valid = JSON.stringify({
    evidenceBoundary: {
      status: "PASSED",
      inputCondition: "SELLABLE",
      supportedCondition: "DAMAGED",
      failureCode: "OUTSIDE_EVIDENCE_BOUNDARY",
      failureMessage: "input is outside the evidence-bounded DAMAGED-only contract",
      resultReturned: false,
      sideEffectsCount: 0,
    },
  });
  assert.equal(
    parseEvidenceBoundaryVerification(valid).failureCode,
    "OUTSIDE_EVIDENCE_BOUNDARY",
  );
  assert.throws(
    () => parseEvidenceBoundaryVerification(valid.replace('"sideEffectsCount":0', '"sideEffectsCount":1')),
    /LOCAL_EVIDENCE_BOUNDARY_PROOF_INVALID/,
  );
});

test("trusted-host commands terminate promptly when the session is aborted", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const command = runBoundedTrustedHostCommand(
    [process.execPath, "-e", "setInterval(() => undefined, 1_000)"],
    process.cwd(),
    {},
    30_000,
    4_096,
    controller.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  controller.abort(new Error("LOCAL_TEST_ABORT"));

  await assert.rejects(command, /LOCAL_TEST_ABORT/);
  assert.ok(Date.now() - startedAt < 2_000, "abort must not wait for the command timeout");
});

test("trusted-host command timeouts are bounded and return a fixed diagnostic", async () => {
  const startedAt = Date.now();
  const result = await runBoundedTrustedHostCommand(
    [process.execPath, "-e", "setInterval(() => undefined, 1_000)"],
    process.cwd(),
    {},
    40,
    4_096,
  );

  assert.equal(result.exitCode, -1);
  assert.match(result.stderr, /LOCAL_TRUSTED_HOST_COMMAND_TIMEOUT/);
  assert.ok(Date.now() - startedAt < 2_000, "timeout cleanup must remain bounded");
});

test("local repair refuses to claim a release tag that moved after fixture preparation", async (t) => {
  const { repoRoot, releaseCommit } = await createReleaseTaggedCheckout(t);
  const fixture = await prepareLocalFixture(repoRoot, releaseCommit);
  t.after(() => cleanupLocalFixture(fixture));
  await gitOutput(repoRoot, ["tag", "--delete", LOCAL_RUNNER_RELEASE_TAG]);
  const events: string[] = [];

  await assert.rejects(
    runLocalRepair(
      {
        fixture,
        buildAppServer: new FakeBuildClient(fixture.writerRoot, fixture.baseCandidateSource),
        verifyAppServer: new FakeVerifyClient(),
      },
      (event) => {
        events.push(event.type);
      },
    ),
    /LOCAL_RELEASE_TAG_UNRESOLVED/,
  );
  assert.equal(events.includes("proof.completed"), false);
  assert.equal(events.includes("repair.failed"), true);
});

test("local repair cannot issue a proof when the generated function omits the early boundary guard", async (t) => {
  const { repoRoot, releaseCommit } = await createReleaseTaggedCheckout(t);
  const fixture = await prepareLocalFixture(repoRoot, releaseCommit);
  t.after(() => cleanupLocalFixture(fixture));
  const unguardedSource = await readFile(
    join(fixture.repoRoot, GENERATED_CANDIDATE_PATH),
    "utf8",
  );
  const events: string[] = [];
  await assert.rejects(
    runLocalRepair(
      {
        fixture,
        buildAppServer: new FakeBuildClient(fixture.writerRoot, unguardedSource),
        verifyAppServer: new FakeVerifyClient(),
      },
      (event) => {
        events.push(event.type);
      },
    ),
    /LOCAL_CANDIDATE_EVIDENCE_BOUNDARY_GUARD_REQUIRED/,
  );
  assert.equal(events.includes("proof.completed"), false);
  assert.equal(events.includes("repair.failed"), true);
});

test("local repair turns recorded evidence into a fresh recomputable proof", async (t) => {
  const { repoRoot, releaseCommit } = await createReleaseTaggedCheckout(t);
  const fixture = await prepareLocalFixture(repoRoot, releaseCommit);
  t.after(() => cleanupLocalFixture(fixture));
  const repairedSource = withEvidenceBoundaryGuard(await readFile(
    join(fixture.repoRoot, GENERATED_CANDIDATE_PATH),
    "utf8",
  ));
  const events: string[] = [];
  const result = await runLocalRepair(
    {
      fixture,
      buildAppServer: new FakeBuildClient(fixture.writerRoot, repairedSource),
      verifyAppServer: new FakeVerifyClient(),
      commandTimeoutMs: 120_000,
    },
    (event) => {
      events.push(`${event.stage}:${event.type}:${event.status}`);
    },
  );

  assert.equal(
    result.proof.status,
    "PASSED",
    JSON.stringify({
      commands: result.commands.map(({ name, exitCode, stderr }) => ({ name, exitCode, stderr })),
      suiteValidation: result.proof.verification.suiteValidation,
      tests: result.proof.verification.tests,
    }, null, 2),
  );
  assert.equal(result.proof.provenance.archaeology, "recorded-gpt-5.6");
  assert.equal(result.proof.provenance.build, "live-local-codex");
  assert.equal(result.proof.provenance.verification, "live-local-host");
  assert.equal(result.proof.runner.releaseCommit, releaseCommit);
  assert.equal(result.proof.verification.suite?.summary.passed, 7);
  assert.equal(result.proof.verification.tests?.candidateSafeTotal, 15);
  assert.deepEqual(result.proof.verification.evidenceBoundary, {
    status: "PASSED",
    inputCondition: "SELLABLE",
    supportedCondition: "DAMAGED",
    failureCode: "OUTSIDE_EVIDENCE_BOUNDARY",
    failureMessage: "input is outside the evidence-bounded DAMAGED-only contract",
    resultReturned: false,
    sideEffectsCount: 0,
  });
  assert.deepEqual(result.proof.verification.hostGates, {
    passed: 16,
    total: 16,
    focusedTests: 15,
    evidenceBoundaryChecks: 1,
  });
  assert.equal(result.proof.verification.commands[0]?.executor, "trusted-host");
  assert.deepEqual(
    result.proof.verification.commands.slice(1).map(({ executor }) => executor),
    ["app-server", "app-server", "app-server"],
  );
  assert.deepEqual(
    result.proof.verification.commands.map(({ diagnosticCode }) => diagnosticCode),
    ["OK", "OK", "OK", "OK"],
  );
  assert.equal(verifyLocalProofDigest(result.proof, releaseCommit), true);
  assert.equal(verifyLocalProofDigest(result.proof, "0".repeat(40)), false);
  assert.ok(events.includes("build:codex.turn-completed:passed"));
  assert.ok(events.includes("verify:verification-input.created:passed"));
  assert.ok(events.includes("complete:proof.completed:passed"));
});
