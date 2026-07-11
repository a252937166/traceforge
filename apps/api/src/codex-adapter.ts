import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Usage } from "@openai/codex-sdk";
import { sha256Digest } from "./digest.js";
import { scenarios } from "./scenarios.js";
import type { ProofBundle, Scenario, VerificationStatus } from "./types.js";

export const GENERATED_CANDIDATE_PATH =
  "apps/api/src/candidates/generated-return-workflow.ts";
export const CODEX_REPAIR_MODEL = "gpt-5.6-sol" as const;
export const BEHAVIOR_CONTRACT_PATH = ".traceforge/behavior-contract.json";
export const FAILED_PROOFS_PATH = ".traceforge/failed-proofs.json";
export const VISIBLE_SCENARIOS_PATH = ".traceforge/visible-scenarios.json";
const CHAMPION_SCENARIO_COUNT = scenarios.length + 1;
const CODEX_INPUT_PATHS = [
  BEHAVIOR_CONTRACT_PATH,
  FAILED_PROOFS_PATH,
  VISIBLE_SCENARIOS_PATH,
] as const;

export type CodexBehaviorContract =
  | { id: string }
  | { contractId: string };

export interface CodexRepairInput {
  behaviorContract: CodexBehaviorContract;
  failedProofs: ProofBundle[];
  visibleScenarios: Scenario[];
}

export interface CodexRepairInputEvidence {
  digest: string;
  contractDigest: string;
  failedProofDigests: string[];
  visibleScenarioIds: string[];
}

export interface CodexRepairAdapterStatus {
  installed: boolean;
  enabled: boolean;
  configured: boolean;
  mode: "missing-sdk" | "disabled" | "enabled";
  truthfulBoundary: string;
  integrationContract: {
    input: string;
    output: string;
    sideEffects: string;
  };
  turnTimeoutMs: number;
}

export interface ChangeValidation {
  passed: boolean;
  allowed: string[];
  changed: string[];
  unexpected: string[];
  requiredFileChanged: boolean;
}

export interface GeneratedSuiteRunEvidence {
  scenarioId: string;
  partition: Scenario["stage"];
  runId: string;
  status: VerificationStatus;
  implementationId: string;
  proofId: string;
  proofDigest: string;
  legacyTraceId: string;
  candidateTraceId: string;
  assertionCount: number;
  mismatchCount: number;
  proofPersisted: boolean;
}

export interface GeneratedCandidateSuiteEvidence {
  repairInputDigest: string;
  candidateVersion: "generated";
  status: VerificationStatus;
  expectedScenarioIds: string[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  runs: GeneratedSuiteRunEvidence[];
}

export interface GeneratedSuiteValidation {
  passed: boolean;
  problems: string[];
}

export interface CommandEvidence {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CodexRepairResult {
  codexExecuted: true;
  threadId: string;
  usage: Usage | null;
  changedFiles: string[];
  diff: string;
  structuredOutput: {
    summary: string;
    diagnosis: string;
    changedFile: string;
    verificationIntent: string;
  };
  verification: {
    status: "PASSED" | "FAILED";
    whitelist: ChangeValidation;
    install?: CommandEvidence;
    apiTests?: CommandEvidence;
    generatedCandidate?: CommandEvidence;
    suite?: GeneratedCandidateSuiteEvidence;
    suiteValidation?: GeneratedSuiteValidation;
  };
  worktree: {
    path: string;
    baseCommit: string;
    retained: true;
  };
  repairInput: CodexRepairInputEvidence;
}

export interface CodexRepairFailureEvidence {
  codexExecuted: boolean;
  threadId: string | null;
  usage: Usage | null;
  worktree: { path: string; baseCommit: string; retained: true } | null;
  changedFiles: string[];
  diff: string;
  commands: CommandEvidence[];
  repairInput: CodexRepairInputEvidence | null;
}

export class CodexRepairFailure extends Error {
  readonly code = "CODEX_REPAIR_FAILED";

  constructor(message: string, readonly evidence: CodexRepairFailureEvidence) {
    super(message);
    this.name = "CodexRepairFailure";
  }
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function validateChangedFiles(
  files: string[],
  allowed: string[] = [GENERATED_CANDIDATE_PATH],
): ChangeValidation {
  const changed = [...new Set(files.map(normalizePath).filter(Boolean))].sort();
  const normalizedAllowed = [...new Set(allowed.map(normalizePath))].sort();
  const unexpected = changed.filter((file) => !normalizedAllowed.includes(file));
  return {
    passed: unexpected.length === 0 && changed.includes(GENERATED_CANDIDATE_PATH),
    allowed: normalizedAllowed,
    changed,
    unexpected,
    requiredFileChanged: changed.includes(GENERATED_CANDIDATE_PATH),
  };
}

export function isCodexSdkInstalled(): boolean {
  try {
    import.meta.resolve("@openai/codex-sdk");
    return true;
  } catch {
    return false;
  }
}

export function buildCodexStatus(
  env: NodeJS.ProcessEnv = process.env,
  installed = isCodexSdkInstalled(),
): CodexRepairAdapterStatus {
  const enabled = env.TRACEFORGE_ENABLE_CODEX === "1";
  const configured = installed && enabled;
  const requestedTimeout = Number(env.TRACEFORGE_CODEX_TIMEOUT_MS ?? 300_000);
  const turnTimeoutMs = Number.isFinite(requestedTimeout)
    ? Math.min(Math.max(Math.trunc(requestedTimeout), 10_000), 1_800_000)
    : 300_000;
  return {
    installed,
    enabled,
    configured,
    mode: !installed ? "missing-sdk" : enabled ? "enabled" : "disabled",
    truthfulBoundary: !installed
      ? "The Codex SDK dependency is unavailable; no repair can run."
      : !enabled
        ? "The Codex SDK is installed but execution is disabled. Set TRACEFORGE_ENABLE_CODEX=1 explicitly to allow an isolated repair run."
        : `Codex execution is enabled with ${CODEX_REPAIR_MODEL}. Each repair runs in a retained detached worktree, may edit only generated-return-workflow.ts, and never auto-applies, commits, pushes, or deploys.`,
    integrationContract: {
      input: "The GPT-5.6 behavior contract, every FAILED visible proof, and the disclosed scenario corpus as immutable JSON artifacts.",
      output: `Codex thread/usage, whitelisted full-module diff, offline install, API tests, and a fresh ${CHAMPION_SCENARIO_COUNT}-scenario suite including a post-turn host-generated input.`,
      sideEffects: "Creates a detached .traceforge/worktrees/* directory that is deliberately retained for review.",
    },
    turnTimeoutMs,
  };
}

export function parseGeneratedVerificationSuite(
  stdout: string,
): GeneratedCandidateSuiteEvidence {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as { suite?: GeneratedCandidateSuiteEvidence };
      if (
        parsed.suite?.candidateVersion === "generated" &&
        Array.isArray(parsed.suite.runs)
      ) {
        return parsed.suite;
      }
    } catch {
      // pnpm may print non-JSON status lines; keep scanning toward the start.
    }
  }
  throw new Error(`verify-generated did not emit complete ${CHAMPION_SCENARIO_COUNT}-scenario suite evidence`);
}

export function validateGeneratedSuite(
  suite: GeneratedCandidateSuiteEvidence,
  expectedRepairInputDigest: string,
): GeneratedSuiteValidation {
  const problems: string[] = [];

  if (suite.candidateVersion !== "generated") {
    problems.push("verification suite is not for the generated candidate");
  }
  if (!expectedRepairInputDigest) {
    problems.push("expected repair input digest is missing");
  } else if (suite.repairInputDigest !== expectedRepairInputDigest) {
    problems.push("suite repairInputDigest does not match the contract, failed proofs, and visible scenarios");
  }
  if (
    suite.expectedScenarioIds.length !== CHAMPION_SCENARIO_COUNT
    || suite.runs.length !== CHAMPION_SCENARIO_COUNT
  ) {
    problems.push(`verification suite must contain all ${CHAMPION_SCENARIO_COUNT} champion scenarios`);
  }
  const expectedIds = new Set(suite.expectedScenarioIds);
  const actualIds = new Set(suite.runs.map((run) => run.scenarioId));
  if (
    expectedIds.size !== suite.expectedScenarioIds.length ||
    actualIds.size !== suite.runs.length ||
    [...expectedIds].some((id) => !actualIds.has(id))
  ) {
    problems.push("verification suite scenario identities are missing or duplicated");
  }
  const canonicalVisibleIds = new Set(scenarios.map(({ id }) => id));
  const missingVisibleIds = [...canonicalVisibleIds].filter((id) => !actualIds.has(id));
  const nonCanonicalVisibleRuns = suite.runs.filter(
    ({ scenarioId, partition }) => partition !== "held-out" && !canonicalVisibleIds.has(scenarioId),
  );
  const heldOutRuns = suite.runs.filter(({ partition }) => partition === "held-out");
  if (
    missingVisibleIds.length > 0
    || nonCanonicalVisibleRuns.length > 0
    || heldOutRuns.length !== 1
    || !heldOutRuns[0]?.scenarioId.startsWith("host-hidden-")
  ) {
    problems.push("verification suite must contain every canonical visible scenario and exactly one host-hidden post-turn scenario");
  }
  if (
    suite.status !== "PASSED" ||
    suite.summary.total !== CHAMPION_SCENARIO_COUNT ||
    suite.summary.passed !== CHAMPION_SCENARIO_COUNT ||
    suite.summary.failed !== 0
  ) {
    problems.push(`verification suite summary is not ${CHAMPION_SCENARIO_COUNT}/${CHAMPION_SCENARIO_COUNT} passed`);
  }
  if (heldOutRuns.length !== 1) {
    problems.push("verification suite must contain exactly one post-turn host-held-out scenario");
  }
  if (
    suite.runs.some(
      (run) =>
        run.status !== "PASSED" ||
        run.implementationId !== "replacement.return-workflow.generated-candidate" ||
        run.mismatchCount !== 0 ||
        !run.proofPersisted ||
        !/^trace_/.test(run.legacyTraceId) ||
        !/^trace_/.test(run.candidateTraceId) ||
        run.assertionCount !== 5 ||
        !/^proof_/.test(run.proofId) ||
        !/^sha256:[a-f0-9]{64}$/.test(run.proofDigest),
    )
  ) {
    problems.push("one or more scenario runs lacks a fresh passing generated-candidate proof");
  }
  if (
    new Set(suite.runs.map((run) => run.runId)).size !== suite.runs.length ||
    new Set(suite.runs.map((run) => run.proofId)).size !== suite.runs.length ||
    new Set(suite.runs.map((run) => run.proofDigest)).size !== suite.runs.length
  ) {
    problems.push("fresh run, proof, and digest identities must be unique per scenario");
  }

  return {
    passed: problems.length === 0,
    problems,
  };
}

function clampOutput(value: string, limit = 200_000): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} characters]`;
}

const SAFE_CHILD_ENV_KEYS = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "CI",
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "PNPM_HOME",
  "COREPACK_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
] as const;

const LOOPBACK_PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
] as const;

function isCredentialFreeLoopbackProxy(value: string): boolean {
  try {
    const url = new URL(value);
    const allowedProtocol = ["http:", "https:", "socks:", "socks4:", "socks5:"].includes(
      url.protocol,
    );
    const loopbackHost = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
    return allowedProtocol && loopbackHost && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function buildChildEnvironment(
  sourceEnv: NodeJS.ProcessEnv = process.env,
  overrides: NodeJS.ProcessEnv = {},
): Record<string, string> {
  const executableDirectory = dirname(process.execPath);
  const environment: Record<string, string> = {
    PATH: [executableDirectory, sourceEnv.PATH].filter(Boolean).join(delimiter),
  };
  for (const key of SAFE_CHILD_ENV_KEYS) {
    const value = sourceEnv[key];
    if (typeof value === "string") environment[key] = value;
  }
  for (const key of LOOPBACK_PROXY_ENV_KEYS) {
    const value = sourceEnv[key];
    if (typeof value === "string" && isCredentialFreeLoopbackProxy(value)) {
      environment[key] = value;
    }
  }
  for (const key of ["NO_PROXY", "no_proxy"] as const) {
    const value = sourceEnv[key];
    if (typeof value === "string") environment[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "string") environment[key] = value;
  }
  return environment;
}

export interface CodexClientOptions {
  env: Record<string, string>;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Builds a fail-closed SDK environment. Stale ambient OpenAI/Codex keys are
 * never considered. Without TraceForge's explicit key, the Codex SDK reuses
 * the operator's existing ChatGPT login from CODEX_HOME.
 */
export function buildCodexClientOptions(
  sourceEnv: NodeJS.ProcessEnv = process.env,
): CodexClientOptions {
  const apiKey = sourceEnv.TRACEFORGE_CODEX_API_KEY;
  const baseUrl = sourceEnv.TRACEFORGE_CODEX_BASE_URL;
  return {
    env: buildChildEnvironment(sourceEnv),
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  envOverrides: NodeJS.ProcessEnv = {},
): Promise<CommandEvidence> {
  return new Promise((resolveCommand) => {
    const child = spawn(command, args, {
      cwd,
      env: buildChildEnvironment(process.env, { PWD: cwd, ...envOverrides }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      resolveCommand({ command, args, cwd, exitCode: -1, stdout: clampOutput(stdout), stderr: error.message });
    });
    child.once("close", (code) => {
      resolveCommand({
        command,
        args,
        cwd,
        exitCode: code ?? -1,
        stdout: clampOutput(stdout),
        stderr: clampOutput(stderr),
      });
    });
  });
}

export async function changedFilesIn(worktree: string): Promise<string[]> {
  const [tracked, staged, untracked, ignored] = await Promise.all([
    runCommand("git", ["diff", "--name-only"], worktree),
    runCommand("git", ["diff", "--cached", "--name-only"], worktree),
    runCommand("git", ["ls-files", "--others", "--exclude-standard"], worktree),
    runCommand(
      "git",
      ["status", "--porcelain=v1", "--ignored=matching", "--untracked-files=all", "-z"],
      worktree,
    ),
  ]);
  const commandFailure = [tracked, staged, untracked, ignored].find((result) => result.exitCode !== 0);
  if (commandFailure) {
    throw new Error(`failed to inspect worktree changes: ${commandFailure.stderr || commandFailure.stdout}`);
  }
  const ignoredPaths = ignored.stdout
    .split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => normalizePath(entry.slice(3)))
    .filter((path) => path !== ".traceforge/" && !CODEX_INPUT_PATHS.includes(path as typeof CODEX_INPUT_PATHS[number]));
  return [tracked.stdout, staged.stdout, untracked.stdout]
    .flatMap((output) => output.split(/\r?\n/))
    .concat(ignoredPaths)
    .map(normalizePath)
    .filter((path) => path && !CODEX_INPUT_PATHS.includes(path as typeof CODEX_INPUT_PATHS[number]));
}

const outputSchema = {
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

function contractId(contract: CodexBehaviorContract): string {
  return "id" in contract ? contract.id : contract.contractId;
}

export function validateCodexRepairInput(input: CodexRepairInput): void {
  if (!input.behaviorContract || !contractId(input.behaviorContract).trim()) {
    throw new Error("CODEX_REPAIR_REQUIRES_BEHAVIOR_CONTRACT");
  }
  if (!Array.isArray(input.failedProofs) || input.failedProofs.length === 0) {
    throw new Error("CODEX_REPAIR_REQUIRES_FAILED_PROOFS");
  }
  if (input.failedProofs.some(({ status }) => status !== "FAILED")) {
    throw new Error("CODEX_REPAIR_ACCEPTS_ONLY_FAILED_PROOFS");
  }
  if (new Set(input.failedProofs.map(({ proofId }) => proofId)).size !== input.failedProofs.length) {
    throw new Error("CODEX_REPAIR_REQUIRES_UNIQUE_FAILED_PROOFS");
  }
  if (!Array.isArray(input.visibleScenarios) || input.visibleScenarios.length === 0) {
    throw new Error("CODEX_REPAIR_REQUIRES_VISIBLE_SCENARIOS");
  }
  if (
    input.visibleScenarios.some(
      ({ visibility, stage }) => visibility !== "visible" || stage === "held-out",
    )
  ) {
    throw new Error("CODEX_REPAIR_REJECTS_HIDDEN_SCENARIOS");
  }
  const visibleIds = new Set(input.visibleScenarios.map(({ id }) => id));
  if (visibleIds.size !== input.visibleScenarios.length) {
    throw new Error("CODEX_REPAIR_REQUIRES_UNIQUE_VISIBLE_SCENARIOS");
  }
  if (
    input.failedProofs.some(
      ({ scenarioId }) => !scenarioId || !visibleIds.has(scenarioId),
    )
  ) {
    throw new Error("CODEX_REPAIR_FAILED_PROOF_OUTSIDE_VISIBLE_CORPUS");
  }
}

export function codexRepairInputEvidence(input: CodexRepairInput): CodexRepairInputEvidence {
  validateCodexRepairInput(input);
  return {
    digest: sha256Digest(input),
    contractDigest: sha256Digest(input.behaviorContract),
    failedProofDigests: input.failedProofs.map(({ digest }) => digest),
    visibleScenarioIds: input.visibleScenarios.map(({ id }) => id),
  };
}

export async function writeCodexRepairInputFiles(
  worktreePath: string,
  input: CodexRepairInput,
): Promise<CodexRepairInputEvidence> {
  const evidence = codexRepairInputEvidence(input);
  const inputDirectory = join(worktreePath, ".traceforge");
  await mkdir(inputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(worktreePath, BEHAVIOR_CONTRACT_PATH),
      `${JSON.stringify(input.behaviorContract, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    ),
    writeFile(
      join(worktreePath, FAILED_PROOFS_PATH),
      `${JSON.stringify(input.failedProofs, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    ),
    writeFile(
      join(worktreePath, VISIBLE_SCENARIOS_PATH),
      `${JSON.stringify(input.visibleScenarios, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    ),
  ]);
  return evidence;
}

export async function verifyCodexRepairInputFiles(
  worktreePath: string,
  expected: CodexRepairInputEvidence,
): Promise<void> {
  const inputDirectory = join(worktreePath, ".traceforge");
  const names = (await readdir(inputDirectory)).sort();
  const expectedNames = CODEX_INPUT_PATHS.map((path) => path.slice(".traceforge/".length)).sort();
  if (
    names.length !== expectedNames.length ||
    names.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error("CODEX_REPAIR_INPUT_TAMPERED");
  }
  let persisted: CodexRepairInput;
  try {
    persisted = {
      behaviorContract: JSON.parse(
        await readFile(join(worktreePath, BEHAVIOR_CONTRACT_PATH), "utf8"),
      ) as CodexBehaviorContract,
      failedProofs: JSON.parse(
        await readFile(join(worktreePath, FAILED_PROOFS_PATH), "utf8"),
      ) as ProofBundle[],
      visibleScenarios: JSON.parse(
        await readFile(join(worktreePath, VISIBLE_SCENARIOS_PATH), "utf8"),
      ) as Scenario[],
    };
  } catch {
    throw new Error("CODEX_REPAIR_INPUT_TAMPERED");
  }
  let actual: CodexRepairInputEvidence;
  try {
    actual = codexRepairInputEvidence(persisted);
  } catch {
    throw new Error("CODEX_REPAIR_INPUT_TAMPERED");
  }
  if (
    actual.digest !== expected.digest ||
    actual.contractDigest !== expected.contractDigest ||
    actual.failedProofDigests.join("\n") !== expected.failedProofDigests.join("\n") ||
    actual.visibleScenarioIds.join("\n") !== expected.visibleScenarioIds.join("\n")
  ) {
    throw new Error("CODEX_REPAIR_INPUT_TAMPERED");
  }
}

export function buildCodexRepairPrompt(): string {
  return `You are the implementation repairer for a bounded TraceForge workflow migration.

Use only the behavior contract at ${BEHAVIOR_CONTRACT_PATH}, all failed evidence at ${FAILED_PROOFS_PATH}, the disclosed corpus at ${VISIBLE_SCENARIOS_PATH}, and the generated candidate module. Implement the smallest complete replacement supported by those artifacts, not a configuration toggle.

Hard constraints:
- The only repository file you may edit is ${GENERATED_CANDIDATE_PATH}.
- Do not change executeSeededReturnWorkflow. Repair executeGeneratedReturnWorkflow's complete decision tree and side effects.
- Treat the contract as the requirement and the proofs as evidence; do not invent rules that are absent from them.
- Do not inspect repository tests, the legacy/oracle implementation, verifier internals, or host-only inputs.
- Do not edit tests, package files, lockfiles, any .traceforge input, or any other file.
- Do not use network access, commit, push, merge, deploy, or create another worktree.
- Do not run a package manager, install dependencies, typecheck, test, build, or create node_modules, dist, coverage, SQLite, environment, or other ignored artifacts.
- You may inspect only the three named input artifacts and the generated candidate, plus read-only Git diff/status output. The host alone installs dependencies and runs every acceptance check after your turn.

When finished, return only the requested structured JSON summary.`;
}

export interface CodexRepairAdapterOptions {
  env?: NodeJS.ProcessEnv;
  projectDirectory?: string;
}

export class CodexRepairAdapter {
  private readonly env: NodeJS.ProcessEnv;
  private readonly projectDirectory: string;

  constructor(options: CodexRepairAdapterOptions = {}) {
    this.env = options.env ?? process.env;
    this.projectDirectory =
      options.projectDirectory ?? resolve(fileURLToPath(new URL("..", import.meta.url)));
  }

  status(): CodexRepairAdapterStatus {
    return buildCodexStatus(this.env);
  }

  async repair(input: CodexRepairInput): Promise<CodexRepairResult> {
    const status = this.status();
    if (!status.configured) {
      throw new Error("CODEX_ADAPTER_NOT_CONFIGURED");
    }
    validateCodexRepairInput(input);

    let worktree: CodexRepairFailureEvidence["worktree"] = null;
    let codexExecuted = false;
    let threadId: string | null = null;
    let usage: Usage | null = null;
    let changedFiles: string[] = [];
    let diff = "";
    let repairInput: CodexRepairInputEvidence | null = null;
    const commands: CommandEvidence[] = [];

    try {
      const repo = await runCommand("git", ["rev-parse", "--show-toplevel"], this.projectDirectory);
      commands.push(repo);
      if (repo.exitCode !== 0) throw new Error(`not a Git repository: ${repo.stderr || repo.stdout}`);
      const repoRoot = repo.stdout.trim();

      const requestedBase = this.env.TRACEFORGE_CODEX_BASE_COMMIT?.trim() || "HEAD";
      const head = await runCommand("git", ["rev-parse", requestedBase], repoRoot);
      commands.push(head);
      if (head.exitCode !== 0) throw new Error(`cannot resolve HEAD: ${head.stderr || head.stdout}`);
      const baseCommit = head.stdout.trim();

      const worktreePath = join(
        repoRoot,
        ".traceforge",
        "worktrees",
        `repair-${Date.now()}-${randomUUID().slice(0, 8)}`,
      );
      await mkdir(dirname(worktreePath), { recursive: true });
      const addWorktree = await runCommand("git", ["worktree", "add", "--detach", worktreePath, baseCommit], repoRoot);
      commands.push(addWorktree);
      worktree = { path: worktreePath, baseCommit, retained: true };
      if (addWorktree.exitCode !== 0) {
        throw new Error(`failed to create detached worktree: ${addWorktree.stderr || addWorktree.stdout}`);
      }

      repairInput = await writeCodexRepairInputFiles(worktreePath, input);

      const sdk = await import("@openai/codex-sdk");
      const codex = new sdk.Codex(buildCodexClientOptions(this.env));
      const thread = codex.startThread({
        model: CODEX_REPAIR_MODEL,
        workingDirectory: worktreePath,
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        modelReasoningEffort: "high",
      });
      codexExecuted = true;
      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(new Error(`Codex turn exceeded ${status.turnTimeoutMs}ms`)),
        status.turnTimeoutMs,
      );
      let turn;
      try {
        turn = await thread.run(buildCodexRepairPrompt(), {
          outputSchema,
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      threadId = thread.id;
      usage = turn.usage;
      if (!threadId) throw new Error("Codex completed without a thread id");
      const structuredOutput = JSON.parse(turn.finalResponse) as CodexRepairResult["structuredOutput"];
      if (structuredOutput.changedFile !== GENERATED_CANDIDATE_PATH) {
        throw new Error(`Codex reported an unexpected changed file: ${structuredOutput.changedFile}`);
      }
      await verifyCodexRepairInputFiles(worktreePath, repairInput);
      // This entropy is created only after the writer has returned. It is
      // never persisted into the worktree or included in the Codex prompt.
      const hostHiddenScenarioNonce = randomUUID();

      changedFiles = await changedFilesIn(worktreePath);
      const whitelist = validateChangedFiles(changedFiles);
      const diffResult = await runCommand(
        "git",
        ["diff", "--no-ext-diff", "--", GENERATED_CANDIDATE_PATH],
        worktreePath,
      );
      commands.push(diffResult);
      diff = diffResult.stdout;
      if (diffResult.exitCode !== 0) {
        throw new Error(`failed to collect candidate diff: ${diffResult.stderr}`);
      }

      if (!whitelist.passed) {
        return {
          codexExecuted: true,
          threadId,
          usage,
          changedFiles: whitelist.changed,
          diff,
          structuredOutput,
          verification: { status: "FAILED", whitelist },
          worktree,
          repairInput,
        };
      }

      const verificationEnvironment = {
        TRACEFORGE_ENABLE_CODEX: "0",
        TRACEFORGE_REPAIR_INPUT_DIGEST: repairInput.digest,
        TRACEFORGE_HOST_HIDDEN_SCENARIO_NONCE: hostHiddenScenarioNonce,
      };
      const install = await runCommand(
        "pnpm",
        ["install", "--offline", "--frozen-lockfile"],
        worktreePath,
        verificationEnvironment,
      );
      commands.push(install);
      let apiTests: CommandEvidence | undefined;
      let generatedCandidate: CommandEvidence | undefined;
      if (install.exitCode === 0) {
        apiTests = await runCommand(
          "pnpm",
          ["--filter", "@traceforge/api", "test:candidate"],
          worktreePath,
          verificationEnvironment,
        );
        generatedCandidate = await runCommand(
          "pnpm",
          ["--filter", "@traceforge/api", "verify:generated"],
          worktreePath,
          verificationEnvironment,
        );
        commands.push(apiTests, generatedCandidate);
      }
      let generatedSuite: GeneratedCandidateSuiteEvidence | undefined;
      let suiteValidation: GeneratedSuiteValidation | undefined;
      if (generatedCandidate) {
        try {
          generatedSuite = parseGeneratedVerificationSuite(generatedCandidate.stdout);
          suiteValidation = validateGeneratedSuite(generatedSuite, repairInput.digest);
          if (!suiteValidation.passed) {
            generatedCandidate.stderr = [
              generatedCandidate.stderr,
              `generated candidate suite failed: ${suiteValidation.problems.join("; ")}`,
            ]
              .filter(Boolean)
              .join("\n");
          }
        } catch (error) {
          generatedCandidate.stderr = [
            generatedCandidate.stderr,
            error instanceof Error ? error.message : "failed to parse generated verification",
          ]
            .filter(Boolean)
            .join("\n");
        }
      }
      const verificationPassed =
        install.exitCode === 0 &&
        apiTests?.exitCode === 0 &&
        generatedCandidate?.exitCode === 0 &&
        generatedSuite?.status === "PASSED" &&
        suiteValidation?.passed === true;
      return {
        codexExecuted: true,
        threadId,
        usage,
        changedFiles: whitelist.changed,
        diff,
        structuredOutput,
        verification: {
          status: verificationPassed ? "PASSED" : "FAILED",
          whitelist,
          install,
          ...(apiTests ? { apiTests } : {}),
          ...(generatedCandidate ? { generatedCandidate } : {}),
          ...(generatedSuite ? { suite: generatedSuite } : {}),
          ...(suiteValidation ? { suiteValidation } : {}),
        },
        worktree,
        repairInput,
      };
    } catch (error) {
      if (worktree) {
        try {
          changedFiles = await changedFilesIn(worktree.path);
          const diffResult = await runCommand(
            "git",
            ["diff", "--no-ext-diff", "--", GENERATED_CANDIDATE_PATH],
            worktree.path,
          );
          diff = diffResult.stdout;
        } catch {
          // Preserve the primary error; the worktree path remains available for manual inspection.
        }
      }
      throw new CodexRepairFailure(error instanceof Error ? error.message : "Codex repair failed", {
        codexExecuted,
        threadId,
        usage,
        worktree,
        changedFiles,
        diff,
        commands,
        repairInput,
      });
    }
  }
}
