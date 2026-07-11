import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cleanupLocalFixture, prepareLocalFixture } from "../src/fixture.js";
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
  await access(join(fixture.writerRoot, ".traceforge", "behavior-contract.json"));
  await assert.rejects(
    access(join(fixture.writerRoot, "apps", "api", "src", "legacy-return-workflow.ts")),
  );
  await access(join(fixture.verifierRoot, "apps", "api", "tests", "champion-workflow.test.ts"));
});

