import assert from "node:assert/strict";
import {
  argument,
  requestJson,
  runScenario,
  startApi,
  stopProcess,
  validateRun,
  writeArtifact,
} from "./acceptance-lib.mjs";

const mode = argument("mode", "baseline");
assert.ok(["baseline", "mutation"].includes(mode), "--mode must be baseline or mutation");

const api = await startApi();
try {
  const candidateVersion = mode === "baseline" ? "fixed" : "buggy";
  const expectedStatus = mode === "baseline" ? "PASSED" : "FAILED";
  const run = await runScenario(api.baseUrl, candidateVersion);
  validateRun(run, candidateVersion, expectedStatus);

  const sellable = run.proofBundle.assertions.find((item) => item.assertionId === "assert_004");
  const quarantine = run.proofBundle.assertions.find((item) => item.assertionId === "assert_005");
  assert(sellable && quarantine);
  assert.equal(sellable.expected, 10);
  assert.equal(quarantine.expected, 1);

  if (mode === "baseline") {
    assert.equal(run.proofBundle.mismatches.length, 0);
    assert.equal(sellable.actual, 10);
    assert.equal(quarantine.actual, 1);
  } else {
    assert.equal(run.proofBundle.mutationDetected, true);
    assert.equal(run.proofBundle.mismatches.length, 2);
    assert.equal(sellable.actual, 11);
    assert.equal(quarantine.actual, 0);
    assert.equal(sellable.status, "FAILED");
    assert.equal(quarantine.status, "FAILED");
  }

  const proof = await requestJson(`${api.baseUrl}/api/proofs/${run.proofBundle.proofId}`);
  assert.equal(proof.response.status, 200);
  assert.deepEqual(proof.body.data, run.proofBundle);

  for (const trace of [run.traces.legacy, run.traces.replacement]) {
    const stored = await requestJson(`${api.baseUrl}/api/traces/${trace.traceId}`);
    assert.equal(stored.response.status, 200);
    assert.deepEqual(stored.body.data, trace);
  }

  const missing = await requestJson(`${api.baseUrl}/api/proofs/proof_missing`);
  assert.equal(missing.response.status, 404);

  const artifact = await writeArtifact(`api-${mode}.json`, run);
  console.log(`ACCEPTANCE API ${mode.toUpperCase()} PASS`);
  console.log(`run=${run.runId} proof=${run.proofBundle.proofId} artifact=${artifact}`);
} finally {
  await stopProcess(api.child);
}
