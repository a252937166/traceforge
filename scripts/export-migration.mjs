import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [baseUrl, migrationId, outputDirectory] = process.argv.slice(2);
if (!baseUrl || !migrationId || !outputDirectory) {
  throw new Error("Usage: node scripts/export-migration.mjs <baseUrl> <migrationId> <outputDirectory>");
}

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

const directory = resolve(outputDirectory);
await mkdir(directory, { recursive: true });
const job = await get(`/api/migrations/${migrationId}`);
const eventEnvelope = await get(`/api/migrations/${migrationId}/events?format=json`);
const events = eventEnvelope.events ?? eventEnvelope;
const proof = await get(`/api/migrations/${migrationId}/proof`);
const artifactEnvelope = await get(`/api/migrations/${migrationId}/artifacts`);
const artifacts = artifactEnvelope.artifacts ?? artifactEnvelope;

await Promise.all([
  writeFile(`${directory}/job.json`, `${JSON.stringify(job, null, 2)}\n`),
  writeFile(`${directory}/events.jsonl`, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`),
  writeFile(`${directory}/proof.json`, `${JSON.stringify(proof, null, 2)}\n`),
  writeFile(`${directory}/artifacts.json`, `${JSON.stringify(artifacts, null, 2)}\n`),
  ...artifacts.map(async (artifact) => {
    const response = await fetch(`${baseUrl}${artifact.href}`);
    if (!response.ok) throw new Error(`${artifact.href} returned ${response.status}`);
    await writeFile(`${directory}/${artifact.filename}`, Buffer.from(await response.arrayBuffer()));
  }),
]);

process.stdout.write(`${JSON.stringify({ migrationId, directory, eventCount: events.length, artifactCount: artifacts.length })}\n`);
