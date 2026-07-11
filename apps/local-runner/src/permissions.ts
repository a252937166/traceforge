import * as TOML from "@iarna/toml";
import { randomUUID } from "node:crypto";
import { access, chmod, lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

export const TRACEFORGE_BUILD_PROFILE_ID = "traceforge-build" as const;
export const TRACEFORGE_VERIFY_PROFILE_ID = "traceforge-verify" as const;

export const DISABLED_CODEX_FEATURES = Object.freeze([
  "apps",
  "plugins",
  "remote_plugin",
  "hooks",
  "computer_use",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "in_app_browser",
  "multi_agent",
  "memories",
  "chronicle",
  "image_generation",
  "skill_mcp_dependency_install",
] as const);

const PROFILE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const GLOB_OR_CONTROL = /[\0\r\n*?\[\]]/;
const BASE_TOOL_DIRECTORIES = [...new Set([
  dirname(process.execPath),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
])];
const TRANSPORT_ENVIRONMENT_KEYS = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
]);

export interface CodexPermissionConfigOptions {
  /** Persistent, Runner-owned CODEX_HOME. Its credential files are never read by this module. */
  codexHome: string;
  /** Canonical temporary workspace exposed to sandboxed commands. */
  workspaceRoot: string;
  /** Per-session HOME exposed to commands, never the user's real HOME. */
  sessionHome: string;
  /** Per-session TMPDIR exposed to commands. */
  sessionTmp: string;
  /** Relative paths under workspaceRoot that commands may modify. */
  writablePaths: readonly string[];
  /** Explicit non-workspace paths needed by trusted tools, for example an offline pnpm store. */
  additionalReadRoots?: readonly string[];
  profileId?: string;
  description?: string;
  toolPath?: string;
  locale?: string;
  credentialStore?: "auto" | "file" | "keyring";
  /** Explicit non-secret proxy/certificate settings for the app-server process itself. */
  transportEnvironment?: Readonly<Record<string, string>>;
}

export interface CodexPermissionConfig {
  codexHome: string;
  configPath: string;
  workspaceRoot: string;
  sessionHome: string;
  sessionTmp: string;
  profileId: string;
  writablePaths: string[];
  additionalReadRoots: string[];
  toolPath: string;
  locale: string;
  transportEnvironment: Readonly<Record<string, string>>;
}

function assertPlainValue(value: string, label: string): void {
  if (!value || /[\0\r\n]/.test(value)) throw new Error(`LOCAL_PERMISSION_${label}_INVALID`);
}

function validateProfileId(value: string): string {
  if (!PROFILE_ID.test(value)) throw new Error("LOCAL_PERMISSION_PROFILE_ID_INVALID");
  return value;
}

function validateWritablePath(workspaceRoot: string, value: string): string {
  assertPlainValue(value, "WRITE_PATH");
  if (isAbsolute(value) || value === "." || GLOB_OR_CONTROL.test(value)) {
    throw new Error(`LOCAL_PERMISSION_WRITE_PATH_INVALID:${value}`);
  }
  const target = resolve(workspaceRoot, value);
  const fromRoot = relative(workspaceRoot, target);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`LOCAL_PERMISSION_WRITE_PATH_OUTSIDE_ROOT:${value}`);
  }
  return value;
}

async function canonicalDirectory(path: string, label: string): Promise<string> {
  const canonical = await realpath(path).catch(() => {
    throw new Error(`LOCAL_PERMISSION_${label}_MISSING`);
  });
  const stats = await lstat(canonical);
  if (!stats.isDirectory()) throw new Error(`LOCAL_PERMISSION_${label}_NOT_DIRECTORY`);
  return canonical;
}

async function firstExecutable(
  name: string,
  searchDirectories: readonly string[],
): Promise<{ directory: string; realExecutable: string } | null> {
  for (const directory of searchDirectories) {
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = resolve(directory, name);
    if (await access(candidate, fsConstants.X_OK).then(() => true).catch(() => false)) {
      return {
        directory: await realpath(directory).catch(() => directory),
        realExecutable: await realpath(candidate).catch(() => candidate),
      };
    }
  }
  return null;
}

function packageRootNamed(path: string, name: string): string | null {
  let cursor = dirname(path);
  for (;;) {
    if (basename(cursor) === name) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

async function resolveToolchain(toolPath: string | undefined): Promise<{
  directories: string[];
  readRoots: string[];
  corepackHome: string | null;
}> {
  const searchDirectories = toolPath === undefined
    ? (process.env.PATH ?? "").split(delimiter)
    : toolPath.split(delimiter);
  if (toolPath !== undefined) {
    assertPlainValue(toolPath, "TOOL_PATH");
    const configured = [...new Set(searchDirectories)];
    if (configured.some((path) => !path || !isAbsolute(path))) {
      throw new Error("LOCAL_PERMISSION_TOOL_PATH_INVALID");
    }
  }
  const discoveredTools = await Promise.all([
    firstExecutable("pnpm", searchDirectories),
    firstExecutable("corepack", searchDirectories),
  ]);
  const discovered = discoveredTools.map((tool) => tool?.directory ?? null);
  // Keep the Runner's own Node first. Trusted-host dependency installation runs
  // under this architecture, so verifier `#!/usr/bin/env node` commands must use
  // the same binary (not a different nvm/Homebrew architecture).
  const candidates = toolPath === undefined
    ? [...new Set([
      dirname(process.execPath),
      ...discovered.filter((path): path is string => Boolean(path)),
      ...BASE_TOOL_DIRECTORIES,
    ])]
    : [...new Set(searchDirectories)];
  const existing: string[] = [];
  for (const path of candidates) {
    const canonical = await canonicalDirectory(path, "TOOL_PATH").catch(() => null);
    if (canonical) existing.push(canonical);
  }
  if (existing.length === 0) throw new Error("LOCAL_PERMISSION_TOOL_PATH_EMPTY");
  const packageRoots = discoveredTools
    .map((tool) => tool ? packageRootNamed(tool.realExecutable, "corepack") : null)
    .filter((path): path is string => Boolean(path));
  const corepackHomeCandidate = resolve(homedir(), ".cache", "node", "corepack");
  const corepackHome = await canonicalDirectory(corepackHomeCandidate, "COREPACK_HOME").catch(() => null);
  const runtimeLibraryRoots = [];
  for (const candidate of [
    "/usr/local/opt",
    "/usr/local/Cellar",
    "/opt/homebrew/opt",
    "/opt/homebrew/Cellar",
  ]) {
    const canonical = await canonicalDirectory(candidate, "RUNTIME_LIBRARY_ROOT").catch(() => null);
    if (canonical) runtimeLibraryRoots.push(canonical);
  }
  return {
    directories: [...new Set(existing)],
    readRoots: [...new Set([...packageRoots, ...runtimeLibraryRoots])],
    corepackHome,
  };
}

async function validateWritableTarget(workspaceRoot: string, path: string): Promise<void> {
  const target = resolve(workspaceRoot, path);
  const stats = await lstat(target).catch(() => {
    throw new Error(`LOCAL_PERMISSION_WRITE_TARGET_MISSING:${path}`);
  });
  if (stats.isSymbolicLink()) throw new Error(`LOCAL_PERMISSION_WRITE_TARGET_SYMLINK:${path}`);
  const canonical = await realpath(target);
  const fromRoot = relative(workspaceRoot, canonical);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`LOCAL_PERMISSION_WRITE_TARGET_OUTSIDE_ROOT:${path}`);
  }
}

function isWithin(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return !fromRoot || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

function validateTransportEnvironment(
  input: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (!input) return Object.freeze({});
  const output: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(input)) {
    const key = rawKey.toUpperCase();
    if (!TRANSPORT_ENVIRONMENT_KEYS.has(key)) {
      throw new Error(`LOCAL_PERMISSION_TRANSPORT_ENV_KEY_BLOCKED:${rawKey}`);
    }
    assertPlainValue(value, `TRANSPORT_ENV_${key}`);
    if (key !== "NO_PROXY" && key.endsWith("_PROXY")) {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        throw new Error(`LOCAL_PERMISSION_TRANSPORT_PROXY_BLOCKED:${key}`);
      }
      const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
        || parsed.hostname === "[::1]" || parsed.hostname === "::1";
      if (!loopback || parsed.username || parsed.password || !["http:", "https:", "socks5:"].includes(parsed.protocol)) {
        throw new Error(`LOCAL_PERMISSION_TRANSPORT_PROXY_BLOCKED:${key}`);
      }
    }
    output[key] = value;
  }
  return Object.freeze(output);
}

function permissionConfigDocument(options: {
  profileId: string;
  workspaceRoot: string;
  sessionHome: string;
  sessionTmp: string;
  writablePaths: readonly string[];
  additionalReadRoots: readonly string[];
  description: string;
  toolPath: string;
  locale: string;
  corepackHome: string | null;
  credentialStore: "auto" | "file" | "keyring";
}): TOML.JsonMap {
  const workspaceRules: TOML.JsonMap = { ".": "read" };
  for (const path of options.writablePaths) workspaceRules[path] = "write";
  const filesystem: TOML.JsonMap = {
    ":root": "deny",
    ":minimal": "read",
    ":workspace_roots": workspaceRules,
    [options.sessionHome]: "write",
    [options.sessionTmp]: "write",
  };
  for (const path of options.additionalReadRoots) filesystem[path] = "read";

  return {
    cli_auth_credentials_store: options.credentialStore,
    allow_login_shell: false,
    check_for_update_on_startup: false,
    default_permissions: options.profileId,
    approval_policy: "never",
    approvals_reviewer: "user",
    analytics: { enabled: false },
    history: { persistence: "none" },
    shell_environment_policy: {
      inherit: "none",
      ignore_default_excludes: false,
      set: {
        PATH: options.toolPath,
        HOME: options.sessionHome,
        TMPDIR: options.sessionTmp,
        LANG: options.locale,
        LC_ALL: options.locale,
        // Sandboxed Node must not probe the host's OpenSSL config. Verification is offline.
        OPENSSL_CONF: "/dev/null",
        ...(options.corepackHome ? { COREPACK_HOME: options.corepackHome } : {}),
      },
    },
    permissions: {
      [options.profileId]: {
        description: options.description,
        workspace_roots: { [options.workspaceRoot]: true },
        filesystem,
        network: { enabled: false },
      },
    },
  };
}

/**
 * Atomically installs a least-privilege config in the Runner-owned CODEX_HOME.
 * This function deliberately never opens, copies, or inspects auth.json.
 */
export async function writeCodexPermissionConfig(
  options: CodexPermissionConfigOptions,
): Promise<CodexPermissionConfig> {
  const profileId = validateProfileId(options.profileId ?? TRACEFORGE_BUILD_PROFILE_ID);
  assertPlainValue(options.locale ?? "C.UTF-8", "LOCALE");
  const transportEnvironment = validateTransportEnvironment(options.transportEnvironment);
  const toolchain = await resolveToolchain(options.toolPath);
  const toolDirectories = toolchain.directories;

  await mkdir(options.codexHome, { recursive: true, mode: 0o700 });
  const [codexHome, workspaceRoot, sessionHome, sessionTmp] = await Promise.all([
    canonicalDirectory(options.codexHome, "CODEX_HOME"),
    canonicalDirectory(options.workspaceRoot, "WORKSPACE_ROOT"),
    canonicalDirectory(options.sessionHome, "SESSION_HOME"),
    canonicalDirectory(options.sessionTmp, "SESSION_TMP"),
  ]);
  await chmod(codexHome, 0o700);

  const writablePaths = [...new Set(options.writablePaths.map((path) =>
    validateWritablePath(workspaceRoot, path)
  ))].sort();
  await Promise.all(writablePaths.map((path) => validateWritableTarget(workspaceRoot, path)));

  const additionalReadRoots = [...new Set([
    ...toolDirectories,
    ...toolchain.readRoots,
    ...(toolchain.corepackHome ? [toolchain.corepackHome] : []),
    ...await Promise.all(
      (options.additionalReadRoots ?? []).map((path) => canonicalDirectory(path, "READ_ROOT")),
    ),
  ])].sort();
  for (const path of additionalReadRoots) {
    if (path === sep || isWithin(path, codexHome) || isWithin(codexHome, path)) {
      throw new Error(`LOCAL_PERMISSION_READ_ROOT_BLOCKED:${path}`);
    }
  }

  const toolPath = toolDirectories.join(delimiter);
  const locale = options.locale ?? "C.UTF-8";
  const document = permissionConfigDocument({
    profileId,
    workspaceRoot,
    sessionHome,
    sessionTmp,
    writablePaths,
    additionalReadRoots,
    description: options.description ?? "TraceForge signed fixture with bounded writes",
    toolPath,
    locale,
    corepackHome: toolchain.corepackHome,
    credentialStore: options.credentialStore ?? "auto",
  });
  const configPath = resolve(codexHome, "config.toml");
  const temporaryPath = resolve(codexHome, `.config.toml.${process.pid}.${randomUUID()}`);
  try {
    await writeFile(temporaryPath, TOML.stringify(document), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, configPath);
    await chmod(configPath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }

  return {
    codexHome,
    configPath,
    workspaceRoot,
    sessionHome,
    sessionTmp,
    profileId,
    writablePaths,
    additionalReadRoots,
    toolPath,
    locale,
    transportEnvironment,
  };
}

export function buildHardenedAppServerArgs(): string[] {
  return [
    "app-server",
    "--stdio",
    "--strict-config",
    ...DISABLED_CODEX_FEATURES.flatMap((feature) => ["--disable", feature]),
  ];
}

/** Only explicit, non-secret values cross into the app-server process. */
export function buildHardenedAppServerEnvironment(
  config: CodexPermissionConfig,
): NodeJS.ProcessEnv {
  return {
    CODEX_HOME: config.codexHome,
    PATH: config.toolPath,
    HOME: config.sessionHome,
    TMPDIR: config.sessionTmp,
    LANG: config.locale,
    LC_ALL: config.locale,
    NO_COLOR: "1",
    ...config.transportEnvironment,
  };
}
