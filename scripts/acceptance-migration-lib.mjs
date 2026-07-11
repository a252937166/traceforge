import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { resolve } from "node:path";

const terminalStatuses = new Set(["passed", "failed"]);
export const root = resolve(import.meta.dirname, "..");
const artifactDir = resolve(root, ".traceforge/acceptance");

export function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

export async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

export function startProcess(command, args, options = {}) {
  const logs = [];
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => logs.push(chunk));
  }
  child.logs = logs;
  return child;
}

export async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

export async function waitForUrl(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "unknown error"}`);
}

export async function requestJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  return { response, body };
}

async function startApi(extraEnv = {}) {
  const port = await freePort();
  const database = resolve(artifactDir, `acceptance-migration-${port}.sqlite`);
  await mkdir(artifactDir, { recursive: true });
  const child = startProcess(
    process.execPath,
    [resolve(root, "apps/api/dist/server.js")],
    {
      env: {
        PORT: String(port),
        HOST: "127.0.0.1",
        TRACEFORGE_DB: database,
        ...extraEnv,
      },
    },
  );
  try {
    await waitForUrl(`http://127.0.0.1:${port}/api/health`);
  } catch (error) {
    await stopProcess(child);
    throw new Error(`${error.message}\n${child.logs.join("")}`);
  }
  return { child, port, baseUrl: `http://127.0.0.1:${port}`, database };
}

export async function writeArtifact(name, value) {
  await mkdir(artifactDir, { recursive: true });
  const path = resolve(artifactDir, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

export function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function validateReleaseIdentity(body) {
  assert.match(body.release?.sha ?? "", /^[a-f0-9]{40}$/, "health must expose the packaged release SHA");
  assert.match(body.release?.version ?? "", /^local-runner-v\d+\.\d+\.\d+$/, "health must expose the Local Runner release");
  assert.equal(Number.isNaN(Date.parse(body.release?.builtAt ?? "")), false, "health must expose the package timestamp");
  if (process.env.TRACEFORGE_EXPECTED_RELEASE_SHA) {
    assert.equal(body.release.sha, process.env.TRACEFORGE_EXPECTED_RELEASE_SHA, "public API release SHA is stale");
  }
}

export async function acquireApi(extraEnv = {}) {
  if (process.env.API_BASE) {
    const baseUrl = normalizeBaseUrl(process.env.API_BASE);
    const { response, body } = await requestJson(`${baseUrl}/api/health`);
    assert.equal(response.status, 200, `API_BASE health returned ${response.status}`);
    assert.equal(body.status, "ok", "API_BASE health must report ok");
    validateReleaseIdentity(body);
    return { baseUrl, child: undefined, external: true };
  }

  const api = await startApi({
    TRACEFORGE_ENABLE_GPT56: "0",
    TRACEFORGE_ENABLE_CODEX: "0",
    TRACEFORGE_RELEASE_SHA: "0".repeat(40),
    TRACEFORGE_RELEASE_VERSION: "local-runner-v0.1.7",
    TRACEFORGE_RELEASE_BUILT_AT: "2026-07-11T00:00:00.000Z",
    ...extraEnv,
  });
  const { body } = await requestJson(`${api.baseUrl}/api/health`);
  validateReleaseIdentity(body);
  return { ...api, external: false };
}

export async function releaseApi(api) {
  if (!api.external) await stopProcess(api.child);
}

export async function waitForTerminalJob(baseUrl, migrationId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    const { response, body } = await requestJson(`${baseUrl}/api/migrations/${migrationId}`);
    assert.equal(response.status, 200, `migration lookup returned ${response.status}`);
    latest = body.data;
    if (terminalStatuses.has(latest.status)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`migration ${migrationId} did not finish in ${timeoutMs}ms (last status: ${latest?.status ?? "unknown"})`);
}

export async function startRecordedMigration(baseUrl) {
  const { response, body } = await requestJson(`${baseUrl}/api/migrations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ executionMode: "recorded-replay" }),
  });
  assert.equal(response.status, 202, `migration creation returned ${response.status}`);
  assert.equal(body.data.executionMode, "recorded-replay");
  assert.match(body.data.id, /^migration_[0-9a-f-]+$/);
  return waitForTerminalJob(baseUrl, body.data.id);
}

export async function readMigrationEvidence(baseUrl, job) {
  const [eventResult, proofResult, artifactResult] = await Promise.all([
    requestJson(`${baseUrl}/api/migrations/${job.id}/events?format=json`),
    requestJson(`${baseUrl}/api/migrations/${job.id}/proof`),
    requestJson(`${baseUrl}/api/migrations/${job.id}/artifacts`),
  ]);
  assert.equal(eventResult.response.status, 200);
  assert.equal(proofResult.response.status, 200);
  assert.equal(artifactResult.response.status, 200);
  return {
    events: eventResult.body.data.events,
    proof: proofResult.body.data,
    artifacts: artifactResult.body.data.artifacts,
  };
}

export function validateRecordedMigration({ job, events, proof, artifacts }) {
  assert.equal(job.executionMode, "recorded-replay");
  assert.equal(job.status, "passed");
  assert.equal(job.modelId, "gpt-5.6-sol");
  assert.equal(typeof job.recordedAt, "string");
  assert.equal(typeof job.sourceRunId, "string");
  assert.match(job.replayDisclosure, /recorded|replay/i);
  assert.equal(job.proofId, proof.proofId);

  assert.ok(events.length >= 25, "recorded replay should expose the complete five-stage event ledger");
  assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
  assert.equal(new Set(events.map((event) => event.id)).size, events.length, "event IDs must be unique");
  for (const event of events) {
    assert.equal(event.migrationId, job.id);
    assert.match(event.digest, /^sha256:[a-f0-9]{64}$/);
  }
  const eventTypes = new Set(events.map((event) => event.type));
  for (const type of [
    "job.started",
    "hypothesis.proposed",
    "hypothesis.accepted",
    "counterexample.updated",
    "candidate.updated",
    "proof.completed",
    "job.completed",
  ]) {
    assert.ok(eventTypes.has(type), `missing migration event ${type}`);
  }
  for (const stage of ["observe", "infer", "challenge", "build", "verify"]) {
    assert.ok(events.some((event) => event.type === "stage.started" && event.stage === stage), `missing ${stage} start`);
    assert.ok(events.some((event) => event.type === "stage.passed" && event.stage === stage), `missing ${stage} pass`);
  }

  assert.match(proof.proofId, /^migration-proof_[0-9a-f-]+$/);
  assert.equal(proof.migrationId, job.id);
  assert.equal(proof.status, "PASSED");
  assert.match(proof.digest, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.contractDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.candidate.sourceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.candidate.diffDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.candidate.codexThreadId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(proof.coverage, {
    observed: 2,
    counterexample: 2,
    boundary: 2,
    heldOut: 1,
    total: 7,
    passed: 7,
  });
  assert.equal(proof.scenarios.length, 7);
  assert.equal(proof.scenarios.every((scenario) => scenario.status === "PASSED" && scenario.mismatchCount === 0), true);
  assert.equal(proof.modelInvocations.length, 4);
  assert.equal(proof.modelInvocations.every((invocation) => invocation.model === "gpt-5.6-sol"), true);
  assert.deepEqual(
    proof.modelInvocations.map((invocation) => invocation.role).sort(),
    ["contract-critic", "counterexample-hunter", "counterexample-hunter", "trace-archaeologist"],
  );

  assert.deepEqual(
    artifacts.map((artifact) => artifact.filename).sort(),
    ["candidate.diff", "commands.json", "contract.json", "evidence.jsonl", "proof.json"],
  );
  for (const artifact of artifacts) {
    assert.equal(artifact.migrationId, job.id);
    assert.match(artifact.id, /^artifact_[0-9a-f-]+$/);
    assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(artifact.byteLength > 0);
    assert.equal(artifact.href.startsWith(`/api/migrations/${job.id}/downloads/`), true);
  }
}

export async function verifyProofDigest(baseUrl, proof, expected = true) {
  const { response, body } = await requestJson(`${baseUrl}/api/proofs/verify-digest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proofBundle: proof }),
  });
  assert.equal(response.status, 200);
  assert.equal(body.data.valid, expected);
  assert.match(body.data.computedDigest, /^sha256:[a-f0-9]{64}$/);
  return body.data;
}

function digestArtifactBody(body) {
  return `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`;
}

export async function downloadAndValidateArtifacts(baseUrl, artifacts, proof) {
  const downloaded = [];
  for (const artifact of artifacts) {
    const response = await fetch(`${baseUrl}${artifact.href}`);
    assert.equal(response.status, 200, `${artifact.filename} download returned ${response.status}`);
    const body = await response.text();
    assert.equal(Buffer.byteLength(body, "utf8"), artifact.byteLength, `${artifact.filename} byte length`);
    assert.equal(response.headers.get("x-content-sha256"), artifact.digest, `${artifact.filename} digest header`);
    assert.equal(digestArtifactBody(body), artifact.digest, `${artifact.filename} body digest`);
    downloaded.push({ filename: artifact.filename, digest: artifact.digest, byteLength: artifact.byteLength });
    if (artifact.filename === "proof.json") assert.deepEqual(JSON.parse(body), proof);
  }
  return downloaded;
}

export async function runRecordedAcceptance(baseUrl) {
  const job = await startRecordedMigration(baseUrl);
  const evidence = await readMigrationEvidence(baseUrl, job);
  const result = { job, ...evidence };
  validateRecordedMigration(result);
  const digestVerification = await verifyProofDigest(baseUrl, result.proof, true);
  const downloaded = await downloadAndValidateArtifacts(baseUrl, result.artifacts, result.proof);
  return { ...result, digestVerification, downloaded };
}
