import assert from "node:assert/strict";
import {
  acquireApi,
  releaseApi,
  requestJson,
  runRecordedAcceptance,
  verifyProofDigest,
  waitForTerminalJob,
  writeArtifact,
} from "./acceptance-migration-lib.mjs";

const api = await acquireApi();
try {
  const invalid = await requestJson(`${api.baseUrl}/api/migrations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ executionMode: "unsupported" }),
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_EXECUTION_MODE");

  const deterministicCreated = await requestJson(`${api.baseUrl}/api/migrations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ executionMode: "deterministic-only" }),
  });
  assert.equal(deterministicCreated.response.status, 202);
  const deterministicJob = await waitForTerminalJob(api.baseUrl, deterministicCreated.body.data.id);
  assert.equal(deterministicJob.status, "passed", deterministicJob.error?.message);
  const deterministicProof = await requestJson(`${api.baseUrl}/api/migrations/${deterministicJob.id}/proof`);
  assert.equal(deterministicProof.response.status, 200);
  assert.equal(deterministicProof.body.data.status, "PASSED");
  assert.equal(deterministicProof.body.data.modelInvocations.length, 0);

  const result = await runRecordedAcceptance(api.baseUrl);

  const midpoint = result.events[Math.floor(result.events.length / 2)].sequence;
  const cursorResult = await requestJson(
    `${api.baseUrl}/api/migrations/${result.job.id}/events?format=json&after=${midpoint}`,
  );
  assert.equal(cursorResult.response.status, 200);
  assert.deepEqual(
    cursorResult.body.data.events.map((event) => event.sequence),
    result.events.filter((event) => event.sequence > midpoint).map((event) => event.sequence),
  );

  const streamResponse = await fetch(`${api.baseUrl}/api/migrations/${result.job.id}/events`, {
    headers: { accept: "text/event-stream" },
  });
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.equal(streamResponse.headers.get("x-accel-buffering"), "no");
  const streamBody = await streamResponse.text();
  const streamIds = [...streamBody.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
  assert.deepEqual(streamIds, result.events.map((event) => event.sequence));
  const streamChannels = [...streamBody.matchAll(/^event: (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(
    streamChannels,
    result.events.map(() => "migration"),
    "every SSE frame must use the single migration channel",
  );
  assert.match(streamBody, /^data: .*"type":"hypothesis\.accepted"/m);
  assert.match(streamBody, /^data: .*"type":"proof\.completed"/m);

  const tamperedProof = structuredClone(result.proof);
  tamperedProof.coverage.passed = 0;
  await verifyProofDigest(api.baseUrl, tamperedProof, false);

  const missing = await requestJson(`${api.baseUrl}/api/migrations/migration_missing`);
  assert.equal(missing.response.status, 404);

  const artifact = await writeArtifact("migration-api.json", {
    apiBase: api.baseUrl,
    externalApi: api.external,
    migrationId: result.job.id,
    proofId: result.proof.proofId,
    deterministicMigrationId: deterministicJob.id,
    eventCount: result.events.length,
    sse: {
      channel: "migration",
      frameCount: streamChannels.length,
      contentType: streamResponse.headers.get("content-type"),
      proxyBuffering: streamResponse.headers.get("x-accel-buffering"),
    },
    coverage: result.proof.coverage,
    modelInvocations: result.proof.modelInvocations.map(({ role, model, threadId, status }) => ({ role, model, threadId, status })),
    artifacts: result.downloaded,
    digestVerification: result.digestVerification,
  });
  console.log("ACCEPTANCE API PASS (recorded migration + event replay + recomputable proof)");
  console.log(`migration=${result.job.id} proof=${result.proof.proofId} artifact=${artifact}`);
} finally {
  await releaseApi(api);
}
