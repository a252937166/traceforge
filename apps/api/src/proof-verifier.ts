import { createHash } from "node:crypto";
import { sha256Digest } from "./digest.js";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PARTITIONS = new Set(["observed", "counterexample", "boundary", "held-out"]);
const VERIFICATION_STATUSES = new Set(["PASSED", "FAILED"]);

type JsonRecord = Record<string, unknown>;

export interface ProofValidationResult {
  valid: boolean;
  errors: string[];
  claimedDigest?: string;
  computedDigest?: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, allowed: readonly string[], path: string, errors: string[]): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not part of this schema`);
  }
  for (const key of allowed) {
    if (!(key in value)) errors.push(`${path}.${key} is required`);
  }
}

function exactShape(
  value: JsonRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  errors: string[],
): void {
  const allowedKeys = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not part of this schema`);
  }
  for (const key of required) {
    if (!(key in value)) errors.push(`${path}.${key} is required`);
  }
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function validateSha256(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    errors.push(`${path} must be a lowercase sha256 digest`);
    return false;
  }
  return true;
}

export function rawSha256Digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseJsonBytes(value: Uint8Array, label: string, errors: string[]): unknown {
  try {
    return JSON.parse(Buffer.from(value).toString("utf8")) as unknown;
  } catch {
    errors.push(`${label} must contain valid JSON`);
    return undefined;
  }
}

/**
 * Verify only the canonical object digest. This deliberately accepts historical
 * proof shapes and must not be represented as current-schema validation.
 */
export function verifyProofIntegrity(value: unknown): ProofValidationResult {
  if (!isRecord(value)) {
    return { valid: false, errors: ["proof must be a JSON object"] };
  }

  const { digest: claimedDigest, ...body } = value;
  const computedDigest = sha256Digest(body);
  const errors: string[] = [];
  if (!validateSha256(claimedDigest, "proof.digest", errors) || claimedDigest !== computedDigest) {
    if (typeof claimedDigest === "string" && SHA256_PATTERN.test(claimedDigest) && claimedDigest !== computedDigest) {
      errors.push("proof.digest does not match the canonical proof body");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    claimedDigest: typeof claimedDigest === "string" ? claimedDigest : undefined,
    computedDigest,
  };
}

function validateScenarioSet(
  value: unknown,
  path: string,
  errors: string[],
): Array<{ scenarioId: string; partition: string; proofDigest: string }> {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return [];
  }

  const scenarioSet: Array<{ scenarioId: string; partition: string; proofDigest: string }> = [];
  const scenarioIds = new Set<string>();
  const proofDigests = new Set<string>();

  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${entryPath} must be an object`);
      return;
    }
    exactKeys(entry, ["scenarioId", "partition", "proofDigest"], entryPath, errors);
    const { scenarioId, partition, proofDigest } = entry;
    if (typeof scenarioId !== "string" || scenarioId.length === 0) {
      errors.push(`${entryPath}.scenarioId must be a non-empty string`);
    } else if (scenarioIds.has(scenarioId)) {
      errors.push(`${entryPath}.scenarioId must be unique`);
    } else {
      scenarioIds.add(scenarioId);
    }
    if (typeof partition !== "string" || !PARTITIONS.has(partition)) {
      errors.push(`${entryPath}.partition is invalid`);
    }
    if (validateSha256(proofDigest, `${entryPath}.proofDigest`, errors)) {
      if (proofDigests.has(proofDigest)) errors.push(`${entryPath}.proofDigest must be unique`);
      proofDigests.add(proofDigest);
    }
    if (
      typeof scenarioId === "string" &&
      scenarioId.length > 0 &&
      typeof partition === "string" &&
      PARTITIONS.has(partition) &&
      typeof proofDigest === "string" &&
      SHA256_PATTERN.test(proofDigest)
    ) {
      scenarioSet.push({ scenarioId, partition, proofDigest });
    }
  });

  return scenarioSet;
}

function extractRecordedVerifierScenarioSet(
  recordedArtifact: unknown,
  errors: string[],
): Array<{ scenarioId: string; partition: string; proofDigest: string }> {
  if (!isRecord(recordedArtifact)) {
    errors.push("recorded verifier artifact must be a JSON object");
    return [];
  }
  if (!Array.isArray(recordedArtifact.commands)) {
    errors.push("recorded verifier artifact commands are unavailable");
    return [];
  }

  const suitePayloads: JsonRecord[] = [];
  recordedArtifact.commands.forEach((command) => {
    if (
      !isRecord(command) ||
      command.command !== "pnpm --filter @traceforge/api verify:generated" ||
      typeof command.stdout !== "string"
    ) return;
    for (const line of command.stdout.split("\n")) {
      const candidate = line.trim();
      if (!candidate.startsWith("{") || !candidate.includes('"suite"')) continue;
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (isRecord(parsed) && isRecord(parsed.suite)) suitePayloads.push(parsed);
      } catch {
        errors.push("recorded verifier artifact contains an invalid suite JSON line");
      }
    }
  });

  if (suitePayloads.length !== 1) {
    errors.push("recorded verifier artifact must contain exactly one final suite");
    return [];
  }

  const payload = suitePayloads[0]!;
  const suite = payload.suite as JsonRecord;
  if (suite.status !== "PASSED") errors.push("recorded verifier final suite must be PASSED");
  if (!Array.isArray(suite.runs) || suite.runs.length === 0) {
    errors.push("recorded verifier final suite runs are unavailable");
    return [];
  }

  const recordedSet = validateScenarioSet(
    suite.runs.map((run) =>
      isRecord(run)
        ? { scenarioId: run.scenarioId, partition: run.partition, proofDigest: run.proofDigest }
        : run,
    ),
    "recordedVerifier.suite.runs",
    errors,
  );

  suite.runs.forEach((run, index) => {
    if (!isRecord(run)) return;
    if (run.status !== "PASSED") errors.push(`recordedVerifier.suite.runs[${index}].status must be PASSED`);
    if (!isPositiveInteger(run.assertionCount)) {
      errors.push(`recordedVerifier.suite.runs[${index}].assertionCount must be a positive integer`);
    }
    if (run.mismatchCount !== 0) errors.push(`recordedVerifier.suite.runs[${index}].mismatchCount must be zero`);
    if (run.proofPersisted !== true) errors.push(`recordedVerifier.suite.runs[${index}].proofPersisted must be true`);
  });

  const expectedIds = recordedSet.map(({ scenarioId }) => scenarioId);
  if (!Array.isArray(suite.expectedScenarioIds) || JSON.stringify(suite.expectedScenarioIds) !== JSON.stringify(expectedIds)) {
    errors.push("recorded verifier expectedScenarioIds do not match its ordered runs");
  }
  if (!isRecord(suite.summary)) {
    errors.push("recorded verifier final suite summary is unavailable");
  } else if (
    suite.summary.total !== recordedSet.length ||
    suite.summary.passed !== recordedSet.length ||
    suite.summary.failed !== 0
  ) {
    errors.push("recorded verifier final suite summary does not match its runs");
  }
  if (
    !isRecord(payload.validation) ||
    payload.validation.passed !== true ||
    !Array.isArray(payload.validation.problems) ||
    payload.validation.problems.length !== 0
  ) {
    errors.push("recorded verifier final suite validation must pass without problems");
  }

  return recordedSet;
}

/** Validate the proof shape emitted by the scenario-set-hardened runtime. */
export function validateCurrentProof(value: unknown): ProofValidationResult {
  const integrity = verifyProofIntegrity(value);
  const errors = [...integrity.errors];
  if (!isRecord(value)) return { ...integrity, errors, valid: false };

  exactShape(
    value,
    [
      "proofId",
      "migrationId",
      "status",
      "claim",
      "contractId",
      "contractDigest",
      "scenarioSetDigest",
      "modelInvocations",
      "candidate",
      "coverage",
      "scenarios",
      "limitations",
      "generatedAt",
      "digest",
    ],
    ["hostVerification"],
    "proof",
    errors,
  );

  for (const key of ["proofId", "migrationId", "claim", "contractId"] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      errors.push(`proof.${key} must be a non-empty string`);
    }
  }
  if (typeof value.status !== "string" || !VERIFICATION_STATUSES.has(value.status)) {
    errors.push("proof.status is invalid");
  }
  validateSha256(value.contractDigest, "proof.contractDigest", errors);
  validateSha256(value.scenarioSetDigest, "proof.scenarioSetDigest", errors);
  if (!Array.isArray(value.modelInvocations)) {
    errors.push("proof.modelInvocations must be an array");
  } else {
    value.modelInvocations.forEach((invocation, index) => {
      const path = `proof.modelInvocations[${index}]`;
      if (!isRecord(invocation)) {
        errors.push(`${path} must be an object`);
        return;
      }
      exactKeys(
        invocation,
        [
          "role",
          "provider",
          "model",
          "authPath",
          "threadId",
          "startedAt",
          "completedAt",
          "usage",
          "inputTraceIds",
          "inputEvidenceDigests",
          "inputDigest",
          "outputDigest",
          "schemaVersion",
          "status",
        ],
        path,
        errors,
      );
      if (
        invocation.role !== "trace-archaeologist" &&
        invocation.role !== "counterexample-hunter" &&
        invocation.role !== "contract-critic"
      ) {
        errors.push(`${path}.role is invalid`);
      }
      if (invocation.provider !== "openai") errors.push(`${path}.provider must be openai`);
      if (invocation.model !== "gpt-5.6-sol") errors.push(`${path}.model must be gpt-5.6-sol`);
      if (invocation.authPath !== "codex-chatgpt" && invocation.authPath !== "responses-api") {
        errors.push(`${path}.authPath is invalid`);
      }
      if (typeof invocation.threadId !== "string" || invocation.threadId.length === 0) {
        errors.push(`${path}.threadId must be a non-empty string`);
      }
      if (!isIsoTimestamp(invocation.startedAt)) errors.push(`${path}.startedAt must be an ISO timestamp`);
      if (!isIsoTimestamp(invocation.completedAt)) errors.push(`${path}.completedAt must be an ISO timestamp`);
      if (!isRecord(invocation.usage)) {
        errors.push(`${path}.usage must be an object`);
      } else {
        exactShape(
          invocation.usage,
          [],
          ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"],
          `${path}.usage`,
          errors,
        );
        for (const [key, count] of Object.entries(invocation.usage)) {
          if (!isNonNegativeInteger(count)) errors.push(`${path}.usage.${key} must be a non-negative integer`);
        }
      }
      if (!Array.isArray(invocation.inputTraceIds) || invocation.inputTraceIds.some((id) => typeof id !== "string" || id.length === 0)) {
        errors.push(`${path}.inputTraceIds must be an array of non-empty strings`);
      }
      if (!Array.isArray(invocation.inputEvidenceDigests)) {
        errors.push(`${path}.inputEvidenceDigests must be an array`);
      } else {
        invocation.inputEvidenceDigests.forEach((digest, digestIndex) =>
          validateSha256(digest, `${path}.inputEvidenceDigests[${digestIndex}]`, errors),
        );
      }
      validateSha256(invocation.inputDigest, `${path}.inputDigest`, errors);
      validateSha256(invocation.outputDigest, `${path}.outputDigest`, errors);
      if (invocation.schemaVersion !== "traceforge.behavior-archaeology.v1") {
        errors.push(`${path}.schemaVersion is invalid`);
      }
      if (invocation.status !== "succeeded" && invocation.status !== "failed") {
        errors.push(`${path}.status is invalid`);
      }
    });
  }
  if (!isRecord(value.candidate)) {
    errors.push("proof.candidate must be an object");
  } else {
    exactShape(
      value.candidate,
      ["implementationId", "sourceDigest", "diffDigest"],
      ["codexThreadId", "baseCommit", "changedFiles"],
      "proof.candidate",
      errors,
    );
    if (typeof value.candidate.implementationId !== "string" || value.candidate.implementationId.length === 0) {
      errors.push("proof.candidate.implementationId must be a non-empty string");
    }
    validateSha256(value.candidate.sourceDigest, "proof.candidate.sourceDigest", errors);
    validateSha256(value.candidate.diffDigest, "proof.candidate.diffDigest", errors);
    for (const key of ["codexThreadId", "baseCommit"] as const) {
      if (key in value.candidate && (typeof value.candidate[key] !== "string" || value.candidate[key].length === 0)) {
        errors.push(`proof.candidate.${key} must be a non-empty string when present`);
      }
    }
    if (
      "changedFiles" in value.candidate &&
      (!Array.isArray(value.candidate.changedFiles) || value.candidate.changedFiles.some((file) => typeof file !== "string" || file.length === 0))
    ) {
      errors.push("proof.candidate.changedFiles must be an array of non-empty strings when present");
    }
  }
  if (!Array.isArray(value.limitations) || value.limitations.some((item) => typeof item !== "string")) {
    errors.push("proof.limitations must be an array of strings");
  }
  if (!isIsoTimestamp(value.generatedAt)) errors.push("proof.generatedAt must be an ISO timestamp");

  let hostGateGreen = false;
  if (value.hostVerification === undefined) {
    // Optional in MigrationProofBundle for deterministic lower-level callers.
  } else if (isRecord(value.hostVerification)) {
    const host = value.hostVerification;
    exactShape(
      host,
      ["testsPassed", "testsTotal", "source"],
      ["testsSkipped", "scope"],
      "proof.hostVerification",
      errors,
    );
    if (!isNonNegativeInteger(host.testsPassed)) errors.push("proof.hostVerification.testsPassed must be a non-negative integer");
    if (!isNonNegativeInteger(host.testsTotal)) errors.push("proof.hostVerification.testsTotal must be a non-negative integer");
    if (
      isNonNegativeInteger(host.testsPassed) &&
      isNonNegativeInteger(host.testsTotal) &&
      host.testsPassed > host.testsTotal
    ) {
      errors.push("proof.hostVerification.testsPassed cannot exceed testsTotal");
    }
    if ("testsSkipped" in host && !isNonNegativeInteger(host.testsSkipped)) {
      errors.push("proof.hostVerification.testsSkipped must be a non-negative integer");
    }
    if ("scope" in host && host.scope !== "candidate-safe" && host.scope !== "full-release") {
      errors.push("proof.hostVerification.scope is invalid");
    }
    if (host.source !== "recorded-command-log" && host.source !== "live-command-output") {
      errors.push("proof.hostVerification.source is invalid");
    }
    hostGateGreen =
      isNonNegativeInteger(host.testsPassed) &&
      isNonNegativeInteger(host.testsTotal) &&
      host.testsTotal > 0 &&
      host.testsPassed === host.testsTotal;
  } else {
    errors.push("proof.hostVerification must be an object");
  }

  const scenarioSet: Array<{ scenarioId: string; partition: string; proofDigest: string }> = [];
  const scenarioStatuses: string[] = [];
  if (!Array.isArray(value.scenarios) || value.scenarios.length === 0) {
    errors.push("proof.scenarios must be a non-empty array");
  } else {
    const setEntries = value.scenarios.map((scenario) => {
      if (!isRecord(scenario)) return scenario;
      return {
        scenarioId: scenario.scenarioId,
        partition: scenario.partition,
        proofDigest: scenario.proofDigest,
      };
    });
    scenarioSet.push(...validateScenarioSet(setEntries, "proof.scenarios", errors));

    value.scenarios.forEach((scenario, index) => {
      const path = `proof.scenarios[${index}]`;
      if (!isRecord(scenario)) {
        errors.push(`${path} must be an object`);
        return;
      }
      exactKeys(
        scenario,
        [
          "scenarioId",
          "partition",
          "proofDigest",
          "status",
          "legacyTraceId",
          "candidateTraceId",
          "assertionCount",
          "mismatchCount",
          "mismatches",
          "provenance",
        ],
        path,
        errors,
      );
      if (typeof scenario.status !== "string" || !VERIFICATION_STATUSES.has(scenario.status)) {
        errors.push(`${path}.status is invalid`);
      } else {
        scenarioStatuses.push(scenario.status);
      }
      for (const id of ["legacyTraceId", "candidateTraceId"] as const) {
        if (typeof scenario[id] !== "string" || scenario[id].length === 0) {
          errors.push(`${path}.${id} must be a non-empty string`);
        }
      }
      if (!isNonNegativeInteger(scenario.assertionCount)) errors.push(`${path}.assertionCount must be a non-negative integer`);
      if (!isNonNegativeInteger(scenario.mismatchCount)) errors.push(`${path}.mismatchCount must be a non-negative integer`);
      if (
        isNonNegativeInteger(scenario.assertionCount) &&
        isNonNegativeInteger(scenario.mismatchCount) &&
        scenario.mismatchCount > scenario.assertionCount
      ) {
        errors.push(`${path}.mismatchCount cannot exceed assertionCount`);
      }
      if (!Array.isArray(scenario.mismatches)) errors.push(`${path}.mismatches must be an array`);
      if (Array.isArray(scenario.mismatches)) {
        scenario.mismatches.forEach((mismatch, mismatchIndex) => {
          const mismatchPath = `${path}.mismatches[${mismatchIndex}]`;
          if (!isRecord(mismatch)) {
            errors.push(`${mismatchPath} must be an object`);
            return;
          }
          exactKeys(mismatch, ["path", "expected", "actual"], mismatchPath, errors);
          if (typeof mismatch.path !== "string" || mismatch.path.length === 0) {
            errors.push(`${mismatchPath}.path must be a non-empty string`);
          }
        });
        if (scenario.mismatchCount !== scenario.mismatches.length) {
          errors.push(`${path}.mismatchCount does not match mismatches.length`);
        }
      }
      if (scenario.status === "PASSED" && scenario.mismatchCount !== 0) {
        errors.push(`${path}.status PASSED requires zero mismatches`);
      }
      if (scenario.status === "PASSED" && scenario.assertionCount === 0) {
        errors.push(`${path}.status PASSED requires at least one assertion`);
      }
      if (scenario.status === "FAILED" && scenario.mismatchCount === 0) {
        errors.push(`${path}.status FAILED requires at least one mismatch`);
      }
      if (!isRecord(scenario.provenance)) {
        errors.push(`${path}.provenance must be an object`);
      } else {
        exactKeys(scenario.provenance, ["source", "detail"], `${path}.provenance`, errors);
        if (
          scenario.provenance.source !== "model-proposed" &&
          scenario.provenance.source !== "host-derived" &&
          scenario.provenance.source !== "host-authored"
        ) {
          errors.push(`${path}.provenance.source is invalid`);
        }
        if (typeof scenario.provenance.detail !== "string" || scenario.provenance.detail.length === 0) {
          errors.push(`${path}.provenance.detail must be a non-empty string`);
        }
      }
    });
  }

  if (scenarioSet.length > 0) {
    const computedScenarioSetDigest = sha256Digest(scenarioSet);
    if (value.scenarioSetDigest !== computedScenarioSetDigest) {
      errors.push("proof.scenarioSetDigest does not match the ordered scenario set");
    }
  }

  if (!isRecord(value.coverage)) {
    errors.push("proof.coverage must be an object");
  } else {
    const coverage = value.coverage;
    exactKeys(coverage, ["observed", "counterexample", "boundary", "heldOut", "total", "passed"], "proof.coverage", errors);
    const expected = {
      observed: scenarioSet.filter((item) => item.partition === "observed").length,
      counterexample: scenarioSet.filter((item) => item.partition === "counterexample").length,
      boundary: scenarioSet.filter((item) => item.partition === "boundary").length,
      heldOut: scenarioSet.filter((item) => item.partition === "held-out").length,
      total: scenarioSet.length,
      passed: scenarioStatuses.filter((status) => status === "PASSED").length,
    };
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (coverage[key] !== expectedValue) errors.push(`proof.coverage.${key} does not match the scenarios`);
    }
  }

  if (scenarioSet.length > 0 && scenarioStatuses.length === scenarioSet.length) {
    const expectedProofStatus = scenarioStatuses.every((status) => status === "PASSED") ? "PASSED" : "FAILED";
    if (value.status !== expectedProofStatus) errors.push("proof.status does not match the scenario statuses");
  }
  if (value.status === "PASSED" && !isRecord(value.hostVerification)) {
    errors.push("proof.status PASSED requires hostVerification");
  } else if (value.status === "PASSED" && !hostGateGreen) {
    errors.push("proof.status PASSED requires a fully passing hostVerification gate");
  }

  return { ...integrity, errors, valid: errors.length === 0 };
}

/**
 * Validate a v2 envelope against the untouched historical proof bytes. The
 * envelope adds current scenario-set commitments without rewriting history.
 */
export function validateSourceRunEnvelope(
  value: unknown,
  originalProofBytes: Uint8Array,
  recordedVerifierArtifactBytes: Uint8Array,
): ProofValidationResult {
  const integrity = verifyProofIntegrity(value);
  const errors = [...integrity.errors];
  if (!isRecord(value)) return { ...integrity, errors, valid: false };
  const originalProof = parseJsonBytes(originalProofBytes, "historical proof bytes", errors);
  const recordedVerifierArtifact = parseJsonBytes(
    recordedVerifierArtifactBytes,
    "recorded verifier artifact bytes",
    errors,
  );

  exactKeys(
    value,
    [
      "version",
      "originalProofPath",
      "originalProofDigest",
      "originalProofFileDigest",
      "recordedVerifierArtifactPath",
      "recordedVerifierArtifactFileDigest",
      "verifiedScenarioSet",
      "scenarioSetDigest",
      "hostGate",
      "generatedAt",
      "digest",
    ],
    "envelope",
    errors,
  );

  if (value.version !== "traceforge.source-run-envelope.v2") {
    errors.push("envelope.version must be traceforge.source-run-envelope.v2");
  }
  if (value.originalProofPath !== "proof.json") {
    errors.push("envelope.originalProofPath must identify the adjacent proof.json");
  }
  validateSha256(value.originalProofDigest, "envelope.originalProofDigest", errors);
  validateSha256(value.originalProofFileDigest, "envelope.originalProofFileDigest", errors);
  if (value.recordedVerifierArtifactPath !== "../../../apps/api/src/recorded-codex-build.generated.json") {
    errors.push("envelope.recordedVerifierArtifactPath must identify the checked-in recorded build artifact");
  }
  validateSha256(value.recordedVerifierArtifactFileDigest, "envelope.recordedVerifierArtifactFileDigest", errors);
  validateSha256(value.scenarioSetDigest, "envelope.scenarioSetDigest", errors);
  if (!isIsoTimestamp(value.generatedAt)) errors.push("envelope.generatedAt must be an ISO timestamp");

  const originalIntegrity = verifyProofIntegrity(originalProof);
  if (!originalIntegrity.valid) errors.push(...originalIntegrity.errors.map((error) => `original ${error}`));
  if (value.originalProofDigest !== originalIntegrity.claimedDigest) {
    errors.push("envelope.originalProofDigest does not match the historical proof");
  }
  if (value.originalProofFileDigest !== rawSha256Digest(originalProofBytes)) {
    errors.push("envelope.originalProofFileDigest does not match the historical proof bytes");
  }
  if (value.recordedVerifierArtifactFileDigest !== rawSha256Digest(recordedVerifierArtifactBytes)) {
    errors.push("envelope.recordedVerifierArtifactFileDigest does not match the recorded verifier artifact bytes");
  }

  const scenarioSet = validateScenarioSet(value.verifiedScenarioSet, "envelope.verifiedScenarioSet", errors);
  if (scenarioSet.length > 0 && value.scenarioSetDigest !== sha256Digest(scenarioSet)) {
    errors.push("envelope.scenarioSetDigest does not match the ordered scenario set");
  }

  const recordedScenarioSet = extractRecordedVerifierScenarioSet(recordedVerifierArtifact, errors);
  if (recordedScenarioSet.length > 0 && JSON.stringify(scenarioSet) !== JSON.stringify(recordedScenarioSet)) {
    errors.push("envelope.verifiedScenarioSet does not exactly match the recorded verifier final suite");
  }

  if (!isRecord(recordedVerifierArtifact)) {
    // The extractor reports the structural error.
  } else {
    if (recordedVerifierArtifact.verified !== true) errors.push("recorded verifier artifact must be marked verified");
    if (
      isRecord(originalProof) &&
      recordedVerifierArtifact.sourceRunId !== originalProof.migrationId
    ) {
      errors.push("recorded verifier artifact sourceRunId does not match the historical proof migrationId");
    }
  }

  if (!isRecord(originalProof) || !Array.isArray(originalProof.scenarios)) {
    errors.push("original proof scenarios are unavailable");
  } else {
    const originalIdentity = originalProof.scenarios.map((scenario) =>
      isRecord(scenario) ? { scenarioId: scenario.scenarioId, partition: scenario.partition } : scenario,
    );
    const envelopeIdentity = scenarioSet.map(({ scenarioId, partition }) => ({ scenarioId, partition }));
    if (JSON.stringify(originalIdentity) !== JSON.stringify(envelopeIdentity)) {
      errors.push("envelope.verifiedScenarioSet identity does not match the historical proof scenarios");
    }

    if (isRecord(originalProof.coverage)) {
      const expectedCoverage = {
        observed: scenarioSet.filter((entry) => entry.partition === "observed").length,
        counterexample: scenarioSet.filter((entry) => entry.partition === "counterexample").length,
        boundary: scenarioSet.filter((entry) => entry.partition === "boundary").length,
        heldOut: scenarioSet.filter((entry) => entry.partition === "held-out").length,
        total: scenarioSet.length,
        passed: originalProof.scenarios.filter((scenario) => isRecord(scenario) && scenario.status === "PASSED").length,
      };
      for (const [key, expectedValue] of Object.entries(expectedCoverage)) {
        if (originalProof.coverage[key] !== expectedValue) {
          errors.push(`original proof.coverage.${key} does not match the envelope scenario set`);
        }
      }
    } else {
      errors.push("original proof coverage is unavailable");
    }
  }

  if (!isRecord(value.hostGate)) {
    errors.push("envelope.hostGate must be an object");
  } else {
    exactKeys(value.hostGate, ["testsPassed", "testsTotal", "replayOnlyGuards"], "envelope.hostGate", errors);
    for (const key of ["testsPassed", "testsTotal", "replayOnlyGuards"] as const) {
      if (!isNonNegativeInteger(value.hostGate[key])) errors.push(`envelope.hostGate.${key} must be a non-negative integer`);
    }
    if (!isRecord(originalProof) || !isRecord(originalProof.hostVerification)) {
      errors.push("original proof host verification is unavailable");
    } else {
      if (value.hostGate.testsPassed !== originalProof.hostVerification.testsPassed) {
        errors.push("envelope.hostGate.testsPassed does not match the historical proof");
      }
      if (value.hostGate.testsTotal !== originalProof.hostVerification.testsTotal) {
        errors.push("envelope.hostGate.testsTotal does not match the historical proof");
      }
      if (value.hostGate.replayOnlyGuards !== originalProof.hostVerification.testsSkipped) {
        errors.push("envelope.hostGate.replayOnlyGuards does not match the historical proof's separate guards");
      }
    }
    if (!isRecord(recordedVerifierArtifact) || !isRecord(recordedVerifierArtifact.hostVerification)) {
      errors.push("recorded verifier artifact host verification is unavailable");
    } else {
      if (value.hostGate.testsPassed !== recordedVerifierArtifact.hostVerification.testsPassed) {
        errors.push("envelope.hostGate.testsPassed does not match the recorded verifier artifact");
      }
      if (value.hostGate.testsTotal !== recordedVerifierArtifact.hostVerification.testsTotal) {
        errors.push("envelope.hostGate.testsTotal does not match the recorded verifier artifact");
      }
      if (value.hostGate.replayOnlyGuards !== recordedVerifierArtifact.hostVerification.testsSkipped) {
        errors.push("envelope.hostGate.replayOnlyGuards does not match the recorded verifier artifact");
      }
    }
  }

  return { ...integrity, errors, valid: errors.length === 0 };
}
