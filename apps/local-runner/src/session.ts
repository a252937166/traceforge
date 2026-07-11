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
  if (result.failedCommand && result.failureCode) {
    return `${result.failedCommand} stopped at ${result.failureCode}. The proof remains FAILED.`;
  }
  if (result.failureCode) return `${result.failureCode}. The proof remains FAILED.`;
  return "Independent verification did not satisfy every proof condition.";
}

export class LocalRunnerSession extends EventEmitter {
  private snapshotValue: LocalRunnerSnapshot;
  private resultValue: LocalRunnerResult | null = null;
  private runAbort: AbortController | null = null;
  private operation: Promise<void> | null = null;

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
    if (this.snapshotValue.phase === "deleting" || this.snapshotValue.phase === "deleted") {
      throw new Error("LOCAL_SESSION_DELETED");
    }
    if (this.operation) return this.operation;
    this.setPhase("preflight", { errorCode: undefined });
    this.operation = (async () => {
      try {
        const preflight = await this.actions.preflight();
        if (!preflight.modelAvailable) throw new Error("LOCAL_MODEL_UNAVAILABLE");
        this.setPhase(preflight.signedIn ? "ready" : "needs-auth", {
          codexVersion: preflight.codexVersion,
          ...(preflight.accountLabel ? { accountLabel: preflight.accountLabel } : {}),
        });
      } catch (error) {
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
        if (!preflight.signedIn) throw new Error("LOCAL_LOGIN_INCOMPLETE");
        if (!preflight.modelAvailable) throw new Error("LOCAL_MODEL_UNAVAILABLE");
        this.setPhase("ready", {
          codexVersion: preflight.codexVersion,
          ...(preflight.accountLabel ? { accountLabel: preflight.accountLabel } : {}),
        });
      } catch (error) {
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
    this.runAbort = new AbortController();
    const startedAt = new Date().toISOString();
    this.setPhase("preparing", { startedAt, errorCode: undefined });
    this.operation = (async () => {
      try {
        const result = await this.actions.run(this.runAbort!.signal, (progress) => {
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
          this.setPhase("failed", {
            result: result.summary,
            threadId: result.summary.threadId,
            errorCode: "LOCAL_PROOF_FAILED",
            detail: safeFailureDetail(result.summary),
            provenance: {
              evidence: "recorded",
              codex: "passed",
              verifier: "failed",
              proof: "failed",
            },
          });
        }
      } catch (error) {
        if (this.snapshotValue.phase === "deleting" || this.snapshotValue.phase === "deleted") return;
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
        this.runAbort = null;
        this.operation = null;
      }
    })();
    return this.operation;
  }

  async delete(): Promise<void> {
    if (this.snapshotValue.phase === "deleted") return;
    this.setPhase("deleting");
    this.runAbort?.abort(new Error("LOCAL_SESSION_DELETED"));
    try {
      await this.actions.cleanup();
    } finally {
      this.resultValue = null;
      this.setPhase("deleted");
    }
  }
}
