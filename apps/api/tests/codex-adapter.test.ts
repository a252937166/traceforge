import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  buildChildEnvironment,
  buildCodexClientOptions,
  buildCodexRepairPrompt,
  buildCodexStatus,
  BEHAVIOR_CONTRACT_PATH,
  changedFilesIn,
  CODEX_REPAIR_MODEL,
  codexRepairInputEvidence,
  FAILED_PROOFS_PATH,
  GENERATED_CANDIDATE_PATH,
  parseGeneratedVerificationSuite,
  runCommand,
  validateChangedFiles,
  validateCodexRepairInput,
  validateGeneratedSuite,
  verifyCodexRepairInputFiles,
  VISIBLE_SCENARIOS_PATH,
  writeCodexRepairInputFiles,
  type CodexRepairInput,
  type GeneratedCandidateSuiteEvidence,
} from "../src/codex-adapter.js";
import { buildAllowedOrigins } from "../src/app.js";
import { createHostHiddenScenario, scenarios } from "../src/scenarios.js";
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
  assert.match(enabled.truthfulBoundary, new RegExp(CODEX_REPAIR_MODEL.replace(".", "\\.")));
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
      TRACEFORGE_CODEX_API_KEY: "must-not-be-inherited-by-child",
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
  assert.equal(environment.TRACEFORGE_CODEX_API_KEY, undefined);
  assert.equal(environment.HTTPS_PROXY, "http://127.0.0.1:58591");
  assert.equal(environment.ALL_PROXY, "socks5://localhost:1080");
  assert.equal(environment.NO_PROXY, "127.0.0.1,localhost");
  assert.equal(environment.HTTP_PROXY, undefined);
});

test("Codex SDK reuses ChatGPT login unless the TraceForge-specific key is explicit", () => {
  const chatGptLogin = buildCodexClientOptions({
    HOME: "/safe/home",
    CODEX_HOME: "/safe/codex",
    OPENAI_API_KEY: "stale-openai-key",
    CODEX_API_KEY: "stale-codex-key",
  });
  assert.equal(chatGptLogin.apiKey, undefined);
  assert.equal(chatGptLogin.env.OPENAI_API_KEY, undefined);
  assert.equal(chatGptLogin.env.CODEX_API_KEY, undefined);

  const explicit = buildCodexClientOptions({
    HOME: "/safe/home",
    TRACEFORGE_CODEX_API_KEY: "traceforge-explicit-key",
    TRACEFORGE_CODEX_BASE_URL: "https://codex.example.invalid/v1",
    OPENAI_API_KEY: "must-still-be-ignored",
  });
  assert.equal(explicit.apiKey, "traceforge-explicit-key");
  assert.equal(explicit.baseUrl, "https://codex.example.invalid/v1");
  assert.equal(explicit.env.OPENAI_API_KEY, undefined);
  assert.equal(explicit.env.TRACEFORGE_CODEX_API_KEY, undefined);
});

function passingSuite(repairInputDigest = `sha256:${"f".repeat(64)}`): GeneratedCandidateSuiteEvidence {
  const ids = [
    "observed-standard-damaged-4500",
    "observed-vip-damaged-12000",
    "counterexample-standard-damaged-100000",
    "boundary-standard-damaged-49999",
    "boundary-standard-damaged-50000",
    "host-hidden-verifier-only",
  ];
  return {
    repairInputDigest,
    candidateVersion: "generated",
    status: "PASSED",
    expectedScenarioIds: ids,
    summary: { total: 6, passed: 6, failed: 0 },
    runs: ids.map((scenarioId, index) => ({
      scenarioId,
      partition: index === 5
        ? "held-out"
        : index < 2
          ? "observed"
          : index === 2
            ? "counterexample"
            : "boundary",
      runId: `run_fresh_${index}`,
      status: "PASSED",
      implementationId: "replacement.return-workflow.generated-candidate",
      proofId: `proof_fresh_${index}`,
      proofDigest: `sha256:${String(index + 1).repeat(64)}`,
      legacyTraceId: `trace_legacy_${index}`,
      candidateTraceId: `trace_candidate_${index}`,
      assertionCount: 5,
      mismatchCount: 0,
      proofPersisted: true,
    })),
  };
}

test("generated verification parser returns fresh six-scenario suite evidence", () => {
  const suite = passingSuite();
  const parsed = parseGeneratedVerificationSuite(
    `pnpm banner\n${JSON.stringify({ suite, validation: { passed: true } })}\n`,
  );
  assert.equal(parsed.status, "PASSED");
  assert.equal(parsed.runs.length, 6);
  assert.equal(parsed.runs[5]?.scenarioId, "host-hidden-verifier-only");
});

test("change whitelist requires the generated candidate and rejects every other path", () => {
  const valid = validateChangedFiles([GENERATED_CANDIDATE_PATH]);
  const unexpected = validateChangedFiles([GENERATED_CANDIDATE_PATH, "apps/api/src/domain.ts"]);
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
  const candidate = join(repository, GENERATED_CANDIDATE_PATH);
  try {
    await mkdir(dirname(candidate), { recursive: true });
    await writeFile(join(repository, ".gitignore"), "node_modules/\n.env\n.traceforge/\n", "utf8");
    await writeFile(candidate, "export function executeGeneratedReturnWorkflow() {}\n", "utf8");
    for (const args of [
      ["init", "-q"],
      ["add", "."],
      ["-c", "user.name=TraceForge Test", "-c", "user.email=test@traceforge.invalid", "commit", "-qm", "baseline"],
    ]) {
      const result = await runCommand("git", args, repository);
      assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    }

    await writeFile(candidate, "export function executeGeneratedReturnWorkflow() { return 'repaired'; }\n", "utf8");
    await mkdir(join(repository, ".traceforge"), { recursive: true });
    await writeFile(join(repository, ".traceforge", "proof-input.json"), "{}\n", "utf8");
    await mkdir(join(repository, "node_modules"), { recursive: true });
    await writeFile(join(repository, "node_modules", "tampered.js"), "throw new Error('tampered');\n", "utf8");
    await writeFile(join(repository, ".env"), "UNTRUSTED=1\n", "utf8");

    const changed = await changedFilesIn(repository);
    const validation = validateChangedFiles(changed);
    assert.equal(changed.includes(GENERATED_CANDIDATE_PATH), true);
    assert.equal(changed.includes("node_modules/"), true);
    assert.equal(changed.includes(".env"), true);
    assert.equal(changed.includes(".traceforge/"), false);
    assert.equal(validation.passed, false);
    assert.deepEqual(validation.unexpected, [".env", "node_modules/"]);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("generated suite is linked to the complete repair input and requires a unique host-hidden proof", () => {
  const repairInputDigest = `sha256:${"f".repeat(64)}`;
  const validSuite = passingSuite(repairInputDigest);
  assert.equal(validateGeneratedSuite(validSuite, repairInputDigest).passed, true);

  const wrongSource = validateGeneratedSuite(
    validSuite,
    `sha256:${"e".repeat(64)}`,
  );
  assert.equal(wrongSource.passed, false);
  assert.match(wrongSource.problems.join("; "), /repairInputDigest/);

  const duplicatedProof = structuredClone(validSuite);
  const firstProof = duplicatedProof.runs[0];
  const secondProof = duplicatedProof.runs[1];
  assert.ok(firstProof && secondProof);
  secondProof.proofId = firstProof.proofId;
  secondProof.proofDigest = firstProof.proofDigest;
  const duplicated = validateGeneratedSuite(duplicatedProof, repairInputDigest);
  assert.equal(duplicated.passed, false);
  assert.match(duplicated.problems.join("; "), /unique/);
});

function repairInputFixture(): { input: CodexRepairInput; close: () => void } {
  const store = new ArtifactStore(":memory:");
  const service = new TraceForgeService(store);
  const failedProofs = service.runVisibleSuite("seeded").runs
    .filter(({ status }) => status === "FAILED")
    .map(({ proofBundle }) => proofBundle);
  return {
    input: {
      behaviorContract: { id: "contract-gpt56-test", rules: [{ statement: "evidence-derived" }] },
      failedProofs,
      visibleScenarios: scenarios,
    },
    close: () => store.close(),
  };
}

test("Codex repair prompt points to evidence artifacts without embedding workflow answers or final scenario names", () => {
  const prompt = buildCodexRepairPrompt();
  assert.match(prompt, new RegExp(BEHAVIOR_CONTRACT_PATH.replaceAll(".", "\\.")));
  assert.match(prompt, new RegExp(FAILED_PROOFS_PATH.replaceAll(".", "\\.")));
  assert.match(prompt, new RegExp(VISIBLE_SCENARIOS_PATH.replaceAll(".", "\\.")));
  assert.doesNotMatch(prompt, /50[,_]000|49[,_]999|100[,_]000|VIP-at|quarantine|heldout-vip|boundary-standard|counterexample-standard/i);
});

test("repair input persists the GPT contract, every failed proof, and only disclosed scenarios", async () => {
  const directory = await mkdtemp(join(tmpdir(), "traceforge-repair-input-"));
  const fixture = repairInputFixture();
  try {
    const evidence = await writeCodexRepairInputFiles(directory, fixture.input);
    await verifyCodexRepairInputFiles(directory, evidence);
    assert.deepEqual(evidence, codexRepairInputEvidence(fixture.input));
    assert.equal(evidence.failedProofDigests.length, fixture.input.failedProofs.length);
    assert.ok(evidence.failedProofDigests.length > 1);
    const contract = JSON.parse(await readFile(join(directory, BEHAVIOR_CONTRACT_PATH), "utf8"));
    const failedProofs = JSON.parse(await readFile(join(directory, FAILED_PROOFS_PATH), "utf8"));
    const visibleScenarios = JSON.parse(await readFile(join(directory, VISIBLE_SCENARIOS_PATH), "utf8"));
    assert.equal(contract.id, "contract-gpt56-test");
    assert.deepEqual(failedProofs.map(({ proofId }: { proofId: string }) => proofId), fixture.input.failedProofs.map(({ proofId }) => proofId));
    assert.deepEqual(visibleScenarios.map(({ id }: { id: string }) => id), scenarios.map(({ id }) => id));
    assert.equal(visibleScenarios.some(({ visibility }: { visibility: string }) => visibility === "hidden"), false);
  } finally {
    fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("host detects any mutation to the immutable Codex evidence files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "traceforge-repair-tamper-"));
  const fixture = repairInputFixture();
  try {
    const evidence = await writeCodexRepairInputFiles(directory, fixture.input);
    await writeFile(join(directory, FAILED_PROOFS_PATH), "[]\n", "utf8");
    await assert.rejects(
      verifyCodexRepairInputFiles(directory, evidence),
      /CODEX_REPAIR_INPUT_TAMPERED/,
    );
  } finally {
    fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("repair input rejects any host-hidden scenario before Codex starts", () => {
  const fixture = repairInputFixture();
  try {
    assert.throws(
      () => validateCodexRepairInput({
        ...fixture.input,
        visibleScenarios: [...fixture.input.visibleScenarios, createHostHiddenScenario("must-stay-hidden")],
      }),
      /CODEX_REPAIR_REJECTS_HIDDEN_SCENARIOS/,
    );
  } finally {
    fixture.close();
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
