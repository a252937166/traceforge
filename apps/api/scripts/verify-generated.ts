import {
  validateGeneratedSuite,
  type GeneratedCandidateSuiteEvidence,
} from "../src/codex-adapter.js";
import { scenarios } from "../src/scenarios.js";
import { TraceForgeService } from "../src/service.js";
import { ArtifactStore } from "../src/store.js";

const sourceProofDigest = process.env.TRACEFORGE_SOURCE_PROOF_DIGEST ?? "";
const store = new ArtifactStore(":memory:");

try {
  const service = new TraceForgeService(store);
  const result = service.runSuite("generated");
  const suite: GeneratedCandidateSuiteEvidence = {
    sourceProofDigest,
    candidateVersion: "generated",
    status: result.status,
    expectedScenarioIds: scenarios.map((scenario) => scenario.id),
    summary: result.summary,
    runs: result.runs.map(({ runId, status, proofBundle }) => ({
      scenarioId: proofBundle.scenarioId ?? "",
      runId,
      status,
      implementationId: proofBundle.implementations.candidate,
      proofId: proofBundle.proofId,
      proofDigest: proofBundle.digest,
      legacyTraceId: proofBundle.legacyTraceId,
      candidateTraceId: proofBundle.candidateTraceId,
      assertionCount: proofBundle.assertions.length,
      mismatchCount: proofBundle.mismatches.length,
      proofPersisted: store.getProof(proofBundle.proofId)?.digest === proofBundle.digest,
    })),
  };
  const validation = validateGeneratedSuite(suite, sourceProofDigest);
  process.stdout.write(`${JSON.stringify({ suite, validation })}\n`);
  if (!validation.passed) {
    process.exitCode = 1;
  }
} finally {
  store.close();
}
