import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  buildChildEnvironment,
  buildCodexStatus,
  changedFilesIn,
  GENERATED_REPAIR_PATH,
  parseGeneratedVerificationRun,
  runCommand,
  validateChangedFiles,
  validateGeneratedRepairProvenance,
} from "../src/codex-adapter.js";
import { buildAllowedOrigins } from "../src/app.js";
import { TraceForgeService } from "../src/service.js";
import { ArtifactStore } from "../src/store.js";

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

test("child processes receive only operational environment variables and explicit overrides", () => {
  const environment = buildChildEnvironment(
    {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/safe/home",
      LANG: "en_US.UTF-8",
      CODEX_HOME: "/safe/codex",
      OPENAI_API_KEY: "must-not-be-inherited",
      CODEX_API_KEY: "must-not-be-inherited",
      DATABASE_URL: "must-not-be-inherited",
      GITHUB_TOKEN: "must-not-be-inherited",
      HTTPS_PROXY: "http://127.0.0.1:58591",
      HTTP_PROXY: "http://user:secret@proxy.example:8080",
      ALL_PROXY: "socks5://localhost:1080",
      NO_PROXY: "127.0.0.1,localhost",
    },
    { TRACEFORGE_ENABLE_CODEX: "0" },
  );

  assert.equal(environment.HOME, "/safe/home");
  assert.equal(environment.CODEX_HOME, "/safe/codex");
  assert.equal(environment.TRACEFORGE_ENABLE_CODEX, "0");
  assert.ok(environment.PATH.startsWith(dirname(process.execPath)));
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.CODEX_API_KEY, undefined);
  assert.equal(environment.DATABASE_URL, undefined);
  assert.equal(environment.GITHUB_TOKEN, undefined);
  assert.equal(environment.HTTPS_PROXY, "http://127.0.0.1:58591");
  assert.equal(environment.ALL_PROXY, "socks5://localhost:1080");
  assert.equal(environment.NO_PROXY, "127.0.0.1,localhost");
  assert.equal(environment.HTTP_PROXY, undefined);
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

test("change collection rejects verifier-relevant ignored-path tampering", async () => {
  const repository = await mkdtemp(join(tmpdir(), "traceforge-whitelist-"));
  const candidate = join(repository, GENERATED_REPAIR_PATH);
  try {
    await mkdir(dirname(candidate), { recursive: true });
    await writeFile(join(repository, ".gitignore"), "node_modules/\n.env\n.traceforge/\n", "utf8");
    await writeFile(candidate, "export const generatedRepair = 'baseline';\n", "utf8");
    for (const args of [
      ["init", "-q"],
      ["add", "."],
      ["-c", "user.name=TraceForge Test", "-c", "user.email=test@traceforge.invalid", "commit", "-qm", "baseline"],
    ]) {
      const result = await runCommand("git", args, repository);
      assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    }

    await writeFile(candidate, "export const generatedRepair = 'candidate';\n", "utf8");
    await mkdir(join(repository, ".traceforge"), { recursive: true });
    await writeFile(join(repository, ".traceforge", "proof-input.json"), "{}\n", "utf8");
    await mkdir(join(repository, "node_modules"), { recursive: true });
    await writeFile(join(repository, "node_modules", "tampered.js"), "throw new Error('tampered');\n", "utf8");
    await writeFile(join(repository, ".env"), "UNTRUSTED=1\n", "utf8");

    const changed = await changedFilesIn(repository);
    const validation = validateChangedFiles(changed);
    assert.equal(changed.includes(GENERATED_REPAIR_PATH), true);
    assert.equal(changed.includes("node_modules/"), true);
    assert.equal(changed.includes(".env"), true);
    assert.equal(changed.includes(".traceforge/"), false);
    assert.equal(validation.passed, false);
    assert.deepEqual(validation.unexpected, [".env", "node_modules/"]);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("generated repair provenance must identify Codex and the exact failed proof digest", () => {
  const store = new ArtifactStore(":memory:");
  try {
    const run = new TraceForgeService(store).runDemo({
      scenarioId: "damaged-small-refund",
      candidateVersion: "generated",
    });
    const evidence = run.traces.replacement.evidence.find(
      (entry) => entry.type === "repair.configuration",
    );
    assert.ok(evidence);
    const failedProofDigest = `sha256:${"a".repeat(64)}`;
    evidence.payload = {
      damagedRefundDestination: "QUARANTINE",
      metadata: {
        status: "codex-generated",
        sourceProofDigest: failedProofDigest,
        summary: "Route damaged refunds to quarantine.",
      },
    };

    const valid = validateGeneratedRepairProvenance(run, failedProofDigest);
    const wrongSource = validateGeneratedRepairProvenance(run, `sha256:${"b".repeat(64)}`);
    assert.equal(valid.passed, true);
    assert.equal(valid.evidenceId, evidence.evidenceId);
    assert.equal(wrongSource.passed, false);
    assert.match(wrongSource.problems.join("; "), /sourceProofDigest/);

    const metadata = (evidence.payload as { metadata: { status: string } }).metadata;
    metadata.status = "unconfigured";
    const unconfigured = validateGeneratedRepairProvenance(run, failedProofDigest);
    assert.equal(unconfigured.passed, false);
    assert.match(unconfigured.problems.join("; "), /metadata\.status/);
  } finally {
    store.close();
  }
});

test("configured CORS origins extend rather than replace local defaults", () => {
  const origins = buildAllowedOrigins({
    TRACEFORGE_ALLOWED_ORIGINS: "https://preview.example, https://second.example ",
  });
  assert.equal(origins.has("http://127.0.0.1:4173"), true);
  assert.equal(origins.has("https://preview.example"), true);
  assert.equal(origins.has("https://second.example"), true);
});
