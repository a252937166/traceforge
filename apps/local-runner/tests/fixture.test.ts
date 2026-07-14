import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  assertDedicatedCodexHome,
  cleanupLocalFixture,
  prepareLocalFixture,
  verifyCheckedOutReleaseCommit,
} from "../src/fixture.js";
import { LOCAL_RUNNER_MANIFEST } from "../src/manifest.js";
import {
  createReleaseTaggedCheckout,
  gitOutput,
} from "./release-checkout.js";

const execFileAsync = promisify(execFile);

async function checkedOutCommit(start = process.cwd()): Promise<string> {
  return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: start })).stdout.trim();
}

test("fixture pins recorded inputs and physically separates writer from verifier", async (t) => {
  const durableRoot = await mkdtemp(join(tmpdir(), "traceforge-codex-home-test-"));
  const previous = process.env.TRACEFORGE_LOCAL_CODEX_HOME;
  process.env.TRACEFORGE_LOCAL_CODEX_HOME = join(durableRoot, "codex-home");
  t.after(async () => {
    if (previous === undefined) delete process.env.TRACEFORGE_LOCAL_CODEX_HOME;
    else process.env.TRACEFORGE_LOCAL_CODEX_HOME = previous;
    await rm(durableRoot, { recursive: true, force: true });
  });

  const { repoRoot, releaseCommit } = await createReleaseTaggedCheckout(t);
  const fixture = await prepareLocalFixture(repoRoot, releaseCommit);
  t.after(() => cleanupLocalFixture(fixture));
  assert.equal(fixture.releaseCommit, releaseCommit);
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

test("release provenance binds the declared full SHA, checkout, and peeled release tag", async (t) => {
  const { repoRoot, releaseCommit } = await createReleaseTaggedCheckout(t);
  assert.equal(
    await verifyCheckedOutReleaseCommit(repoRoot, releaseCommit),
    releaseCommit,
  );
  await assert.rejects(
    verifyCheckedOutReleaseCommit(repoRoot, undefined),
    /LOCAL_RELEASE_SHA_REQUIRED/,
  );
  await assert.rejects(
    verifyCheckedOutReleaseCommit(repoRoot, "deadbeef"),
    /LOCAL_RELEASE_SHA_INVALID/,
  );
  await assert.rejects(
    verifyCheckedOutReleaseCommit(repoRoot, "0".repeat(40)),
    /LOCAL_RELEASE_SHA_MISMATCH/,
  );

  await gitOutput(repoRoot, [
    "-c", "user.name=TraceForge Tests",
    "-c", "user.email=tests@traceforge.invalid",
    "commit", "--allow-empty", "--message", "move checkout without moving release tag",
  ]);
  const movedCheckout = await checkedOutCommit(repoRoot);
  await assert.rejects(
    verifyCheckedOutReleaseCommit(repoRoot, movedCheckout),
    /LOCAL_RELEASE_TAG_COMMIT_MISMATCH/,
  );
  await gitOutput(repoRoot, ["tag", "--delete", "local-runner-v0.1.10"]);
  await assert.rejects(
    verifyCheckedOutReleaseCommit(repoRoot, movedCheckout),
    /LOCAL_RELEASE_TAG_UNRESOLVED/,
  );
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
