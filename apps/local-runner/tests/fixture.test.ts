import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertDedicatedCodexHome,
  cleanupLocalFixture,
  prepareLocalFixture,
} from "../src/fixture.js";
import { LOCAL_RUNNER_MANIFEST } from "../src/manifest.js";

test("fixture pins recorded inputs and physically separates writer from verifier", async (t) => {
  const durableRoot = await mkdtemp(join(tmpdir(), "traceforge-codex-home-test-"));
  const previous = process.env.TRACEFORGE_LOCAL_CODEX_HOME;
  process.env.TRACEFORGE_LOCAL_CODEX_HOME = join(durableRoot, "codex-home");
  t.after(async () => {
    if (previous === undefined) delete process.env.TRACEFORGE_LOCAL_CODEX_HOME;
    else process.env.TRACEFORGE_LOCAL_CODEX_HOME = previous;
    await rm(durableRoot, { recursive: true, force: true });
  });

  const fixture = await prepareLocalFixture();
  t.after(() => cleanupLocalFixture(fixture));
  assert.equal(fixture.inputEvidence.digest, LOCAL_RUNNER_MANIFEST.repairInputDigest);
  assert.notEqual(fixture.writerRoot, fixture.verifierRoot);
  assert.notEqual(fixture.buildHome, fixture.verifyHome);
  assert.notEqual(fixture.buildTmp, fixture.verifyTmp);
  await access(join(fixture.writerRoot, ".traceforge", "behavior-contract.json"));
  await assert.rejects(
    access(join(fixture.writerRoot, "apps", "api", "src", "legacy-return-workflow.ts")),
  );
  await access(join(fixture.verifierRoot, "apps", "api", "tests", "champion-workflow.test.ts"));
});

test("dedicated Codex home rejects protected roots, parents, and descendants", () => {
  const roots = {
    repoRoot: "/safe/home/project/traceforge",
    sessionRoot: "/private/tmp/traceforge-local-1",
    globalCodexHome: "/safe/home/.codex",
  };
  for (const codexHome of [
    roots.repoRoot,
    "/safe/home/project",
    `${roots.repoRoot}/nested`,
    roots.sessionRoot,
    "/private/tmp",
    `${roots.sessionRoot}/nested`,
    roots.globalCodexHome,
    "/safe/home",
    `${roots.globalCodexHome}/nested`,
  ]) {
    assert.throws(
      () => assertDedicatedCodexHome({ ...roots, codexHome }),
      /LOCAL_CODEX_HOME_MUST_BE_DEDICATED/,
      codexHome,
    );
  }
  assert.doesNotThrow(() => assertDedicatedCodexHome({
    ...roots,
    codexHome: "/safe/home/.traceforge/local-runner/codex-home",
  }));
});
