import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { sha256Digest } from "../src/digest.js";
import { MigrationRequestLimiter } from "../src/migration-guard.js";
import {
  assertCandidateSourceDigest,
  candidateModuleSourceUrl,
  verifyRecordedCandidateSourceDigest,
} from "../src/migration-runner.js";
import { recordedCodexBuild } from "../src/recorded-codex-build.js";
import { MigrationStore } from "../src/migration-store.js";
import type { MigrationJob } from "../src/migration-types.js";
import { ArtifactStore } from "../src/store.js";

const recordedReplayTest = process.env.TRACEFORGE_CANDIDATE_TESTS === "1" ? test.skip : test;

test("explicit TRACEFORGE_DB persists migrations when an artifact store is injected", () => {
  const directory = mkdtempSync(join(tmpdir(), "traceforge-migration-store-"));
  const database = join(directory, "migrations.sqlite");
  const env = {
    TRACEFORGE_DB: database,
    TRACEFORGE_ENABLE_GPT56: "0",
    TRACEFORGE_ENABLE_CODEX: "0",
  };
  const createdAt = "2026-07-11T00:00:00.000Z";
  const job: MigrationJob = {
    id: "migration_persistence_regression",
    executionMode: "deterministic-only",
    scenarioIds: [],
    status: "queued",
    currentStage: "observe",
    streamVersion: 1,
    createdAt,
    updatedAt: createdAt,
    links: {
      self: "/api/migrations/migration_persistence_regression",
      events: "/api/migrations/migration_persistence_regression/events",
      proof: "/api/migrations/migration_persistence_regression/proof",
      artifacts: "/api/migrations/migration_persistence_regression/artifacts",
    },
  };

  const firstArtifactStore = new ArtifactStore(":memory:");
  const firstApp = createApp({ store: firstArtifactStore, env });
  try {
    firstApp.migrationStore.createJob(job);
  } finally {
    firstApp.migrationStore.close();
    firstArtifactStore.close();
  }

  const secondArtifactStore = new ArtifactStore(":memory:");
  const secondApp = createApp({ store: secondArtifactStore, env });
  try {
    const recovered = secondApp.migrationStore.getJob(job.id);
    assert.equal(recovered?.status, "failed");
    assert.equal(recovered?.error?.code, "PROCESS_RESTARTED");
    assert.equal(
      secondApp.migrationStore.listEvents(job.id).at(-1)?.type,
      "job.failed",
    );
  } finally {
    secondApp.migrationStore.close();
    secondArtifactStore.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retention pruning removes only expired terminal jobs and their dependent rows", () => {
  const migrationStore = new MigrationStore(":memory:");
  const makeJob = (id: string, status: MigrationJob["status"], updatedAt: string): MigrationJob => ({
    id,
    executionMode: "deterministic-only",
    scenarioIds: [],
    status,
    currentStage: "verify",
    streamVersion: 0,
    createdAt: updatedAt,
    updatedAt,
    links: {
      self: `/api/migrations/${id}`,
      events: `/api/migrations/${id}/events`,
      proof: `/api/migrations/${id}/proof`,
      artifacts: `/api/migrations/${id}/artifacts`,
    },
  });
  const oldTerminal = makeJob("migration_old_terminal", "passed", "2026-07-01T00:00:00.000Z");
  const recentTerminal = makeJob("migration_recent_terminal", "failed", "2026-07-11T23:00:00.000Z");
  const oldRunning = makeJob("migration_old_running", "running", "2026-07-01T00:00:00.000Z");
  for (const job of [oldTerminal, recentTerminal, oldRunning]) migrationStore.createJob(job);
  migrationStore.putArtifact({
    migrationId: oldTerminal.id,
    kind: "proof",
    label: "proof.json",
    filename: "proof.json",
    mimeType: "application/json",
    body: "{}\n",
    createdAt: oldTerminal.createdAt,
  });
  migrationStore.appendEvent({
    migrationId: oldTerminal.id,
    occurredAt: oldTerminal.createdAt,
    stage: "verify",
    type: "job.completed",
    origin: "live",
    actor: "host-verifier",
    status: "passed",
    title: "done",
    detail: "done",
    evidenceIds: [],
    artifactIds: [],
    payload: {},
  });

  try {
    assert.equal(migrationStore.pruneCompletedJobs({
      maxCompletedJobs: 10,
      maxAgeMs: 24 * 60 * 60 * 1_000,
      now: Date.parse("2026-07-12T00:00:00.000Z"),
    }), 1);
    assert.equal(migrationStore.getJob(oldTerminal.id), undefined);
    assert.deepEqual(migrationStore.listEvents(oldTerminal.id), []);
    assert.deepEqual(migrationStore.listArtifacts(oldTerminal.id), []);
    assert.ok(migrationStore.getJob(recentTerminal.id));
    assert.ok(migrationStore.getJob(oldRunning.id));
  } finally {
    migrationStore.close();
  }
});

test("candidate evidence resolves the source format actually executed by the runtime", () => {
  assert.equal(
    candidateModuleSourceUrl("file:///workspace/apps/api/src/migration-runner.ts").pathname,
    "/workspace/apps/api/src/candidates/generated-return-workflow.ts",
  );
  assert.equal(
    candidateModuleSourceUrl("file:///opt/traceforge/dist/migration-runner.js").pathname,
    "/opt/traceforge/dist/candidates/generated-return-workflow.js",
  );
});

recordedReplayTest("recorded replay fails closed when current executable source differs from recorded digest", async () => {
  assert.equal(
    await verifyRecordedCandidateSourceDigest(),
    recordedCodexBuild.executableSourceDigests.typescript,
  );
  assert.throws(
    () => assertCandidateSourceDigest("tampered candidate source", recordedCodexBuild.executableSourceDigests.typescript),
    /RECORDED_CANDIDATE_SOURCE_MISMATCH/,
  );
});

async function withApi(
  assertion: (baseUrl: string) => Promise<void>,
  env: NodeJS.ProcessEnv = {},
): Promise<void> {
  const store = new ArtifactStore(":memory:");
  const migrationStore = new MigrationStore(":memory:");
  const { app } = createApp({
    store,
    migrationStore,
    env: {
      TRACEFORGE_ENABLE_GPT56: "0",
      TRACEFORGE_ENABLE_CODEX: "0",
      TRACEFORGE_REPLAY_EVENT_DELAY_MS: "0",
      ...env,
    },
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

recordedReplayTest("recorded replay pacing exposes an intermediate server-owned state before completion", async () => {
  await withApi(async (baseUrl) => {
    const created = await start(baseUrl, "recorded-replay");
    const body = await created.json();
    let observedIntermediate = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [jobResponse, eventsResponse] = await Promise.all([
        fetch(`${baseUrl}/api/migrations/${body.data.id}`),
        fetch(`${baseUrl}/api/migrations/${body.data.id}/events?format=json`),
      ]);
      const job = (await jobResponse.json()).data;
      const events = (await eventsResponse.json()).data.events as Array<{ type: string }>;
      if (
        job.status === "running" &&
        events.some(({ type }) => type === "hypothesis.proposed") &&
        !events.some(({ type }) => type === "job.completed")
      ) {
        observedIntermediate = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(observedIntermediate, true);
    assert.equal((await terminalJob(baseUrl, body.data.id)).status, "passed");
  }, { TRACEFORGE_REPLAY_EVENT_DELAY_MS: "15" });
});

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

test("migration API rejects partial or unknown scenario selection and binds the canonical set to the proof", async () => {
  await withApi(async (baseUrl) => {
    const scenariosResponse = await fetch(`${baseUrl}/api/scenarios`);
    const canonicalScenarioIds = (await scenariosResponse.json()).data.map(({ id }: { id: string }) => id);
    for (const invalidScenarioIds of [
      ["bogus-only"],
      canonicalScenarioIds.slice(0, -1),
      [...canonicalScenarioIds.slice(0, -1), canonicalScenarioIds[0]],
      [...canonicalScenarioIds.slice(0, -1), 42],
    ]) {
      const rejected = await fetch(`${baseUrl}/api/migrations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ executionMode: "deterministic-only", scenarioIds: invalidScenarioIds }),
      });
      assert.equal(rejected.status, 400);
      const rejectedBody = await rejected.json();
      assert.equal(rejectedBody.error.code, "INVALID_SCENARIO_SET");
    }

    const created = await fetch(`${baseUrl}/api/migrations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionMode: "deterministic-only", scenarioIds: [...canonicalScenarioIds].reverse() }),
    });
    assert.equal(created.status, 202);
    const createdBody = await created.json();
    assert.deepEqual(createdBody.data.scenarioIds, canonicalScenarioIds);

    const job = await terminalJob(baseUrl, createdBody.data.id);
    const proof = (await (await fetch(`${baseUrl}/api/migrations/${job.id}/proof`)).json()).data;
    const scenarioSet = proof.scenarios.map(({
      scenarioId,
      partition,
      proofDigest,
    }: {
      scenarioId: string;
      partition: string;
      proofDigest: string;
    }) => ({ scenarioId, partition, proofDigest }));
    assert.deepEqual(job.verifiedScenarioIds, scenarioSet.map(({ scenarioId }: { scenarioId: string }) => scenarioId));
    assert.deepEqual(job.verifiedScenarioSet, scenarioSet);
    assert.equal(job.scenarioSetDigest, proof.scenarioSetDigest);
    assert.equal(sha256Digest(scenarioSet), proof.scenarioSetDigest);
    assert.equal(job.verifiedScenarioIds.length, 7);
    const events = (await (await fetch(`${baseUrl}/api/migrations/${job.id}/events?format=json`)).json()).data.events;
    const scope = events.find(({ type }: { type: string }) => type === "verification.scope.bound");
    assert.deepEqual(scope.payload.scenarioIds, job.verifiedScenarioIds);
    assert.deepEqual(scope.payload.scenarioSet, scenarioSet);
    assert.equal(scope.payload.scenarioSetDigest, proof.scenarioSetDigest);

    const changedScenarioSet = structuredClone(scenarioSet);
    const originalProofDigest = changedScenarioSet[0].proofDigest;
    changedScenarioSet[0].proofDigest = `${originalProofDigest.slice(0, -1)}${originalProofDigest.endsWith("0") ? "1" : "0"}`;
    assert.notEqual(
      sha256Digest(changedScenarioSet),
      proof.scenarioSetDigest,
      "changing a per-scenario proof under the same scenario ID must change the set digest",
    );
  });
});

test("migration request limiter rejects a burst with a retry deadline", () => {
  const limiter = new MigrationRequestLimiter({
    TRACEFORGE_MIGRATION_RATE_MAX: "1",
    TRACEFORGE_MIGRATION_RATE_WINDOW_MS: "1000",
  });
  assert.equal(limiter.take("client-a", 10_000).allowed, true);
  const rejected = limiter.take("client-a", 10_100);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterMs, 900);
  assert.equal(limiter.take("client-a", 11_001).allowed, true);
});

test("migration API enforces its application-layer rate limit", async () => {
  await withApi(async (baseUrl) => {
    const first = await start(baseUrl, "unsupported");
    assert.equal(first.status, 400);
    const second = await start(baseUrl, "deterministic-only");
    assert.equal(second.status, 429);
    assert.equal((await second.json()).error.code, "MIGRATION_RATE_LIMITED");
    assert.equal(Number(second.headers.get("retry-after")) >= 1, true);
  }, {
    TRACEFORGE_MIGRATION_RATE_MAX: "1",
    TRACEFORGE_MIGRATION_RATE_WINDOW_MS: "60000",
  });
});

recordedReplayTest("migration queue rejects excess work instead of starting unbounded jobs", async () => {
  await withApi(async (baseUrl) => {
    const first = await start(baseUrl, "recorded-replay");
    assert.equal(first.status, 202);
    const firstJob = (await first.json()).data;
    const rejected = await start(baseUrl, "deterministic-only");
    assert.equal(rejected.status, 503);
    assert.equal((await rejected.json()).error.code, "MIGRATION_CAPACITY_EXCEEDED");
    assert.equal((await terminalJob(baseUrl, firstJob.id)).status, "passed");
  }, {
    TRACEFORGE_MIGRATION_MAX_CONCURRENT: "1",
    TRACEFORGE_MIGRATION_MAX_QUEUED: "0",
    TRACEFORGE_MIGRATION_RATE_MAX: "10",
    TRACEFORGE_REPLAY_EVENT_DELAY_MS: "10",
  });
});

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
      counterexample: 2,
      boundary: 2,
      heldOut: 1,
      total: 7,
      passed: 7,
    });
    assert.equal(proof.modelInvocations.length, 0);
    assert.equal(proof.contractId, "contract-host-deterministic-v1");
    assert.equal(
      proof.limitations.includes("The deterministic-only contract is host-authored and is not a replay of a recorded model artifact."),
      true,
    );

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
    const contractDownloaded = await fetch(`${baseUrl}${artifacts.find(({ filename }: { filename: string }) => filename === "contract.json").href}`);
    const contract = await contractDownloaded.json();
    assert.equal(contract.source, "host-authored");
  });
});

recordedReplayTest("recorded replay exposes real GPT-5.6 and full-module Codex evidence", async () => {
  await withApi(async (baseUrl) => {
    const created = await start(baseUrl, "recorded-replay");
    const body = await created.json();
    const job = await terminalJob(baseUrl, body.data.id);
    assert.equal(job.status, "passed");
    assert.equal(job.recordedAt, "2026-07-11T17:42:15.612Z");
    assert.equal(job.sourceRunId, "migration_efaa0383-628a-4fba-94df-96bfe344bcbe");
    assert.equal(job.modelId, "gpt-5.6-sol");

    const proofResponse = await fetch(`${baseUrl}/api/migrations/${job.id}/proof`);
    assert.equal(proofResponse.status, 200);
    const proof = (await proofResponse.json()).data;
    assert.equal(proof.status, "PASSED");
    assert.equal(proof.modelInvocations.length, 4);
    assert.equal(proof.candidate.codexThreadId, "019f5244-7bef-71f2-8f25-8ed1446a539e");
    assert.equal(proof.candidate.baseCommit, "eb0e6169974b96bd3bff3b536b38ef5f665127c2");
    assert.deepEqual(proof.hostVerification, {
      testsPassed: 56,
      testsTotal: 56,
      testsSkipped: 4,
      scope: "candidate-safe",
      source: "recorded-command-log",
    });
    assert.equal(proof.coverage.passed, 7);

    const events = (await (await fetch(`${baseUrl}/api/migrations/${job.id}/events?format=json`)).json()).data.events;
    assert.equal(events.some((event: { type: string }) => event.type === "hypothesis.proposed"), true);
    assert.equal(events.some((event: { type: string }) => event.type === "hypothesis.accepted"), true);
    assert.equal(events.some((event: { type: string }) => event.type === "counterexample.updated"), true);
    assert.equal(events.some((event: { type: string }) => event.type === "candidate.updated"), true);

    const artifacts = (await (await fetch(`${baseUrl}/api/migrations/${job.id}/artifacts`)).json()).data.artifacts;
    const diff = artifacts.find(({ filename }: { filename: string }) => filename === "candidate.diff");
    assert.ok(diff);
    const diffBody = await (await fetch(`${baseUrl}${diff.href}`)).text();
    assert.match(diffBody, /input\.amountCents >= 50_000/);
    assert.match(diffBody, /destination: "QUARANTINE"/);
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
