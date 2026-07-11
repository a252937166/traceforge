import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute, relative, sep } from "node:path";

export const VERIFIED_CODEX_VERSION = "0.144.1" as const;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_INITIALIZE_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_STDERR_CHARS = 16_384;
const DEFAULT_MAX_PROTOCOL_LINE_CHARS = 8 * 1024 * 1024;
const DEFAULT_CLOSE_GRACE_MS = 750;

const ALLOWED_CLIENT_METHODS = new Set([
  "initialize",
  "account/read",
  "account/login/start",
  "account/login/cancel",
  "account/rateLimits/read",
  "model/list",
  "config/read",
  "thread/start",
  "turn/start",
  "turn/interrupt",
  "command/exec",
]);
const SAFE_COMMAND_ENVIRONMENT_KEYS = new Set([
  "TRACEFORGE_ENABLE_CODEX",
  "TRACEFORGE_REPAIR_INPUT_DIGEST",
  "TRACEFORGE_HOST_HIDDEN_SCENARIO_NONCE",
  "TMPDIR",
  "CI",
  "NO_COLOR",
]);

type RequestId = number | string;
type JsonObject = Record<string, unknown>;

export interface AppServerNotification {
  method: string;
  params: unknown;
}

export type AppServerNotificationListener = (notification: AppServerNotification) => void;

export interface AppServerClientInfo {
  name: string;
  title: string;
  version: string;
}

export interface SpawnAppServerOptions {
  executable: string;
  args: readonly string[];
  cwd?: string;
  /** Must be an explicit allowlist. The current process environment is never inherited implicitly. */
  env: NodeJS.ProcessEnv;
  clientInfo?: AppServerClientInfo;
  expectedPermissionProfile?: string;
  /** Optional additional client-side guard; the permission profile remains the real boundary. */
  workspaceRoot?: string;
  requestTimeoutMs?: number;
  initializeTimeoutMs?: number;
  maxStderrChars?: number;
  maxProtocolLineChars?: number;
  /** Exact version to require; false is intended only for controlled protocol tests. */
  verifyVersion?: string | false;
}

export interface AppServerRequestOptions {
  timeoutMs?: number;
}

export interface AccountSummary {
  type: string;
  planType: string | null;
}

export interface AccountReadResult {
  account: AccountSummary | null;
  requiresOpenaiAuth: boolean;
}

export interface AppServerModel {
  id: string;
  model: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  isDefault?: boolean;
  supportedReasoningEfforts?: unknown[];
  [key: string]: unknown;
}

export type SafeLoginParams =
  | {
    type: "chatgpt";
    useHostedLoginSuccessPage?: boolean;
    appBrand?: "codex" | "chatgpt";
  }
  | { type: "chatgptDeviceCode" };

export interface SafeThreadStartParams {
  cwd: string;
  model: string;
  developerInstructions: string;
  serviceName?: string;
}

export interface SafeTurnStartParams {
  threadId: string;
  prompt: string;
  outputSchema?: unknown;
}

export interface SafeCommandExecParams {
  command: readonly string[];
  cwd: string;
  timeoutMs?: number;
  outputBytesCap?: number;
}

export interface CommandExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class AppServerRpcError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number,
    message: string,
  ) {
    super(`LOCAL_APP_SERVER_RPC_ERROR:${method}:${code}:${redactAndTruncate(message, 512)}`);
    this.name = "AppServerRpcError";
  }
}

export class AppServerTimeoutError extends Error {
  constructor(public readonly method: string, public readonly timeoutMs: number) {
    super(`LOCAL_APP_SERVER_REQUEST_TIMEOUT:${method}:${timeoutMs}`);
    this.name = "AppServerTimeoutError";
  }
}

export class AppServerProcessError extends Error {
  constructor(message: string, public readonly safeStderr: string) {
    super(`${message}${safeStderr ? `\n${safeStderr}` : ""}`);
    this.name = "AppServerProcessError";
  }
}

function objectOrEmpty(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function finiteTimeout(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 15 * 60_000) {
    throw new Error(`LOCAL_APP_SERVER_${label}_INVALID`);
  }
  return result;
}

function redactSecrets(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer)\s+[^\s]+/gi, "$1 [REDACTED]")
    .replace(/("(?:accessToken|refreshToken|idToken|apiKey|token|password)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/((?:API_?KEY|ACCESS_?TOKEN|REFRESH_?TOKEN|SECRET|PASSWORD)\s*=\s*)[^\s]+/gi, "$1[REDACTED]");
}

export function redactAndTruncate(value: string, maxChars = DEFAULT_MAX_STDERR_CHARS): string {
  if (!Number.isSafeInteger(maxChars) || maxChars < 64) {
    throw new Error("LOCAL_APP_SERVER_REDACTION_LIMIT_INVALID");
  }
  const redacted = redactSecrets(value);
  if (redacted.length <= maxChars) return redacted;
  return `${redacted.slice(0, maxChars)}\n[TRUNCATED]`;
}

function validateSafeRequest(
  method: string,
  params: unknown,
  expectedPermissionProfile: string | undefined,
  workspaceRoot: string | undefined,
  commandTmpDir: string | undefined,
): void {
  if (!ALLOWED_CLIENT_METHODS.has(method)) {
    throw new Error(`LOCAL_APP_SERVER_METHOD_BLOCKED:${method}`);
  }
  const value = objectOrEmpty(params);
  if (method === "account/login/start") {
    if (value.type !== "chatgpt" && value.type !== "chatgptDeviceCode") {
      throw new Error("LOCAL_APP_SERVER_LOGIN_TYPE_BLOCKED");
    }
  }
  if (method === "thread/start" || method === "turn/start") {
    for (const field of [
      "sandbox",
      "sandboxPolicy",
      "permissions",
      "runtimeWorkspaceRoots",
      "environments",
      "config",
      "dynamicTools",
      "selectedCapabilityRoots",
      "experimentalRawEvents",
      "historyMode",
      "collaborationMode",
      "additionalContext",
    ]) {
      if (field in value) throw new Error(`LOCAL_APP_SERVER_OVERRIDE_BLOCKED:${method}:${field}`);
    }
    if (method === "thread/start" && value.approvalPolicy !== "never") {
      throw new Error(`LOCAL_APP_SERVER_APPROVAL_POLICY_BLOCKED:${method}`);
    }
    if (method === "turn/start" && "approvalPolicy" in value && value.approvalPolicy !== "never") {
      throw new Error(`LOCAL_APP_SERVER_APPROVAL_POLICY_BLOCKED:${method}`);
    }
    if ("cwd" in value && (typeof value.cwd !== "string" || !isAbsolute(value.cwd)
      || (workspaceRoot && !pathIsWithin(workspaceRoot, value.cwd)))) {
      throw new Error(`LOCAL_APP_SERVER_CWD_BLOCKED:${method}`);
    }
  }
  if (method === "command/exec") {
    for (const field of [
      "sandboxPolicy",
      "disableTimeout",
      "disableOutputCap",
      "processId",
      "tty",
      "streamStdin",
      "streamStdoutStderr",
    ]) {
      if (field in value) throw new Error(`LOCAL_APP_SERVER_COMMAND_FIELD_BLOCKED:${field}`);
    }
    if ("permissionProfile" in value && value.permissionProfile !== expectedPermissionProfile) {
      throw new Error("LOCAL_APP_SERVER_PERMISSION_PROFILE_MISMATCH");
    }
    const command = value.command;
    if (!Array.isArray(command) || command.length === 0
      || command.some((part) => typeof part !== "string" || !part || part.includes("\0"))) {
      throw new Error("LOCAL_APP_SERVER_COMMAND_INVALID");
    }
    if (typeof value.cwd !== "string" || !isAbsolute(value.cwd)) {
      throw new Error("LOCAL_APP_SERVER_COMMAND_CWD_INVALID");
    }
    if (workspaceRoot && !pathIsWithin(workspaceRoot, value.cwd)) {
      throw new Error("LOCAL_APP_SERVER_COMMAND_CWD_BLOCKED");
    }
    if ("env" in value) validateCommandEnvironment(value.env, commandTmpDir);
    if ("timeoutMs" in value && (!Number.isSafeInteger(value.timeoutMs)
      || (value.timeoutMs as number) < 1 || (value.timeoutMs as number) > 15 * 60_000)) {
      throw new Error("LOCAL_APP_SERVER_COMMAND_TIMEOUT_INVALID");
    }
    if ("outputBytesCap" in value && (!Number.isSafeInteger(value.outputBytesCap)
      || (value.outputBytesCap as number) < 0 || (value.outputBytesCap as number) > 4 * 1024 * 1024)) {
      throw new Error("LOCAL_APP_SERVER_COMMAND_OUTPUT_CAP_INVALID");
    }
  }
  if (method === "config/read" && "cwd" in value
    && (typeof value.cwd !== "string" || !isAbsolute(value.cwd)
      || (workspaceRoot && !pathIsWithin(workspaceRoot, value.cwd)))) {
    throw new Error("LOCAL_APP_SERVER_CONFIG_CWD_BLOCKED");
  }
}

function pathIsWithin(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return !fromRoot || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function validateCommandEnvironment(value: unknown, commandTmpDir: string | undefined): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LOCAL_APP_SERVER_COMMAND_ENV_INVALID");
  }
  for (const [key, rawValue] of Object.entries(value as JsonObject)) {
    if (!SAFE_COMMAND_ENVIRONMENT_KEYS.has(key) || typeof rawValue !== "string"
      || !rawValue || rawValue.length > 1_024 || /[\0\r\n]/.test(rawValue)) {
      throw new Error(`LOCAL_APP_SERVER_COMMAND_ENV_BLOCKED:${key}`);
    }
    if ((key === "CI" || key === "NO_COLOR") && rawValue !== "1") {
      throw new Error(`LOCAL_APP_SERVER_COMMAND_ENV_VALUE_INVALID:${key}`);
    }
    if (key === "TRACEFORGE_ENABLE_CODEX" && rawValue !== "0") {
      throw new Error(`LOCAL_APP_SERVER_COMMAND_ENV_VALUE_INVALID:${key}`);
    }
    if (key === "TRACEFORGE_REPAIR_INPUT_DIGEST" && !/^sha256:[0-9a-f]{64}$/.test(rawValue)) {
      throw new Error(`LOCAL_APP_SERVER_COMMAND_ENV_VALUE_INVALID:${key}`);
    }
    if (key === "TRACEFORGE_HOST_HIDDEN_SCENARIO_NONCE"
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawValue)) {
      throw new Error(`LOCAL_APP_SERVER_COMMAND_ENV_VALUE_INVALID:${key}`);
    }
    if (key === "TMPDIR" && !isAbsolute(rawValue)) {
      throw new Error(`LOCAL_APP_SERVER_COMMAND_ENV_VALUE_INVALID:${key}`);
    }
    if (key === "TMPDIR" && commandTmpDir && rawValue !== commandTmpDir) {
      throw new Error(`LOCAL_APP_SERVER_COMMAND_ENV_VALUE_INVALID:${key}`);
    }
  }
}

function execFileText(
  executable: string,
  args: readonly string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      maxBuffer: 128 * 1024,
      shell: false,
      timeout: options.timeoutMs,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new AppServerProcessError(
          `LOCAL_CODEX_VERSION_CHECK_FAILED:${error.code ?? "unknown"}`,
          redactAndTruncate(String(stderr)),
        ));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export async function readCodexVersion(
  executable: string,
  options: { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<string> {
  const result = await execFileText(executable, ["--version"], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: finiteTimeout(options.timeoutMs, 5_000, "VERSION_TIMEOUT"),
  });
  const match = /\bcodex-cli\s+([^\s]+)/.exec(result.stdout);
  if (!match?.[1]) throw new Error("LOCAL_CODEX_VERSION_OUTPUT_INVALID");
  return match[1];
}

export class AppServerClient {
  readonly expectedPermissionProfile: string | undefined;
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly notificationListeners = new Set<AppServerNotificationListener>();
  private readonly terminationListeners = new Set<(error: Error) => void>();
  private readonly requestTimeoutMs: number;
  private readonly maxStderrChars: number;
  private readonly maxProtocolLineChars: number;
  private readonly workspaceRoot: string | undefined;
  private readonly commandTmpDir: string | undefined;
  private nextRequestId = 1;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private stderrWasTruncated = false;
  private fatalError: Error | null = null;
  private exited = false;
  private closePromise: Promise<void> | null = null;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    options: {
      requestTimeoutMs?: number;
      maxStderrChars?: number;
      maxProtocolLineChars?: number;
      expectedPermissionProfile?: string;
      workspaceRoot?: string;
      commandTmpDir?: string;
    } = {},
  ) {
    this.requestTimeoutMs = finiteTimeout(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "REQUEST_TIMEOUT",
    );
    this.maxStderrChars = options.maxStderrChars ?? DEFAULT_MAX_STDERR_CHARS;
    this.maxProtocolLineChars = options.maxProtocolLineChars ?? DEFAULT_MAX_PROTOCOL_LINE_CHARS;
    this.expectedPermissionProfile = options.expectedPermissionProfile;
    this.workspaceRoot = options.workspaceRoot;
    this.commandTmpDir = options.commandTmpDir;
    if (!Number.isSafeInteger(this.maxStderrChars) || this.maxStderrChars < 64) {
      throw new Error("LOCAL_APP_SERVER_STDERR_LIMIT_INVALID");
    }
    if (!Number.isSafeInteger(this.maxProtocolLineChars) || this.maxProtocolLineChars < 1024) {
      throw new Error("LOCAL_APP_SERVER_PROTOCOL_LINE_LIMIT_INVALID");
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk: string) => this.handleStderr(chunk));
    child.once("error", (error) => this.fail(
      new AppServerProcessError(`LOCAL_APP_SERVER_PROCESS_ERROR:${error.message}`, this.safeStderr()),
    ));
    child.once("exit", () => {
      this.exited = true;
    });
    // `close` fires after stdio is drained, so stderr evidence is complete.
    child.once("close", (code, signal) => {
      if (!this.fatalError) {
        this.fail(new AppServerProcessError(
          `LOCAL_APP_SERVER_EXITED:code=${code ?? "null"}:signal=${signal ?? "null"}`,
          this.safeStderr(),
        ));
      }
    });
  }

  onNotification(listener: AppServerNotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  async waitForNotification(
    predicate: string | ((notification: AppServerNotification) => boolean),
    options: { timeoutMs?: number } = {},
  ): Promise<AppServerNotification> {
    const timeoutMs = finiteTimeout(options.timeoutMs, this.requestTimeoutMs, "NOTIFICATION_TIMEOUT");
    if (this.fatalError) return Promise.reject(this.fatalError);
    return new Promise((resolve, reject) => {
      let unsubscribeNotification: () => void = () => undefined;
      let unsubscribeTermination: () => void = () => undefined;
      const cleanup = (): void => {
        clearTimeout(timer);
        unsubscribeNotification();
        unsubscribeTermination();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new AppServerTimeoutError(
          typeof predicate === "string" ? predicate : "notification",
          timeoutMs,
        ));
      }, timeoutMs);
      timer.unref();
      unsubscribeNotification = this.onNotification((notification) => {
        let matches = false;
        try {
          matches = typeof predicate === "string"
            ? notification.method === predicate
            : predicate(notification);
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (!matches) return;
        cleanup();
        resolve(notification);
      });
      unsubscribeTermination = this.onTermination((error) => {
        cleanup();
        reject(error);
      });
    });
  }

  request<T>(
    method: string,
    params?: unknown,
    options: AppServerRequestOptions = {},
  ): Promise<T> {
    validateSafeRequest(
      method,
      params,
      this.expectedPermissionProfile,
      this.workspaceRoot,
      this.commandTmpDir,
    );
    if (this.fatalError) return Promise.reject(this.fatalError);
    if (this.exited || !this.child.stdin.writable) {
      return Promise.reject(new Error("LOCAL_APP_SERVER_NOT_WRITABLE"));
    }
    const timeoutMs = finiteTimeout(options.timeoutMs, this.requestTimeoutMs, "REQUEST_TIMEOUT");
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppServerTimeoutError(method, timeoutMs));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        this.writeMessage(params === undefined ? { method, id } : { method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.fatalError || this.exited || !this.child.stdin.writable) {
      throw this.fatalError ?? new Error("LOCAL_APP_SERVER_NOT_WRITABLE");
    }
    this.writeMessage(params === undefined ? { method } : { method, params });
  }

  async readAccount(): Promise<AccountReadResult> {
    const raw = await this.request<JsonObject>("account/read", { refreshToken: false });
    const account = raw.account && typeof raw.account === "object"
      ? raw.account as JsonObject
      : null;
    return {
      account: account && typeof account.type === "string"
        ? {
          type: account.type,
          planType: typeof account.planType === "string" ? account.planType : null,
        }
        : null,
      requiresOpenaiAuth: raw.requiresOpenaiAuth !== false,
    };
  }

  async listModels(): Promise<AppServerModel[]> {
    const models: AppServerModel[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const raw: { data?: unknown; nextCursor?: unknown } = await this.request("model/list", {
        cursor,
        includeHidden: false,
        limit: 100,
      });
      if (!Array.isArray(raw.data)) throw new Error("LOCAL_APP_SERVER_MODEL_LIST_INVALID");
      for (const value of raw.data) {
        const model = objectOrEmpty(value);
        if (typeof model.id !== "string" || typeof model.model !== "string") {
          throw new Error("LOCAL_APP_SERVER_MODEL_INVALID");
        }
        models.push(model as AppServerModel);
      }
      if (raw.nextCursor == null) return models;
      if (typeof raw.nextCursor !== "string" || !raw.nextCursor || seenCursors.has(raw.nextCursor)) {
        throw new Error("LOCAL_APP_SERVER_MODEL_CURSOR_INVALID");
      }
      seenCursors.add(raw.nextCursor);
      cursor = raw.nextCursor;
    }
    throw new Error("LOCAL_APP_SERVER_MODEL_PAGINATION_LIMIT");
  }

  startLogin(params: SafeLoginParams): Promise<JsonObject> {
    return this.request<JsonObject>("account/login/start", params);
  }

  startThread(params: SafeThreadStartParams): Promise<{ thread: { id: string; [key: string]: unknown } }> {
    if (!isAbsolute(params.cwd)) throw new Error("LOCAL_APP_SERVER_THREAD_CWD_INVALID");
    if (!params.model || !params.developerInstructions) {
      throw new Error("LOCAL_APP_SERVER_THREAD_PARAMS_INVALID");
    }
    return this.request("thread/start", {
      cwd: params.cwd,
      ephemeral: true,
      model: params.model,
      approvalPolicy: "never",
      developerInstructions: params.developerInstructions,
      serviceName: params.serviceName ?? "traceforge_local_runner",
    });
  }

  startTurn(params: SafeTurnStartParams): Promise<{ turn: { id: string; [key: string]: unknown } }> {
    if (!params.threadId || !params.prompt) throw new Error("LOCAL_APP_SERVER_TURN_PARAMS_INVALID");
    return this.request("turn/start", {
      threadId: params.threadId,
      input: [{ type: "text", text: params.prompt }],
      ...(params.outputSchema === undefined ? {} : { outputSchema: params.outputSchema }),
    });
  }

  interruptTurn(threadId: string, turnId: string): Promise<Record<string, never>> {
    if (!threadId || !turnId) throw new Error("LOCAL_APP_SERVER_INTERRUPT_PARAMS_INVALID");
    return this.request("turn/interrupt", { threadId, turnId });
  }

  execCommand(params: SafeCommandExecParams): Promise<CommandExecResult> {
    if (!Array.isArray(params.command) || params.command.length === 0 || !isAbsolute(params.cwd)) {
      throw new Error("LOCAL_APP_SERVER_COMMAND_PARAMS_INVALID");
    }
    const processTimeoutMs = finiteTimeout(params.timeoutMs, 5 * 60_000, "COMMAND_TIMEOUT");
    const requestTimeoutMs = Math.min(15 * 60_000, processTimeoutMs + 10_000);
    return this.request("command/exec", {
      command: [...params.command],
      cwd: params.cwd,
      timeoutMs: processTimeoutMs,
      outputBytesCap: params.outputBytesCap ?? 2 * 1024 * 1024,
    }, { timeoutMs: requestTimeoutMs });
  }

  async close(graceMs = DEFAULT_CLOSE_GRACE_MS): Promise<void> {
    if (!Number.isSafeInteger(graceMs) || graceMs < 1 || graceMs > 10_000) {
      throw new Error("LOCAL_APP_SERVER_CLOSE_GRACE_INVALID");
    }
    this.fail(new AppServerProcessError("LOCAL_APP_SERVER_CLOSED", this.safeStderr()));
    if (this.exited) return;
    if (this.closePromise) return this.closePromise;
    this.child.stdin.end();
    this.closePromise = new Promise<void>((resolve) => {
      if (this.exited) {
        resolve();
        return;
      }
      let settled = false;
      let hardTimer: NodeJS.Timeout | undefined;
      let finalTimer: NodeJS.Timeout | undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(softTimer);
        if (hardTimer) clearTimeout(hardTimer);
        if (finalTimer) clearTimeout(finalTimer);
        resolve();
      };
      const softTimer = setTimeout(() => {
        if (this.exited) {
          finish();
          return;
        }
        this.child.kill("SIGTERM");
        hardTimer = setTimeout(() => {
          if (!this.exited) this.child.kill("SIGKILL");
          finalTimer = setTimeout(finish, graceMs);
          finalTimer.unref();
        }, graceMs);
        hardTimer.unref();
      }, graceMs);
      softTimer.unref();
      this.child.once("exit", finish);
    });
    return this.closePromise;
  }

  getSafeStderr(): string {
    return this.safeStderr();
  }

  private writeMessage(message: JsonObject): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
  }

  private handleStderr(chunk: string): void {
    if (this.stderrBuffer.length >= this.maxStderrChars) {
      this.stderrWasTruncated = true;
      return;
    }
    const remaining = this.maxStderrChars - this.stderrBuffer.length;
    this.stderrBuffer += chunk.slice(0, remaining);
    if (chunk.length > remaining) this.stderrWasTruncated = true;
  }

  private safeStderr(): string {
    const value = redactSecrets(this.stderrBuffer);
    return this.stderrWasTruncated ? `${value}\n[TRUNCATED]` : value;
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (this.stdoutBuffer.length > this.maxProtocolLineChars && !this.stdoutBuffer.includes("\n")) {
      this.fail(new Error("LOCAL_APP_SERVER_PROTOCOL_LINE_TOO_LARGE"));
      this.child.kill("SIGTERM");
      return;
    }
    for (;;) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (line.length > this.maxProtocolLineChars) {
        this.fail(new Error("LOCAL_APP_SERVER_PROTOCOL_LINE_TOO_LARGE"));
        this.child.kill("SIGTERM");
        return;
      }
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let message: JsonObject;
    try {
      const value = JSON.parse(line) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
      message = value as JsonObject;
    } catch {
      this.fail(new Error("LOCAL_APP_SERVER_PROTOCOL_JSON_INVALID"));
      this.child.kill("SIGTERM");
      return;
    }

    const hasId = typeof message.id === "number" || typeof message.id === "string";
    const hasMethod = typeof message.method === "string";
    if (hasMethod && hasId) {
      this.writeMessage({
        id: message.id as RequestId,
        error: {
          code: -32601,
          message: "Server request rejected by TraceForge Local Runner",
        },
      });
      return;
    }
    if (hasMethod) {
      const notification = { method: message.method as string, params: message.params };
      for (const listener of this.notificationListeners) {
        try {
          listener(notification);
        } catch {
          // A UI listener cannot be allowed to break the protocol transport.
        }
      }
      return;
    }
    if (!hasId) {
      this.fail(new Error("LOCAL_APP_SERVER_PROTOCOL_MESSAGE_INVALID"));
      this.child.kill("SIGTERM");
      return;
    }

    const pending = this.pending.get(message.id as RequestId);
    if (!pending) return; // Late response after a request timeout; safely ignore it.
    this.pending.delete(message.id as RequestId);
    clearTimeout(pending.timer);
    if (message.error && typeof message.error === "object") {
      const error = message.error as JsonObject;
      pending.reject(new AppServerRpcError(
        pending.method,
        typeof error.code === "number" ? error.code : -32000,
        typeof error.message === "string" ? error.message : "Unknown app-server error",
      ));
      return;
    }
    if (!("result" in message)) {
      pending.reject(new Error(`LOCAL_APP_SERVER_RESULT_MISSING:${pending.method}`));
      return;
    }
    pending.resolve(message.result);
  }

  private fail(error: Error): void {
    if (!this.fatalError) this.fatalError = error;
    for (const listener of this.terminationListeners) {
      try {
        listener(this.fatalError);
      } catch {
        // A waiter cannot be allowed to break transport shutdown.
      }
    }
    this.terminationListeners.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.fatalError);
    }
    this.pending.clear();
  }

  private onTermination(listener: (error: Error) => void): () => void {
    if (this.fatalError) {
      try {
        listener(this.fatalError);
      } catch {
        // Match notification listener isolation during transport shutdown.
      }
      return () => undefined;
    }
    this.terminationListeners.add(listener);
    return () => this.terminationListeners.delete(listener);
  }
}

function waitForSpawn(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  if (child.pid != null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new AppServerTimeoutError("process/spawn", timeoutMs));
    }, timeoutMs);
    timer.unref();
    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("spawn", onSpawn);
      child.off("error", onError);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

export async function spawnAppServer(options: SpawnAppServerOptions): Promise<AppServerClient> {
  if (!options.executable || options.executable.includes("\0") || options.args.length === 0) {
    throw new Error("LOCAL_APP_SERVER_SPAWN_OPTIONS_INVALID");
  }
  const initializeTimeoutMs = finiteTimeout(
    options.initializeTimeoutMs,
    DEFAULT_INITIALIZE_TIMEOUT_MS,
    "INITIALIZE_TIMEOUT",
  );
  const requiredVersion = options.verifyVersion === undefined
    ? VERIFIED_CODEX_VERSION
    : options.verifyVersion;
  if (requiredVersion !== false) {
    const actualVersion = await readCodexVersion(options.executable, {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: Math.min(initializeTimeoutMs, 5_000),
    });
    if (actualVersion !== requiredVersion) {
      throw new Error(`LOCAL_CODEX_VERSION_UNSUPPORTED:expected=${requiredVersion}:actual=${actualVersion}`);
    }
  }

  const child = spawn(options.executable, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const client = new AppServerClient(child, {
    requestTimeoutMs: options.requestTimeoutMs,
    maxStderrChars: options.maxStderrChars,
    maxProtocolLineChars: options.maxProtocolLineChars,
    expectedPermissionProfile: options.expectedPermissionProfile,
    workspaceRoot: options.workspaceRoot,
    commandTmpDir: typeof options.env.TMPDIR === "string" ? options.env.TMPDIR : undefined,
  });
  try {
    await waitForSpawn(child, initializeTimeoutMs);
    await client.request("initialize", {
      clientInfo: options.clientInfo ?? {
        name: "traceforge_local_runner",
        title: "TraceForge Local Runner",
        version: "0.1.7",
      },
    }, { timeoutMs: initializeTimeoutMs });
    client.notify("initialized", {});
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}
