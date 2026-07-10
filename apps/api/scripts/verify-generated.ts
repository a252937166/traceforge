import { TraceForgeService } from "../src/service.js";
import { ArtifactStore } from "../src/store.js";
import { validateGeneratedRepairProvenance } from "../src/codex-adapter.js";

const store = new ArtifactStore(":memory:");
try {
  const service = new TraceForgeService(store);
  const run = service.runDemo({
    scenarioId: "damaged-small-refund",
    candidateVersion: "generated",
  });
  const expectedSourceProofDigest = process.env.TRACEFORGE_SOURCE_PROOF_DIGEST ?? "";
  const provenance = validateGeneratedRepairProvenance(run, expectedSourceProofDigest);
  const output = {
    runId: run.runId,
    status: run.status,
    implementationId: run.traces.replacement.implementationId,
    proofId: run.proofBundle.proofId,
    proofDigest: run.proofBundle.digest,
    mismatchCount: run.proofBundle.mismatches.length,
    mismatches: run.proofBundle.mismatches,
    provenance,
    run,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (run.status !== "PASSED" || run.proofBundle.mismatches.length !== 0 || !provenance.passed) {
    process.exitCode = 1;
  }
} finally {
  store.close();
}
