import { EventEmitter } from "node:events";

export type LocalRunnerPhase =
  | "preflight"
  | "needs-auth"
  | "signing-in"
  | "ready"
  | "preparing"
  | "codex"
  | "verifying"
  | "passed"
  | "failed"
  | "deleting"
  | "deleted";

export type ProvenanceState = "recorded" | "waiting" | "live" | "passed" | "failed";

export interface LocalRunnerProofSummary {
  status: "PASSED" | "FAILED";
  proofDigest: string;
  diffDigest: string;
  threadId: string;
  model: string;
  testsPassed: number;
  testsTotal: number;
  scenariosPassed: number;
  scenariosTotal: number;
  assertionsPassed: number;
  assertionCount: number;
  mismatchCount: number;
  changedFiles: string[];
  failedCommand?: string;
  failureCode?: string;
}

export interface LocalRunnerResult {
  proof: unknown;
  diff: string;
  summary: LocalRunnerProofSummary;
}

export interface LocalRunnerPreflight {
  codexVersion: string;
  releaseCommit: string;
  signedIn: boolean;
  accountLabel?: string;
  modelAvailable: boolean;
}

export interface LocalRunnerProgress {
  phase: "preparing" | "codex" | "verifying";
  message: string;
  detail?: string;
  threadId?: string;
  model?: string;
}

export interface LocalRunnerActions {
  preflight(): Promise<LocalRunnerPreflight>;
  login(): Promise<void>;
  run(
    signal: AbortSignal,
    onProgress: (progress: LocalRunnerProgress) => void,
  ): Promise<LocalRunnerResult>;
  cleanup(): Promise<void>;
}

export interface LocalRunnerSnapshot {
  phase: LocalRunnerPhase;
  title: string;
  message: string;
  detail?: string;
  codexVersion?: string;
  localReleaseCommit?: string;
  accountLabel?: string;
  model: "gpt-5.6-sol";
  threadId?: string;
  startedAt?: string;
  updatedAt: string;
  provenance: {
    evidence: ProvenanceState;
    codex: ProvenanceState;
    verifier: ProvenanceState;
    proof: ProvenanceState;
  };
  result?: LocalRunnerProofSummary;
  errorCode?: string;
}

const COPY: Record<LocalRunnerPhase, { title: string; message: string }> = {
  preflight: {
    title: "Checking the local trust boundary",
    message: "TraceForge is checking Codex, its dedicated sign-in, and the pinned demo fixture.",
  },
  "needs-auth": {
    title: "Sign in to Codex to continue",
    message: "Codex handles authentication locally. TraceForge cannot read your token.",
  },
  "signing-in": {
    title: "Waiting for Codex sign-in…",
    message: "Complete sign-in in the browser, then return here.",
  },
  ready: {
    title: "Ready for a bounded local build",
    message: "Review the exact read, write, network, and Git scope before starting.",
  },
  preparing: {
    title: "Preparing an isolated writer workspace",
    message: "Verifying the recorded evidence and the fixed one-file permission profile.",
  },
  codex: {
    title: "Codex is rebuilding one bounded workflow",
    message: "The model sees recorded evidence, failed proofs, and the incomplete candidate—not the verifier.",
  },
  verifying: {
    title: "Running the local differential suite",
    message: "The writer turn is closed. A fresh host-only input is now being verified in a second sandbox.",
  },
  passed: {
    title: "Fresh local proof issued",
    message: "The live candidate matched the legacy behavior across every verification scenario.",
  },
  failed: {
    title: "The local run did not issue a passing proof",
    message: "No success claim was made. Inspect the failure, then delete the temporary session.",
  },
  deleting: {
    title: "Deleting the local session",
    message: "Removing temporary writer and verifier workspaces from this machine.",
  },
  deleted: {
    title: "Local session deleted",
    message: "The temporary workspaces and local proof material have been removed.",
  },
};

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const prefix = error.message.split(":", 1)[0] ?? "";
    if (/^[A-Z][A-Z0-9_.-]+$/.test(prefix)) return prefix;
  }
  return "LOCAL_RUNNER_FAILED";
}

function safeFailureDetail(result: LocalRunnerProofSummary): string {
  if (result.scenariosTotal === 7 && result.mismatchCount > 0) {
    return `${result.scenariosPassed}/7 scenarios passed · ${result.mismatchCount} mismatch${result.mismatchCount === 1 ? "" : "es"}. The verifier completed and the proof remains FAILED.`;
  }
  if (result.failedCommand && result.failureCode) {
    return `${result.failedCommand} stopped at ${result.failureCode}. The proof remains FAILED.`;
  }
  if (result.failureCode) return `${result.failureCode}. The proof remains FAILED.`;
  return "Independent verification did not satisfy every proof condition.";
}

const DELETE_RUN_ABORT_GRACE_MS = 1_250;
const DELETE_CLEANUP_TIMEOUT_MS = 8_000;

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withCleanupTimeout(promise: Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("LOCAL_SESSION_CLEANUP_TIMEOUT")),
          DELETE_CLEANUP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class LocalRunnerSession extends EventEmitter {
  private snapshotValue: LocalRunnerSnapshot;
  private resultValue: LocalRunnerResult | null = null;
  private runAbort: AbortController | null = null;
  private operation: Promise<void> | null = null;
  private deletePromise: Promise<void> | null = null;
  private deleteRequested = false;

  constructor(private readonly actions: LocalRunnerActions) {
    super();
    const now = new Date().toISOString();
    this.snapshotValue = {
      phase: "preflight",
      ...COPY.preflight,
      model: "gpt-5.6-sol",
      updatedAt: now,
      provenance: {
        evidence: "recorded",
        codex: "waiting",
        verifier: "waiting",
        proof: "waiting",
      },
    };
  }

  snapshot(): LocalRunnerSnapshot {
    return structuredClone(this.snapshotValue);
  }

  result(): LocalRunnerResult | null {
    return this.resultValue;
  }

  private update(patch: Partial<LocalRunnerSnapshot>): void {
    this.snapshotValue = {
      ...this.snapshotValue,
      ...patch,
      updatedAt: new Date().toISOString(),
      provenance: patch.provenance ?? this.snapshotValue.provenance,
    };
    this.emit("change", this.snapshot());
  }

  private setPhase(phase: LocalRunnerPhase, patch: Partial<LocalRunnerSnapshot> = {}): void {
    this.update({ phase, ...COPY[phase], ...patch });
  }

  async initialize(): Promise<void> {
    if (this.deleteRequested) {
      throw new Error("LOCAL_SESSION_DELETED");
    }
    if (this.operation) return this.operation;
    this.setPhase("preflight", { errorCode: undefined });
    this.operation = (async () => {
      try {
        const preflight = await this.actions.preflight();
        if (this.deleteRequested) return;
        if (!preflight.modelAvailable) throw new Error("LOCAL_MODEL_UNAVAILABLE");
        this.setPhase(preflight.signedIn ? "ready" : "needs-auth", {
          codexVersion: preflight.codexVersion,
          localReleaseCommit: preflight.releaseCommit,
          ...(preflight.accountLabel ? { accountLabel: preflight.accountLabel } : {}),
        });
      } catch (error) {
        if (this.deleteRequested) return;
        this.setPhase("failed", {
          errorCode: errorCode(error),
          detail: "Preflight stopped at a protected local boundary.",
        });
      } finally {
        this.operation = null;
      }
    })();
    return this.operation;
  }

  async login(): Promise<void> {
    if (this.snapshotValue.phase !== "needs-auth") throw new Error("LOCAL_LOGIN_NOT_ALLOWED");
    if (this.operation) throw new Error("LOCAL_OPERATION_IN_PROGRESS");
    this.setPhase("signing-in");
    this.operation = (async () => {
      try {
        await this.actions.login();
        const preflight = await this.actions.preflight();
        if (this.deleteRequested) return;
        if (!preflight.signedIn) throw new Error("LOCAL_LOGIN_INCOMPLETE");
        if (!preflight.modelAvailable) throw new Error("LOCAL_MODEL_UNAVAILABLE");
        this.setPhase("ready", {
          codexVersion: preflight.codexVersion,
          localReleaseCommit: preflight.releaseCommit,
          ...(preflight.accountLabel ? { accountLabel: preflight.accountLabel } : {}),
        });
      } catch (error) {
        if (this.deleteRequested) return;
        this.setPhase("needs-auth", {
          errorCode: errorCode(error),
          detail: "Sign-in did not complete. No credential detail was exposed to this page.",
        });
      } finally {
        this.operation = null;
      }
    })();
    return this.operation;
  }

  async start(): Promise<void> {
    if (this.snapshotValue.phase !== "ready") throw new Error("LOCAL_BUILD_NOT_READY");
    if (this.operation) throw new Error("LOCAL_OPERATION_IN_PROGRESS");
    const runAbort = new AbortController();
    this.runAbort = runAbort;
    const startedAt = new Date().toISOString();
    this.setPhase("preparing", { startedAt, errorCode: undefined });
    this.operation = (async () => {
      try {
        const result = await this.actions.run(runAbort.signal, (progress) => {
          if (this.deleteRequested) return;
          const provenance = { ...this.snapshotValue.provenance };
          if (progress.phase === "codex") provenance.codex = "live";
          if (progress.phase === "verifying") {
            provenance.codex = "passed";
            provenance.verifier = "live";
          }
          this.setPhase(progress.phase, {
            message: progress.message,
            ...(progress.detail ? { detail: progress.detail } : {}),
            ...(progress.threadId ? { threadId: progress.threadId } : {}),
            provenance,
          });
        });
        if (
          runAbort.signal.aborted
          || this.deleteRequested
        ) return;
        this.resultValue = result;
        if (result.summary.status === "PASSED") {
          this.setPhase("passed", {
            result: result.summary,
            threadId: result.summary.threadId,
            provenance: {
              evidence: "recorded",
              codex: "passed",
              verifier: "passed",
              proof: "passed",
            },
          });
        } else {
          const verifierCompleted = result.summary.scenariosTotal === 7
            && result.summary.mismatchCount > 0;
          this.setPhase("failed", {
            ...(verifierCompleted ? {
              title: "Fresh local proof issued — candidate does not conform",
              message: `${result.summary.scenariosPassed}/7 scenarios passed. The verifier completed and found ${result.summary.mismatchCount} mismatch${result.summary.mismatchCount === 1 ? "" : "es"}.`,
            } : {}),
            result: result.summary,
            threadId: result.summary.threadId,
            errorCode: "LOCAL_PROOF_FAILED",
            detail: safeFailureDetail(result.summary),
            provenance: {
              evidence: "recorded",
              codex: "passed",
              verifier: verifierCompleted ? "passed" : "failed",
              proof: "failed",
            },
          });
        }
      } catch (error) {
        if (this.deleteRequested) return;
        const provenance = { ...this.snapshotValue.provenance };
        if (provenance.codex === "live") provenance.codex = "failed";
        if (provenance.verifier === "live") provenance.verifier = "failed";
        provenance.proof = "failed";
        this.setPhase("failed", {
          errorCode: errorCode(error),
          detail: "The run stopped at a protected boundary; raw command output was not exposed.",
          provenance,
        });
      } finally {
        if (this.runAbort === runAbort) this.runAbort = null;
        this.operation = null;
      }
    })();
    return this.operation;
  }

  async delete(): Promise<void> {
    if (this.snapshotValue.phase === "deleted") return;
    if (this.deletePromise) return this.deletePromise;
    const activeOperation = this.operation;
    const hadActiveRun = this.runAbort !== null;
    this.deleteRequested = true;
    this.setPhase("deleting");
    this.runAbort?.abort(new Error("LOCAL_SESSION_DELETED"));
    const deletion = (async () => {
      try {
        // Give an abort-aware build just long enough to terminate its trusted-
        // host process group before fixture removal. Login/preflight operations
        // are instead unblocked immediately by cleanup closing App Server.
        if (activeOperation && hadActiveRun) {
          await settlesWithin(activeOperation, DELETE_RUN_ABORT_GRACE_MS);
        }
        await withCleanupTimeout(Promise.resolve().then(() => this.actions.cleanup()));
        this.resultValue = null;
        this.setPhase("deleted");
      } catch {
        this.setPhase("failed", {
          errorCode: "LOCAL_SESSION_CLEANUP_FAILED",
          detail: "Cleanup did not finish; the local session remains available for inspection.",
        });
        throw new Error("LOCAL_SESSION_CLEANUP_FAILED");
      }
    })();
    this.deletePromise = deletion;
    try {
      await deletion;
    } finally {
      // A failed bounded cleanup can be retried. deleteRequested deliberately
      // remains terminal so a late operation can never revive the session.
      if (this.deletePromise === deletion) {
        this.deletePromise = null;
      }
    }
  }
}
