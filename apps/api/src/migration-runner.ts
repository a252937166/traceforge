import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BehaviorArchaeologyAdapter } from "./behavior-archaeology.js";
import {
  CodexRepairAdapter,
  GENERATED_CANDIDATE_PATH,
  type CodexRepairResult,
  type GeneratedCandidateSuiteEvidence,
} from "./codex-adapter.js";
import { sha256Digest } from "./digest.js";
import {
  createHostHiddenScenario,
  findScenario,
  scenarios,
  validateWorkflowInput,
} from "./domain.js";
import { MigrationStore } from "./migration-store.js";
import type {
  MigrationArtifact,
  MigrationEvent,
  MigrationEventOrigin,
  MigrationEventStatus,
  MigrationJob,
  ModelInvocationEvidence,
  MigrationProofBundle,
  MigrationScenarioProof,
  MigrationStage,
  StartMigrationRequest,
} from "./migration-types.js";
import { recordedArchaeology, recordedModelInvocations } from "./recorded-archaeology.js";
import { recordedCodexBuild } from "./recorded-codex-build.js";
import { TraceForgeService } from "./service.js";
import type {
  CandidateVersion,
  ReturnWorkflowInput,
  StoredWorkflowTrace,
  WorkflowAttemptTrace,
  WorkflowTrace,
} from "./types.js";

type EventPayload = Record<string, unknown>;

export type ContractUnknown = {
  unknownId: string;
  question: string;
  blocking: boolean;
  relatedRuleIds: string[];
};

type ArchaeologistOutput = {
  role: "trace_archaeologist";
  hypotheses: Array<{
    ruleId: string;
    statement: string;
    confidence: number;
    evidenceIds: string[];
    competingRuleIds: string[];
  }>;
  invariants: Array<{ invariantId: string; statement: string; evidenceIds: string[] }>;
  unknowns: ContractUnknown[];
};

type HunterOutput = {
  role: "counterexample_hunter";
  scenario: { scenarioId: string; input: ReturnWorkflowInput };
  distinguishes: Array<{ ruleId: string; fromRuleId: string; reason: string }>;
  expectedInformationGain: string;
  basedOnEvidenceIds: string[];
};

export type ResolvedContractUnknown = {
  unknownId: string;
  resolution: string;
  evidenceIds: string[];
};

export type CriticRemainingUnknown = {
  unknownId: string;
  inScope: boolean;
  reason: string;
};

export type RemainingContractUnknown = ContractUnknown & Omit<CriticRemainingUnknown, "unknownId">;

export type CriticOutput = {
  role: "contract_critic";
  findings: Array<{
    findingId: string;
    type: string;
    severity: "BLOCKING" | "WARNING";
    claim: string;
    ruleIds: string[];
    evidenceIds: string[];
    requiredAction: string;
  }>;
  revisedRules: Array<{
    ruleId: string;
    statement: string;
    priority: number;
    evidenceIds: string[];
    confidence: number;
  }>;
  resolvedUnknowns: ResolvedContractUnknown[];
  remainingUnknowns: CriticRemainingUnknown[];
  disposition: "NEEDS_COUNTEREXAMPLE" | "READY_FOR_BUILD" | "STOP_UNSUPPORTED";
};

export function reconcileCriticUnknownLifecycle(
  initialUnknowns: ContractUnknown[],
  critic: Pick<CriticOutput, "resolvedUnknowns" | "remainingUnknowns" | "disposition">,
): { resolvedUnknowns: ResolvedContractUnknown[]; remainingUnknowns: RemainingContractUnknown[] } {
  const initialById = new Map<string, ContractUnknown>();
  for (const unknown of initialUnknowns) {
    if (initialById.has(unknown.unknownId)) {
      throw new Error(`GPT56_CONTRACT_DUPLICATE_INITIAL_UNKNOWN:${unknown.unknownId}`);
    }
    initialById.set(unknown.unknownId, unknown);
  }

  const classified = new Set<string>();
  const classify = (unknownId: string) => {
    if (!initialById.has(unknownId)) {
      throw new Error(`GPT56_CONTRACT_UNKNOWN_LIFECYCLE_REFERENCE:${unknownId}`);
    }
    if (classified.has(unknownId)) {
      throw new Error(`GPT56_CONTRACT_UNKNOWN_LIFECYCLE_DUPLICATE:${unknownId}`);
    }
    classified.add(unknownId);
  };
  for (const unknown of critic.resolvedUnknowns) classify(unknown.unknownId);
  for (const unknown of critic.remainingUnknowns) classify(unknown.unknownId);

  const missing = [...initialById.keys()].filter((unknownId) => !classified.has(unknownId));
  if (missing.length > 0) {
    throw new Error(`GPT56_CONTRACT_UNKNOWN_LIFECYCLE_MISSING:${missing.join(",")}`);
  }

  const remainingUnknowns = critic.remainingUnknowns.map((remaining) => ({
    ...initialById.get(remaining.unknownId)!,
    inScope: remaining.inScope,
    reason: remaining.reason,
  }));
  const blocking = remainingUnknowns.filter(({ blocking: isBlocking, inScope }) => isBlocking && inScope);
  if (critic.disposition === "READY_FOR_BUILD" && blocking.length > 0) {
    throw new Error(`GPT56_CONTRACT_BLOCKING_UNKNOWNS:${blocking.map(({ unknownId }) => unknownId).join(",")}`);
  }

  return {
    resolvedUnknowns: critic.resolvedUnknowns,
    remainingUnknowns,
  };
}

export function hasEvidenceBoundStockSufficiencyRule(
  rules: CriticOutput["revisedRules"],
  stockEvidenceIds: Iterable<string>,
): boolean {
  const evidence = new Set(stockEvidenceIds);
  return rules.some((rule) => {
    const statement = rule.statement.toLowerCase();
    return rule.evidenceIds.some((evidenceId) => evidence.has(evidenceId))
      && /replacement/.test(statement)
      && /(sellable|stock|inventory)/.test(statement)
      && /(fail|reject|requir|availab|sufficien|at least|deny|denied|prohibit|zero|exhaust)/.test(statement);
  });
}

type CandidateEvidence = {
  threadId?: string;
  diff: string;
  sourceDigest?: string;
  baseCommit?: string;
  changedFiles?: string[];
  hostVerification?: MigrationProofBundle["hostVerification"];
};

type HostCommandArtifact = {
  command: string;
  exitCode: number;
  summary: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
};

function redactHostCommandText(value: string): string {
  const home = process.env.HOME;
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_OPENAI_KEY]")
    .replace(home ? new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : /$^/, "~");
}

const hostDeterministicContract = {
  id: "contract-host-deterministic-v1",
  source: "host-authored",
  scope: "The seven deterministic Web returns scenarios executed by the local verifier only.",
  rules: [
    {
      id: "HOST-R-HIGH-VALUE-HOLD",
      priority: 10,
      statement: "At or above 50,000 cents, require manual review before inventory or payment effects.",
    },
    {
      id: "HOST-R-STANDARD-REFUND",
      priority: 20,
      statement: "Below the review boundary, a standard damaged return refunds into quarantine.",
    },
    {
      id: "HOST-R-VIP-REPLACEMENT",
      priority: 30,
      statement: "Below the review boundary, a VIP damaged return is replaced and quarantined.",
    },
    {
      id: "HOST-R-REPLACEMENT-STOCK-REQUIRED",
      priority: 25,
      statement: "A VIP replacement with no sellable stock is rejected atomically without a return record, inventory mutation, shipment, or other side effect.",
    },
  ],
  unknowns: [
    "This host-authored contract does not claim behavior outside the executed REST and SQLite scenario corpus.",
  ],
} as const;

export function commandTestCounts(command?: { stdout: string; stderr: string; exitCode: number }): MigrationProofBundle["hostVerification"] {
  if (!command || command.exitCode !== 0) return undefined;
  const output = `${command.stdout}\n${command.stderr}`;
  const summary = (label: "tests" | "pass" | "skipped") =>
    [...output.matchAll(new RegExp(`(?:#|ℹ)\\s*${label}\\s+(\\d+)`, "g"))].at(-1)?.[1];
  const total = summary("tests");
  const passed = summary("pass");
  const skipped = summary("skipped");
  if (!total || !passed) return undefined;
  const skippedCount = skipped ? Number.parseInt(skipped, 10) : 0;
  return {
    testsPassed: Number.parseInt(passed, 10),
    testsTotal: Number.parseInt(total, 10) - skippedCount,
    ...(skippedCount ? { testsSkipped: skippedCount } : {}),
    scope: "candidate-safe",
    source: "live-command-output",
  };
}

export function candidateModuleSourceUrl(runtimeModuleUrl = import.meta.url): URL {
  const extension = runtimeModuleUrl.endsWith(".ts") ? "ts" : "js";
  return new URL(`./candidates/generated-return-workflow.${extension}`, runtimeModuleUrl);
}

export function assertCandidateSourceDigest(source: string, expectedDigest: string): string {
  const actualDigest = sha256Digest(source);
  if (actualDigest !== expectedDigest) {
    throw new Error("RECORDED_CANDIDATE_SOURCE_MISMATCH");
  }
  return actualDigest;
}

export async function verifyRecordedCandidateSourceDigest(
  runtimeModuleUrl = import.meta.url,
): Promise<string> {
  const sourceUrl = candidateModuleSourceUrl(runtimeModuleUrl);
  const source = await readFile(fileURLToPath(sourceUrl), "utf8");
  const expectedDigest = sourceUrl.pathname.endsWith(".ts")
    ? recordedCodexBuild.executableSourceDigests.typescript
    : recordedCodexBuild.executableSourceDigests.javascript;
  return assertCandidateSourceDigest(source, expectedDigest);
}

export class MigrationRunner {
  readonly archaeology: BehaviorArchaeologyAdapter;
  private readonly modelTimeoutMs: number;
  private readonly replayEventDelayMs: number;

  constructor(
    readonly service: TraceForgeService,
    readonly store: MigrationStore,
    env: NodeJS.ProcessEnv = process.env,
    readonly codex = new CodexRepairAdapter({ env }),
  ) {
    this.archaeology = new BehaviorArchaeologyAdapter(env);
    const requestedTimeout = Number(env.TRACEFORGE_GPT56_TIMEOUT_MS ?? 900_000);
    this.modelTimeoutMs = Number.isFinite(requestedTimeout)
      ? Math.min(Math.max(Math.trunc(requestedTimeout), 30_000), 1_800_000)
      : 900_000;
    const requestedReplayDelay = Number(env.TRACEFORGE_REPLAY_EVENT_DELAY_MS ?? 160);
    this.replayEventDelayMs = Number.isFinite(requestedReplayDelay)
      ? Math.min(Math.max(Math.trunc(requestedReplayDelay), 0), 2_000)
      : 160;
  }

  start(request: StartMigrationRequest): MigrationJob {
    const now = new Date().toISOString();
    const id = `migration_${randomUUID()}`;
    const job: MigrationJob = {
      id,
      executionMode: request.executionMode,
      scenarioIds: request.scenarioIds?.length ? request.scenarioIds : scenarios.map(({ id: scenarioId }) => scenarioId),
      status: "queued",
      currentStage: "observe",
      streamVersion: 0,
      ...(request.executionMode !== "deterministic-only" ? { model: "gpt-5.6-sol" as const, modelId: "gpt-5.6-sol" as const } : {}),
      ...(request.executionMode === "recorded-replay"
        ? {
            recordedAt: recordedCodexBuild.recordedAt,
            sourceRunId: recordedArchaeology.sourceRunId,
            replayDisclosure: recordedArchaeology.disclosure,
          }
        : {}),
      createdAt: now,
      updatedAt: now,
      links: {
        self: `/api/migrations/${id}`,
        events: `/api/migrations/${id}/events`,
        proof: `/api/migrations/${id}/proof`,
        artifacts: `/api/migrations/${id}/artifacts`,
      },
    };
    this.store.createJob(job);
    this.emit(job, "observe", "job.queued", "queued", "Migration queued", "The server accepted the migration job.");
    queueMicrotask(() => {
      void this.run(job.id);
    });
    return this.store.getJob(job.id) ?? job;
  }

  private async run(id: string): Promise<void> {
    const job = this.requireJob(id);
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.updatedAt = job.startedAt;
    this.store.updateJob(job);
    this.emit(job, "observe", "job.started", "running", "Migration started", "Every stage below is emitted by a server action.", {
      jobStatus: "running",
    });

    try {
      if (job.executionMode === "deterministic-only") {
        await this.runDeterministic(job);
      } else if (job.executionMode === "recorded-replay") {
        await this.runRecordedReplay(job);
      } else {
        await this.runLiveAi(job);
      }
    } catch (error) {
      const stage = job.currentStage;
      const message = error instanceof Error ? error.message : "Migration failed";
      const code = message === "GPT56_ADAPTER_NOT_CONFIGURED"
        ? "GPT56_ADAPTER_NOT_CONFIGURED"
        : message === "RECORDED_CODEX_BUILD_NOT_VERIFIED"
          ? "RECORDED_CODEX_BUILD_NOT_VERIFIED"
          : message === "RECORDED_CANDIDATE_SOURCE_MISMATCH"
            ? "RECORDED_CANDIDATE_SOURCE_MISMATCH"
          : "MIGRATION_FAILED";
      job.status = "failed";
      job.error = { code, message, stage };
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
      this.store.updateJob(job);
      this.emit(job, stage, "stage.failed", "failed", `${stage} failed`, message, { message });
      this.emit(job, stage, "job.failed", "failed", "Migration stopped", "No fallback result was substituted.", {
        message,
        jobStatus: "failed",
      });
    }
  }

  private async runDeterministic(job: MigrationJob): Promise<void> {
    this.stageStarted(job, "observe", "Capture workflow scope");
    this.emit(job, "observe", "evidence.recorded", "passed", "Scenario corpus loaded", `${job.scenarioIds.length} controlled scenarios are ready.`, {
      evidence: {
        id: "ev_deterministic_scope",
        kind: "trace",
        label: "Controlled workflow corpus",
        detail: job.scenarioIds.join(", "),
        digest: sha256Digest(job.scenarioIds),
      },
    });
    this.stagePassed(job, "observe", "Controlled inputs loaded");

    for (const stage of ["infer", "challenge", "build"] as const) {
      this.emit(job, stage, "stage.skipped", "skipped", `${stage} not executed`, "Deterministic-only mode makes no model claim.", {
        message: "Not executed in deterministic-only mode.",
      });
    }

    this.stageStarted(job, "verify", "Run the independent differential suite");
    const proof = await this.buildProof(
      job,
      "generated",
      [],
      { diff: "" },
      hostDeterministicContract,
    );
    await this.issueArtifacts(job, proof, "", [], hostDeterministicContract);
    this.emit(job, "verify", "proof.completed", proof.status === "PASSED" ? "passed" : "failed", "Host proof completed", `${proof.coverage.passed}/${proof.coverage.total} scenarios passed.`, {
      proof,
    });
    if (proof.status !== "PASSED") throw new Error("DETERMINISTIC_PROOF_FAILED");
    this.stagePassed(job, "verify", "Digest-recomputable proof issued");
    this.complete(job, proof);
  }

  private async runRecordedReplay(job: MigrationJob): Promise<void> {
    if (!recordedCodexBuild.verified) throw new Error("RECORDED_CODEX_BUILD_NOT_VERIFIED");
    const executedSourceDigest = await verifyRecordedCandidateSourceDigest();
    const origin: MigrationEventOrigin = "recorded";

    this.stageStarted(job, "observe", "Replay two operator-observed legacy traces", origin);
    await this.paceRecordedReplay();
    for (const evidence of [
      {
        id: "ev_seed_01_state",
        kind: "database",
        label: "STANDARD · DAMAGED · $45",
        detail: "REFUND · sellable 10→10 · quarantine 0→1",
      },
      {
        id: "ev_seed_02_state",
        kind: "database",
        label: "VIP · DAMAGED · $120",
        detail: "REPLACEMENT · sellable 10→9 · quarantine 0→1",
      },
    ]) {
      this.emit(job, "observe", "evidence.recorded", "passed", evidence.label, evidence.detail, {
        evidence: { ...evidence, digest: sha256Digest(evidence) },
      }, origin);
      await this.paceRecordedReplay();
    }
    this.stagePassed(job, "observe", "Two legacy traces captured", origin);
    await this.paceRecordedReplay();

    this.stageStarted(job, "infer", "GPT-5.6 proposes competing rules", origin);
    await this.paceRecordedReplay();
    for (const hypothesis of recordedArchaeology.initialHypotheses) {
      this.emit(job, "infer", "hypothesis.proposed", "passed", "Evidence-linked hypothesis", hypothesis.statement, {
        hypothesis,
        invocation: recordedModelInvocations[0],
      }, origin);
      await this.paceRecordedReplay();
    }
    this.stagePassed(job, "infer", "Ambiguity preserved instead of guessed away", origin);
    await this.paceRecordedReplay();

    this.stageStarted(job, "challenge", "GPT-5.6 searches for discriminating inputs", origin);
    await this.paceRecordedReplay();
    for (const counterexample of recordedArchaeology.counterexamples) {
      this.emit(job, "challenge", "counterexample.updated", "passed", counterexample.title, counterexample.rationale, {
        counterexample,
      }, origin);
      await this.paceRecordedReplay();
    }
    for (const hypothesis of recordedArchaeology.initialHypotheses.filter(({ status }) => status === "falsified")) {
      this.emit(job, "challenge", "hypothesis.falsified", "passed", "Over-generalization falsified", hypothesis.statement, {
        hypothesis,
      }, origin);
      await this.paceRecordedReplay();
    }
    for (const hypothesis of recordedArchaeology.refinedHypotheses) {
      this.emit(job, "challenge", "hypothesis.accepted", "passed", "Contract narrowed by evidence", hypothesis.statement, {
        hypothesis,
        invocation: recordedModelInvocations.at(-1),
      }, origin);
      await this.paceRecordedReplay();
    }
    this.stagePassed(job, "challenge", "Counterexamples resolved priority and atomic stock-failure rules", origin);
    await this.paceRecordedReplay();

    this.stageStarted(job, "build", "Replay isolated Codex candidate build", origin);
    await this.paceRecordedReplay();
    this.emit(job, "build", "candidate.updated", "failed", "Candidate 01 rejected", "The seeded implementation failed VIP priority, damaged inventory disposition, and exhausted-stock failure semantics.", {
      candidate: {
        id: "candidate-seeded-01",
        revision: 1,
        status: "rejected",
        summary: "Observed-only implementation",
        modelId: "none",
        changedFiles: ["apps/api/src/candidates/generated-return-workflow.ts"],
        rejectedByScenarioIds: [
          "observed-standard-damaged-4500",
          "observed-vip-damaged-12000",
          "counterexample-vip-damaged-no-sellable",
        ],
      },
    }, origin);
    await this.paceRecordedReplay();
    this.emit(job, "build", "candidate.updated", "passed", "Candidate 02 built by Codex", "Codex repaired the complete decision, atomic failure, and side-effect module in an isolated worktree.", {
      candidate: {
        id: "candidate-generated-02",
        revision: 2,
        status: "accepted",
        summary: "Counterexample-aware replacement workflow",
        modelId: recordedCodexBuild.model,
        codexThreadId: recordedCodexBuild.threadId,
        changedFiles: recordedCodexBuild.changedFiles,
      },
    }, origin);
    await this.paceRecordedReplay();
    this.stagePassed(job, "build", "Host accepted the whitelisted candidate diff", origin);
    await this.paceRecordedReplay();

    this.stageStarted(job, "verify", "Replay fresh observed + counterexample + boundary + held-out proof", origin);
    await this.paceRecordedReplay();
    const proof = await this.buildProof(job, "generated", recordedModelInvocations, {
      threadId: recordedCodexBuild.threadId,
      diff: recordedCodexBuild.diff,
      sourceDigest: executedSourceDigest,
      baseCommit: recordedCodexBuild.baseCommit,
      changedFiles: [...recordedCodexBuild.changedFiles],
      hostVerification: recordedCodexBuild.hostVerification,
    }, recordedArchaeology.contract);
    const artifacts = await this.issueArtifacts(
      job,
      proof,
      recordedCodexBuild.diff,
      [...recordedCodexBuild.commands],
      recordedArchaeology.contract,
    );
    const diff = artifacts.find(({ kind }) => kind === "diff");
    if (diff) {
      this.emit(job, "build", "artifact.ready", "passed", "Candidate diff ready", diff.filename, {
        artifact: this.artifactPayload(diff),
      }, origin);
      await this.paceRecordedReplay();
    }
    this.emit(job, "verify", "proof.completed", proof.status === "PASSED" ? "passed" : "failed", "Independent verifier decided", `${proof.coverage.passed}/${proof.coverage.total} scenarios passed with ${proof.scenarios.reduce((sum, scenario) => sum + scenario.mismatchCount, 0)} mismatches.`, {
      proof,
    }, origin);
    await this.paceRecordedReplay();
    if (proof.status !== "PASSED") throw new Error("RECORDED_PROOF_REPLAY_FAILED");
    this.stagePassed(job, "verify", "Verification passed · digest available for recomputation", origin);
    await this.paceRecordedReplay();
    this.complete(job, proof);
  }

  private async runLiveAi(job: MigrationJob): Promise<void> {
    const adapterStatus = this.archaeology.status();
    if (!adapterStatus.configured) throw new Error("GPT56_ADAPTER_NOT_CONFIGURED");
    if (!this.codex.status().configured) throw new Error("CODEX_ADAPTER_NOT_CONFIGURED");

    const visibleScenarios = [...scenarios];
    this.stageStarted(job, "observe", "Capture two operator-observed legacy traces");
    const observedTraces = scenarios
      .filter(({ stage }) => stage === "observed")
      .map((scenario) => this.service.capture("legacy", scenario.input, "seeded", scenario.id));
    for (const trace of observedTraces) {
      this.emit(job, "observe", "evidence.recorded", "passed", `Legacy trace ${trace.scenarioId}`, this.traceSummary(trace), {
        evidence: this.traceEvidencePayload(trace),
      });
    }
    this.stagePassed(job, "observe", `${observedTraces.length} fresh SQLite-backed traces captured`);

    const invocations: ModelInvocationEvidence[] = [];
    this.stageStarted(job, "infer", "GPT-5.6 Sol compares competing explanations");
    const archaeologist = await this.archaeology.run<ArchaeologistOutput>({
      role: "trace-archaeologist",
      prompt: this.archaeologistPrompt(observedTraces),
      inputTraceIds: observedTraces.map(({ traceId }) => traceId),
      inputEvidenceDigests: this.evidenceDigests(observedTraces),
      allowedEvidenceIds: this.evidenceIds(observedTraces),
      signal: AbortSignal.timeout(this.modelTimeoutMs),
    });
    invocations.push(archaeologist.invocation);
    for (const hypothesis of archaeologist.output.hypotheses) {
      this.emit(job, "infer", "hypothesis.proposed", "passed", "GPT-5.6 hypothesis", hypothesis.statement, {
        hypothesis: {
          id: hypothesis.ruleId,
          revision: 1,
          statement: hypothesis.statement,
          status: "proposed",
          confidence: hypothesis.confidence,
          evidenceIds: hypothesis.evidenceIds,
        },
        invocation: archaeologist.invocation,
      });
    }
    this.stagePassed(job, "infer", `${archaeologist.output.unknowns.filter(({ blocking }) => blocking).length} blocking unknowns preserved`);

    this.stageStarted(job, "challenge", "GPT-5.6 proposes inputs; only the host executes them");
    const firstHunter = await this.archaeology.run<HunterOutput>({
      role: "counterexample-hunter",
      prompt: this.hunterPrompt(observedTraces, archaeologist.output, undefined),
      inputTraceIds: observedTraces.map(({ traceId }) => traceId),
      inputEvidenceDigests: this.evidenceDigests(observedTraces),
      allowedEvidenceIds: this.evidenceIds(observedTraces),
      signal: AbortSignal.timeout(this.modelTimeoutMs),
    });
    invocations.push(firstHunter.invocation);
    const firstInput = validateWorkflowInput(firstHunter.output.scenario.input);
    const firstTrace = this.service.capture(
      "legacy",
      firstInput,
      "seeded",
      `live-${firstHunter.output.scenario.scenarioId}`,
    );
    this.emit(job, "challenge", "counterexample.updated", "passed", "First model counterexample executed", this.traceSummary(firstTrace), {
      counterexample: this.counterexamplePayload(firstHunter.output, firstTrace, "LIVE-CX-01"),
      invocation: firstHunter.invocation,
    });

    const tracesAfterFirst = [...observedTraces, firstTrace];
    const secondHunter = await this.archaeology.run<HunterOutput>({
      role: "counterexample-hunter",
      prompt: this.hunterPrompt(tracesAfterFirst, archaeologist.output, firstHunter.output),
      inputTraceIds: tracesAfterFirst.map(({ traceId }) => traceId),
      inputEvidenceDigests: this.evidenceDigests(tracesAfterFirst),
      allowedEvidenceIds: this.evidenceIds(tracesAfterFirst),
      signal: AbortSignal.timeout(this.modelTimeoutMs),
    });
    invocations.push(secondHunter.invocation);
    const secondInput = validateWorkflowInput(secondHunter.output.scenario.input);
    const secondTrace = this.service.capture(
      "legacy",
      secondInput,
      "seeded",
      `live-${secondHunter.output.scenario.scenarioId}`,
    );
    this.emit(job, "challenge", "counterexample.updated", "passed", "High-information counterexample executed", this.traceSummary(secondTrace), {
      counterexample: this.counterexamplePayload(secondHunter.output, secondTrace, "LIVE-CX-02"),
      invocation: secondHunter.invocation,
    });
    if (secondTrace.result.decision !== "MANUAL_REVIEW") {
      throw new Error("GPT56_COUNTEREXAMPLE_DID_NOT_REVEAL_PRIORITY_EXCEPTION");
    }

    const boundaryTraces = this.locateReviewBoundary(firstInput, secondInput.amountCents);
    const lowerBoundary = boundaryTraces.at(-2);
    const upperBoundary = boundaryTraces.at(-1);
    if (!lowerBoundary || !upperBoundary) throw new Error("BOUNDARY_SEARCH_FAILED");
    this.emit(job, "challenge", "evidence.recorded", "passed", "Host narrowed the exact threshold", `${lowerBoundary.input.amountCents} cents processes automatically; ${upperBoundary.input.amountCents} cents enters review.`, {
      evidence: {
        id: "ev_live_boundary_interval",
        kind: "trace",
        label: "Host boundary search",
        detail: `${boundaryTraces.length} deterministic probes; transition ${lowerBoundary.input.amountCents}→${upperBoundary.input.amountCents}`,
        digest: sha256Digest(boundaryTraces.map(({ traceId, result }) => ({ traceId, decision: result.decision }))),
      },
    });

    const priorityScenario = scenarios.find(({ id }) => id === "counterexample-vip-damaged-50000");
    if (!priorityScenario) throw new Error("PRIORITY_COUNTEREXAMPLE_MISSING");
    const priorityTrace = this.service.capture(
      "legacy",
      priorityScenario.input,
      "seeded",
      priorityScenario.id,
    );
    this.emit(job, "challenge", "counterexample.updated", "passed", "Host priority counterexample executed", this.traceSummary(priorityTrace), {
      counterexample: {
        id: "LIVE-CX-PRIORITY",
        title: priorityScenario.title,
        rationale: priorityScenario.description,
        status: "confirmed",
        scenario: priorityTrace.input,
        observedOutcome: {
          decision: priorityTrace.result.decision,
          inventoryBefore: priorityTrace.result.inventoryBefore,
          inventoryAfter: priorityTrace.result.inventoryAfter,
        },
        evidenceIds: priorityTrace.evidence.map(({ evidenceId }) => evidenceId),
        targetHypothesisIds: archaeologist.output.hypotheses.map(({ ruleId }) => ruleId),
      },
    });

    const stockScenario = scenarios.find(({ id }) => id === "counterexample-vip-damaged-no-sellable");
    if (!stockScenario?.expectedFailure) throw new Error("STOCK_COUNTEREXAMPLE_MISSING");
    const stockTrace = this.service.captureAttempt(
      "legacy",
      stockScenario.input,
      "seeded",
      stockScenario.id,
    );
    if (
      stockTrace.outcome.status !== "FAILED"
      || stockTrace.outcome.failureCode !== stockScenario.expectedFailure.code
      || stockTrace.outcome.returnRecordCreated
      || stockTrace.outcome.sideEffects.length !== 0
      || stockTrace.outcome.inventoryBefore.sellable !== stockTrace.outcome.inventoryAfter.sellable
      || stockTrace.outcome.inventoryBefore.quarantine !== stockTrace.outcome.inventoryAfter.quarantine
    ) {
      throw new Error("STOCK_COUNTEREXAMPLE_DID_NOT_FAIL_ATOMICALLY");
    }
    this.emit(
      job,
      "challenge",
      "counterexample.updated",
      "passed",
      "Host stock-exhaustion counterexample executed",
      this.attemptSummary(stockTrace),
      {
        counterexample: {
          id: "LIVE-CX-STOCK-EXHAUSTED",
          title: stockScenario.title,
          rationale: stockScenario.description,
          status: "confirmed",
          scenario: stockTrace.input,
          observedOutcome: stockTrace.outcome,
          evidenceIds: stockTrace.evidence.map(({ evidenceId }) => evidenceId),
          targetHypothesisIds: archaeologist.output.hypotheses.map(({ ruleId }) => ruleId),
        },
      },
    );

    const coveredHighScenario = {
      ...priorityScenario,
      id: `live-covered-high-${job.id}`,
      title: "Host coverage probe · above the review boundary",
      description: "A disclosed 75,000-cent VIP damaged return bounds the interval used by the post-turn verifier.",
      input: {
        ...priorityScenario.input,
        returnId: `RET-LIVE-COVERED-HIGH-${job.id}`,
        amountCents: 75_000,
      },
      provenance: {
        source: "host-derived" as const,
        detail: "Host-authored coverage evidence disclosed before the Codex writing turn.",
      },
    };
    visibleScenarios.push(coveredHighScenario);
    const coveredHighTrace = this.service.capture(
      "legacy",
      coveredHighScenario.input,
      "seeded",
      coveredHighScenario.id,
    );
    this.emit(job, "challenge", "evidence.recorded", "passed", "Host bounded the covered high-value interval", this.traceSummary(coveredHighTrace), {
      evidence: this.traceEvidencePayload(coveredHighTrace),
    });

    const challengeTraces: StoredWorkflowTrace[] = [
      ...tracesAfterFirst,
      secondTrace,
      ...boundaryTraces,
      priorityTrace,
      stockTrace,
      coveredHighTrace,
    ];
    let critic = await this.archaeology.run<CriticOutput>({
      role: "contract-critic",
      prompt: this.criticPrompt(challengeTraces, archaeologist.output),
      inputTraceIds: challengeTraces.map(({ traceId }) => traceId),
      inputEvidenceDigests: this.evidenceDigests(challengeTraces),
      allowedEvidenceIds: this.evidenceIds(challengeTraces),
      signal: AbortSignal.timeout(this.modelTimeoutMs),
    });
    invocations.push(critic.invocation);
    let unknownLifecycle = reconcileCriticUnknownLifecycle(
      archaeologist.output.unknowns,
      critic.output,
    );
    if (critic.output.disposition === "NEEDS_COUNTEREXAMPLE") {
      const generated = createHostHiddenScenario(`contract-clarification:${job.id}`);
      const priorityCheck = {
        ...generated,
        id: `live-priority-check-${job.id}`,
        title: "Host-disclosed critic priority check",
        description: "Additional evidence requested by the critic before the build turn.",
        stage: "counterexample" as const,
        visibility: "visible" as const,
        provenance: {
          source: "host-derived" as const,
          detail: "Host-generated input requested by the GPT-5.6 critic before the Codex writing turn.",
        },
      };
      visibleScenarios.push(priorityCheck);
      const priorityTrace = this.service.capture("legacy", priorityCheck.input, "seeded", priorityCheck.id);
      challengeTraces.push(priorityTrace);
      this.emit(job, "challenge", "counterexample.updated", "passed", "Critic-requested priority check executed", this.traceSummary(priorityTrace), {
        counterexample: {
          id: "LIVE-CX-CRITIC",
          title: priorityCheck.title,
          rationale: critic.output.findings.map(({ requiredAction }) => requiredAction).join(" "),
          status: "confirmed",
          scenario: priorityTrace.input,
          observedOutcome: {
            decision: priorityTrace.result.decision,
            inventoryBefore: priorityTrace.result.inventoryBefore,
            inventoryAfter: priorityTrace.result.inventoryAfter,
          },
          evidenceIds: priorityTrace.evidence.map(({ evidenceId }) => evidenceId),
          targetHypothesisIds: critic.output.findings.flatMap(({ ruleIds }) => ruleIds),
        },
      });
      const firstCritique = critic.output;
      critic = await this.archaeology.run<CriticOutput>({
        role: "contract-critic",
        prompt: this.criticPrompt(challengeTraces, archaeologist.output, firstCritique),
        inputTraceIds: challengeTraces.map(({ traceId }) => traceId),
        inputEvidenceDigests: this.evidenceDigests(challengeTraces),
        allowedEvidenceIds: this.evidenceIds(challengeTraces),
        signal: AbortSignal.timeout(this.modelTimeoutMs),
      });
      invocations.push(critic.invocation);
      unknownLifecycle = reconcileCriticUnknownLifecycle(
        archaeologist.output.unknowns,
        critic.output,
      );
    }
    if (critic.output.disposition !== "READY_FOR_BUILD") {
      throw new Error(`GPT56_CONTRACT_${critic.output.disposition}`);
    }
    if (!hasEvidenceBoundStockSufficiencyRule(
      critic.output.revisedRules,
      stockTrace.evidence.map(({ evidenceId }) => evidenceId),
    )) {
      throw new Error("GPT56_CONTRACT_MISSING_STOCK_SUFFICIENCY_RULE");
    }
    const liveContract = {
      id: `contract-live-${job.id}`,
      scope: "Evidence-bounded Web returns workflow",
      rules: critic.output.revisedRules,
      findings: critic.output.findings,
      initialUnknowns: archaeologist.output.unknowns,
      resolvedUnknowns: unknownLifecycle.resolvedUnknowns,
      remainingUnknowns: unknownLifecycle.remainingUnknowns,
      disposition: critic.output.disposition,
      criticThreadId: critic.invocation.threadId,
    };
    for (const rule of critic.output.revisedRules) {
      this.emit(job, "challenge", "hypothesis.accepted", "passed", `Contract rule · priority ${rule.priority}`, rule.statement, {
        hypothesis: {
          id: rule.ruleId,
          revision: 2,
          statement: rule.statement,
          status: "accepted",
          confidence: rule.confidence,
          evidenceIds: rule.evidenceIds,
        },
        invocation: critic.invocation,
      });
    }
    this.stagePassed(job, "challenge", "GPT-5.6 contract passed host evidence-reference validation");

    this.stageStarted(job, "build", "Reject Candidate 01, then let Codex repair the complete module");
    const seededSuite = this.service.runVisibleSuite("seeded");
    const rejectedScenarioIds = seededSuite.runs
      .filter(({ status }) => status === "FAILED")
      .map(({ proofBundle }) => proofBundle.scenarioId ?? "custom");
    this.emit(job, "build", "candidate.updated", "failed", "Candidate 01 rejected", `${rejectedScenarioIds.length} scenarios exposed rule or side-effect defects.`, {
      candidate: {
        id: "candidate-live-01",
        revision: 1,
        status: "rejected",
        summary: "Observed-only candidate",
        changedFiles: ["apps/api/src/candidates/generated-return-workflow.ts"],
        rejectedByScenarioIds: rejectedScenarioIds,
      },
    });
    const failedProofs = seededSuite.runs
      .filter(({ status }) => status === "FAILED")
      .map(({ proofBundle }) => proofBundle);
    if (failedProofs.length === 0) throw new Error("SEEDED_CANDIDATE_DID_NOT_FAIL");
    const repair = await this.codex.repair({
      behaviorContract: liveContract,
      failedProofs,
      visibleScenarios,
    });
    if (repair.verification.status !== "PASSED" || repair.verification.suiteValidation?.passed !== true) {
      throw new Error("CODEX_CANDIDATE_VERIFICATION_FAILED");
    }
    this.emit(job, "build", "candidate.updated", "passed", "Candidate 02 built by Codex", repair.structuredOutput.summary, {
      candidate: {
        id: "candidate-live-02",
        revision: 2,
        status: "accepted",
        summary: repair.structuredOutput.summary,
        modelId: "gpt-5.6-sol",
        codexThreadId: repair.threadId,
        changedFiles: repair.changedFiles,
      },
      usage: repair.usage,
      worktree: repair.worktree,
      repairInput: repair.repairInput,
    });
    this.stagePassed(job, "build", "One-file allowlist and seven-scenario host suite passed");

    this.stageStarted(job, "verify", "Issue a fresh host-owned proof bundle");
    const repairedSource = await readFile(join(repair.worktree.path, GENERATED_CANDIDATE_PATH), "utf8");
    const proof = await this.buildProof(job, "generated", invocations, {
      threadId: repair.threadId,
      diff: repair.diff,
      sourceDigest: sha256Digest(repairedSource),
      baseCommit: repair.worktree.baseCommit,
      changedFiles: repair.changedFiles,
      hostVerification: commandTestCounts(repair.verification.apiTests),
    }, liveContract, repair.verification.suite);
    await this.issueArtifacts(job, proof, repair.diff, this.commandLog(repair), liveContract);
    this.emit(job, "verify", "proof.completed", proof.status === "PASSED" ? "passed" : "failed", "Independent verifier decided", `${proof.coverage.passed}/${proof.coverage.total} scenarios passed.`, {
      proof,
    });
    if (proof.status !== "PASSED") throw new Error("LIVE_AI_PROOF_FAILED");
    this.stagePassed(job, "verify", "Verification passed · digest available for recomputation");
    this.complete(job, proof);
  }

  private archaeologistPrompt(traces: WorkflowTrace[]): string {
    return `${this.readOnlyModelBoundary()}

Role: Trace Archaeologist.
Propose the smallest competing hypotheses that explain the supplied traces. Every factual rule must cite existing evidenceIds. Preserve ambiguity as blocking unknowns; do not collapse correlation into a universal rule.

Trace pack:
${JSON.stringify(this.tracePack(traces))}`;
  }

  private hunterPrompt(
    traces: WorkflowTrace[],
    archaeology: ArchaeologistOutput,
    previous: HunterOutput | undefined,
  ): string {
    const iteration = previous
      ? `The host already executed the first proposal. Its fresh trace is in the trace pack. The remaining high-value priority exception and whether inventory movement is deferred are unresolved. Choose a materially higher amount than every automatically processed trace, but choose the concrete value yourself.`
      : "Choose one crossed, minimally redundant input that best separates tier-driven and amount-driven explanations.";
    return `${this.readOnlyModelBoundary()}

Role: Counterexample Hunter.
Design exactly one valid workflow input with maximum expected information gain. ${iteration}
Do not predict or execute the result; the host alone will validate and run it. amountCents must be between 1 and 100000.

Archaeology result:
${JSON.stringify(archaeology)}

${previous ? `Previous proposal:\n${JSON.stringify(previous)}\n` : ""}Trace pack:
${JSON.stringify(this.tracePack(traces))}`;
  }

  private criticPrompt(
    traces: StoredWorkflowTrace[],
    archaeology: ArchaeologistOutput,
    previous?: CriticOutput,
  ): string {
    return `${this.readOnlyModelBoundary()}

Role: Contract Critic.
Audit the initial hypotheses against every fresh host trace, including adjacent boundary probes and the exhausted-stock failure attempt. Reject unsupported universal statements and produce the smallest ordered contract. A lower numeric priority runs first. The contract must preserve the observed replacement-stock precondition and atomic failure behavior: with zero sellable stock the replacement is rejected, no return record is created, inventory is unchanged, and no shipment or other side effect is returned. Cite the failure attempt evidence in that rule. Classify every initial unknown exactly once: put evidence-resolved items in resolvedUnknowns and unresolved items in remainingUnknowns. Do not invent, omit, duplicate, or silently downgrade an unknown. For each remaining item, mark whether it is inside the stated Web returns scope. Mark READY_FOR_BUILD only when the evidence supports the observed priority, exact threshold, and stock-sufficiency failure semantics and no remaining in-scope unknown was initially marked blocking. Preserve unresolved questions outside the observed domain as out-of-scope remaining unknowns.

Initial archaeology:
${JSON.stringify(archaeology)}

${previous ? `Previous critique requested more evidence:\n${JSON.stringify(previous)}\n` : ""}

Fresh trace pack:
${JSON.stringify(this.tracePack(traces))}`;
  }

  private readOnlyModelBoundary(): string {
    return "You are a read-only behavior analyst. Use only the supplied trace pack. Never invent evidence IDs, write code, run commands, execute a scenario, or claim verification passed. Return only JSON matching the supplied schema.";
  }

  private tracePack(traces: StoredWorkflowTrace[]): unknown {
    return traces.map((trace) => ({
      traceId: trace.traceId,
      scenarioId: trace.scenarioId,
      input: trace.input,
      ...( "result" in trace ? { result: trace.result } : { outcome: trace.outcome }),
      evidence: trace.evidence.map(({ evidenceId, type, digest }) => ({ evidenceId, type, digest })),
    }));
  }

  private evidenceIds(traces: StoredWorkflowTrace[]): string[] {
    return traces.flatMap((trace) => trace.evidence.map(({ evidenceId }) => evidenceId));
  }

  private evidenceDigests(traces: StoredWorkflowTrace[]): string[] {
    return traces.flatMap((trace) => trace.evidence.map(({ digest }) => digest));
  }

  private traceSummary(trace: WorkflowTrace): string {
    const { input, result } = trace;
    return `${input.customerTier} · ${input.itemCondition} · ${input.amountCents} cents → ${result.decision}; inventory ${result.inventoryBefore.sellable}/${result.inventoryBefore.quarantine} → ${result.inventoryAfter.sellable}/${result.inventoryAfter.quarantine}`;
  }

  private attemptSummary(trace: WorkflowAttemptTrace): string {
    const { input, outcome } = trace;
    return `${input.customerTier} · ${input.itemCondition} · ${input.amountCents} cents → ${outcome.status}${outcome.failureCode ? ` (${outcome.failureCode})` : ""}; inventory ${outcome.inventoryBefore.sellable}/${outcome.inventoryBefore.quarantine} → ${outcome.inventoryAfter.sellable}/${outcome.inventoryAfter.quarantine}; ${outcome.sideEffects.length} side effects`;
  }

  private traceEvidencePayload(trace: WorkflowTrace): Record<string, unknown> {
    return {
      id: trace.traceId,
      kind: "trace",
      label: trace.scenarioId ?? trace.traceId,
      detail: this.traceSummary(trace),
      digest: sha256Digest(this.tracePack([trace])),
    };
  }

  private counterexamplePayload(
    proposal: HunterOutput,
    trace: WorkflowTrace,
    id: string,
  ): Record<string, unknown> {
    return {
      id,
      title: proposal.scenario.scenarioId,
      rationale: proposal.expectedInformationGain,
      status: "confirmed",
      scenario: trace.input,
      expectedDiscrimination: proposal.distinguishes.map(({ reason }) => reason).join(" "),
      observedOutcome: {
        decision: trace.result.decision,
        inventoryBefore: trace.result.inventoryBefore,
        inventoryAfter: trace.result.inventoryAfter,
        sideEffects: trace.result.sideEffects,
      },
      evidenceIds: trace.evidence.map(({ evidenceId }) => evidenceId),
      targetHypothesisIds: [...new Set(proposal.distinguishes.flatMap(({ ruleId, fromRuleId }) => [ruleId, fromRuleId]))],
    };
  }

  private locateReviewBoundary(seed: ReturnWorkflowInput, highAmount: number): WorkflowTrace[] {
    if (!Number.isInteger(highAmount) || highAmount <= 4_500) {
      throw new Error("COUNTEREXAMPLE_AMOUNT_CANNOT_BOUND_REVIEW_THRESHOLD");
    }
    const probes: WorkflowTrace[] = [];
    const capture = (amountCents: number) => {
      const input = validateWorkflowInput({
        ...seed,
        returnId: `RET-LIVE-BOUNDARY-${amountCents}-${probes.length}`,
        sku: "SKU-LIVE-BOUNDARY",
        customerTier: "STANDARD",
        itemCondition: "DAMAGED",
        amountCents,
        initialInventory: { sellable: 10, quarantine: 0 },
      });
      const trace = this.service.capture("legacy", input, "seeded", `live-boundary-${amountCents}`);
      probes.push(trace);
      return trace;
    };

    let lowAmount = Math.min(highAmount - 1, Math.max(4_500, seed.amountCents));
    let lowTrace = capture(lowAmount);
    if (lowTrace.result.decision === "MANUAL_REVIEW") {
      lowAmount = 4_500;
      lowTrace = capture(lowAmount);
    }
    let highTrace = capture(highAmount);
    if (highTrace.result.decision !== "MANUAL_REVIEW" || lowTrace.result.decision === "MANUAL_REVIEW") {
      throw new Error("HOST_COULD_NOT_BRACKET_REVIEW_THRESHOLD");
    }

    while (highAmount - lowAmount > 1 && probes.length < 24) {
      const midpoint = Math.floor((lowAmount + highAmount) / 2);
      const trace = capture(midpoint);
      if (trace.result.decision === "MANUAL_REVIEW") {
        highAmount = midpoint;
        highTrace = trace;
      } else {
        lowAmount = midpoint;
        lowTrace = trace;
      }
    }
    if (highAmount - lowAmount !== 1) throw new Error("HOST_BOUNDARY_SEARCH_BUDGET_EXHAUSTED");
    probes.push(lowTrace, highTrace);
    return probes;
  }

  private commandLog(repair: CodexRepairResult): HostCommandArtifact[] {
    return [
      repair.verification.install,
      repair.verification.apiTests,
      repair.verification.generatedCandidate,
    ]
      .filter((command): command is NonNullable<typeof command> => Boolean(command))
      .map((command) => ({
        command: [command.command, ...command.args].join(" "),
        exitCode: command.exitCode,
        summary: command.exitCode === 0 ? "Host command passed." : "Host command failed; inspect the retained worktree.",
        cwd: redactHostCommandText(command.cwd),
        stdout: redactHostCommandText(command.stdout),
        stderr: redactHostCommandText(command.stderr),
      }));
  }

  private async buildProof(
    job: MigrationJob,
    candidateVersion: CandidateVersion,
    modelInvocations: MigrationProofBundle["modelInvocations"],
    candidateEvidence: CandidateEvidence,
    contract: { id: string } | Record<string, unknown>,
    suiteOverride?: GeneratedCandidateSuiteEvidence,
  ): Promise<MigrationProofBundle> {
    const suite = suiteOverride ? undefined : this.service.runSuite(candidateVersion);
    const scenarioProofs: MigrationScenarioProof[] = suiteOverride
      ? suiteOverride.runs.map((run) => {
          const scenario = findScenario(run.scenarioId);
          return {
            scenarioId: run.scenarioId,
            partition: run.partition ?? scenario?.stage ?? "observed",
            status: run.status,
            legacyTraceId: run.legacyTraceId,
            candidateTraceId: run.candidateTraceId,
            assertionCount: run.assertionCount,
            mismatchCount: run.mismatchCount,
            mismatches: [],
            provenance: scenario?.provenance ?? {
              source: "host-authored",
              detail: "Concrete verification-only input generated by the host after the Codex writing turn.",
            },
          };
        })
      : (suite?.runs ?? []).map(({ proofBundle }) => {
      const scenario = proofBundle.scenarioId ? findScenario(proofBundle.scenarioId) : undefined;
      return {
        scenarioId: proofBundle.scenarioId ?? "custom",
        partition: proofBundle.scenarioId?.startsWith("host-hidden-")
          ? "held-out"
          : scenario?.stage ?? "observed",
        status: proofBundle.status,
        legacyTraceId: proofBundle.legacyTraceId,
        candidateTraceId: proofBundle.candidateTraceId,
        assertionCount: proofBundle.assertions.length,
        mismatchCount: proofBundle.mismatches.length,
        mismatches: proofBundle.mismatches.map(({ path, expected, actual }) => ({ path, expected, actual })),
        provenance: scenario?.provenance ?? {
          source: "host-authored",
          detail: "Concrete verification-only input generated by the host for this proof run.",
        },
      };
    });
    let sourceDigest = candidateEvidence.sourceDigest;
    if (!sourceDigest) {
      const source = await readFile(fileURLToPath(candidateModuleSourceUrl()), "utf8");
      sourceDigest = sha256Digest(source);
    }
    const contractId = typeof contract.id === "string" ? contract.id : `contract-${job.id}`;
    const contractDigest = sha256Digest(contract);
    const body: Omit<MigrationProofBundle, "digest"> = {
      proofId: `migration-proof_${randomUUID()}`,
      migrationId: job.id,
      status: scenarioProofs.every(({ status }) => status === "PASSED") ? "PASSED" : "FAILED",
      claim: "Behavioral conformance for the executed observed, counterexample, boundary, and held-out scenarios only.",
      contractId,
      contractDigest,
      modelInvocations,
      candidate: {
        implementationId: "replacement.return-workflow.generated-candidate",
        sourceDigest,
        diffDigest: sha256Digest(candidateEvidence.diff),
        ...(candidateEvidence.threadId ? { codexThreadId: candidateEvidence.threadId } : {}),
        ...(candidateEvidence.baseCommit ? { baseCommit: candidateEvidence.baseCommit } : {}),
        ...(candidateEvidence.changedFiles ? { changedFiles: candidateEvidence.changedFiles } : {}),
      },
      ...(candidateEvidence.hostVerification
        ? { hostVerification: candidateEvidence.hostVerification }
        : {}),
      coverage: {
        observed: scenarioProofs.filter(({ partition }) => partition === "observed").length,
        counterexample: scenarioProofs.filter(({ partition }) => partition === "counterexample").length,
        boundary: scenarioProofs.filter(({ partition }) => partition === "boundary").length,
        heldOut: scenarioProofs.filter(({ partition }) => partition === "held-out").length,
        total: scenarioProofs.length,
        passed: scenarioProofs.filter(({ status }) => status === "PASSED").length,
      },
      scenarios: scenarioProofs,
      limitations: [
        "The claim covers only the seven executed Web workflow scenarios listed in this bundle.",
        "External payment settlement, carrier systems, and workflows outside REST + SQLite are not claimed equivalent.",
        ...(job.executionMode === "deterministic-only"
          ? [
              "No GPT-5.6 or Codex execution is represented by this deterministic-only run.",
              "The deterministic-only contract is host-authored and is not a replay of a recorded model artifact.",
            ]
          : []),
      ],
      generatedAt: new Date().toISOString(),
    };
    return { ...body, digest: sha256Digest(body) };
  }

  private async issueArtifacts(
    job: MigrationJob,
    proof: MigrationProofBundle,
    diff: string,
    commands: ReadonlyArray<HostCommandArtifact>,
    contract: unknown,
  ): Promise<MigrationArtifact[]> {
    const now = new Date().toISOString();
    const artifacts = [
      this.store.putArtifact({
        migrationId: job.id,
        kind: "proof",
        label: "proof.json",
        filename: "proof.json",
        mimeType: "application/json",
        body: `${JSON.stringify(proof, null, 2)}\n`,
        createdAt: now,
      }),
      this.store.putArtifact({
        migrationId: job.id,
        kind: "contract",
        label: "contract.json",
        filename: "contract.json",
        mimeType: "application/json",
        body: `${JSON.stringify(contract, null, 2)}\n`,
        createdAt: now,
      }),
      this.store.putArtifact({
        migrationId: job.id,
        kind: "diff",
        label: "candidate.diff",
        filename: "candidate.diff",
        mimeType: "text/x-diff",
        body: diff || "# No model-generated diff exists for deterministic-only mode.\n",
        createdAt: now,
      }),
      this.store.putArtifact({
        migrationId: job.id,
        kind: "command-log",
        label: "commands.json",
        filename: "commands.json",
        mimeType: "application/json",
        body: `${JSON.stringify(commands, null, 2)}\n`,
        createdAt: now,
      }),
    ];
    const evidenceLines = this.store.listEvents(job.id).map((event) => JSON.stringify(event)).join("\n");
    artifacts.push(this.store.putArtifact({
      migrationId: job.id,
      kind: "evidence",
      label: "evidence.jsonl",
      filename: "evidence.jsonl",
      mimeType: "application/x-ndjson",
      body: `${evidenceLines}\n`,
      createdAt: now,
    }));
    for (const artifact of artifacts) {
      this.emit(job, "verify", "artifact.ready", "passed", `${artifact.filename} ready`, artifact.digest, {
        artifact: this.artifactPayload(artifact),
      });
      if (job.executionMode === "recorded-replay") await this.paceRecordedReplay();
    }
    return artifacts;
  }

  private artifactPayload(artifact: MigrationArtifact): Record<string, unknown> {
    return {
      id: artifact.id,
      kind: artifact.kind,
      label: artifact.label,
      filename: artifact.filename,
      mediaType: artifact.mimeType,
      mimeType: artifact.mimeType,
      downloadUrl: artifact.href,
      href: artifact.href,
      digest: artifact.digest,
      sizeBytes: artifact.byteLength,
      byteLength: artifact.byteLength,
      createdAt: artifact.createdAt,
    };
  }

  private async paceRecordedReplay(): Promise<void> {
    if (this.replayEventDelayMs === 0) return;
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, this.replayEventDelayMs);
    });
  }

  private complete(job: MigrationJob, proof: MigrationProofBundle): void {
    job.status = "passed";
    job.proofId = proof.proofId;
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    this.store.updateJob(job);
    this.emit(job, "verify", "job.completed", "passed", "Migration completed", "The final verdict came from the host verifier.", {
      jobStatus: "passed",
    });
  }

  private stageStarted(
    job: MigrationJob,
    stage: MigrationStage,
    detail: string,
    origin?: MigrationEventOrigin,
  ): void {
    job.currentStage = stage;
    job.updatedAt = new Date().toISOString();
    this.store.updateJob(job);
    this.emit(job, stage, "stage.started", "running", `${stage} started`, detail, { message: detail }, origin);
  }

  private stagePassed(
    job: MigrationJob,
    stage: MigrationStage,
    detail: string,
    origin?: MigrationEventOrigin,
  ): void {
    this.emit(job, stage, "stage.passed", "passed", `${stage} passed`, detail, { message: detail }, origin);
  }

  private emit(
    job: MigrationJob,
    stage: MigrationStage,
    type: string,
    status: MigrationEventStatus,
    title: string,
    detail: string,
    payload: EventPayload = {},
    origin?: MigrationEventOrigin,
  ): MigrationEvent {
    const event = this.store.appendEvent({
      migrationId: job.id,
      occurredAt: new Date().toISOString(),
      stage,
      type,
      origin: origin ?? (job.executionMode === "recorded-replay" ? "recorded" : "live"),
      actor: this.actorFor(stage, type),
      status,
      title,
      detail,
      evidenceIds: [],
      artifactIds: [],
      payload,
    });
    job.streamVersion = event.sequence;
    job.updatedAt = event.occurredAt;
    this.store.updateJob(job);
    return event;
  }

  private actorFor(stage: MigrationStage, type: string): MigrationEvent["actor"] {
    if (stage === "observe") return "legacy-runner";
    if (stage === "infer") return "gpt-5.6-archaeologist";
    if (stage === "challenge" && type.includes("counterexample")) return "gpt-5.6-counterexample-hunter";
    if (stage === "challenge") return "gpt-5.6-contract-critic";
    if (stage === "build") return "codex";
    return "host-verifier";
  }

  private requireJob(id: string): MigrationJob {
    const job = this.store.getJob(id);
    if (!job) throw new Error(`migration job not found: ${id}`);
    return job;
  }
}
