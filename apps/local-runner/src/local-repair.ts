import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import {
  GENERATED_CANDIDATE_PATH,
  buildChildEnvironment,
  buildCodexRepairPrompt,
  changedFilesIn,
  parseGeneratedVerificationSuite,
  runCommand,
  validateChangedFiles,
  validateGeneratedSuite,
  verifyCodexRepairInputFiles,
  type GeneratedCandidateSuiteEvidence,
  type GeneratedSuiteValidation,
} from "../../api/src/codex-adapter.js";
import { sha256Digest } from "../../api/src/digest.js";
import {
  validateCandidateSource,
  type CandidatePolicyEvidence,
} from "./candidate-policy.js";
import { sha256Text } from "./fixture-digest.js";
import type { LocalFixture } from "./fixture.js";
import {
  LOCAL_RUNNER_MANIFEST,
  LOCAL_RUNNER_RELEASE_TAG,
  LOCAL_RUNNER_VERSION,
} from "./manifest.js";
import {
  TRACEFORGE_BUILD_PROFILE_ID,
  TRACEFORGE_VERIFY_PROFILE_ID,
} from "./permissions.js";

export const DEFAULT_VERIFY_PERMISSION_PROFILE = TRACEFORGE_VERIFY_PROFILE_ID;
export const DEFAULT_BUILD_PERMISSION_PROFILE = TRACEFORGE_BUILD_PROFILE_ID;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    diagnosis: { type: "string" },
    changedFile: { type: "string", enum: [GENERATED_CANDIDATE_PATH] },
    verificationIntent: { type: "string" },
  },
  required: ["summary", "diagnosis", "changedFile", "verificationIntent"],
  additionalProperties: false,
} as const;

const LOCAL_BUILD_DEVELOPER_INSTRUCTIONS = `TraceForge is running a bounded local build.
Use only the three immutable .traceforge repair-input files and the generated candidate module named in the user prompt. Do not inspect parent directories, the legacy implementation, tests, verifier code, credentials, or other Codex threads. Do not broaden filesystem or network access. The host alone verifies the result after this turn.`;

const VERIFY_COMMANDS = {
  install: ["corepack", "pnpm", "install", "--offline", "--frozen-lockfile"],
  // Restrict the local proof to the candidate-relevant, socket-free tests.
  // The public API tests intentionally bind HTTP ports and do not belong in
  // the verifier's network-denied permission profile.
  apiTests: [
    "corepack",
    "pnpm",
    "--filter",
    "@traceforge/api",
    "exec",
    "node",
    "--test",
    "--import",
    "tsx",
    "tests/champion-workflow.test.ts",
    "tests/workflow.test.ts",
  ],
  // Invoke the Node loader directly. The `tsx` CLI creates a dynamic IPC
  // socket, while the verifier only needs the static loader for this script.
  generatedSuite: [
    "corepack",
    "pnpm",
    "--filter",
    "@traceforge/api",
    "exec",
    "node",
    "--import",
    "tsx",
    "scripts/verify-generated.ts",
  ],
} as const;

type JsonRecord = Record<string, unknown>;

export interface AppServerNotification {
  method: string;
  params: unknown;
}

/**
 * Deliberately mirrors the stable core of AppServerClient. Keeping this as a
 * structural interface lets local-repair remain testable with a fake client.
 */
export interface LocalRepairAppServerClient {
  request<T>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T>;
  onNotification(listener: (notification: AppServerNotification) => void): () => void;
}

export type LocalRepairStage = "prepare" | "build" | "verify" | "complete";
export type LocalRepairEventStatus = "running" | "passed" | "failed";

export interface LocalRepairEvent {
  sequence: number;
  occurredAt: string;
  stage: LocalRepairStage;
  type: string;
  status: LocalRepairEventStatus;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
}

export interface LocalRepairStructuredOutput {
  summary: string;
  diagnosis: string;
  changedFile: typeof GENERATED_CANDIDATE_PATH;
  verificationIntent: string;
}

export interface LocalCommandResult {
  name: keyof typeof VERIFY_COMMANDS;
  executor: "trusted-host" | "app-server";
  argv: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutDigest: string;
  stderrDigest: string;
  diagnosticCode: LocalCommandDiagnosticCode;
}

export type LocalCommandDiagnosticCode =
  | "OK"
  | "TOOLCHAIN_ARCHITECTURE_MISMATCH"
  | "FILESYSTEM_PERMISSION_DENIED"
  | "COMMAND_NOT_FOUND"
  | "OFFLINE_INSTALL_FAILED"
  | "CANDIDATE_TESTS_FAILED"
  | "DIFFERENTIAL_SUITE_FAILED";

export interface LocalTestCounts {
  discovered: number;
  passed: number;
  failed: number;
  skipped: number;
  candidateSafeTotal: number;
}

export interface LocalProofBundle {
  version: "traceforge.local-proof.v1";
  proofId: string;
  sessionId: string;
  status: "PASSED" | "FAILED";
  claim: string;
  provenance: {
    archaeology: "recorded-gpt-5.6";
    build: "live-local-codex";
    verification: "live-local-host";
    sourceRunId: string;
  };
  runner: {
    version: typeof LOCAL_RUNNER_VERSION;
    releaseTag: typeof LOCAL_RUNNER_RELEASE_TAG;
    manifestDigest: string;
    buildPermissionProfile: string;
    verifyPermissionProfile: string;
  };
  codex: {
    model: typeof LOCAL_RUNNER_MANIFEST.model;
    threadId: string;
    turnId: string;
    turnCompletedAt: string;
    usage: TokenUsageBreakdown | null;
  };
  repairInput: {
    digest: string;
    contractDigest: string;
    failedProofDigests: string[];
    visibleScenarioIds: string[];
  };
  candidate: {
    path: typeof GENERATED_CANDIDATE_PATH;
    baseSourceDigest: string;
    sourceDigest: string;
    diffDigest: string;
    changedFiles: string[];
    policy: CandidatePolicyEvidence;
    structuredOutputDigest: string;
  };
  verification: {
    inputCreatedAt: string;
    nonceDigest: string;
    commands: Array<{
      name: LocalCommandResult["name"];
      executor: LocalCommandResult["executor"];
      argv: string[];
      exitCode: number;
      stdoutDigest: string;
      stderrDigest: string;
      diagnosticCode: LocalCommandDiagnosticCode;
    }>;
    tests: LocalTestCounts | null;
    suite: GeneratedCandidateSuiteEvidence | null;
    suiteValidation: GeneratedSuiteValidation;
  };
  limitations: string[];
  generatedAt: string;
  digest: string;
}

export interface LocalRepairResult {
  threadId: string;
  turnId: string;
  structuredOutput: LocalRepairStructuredOutput;
  candidateSource: string;
  diff: string;
  commands: LocalCommandResult[];
  proof: LocalProofBundle;
}

export interface LocalRepairContext {
  /** App-server spawned with TRACEFORGE_BUILD_PROFILE_ID as default_permissions. */
  buildAppServer: LocalRepairAppServerClient;
  /** App-server spawned separately with TRACEFORGE_VERIFY_PROFILE_ID. */
  verifyAppServer: LocalRepairAppServerClient;
  fixture: LocalFixture;
  sessionId?: string;
  buildPermissionProfileId?: string;
  verifyPermissionProfileId?: string;
  turnTimeoutMs?: number;
  commandTimeoutMs?: number;
  commandOutputBytesCap?: number;
  signal?: AbortSignal;
}

export type LocalRepairEventHandler = (
  event: LocalRepairEvent,
) => void | Promise<void>;

export function verifyLocalProofDigest(proof: LocalProofBundle): boolean {
  const { digest, ...body } = proof;
  return digest === sha256Digest(body);
}

interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface TurnExecutionEvidence {
  threadId: string;
  turnId: string;
  turnCompletedAt: string;
  finalResponse: string;
  usage: TokenUsageBreakdown | null;
}

interface CommandExecResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" ? value as JsonRecord : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asFiniteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = message.split(":", 1)[0] ?? "";
  return /^[A-Z][A-Z0-9_.-]+$/.test(prefix) ? prefix : "LOCAL_REPAIR_FAILED";
}

function parseStructuredOutput(value: string): LocalRepairStructuredOutput {
  let parsed: JsonRecord;
  try {
    parsed = asRecord(JSON.parse(value));
  } catch {
    throw new Error("LOCAL_CODEX_STRUCTURED_OUTPUT_INVALID");
  }
  const keys = Object.keys(parsed).sort();
  const expectedKeys = ["changedFile", "diagnosis", "summary", "verificationIntent"];
  if (keys.join("\n") !== expectedKeys.join("\n")) {
    throw new Error("LOCAL_CODEX_STRUCTURED_OUTPUT_FIELDS_INVALID");
  }
  const summary = asString(parsed.summary).trim();
  const diagnosis = asString(parsed.diagnosis).trim();
  const verificationIntent = asString(parsed.verificationIntent).trim();
  if (
    !summary
    || !diagnosis
    || !verificationIntent
    || parsed.changedFile !== GENERATED_CANDIDATE_PATH
  ) {
    throw new Error("LOCAL_CODEX_STRUCTURED_OUTPUT_INVALID");
  }
  return {
    summary,
    diagnosis,
    changedFile: GENERATED_CANDIDATE_PATH,
    verificationIntent,
  };
}

function tokenUsage(value: unknown): TokenUsageBreakdown | null {
  const usage = asRecord(value);
  const last = asRecord(usage.last);
  const required = [
    "totalTokens",
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
  ] as const;
  if (required.some((key) => asFiniteNumber(last[key]) === undefined)) return null;
  return {
    totalTokens: asFiniteNumber(last.totalTokens) ?? 0,
    inputTokens: asFiniteNumber(last.inputTokens) ?? 0,
    cachedInputTokens: asFiniteNumber(last.cachedInputTokens) ?? 0,
    outputTokens: asFiniteNumber(last.outputTokens) ?? 0,
    reasoningOutputTokens: asFiniteNumber(last.reasoningOutputTokens) ?? 0,
  };
}

function parseTestCounts(output: string): LocalTestCounts | null {
  const last = (label: string): number | undefined => {
    const matches = [...output.matchAll(new RegExp(`(?:#|ℹ)\\s+${label}\\s+(\\d+)`, "g"))];
    const value = matches.at(-1)?.[1];
    return value === undefined ? undefined : Number.parseInt(value, 10);
  };
  const discovered = last("tests");
  const passed = last("pass");
  const failed = last("fail") ?? 0;
  const skipped = last("skipped") ?? 0;
  if (discovered === undefined || passed === undefined) return null;
  return {
    discovered,
    passed,
    failed,
    skipped,
    candidateSafeTotal: discovered - skipped,
  };
}

export function diagnoseLocalCommand(
  name: keyof typeof VERIFY_COMMANDS,
  exitCode: number,
  stdout: string,
  stderr: string,
): LocalCommandDiagnosticCode {
  if (exitCode === 0) return "OK";
  const output = `${stdout}\n${stderr}`;
  if (/esbuild for another platform|@esbuild\/[\w-]+.*platform needs/i.test(output)) {
    return "TOOLCHAIN_ARCHITECTURE_MISMATCH";
  }
  if (/\b(?:EPERM|EACCES)\b|operation not permitted|permission denied/i.test(output)) {
    return "FILESYSTEM_PERMISSION_DENIED";
  }
  if (/\bENOENT\b|command not found|not recognized as an internal or external command/i.test(output)) {
    return "COMMAND_NOT_FOUND";
  }
  if (name === "install") return "OFFLINE_INSTALL_FAILED";
  if (name === "apiTests") return "CANDIDATE_TESTS_FAILED";
  return "DIFFERENTIAL_SUITE_FAILED";
}

async function regularFileWithin(root: string, path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("LOCAL_CANDIDATE_NOT_REGULAR_FILE");
  }
  const [realRoot, realPath] = await Promise.all([realpath(root), realpath(path)]);
  const pathFromRoot = relative(realRoot, realPath);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || pathFromRoot === "") {
    throw new Error("LOCAL_CANDIDATE_PATH_ESCAPE");
  }
}

async function repositoryVisibleChanges(cwd: string): Promise<string[]> {
  const results = await Promise.all([
    runCommand("git", ["diff", "--name-only"], cwd),
    runCommand("git", ["diff", "--cached", "--name-only"], cwd),
    runCommand("git", ["ls-files", "--others", "--exclude-standard"], cwd),
  ]);
  const failed = results.find(({ exitCode }) => exitCode !== 0);
  if (failed) {
    throw new Error(`LOCAL_VERIFIER_GIT_INSPECTION_FAILED:${failed.stderr || failed.stdout}`);
  }
  return results.flatMap(({ stdout }) => stdout.split(/\r?\n/).filter(Boolean));
}

async function execVerificationCommand(
  client: LocalRepairAppServerClient,
  name: keyof typeof VERIFY_COMMANDS,
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  outputBytesCap: number,
  signal?: AbortSignal,
): Promise<LocalCommandResult> {
  signal?.throwIfAborted();
  const argv = [...VERIFY_COMMANDS[name]];
  // sandboxPolicy is intentionally omitted. AppServerClient must have been
  // spawned with traceforge-verify as its verified host-only default profile.
  const response = await client.request<CommandExecResponse>(
    "command/exec",
    {
      command: argv,
      cwd,
      env,
      timeoutMs,
      outputBytesCap,
    },
    { timeoutMs: timeoutMs + 5_000 },
  );
  const stdout = asString(response.stdout);
  const stderr = asString(response.stderr);
  signal?.throwIfAborted();
  return {
    name,
    executor: "app-server",
    argv,
    cwd,
    exitCode: Number.isInteger(response.exitCode) ? response.exitCode : -1,
    stdout,
    stderr,
    stdoutDigest: sha256Text(stdout),
    stderrDigest: sha256Text(stderr),
    diagnosticCode: diagnoseLocalCommand(name, response.exitCode, stdout, stderr),
  };
}

export async function runBoundedTrustedHostCommand(
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  outputBytesCap: number,
  signal?: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (
    argv.length === 0
    || argv.some((part) => typeof part !== "string" || !part || part.includes("\0"))
  ) {
    throw new Error("LOCAL_TRUSTED_HOST_COMMAND_INVALID");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15 * 60_000) {
    throw new Error("LOCAL_TRUSTED_HOST_COMMAND_TIMEOUT_INVALID");
  }
  if (
    !Number.isSafeInteger(outputBytesCap)
    || outputBytesCap < 0
    || outputBytesCap > 4 * 1024 * 1024
  ) {
    throw new Error("LOCAL_TRUSTED_HOST_COMMAND_OUTPUT_CAP_INVALID");
  }
  signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    const command = argv[0] as string;
    const child = spawn(command, argv.slice(1), {
      cwd,
      env: buildChildEnvironment(process.env, {
        PWD: cwd,
        ...env,
        npm_config_arch: process.env.npm_config_arch ?? process.arch,
      }),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      // A dedicated process group lets cancellation stop package-manager
      // descendants as well as the small Corepack launcher on POSIX hosts.
      detached: process.platform !== "win32",
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let stopRequested = false;
    let timedOut = false;
    let aborted = false;
    let abortReason: unknown;
    let hardKillTimer: NodeJS.Timeout | undefined;
    let forceSettleTimer: NodeJS.Timeout | undefined;

    const append = (chunks: Buffer[], used: number, chunk: Buffer | string): number => {
      if (used >= outputBytesCap) return used;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      const accepted = buffer.subarray(0, outputBytesCap - used);
      if (accepted.length > 0) chunks.push(accepted);
      return used + accepted.length;
    };
    const signalProcess = (killSignal: NodeJS.Signals): void => {
      if (process.platform !== "win32" && child.pid !== undefined) {
        try {
          process.kill(-child.pid, killSignal);
          return;
        } catch {
          // Fall back to the direct child if the process group is already gone.
        }
      }
      if (child.exitCode !== null) return;
      try {
        child.kill(killSignal);
      } catch {
        // The child may have exited between the exitCode check and kill.
      }
    };
    const cleanup = (): void => {
      clearTimeout(timeoutTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      cleanup();
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const capturedStderr = Buffer.concat(stderrChunks).toString("utf8");
      if (aborted) {
        reject(abortReason instanceof Error ? abortReason : new Error("LOCAL_REPAIR_ABORTED"));
        return;
      }
      resolve({
        exitCode: timedOut ? -1 : exitCode,
        stdout,
        stderr: timedOut
          ? [capturedStderr, "LOCAL_TRUSTED_HOST_COMMAND_TIMEOUT"].filter(Boolean).join("\n")
          : capturedStderr,
      });
    };
    const requestStop = (): void => {
      if (stopRequested) return;
      stopRequested = true;
      signalProcess("SIGTERM");
      hardKillTimer = setTimeout(() => {
        signalProcess("SIGKILL");
        forceSettleTimer = setTimeout(() => {
          // Do not let inherited pipes keep deletion waiting indefinitely after
          // the entire process group has already received SIGKILL.
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          finish(-1);
        }, 750);
        forceSettleTimer.unref();
      }, 250);
      hardKillTimer.unref();
    };
    const onAbort = (): void => {
      if (aborted) return;
      aborted = true;
      abortReason = signal?.reason;
      requestStop();
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      requestStop();
    }, timeoutMs);
    timeoutTimer.unref();

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBytes = append(stdoutChunks, stdoutBytes, chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBytes = append(stderrChunks, stderrBytes, chunk);
    });
    child.once("error", (error) => {
      stderrBytes = append(stderrChunks, stderrBytes, error.message);
      finish(-1);
    });
    child.once("close", (code) => finish(code ?? -1));
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      // Close the race between throwIfAborted(), spawn(), and listener setup.
      if (signal.aborted) onAbort();
    }
  });
}

async function installVerifierDependencies(
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  outputBytesCap: number,
  signal?: AbortSignal,
): Promise<LocalCommandResult> {
  const argv = [...VERIFY_COMMANDS.install];
  const result = await runBoundedTrustedHostCommand(
    argv,
    cwd,
    env,
    timeoutMs,
    outputBytesCap,
    signal,
  );
  return {
    name: "install",
    executor: "trusted-host",
    argv,
    cwd,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutDigest: sha256Text(result.stdout),
    stderrDigest: sha256Text(result.stderr),
    diagnosticCode: diagnoseLocalCommand("install", result.exitCode, result.stdout, result.stderr),
  };
}

async function assertPermissionProfile(
  client: LocalRepairAppServerClient,
  cwd: string,
  expectedProfileId: string,
): Promise<void> {
  const response = await client.request<{ config?: Record<string, unknown> }>(
    "config/read",
    { cwd, includeLayers: false },
  );
  if (asString(asRecord(response.config).default_permissions) !== expectedProfileId) {
    throw new Error("LOCAL_VERIFY_PERMISSION_PROFILE_MISMATCH");
  }
}

async function runCodexTurn(
  context: LocalRepairContext,
  queueEvent: (
    stage: LocalRepairStage,
    type: string,
    status: LocalRepairEventStatus,
    title: string,
    detail: string,
    payload?: Record<string, unknown>,
  ) => void,
): Promise<TurnExecutionEvidence> {
  const client = context.buildAppServer;
  const buffered: AppServerNotification[] = [];
  const messageDeltas = new Map<string, string>();
  let ready = false;
  let threadId = "";
  let turnId = "";
  let finalResponse = "";
  let latestUsage: TokenUsageBreakdown | null = null;
  let resolveCompletion!: (value: JsonRecord) => void;
  const completion = new Promise<JsonRecord>((resolve) => {
    resolveCompletion = resolve;
  });

  const handle = (notification: AppServerNotification): void => {
    const params = asRecord(notification.params);
    if (asString(params.threadId) !== threadId) return;
    const notificationTurnId = asString(params.turnId);
    if (notificationTurnId && notificationTurnId !== turnId) return;

    if (notification.method === "thread/tokenUsage/updated") {
      latestUsage = tokenUsage(params.tokenUsage) ?? latestUsage;
      return;
    }
    if (notification.method === "item/agentMessage/delta") {
      const itemId = asString(params.itemId);
      if (itemId) {
        messageDeltas.set(itemId, `${messageDeltas.get(itemId) ?? ""}${asString(params.delta)}`);
      }
      return;
    }
    if (notification.method === "item/completed") {
      const item = asRecord(params.item);
      const itemType = asString(item.type);
      if (itemType === "agentMessage") finalResponse = asString(item.text) || finalResponse;
      if (itemType === "fileChange") {
        queueEvent("build", "codex.file-change", "running", "Codex changed the candidate", "A file-change item completed inside the bounded writer workspace.", {
          changes: Array.isArray(item.changes) ? item.changes : [],
        });
      } else if (itemType === "commandExecution") {
        queueEvent("build", "codex.command", item.status === "completed" ? "passed" : "running", "Codex command completed", asString(item.command), {
          exitCode: item.exitCode ?? null,
          durationMs: item.durationMs ?? null,
        });
      }
      return;
    }
    if (notification.method === "turn/completed") {
      const turn = asRecord(params.turn);
      if (!finalResponse && Array.isArray(turn.items)) {
        const messages = turn.items
          .map(asRecord)
          .filter((item) => item.type === "agentMessage")
          .map((item) => asString(item.text))
          .filter(Boolean);
        finalResponse = messages.at(-1) ?? "";
      }
      if (!finalResponse) finalResponse = [...messageDeltas.values()].at(-1) ?? "";
      resolveCompletion(turn);
    }
  };

  const unsubscribe = client.onNotification((notification) => {
    if (!ready) buffered.push(notification);
    else handle(notification);
  });

  try {
    const threadResponse = await client.request<{ thread?: { id?: string } }>("thread/start", {
      model: LOCAL_RUNNER_MANIFEST.model,
      cwd: context.fixture.writerRoot,
      approvalPolicy: "never",
      developerInstructions: LOCAL_BUILD_DEVELOPER_INSTRUCTIONS,
      serviceName: "traceforge_local_runner",
      ephemeral: true,
    });
    threadId = asString(threadResponse.thread?.id);
    if (!threadId) throw new Error("LOCAL_CODEX_THREAD_ID_MISSING");
    queueEvent("build", "codex.thread-started", "running", "Local Codex thread started", threadId, {
      threadId,
      model: LOCAL_RUNNER_MANIFEST.model,
    });

    const turnResponse = await client.request<{ turn?: { id?: string } }>("turn/start", {
      threadId,
      input: [{ type: "text", text: buildCodexRepairPrompt() }],
      approvalPolicy: "never",
      model: LOCAL_RUNNER_MANIFEST.model,
      effort: "high",
      outputSchema: OUTPUT_SCHEMA,
    });
    turnId = asString(turnResponse.turn?.id);
    if (!turnId) throw new Error("LOCAL_CODEX_TURN_ID_MISSING");
    ready = true;
    buffered.splice(0).forEach(handle);
    queueEvent("build", "codex.turn-started", "running", "Codex is rebuilding the workflow", "The model can write only inside the bounded writer fixture.", {
      threadId,
      turnId,
    });

    const timeoutMs = context.turnTimeoutMs ?? 600_000;
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("LOCAL_CODEX_TURN_TIMEOUT")), timeoutMs);
      timeout.unref();
    });
    let abortListener: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      if (!context.signal) return;
      abortListener = () => reject(context.signal?.reason ?? new Error("LOCAL_REPAIR_ABORTED"));
      if (context.signal.aborted) abortListener();
      else context.signal.addEventListener("abort", abortListener, { once: true });
    });
    let completedTurn: JsonRecord;
    try {
      completedTurn = await Promise.race([completion, timeoutPromise, abortPromise]);
    } catch (error) {
      await client.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (abortListener) context.signal?.removeEventListener("abort", abortListener);
    }
    if (completedTurn.status !== "completed") {
      const turnError = asRecord(completedTurn.error);
      throw new Error(`LOCAL_CODEX_TURN_${asString(completedTurn.status).toUpperCase() || "FAILED"}:${asString(turnError.message)}`);
    }
    if (!finalResponse.trim()) throw new Error("LOCAL_CODEX_FINAL_RESPONSE_MISSING");
    const turnCompletedAt = new Date().toISOString();
    queueEvent("build", "codex.turn-completed", "passed", "Codex writing turn completed", "The host can now create verification-only entropy.", {
      threadId,
      turnId,
      turnCompletedAt,
      usage: latestUsage,
    });
    return { threadId, turnId, turnCompletedAt, finalResponse, usage: latestUsage };
  } finally {
    unsubscribe();
  }
}

export async function runLocalRepair(
  context: LocalRepairContext,
  onEvent: LocalRepairEventHandler = () => undefined,
): Promise<LocalRepairResult> {
  const sessionId = context.sessionId?.trim() || `local_${randomUUID()}`;
  const buildPermissionProfileId = context.buildPermissionProfileId?.trim()
    || DEFAULT_BUILD_PERMISSION_PROFILE;
  const verifyPermissionProfileId = context.verifyPermissionProfileId?.trim()
    || DEFAULT_VERIFY_PERMISSION_PROFILE;
  let sequence = 0;
  let eventQueue = Promise.resolve();
  const queueEvent = (
    stage: LocalRepairStage,
    type: string,
    status: LocalRepairEventStatus,
    title: string,
    detail: string,
    payload: Record<string, unknown> = {},
  ): void => {
    const event: LocalRepairEvent = {
      sequence: ++sequence,
      occurredAt: new Date().toISOString(),
      stage,
      type,
      status,
      title,
      detail,
      payload,
    };
    eventQueue = eventQueue
      .catch(() => undefined)
      .then(async () => {
        await onEvent(event);
      });
  };
  const flushEvents = async (): Promise<void> => {
    await eventQueue;
  };

  try {
    context.signal?.throwIfAborted();
    queueEvent("prepare", "repair.started", "running", "Local repair started", "Recorded GPT-5.6 evidence is ready for this machine's Codex.", {
      sessionId,
      repairInputDigest: context.fixture.inputEvidence.digest,
    });
    await verifyCodexRepairInputFiles(
      context.fixture.writerRoot,
      context.fixture.inputEvidence,
    );
    queueEvent("prepare", "repair-input.verified", "passed", "Repair input verified", "Contract, failed proofs, and disclosed scenarios match the recorded input digest.", {
      repairInput: context.fixture.inputEvidence,
    });

    await assertPermissionProfile(
      context.buildAppServer,
      context.fixture.writerRoot,
      buildPermissionProfileId,
    );
    queueEvent("prepare", "permission-profile.verified", "passed", "Codex build profile active", buildPermissionProfileId, {
      permissionProfile: buildPermissionProfileId,
    });

    const turn = await runCodexTurn(context, queueEvent);
    context.signal?.throwIfAborted();
    const structuredOutput = parseStructuredOutput(turn.finalResponse);

    await verifyCodexRepairInputFiles(
      context.fixture.writerRoot,
      context.fixture.inputEvidence,
    );
    const changedFiles = await changedFilesIn(context.fixture.writerRoot);
    const whitelist = validateChangedFiles(changedFiles);
    if (!whitelist.passed) {
      throw new Error(`LOCAL_CHANGED_FILE_POLICY_FAILED:${whitelist.unexpected.join(",")}`);
    }
    const writerCandidatePath = join(context.fixture.writerRoot, GENERATED_CANDIDATE_PATH);
    await regularFileWithin(context.fixture.writerRoot, writerCandidatePath);
    const candidateSource = await readFile(writerCandidatePath, "utf8");
    const candidatePolicy = validateCandidateSource(
      candidateSource,
      context.fixture.baseCandidateSource,
    );
    const diffResult = await runCommand(
      "git",
      ["diff", "--no-ext-diff", "--", GENERATED_CANDIDATE_PATH],
      context.fixture.writerRoot,
    );
    if (diffResult.exitCode !== 0 || !diffResult.stdout.trim()) {
      throw new Error("LOCAL_CANDIDATE_DIFF_MISSING");
    }
    queueEvent("build", "candidate.policy-verified", "passed", "Candidate boundary verified", "Immutable inputs survived and only the generated workflow function changed.", {
      changedFiles: whitelist.changed,
      sourceDigest: candidatePolicy.sourceDigest,
    });

    await assertPermissionProfile(
      context.verifyAppServer,
      context.fixture.verifierRoot,
      verifyPermissionProfileId,
    );
    queueEvent("verify", "permission-profile.verified", "passed", "Host verification profile active", verifyPermissionProfileId, {
      permissionProfile: verifyPermissionProfileId,
    });

    const verificationBaseEnvironment = {
      TRACEFORGE_ENABLE_CODEX: "0",
      TMPDIR: context.fixture.verifyTmp,
      CI: "1",
      NO_COLOR: "1",
    };
    const commandTimeoutMs = context.commandTimeoutMs ?? 300_000;
    const outputBytesCap = context.commandOutputBytesCap ?? 250_000;
    const commands: LocalCommandResult[] = [];
    const install = await installVerifierDependencies(
      context.fixture.verifierRoot,
      verificationBaseEnvironment,
      commandTimeoutMs,
      outputBytesCap,
      context.signal,
    );
    context.signal?.throwIfAborted();
    commands.push(install);
    queueEvent("verify", "command.completed", install.exitCode === 0 ? "passed" : "failed", "Offline dependencies checked", `Exit ${install.exitCode}`, {
      command: install.argv,
      executor: install.executor,
      stdoutDigest: install.stdoutDigest,
      stderrDigest: install.stderrDigest,
    });

    // The nonce and repaired verifier candidate are materialized only after
    // the Codex turn and the host's fixed offline dependency setup complete.
    const verificationOnlyNonce = randomUUID();
    const verificationInputCreatedAt = new Date().toISOString();
    const nonceDigest = sha256Text(verificationOnlyNonce);
    queueEvent("verify", "verification-input.created", "passed", "Fresh verification-only input created", "Its concrete identity and values did not exist during the Codex turn.", {
      createdAt: verificationInputCreatedAt,
      nonceDigest,
    });

    const verifierCandidatePath = join(context.fixture.verifierRoot, GENERATED_CANDIDATE_PATH);
    await lstat(join(context.fixture.verifierRoot, dirname(GENERATED_CANDIDATE_PATH)));
    await writeFile(verifierCandidatePath, candidateSource, { encoding: "utf8", mode: 0o600 });
    const verifierChanges = validateChangedFiles(
      await repositoryVisibleChanges(context.fixture.verifierRoot),
    );
    if (!verifierChanges.passed) {
      throw new Error("LOCAL_VERIFIER_WORKTREE_POLICY_FAILED");
    }
    const verificationEnvironment = {
      ...verificationBaseEnvironment,
      TRACEFORGE_REPAIR_INPUT_DIGEST: context.fixture.inputEvidence.digest,
      TRACEFORGE_HOST_HIDDEN_SCENARIO_NONCE: verificationOnlyNonce,
    };

    if (install.exitCode === 0) {
      for (const name of ["apiTests", "generatedSuite"] as const) {
        const command = await execVerificationCommand(
          context.verifyAppServer,
          name,
          context.fixture.verifierRoot,
          verificationEnvironment,
          commandTimeoutMs,
          outputBytesCap,
          context.signal,
        );
        commands.push(command);
        queueEvent("verify", "command.completed", command.exitCode === 0 ? "passed" : "failed", name === "apiTests" ? "Candidate-safe tests completed" : "Six-scenario verification completed", `Exit ${command.exitCode}`, {
          command: command.argv,
          executor: command.executor,
          stdoutDigest: command.stdoutDigest,
          stderrDigest: command.stderrDigest,
        });
      }
    }

    const verifiedCandidateSource = await readFile(verifierCandidatePath, "utf8");
    if (sha256Text(verifiedCandidateSource) !== candidatePolicy.sourceDigest) {
      throw new Error("LOCAL_VERIFIER_CANDIDATE_MUTATED");
    }

    const apiTests = commands.find(({ name }) => name === "apiTests");
    const generatedCommand = commands.find(({ name }) => name === "generatedSuite");
    const tests = apiTests ? parseTestCounts(`${apiTests.stdout}\n${apiTests.stderr}`) : null;
    let suite: GeneratedCandidateSuiteEvidence | null = null;
    let suiteValidation: GeneratedSuiteValidation = {
      passed: false,
      problems: ["generated verification did not run"],
    };
    if (generatedCommand) {
      try {
        suite = parseGeneratedVerificationSuite(generatedCommand.stdout);
        suiteValidation = validateGeneratedSuite(
          suite,
          context.fixture.inputEvidence.digest,
        );
      } catch (error) {
        suiteValidation = { passed: false, problems: [errorMessage(error)] };
      }
    }
    const verificationPassed =
      commands.length === 3
      && commands.every(({ exitCode }) => exitCode === 0)
      && tests !== null
      && tests.failed === 0
      && tests.passed === tests.candidateSafeTotal
      && tests.candidateSafeTotal > 0
      && suite?.status === "PASSED"
      && suiteValidation.passed;

    const generatedAt = new Date().toISOString();
    const proofBody: Omit<LocalProofBundle, "digest"> = {
      version: "traceforge.local-proof.v1",
      proofId: `local_proof_${randomUUID()}`,
      sessionId,
      status: verificationPassed ? "PASSED" : "FAILED",
      claim: "Evidence-bounded local Codex rebuild verified against the executed host suite.",
      provenance: {
        archaeology: "recorded-gpt-5.6",
        build: "live-local-codex",
        verification: "live-local-host",
        sourceRunId: LOCAL_RUNNER_MANIFEST.sourceRunId,
      },
      runner: {
        version: LOCAL_RUNNER_VERSION,
        releaseTag: LOCAL_RUNNER_RELEASE_TAG,
        manifestDigest: sha256Digest(LOCAL_RUNNER_MANIFEST),
        buildPermissionProfile: buildPermissionProfileId,
        verifyPermissionProfile: verifyPermissionProfileId,
      },
      codex: {
        model: LOCAL_RUNNER_MANIFEST.model,
        threadId: turn.threadId,
        turnId: turn.turnId,
        turnCompletedAt: turn.turnCompletedAt,
        usage: turn.usage,
      },
      repairInput: {
        digest: context.fixture.inputEvidence.digest,
        contractDigest: context.fixture.inputEvidence.contractDigest,
        failedProofDigests: [...context.fixture.inputEvidence.failedProofDigests],
        visibleScenarioIds: [...context.fixture.inputEvidence.visibleScenarioIds],
      },
      candidate: {
        path: GENERATED_CANDIDATE_PATH,
        baseSourceDigest: sha256Text(context.fixture.baseCandidateSource),
        sourceDigest: candidatePolicy.sourceDigest,
        diffDigest: sha256Text(diffResult.stdout),
        changedFiles: whitelist.changed,
        policy: candidatePolicy,
        structuredOutputDigest: sha256Digest(structuredOutput),
      },
      verification: {
        inputCreatedAt: verificationInputCreatedAt,
        nonceDigest,
        commands: commands.map(({ name, executor, argv, exitCode, stdoutDigest, stderrDigest, diagnosticCode }) => ({
          name,
          executor,
          argv,
          exitCode,
          stdoutDigest,
          stderrDigest,
          diagnosticCode,
        })),
        tests,
        suite,
        suiteValidation,
      },
      limitations: [
        "Recorded GPT-5.6 archaeology is source evidence; only the Codex build and host verification ran live on this machine.",
        "The proof covers the six executed returns scenarios and five asserted business fields per scenario.",
        "SHA-256 provides recomputable integrity, not identity, timestamping, or non-repudiation.",
      ],
      generatedAt,
    };
    const proof: LocalProofBundle = {
      ...proofBody,
      digest: sha256Digest(proofBody),
    };
    queueEvent("complete", "proof.completed", verificationPassed ? "passed" : "failed", verificationPassed ? "Fresh local proof passed" : "Local verification found a mismatch", suite ? `${suite.summary.passed}/${suite.summary.total} scenarios passed.` : "No valid six-scenario suite was produced.", {
      proof,
    });
    await flushEvents();
    return {
      threadId: turn.threadId,
      turnId: turn.turnId,
      structuredOutput,
      candidateSource,
      diff: diffResult.stdout,
      commands,
      proof,
    };
  } catch (error) {
    const code = safeErrorCode(error);
    queueEvent("complete", "repair.failed", "failed", "Local repair stopped", code, {
      code,
    });
    await flushEvents();
    throw error;
  }
}
