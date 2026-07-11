#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import {
  collectWorktreePaths,
  redactWorktreePaths,
  redactWorktreePathsInText,
} from "./export-redaction.mjs";

const [migrationId, destinationArgument] = process.argv.slice(2);
if (!migrationId || !destinationArgument) {
  console.error("Usage: node scripts/export-migration-run.mjs <migration-id> <destination>");
  process.exit(2);
}

const baseUrl = (process.env.TRACEFORGE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const destination = resolve(destinationArgument);
const textArtifactExtensions = new Set([
  ".diff",
  ".js",
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".patch",
  ".ts",
  ".txt",
]);

async function request(path, { optional = false } = {}) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (optional) return undefined;
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body?.data ?? body;
}

await mkdir(destination, { recursive: true });
const job = await request(`/api/migrations/${encodeURIComponent(migrationId)}`);
const eventsEnvelope = await request(
  `/api/migrations/${encodeURIComponent(migrationId)}/events?after=0&format=json`,
);
const events = Array.isArray(eventsEnvelope) ? eventsEnvelope : eventsEnvelope.events ?? [];
const proof = await request(`/api/migrations/${encodeURIComponent(migrationId)}/proof`, {
  optional: true,
});
const artifactEnvelope = await request(
  `/api/migrations/${encodeURIComponent(migrationId)}/artifacts`,
  { optional: true },
);
const artifacts = Array.isArray(artifactEnvelope)
  ? artifactEnvelope
  : artifactEnvelope?.artifacts ?? [];
const worktreePaths = collectWorktreePaths(job, events, proof, artifacts);
const exportedJob = redactWorktreePaths(job, worktreePaths);
const exportedEvents = redactWorktreePaths(events, worktreePaths);
const exportedProof = redactWorktreePaths(proof, worktreePaths);
const exportedArtifacts = redactWorktreePaths(artifacts, worktreePaths);

await Promise.all([
  writeFile(resolve(destination, "job.json"), `${JSON.stringify(exportedJob, null, 2)}\n`, "utf8"),
  writeFile(
    resolve(destination, "events.jsonl"),
    `${exportedEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  ),
  writeFile(
    resolve(destination, "artifacts.json"),
    `${JSON.stringify(exportedArtifacts, null, 2)}\n`,
    "utf8",
  ),
  ...(exportedProof
    ? [writeFile(resolve(destination, "proof.json"), `${JSON.stringify(exportedProof, null, 2)}\n`, "utf8")]
    : []),
]);

for (const artifact of artifacts) {
  const href = artifact.href ?? artifact.downloadUrl;
  const filename = artifact.filename ?? artifact.label;
  if (typeof href !== "string" || typeof filename !== "string") continue;
  const response = await fetch(`${baseUrl}${href}`);
  if (!response.ok) throw new Error(`Artifact ${filename} returned ${response.status}`);
  const content = Buffer.from(await response.arrayBuffer());
  if (textArtifactExtensions.has(extname(filename).toLowerCase())) {
    const redacted = redactWorktreePathsInText(content.toString("utf8"), worktreePaths);
    await writeFile(resolve(destination, filename), redacted, "utf8");
  } else {
    await writeFile(resolve(destination, filename), content);
  }
}

console.log(JSON.stringify({ migrationId, status: job.status, events: events.length, artifacts: artifacts.length, destination }, null, 2));
