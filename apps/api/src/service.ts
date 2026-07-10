import { randomUUID } from "node:crypto";
import { executeWorkflow, findScenario, scenarios, validateWorkflowInput } from "./domain.js";
import { sha256Digest } from "./digest.js";
import { ArtifactStore } from "./store.js";
import type {
  BehaviorContract,
  CandidateVersion,
  DemoRunResponse,
  DeterministicAssertion,
  EvidenceRecord,
  ProofBundle,
  ReturnWorkflowInput,
  SystemName,
  VerificationMismatch,
  WorkflowTrace,
} from "./types.js";

const RULE_STATEMENTS: Record<string, string> = {
  "RULE-HIGH-VALUE-REVIEW": "Returns worth at least 50,000 cents require manual review before side effects.",
  "RULE-VIP-REPLACEMENT": "Eligible VIP returns receive a replacement instead of a refund.",
  "RULE-STANDARD-REFUND": "Eligible standard-customer returns are refunded.",
};

function evidenceFor(trace: WorkflowTrace, type: string): string {
  return trace.evidence.find((item) => item.type === type)?.evidenceId ?? trace.evidence[0]?.evidenceId ?? "missing";
}

function digestForEvidence(trace: WorkflowTrace, evidenceId: string): string {
  return trace.evidence.find((item) => item.evidenceId === evidenceId)?.digest ?? "sha256:missing";
}

function valueAt(trace: WorkflowTrace, path: string): unknown {
  const values: Record<string, unknown> = {
    decision: trace.result.decision,
    "returnRecord.status": trace.result.returnRecord.status,
    "returnRecord.refundCents": trace.result.returnRecord.refundCents,
    "inventoryAfter.sellable": trace.result.inventoryAfter.sellable,
    "inventoryAfter.quarantine": trace.result.inventoryAfter.quarantine,
  };
  return values[path];
}

export class TraceForgeService {
  constructor(readonly store = new ArtifactStore()) {}

  listScenarios() {
    return scenarios;
  }

  capture(
    system: SystemName,
    rawInput: unknown,
    candidateVersion: CandidateVersion = "buggy",
    scenarioId?: string,
  ): WorkflowTrace {
    const input = validateWorkflowInput(rawInput);
    const persistedBefore = this.store.resetBusinessState(system, input);
    const executed = executeWorkflow(input, system, candidateVersion);
    const persistedAfter = this.store.applyBusinessResult(system, executed.result);
    if (!persistedAfter.returnRecord) {
      throw new Error("return state was not persisted");
    }
    const persistedResult = {
      ...executed.result,
      inventoryBefore: persistedBefore.inventory,
      inventoryAfter: persistedAfter.inventory,
      returnRecord: persistedAfter.returnRecord,
    };
    const traceId = `trace_${randomUUID()}`;
    const capturedAt = new Date().toISOString();
    const databaseBackedEvents = executed.events.map((event) => {
      if (event.type === "state.before") {
        return {
          ...event,
          detail: `${persistedBefore.inventory.sellable} sellable, ${persistedBefore.inventory.quarantine} quarantined · read from SQLite`,
          payload: persistedBefore,
        };
      }
      if (event.type === "state.after") {
        return {
          ...event,
          detail: `${persistedAfter.inventory.sellable} sellable, ${persistedAfter.inventory.quarantine} quarantined · read from SQLite`,
          payload: persistedAfter,
        };
      }
      if (event.type === "decision.recorded") {
        return { ...event, payload: persistedAfter.returnRecord };
      }
      return event;
    });
    databaseBackedEvents.push({
      type: "database.roundtrip",
      title: "Business state committed and read back",
      detail: `${system} inventory_state and return_state persisted in SQLite`,
      payload: { before: persistedBefore, after: persistedAfter },
    });
    databaseBackedEvents.unshift({
      type: "implementation.selected",
      title: "Independent workflow implementation selected",
      detail: executed.implementationId,
      payload: { system, implementationId: executed.implementationId, candidateVersion },
    });
    const evidence: EvidenceRecord[] = databaseBackedEvents.map((event, index) => {
      const sequence = index + 1;
      const digestBody = {
        type: event.type,
        title: event.title,
        detail: event.detail,
        payload: event.payload,
        sequence,
        capturedAt,
      };
      return {
        ...event,
        evidenceId: `ev_${traceId}_${String(sequence).padStart(3, "0")}`,
        digest: sha256Digest(digestBody),
        sequence,
        capturedAt,
      };
    });
    const trace: WorkflowTrace = {
      traceId,
      system,
      implementationId: executed.implementationId,
      ...(system === "replacement" ? { candidateVersion } : {}),
      ...(scenarioId ? { scenarioId } : {}),
      input,
      result: persistedResult,
      stateSource: "node:sqlite",
      evidence,
      capturedAt,
    };
    this.store.putTrace(trace);
    return trace;
  }

  extractContract(trace: WorkflowTrace): BehaviorContract {
    const ruleEvidence = evidenceFor(trace, "rule.applied");
    const stateAfterEvidence = evidenceFor(trace, "state.after");
    const contract: BehaviorContract = {
      contractId: `contract_${randomUUID()}`,
      sourceTraceId: trace.traceId,
      scope: `Observed ${trace.result.appliedRuleId} branch for ${trace.input.itemCondition} item`,
      generation: { method: "deterministic-demo-extractor", openaiUsed: false },
      preconditions: [
        "amountCents is a positive integer",
        "inventory quantities are non-negative integers",
        ...(trace.result.decision === "REPLACEMENT" ? ["at least one sellable unit is available"] : []),
      ],
      rules: [
        {
          ruleId: trace.result.appliedRuleId,
          statement: RULE_STATEMENTS[trace.result.appliedRuleId] ?? "Observed workflow branch is preserved.",
          confidence: 1,
          evidenceIds: [ruleEvidence],
        },
        {
          ruleId: `RULE-${trace.input.itemCondition}-DISPOSITION`,
          statement:
            trace.input.itemCondition === "DAMAGED"
              ? "A processed damaged return never increases sellable inventory and is placed in quarantine."
              : "A processed sellable return may be restored to sellable inventory.",
          confidence: 1,
          evidenceIds: [stateAfterEvidence, evidenceFor(trace, "side-effects.recorded")],
        },
      ],
      invariants: [
        {
          invariantId: "INV-DAMAGED-NOT-SELLABLE",
          statement: "Damaged returned units must not increase sellable stock.",
          evidenceIds: [evidenceFor(trace, "state.before"), stateAfterEvidence],
        },
        {
          invariantId: "INV-NON-NEGATIVE-STOCK",
          statement: "Inventory quantities remain non-negative.",
          evidenceIds: [stateAfterEvidence],
        },
      ],
      expectedOutcome: trace.result,
      unknowns: [
        "This contract is evidence-bounded to the observed branch; unobserved branches are not claimed equivalent.",
        "External payment settlement and carrier integrations are outside this demo boundary.",
      ],
      createdAt: new Date().toISOString(),
    };
    this.store.putContract(contract);
    return contract;
  }

  runDemo(options: {
    scenarioId?: string;
    input?: ReturnWorkflowInput;
    candidateVersion?: CandidateVersion;
  }): DemoRunResponse {
    const candidateVersion = options.candidateVersion ?? "buggy";
    const scenario = options.scenarioId ? findScenario(options.scenarioId) : undefined;
    if (options.scenarioId && !scenario) {
      throw new Error(`unknown scenarioId: ${options.scenarioId}`);
    }
    const input = options.input ?? scenario?.input ?? scenarios[0]?.input;
    if (!input) throw new Error("no workflow input supplied");
    const scenarioId = scenario?.id ?? options.scenarioId;
    const legacy = this.capture("legacy", input, candidateVersion, scenarioId);
    const replacement = this.capture("replacement", input, candidateVersion, scenarioId);
    const contract = this.extractContract(legacy);
    const runId = `run_${randomUUID()}`;

    const paths = [
      { path: "decision", label: "Decision is preserved", severity: "critical" as const, evidenceType: "decision.recorded" },
      {
        path: "returnRecord.status",
        label: "Return status is preserved",
        severity: "critical" as const,
        evidenceType: "decision.recorded",
      },
      {
        path: "returnRecord.refundCents",
        label: "Refund amount is preserved",
        severity: "critical" as const,
        evidenceType: "decision.recorded",
      },
      {
        path: "inventoryAfter.sellable",
        label: "Sellable inventory side effect matches",
        severity: "critical" as const,
        evidenceType: "state.after",
      },
      {
        path: "inventoryAfter.quarantine",
        label: "Quarantine inventory side effect matches",
        severity: "major" as const,
        evidenceType: "state.after",
      },
    ];

    const assertions: DeterministicAssertion[] = paths.map((entry, index) => {
      const expected = valueAt(legacy, entry.path);
      const actual = valueAt(replacement, entry.path);
      return {
        assertionId: `assert_${String(index + 1).padStart(3, "0")}`,
        label: entry.label,
        status: Object.is(expected, actual) ? "PASSED" : "FAILED",
        expected,
        actual,
        legacyEvidenceId: evidenceFor(legacy, entry.evidenceType),
        candidateEvidenceId: evidenceFor(replacement, entry.evidenceType),
      };
    });
    const mismatches: VerificationMismatch[] = assertions
      .filter((assertion) => assertion.status === "FAILED")
      .map((assertion) => {
        const metadata = paths.find((entry) => entry.label === assertion.label);
        return {
          path: metadata?.path ?? assertion.label,
          expected: assertion.expected,
          actual: assertion.actual,
          severity: metadata?.severity ?? "major",
          legacyEvidenceId: assertion.legacyEvidenceId,
          candidateEvidenceId: assertion.candidateEvidenceId,
          explanation: `${assertion.label}: legacy produced ${String(assertion.expected)}, candidate produced ${String(assertion.actual)}.`,
        };
      });
    const status = mismatches.length === 0 ? "PASSED" : "FAILED";
    const proofBody: Omit<ProofBundle, "digest"> = {
      proofId: `proof_${randomUUID()}`,
      runId,
      status,
      claim: "Covered-scenario behavioral conformance against the captured legacy execution.",
      ...(scenarioId ? { scenarioId } : {}),
      candidateVersion,
      implementations: {
        legacy: legacy.implementationId,
        candidate: replacement.implementationId,
      },
      legacyTraceId: legacy.traceId,
      candidateTraceId: replacement.traceId,
      contractId: contract.contractId,
      assertions,
      mismatches,
      mutationDetected: candidateVersion === "buggy" && mismatches.length > 0,
      limitations: [
        "The proof covers only this concrete input and the deterministic assertions listed here.",
        "No OpenAI or Codex call is represented by this local run.",
      ],
      generatedAt: new Date().toISOString(),
    };
    const proof: ProofBundle = { ...proofBody, digest: sha256Digest(proofBody) };
    this.store.putProof(proof);

    const events = [
      ...legacy.evidence.map((item) => ({
        type: `legacy.${item.type}`,
        title: item.title,
        detail: item.detail,
        evidenceId: item.evidenceId,
        digest: item.digest,
      })),
      ...replacement.evidence.map((item) => ({
        type: `replacement.${item.type}`,
        title: item.title,
        detail: item.detail,
        evidenceId: item.evidenceId,
        digest: item.digest,
      })),
      ...mismatches.map((mismatch) => {
        const event = {
          type: "verifier.mismatch",
          title: `Mismatch: ${mismatch.path}`,
          detail: mismatch.explanation,
          evidenceId: mismatch.candidateEvidenceId,
        };
        return { ...event, digest: digestForEvidence(replacement, mismatch.candidateEvidenceId) };
      }),
    ];

    return {
      runId,
      status,
      source: "deterministic-local-demo",
      events,
      rules: contract.rules,
      proofs: assertions.map((assertion) => ({
        proofId: assertion.assertionId,
        label: assertion.label,
        status: assertion.status,
        expected: assertion.expected,
        actual: assertion.actual,
      })),
      contract,
      proofBundle: proof,
      traces: { legacy, replacement },
    };
  }

  runSuite(candidateVersion: CandidateVersion = "buggy") {
    const runs = scenarios.map((scenario) =>
      this.runDemo({ scenarioId: scenario.id, candidateVersion }),
    );
    return {
      candidateVersion,
      status: runs.every((run) => run.status === "PASSED") ? "PASSED" : "FAILED",
      summary: {
        total: runs.length,
        passed: runs.filter((run) => run.status === "PASSED").length,
        failed: runs.filter((run) => run.status === "FAILED").length,
      },
      runs: runs.map(({ runId, status, proofBundle }) => ({ runId, status, proofBundle })),
    };
  }
}
