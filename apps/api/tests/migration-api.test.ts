import assert from "node:assert/strict";
import type { Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { MigrationStore } from "../src/migration-store.js";
import { ArtifactStore } from "../src/store.js";

async function withApi(
  assertion: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const store = new ArtifactStore(":memory:");
  const migrationStore = new MigrationStore(":memory:");
  const { app } = createApp({
    store,
    migrationStore,
    env: { TRACEFORGE_ENABLE_GPT56: "0", TRACEFORGE_ENABLE_CODEX: "0" },
  });
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  try {
    await assertion(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    migrationStore.close();
    store.close();
  }
}

async function start(baseUrl: string, executionMode: string) {
  return fetch(`${baseUrl}/api/migrations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ executionMode }),
  });
}

async function terminalJob(baseUrl: string, id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/migrations/${id}`);
    const body = await response.json();
    if (body.data.status === "passed" || body.data.status === "failed") return body.data;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("migration did not reach a terminal state");
}

test("deterministic-only migration emits real stages and a downloadable recomputable proof", async () => {
  await withApi(async (baseUrl) => {
    const created = await start(baseUrl, "deterministic-only");
    assert.equal(created.status, 202);
    const createdBody = await created.json();
    assert.equal(createdBody.data.executionMode, "deterministic-only");
    const job = await terminalJob(baseUrl, createdBody.data.id);
    assert.equal(job.status, "passed");

    const eventsResponse = await fetch(`${baseUrl}/api/migrations/${job.id}/events?format=json`);
    const eventsBody = await eventsResponse.json();
    const events = eventsBody.data.events as Array<{ sequence: number; type: string; stage: string }>;
    assert.deepEqual(events.map(({ sequence }) => sequence), events.map((_, index) => index + 1));
    assert.equal(events.some(({ type, stage }) => type === "stage.skipped" && stage === "infer"), true);
    assert.equal(events.some(({ type }) => type === "proof.completed"), true);

    const proofResponse = await fetch(`${baseUrl}/api/migrations/${job.id}/proof`);
    const proof = (await proofResponse.json()).data;
    assert.equal(proof.status, "PASSED");
    assert.deepEqual(proof.coverage, {
      observed: 2,
      counterexample: 1,
      boundary: 2,
      heldOut: 1,
      total: 6,
      passed: 6,
    });
    assert.equal(proof.modelInvocations.length, 0);

    const verifiedResponse = await fetch(`${baseUrl}/api/proofs/verify-digest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proofBundle: proof }),
    });
    const verified = (await verifiedResponse.json()).data;
    assert.equal(verified.valid, true);

    const tampered = structuredClone(proof);
    tampered.coverage.passed = 0;
    const tamperedResponse = await fetch(`${baseUrl}/api/proofs/verify-digest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proofBundle: tampered }),
    });
    assert.equal((await tamperedResponse.json()).data.valid, false);

    const artifactsResponse = await fetch(`${baseUrl}/api/migrations/${job.id}/artifacts`);
    const artifacts = (await artifactsResponse.json()).data.artifacts;
    assert.deepEqual(
      artifacts.map(({ filename }: { filename: string }) => filename).sort(),
      ["candidate.diff", "commands.json", "contract.json", "evidence.jsonl", "proof.json"],
    );
    const downloaded = await fetch(`${baseUrl}${artifacts.find(({ filename }: { filename: string }) => filename === "proof.json").href}`);
    assert.match(downloaded.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(downloaded.headers.get("x-content-sha256")?.startsWith("sha256:"), true);
  });
});

test("recorded replay fails closed until a real full-module Codex recording is verified", async () => {
  await withApi(async (baseUrl) => {
    const created = await start(baseUrl, "recorded-replay");
    const body = await created.json();
    const job = await terminalJob(baseUrl, body.data.id);
    assert.equal(job.status, "failed");
    assert.equal(job.error.code, "RECORDED_CODEX_BUILD_NOT_VERIFIED");
    assert.equal(job.recordedAt, "2026-07-10T16:29:39.000Z");
    const proof = await fetch(`${baseUrl}/api/migrations/${job.id}/proof`);
    assert.equal(proof.status, 404);
  });
});

test("live AI disabled fails without substituting replay or deterministic proof", async () => {
  await withApi(async (baseUrl) => {
    const created = await start(baseUrl, "live-ai");
    const body = await created.json();
    const job = await terminalJob(baseUrl, body.data.id);
    assert.equal(job.status, "failed");
    assert.equal(job.error.code, "GPT56_ADAPTER_NOT_CONFIGURED");
    const proof = await fetch(`${baseUrl}/api/migrations/${job.id}/proof`);
    assert.equal(proof.status, 404);
  });
});
