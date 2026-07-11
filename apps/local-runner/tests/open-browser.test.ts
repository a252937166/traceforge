import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import {
  browserCommandForPlatform,
  openBrowser,
  shouldOpenLocalRunnerPage,
  validateBrowserUrl,
} from "../src/open-browser.js";

test("allows only OpenAI HTTPS login URLs and loopback local UI URLs", () => {
  assert.equal(validateBrowserUrl("https://auth.openai.com/codex/device", "openai-auth").hostname, "auth.openai.com");
  assert.equal(validateBrowserUrl("https://chatgpt.com/auth/login", "openai-auth").hostname, "chatgpt.com");
  assert.equal(validateBrowserUrl("http://127.0.0.1:43123/session/local", "local-ui").port, "43123");
  assert.throws(() => validateBrowserUrl("http://auth.openai.com/login", "openai-auth"), /AUTH_ORIGIN_BLOCKED/);
  assert.throws(() => validateBrowserUrl("https://openai.com.evil.test/login", "openai-auth"), /AUTH_ORIGIN_BLOCKED/);
  assert.throws(() => validateBrowserUrl("http://example.com/local", "local-ui"), /LOCAL_ORIGIN_BLOCKED/);
  assert.throws(() => validateBrowserUrl("file:///etc/passwd", "local-ui"), /LOCAL_ORIGIN_BLOCKED/);
});

test("uses direct platform launchers instead of a shell", () => {
  const url = new URL("https://auth.openai.com/codex/device?code=A%26B");
  assert.deepEqual(browserCommandForPlatform(url, "darwin"), { command: "open", args: [url.href] });
  assert.deepEqual(browserCommandForPlatform(url, "linux"), { command: "xdg-open", args: [url.href] });
  assert.deepEqual(browserCommandForPlatform(url, "win32"), {
    command: "rundll32.exe",
    args: ["url.dll,FileProtocolHandler", url.href],
  });
});

test("openBrowser always spawns with shell:false", async () => {
  let received: { command: string; args: readonly string[]; options: SpawnOptions } | undefined;
  const child = new EventEmitter() as ChildProcess;
  child.unref = () => child;
  child.kill = () => true;
  const promise = openBrowser("https://auth.openai.com/codex/device", {
    purpose: "openai-auth",
    platform: "darwin",
    spawnImplementation: (command, args, options) => {
      received = { command, args, options };
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  await promise;
  assert.equal(received?.command, "open");
  assert.equal(received?.options.shell, false);
  assert.deepEqual(received?.args, ["https://auth.openai.com/codex/device"]);
});

test("automatic Local Runner browser opening is disabled only by the exact capture flag", () => {
  assert.equal(shouldOpenLocalRunnerPage({}), true);
  assert.equal(shouldOpenLocalRunnerPage({ TRACEFORGE_LOCAL_NO_BROWSER: "1" }), false);
  assert.equal(shouldOpenLocalRunnerPage({ TRACEFORGE_LOCAL_NO_BROWSER: "true" }), true);
  assert.equal(shouldOpenLocalRunnerPage({ TRACEFORGE_LOCAL_NO_BROWSER: "01" }), true);
});
