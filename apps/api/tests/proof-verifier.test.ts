import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sha256Digest } from "../src/digest.js";
import {
  rawSha256Digest,
  validateCurrentProof,
  validateSourceRunEnvelope,
  verifyProofIntegrity,
} from "../src/proof-verifier.js";

const evidenceDirectory = fileURLToPath(new URL("../../../docs/evidence/live-champion-run/", import.meta.url));
const historicalProofFile = `${evidenceDirectory}proof.json`;
const envelopeFile = `${evidenceDirectory}source-run-envelope-v2.json`;
const recordedVerifierArtifactFile = fileURLToPath(new URL("../src/recorded-codex-build.generated.json", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function resign<T extends Record<string, unknown>>(value: T): T {
  const { digest: _digest, ...body } = value;
  return { ...body, digest: sha256Digest(body) } as T;
}

function currentProof(): Record<string, unknown> {
  const scenarios = [
    {
      scenarioId: "observed-one",
      partition: "observed",
      proofDigest: `sha256:${"1".repeat(64)}`,
      status: "PASSED",
      legacyTraceId: "trace-legacy",
      candidateTraceId: "trace-candidate",
      assertionCount: 5,
      mismatchCount: 0,
      mismatches: [],
      provenance: { source: "host-authored", detail: "test fixture" },
    },
  ];
  const scenarioSet = scenarios.map(({ scenarioId, partition, proofDigest }) => ({ scenarioId, partition, proofDigest }));
  return resign({
    proofId: "proof-current",
    migrationId: "migration-current",
    status: "PASSED",
    claim: "One executed scenario only.",
    contractId: "contract-current",
    contractDigest: `sha256:${"2".repeat(64)}`,
    scenarioSetDigest: sha256Digest(scenarioSet),
    modelInvocations: [],
    candidate: {
      implementationId: "replacement.return-workflow.generated-candidate",
      sourceDigest: `sha256:${"5".repeat(64)}`,
      diffDigest: `sha256:${"6".repeat(64)}`,
    },
    hostVerification: {
      testsPassed: 1,
      testsTotal: 1,
      testsSkipped: 0,
      scope: "full-release",
      source: "live-command-output",
    },
    coverage: { observed: 1, counterexample: 0, boundary: 0, heldOut: 0, total: 1, passed: 1 },
    scenarios,
    limitations: ["fixture"],
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
}

function failedCurrentProof(): Record<string, unknown> {
  const proof = currentProof();
  proof.status = "FAILED";
  (proof.coverage as Record<string, unknown>).passed = 0;
  const scenario = (proof.scenarios as Array<Record<string, unknown>>)[0];
  scenario.status = "FAILED";
  scenario.mismatchCount = 1;
  scenario.mismatches = [{ path: "decision", expected: "REFUND", actual: "REPLACE" }];
  return resign(proof);
}

test("preserves and verifies the historical source proof byte-for-byte", async () => {
  const proofBytes = await readFile(historicalProofFile);
  const proof = JSON.parse(proofBytes.toString("utf8")) as unknown;

  assert.equal(
    rawSha256Digest(proofBytes),
    "sha256:14b04967561d9d33f13bec7cec42807d13842783ba9da0e5c8da1f91b9851c81",
  );
  assert.deepEqual(verifyProofIntegrity(proof), {
    valid: true,
    errors: [],
    claimedDigest: "sha256:4be44d476f222ca492d025a13f296997148142471e2387d532c61479bc3703bc",
    computedDigest: "sha256:4be44d476f222ca492d025a13f296997148142471e2387d532c61479bc3703bc",
  });
  const currentSchemaResult = validateCurrentProof(proof);
  assert.equal(currentSchemaResult.valid, false);
  assert.ok(currentSchemaResult.errors.includes("proof.scenarioSetDigest is required"));
});

test("validates the v2 envelope against the historical proof and exact bytes", async () => {
  const proofBytes = await readFile(historicalProofFile);
  const envelope = JSON.parse(await readFile(envelopeFile, "utf8")) as Record<string, unknown>;
  const recordedVerifierArtifactBytes = await readFile(recordedVerifierArtifactFile);
  const result = validateSourceRunEnvelope(envelope, proofBytes, recordedVerifierArtifactBytes);

  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(envelope.scenarioSetDigest, "sha256:142d9123ec2c33e0e48abba37dc184f9f0b6c82162dbdb83fcf50df7d749c0da");
  assert.equal((envelope.verifiedScenarioSet as unknown[]).length, 7);
});

test("package-level proof:verify alias preserves the historical CLI path", () => {
  const result = spawnSync(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@traceforge/api",
      "proof:verify",
      "docs/evidence/live-champion-run/proof.json",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"kind": "historical-object-integrity"/);
  assert.match(result.stdout, /"valid": true/);
});

test("current-schema verification detects coverage tampering even after re-signing the object", () => {
  const proof = currentProof();
  const coverageTampered = structuredClone(proof);
  (coverageTampered.coverage as Record<string, unknown>).total = 2;
  const result = validateCurrentProof(resign(coverageTampered));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("proof.coverage.total does not match the scenarios"));
});

test("current-schema verification detects scenario proof digest tampering", () => {
  const proof = currentProof();
  const digestTampered = structuredClone(proof);
  (digestTampered.scenarios as Array<Record<string, unknown>>)[0].proofDigest = `sha256:${"3".repeat(64)}`;
  const result = validateCurrentProof(resign(digestTampered));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("proof.scenarioSetDigest does not match the ordered scenario set"));
});

test("integrity verification detects a tampered canonical object digest", () => {
  const proof = currentProof();
  proof.digest = `sha256:${"0".repeat(64)}`;
  const result = validateCurrentProof(proof);

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("proof.digest does not match the canonical proof body"));
});

test("current-schema verification detects missing schema fields", () => {
  const proof = currentProof();
  delete proof.scenarioSetDigest;
  const result = validateCurrentProof(resign(proof));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("proof.scenarioSetDigest is required"));
});

test("current-schema verification ties scenario status to mismatch evidence", () => {
  const passedWithMismatch = currentProof();
  const passedScenario = (passedWithMismatch.scenarios as Array<Record<string, unknown>>)[0];
  passedScenario.mismatchCount = 1;
  passedScenario.mismatches = [{ path: "decision", expected: "REFUND", actual: "REPLACE" }];
  const passedResult = validateCurrentProof(resign(passedWithMismatch));
  assert.equal(passedResult.valid, false);
  assert.ok(passedResult.errors.includes("proof.scenarios[0].status PASSED requires zero mismatches"));

  const failedWithoutMismatch = currentProof();
  failedWithoutMismatch.status = "FAILED";
  (failedWithoutMismatch.coverage as Record<string, unknown>).passed = 0;
  (failedWithoutMismatch.scenarios as Array<Record<string, unknown>>)[0].status = "FAILED";
  const failedResult = validateCurrentProof(resign(failedWithoutMismatch));
  assert.equal(failedResult.valid, false);
  assert.ok(failedResult.errors.includes("proof.scenarios[0].status FAILED requires at least one mismatch"));
});

test("current-schema verification rejects a zero-assertion PASSED scenario", () => {
  const proof = currentProof();
  (proof.scenarios as Array<Record<string, unknown>>)[0].assertionCount = 0;
  const result = validateCurrentProof(resign(proof));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("proof.scenarios[0].status PASSED requires at least one assertion"));
});

test("current-schema verification rejects more mismatches than assertions", () => {
  const proof = failedCurrentProof();
  const scenario = (proof.scenarios as Array<Record<string, unknown>>)[0];
  scenario.assertionCount = 1;
  scenario.mismatchCount = 2;
  scenario.mismatches = [
    { path: "decision", expected: "REFUND", actual: "REPLACE" },
    { path: "quarantine", expected: 1, actual: 0 },
  ];
  const result = validateCurrentProof(resign(proof));

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("proof.scenarios[0].mismatchCount cannot exceed assertionCount"));
});

test("current-schema verification enforces proof status in both directions", () => {
  const failedClaimOverPassingScenarios = currentProof();
  failedClaimOverPassingScenarios.status = "FAILED";
  const failedClaimResult = validateCurrentProof(resign(failedClaimOverPassingScenarios));
  assert.equal(failedClaimResult.valid, false);
  assert.ok(failedClaimResult.errors.includes("proof.status does not match the scenario statuses"));

  const passedClaimOverFailedScenarios = failedCurrentProof();
  passedClaimOverFailedScenarios.status = "PASSED";
  const passedClaimResult = validateCurrentProof(resign(passedClaimOverFailedScenarios));
  assert.equal(passedClaimResult.valid, false);
  assert.ok(passedClaimResult.errors.includes("proof.status does not match the scenario statuses"));
});

test("current-schema verification enforces host totals and a green gate for PASSED proofs", () => {
  const impossibleTotals = currentProof();
  (impossibleTotals.hostVerification as Record<string, unknown>).testsPassed = 2;
  const impossibleResult = validateCurrentProof(resign(impossibleTotals));
  assert.equal(impossibleResult.valid, false);
  assert.ok(impossibleResult.errors.includes("proof.hostVerification.testsPassed cannot exceed testsTotal"));

  const partialGate = currentProof();
  (partialGate.hostVerification as Record<string, unknown>).testsPassed = 0;
  const partialResult = validateCurrentProof(resign(partialGate));
  assert.equal(partialResult.valid, false);
  assert.ok(partialResult.errors.includes("proof.status PASSED requires a fully passing hostVerification gate"));
});

test("current-schema verification honors optional hostVerification scope and failed-proof host gate", () => {
  const optionalScope = currentProof();
  delete (optionalScope.hostVerification as Record<string, unknown>).scope;
  const optionalScopeResult = validateCurrentProof(resign(optionalScope));
  assert.equal(optionalScopeResult.valid, true, optionalScopeResult.errors.join("\n"));

  const failedWithoutHostGate = failedCurrentProof();
  delete failedWithoutHostGate.hostVerification;
  const failedWithoutHostResult = validateCurrentProof(resign(failedWithoutHostGate));
  assert.equal(failedWithoutHostResult.valid, true, failedWithoutHostResult.errors.join("\n"));
});

test("envelope verification detects scenario-set, byte, and schema tampering", async () => {
  const proofBytes = await readFile(historicalProofFile);
  const envelope = JSON.parse(await readFile(envelopeFile, "utf8")) as Record<string, unknown>;
  const recordedVerifierArtifactBytes = await readFile(recordedVerifierArtifactFile);

  const setTampered = structuredClone(envelope);
  (setTampered.verifiedScenarioSet as Array<Record<string, unknown>>)[0].proofDigest = `sha256:${"4".repeat(64)}`;
  setTampered.scenarioSetDigest = sha256Digest(setTampered.verifiedScenarioSet);
  const setResult = validateSourceRunEnvelope(
    resign(setTampered),
    proofBytes,
    recordedVerifierArtifactBytes,
  );
  assert.equal(setResult.valid, false);
  assert.ok(setResult.errors.includes("envelope.verifiedScenarioSet does not exactly match the recorded verifier final suite"));

  const byteResult = validateSourceRunEnvelope(
    envelope,
    new Uint8Array([...proofBytes, 0x20]),
    recordedVerifierArtifactBytes,
  );
  assert.equal(byteResult.valid, false);
  assert.ok(byteResult.errors.includes("envelope.originalProofFileDigest does not match the historical proof bytes"));

  const schemaTampered = structuredClone(envelope);
  schemaTampered.version = "traceforge.source-run-envelope.v3";
  const schemaResult = validateSourceRunEnvelope(
    resign(schemaTampered),
    proofBytes,
    recordedVerifierArtifactBytes,
  );
  assert.equal(schemaResult.valid, false);
  assert.ok(schemaResult.errors.includes("envelope.version must be traceforge.source-run-envelope.v2"));

  const recordedBytesResult = validateSourceRunEnvelope(
    envelope,
    proofBytes,
    new Uint8Array([...recordedVerifierArtifactBytes, 0x20]),
  );
  assert.equal(recordedBytesResult.valid, false);
  assert.ok(
    recordedBytesResult.errors.includes(
      "envelope.recordedVerifierArtifactFileDigest does not match the recorded verifier artifact bytes",
    ),
  );

  const originalRecordedDigest = "sha256:572cdedeca2729f47d747834c248f2d71d917063fda66f930ed7e36dca1791b1";
  const changedRecordedDigest = `sha256:${"7".repeat(64)}`;
  const tamperedRecordedArtifactBytes = Buffer.from(
    recordedVerifierArtifactBytes.toString("utf8").replace(originalRecordedDigest, changedRecordedDigest),
  );
  const artifactReboundEnvelope = structuredClone(envelope);
  artifactReboundEnvelope.recordedVerifierArtifactFileDigest = rawSha256Digest(tamperedRecordedArtifactBytes);
  const recordedContentResult = validateSourceRunEnvelope(
    resign(artifactReboundEnvelope),
    proofBytes,
    tamperedRecordedArtifactBytes,
  );
  assert.equal(recordedContentResult.valid, false);
  assert.ok(
    recordedContentResult.errors.includes(
      "envelope.verifiedScenarioSet does not exactly match the recorded verifier final suite",
    ),
  );
});

test("envelope verification rejects a recorded PASSED run with zero assertions", async () => {
  const proofBytes = await readFile(historicalProofFile);
  const envelope = JSON.parse(await readFile(envelopeFile, "utf8")) as Record<string, unknown>;
  const recordedVerifierArtifactBytes = await readFile(recordedVerifierArtifactFile);
  const tamperedRecordedArtifactBytes = Buffer.from(
    recordedVerifierArtifactBytes.toString("utf8").replace('\\"assertionCount\\":5', '\\"assertionCount\\":0'),
  );
  const reboundEnvelope = structuredClone(envelope);
  reboundEnvelope.recordedVerifierArtifactFileDigest = rawSha256Digest(tamperedRecordedArtifactBytes);
  const result = validateSourceRunEnvelope(
    resign(reboundEnvelope),
    proofBytes,
    tamperedRecordedArtifactBytes,
  );

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.includes("recordedVerifier.suite.runs[0].assertionCount must be a positive integer"),
  );
});
