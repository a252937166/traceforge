import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readReleaseIdentity } from "../src/release.js";

const packagedRelease = {
  sha: "a".repeat(40),
  version: "local-runner-v0.1.7",
  builtAt: "2026-07-11T14:30:00.000Z",
};

test("release identity can be supplied explicitly by the runtime environment", () => {
  assert.deepEqual(readReleaseIdentity({
    TRACEFORGE_RELEASE_SHA: packagedRelease.sha,
    TRACEFORGE_RELEASE_VERSION: packagedRelease.version,
    TRACEFORGE_RELEASE_BUILT_AT: packagedRelease.builtAt,
  }), packagedRelease);
});

test("packaged release identity is read beside the compiled dist directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "traceforge-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const moduleDirectory = join(root, "dist");
  await mkdir(moduleDirectory);
  await writeFile(join(root, "release.json"), `${JSON.stringify(packagedRelease)}\n`, "utf8");

  assert.deepEqual(readReleaseIdentity({}, moduleDirectory), packagedRelease);
});

test("production refuses to start without a valid packaged release identity", () => {
  assert.throws(
    () => readReleaseIdentity({ NODE_ENV: "production" }, join(tmpdir(), "traceforge-release-missing", "dist")),
    /TRACEFORGE_RELEASE_IDENTITY_MISSING/,
  );
});

test("source development can run without claiming a packaged release", () => {
  assert.equal(readReleaseIdentity({}, join(tmpdir(), "traceforge-release-missing", "dist")), undefined);
});
