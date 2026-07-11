import assert from "node:assert/strict";
import {
  acquireApi,
  argument,
  releaseApi,
  runRecordedAcceptance,
  writeArtifact,
} from "./acceptance-migration-lib.mjs";

const runs = Number(argument("runs", "3"));
assert.ok(Number.isInteger(runs) && runs >= 2 && runs <= 25, "--runs must be an integer from 2 to 25");

function stableSemantics(result) {
  return {
    status: result.proof.status,
    claim: result.proof.claim,
    coverage: result.proof.coverage,
    candidate: {
      implementationId: result.proof.candidate.implementationId,
      sourceDigest: result.proof.candidate.sourceDigest,
      diffDigest: result.proof.candidate.diffDigest,
      codexThreadId: result.proof.candidate.codexThreadId,
    },
    scenarios: result.proof.scenarios.map(({ scenarioId, partition, status, assertionCount, mismatchCount }) => ({
      // The concrete held-out identity is deliberately created from fresh
      // host entropy after each writer turn. Repeatability covers semantics,
      // not reuse of that secret input.
      scenarioId: partition === "held-out" ? "host-hidden-<fresh>" : scenarioId,
      partition,
      status,
      assertionCount,
      mismatchCount,
    })),
    modelInvocations: result.proof.modelInvocations.map(({ role, model, threadId, status }) => ({ role, model, threadId, status })),
    artifactFiles: result.artifacts.map((artifact) => artifact.filename).sort(),
  };
}

function assertAllUnique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be independently issued for each replay`);
}

const api = await acquireApi();
try {
  const results = [];
  for (let index = 0; index < runs; index += 1) {
    results.push(await runRecordedAcceptance(api.baseUrl));
  }

  const expectedSemantics = stableSemantics(results[0]);
  for (const result of results.slice(1)) assert.deepEqual(stableSemantics(result), expectedSemantics);

  assertAllUnique(results.map((result) => result.job.id), "migration IDs");
  assertAllUnique(results.map((result) => result.proof.proofId), "proof IDs");
  assertAllUnique(results.flatMap((result) => result.events.map((event) => event.id)), "event IDs");
  assertAllUnique(results.flatMap((result) => result.artifacts.map((artifact) => artifact.id)), "artifact IDs");
  assertAllUnique(
    results.flatMap((result) => result.proof.scenarios.flatMap((scenario) => [scenario.legacyTraceId, scenario.candidateTraceId])),
    "scenario trace IDs",
  );

  const artifact = await writeArtifact("recorded-repeatability.json", {
    runs,
    apiBase: api.baseUrl,
    externalApi: api.external,
    migrationIds: results.map((result) => result.job.id),
    proofIds: results.map((result) => result.proof.proofId),
    proofDigests: results.map((result) => result.proof.digest),
    independentEvidence: results.map((result) => ({
      migrationId: result.job.id,
      eventIds: result.events.map((event) => event.id),
      artifactIds: result.artifacts.map((entry) => entry.id),
      traceIds: result.proof.scenarios.flatMap((scenario) => [scenario.legacyTraceId, scenario.candidateTraceId]),
    })),
    stableSemantics: expectedSemantics,
  });
  console.log(`ACCEPTANCE REPEAT PASS (${runs}/${runs} independent recorded jobs and proofs)`);
  console.log(`artifact=${artifact}`);
} finally {
  await releaseApi(api);
}
