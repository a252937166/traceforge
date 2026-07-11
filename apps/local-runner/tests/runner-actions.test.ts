import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { resolveLocalCodexExecutable } from "../src/runner-actions.js";

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
