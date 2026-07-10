import assert from "node:assert/strict";
import {
  argument,
  runScenario,
  startApi,
  stopProcess,
  validateRun,
  writeArtifact,
} from "./acceptance-lib.mjs";

const runs = Number(argument("runs", "10"));
assert.ok(Number.isInteger(runs) && runs >= 2 && runs <= 100, "--runs must be an integer from 2 to 100");

function semantics(run) {
  return {
    status: run.status,
    candidateVersion: run.proofBundle.candidateVersion,
    assertions: run.proofBundle.assertions.map(({ assertionId, label, status, expected, actual }) => ({
      assertionId,
      label,
      status,
      expected,
      actual,
    })),
    mismatches: run.proofBundle.mismatches.map(({ path, expected, actual, severity }) => ({
      path,
      expected,
      actual,
      severity,
    })),
    rules: run.rules.map(({ ruleId, statement, confidence }) => ({ ruleId, statement, confidence })),
    legacyResult: run.traces.legacy.result,
    replacementResult: run.traces.replacement.result,
  };
}

const api = await startApi();
try {
  const results = [];
  for (let index = 0; index < runs; index += 1) {
    const run = await runScenario(api.baseUrl, "fixed");
    validateRun(run, "fixed", "PASSED");
    results.push(run);
  }

  const baseline = semantics(results[0]);
  for (const run of results.slice(1)) assert.deepEqual(semantics(run), baseline);

  const unique = (values, label) => {
    assert.equal(new Set(values).size, values.length, `${label} values must be fresh per run`);
  };
  unique(results.map((run) => run.runId), "runId");
  unique(results.map((run) => run.proofBundle.proofId), "proofId");
  unique(results.flatMap((run) => [run.traces.legacy.traceId, run.traces.replacement.traceId]), "traceId");
  unique(results.flatMap((run) => run.events.map((event) => event.evidenceId)), "evidenceId");

  const artifact = await writeArtifact("repeatability.json", {
    runs,
    runIds: results.map((run) => run.runId),
    proofIds: results.map((run) => run.proofBundle.proofId),
    normalizedSemantics: baseline,
  });
  console.log(`ACCEPTANCE REPEAT PASS (${runs}/${runs})`);
  console.log(`artifact=${artifact}`);
} finally {
  await stopProcess(api.child);
}
