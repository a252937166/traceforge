export type SystemName = "legacy" | "replacement";
/**
 * Public candidate identities used by the champion workflow.
 *
 * `seeded` is the deliberately incomplete first implementation. `generated`
 * is the complete, Codex-editable implementation. No other public identity is
 * accepted by this contract.
 */
export type CandidateVersion = "seeded" | "generated";
export type CustomerTier = "STANDARD" | "VIP";
export type ItemCondition = "SELLABLE" | "DAMAGED";
export type Decision = "REFUND" | "REPLACEMENT" | "MANUAL_REVIEW";
export type VerificationStatus = "PASSED" | "FAILED";
export type ImplementationId =
  | "legacy.return-workflow.v1"
  | "replacement.return-workflow.seeded-candidate"
  | "replacement.return-workflow.generated-candidate";

export interface ReturnWorkflowInput {
  returnId: string;
  sku: string;
  amountCents: number;
  customerTier: CustomerTier;
  itemCondition: ItemCondition;
  initialInventory?: {
    sellable: number;
    quarantine: number;
  };
}

export interface InventoryState {
  sku: string;
  sellable: number;
  quarantine: number;
}

export interface ReturnRecord {
  returnId: string;
  status: "REFUNDED" | "REPLACEMENT_ISSUED" | "PENDING_REVIEW";
  decision: Decision;
  refundCents: number;
}

export interface WorkflowResult {
  decision: Decision;
  appliedRuleId: string;
  returnRecord: ReturnRecord;
  inventoryBefore: InventoryState;
  inventoryAfter: InventoryState;
  sideEffects: Array<{
    type: "REFUND_LEDGER" | "INVENTORY_MOVE" | "REVIEW_QUEUE" | "SHIPMENT";
    detail: Record<string, string | number>;
  }>;
}

export interface WorkflowExecution {
  implementationId: ImplementationId;
  result: WorkflowResult;
  events: WorkflowEvent[];
}

export interface WorkflowEvent {
  type: string;
  title: string;
  detail: string;
  payload: unknown;
}

export interface EvidenceRecord extends WorkflowEvent {
  evidenceId: string;
  digest: string;
  sequence: number;
  capturedAt: string;
}

export interface WorkflowTrace {
  traceId: string;
  system: SystemName;
  implementationId: ImplementationId;
  candidateVersion?: CandidateVersion;
  scenarioId?: string;
  input: ReturnWorkflowInput;
  result: WorkflowResult;
  stateSource: "node:sqlite";
  evidence: EvidenceRecord[];
  capturedAt: string;
}

export type WorkflowFailureCode =
  | "INSUFFICIENT_SELLABLE_STOCK"
  | "OUTSIDE_EVIDENCE_BOUNDARY"
  | "UNEXPECTED_WORKFLOW_ERROR";

/**
 * A failure-aware execution trace used for counterexamples whose observable
 * legacy behavior is to reject the operation before committing any state.
 *
 * This is intentionally separate from `WorkflowTrace`: a rejected execution
 * must never be represented as a successful `WorkflowResult` with invented
 * decision or return-record fields.
 */
export interface WorkflowAttemptTrace {
  traceId: string;
  system: SystemName;
  implementationId: ImplementationId;
  candidateVersion?: CandidateVersion;
  scenarioId?: string;
  input: ReturnWorkflowInput;
  outcome: {
    status: "SUCCEEDED" | "FAILED";
    failureCode: WorkflowFailureCode | null;
    failureMessage: string | null;
    persistenceStatus: "COMMITTED" | "NOT_ATTEMPTED" | "REJECTED";
    inventoryBefore: InventoryState;
    inventoryAfter: InventoryState;
    returnRecordCreated: boolean;
    sideEffects: WorkflowResult["sideEffects"];
  };
  stateSource: "node:sqlite";
  evidence: EvidenceRecord[];
  capturedAt: string;
}

export type StoredWorkflowTrace = WorkflowTrace | WorkflowAttemptTrace;

export interface BusinessStateSnapshot {
  system: SystemName;
  inventory: InventoryState;
  returnRecord?: ReturnRecord;
  readAt: string;
}

export interface BehaviorRule {
  ruleId: string;
  statement: string;
  confidence: number;
  evidenceIds: string[];
}

export interface BehaviorContract {
  contractId: string;
  sourceTraceId: string;
  scope: string;
  generation: {
    method: "deterministic-demo-extractor";
    openaiUsed: false;
  };
  preconditions: string[];
  rules: BehaviorRule[];
  invariants: Array<{
    invariantId: string;
    statement: string;
    evidenceIds: string[];
  }>;
  expectedOutcome?: WorkflowResult;
  expectedFailure?: {
    code: WorkflowFailureCode;
    message: string;
    returnRecordCreated: false;
    inventoryMutation: false;
    sideEffectsCount: 0;
  };
  unknowns: string[];
  createdAt: string;
}

export interface VerificationMismatch {
  path: string;
  expected: unknown;
  actual: unknown;
  severity: "critical" | "major";
  legacyEvidenceId: string;
  candidateEvidenceId: string;
  explanation: string;
}

export interface DeterministicAssertion {
  assertionId: string;
  label: string;
  status: VerificationStatus;
  expected: unknown;
  actual: unknown;
  legacyEvidenceId: string;
  candidateEvidenceId: string;
}

export interface ProofBundle {
  proofId: string;
  runId: string;
  status: VerificationStatus;
  claim: string;
  scenarioId?: string;
  candidateVersion: CandidateVersion;
  implementations: {
    legacy: ImplementationId;
    candidate: ImplementationId;
  };
  legacyTraceId: string;
  candidateTraceId: string;
  contractId: string;
  assertions: DeterministicAssertion[];
  mismatches: VerificationMismatch[];
  mutationDetected: boolean;
  limitations: string[];
  generatedAt: string;
  digest: string;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  stage: "observed" | "counterexample" | "boundary" | "held-out";
  visibility: "visible" | "hidden";
  provenance: {
    source: "model-proposed" | "host-derived" | "host-authored";
    detail: string;
  };
  expectedFailure?: {
    code: WorkflowFailureCode;
    message: string;
    returnRecordCreated: false;
    inventoryMutation: false;
    sideEffectsCount: 0;
  };
  input: ReturnWorkflowInput;
}

export interface DemoEvent {
  type: string;
  title: string;
  detail: string;
  evidenceId: string;
  digest: string;
}

export interface DemoRunResponse {
  runId: string;
  status: VerificationStatus;
  source: "deterministic-local-demo";
  events: DemoEvent[];
  rules: BehaviorRule[];
  proofs: Array<{
    proofId: string;
    label: string;
    status: VerificationStatus;
    expected: unknown;
    actual: unknown;
  }>;
  contract: BehaviorContract;
  proofBundle: ProofBundle;
  traces: {
    legacy: WorkflowTrace;
    replacement: WorkflowTrace;
  };
}
