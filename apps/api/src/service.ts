import { randomUUID } from "node:crypto";
import {
  assertWithinEvidenceBoundary,
  createHostHiddenScenario,
  executeWorkflow,
  findScenario,
  scenarios,
  validateWorkflowInput,
} from "./domain.js";
import { sha256Digest } from "./digest.js";
import { ArtifactStore } from "./store.js";
import type {
  BehaviorContract,
  CandidateVersion,
  DemoRunResponse,
  DeterministicAssertion,
  EvidenceRecord,
  ImplementationId,
  ProofBundle,
  ReturnWorkflowInput,
  Scenario,
  SystemName,
  VerificationMismatch,
  WorkflowAttemptTrace,
  WorkflowFailureCode,
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

function evidenceForAttempt(trace: WorkflowAttemptTrace, type: string): string {
  return trace.evidence.find((item) => item.type === type)?.evidenceId ?? trace.evidence[0]?.evidenceId ?? "missing";
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

function implementationIdFor(
  system: SystemName,
  candidateVersion: CandidateVersion,
): ImplementationId {
  if (system === "legacy") return "legacy.return-workflow.v1";
  return candidateVersion === "generated"
    ? "replacement.return-workflow.generated-candidate"
    : "replacement.return-workflow.seeded-candidate";
}

function failureCodeFor(error: unknown): WorkflowFailureCode {
  const explicitCode = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (
    explicitCode === "INSUFFICIENT_SELLABLE_STOCK"
    || explicitCode === "OUTSIDE_EVIDENCE_BOUNDARY"
  ) {
    return explicitCode;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /without sellable stock/i.test(message)
    ? "INSUFFICIENT_SELLABLE_STOCK"
    : "UNEXPECTED_WORKFLOW_ERROR";
}

function attemptValueAt(trace: WorkflowAttemptTrace, path: string): unknown {
  const values: Record<string, unknown> = {
    "execution.status": trace.outcome.status,
    failure: {
      code: trace.outcome.failureCode,
      message: trace.outcome.failureMessage,
    },
    "returnRecord.created": trace.outcome.returnRecordCreated,
    inventoryAfter: {
      sellable: trace.outcome.inventoryAfter.sellable,
      quarantine: trace.outcome.inventoryAfter.quarantine,
    },
    "sideEffects.count": trace.outcome.sideEffects.length,
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
    candidateVersion: CandidateVersion = "seeded",
    scenarioId?: string,
  ): WorkflowTrace {
    const input = validateWorkflowInput(rawInput);
    // This is intentionally before resetBusinessState. Initializing the
    // SQLite fixture is itself a business-state mutation, so an unsupported
    // condition must be refused before the workflow or store is touched.
    assertWithinEvidenceBoundary(input);
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

  /**
   * Captures both successful and rejected attempts without inventing a
   * WorkflowResult for the latter. The workflow implementation runs before
   * any write; if it throws, SQLite is read back to prove that no partial
   * state was committed. A returned but invalid result is recorded as a
   * successful workflow execution with rejected persistence, rather than
   * being blurred into the legacy business rejection.
   */
  captureAttempt(
    system: SystemName,
    rawInput: unknown,
    candidateVersion: CandidateVersion = "seeded",
    scenarioId?: string,
  ): WorkflowAttemptTrace {
    const input = validateWorkflowInput(rawInput);
    // Keep the evidence boundary outside the failure-attempt transaction too.
    // captureAttempt is for covered-domain business failures (for example
    // exhausted stock), not a mechanism for seeding unsupported inputs.
    assertWithinEvidenceBoundary(input);
    const persistedBefore = this.store.resetBusinessState(system, input);
    let status: WorkflowAttemptTrace["outcome"]["status"] = "FAILED";
    let failureCode: WorkflowFailureCode | null = null;
    let failureMessage: string | null = null;
    let persistenceStatus: WorkflowAttemptTrace["outcome"]["persistenceStatus"] = "NOT_ATTEMPTED";
    let sideEffects: WorkflowAttemptTrace["outcome"]["sideEffects"] = [];
    let returnedResult: ReturnType<typeof executeWorkflow>["result"] | undefined;
    let persistenceError: string | null = null;
    let implementationId = implementationIdFor(system, candidateVersion);

    try {
      const executed = executeWorkflow(input, system, candidateVersion);
      implementationId = executed.implementationId;
      returnedResult = executed.result;
      sideEffects = executed.result.sideEffects;
      status = "SUCCEEDED";
      try {
        this.store.applyBusinessResult(system, executed.result);
        persistenceStatus = "COMMITTED";
      } catch (error) {
        persistenceStatus = "REJECTED";
        persistenceError = error instanceof Error ? error.message : String(error);
      }
    } catch (error) {
      failureCode = failureCodeFor(error);
      failureMessage = error instanceof Error ? error.message : String(error);
    }

    const persistedAfter = this.store.snapshotBusinessState(system, input.sku, input.returnId);
    const traceId = `trace_${randomUUID()}`;
    const capturedAt = new Date().toISOString();
    const events = [
      {
        type: "implementation.selected",
        title: "Independent workflow implementation selected",
        detail: implementationId,
        payload: { system, implementationId, candidateVersion },
      },
      {
        type: "input.captured",
        title: `${system === "legacy" ? "Legacy" : "Candidate"} workflow input captured`,
        detail: `${input.returnId} · ${input.customerTier} · ${input.itemCondition} · ${input.amountCents} cents`,
        payload: input,
      },
      {
        type: "state.before",
        title: "Inventory snapshot before attempt",
        detail: `${persistedBefore.inventory.sellable} sellable, ${persistedBefore.inventory.quarantine} quarantined · read from SQLite`,
        payload: persistedBefore,
      },
      {
        type: "execution.outcome",
        title: status === "FAILED" ? "Workflow rejected the operation" : "Workflow returned a result",
        detail: status === "FAILED"
          ? `${failureCode}: ${failureMessage}`
          : `Execution returned before persistence ${persistenceStatus.toLowerCase()}`,
        payload: {
          status,
          failureCode,
          failureMessage,
          persistenceStatus,
          persistenceError,
          returnedResult,
        },
      },
      {
        type: "failure.recorded",
        title: failureCode ?? "No business rejection recorded",
        detail: failureMessage ?? "The workflow returned a result instead of rejecting the operation.",
        payload: { failureCode, failureMessage },
      },
      {
        type: "state.after",
        title: "Inventory snapshot after attempt",
        detail: `${persistedAfter.inventory.sellable} sellable, ${persistedAfter.inventory.quarantine} quarantined · read from SQLite`,
        payload: persistedAfter,
      },
      {
        type: "return-state.observed",
        title: persistedAfter.returnRecord ? "Return record exists" : "No return record was created",
        detail: persistedAfter.returnRecord?.status ?? "SQLite return_state remained empty for this return ID.",
        payload: persistedAfter.returnRecord ?? null,
      },
      {
        type: "side-effects.recorded",
        title: sideEffects.length === 0 ? "No workflow side effects returned" : "Workflow side effects returned",
        detail: sideEffects.length === 0 ? "0 side effects" : sideEffects.map(({ type }) => type).join(", "),
        payload: sideEffects,
      },
      {
        type: "database.roundtrip",
        title: "Business state read back after attempt",
        detail: `${system} inventory_state and return_state verified in SQLite`,
        payload: { before: persistedBefore, after: persistedAfter, persistenceStatus },
      },
    ];
    const evidence: EvidenceRecord[] = events.map((event, index) => {
      const sequence = index + 1;
      const digestBody = { ...event, sequence, capturedAt };
      return {
        ...event,
        evidenceId: `ev_${traceId}_${String(sequence).padStart(3, "0")}`,
        digest: sha256Digest(digestBody),
        sequence,
        capturedAt,
      };
    });
    const trace: WorkflowAttemptTrace = {
      traceId,
      system,
      implementationId,
      ...(system === "replacement" ? { candidateVersion } : {}),
      ...(scenarioId ? { scenarioId } : {}),
      input,
      outcome: {
        status,
        failureCode,
        failureMessage,
        persistenceStatus,
        inventoryBefore: persistedBefore.inventory,
        inventoryAfter: persistedAfter.inventory,
        returnRecordCreated: Boolean(persistedAfter.returnRecord),
        sideEffects,
      },
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
      scope: `Observed ${trace.result.appliedRuleId} DAMAGED branch only; every non-DAMAGED condition is outside this contract and is refused before business-state writes`,
      generation: { method: "deterministic-demo-extractor", openaiUsed: false },
      preconditions: [
        "itemCondition is DAMAGED; the host rejects every other condition with OUTSIDE_EVIDENCE_BOUNDARY before business-state writes",
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
          ruleId: "RULE-DAMAGED-DISPOSITION",
          statement: "Within this DAMAGED-only contract, a processed return never increases sellable inventory and is placed in quarantine.",
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
    scenario?: Scenario;
  }): DemoRunResponse {
    const candidateVersion = options.candidateVersion ?? "seeded";
    const scenario = options.scenario
      ?? (options.scenarioId ? findScenario(options.scenarioId) : undefined);
    if (options.scenarioId && !scenario && !options.input) {
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
      mutationDetected: mismatches.length > 0,
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

  runVerification(options: {
    scenarioId?: string;
    input?: ReturnWorkflowInput;
    candidateVersion?: CandidateVersion;
    scenario?: Scenario;
  }) {
    const scenario = options.scenario
      ?? (options.scenarioId ? findScenario(options.scenarioId) : undefined);
    return scenario?.expectedFailure
      ? this.runExpectedFailureScenario(scenario, options.candidateVersion ?? "seeded")
      : this.runDemo(options);
  }

  private runExpectedFailureScenario(
    scenario: Scenario,
    candidateVersion: CandidateVersion,
  ) {
    const expectedFailure = scenario.expectedFailure;
    if (!expectedFailure) throw new Error(`scenario ${scenario.id} has no expected failure contract`);
    const legacy = this.captureAttempt("legacy", scenario.input, candidateVersion, scenario.id);
    const legacyMutated =
      legacy.outcome.inventoryBefore.sellable !== legacy.outcome.inventoryAfter.sellable
      || legacy.outcome.inventoryBefore.quarantine !== legacy.outcome.inventoryAfter.quarantine;
    if (
      legacy.outcome.status !== "FAILED"
      || legacy.outcome.failureCode !== expectedFailure.code
      || legacy.outcome.failureMessage !== expectedFailure.message
      || legacy.outcome.returnRecordCreated !== expectedFailure.returnRecordCreated
      || legacy.outcome.sideEffects.length !== expectedFailure.sideEffectsCount
      || legacyMutated !== expectedFailure.inventoryMutation
    ) {
      throw new Error(`LEGACY_FAILURE_EXPECTATION_MISMATCH:${scenario.id}`);
    }
    const replacement = this.captureAttempt(
      "replacement",
      scenario.input,
      candidateVersion,
      scenario.id,
    );
    const contract: BehaviorContract = {
      contractId: `contract_${randomUUID()}`,
      sourceTraceId: legacy.traceId,
      scope: "Observed replacement rejection when sellable stock is exhausted",
      generation: { method: "deterministic-demo-extractor", openaiUsed: false },
      preconditions: [
        "customerTier is VIP",
        "amountCents is below the high-value review threshold",
        "sellable inventory is zero",
      ],
      rules: [{
        ruleId: "RULE-REPLACEMENT-STOCK-REQUIRED",
        statement: "A replacement requires at least one sellable unit; otherwise the workflow rejects before creating side effects.",
        confidence: 1,
        evidenceIds: [evidenceForAttempt(legacy, "execution.outcome"), evidenceForAttempt(legacy, "database.roundtrip")],
      }],
      invariants: [
        {
          invariantId: "INV-FAILED-ATTEMPT-IS-ATOMIC",
          statement: "A rejected replacement creates no return record, shipment, or inventory mutation.",
          evidenceIds: [
            evidenceForAttempt(legacy, "state.before"),
            evidenceForAttempt(legacy, "state.after"),
            evidenceForAttempt(legacy, "return-state.observed"),
            evidenceForAttempt(legacy, "side-effects.recorded"),
          ],
        },
      ],
      expectedFailure,
      unknowns: [
        "The failure contract is bounded to the observed VIP damaged-return replacement branch.",
        "Concurrent stock reservations and external shipment systems are outside this demo boundary.",
      ],
      createdAt: new Date().toISOString(),
    };
    this.store.putContract(contract);

    const paths = [
      { path: "execution.status", label: "Failure status is preserved", severity: "critical" as const, evidenceType: "execution.outcome" },
      { path: "failure", label: "Failure reason is preserved", severity: "critical" as const, evidenceType: "failure.recorded" },
      { path: "returnRecord.created", label: "No return record is created", severity: "critical" as const, evidenceType: "return-state.observed" },
      { path: "inventoryAfter", label: "Inventory remains unchanged", severity: "critical" as const, evidenceType: "state.after" },
      { path: "sideEffects.count", label: "No shipment or other side effect is emitted", severity: "critical" as const, evidenceType: "side-effects.recorded" },
    ];
    const assertions: DeterministicAssertion[] = paths.map((entry, index) => {
      const expected = attemptValueAt(legacy, entry.path);
      const actual = attemptValueAt(replacement, entry.path);
      return {
        assertionId: `assert_${String(index + 1).padStart(3, "0")}`,
        label: entry.label,
        status: JSON.stringify(expected) === JSON.stringify(actual) ? "PASSED" : "FAILED",
        expected,
        actual,
        legacyEvidenceId: evidenceForAttempt(legacy, entry.evidenceType),
        candidateEvidenceId: evidenceForAttempt(replacement, entry.evidenceType),
      };
    });
    const mismatches: VerificationMismatch[] = assertions
      .filter(({ status }) => status === "FAILED")
      .map((assertion) => {
        const metadata = paths.find(({ label }) => label === assertion.label);
        return {
          path: metadata?.path ?? assertion.label,
          expected: assertion.expected,
          actual: assertion.actual,
          severity: metadata?.severity ?? "critical",
          legacyEvidenceId: assertion.legacyEvidenceId,
          candidateEvidenceId: assertion.candidateEvidenceId,
          explanation: `${assertion.label}: legacy produced ${JSON.stringify(assertion.expected)}, candidate produced ${JSON.stringify(assertion.actual)}.`,
        };
      });
    const runId = `run_${randomUUID()}`;
    const status = mismatches.length === 0 ? "PASSED" : "FAILED";
    const proofBody: Omit<ProofBundle, "digest"> = {
      proofId: `proof_${randomUUID()}`,
      runId,
      status,
      claim: "Failure behavior and atomicity conformance for the exhausted-stock replacement counterexample.",
      scenarioId: scenario.id,
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
      mutationDetected: mismatches.length > 0,
      limitations: [
        "The proof covers only this concrete exhausted-stock input and the five deterministic failure assertions listed here.",
        "No OpenAI or Codex call is represented by this local run.",
      ],
      generatedAt: new Date().toISOString(),
    };
    const proofBundle: ProofBundle = { ...proofBody, digest: sha256Digest(proofBody) };
    this.store.putProof(proofBundle);
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
    ];
    return {
      runId,
      status,
      source: "deterministic-local-demo" as const,
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
      proofBundle,
      traces: { legacy, replacement },
    };
  }

  private runScenarioCorpus(
    candidateVersion: CandidateVersion,
    corpus: Scenario[],
  ) {
    const runs = corpus.map((scenario) =>
      scenario.expectedFailure
        ? this.runExpectedFailureScenario(scenario, candidateVersion)
        : this.runDemo({ scenario, candidateVersion }),
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

  /** Only evidence disclosed to the writer; no host-hidden input exists yet. */
  runVisibleSuite(candidateVersion: CandidateVersion = "seeded") {
    return this.runScenarioCorpus(candidateVersion, scenarios);
  }

  /**
   * Final host verifier. The hidden scenario is materialized at call time, so
   * a preceding model turn cannot inspect its concrete input.
   */
  runSuite(candidateVersion: CandidateVersion = "seeded", hiddenNonce?: string) {
    return this.runScenarioCorpus(candidateVersion, [
      ...scenarios,
      createHostHiddenScenario(hiddenNonce),
    ]);
  }
}
