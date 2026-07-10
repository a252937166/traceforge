import assert from "node:assert/strict";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import {
  buildCodexStatus,
  CodexRepairAdapter,
  GENERATED_CANDIDATE_PATH,
  validateChangedFiles,
  type CodexRepairResult,
} from "../src/codex-adapter.js";
import { TraceForgeService } from "../src/service.js";
import { ArtifactStore } from "../src/store.js";
import type { ProofBundle } from "../src/types.js";

class FakeCodexRepairAdapter extends CodexRepairAdapter {
  calls: ProofBundle[] = [];

  constructor(private readonly result: CodexRepairResult) {
    super({ env: { TRACEFORGE_ENABLE_CODEX: "1" } });
  }

  override status() {
    return buildCodexStatus({ TRACEFORGE_ENABLE_CODEX: "1" }, true);
  }

  override async repair(proof: ProofBundle): Promise<CodexRepairResult> {
    this.calls.push(proof);
    return this.result;
  }
}

function fakeRepairResult(status: "PASSED" | "FAILED"): CodexRepairResult {
  return {
    codexExecuted: true,
    threadId: "thread_http_contract_001",
    usage: {
      input_tokens: 120,
      cached_input_tokens: 20,
      output_tokens: 40,
      reasoning_output_tokens: 10,
    },
    changedFiles: [GENERATED_CANDIDATE_PATH],
    diff: "- if (input.amountCents < 50_000) refund();\n+ if (input.amountCents >= 50_000) review();",
    structuredOutput: {
      summary: "Changed damaged returns to quarantine.",
      diagnosis: "The candidate restored a damaged item to sellable inventory.",
      changedFile: GENERATED_CANDIDATE_PATH,
      verificationIntent: "Rerun the generated candidate against the failed proof.",
    },
    verification: {
      status,
      whitelist: validateChangedFiles([GENERATED_CANDIDATE_PATH]),
    },
    worktree: {
      path: "/tmp/traceforge-contract-worktree",
      baseCommit: "0123456789abcdef",
      retained: true,
    },
  };
}

async function withRepairApi(
  result: CodexRepairResult,
  assertion: (context: {
    baseUrl: string;
    service: TraceForgeService;
    adapter: FakeCodexRepairAdapter;
  }) => Promise<void>,
): Promise<void> {
  const store = new ArtifactStore(":memory:");
  const service = new TraceForgeService(store);
  const adapter = new FakeCodexRepairAdapter(result);
  const { app } = createApp({ store, service, codexAdapter: adapter, env: {} });
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("repair test server did not bind TCP");

  try {
    await assertion({ baseUrl: `http://127.0.0.1:${address.port}`, service, adapter });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
  }
}

async function postRepair(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/adapters/codex/repair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("repair returns 400 when proofId is missing without invoking Codex", async () => {
  await withRepairApi(fakeRepairResult("PASSED"), async ({ baseUrl, adapter }) => {
    const response = await postRepair(baseUrl, {});
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "INVALID_REQUEST");
    assert.equal(adapter.calls.length, 0);
  });
});

test("repair returns 404 for an unknown proof without invoking Codex", async () => {
  await withRepairApi(fakeRepairResult("PASSED"), async ({ baseUrl, adapter }) => {
    const response = await postRepair(baseUrl, { proofId: "proof_does_not_exist" });
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error.code, "NOT_FOUND");
    assert.equal(adapter.calls.length, 0);
  });
});

test("repair returns 409 for a passing proof without invoking Codex", async () => {
  await withRepairApi(fakeRepairResult("PASSED"), async ({ baseUrl, service, adapter }) => {
    const passingRun = service.runDemo({
      scenarioId: "observed-standard-damaged-4500",
      candidateVersion: "generated",
    });
    const response = await postRepair(baseUrl, { proofId: passingRun.proofBundle.proofId });
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.error.code, "PROOF_NOT_FAILED");
    assert.equal(adapter.calls.length, 0);
  });
});

test("repair returns the typed fake adapter result with HTTP 200 after a failed proof", async () => {
  const result = fakeRepairResult("PASSED");
  await withRepairApi(result, async ({ baseUrl, service, adapter }) => {
    const failedRun = service.runDemo({
      scenarioId: "observed-standard-damaged-4500",
      candidateVersion: "seeded",
    });
    const response = await postRepair(baseUrl, { proofId: failedRun.proofBundle.proofId });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.codexExecuted, true);
    assert.equal(body.data.threadId, result.threadId);
    assert.equal(body.data.verification.status, "PASSED");
    assert.deepEqual(body.data.changedFiles, [GENERATED_CANDIDATE_PATH]);
    assert.equal(adapter.calls.length, 1);
    assert.equal(adapter.calls[0]?.proofId, failedRun.proofBundle.proofId);
  });
});

test("repair returns the typed fake adapter result with HTTP 422 when verification fails", async () => {
  const result = fakeRepairResult("FAILED");
  await withRepairApi(result, async ({ baseUrl, service, adapter }) => {
    const failedRun = service.runDemo({
      scenarioId: "observed-standard-damaged-4500",
      candidateVersion: "seeded",
    });
    const response = await postRepair(baseUrl, { proofId: failedRun.proofBundle.proofId });
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.data.codexExecuted, true);
    assert.equal(body.data.threadId, result.threadId);
    assert.equal(body.data.verification.status, "FAILED");
    assert.equal(body.error, undefined);
    assert.equal(adapter.calls.length, 1);
  });
});
