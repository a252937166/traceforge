import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
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
const CODEX_HOME_LOCK_FILE = ".traceforge-runner.lock";
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

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

function parseLockPid(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const pid = Number(trimmed);
  return Number.isSafeInteger(pid) && pid <= 2_147_483_647 ? pid : null;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

export interface DedicatedCodexHomeLock {
  readonly path: string;
  release(): Promise<void>;
}

/**
 * Serializes access to the persistent Runner-owned CODEX_HOME. The lock file
 * contains only the owning process PID; credential files are never inspected.
 */
export async function acquireDedicatedCodexHomeLock(
  codexHome: string,
): Promise<DedicatedCodexHomeLock> {
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  const lockPath = join(codexHome, CODEX_HOME_LOCK_FILE);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (attempt > 0) throw new Error("LOCAL_CODEX_HOME_IN_USE");

      const ownerText = await readFile(lockPath, "utf8").catch((readError) => {
        if (errorCode(readError) === "ENOENT") return null;
        throw readError;
      });
      if (ownerText === null) continue;
      const ownerPid = parseLockPid(ownerText);
      if (ownerPid === null || processIsAlive(ownerPid)) {
        throw new Error("LOCAL_CODEX_HOME_IN_USE");
      }
      await rm(lockPath, { force: false }).catch((removeError) => {
        if (errorCode(removeError) !== "ENOENT") throw removeError;
      });
      continue;
    }

    try {
      await handle.writeFile(`${process.pid}\n`, { encoding: "utf8" });
      await handle.sync();
      const identity = await handle.stat();
      await handle.close();
      let released = false;
      return {
        path: lockPath,
        async release(): Promise<void> {
          if (released) return;
          const current = await lstat(lockPath).catch((statError) => {
            if (errorCode(statError) === "ENOENT") return null;
            throw statError;
          });
          if (current && current.dev === identity.dev && current.ino === identity.ino) {
            await rm(lockPath, { force: true });
          }
          released = true;
        },
      };
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(lockPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  throw new Error("LOCAL_CODEX_HOME_IN_USE");
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
  private buildClientPromise: Promise<AppServerClient> | null = null;
  private buildClosePromise: Promise<void> | null = null;
  private buildLock: DedicatedCodexHomeLock | null = null;
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
    if (this.buildClientPromise) return this.buildClientPromise;
    const creation = (async () => {
      const lock = await acquireDedicatedCodexHomeLock(this.fixture.codexHome);
      this.buildLock = lock;
      try {
        const config = await writeCodexPermissionConfig({
          codexHome: this.fixture.codexHome,
          workspaceRoot: this.fixture.writerRoot,
          sessionHome: this.fixture.buildHome,
          sessionTmp: this.fixture.buildTmp,
          writablePaths: [CANDIDATE_PATH],
          profileId: TRACEFORGE_BUILD_PROFILE_ID,
          description: "TraceForge recorded fixture; only the generated workflow may change",
          credentialStore: "file",
          transportEnvironment: safeTransportEnvironment(this.environment),
        });
        const client = await spawnAppServer({
          executable: await this.localCodexExecutable(),
          args: buildHardenedAppServerArgs(),
          cwd: this.fixture.writerRoot,
          env: buildHardenedAppServerEnvironment(config),
          expectedPermissionProfile: TRACEFORGE_BUILD_PROFILE_ID,
          workspaceRoot: this.fixture.writerRoot,
        });
        this.buildClient = client;
        return client;
      } catch (error) {
        if (this.buildLock === lock) this.buildLock = null;
        await lock.release().catch(() => undefined);
        throw error;
      }
    })();
    this.buildClientPromise = creation;
    try {
      return await creation;
    } catch (error) {
      if (this.buildClientPromise === creation) this.buildClientPromise = null;
      throw error;
    }
  }

  private async closeBuildClientAndReleaseLock(): Promise<void> {
    if (this.buildClosePromise) return this.buildClosePromise;
    const closing = (async () => {
      const client = this.buildClient;
      const lock = this.buildLock;
      this.buildClient = null;
      this.buildClientPromise = null;
      if (client) await client.close().catch(() => undefined);
      if (this.buildLock === lock) this.buildLock = null;
      if (lock) await lock.release();
    })();
    this.buildClosePromise = closing;
    try {
      await closing;
    } finally {
      if (this.buildClosePromise === closing) this.buildClosePromise = null;
    }
  }

  private async createVerifyClient(): Promise<AppServerClient> {
    if (this.verifyClient) await this.verifyClient.close().catch(() => undefined);
    await mkdir(this.fixture.verifyCodexHome, { recursive: true, mode: 0o700 });
    const config = await writeCodexPermissionConfig({
      codexHome: this.fixture.verifyCodexHome,
      workspaceRoot: this.fixture.verifierRoot,
      sessionHome: this.fixture.verifyHome,
      sessionTmp: this.fixture.verifyTmp,
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
    try {
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
    } catch (error) {
      await this.closeBuildClientAndReleaseLock();
      throw error;
    }
  }

  async login(): Promise<void> {
    try {
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
    } catch (error) {
      await this.closeBuildClientAndReleaseLock();
      throw error;
    }
  }

  async run(
    signal: AbortSignal,
    onProgress: (progress: LocalRunnerProgress) => void,
  ): Promise<LocalRunnerResult> {
    let result;
    try {
      const buildAppServer = await this.ensureBuildClient();
      const verifyAppServer = await this.createVerifyClient();
      result = await runLocalRepair(
        {
          fixture: this.fixture,
          buildAppServer,
          verifyAppServer,
          signal,
        },
        (event) => onProgress(progressFromEvent(event)),
      );
    } catch (error) {
      if (this.verifyClient) await this.verifyClient.close().catch(() => undefined);
      this.verifyClient = null;
      await this.closeBuildClientAndReleaseLock();
      throw error;
    }
    if (this.verifyClient) await this.verifyClient.close().catch(() => undefined);
    this.verifyClient = null;
    await this.closeBuildClientAndReleaseLock();
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
        testsPassed: result.proof.verification.tests?.passed ?? 0,
        testsTotal: result.proof.verification.tests?.candidateSafeTotal ?? 0,
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
      await this.buildClientPromise?.catch(() => undefined);
      if (this.verifyClient) await this.verifyClient.close().catch(() => undefined);
      this.verifyClient = null;
      await this.closeBuildClientAndReleaseLock();
      const { cleanupLocalFixture } = await import("./fixture.js");
      await cleanupLocalFixture(this.fixture);
    })();
    return this.cleanupPromise;
  }
}
