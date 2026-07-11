import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { CodexRepairAdapter } from "../src/codex-adapter.js";
import { ArtifactStore } from "../src/store.js";

const store = new ArtifactStore(":memory:");
const { app, migrationStore } = createApp({
  store,
  codexAdapter: new CodexRepairAdapter({ env: {} }),
  release: {
    sha: "a".repeat(40),
    version: "local-runner-v0.1.9",
    builtAt: "2026-07-11T14:30:00.000Z",
  },
  env: { TRACEFORGE_ENABLE_GPT56: "0", TRACEFORGE_ENABLE_CODEX: "0" },
});
let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind TCP");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  migrationStore.close();
  store.close();
});

test("health and scenarios are available", async () => {
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  const scenarioResponse = await fetch(`${baseUrl}/api/scenarios`).then((response) => response.json());
  assert.equal(health.status, "ok");
  assert.equal(health.codexConfigured, false);
  assert.equal(health.codexStatus.mode, "disabled");
  assert.deepEqual(health.release, {
    sha: "a".repeat(40),
    version: "local-runner-v0.1.9",
    builtAt: "2026-07-11T14:30:00.000Z",
  });
  assert.equal(scenarioResponse.data.length, 6);
  assert.deepEqual(
    scenarioResponse.data.map((scenario: { stage: string }) => scenario.stage),
    ["observed", "observed", "counterexample", "counterexample", "boundary", "boundary"],
  );
  assert.equal(scenarioResponse.data.every(({ visibility }: { visibility: string }) => visibility === "visible"), true);
});

test("CORS allows local frontend origins and rejects untrusted browser origins", async () => {
  const expectedLocalOrigins = [
    "http://localhost",
    "http://localhost:5173",
    "http://127.0.0.1",
    "http://127.0.0.1:4173",
  ];
  for (const origin of expectedLocalOrigins) {
    const allowedResponse = await fetch(`${baseUrl}/api/health`, {
      headers: { origin },
    });
    assert.equal(allowedResponse.status, 200);
    assert.equal(allowedResponse.headers.get("access-control-allow-origin"), origin);
  }

  const unexpectedLocalPortResponse = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "http://127.0.0.1:9999" },
  });
  const rejectedResponse = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "https://evil.example" },
  });
  const rejected = await rejectedResponse.json();

  assert.equal(unexpectedLocalPortResponse.status, 403);
  assert.equal(unexpectedLocalPortResponse.headers.get("access-control-allow-origin"), null);
  assert.equal(rejectedResponse.status, 403);
  assert.equal(rejected.error.code, "CORS_ORIGIN_DENIED");
  assert.equal(rejectedResponse.headers.get("access-control-allow-origin"), null);
});

test("verification response exposes deterministic evidence and a retrievable proof", async () => {
  const response = await fetch(`${baseUrl}/api/verifications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scenarioId: "observed-standard-damaged-4500",
      candidateVersion: "seeded",
    }),
  });
  const { data: run } = await response.json();
  assert.equal(response.status, 201);
  assert.equal(run.status, "FAILED");
  assert.equal(run.source, "deterministic-local-demo");
  assert.ok(run.events.length > 0);
  assert.ok(run.events.every((event: { evidenceId?: string }) => event.evidenceId));
  assert.ok(run.events.every((event: { digest?: string }) => event.digest?.startsWith("sha256:")));
  assert.ok(run.rules.length >= 2);
  assert.equal(run.proofs.filter((proof: { status: string }) => proof.status === "FAILED").length, 2);

  const proofResponse = await fetch(`${baseUrl}/api/proofs/${run.proofBundle.proofId}`);
  const saved = await proofResponse.json();
  assert.equal(saved.data.runId, run.runId);
  assert.match(saved.data.digest, /^sha256:[a-f0-9]{64}$/);
});

test("generated full-module candidate passes without claiming this local run invoked AI", async () => {
  const response = await fetch(`${baseUrl}/api/verifications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scenarioId: "observed-standard-damaged-4500",
      candidateVersion: "generated",
    }),
  });
  const { data: run } = await response.json();
  assert.equal(response.status, 201);
  assert.equal(run.status, "PASSED");
  assert.equal(run.proofBundle.candidateVersion, "generated");
  assert.equal(
    run.proofBundle.implementations.candidate,
    "replacement.return-workflow.generated-candidate",
  );
  assert.equal(run.proofBundle.limitations.some((item: string) => item.includes("No OpenAI or Codex")), true);
});

test("stock-exhaustion scenario is directly runnable and proves atomic failure", async () => {
  const response = await fetch(`${baseUrl}/api/verifications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scenarioId: "counterexample-vip-damaged-no-sellable",
      candidateVersion: "generated",
    }),
  });
  const { data: run } = await response.json();
  assert.equal(response.status, 201);
  assert.equal(run.status, "PASSED");
  assert.equal(run.contract.expectedFailure.code, "INSUFFICIENT_SELLABLE_STOCK");
  assert.equal(run.proofBundle.assertions.length, 5);
  assert.deepEqual(
    run.proofBundle.assertions.map(({ label }: { label: string }) => label),
    [
      "Failure status is preserved",
      "Failure reason is preserved",
      "No return record is created",
      "Inventory remains unchanged",
      "No shipment or other side effect is emitted",
    ],
  );
  assert.equal(run.traces.legacy.outcome.status, "FAILED");
  assert.equal(run.traces.replacement.outcome.status, "FAILED");
  assert.equal(run.traces.replacement.outcome.returnRecordCreated, false);
  assert.equal(run.traces.replacement.outcome.sideEffects.length, 0);
});

test("replacement versions expose only seeded and generated candidates", async () => {
  const versions = await fetch(`${baseUrl}/api/replacement/versions`).then((response) => response.json());
  assert.deepEqual(
    versions.data.map((version: { id: string }) => version.id),
    ["seeded", "generated"],
  );
});

test("Codex adapter exposes an honest unconfigured boundary", async () => {
  const status = await fetch(`${baseUrl}/api/adapters/codex`).then((response) => response.json());
  const repairResponse = await fetch(`${baseUrl}/api/adapters/codex/repair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proofId: "proof_unused_while_disabled" }),
  });
  assert.equal(status.data.installed, true);
  assert.equal(status.data.enabled, false);
  assert.equal(status.data.configured, false);
  assert.equal(repairResponse.status, 501);
});

test("Codex repair rejects requests without JSON content type before any execution", async () => {
  const response = await fetch(`${baseUrl}/api/adapters/codex/repair`, {
    method: "POST",
    body: "proofId=proof_123",
  });
  const body = await response.json();
  assert.equal(response.status, 415);
  assert.equal(body.error.code, "JSON_CONTENT_TYPE_REQUIRED");
});
