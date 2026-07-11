import {
  validateGeneratedSuite,
  type GeneratedCandidateSuiteEvidence,
} from "../src/codex-adapter.js";
import { TraceForgeService } from "../src/service.js";
import { ArtifactStore } from "../src/store.js";

const repairInputDigest = process.env.TRACEFORGE_REPAIR_INPUT_DIGEST ?? "";
const hostHiddenScenarioNonce = process.env.TRACEFORGE_HOST_HIDDEN_SCENARIO_NONCE;
const store = new ArtifactStore(":memory:");

try {
  const service = new TraceForgeService(store);
  const result = service.runSuite("generated", hostHiddenScenarioNonce);
  const suite: GeneratedCandidateSuiteEvidence = {
    repairInputDigest,
    candidateVersion: "generated",
    status: result.status,
    expectedScenarioIds: result.runs.map(({ proofBundle }) => proofBundle.scenarioId ?? ""),
    summary: result.summary,
    runs: result.runs.map(({ runId, status, proofBundle }) => ({
      scenarioId: proofBundle.scenarioId ?? "",
      partition: proofBundle.scenarioId?.startsWith("host-hidden-")
        ? "held-out"
        : service.listScenarios().find(({ id }) => id === proofBundle.scenarioId)?.stage ?? "observed",
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
  const validation = validateGeneratedSuite(suite, repairInputDigest);
  process.stdout.write(`${JSON.stringify({ suite, validation })}\n`);
  if (!validation.passed) {
    process.exitCode = 1;
  }
} finally {
  store.close();
}
