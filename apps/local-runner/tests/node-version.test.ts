import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  assertSupportedNodeVersion,
  isSupportedNodeVersion,
} = require("../../../scripts/check-node-version.cjs") as {
  assertSupportedNodeVersion(version?: string): void;
  isSupportedNodeVersion(version: string): boolean;
};

test("Node 22.12 is rejected before Local Runner startup", () => {
  assert.equal(isSupportedNodeVersion("22.12.0"), false);
  assert.throws(
    () => assertSupportedNodeVersion("22.12.0"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code?: string }).code, "TRACEFORGE_NODE_VERSION_UNSUPPORTED");
      assert.equal((error as Error & { exitCode?: number }).exitCode, 64);
      assert.match(error.message, /requires Node\.js >=22\.13\.0; found 22\.12\.0/);
      assert.match(error.message, /Install Node\.js 22\.23\.1/);
      assert.match(error.message, /No dependencies or Local Runner work were started/);
      return true;
    },
  );
});

test("the minimum and CI-pinned Node releases pass the gate", () => {
  assert.doesNotThrow(() => assertSupportedNodeVersion("22.13.0"));
  assert.doesNotThrow(() => assertSupportedNodeVersion("22.23.1"));
  assert.equal(isSupportedNodeVersion("23.0.0"), true);
});

test("release metadata keeps engines, install gate, nvm, and CI aligned", async () => {
  const root = resolve(import.meta.dirname, "../../..");
  const [rootPackageText, runnerPackageText, nvmVersion, workflow] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8"),
    readFile(resolve(root, "apps/local-runner/package.json"), "utf8"),
    readFile(resolve(root, ".nvmrc"), "utf8"),
    readFile(resolve(root, ".github/workflows/ci.yml"), "utf8"),
  ]);
  const rootPackage = JSON.parse(rootPackageText) as {
    engines?: { node?: string };
    scripts?: Record<string, string>;
  };
  const runnerPackage = JSON.parse(runnerPackageText) as {
    engines?: { node?: string };
    scripts?: Record<string, string>;
  };

  assert.equal(rootPackage.engines?.node, ">=22.13.0");
  assert.equal(runnerPackage.engines?.node, ">=22.13.0");
  assert.equal(rootPackage.scripts?.preinstall, "node scripts/check-node-version.cjs");
  assert.equal(runnerPackage.scripts?.preinstall, "node ../../scripts/check-node-version.cjs");
  assert.match(rootPackage.scripts?.["local:run"] ?? "", /^node scripts\/check-node-version\.cjs && /);
  assert.match(runnerPackage.scripts?.start ?? "", /^node \.\.\/\.\.\/scripts\/check-node-version\.cjs && /);
  assert.equal(nvmVersion.trim(), "22.23.1");
  assert.match(workflow, /node-version:\s*22\.23\.1/);
});
