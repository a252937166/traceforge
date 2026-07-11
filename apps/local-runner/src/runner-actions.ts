import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";
import {
  AppServerClient,
  VERIFIED_CODEX_VERSION,
  spawnAppServer,
  type AccountReadResult,
} from "./app-server-client.js";
import type { LocalFixture } from "./fixture.js";
import { LOCAL_RUNNER_MANIFEST } from "./manifest.js";
import { openOpenAiLogin } from "./open-browser.js";
import {
  TRACEFORGE_BUILD_PROFILE_ID,
  TRACEFORGE_VERIFY_PROFILE_ID,
  buildHardenedAppServerArgs,
  buildHardenedAppServerEnvironment,
  writeCodexPermissionConfig,
} from "./permissions.js";
import { runLocalRepair, type LocalRepairEvent } from "./local-repair.js";
import type {
  LocalRunnerActions,
  LocalRunnerPreflight,
  LocalRunnerProgress,
  LocalRunnerResult,
} from "./session.js";

const CANDIDATE_PATH = "apps/api/src/candidates/generated-return-workflow.ts";
const TRANSPORT_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
] as const;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeTransportEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of TRANSPORT_KEYS) {
    const value = environment[key] ?? environment[key.toLowerCase()];
    if (typeof value === "string" && value) result[key] = value;
  }
  return result;
}

function accountLabel(account: AccountReadResult): string | undefined {
  if (account.account?.type !== "chatgpt") return undefined;
  const plan = account.account.planType;
  return plan ? `ChatGPT ${plan}` : "ChatGPT signed in";
}

export async function resolveLocalCodexExecutable(
  requested: string,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  if (!requested || requested.length > 4_096 || /[\0\r\n]/.test(requested)) {
    throw new Error("LOCAL_CODEX_EXECUTABLE_INVALID");
  }
  const executableAccess = process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK;
  if (isAbsolute(requested)) {
    await access(requested, executableAccess).catch(() => {
      throw new Error("LOCAL_CODEX_EXECUTABLE_NOT_FOUND");
    });
    return requested;
  }
  if (requested.includes("/") || requested.includes("\\")) {
    throw new Error("LOCAL_CODEX_EXECUTABLE_MUST_BE_ABSOLUTE");
  }
  const extensions = process.platform === "win32"
    ? (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const directory of (environment.PATH ?? "").split(delimiter)) {
    if (!directory || !isAbsolute(directory) || /[\0\r\n]/.test(directory)) continue;
    for (const extension of extensions) {
      const candidate = resolve(directory, `${requested}${extension}`);
      if (await access(candidate, executableAccess).then(() => true).catch(() => false)) {
        // Preserve the selected wrapper path instead of resolving symlinks. A
        // wrapper may intentionally pin the architecture used by Codex itself.
        return candidate;
      }
    }
  }
  throw new Error("LOCAL_CODEX_EXECUTABLE_NOT_FOUND");
}

function progressFromEvent(event: LocalRepairEvent): LocalRunnerProgress {
  const phase = event.stage === "build"
    ? "codex"
    : event.stage === "verify" || event.stage === "complete"
      ? "verifying"
      : "preparing";
  const payload = object(event.payload);
  const safeDetail = event.type === "command.completed"
    ? (event.status === "passed" ? "Fixed verification command exited 0." : "A fixed verification command exited non-zero.")
    : event.type === "codex.turn-completed"
      ? "The writer turn is closed; host-only verification can begin."
      : event.type === "verification-input.created"
        ? "Fresh host-only verification input created after the writer turn."
        : event.type === "proof.completed"
          ? event.detail
          : event.type === "repair.failed" && typeof payload.code === "string"
            ? payload.code
            : undefined;
  return {
    phase,
    message: event.title,
    ...(safeDetail ? { detail: safeDetail } : {}),
    ...(typeof payload.threadId === "string" ? { threadId: payload.threadId } : {}),
    model: LOCAL_RUNNER_MANIFEST.model,
  };
}

export interface TraceForgeLocalActionsOptions {
  environment?: NodeJS.ProcessEnv;
  codexExecutable?: string;
}

export class TraceForgeLocalActions implements LocalRunnerActions {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly codexExecutable: string;
  private buildClient: AppServerClient | null = null;
  private verifyClient: AppServerClient | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private resolvedCodexExecutable: Promise<string> | null = null;

  constructor(
    private readonly fixture: LocalFixture,
    options: TraceForgeLocalActionsOptions = {},
  ) {
    this.environment = options.environment ?? process.env;
    this.codexExecutable = options.codexExecutable
      ?? this.environment.TRACEFORGE_CODEX_BIN
      ?? "codex";
    if (!this.codexExecutable || this.codexExecutable.length > 4_096 || /[\0\r\n]/.test(this.codexExecutable)) {
      throw new Error("LOCAL_CODEX_EXECUTABLE_INVALID");
    }
  }

  private localCodexExecutable(): Promise<string> {
    this.resolvedCodexExecutable ??= resolveLocalCodexExecutable(
      this.codexExecutable,
      this.environment,
    );
    return this.resolvedCodexExecutable;
  }

  private async ensureBuildClient(): Promise<AppServerClient> {
    if (this.buildClient) return this.buildClient;
    const config = await writeCodexPermissionConfig({
      codexHome: this.fixture.codexHome,
      workspaceRoot: this.fixture.writerRoot,
      sessionHome: this.fixture.sessionHome,
      sessionTmp: this.fixture.sessionTmp,
      writablePaths: [CANDIDATE_PATH],
      profileId: TRACEFORGE_BUILD_PROFILE_ID,
      description: "TraceForge recorded fixture; only the generated workflow may change",
      credentialStore: "file",
      transportEnvironment: safeTransportEnvironment(this.environment),
    });
    this.buildClient = await spawnAppServer({
      executable: await this.localCodexExecutable(),
      args: buildHardenedAppServerArgs(),
      cwd: this.fixture.writerRoot,
      env: buildHardenedAppServerEnvironment(config),
      expectedPermissionProfile: TRACEFORGE_BUILD_PROFILE_ID,
      workspaceRoot: this.fixture.writerRoot,
    });
    return this.buildClient;
  }

  private async createVerifyClient(): Promise<AppServerClient> {
    if (this.verifyClient) await this.verifyClient.close().catch(() => undefined);
    await mkdir(this.fixture.verifyCodexHome, { recursive: true, mode: 0o700 });
    const config = await writeCodexPermissionConfig({
      codexHome: this.fixture.verifyCodexHome,
      workspaceRoot: this.fixture.verifierRoot,
      sessionHome: this.fixture.sessionHome,
      sessionTmp: this.fixture.sessionTmp,
      writablePaths: [],
      profileId: TRACEFORGE_VERIFY_PROFILE_ID,
      description: "TraceForge host-only verifier; repository contents are read-only",
      credentialStore: "file",
    });
    this.verifyClient = await spawnAppServer({
      executable: await this.localCodexExecutable(),
      args: buildHardenedAppServerArgs(),
      cwd: this.fixture.verifierRoot,
      env: buildHardenedAppServerEnvironment(config),
      expectedPermissionProfile: TRACEFORGE_VERIFY_PROFILE_ID,
      workspaceRoot: this.fixture.verifierRoot,
    });
    return this.verifyClient;
  }

  async preflight(): Promise<LocalRunnerPreflight> {
    const client = await this.ensureBuildClient();
    const account = await client.readAccount();
    const signedIn = account.account?.type === "chatgpt";
    let modelAvailable = true;
    if (signedIn) {
      const models = await client.listModels();
      modelAvailable = models.some(
        ({ id, model }) => id === LOCAL_RUNNER_MANIFEST.model || model === LOCAL_RUNNER_MANIFEST.model,
      );
    }
    return {
      codexVersion: `codex-cli ${VERIFIED_CODEX_VERSION}`,
      signedIn,
      modelAvailable,
      ...(accountLabel(account) ? { accountLabel: accountLabel(account) } : {}),
    };
  }

  async login(): Promise<void> {
    const client = await this.ensureBuildClient();
    const response = object(await client.startLogin({
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "codex",
    }));
    if (
      response.type !== "chatgpt"
      || typeof response.authUrl !== "string"
      || typeof response.loginId !== "string"
    ) {
      throw new Error("LOCAL_LOGIN_RESPONSE_INVALID");
    }
    const loginId = response.loginId;
    await openOpenAiLogin(response.authUrl);
    const notification = await client.waitForNotification((candidate) => {
      if (candidate.method !== "account/login/completed") return false;
      const params = object(candidate.params);
      return params.loginId == null || params.loginId === loginId;
    }, { timeoutMs: 10 * 60_000 });
    const params = object(notification.params);
    if (params.success !== true) throw new Error("LOCAL_LOGIN_FAILED");
    const account = await client.readAccount();
    if (account.account?.type !== "chatgpt") throw new Error("LOCAL_LOGIN_INCOMPLETE");
  }

  async run(
    signal: AbortSignal,
    onProgress: (progress: LocalRunnerProgress) => void,
  ): Promise<LocalRunnerResult> {
    const buildAppServer = await this.ensureBuildClient();
    const verifyAppServer = await this.createVerifyClient();
    const result = await runLocalRepair(
      {
        fixture: this.fixture,
        buildAppServer,
        verifyAppServer,
        signal,
      },
      (event) => onProgress(progressFromEvent(event)),
    );
    const suite = result.proof.verification.suite;
    const runs = suite?.runs ?? [];
    const assertionCount = runs.reduce((total, run) => total + run.assertionCount, 0);
    const mismatchCount = runs.reduce((total, run) => total + run.mismatchCount, 0);
    const failedCommand = result.commands.find(({ exitCode }) => exitCode !== 0);
    const failureCode = failedCommand?.diagnosticCode
      ?? (result.proof.verification.tests === null
        ? "TEST_OUTPUT_INVALID"
        : result.proof.verification.suite === null
          ? "SUITE_OUTPUT_INVALID"
          : result.proof.verification.suiteValidation.passed
            ? undefined
            : "SUITE_VALIDATION_FAILED");
    return {
      proof: result.proof,
      diff: result.diff,
      summary: {
        status: result.proof.status,
        proofDigest: result.proof.digest,
        diffDigest: result.proof.candidate.diffDigest,
        threadId: result.threadId,
        model: result.proof.codex.model,
        scenariosPassed: suite?.summary.passed ?? 0,
        scenariosTotal: suite?.summary.total ?? 0,
        assertionsPassed: assertionCount - mismatchCount,
        assertionCount,
        mismatchCount,
        changedFiles: result.proof.candidate.changedFiles,
        ...(failedCommand ? { failedCommand: failedCommand.name } : {}),
        ...(failureCode ? { failureCode } : {}),
      },
    };
  }

  async cleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPromise = (async () => {
      const clients = [this.verifyClient, this.buildClient].filter(
        (client): client is AppServerClient => client !== null,
      );
      await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
      const { cleanupLocalFixture } = await import("./fixture.js");
      await cleanupLocalFixture(this.fixture);
    })();
    return this.cleanupPromise;
  }
}
