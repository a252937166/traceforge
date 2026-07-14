import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { validateCandidateSource } from "../src/candidate-policy.js";
import { findRepoRoot } from "../src/fixture.js";
import { LOCAL_RUNNER_MANIFEST } from "../src/manifest.js";

const execFileAsync = promisify(execFile);
const candidatePath = "apps/api/src/candidates/generated-return-workflow.ts";
const generatedFunctionStart = "export function executeGeneratedReturnWorkflow(rawInput: unknown): WorkflowExecution {\n";
const validatedInput = `${generatedFunctionStart}  const input = validateWorkflowInput(rawInput);\n`;
const evidenceBoundaryGuard = `  if (input.itemCondition !== "DAMAGED") {\n    throw Object.assign(\n      new Error("input is outside the evidence-bounded DAMAGED-only contract"),\n      { code: "OUTSIDE_EVIDENCE_BOUNDARY" },\n    );\n  }\n`;
const guardedPrefix = `${validatedInput}${evidenceBoundaryGuard}`;

function withEvidenceBoundaryGuard(source: string): string {
  const guarded = source.replace(validatedInput, `${validatedInput}${evidenceBoundaryGuard}`);
  assert.notEqual(guarded, source, "generated candidate input marker must exist");
  return guarded;
}

async function sources(): Promise<{ base: string; candidate: string }> {
  const repo = await findRepoRoot();
  const [{ stdout: base }, candidate] = await Promise.all([
    execFileAsync("git", ["show", `${LOCAL_RUNNER_MANIFEST.baseCommit}:${candidatePath}`], {
      cwd: repo,
      encoding: "utf8",
    }),
    readFile(`${repo}/${candidatePath}`, "utf8"),
  ]);
  return { base, candidate };
}

test("candidate policy accepts the complete one-function repair", async () => {
  const { base, candidate } = await sources();
  const evidence = validateCandidateSource(withEvidenceBoundaryGuard(candidate), base);
  assert.equal(evidence.changedFunction, "executeGeneratedReturnWorkflow");
  assert.deepEqual(evidence.allowedImports, ["../scenarios.js", "../types.js"]);
  assert.deepEqual(evidence.evidenceBoundary, {
    itemCondition: "DAMAGED",
    rejectionCode: "OUTSIDE_EVIDENCE_BOUNDARY",
    beforeBusinessLogic: true,
  });
  assert.match(evidence.sourceDigest, /^sha256:[a-f0-9]{64}$/);
});

test("candidate policy rejects a repaired function without the exact early evidence guard", async () => {
  const { base, candidate } = await sources();
  assert.throws(
    () => validateCandidateSource(candidate, base),
    /LOCAL_CANDIDATE_EVIDENCE_BOUNDARY_GUARD_REQUIRED/,
  );
  const wrongCode = withEvidenceBoundaryGuard(candidate).replace(
    '{ code: "OUTSIDE_EVIDENCE_BOUNDARY" },',
    '{ code: "DIFFERENT_BOUNDARY" },',
  );
  assert.throws(
    () => validateCandidateSource(wrongCode, base),
    /LOCAL_CANDIDATE_EVIDENCE_BOUNDARY_GUARD_REQUIRED/,
  );
});

test("candidate policy accepts an equivalent local Error code assignment", async () => {
  const { base, candidate } = await sources();
  const equivalent = withEvidenceBoundaryGuard(candidate).replace(
    `throw Object.assign(\n        new Error("replacement cannot be issued without sellable stock"),\n        { code: "INSUFFICIENT_SELLABLE_STOCK" },\n      );`,
    `const error = new Error("replacement cannot be issued without sellable stock") as Error & { code: string };\n      error.code = "INSUFFICIENT_SELLABLE_STOCK";\n      throw error;`,
  );
  assert.notEqual(equivalent, candidate);
  assert.doesNotThrow(() => validateCandidateSource(equivalent, base));
});

test("candidate policy rejects edits outside the generated function", async () => {
  const { base, candidate } = await sources();
  const guarded = withEvidenceBoundaryGuard(candidate);
  assert.throws(
    () => validateCandidateSource(`${guarded}\nexport const escaped = true;\n`, base),
    /LOCAL_CANDIDATE_CHANGED_OUTSIDE_GENERATED_FUNCTION/,
  );
});

test("candidate policy rejects process access and dynamic imports inside the repair", async () => {
  const { base, candidate } = await sources();
  const guarded = withEvidenceBoundaryGuard(candidate);
  const processCandidate = guarded.replace(
    guardedPrefix,
    `${guardedPrefix}  process.cwd();\n`,
  );
  assert.throws(
    () => validateCandidateSource(processCandidate, base),
    /LOCAL_CANDIDATE_(?:CALL|IDENTIFIER)_BLOCKED(?::process)?/,
  );

  const importCandidate = guarded.replace(
    guardedPrefix,
    `${guardedPrefix}  void import("node:fs");\n`,
  );
  assert.throws(
    () => validateCandidateSource(importCandidate, base),
    /LOCAL_CANDIDATE_DYNAMIC_IMPORT_BLOCKED/,
  );
});

test("candidate policy rejects constructor and builtin-module escape chains", async () => {
  const { base, candidate } = await sources();
  const guarded = withEvidenceBoundaryGuard(candidate);
  const constructorEscape = guarded.replace(
    guardedPrefix,
    `${guardedPrefix}  (() => {}).constructor("return process")();\n`,
  );
  assert.throws(
    () => validateCandidateSource(constructorEscape, base),
    /LOCAL_CANDIDATE_(?:NESTED_EXECUTABLE|CALL|PROPERTY)_BLOCKED/,
  );

  const builtinEscape = guarded.replace(
    guardedPrefix,
    `${guardedPrefix}  process.getBuiltinModule("node:fs").readFileSync("tests/workflow.test.ts");\n`,
  );
  assert.throws(
    () => validateCandidateSource(builtinEscape, base),
    /LOCAL_CANDIDATE_(?:CALL|PROPERTY|IDENTIFIER)_BLOCKED/,
  );

  const aliasEscape = guarded.replace(
    guardedPrefix,
    `${guardedPrefix}  const hidden = sideEffects["constructor"];\n`,
  );
  assert.throws(
    () => validateCandidateSource(aliasEscape, base),
    /LOCAL_CANDIDATE_COMPUTED_ACCESS_BLOCKED/,
  );

  const broadAssign = guarded.replace(
    '{ code: "INSUFFICIENT_SELLABLE_STOCK" },',
    '{ code: "DIFFERENT", extra: process.env },',
  );
  assert.throws(
    () => validateCandidateSource(broadAssign, base),
    /LOCAL_CANDIDATE_CALL_BLOCKED/,
  );
});
