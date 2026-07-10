import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BehaviorArchaeologyAdapter } from "./behavior-archaeology.js";
import { sha256Digest } from "./digest.js";
import { findScenario, scenarios } from "./domain.js";
import { MigrationStore } from "./migration-store.js";
import type {
  MigrationArtifact,
  MigrationEvent,
  MigrationEventOrigin,
  MigrationEventStatus,
  MigrationJob,
  MigrationProofBundle,
  MigrationScenarioProof,
  MigrationStage,
  StartMigrationRequest,
} from "./migration-types.js";
import { recordedArchaeology, recordedModelInvocations, RECORDED_AT } from "./recorded-archaeology.js";
import { recordedCodexBuild } from "./recorded-codex-build.js";
import { TraceForgeService } from "./service.js";
import type { CandidateVersion } from "./types.js";

type EventPayload = Record<string, unknown>;

export class MigrationRunner {
  readonly archaeology: BehaviorArchaeologyAdapter;

  constructor(
    readonly service: TraceForgeService,
    readonly store: MigrationStore,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.archaeology = new BehaviorArchaeologyAdapter(env);
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
            recordedAt: RECORDED_AT,
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
    const proof = await this.buildProof(job, "generated", []);
    await this.issueArtifacts(job, proof, "");
    this.emit(job, "verify", "proof.completed", proof.status === "PASSED" ? "passed" : "failed", "Host proof completed", `${proof.coverage.passed}/${proof.coverage.total} scenarios passed.`, {
      proof,
    });
    if (proof.status !== "PASSED") throw new Error("DETERMINISTIC_PROOF_FAILED");
    this.stagePassed(job, "verify", "Digest-recomputable proof issued");
    this.complete(job, proof);
  }

  private async runRecordedReplay(job: MigrationJob): Promise<void> {
    if (!recordedCodexBuild.verified) throw new Error("RECORDED_CODEX_BUILD_NOT_VERIFIED");
    const origin: MigrationEventOrigin = "recorded";

    this.stageStarted(job, "observe", "Replay two operator-observed legacy traces", origin);
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
    }
    this.stagePassed(job, "observe", "Two legacy traces captured", origin);

    this.stageStarted(job, "infer", "GPT-5.6 proposes competing rules", origin);
    for (const hypothesis of recordedArchaeology.initialHypotheses) {
      this.emit(job, "infer", "hypothesis.proposed", "passed", "Evidence-linked hypothesis", hypothesis.statement, {
        hypothesis,
        invocation: recordedModelInvocations[0],
      }, origin);
    }
    this.stagePassed(job, "infer", "Ambiguity preserved instead of guessed away", origin);

    this.stageStarted(job, "challenge", "GPT-5.6 searches for discriminating inputs", origin);
    for (const counterexample of recordedArchaeology.counterexamples) {
      this.emit(job, "challenge", "counterexample.updated", "passed", counterexample.title, counterexample.rationale, {
        counterexample,
      }, origin);
    }
    for (const hypothesis of recordedArchaeology.initialHypotheses.filter(({ status }) => status === "falsified")) {
      this.emit(job, "challenge", "hypothesis.falsified", "passed", "Over-generalization falsified", hypothesis.statement, {
        hypothesis,
      }, origin);
    }
    for (const hypothesis of recordedArchaeology.refinedHypotheses) {
      this.emit(job, "challenge", "hypothesis.accepted", "passed", "Contract narrowed by evidence", hypothesis.statement, {
        hypothesis,
        invocation: recordedModelInvocations.at(-1),
      }, origin);
    }
    this.stagePassed(job, "challenge", "Counterexamples resolved the hidden priority rule", origin);

    this.stageStarted(job, "build", "Replay isolated Codex candidate build", origin);
    this.emit(job, "build", "candidate.updated", "failed", "Candidate 01 rejected", "The seeded implementation failed VIP priority and damaged inventory disposition.", {
      candidate: {
        id: "candidate-seeded-01",
        revision: 1,
        status: "rejected",
        summary: "Observed-only implementation",
        modelId: "none",
        changedFiles: ["apps/api/src/candidates/generated-return-workflow.ts"],
        rejectedByScenarioIds: ["observed-standard-damaged-4500", "observed-vip-damaged-12000"],
      },
    }, origin);
    this.emit(job, "build", "candidate.updated", "passed", "Candidate 02 built by Codex", "Codex repaired the complete decision and side-effect module in an isolated worktree.", {
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
    this.stagePassed(job, "build", "Host accepted the whitelisted candidate diff", origin);

    this.stageStarted(job, "verify", "Replay fresh observed + counterexample + boundary + held-out proof", origin);
    const proof = await this.buildProof(job, "generated", recordedModelInvocations);
    const artifacts = await this.issueArtifacts(job, proof, recordedCodexBuild.diff);
    const diff = artifacts.find(({ kind }) => kind === "diff");
    if (diff) {
      this.emit(job, "build", "artifact.ready", "passed", "Candidate diff ready", diff.filename, {
        artifact: this.artifactPayload(diff),
      }, origin);
    }
    this.emit(job, "verify", "proof.completed", proof.status === "PASSED" ? "passed" : "failed", "Independent verifier decided", `${proof.coverage.passed}/${proof.coverage.total} scenarios passed with ${proof.scenarios.reduce((sum, scenario) => sum + scenario.mismatchCount, 0)} mismatches.`, {
      proof,
    }, origin);
    if (proof.status !== "PASSED") throw new Error("RECORDED_PROOF_REPLAY_FAILED");
    this.stagePassed(job, "verify", "Verification passed · digest available for recomputation", origin);
    this.complete(job, proof);
  }

  private async runLiveAi(job: MigrationJob): Promise<void> {
    const adapterStatus = this.archaeology.status();
    if (!adapterStatus.configured) throw new Error("GPT56_ADAPTER_NOT_CONFIGURED");
    throw new Error("LIVE_AI_PIPELINE_NOT_YET_CONNECTED");
  }

  private async buildProof(
    job: MigrationJob,
    candidateVersion: CandidateVersion,
    modelInvocations: MigrationProofBundle["modelInvocations"],
  ): Promise<MigrationProofBundle> {
    const suite = this.service.runSuite(candidateVersion);
    const scenarioProofs: MigrationScenarioProof[] = suite.runs.map(({ proofBundle }) => {
      const scenario = proofBundle.scenarioId ? findScenario(proofBundle.scenarioId) : undefined;
      return {
        scenarioId: proofBundle.scenarioId ?? "custom",
        partition: scenario?.stage ?? "observed",
        status: proofBundle.status,
        legacyTraceId: proofBundle.legacyTraceId,
        candidateTraceId: proofBundle.candidateTraceId,
        assertionCount: proofBundle.assertions.length,
        mismatchCount: proofBundle.mismatches.length,
        mismatches: proofBundle.mismatches.map(({ path, expected, actual }) => ({ path, expected, actual })),
      };
    });
    const generatedPath = fileURLToPath(new URL("./candidates/generated-return-workflow.ts", import.meta.url));
    const source = await readFile(generatedPath, "utf8");
    const contractDigest = sha256Digest(recordedArchaeology.contract);
    const body: Omit<MigrationProofBundle, "digest"> = {
      proofId: `migration-proof_${randomUUID()}`,
      migrationId: job.id,
      status: scenarioProofs.every(({ status }) => status === "PASSED") ? "PASSED" : "FAILED",
      claim: "Behavioral conformance for the executed observed, counterexample, boundary, and held-out scenarios only.",
      contractId: recordedArchaeology.contract.id,
      contractDigest,
      modelInvocations,
      candidate: {
        implementationId: "replacement.return-workflow.generated-candidate",
        sourceDigest: sha256Digest(source),
        diffDigest: sha256Digest(recordedCodexBuild.diff),
        ...(recordedCodexBuild.threadId ? { codexThreadId: recordedCodexBuild.threadId } : {}),
      },
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
        "The claim covers only the six executed Web workflow scenarios listed in this bundle.",
        "External payment settlement, carrier systems, and workflows outside REST + SQLite are not claimed equivalent.",
        ...(job.executionMode === "deterministic-only"
          ? ["No GPT-5.6 or Codex execution is represented by this deterministic-only run."]
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
        body: `${JSON.stringify(recordedArchaeology.contract, null, 2)}\n`,
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
        body: `${JSON.stringify(recordedCodexBuild.commands, null, 2)}\n`,
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
