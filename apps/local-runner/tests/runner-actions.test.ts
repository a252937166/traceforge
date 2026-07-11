import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import {
  acquireDedicatedCodexHomeLock,
  inspectFreshLocalAccount,
  resolveLocalCodexExecutable,
} from "../src/runner-actions.js";

test("preflight forces an account refresh and checks rate limits before model discovery", async () => {
  let accountOptions: unknown;
  const calls: string[] = [];
  const status = await inspectFreshLocalAccount({
    async readAccount(options) {
      calls.push("account");
      accountOptions = options;
      return {
        account: { type: "chatgpt", planType: "plus" },
        requiresOpenaiAuth: true,
      };
    },
    async readRateLimits() {
      calls.push("limits");
      return { primaryUsedPercent: 12, rateLimitReached: false };
    },
    async listModels() {
      calls.push("models");
      return [{ id: "gpt-5.6-sol", model: "gpt-5.6-sol" }];
    },
  });

  assert.deepEqual(accountOptions, { refreshToken: true });
  assert.deepEqual(calls, ["account", "limits", "models"]);
  assert.deepEqual(status, {
    signedIn: true,
    modelAvailable: true,
    accountLabel: "ChatGPT plus",
  });
});

test("preflight fails early with a fixed usage code and never discovers models", async () => {
  let listedModels = false;
  await assert.rejects(
    inspectFreshLocalAccount({
      async readAccount() {
        return {
          account: { type: "chatgpt", planType: "plus" },
          requiresOpenaiAuth: true,
        };
      },
      async readRateLimits() {
        return { primaryUsedPercent: 100, rateLimitReached: true };
      },
      async listModels() {
        listedModels = true;
        return [];
      },
    }),
    (error: unknown) => {
      assert.equal(error instanceof Error ? error.message : "", "LOCAL_CODEX_USAGE_LIMIT");
      return true;
    },
  );
  assert.equal(listedModels, false);
});

test("preflight does not infer exhaustion from usedPercent without a server reached state", async () => {
  const status = await inspectFreshLocalAccount({
    async readAccount() {
      return {
        account: { type: "chatgpt", planType: "plus" },
        requiresOpenaiAuth: true,
      };
    },
    async readRateLimits() {
      return { primaryUsedPercent: 100, rateLimitReached: false };
    },
    async listModels() {
      return [{ id: "gpt-5.6-sol", model: "gpt-5.6-sol" }];
    },
  });

  assert.equal(status.signedIn, true);
  assert.equal(status.modelAvailable, true);
});

test("resolves Codex from the caller PATH before the hardened command PATH is built", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "traceforge-codex-resolution-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = join(root, "first");
  const second = join(root, "second");
  await Promise.all([mkdir(first), mkdir(second)]);
  const name = process.platform === "win32" ? "codex.CMD" : "codex";
  const selected = join(first, name);
  const fallback = join(second, name);
  await Promise.all([
    writeFile(selected, "#!/bin/sh\nexit 0\n"),
    writeFile(fallback, "#!/bin/sh\nexit 0\n"),
  ]);
  if (process.platform !== "win32") {
    await Promise.all([chmod(selected, 0o700), chmod(fallback, 0o700)]);
  }

  const resolved = await resolveLocalCodexExecutable("codex", {
    PATH: `${first}${delimiter}${second}`,
    PATHEXT: ".CMD;.EXE",
  });
  assert.equal(resolved, selected);
});

test("rejects unresolved or relative-path Codex overrides", async () => {
  await assert.rejects(
    resolveLocalCodexExecutable("missing-codex", { PATH: "/usr/bin:/bin" }),
    /LOCAL_CODEX_EXECUTABLE_NOT_FOUND/,
  );
  await assert.rejects(
    resolveLocalCodexExecutable("./codex", { PATH: "/usr/bin:/bin" }),
    /LOCAL_CODEX_EXECUTABLE_MUST_BE_ABSOLUTE/,
  );
});

test("exclusively locks the persistent Codex home and releases it idempotently", async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), "traceforge-codex-lock-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));

  const first = await acquireDedicatedCodexHomeLock(codexHome);
  assert.equal(await readFile(first.path, "utf8"), `${process.pid}\n`);
  if (process.platform !== "win32") {
    assert.equal((await stat(first.path)).mode & 0o777, 0o600);
  }
  await assert.rejects(
    acquireDedicatedCodexHomeLock(codexHome),
    /LOCAL_CODEX_HOME_IN_USE/,
  );

  await first.release();
  await first.release();
  const second = await acquireDedicatedCodexHomeLock(codexHome);
  await second.release();
});

test("removes one stale PID lock before acquiring the persistent Codex home", async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), "traceforge-stale-codex-lock-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const lockPath = join(codexHome, ".traceforge-runner.lock");
  await writeFile(lockPath, "2147483647\n", { mode: 0o600 });

  const lock = await acquireDedicatedCodexHomeLock(codexHome);
  assert.equal(await readFile(lock.path, "utf8"), `${process.pid}\n`);
  await lock.release();
});
