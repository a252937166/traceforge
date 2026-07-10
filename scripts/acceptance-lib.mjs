import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

export const root = resolve(import.meta.dirname, "..");
export const artifactDir = resolve(root, ".traceforge/acceptance");

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
    stream.on("data", (chunk) => {
      logs.push(chunk);
      if (options.echo) process.stderr.write(chunk);
    });
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
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
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

export async function startApi(extraEnv = {}) {
  const port = await freePort();
  const database = resolve(artifactDir, `acceptance-${port}.sqlite`);
  await mkdir(artifactDir, { recursive: true });
  const child = startProcess(
    "pnpm",
    ["--filter", "@traceforge/api", "exec", "tsx", "src/server.ts"],
    {
      env: {
        PORT: String(port),
        HOST: "127.0.0.1",
        TRACEFORGE_DB: database,
        TRACEFORGE_ENABLE_CODEX: "0",
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

export function validateRun(run, expectedVersion, expectedStatus) {
  assert.equal(run.source, "deterministic-local-demo");
  assert.match(run.runId, /^run_/);
  assert.equal(run.status, expectedStatus);
  assert.equal(run.proofBundle.status, expectedStatus);
  assert.equal(run.proofBundle.candidateVersion, expectedVersion);
  assert.equal(run.proofBundle.runId, run.runId);
  assert.match(run.proofBundle.proofId, /^proof_/);
  assert.match(run.proofBundle.digest, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(run.traces.legacy.traceId, run.traces.replacement.traceId);
  assert.notEqual(run.traces.legacy.implementationId, run.traces.replacement.implementationId);
  assert.equal(run.traces.legacy.stateSource, "node:sqlite");
  assert.equal(run.traces.replacement.stateSource, "node:sqlite");
  assert.ok(run.events.length >= 16, "fresh run must include both execution evidence trees");
  assert.ok(run.rules.length >= 2, "fresh run must include evidence-linked rules");
  assert.ok(run.proofBundle.assertions.length >= 5);
  for (const event of run.events) {
    assert.match(event.evidenceId, /^ev_/);
    assert.match(event.digest, /^sha256:[a-f0-9]{64}$/);
  }
}

export async function runScenario(baseUrl, candidateVersion) {
  const { response, body } = await requestJson(`${baseUrl}/api/demo/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId: "damaged-small-refund", candidateVersion }),
  });
  assert.equal(response.status, 201);
  return body;
}

export async function writeArtifact(name, value) {
  await mkdir(artifactDir, { recursive: true });
  const path = resolve(artifactDir, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}
