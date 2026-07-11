import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export type BrowserUrlPurpose = "openai-auth" | "local-ui";
export type SupportedBrowserPlatform = "darwin" | "linux" | "win32";

export interface BrowserCommand {
  command: string;
  args: string[];
}

export interface OpenBrowserOptions {
  purpose: BrowserUrlPurpose;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  /** Test seam; production uses node:child_process.spawn with shell:false. */
  spawnImplementation?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
}

function openAiOwnedHost(hostname: string): boolean {
  return hostname === "openai.com" || hostname.endsWith(".openai.com")
    || hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com");
}

function loopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1"
    || hostname === "[::1]" || hostname === "::1";
}

export function validateBrowserUrl(value: string, purpose: BrowserUrlPurpose): URL {
  if (!value || value.length > 8_192 || /[\0\r\n]/.test(value)) {
    throw new Error("LOCAL_BROWSER_URL_INVALID");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("LOCAL_BROWSER_URL_INVALID");
  }
  if (url.username || url.password) throw new Error("LOCAL_BROWSER_CREDENTIALS_BLOCKED");
  if (purpose === "openai-auth") {
    if (url.protocol !== "https:" || !openAiOwnedHost(url.hostname)) {
      throw new Error("LOCAL_BROWSER_AUTH_ORIGIN_BLOCKED");
    }
  } else if (!loopbackHost(url.hostname) || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("LOCAL_BROWSER_LOCAL_ORIGIN_BLOCKED");
  }
  return url;
}

export function browserCommandForPlatform(
  url: URL,
  platform: NodeJS.Platform = process.platform,
): BrowserCommand {
  if (platform === "darwin") return { command: "open", args: [url.href] };
  if (platform === "linux") return { command: "xdg-open", args: [url.href] };
  if (platform === "win32") {
    // Avoid cmd.exe/start so URL metacharacters never cross a command interpreter.
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url.href],
    };
  }
  throw new Error(`LOCAL_BROWSER_PLATFORM_UNSUPPORTED:${platform}`);
}

export async function openBrowser(value: string, options: OpenBrowserOptions): Promise<void> {
  const url = validateBrowserUrl(value, options.purpose);
  const command = browserCommandForPlatform(url, options.platform ?? process.platform);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("LOCAL_BROWSER_TIMEOUT_INVALID");
  }
  const spawnBrowser = options.spawnImplementation ?? spawn;
  await new Promise<void>((resolve, reject) => {
    const child = spawnBrowser(command.command, command.args, {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      cleanup();
      child.kill("SIGTERM");
      reject(new Error("LOCAL_BROWSER_OPEN_TIMEOUT"));
    }, timeoutMs);
    timer.unref();
    const onSpawn = () => {
      cleanup();
      child.unref();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new Error(`LOCAL_BROWSER_OPEN_FAILED:${error.message}`));
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

export function openOpenAiLogin(url: string): Promise<void> {
  return openBrowser(url, { purpose: "openai-auth" });
}

export function openLocalRunnerPage(url: string): Promise<void> {
  return openBrowser(url, { purpose: "local-ui" });
}
