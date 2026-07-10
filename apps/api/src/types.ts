export type SystemName = "legacy" | "replacement";
export type CandidateVersion = "buggy" | "fixed" | "generated";
export type CustomerTier = "STANDARD" | "VIP";
export type ItemCondition = "SELLABLE" | "DAMAGED";
export type Decision = "REFUND" | "REPLACEMENT" | "MANUAL_REVIEW";
export type VerificationStatus = "PASSED" | "FAILED";
export type ImplementationId =
  | "legacy.return-workflow.v1"
  | "replacement.return-workflow.v0-mutated"
  | "replacement.return-workflow.v1-reference"
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
  expectedOutcome: WorkflowResult;
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
