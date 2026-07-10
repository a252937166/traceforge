import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCodexStatus,
  GENERATED_REPAIR_PATH,
  parseGeneratedVerificationRun,
  runCommand,
  validateChangedFiles,
} from "../src/codex-adapter.js";
import { buildAllowedOrigins } from "../src/app.js";

test("Codex status distinguishes SDK installation from explicit execution enablement", () => {
  const disabled = buildCodexStatus({}, true);
  const enabled = buildCodexStatus({ TRACEFORGE_ENABLE_CODEX: "1" }, true);
  const missing = buildCodexStatus({ TRACEFORGE_ENABLE_CODEX: "1" }, false);

  assert.deepEqual(
    { installed: disabled.installed, enabled: disabled.enabled, configured: disabled.configured, mode: disabled.mode },
    { installed: true, enabled: false, configured: false, mode: "disabled" },
  );
  assert.deepEqual(
    { installed: enabled.installed, enabled: enabled.enabled, configured: enabled.configured, mode: enabled.mode },
    { installed: true, enabled: true, configured: true, mode: "enabled" },
  );
  assert.deepEqual(
    { installed: missing.installed, enabled: missing.enabled, configured: missing.configured, mode: missing.mode },
    { installed: false, enabled: true, configured: false, mode: "missing-sdk" },
  );
});

test("verification command environment can explicitly disable recursive Codex execution", async () => {
  const result = await runCommand(
    process.execPath,
    ["-e", "process.stdout.write(process.env.TRACEFORGE_ENABLE_CODEX ?? 'missing')"],
    process.cwd(),
    { TRACEFORGE_ENABLE_CODEX: "0" },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "0");
});

test("generated verification parser returns the fresh full demo run", () => {
  const run = {
    runId: "run_fresh",
    status: "PASSED",
    proofBundle: { digest: "sha256:fresh" },
  };
  const parsed = parseGeneratedVerificationRun(`pnpm banner\n${JSON.stringify({ status: "PASSED", run })}\n`);
  assert.equal(parsed.runId, "run_fresh");
  assert.equal(parsed.proofBundle.digest, "sha256:fresh");
});

test("change whitelist requires the generated candidate and rejects every other path", () => {
  const valid = validateChangedFiles([GENERATED_REPAIR_PATH]);
  const unexpected = validateChangedFiles([GENERATED_REPAIR_PATH, "apps/api/src/domain.ts"]);
  const missing = validateChangedFiles([]);

  assert.equal(valid.passed, true);
  assert.deepEqual(valid.unexpected, []);
  assert.equal(unexpected.passed, false);
  assert.deepEqual(unexpected.unexpected, ["apps/api/src/domain.ts"]);
  assert.equal(missing.passed, false);
  assert.equal(missing.requiredFileChanged, false);
});

test("configured CORS origins extend rather than replace local defaults", () => {
  const origins = buildAllowedOrigins({
    TRACEFORGE_ALLOWED_ORIGINS: "https://preview.example, https://second.example ",
  });
  assert.equal(origins.has("http://127.0.0.1:4173"), true);
  assert.equal(origins.has("https://preview.example"), true);
  assert.equal(origins.has("https://second.example"), true);
});
