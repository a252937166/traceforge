import { TraceForgeService } from "../src/service.js";
import { ArtifactStore } from "../src/store.js";

const store = new ArtifactStore(":memory:");
try {
  const service = new TraceForgeService(store);
  const run = service.runDemo({
    scenarioId: "damaged-small-refund",
    candidateVersion: "generated",
  });
  const output = {
    runId: run.runId,
    status: run.status,
    implementationId: run.traces.replacement.implementationId,
    proofId: run.proofBundle.proofId,
    proofDigest: run.proofBundle.digest,
    mismatchCount: run.proofBundle.mismatches.length,
    mismatches: run.proofBundle.mismatches,
    run,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (run.status !== "PASSED" || run.proofBundle.mismatches.length !== 0) {
    process.exitCode = 1;
  }
} finally {
  store.close();
}
