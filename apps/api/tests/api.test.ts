import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { CodexRepairAdapter } from "../src/codex-adapter.js";
import { ArtifactStore } from "../src/store.js";

const store = new ArtifactStore(":memory:");
const { app } = createApp({ store, codexAdapter: new CodexRepairAdapter({ env: {} }) });
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
  store.close();
});

test("health and scenarios are available", async () => {
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  const scenarioResponse = await fetch(`${baseUrl}/api/scenarios`).then((response) => response.json());
  assert.equal(health.status, "ok");
  assert.equal(health.codexConfigured, false);
  assert.equal(health.codexStatus.mode, "disabled");
  assert.equal(scenarioResponse.data.length, 4);
});

test("CORS allows local frontend origins and rejects untrusted browser origins", async () => {
  const allowedResponse = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "http://localhost:5173" },
  });
  const rejectedResponse = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "https://evil.example" },
  });
  const rejected = await rejectedResponse.json();

  assert.equal(allowedResponse.status, 200);
  assert.equal(allowedResponse.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(rejectedResponse.status, 403);
  assert.equal(rejected.error.code, "CORS_ORIGIN_DENIED");
  assert.equal(rejectedResponse.headers.get("access-control-allow-origin"), null);
});

test("demo response matches the frontend contract and proof can be retrieved", async () => {
  const response = await fetch(`${baseUrl}/api/demo/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId: "damaged-small-refund", candidateVersion: "buggy" }),
  });
  const run = await response.json();
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

test("reference fixed candidate passes without claiming an AI repair", async () => {
  const response = await fetch(`${baseUrl}/api/demo/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId: "damaged-small-refund", candidateVersion: "fixed" }),
  });
  const run = await response.json();
  assert.equal(run.status, "PASSED");
  assert.equal(run.proofBundle.limitations.some((item: string) => item.includes("No OpenAI or Codex")), true);
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
