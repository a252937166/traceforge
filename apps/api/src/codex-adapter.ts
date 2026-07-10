import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Usage } from "@openai/codex-sdk";
import type { DemoRunResponse, ProofBundle } from "./types.js";

export const GENERATED_REPAIR_PATH = "apps/api/src/candidates/generated-repair.ts";
const PROOF_INPUT_PATH = ".traceforge/proof-input.json";

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

export interface GeneratedRepairProvenanceValidation {
  passed: boolean;
  evidenceId: string | null;
  status: string | null;
  sourceProofDigest: string | null;
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
    run?: DemoRunResponse;
    provenance?: GeneratedRepairProvenanceValidation;
  };
  worktree: {
    path: string;
    baseCommit: string;
    retained: true;
  };
}

export interface CodexRepairFailureEvidence {
  codexExecuted: boolean;
  threadId: string | null;
  usage: Usage | null;
  worktree: { path: string; baseCommit: string; retained: true } | null;
  changedFiles: string[];
  diff: string;
  commands: CommandEvidence[];
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function validateChangedFiles(
  files: string[],
  allowed: string[] = [GENERATED_REPAIR_PATH],
): ChangeValidation {
  const changed = [...new Set(files.map(normalizePath).filter(Boolean))].sort();
  const normalizedAllowed = [...new Set(allowed.map(normalizePath))].sort();
  const unexpected = changed.filter((file) => !normalizedAllowed.includes(file));
  return {
    passed: unexpected.length === 0 && changed.includes(GENERATED_REPAIR_PATH),
    allowed: normalizedAllowed,
    changed,
    unexpected,
    requiredFileChanged: changed.includes(GENERATED_REPAIR_PATH),
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
        : "Codex execution is enabled. Each repair runs in a retained detached worktree, may edit only generated-repair.ts, and never auto-applies, commits, pushes, or deploys.",
    integrationContract: {
      input: "An existing FAILED ProofBundle retrieved by proofId.",
      output: "Codex thread/usage, whitelisted diff, offline install, API tests, and generated-candidate verification evidence.",
      sideEffects: "Creates a detached .traceforge/worktrees/* directory that is deliberately retained for review.",
    },
    turnTimeoutMs,
  };
}

export function parseGeneratedVerificationRun(stdout: string): DemoRunResponse {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as { run?: DemoRunResponse };
      if (parsed.run?.runId && parsed.run.proofBundle?.digest) return parsed.run;
    } catch {
      // pnpm may print non-JSON status lines; keep scanning toward the start.
    }
  }
  throw new Error("verify-generated did not emit a complete DemoRunResponse");
}

export function validateGeneratedRepairProvenance(
  run: DemoRunResponse,
  expectedSourceProofDigest: string,
): GeneratedRepairProvenanceValidation {
  const rawRun = asRecord(run);
  const proofBundle = asRecord(rawRun.proofBundle);
  const traces = asRecord(rawRun.traces);
  const replacement = asRecord(traces.replacement);
  const evidence = Array.isArray(replacement.evidence) ? replacement.evidence : [];
  const configurationEvidence = evidence
    .map(asRecord)
    .find((entry) => entry.type === "repair.configuration");
  const payload = asRecord(configurationEvidence?.payload);
  const metadata = asRecord(payload.metadata);
  const status = typeof metadata.status === "string" ? metadata.status : null;
  const sourceProofDigest =
    typeof metadata.sourceProofDigest === "string" ? metadata.sourceProofDigest : null;
  const evidenceId =
    typeof configurationEvidence?.evidenceId === "string" ? configurationEvidence.evidenceId : null;
  const problems: string[] = [];

  if (proofBundle.candidateVersion !== "generated") {
    problems.push("verification run is not for the generated candidate");
  }
  if (!configurationEvidence) {
    problems.push("repair.configuration evidence is missing");
  }
  if (status !== "codex-generated") {
    problems.push("generated repair metadata.status is not codex-generated");
  }
  if (!expectedSourceProofDigest) {
    problems.push("expected source proof digest is missing");
  } else if (sourceProofDigest !== expectedSourceProofDigest) {
    problems.push("generated repair sourceProofDigest does not match the failed proof");
  }

  return {
    passed: problems.length === 0,
    evidenceId,
    status,
    sourceProofDigest,
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
    .filter((path) => path !== ".traceforge/" && path !== PROOF_INPUT_PATH);
  return [tracked.stdout, staged.stdout, untracked.stdout]
    .flatMap((output) => output.split(/\r?\n/))
    .concat(ignoredPaths)
    .map(normalizePath)
    .filter((path) => path && path !== PROOF_INPUT_PATH);
}

const outputSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    diagnosis: { type: "string" },
    changedFile: { type: "string", enum: [GENERATED_REPAIR_PATH] },
    verificationIntent: { type: "string" },
  },
  required: ["summary", "diagnosis", "changedFile", "verificationIntent"],
  additionalProperties: false,
} as const;

function repairPrompt(proof: ProofBundle): string {
  return `You are the implementation repairer for a bounded TraceForge demonstration.

Read the failed proof at ${PROOF_INPUT_PATH}. Infer the smallest repair from its deterministic inventory mismatches.

Hard constraints:
- The only repository file you may edit is ${GENERATED_REPAIR_PATH}.
- Inside that file, do not alter GENERATED_REPAIR_BASELINE, its type definitions, or exports other than generatedRepair.
- Update generatedRepair so the generated candidate conforms to the proof. Mark metadata.status as codex-generated, set metadata.sourceProofDigest to ${proof.digest}, and write a concise factual summary.
- Do not edit tests, package files, lockfiles, proof-input.json, or any other file.
- Do not use network access, commit, push, merge, deploy, or create another worktree.
- Do not run a package manager, install dependencies, typecheck, test, build, or create node_modules, dist, coverage, SQLite, environment, or other ignored artifacts.
- You may inspect local files and use read-only Git diff/status checks. The host alone installs dependencies and runs every acceptance check after your turn.

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

  async repair(proof: ProofBundle): Promise<CodexRepairResult> {
    const status = this.status();
    if (!status.configured) {
      throw new Error("CODEX_ADAPTER_NOT_CONFIGURED");
    }
    if (proof.status !== "FAILED") {
      throw new Error("CODEX_REPAIR_REQUIRES_FAILED_PROOF");
    }

    let worktree: CodexRepairFailureEvidence["worktree"] = null;
    let codexExecuted = false;
    let threadId: string | null = null;
    let usage: Usage | null = null;
    let changedFiles: string[] = [];
    let diff = "";
    const commands: CommandEvidence[] = [];

    try {
      const repo = await runCommand("git", ["rev-parse", "--show-toplevel"], this.projectDirectory);
      commands.push(repo);
      if (repo.exitCode !== 0) throw new Error(`not a Git repository: ${repo.stderr || repo.stdout}`);
      const repoRoot = repo.stdout.trim();

      const head = await runCommand("git", ["rev-parse", "HEAD"], repoRoot);
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

      const proofPath = join(worktreePath, PROOF_INPUT_PATH);
      await mkdir(dirname(proofPath), { recursive: true });
      await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");

      const sdk = await import("@openai/codex-sdk");
      const codexApiKey = this.env.CODEX_API_KEY ?? this.env.OPENAI_API_KEY;
      const codexBaseUrl = this.env.OPENAI_BASE_URL;
      const codex = new sdk.Codex({
        env: buildChildEnvironment(this.env),
        ...(codexApiKey ? { apiKey: codexApiKey } : {}),
        ...(codexBaseUrl ? { baseUrl: codexBaseUrl } : {}),
      });
      const thread = codex.startThread({
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
        turn = await thread.run(repairPrompt(proof), {
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
      if (structuredOutput.changedFile !== GENERATED_REPAIR_PATH) {
        throw new Error(`Codex reported an unexpected changed file: ${structuredOutput.changedFile}`);
      }

      changedFiles = await changedFilesIn(worktreePath);
      const whitelist = validateChangedFiles(changedFiles);
      const diffResult = await runCommand(
        "git",
        ["diff", "--no-ext-diff", "--", GENERATED_REPAIR_PATH],
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
        };
      }

      const verificationEnvironment = {
        TRACEFORGE_ENABLE_CODEX: "0",
        TRACEFORGE_SOURCE_PROOF_DIGEST: proof.digest,
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
          ["--filter", "@traceforge/api", "test"],
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
      let generatedRun: DemoRunResponse | undefined;
      let provenance: GeneratedRepairProvenanceValidation | undefined;
      if (generatedCandidate) {
        try {
          generatedRun = parseGeneratedVerificationRun(generatedCandidate.stdout);
          provenance = validateGeneratedRepairProvenance(generatedRun, proof.digest);
          if (!provenance.passed) {
            generatedCandidate.stderr = [
              generatedCandidate.stderr,
              `generated repair provenance failed: ${provenance.problems.join("; ")}`,
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
        generatedRun?.status === "PASSED" &&
        generatedRun.proofBundle.mismatches.length === 0 &&
        provenance?.passed === true;
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
          ...(generatedRun ? { run: generatedRun } : {}),
          ...(provenance ? { provenance } : {}),
        },
        worktree,
      };
    } catch (error) {
      if (worktree) {
        try {
          changedFiles = await changedFilesIn(worktree.path);
          const diffResult = await runCommand(
            "git",
            ["diff", "--no-ext-diff", "--", GENERATED_REPAIR_PATH],
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
      });
    }
  }
}
