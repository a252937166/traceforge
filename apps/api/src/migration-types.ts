import type { VerificationStatus } from "./types.js";

export type MigrationExecutionMode = "live-ai" | "recorded-replay" | "deterministic-only";
export type MigrationStage = "observe" | "infer" | "challenge" | "build" | "verify";
export type MigrationStatus = "queued" | "running" | "passed" | "failed";
export type MigrationEventStatus = "queued" | "running" | "passed" | "failed" | "skipped";
export type MigrationEventOrigin = "live" | "recorded";
export type MigrationActor =
  | "legacy-runner"
  | "gpt-5.6-archaeologist"
  | "gpt-5.6-counterexample-hunter"
  | "gpt-5.6-contract-critic"
  | "codex"
  | "host-verifier";

export interface MigrationJob {
  id: string;
  executionMode: MigrationExecutionMode;
  scenarioIds: string[];
  status: MigrationStatus;
  currentStage: MigrationStage;
  streamVersion: number;
  model?: "gpt-5.6-sol";
  modelId?: "gpt-5.6-sol";
  recordedAt?: string;
  sourceRunId?: string;
  replayDisclosure?: string;
  proofId?: string;
  error?: { code: string; message: string; stage: MigrationStage };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  links: {
    self: string;
    events: string;
    proof: string;
    artifacts: string;
  };
}

export interface MigrationEvent {
  id: string;
  migrationId: string;
  sequence: number;
  occurredAt: string;
  stage: MigrationStage;
  type: string;
  origin: MigrationEventOrigin;
  actor: MigrationActor;
  status: MigrationEventStatus;
  title: string;
  detail: string;
  evidenceIds: string[];
  artifactIds: string[];
  parentEventId?: string;
  durationMs?: number;
  payload: Record<string, unknown>;
  digest: string;
}

export interface ModelInvocationEvidence {
  role: "trace-archaeologist" | "counterexample-hunter" | "contract-critic";
  provider: "openai";
  model: "gpt-5.6-sol";
  authPath: "codex-chatgpt" | "responses-api";
  threadId: string;
  startedAt: string;
  completedAt: string;
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningOutputTokens?: number;
    totalTokens?: number;
  };
  inputTraceIds: string[];
  inputEvidenceDigests: string[];
  inputDigest: string;
  outputDigest: string;
  schemaVersion: "traceforge.behavior-archaeology.v1";
  status: "succeeded" | "failed";
}

export interface MigrationScenarioProof {
  scenarioId: string;
  partition: "observed" | "counterexample" | "boundary" | "held-out";
  status: VerificationStatus;
  legacyTraceId: string;
  candidateTraceId: string;
  assertionCount: number;
  mismatchCount: number;
  mismatches: Array<{ path: string; expected: unknown; actual: unknown }>;
  provenance: {
    source: "model-proposed" | "host-derived" | "host-authored";
    detail: string;
  };
}

export interface MigrationProofBundle {
  proofId: string;
  migrationId: string;
  status: VerificationStatus;
  claim: string;
  contractId: string;
  contractDigest: string;
  modelInvocations: ModelInvocationEvidence[];
  candidate: {
    implementationId: string;
    sourceDigest: string;
    diffDigest: string;
    codexThreadId?: string;
    baseCommit?: string;
    changedFiles?: string[];
  };
  hostVerification?: {
    testsPassed: number;
    testsTotal: number;
    testsSkipped?: number;
    scope?: "candidate-safe" | "full-release";
    source: "recorded-command-log" | "live-command-output";
  };
  coverage: {
    observed: number;
    counterexample: number;
    boundary: number;
    heldOut: number;
    total: number;
    passed: number;
  };
  scenarios: MigrationScenarioProof[];
  limitations: string[];
  generatedAt: string;
  digest: string;
}

export type MigrationArtifactKind =
  | "proof"
  | "evidence"
  | "diff"
  | "contract"
  | "command-log";

export interface MigrationArtifactMetadata {
  id: string;
  migrationId: string;
  label: string;
  filename: string;
  kind: MigrationArtifactKind;
  mimeType: string;
  digest: string;
  byteLength: number;
  href: string;
  createdAt: string;
}

export interface MigrationArtifact extends MigrationArtifactMetadata {
  body: string;
}

export interface StartMigrationRequest {
  executionMode: MigrationExecutionMode;
  scenarioIds?: string[];
}
