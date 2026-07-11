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
  const evidence = validateCandidateSource(candidate, base);
  assert.equal(evidence.changedFunction, "executeGeneratedReturnWorkflow");
  assert.deepEqual(evidence.allowedImports, ["../scenarios.js", "../types.js"]);
  assert.match(evidence.sourceDigest, /^sha256:[a-f0-9]{64}$/);
});

test("candidate policy rejects edits outside the generated function", async () => {
  const { base, candidate } = await sources();
  assert.throws(
    () => validateCandidateSource(`${candidate}\nexport const escaped = true;\n`, base),
    /LOCAL_CANDIDATE_CHANGED_OUTSIDE_GENERATED_FUNCTION/,
  );
});

test("candidate policy rejects process access and dynamic imports inside the repair", async () => {
  const { base, candidate } = await sources();
  const processCandidate = candidate.replace(
    "  const isObservedDomain =",
    "  process.cwd();\n  const isObservedDomain =",
  );
  assert.throws(
    () => validateCandidateSource(processCandidate, base),
    /LOCAL_CANDIDATE_(?:CALL|IDENTIFIER)_BLOCKED(?::process)?/,
  );

  const importCandidate = candidate.replace(
    "  const isObservedDomain =",
    '  void import("node:fs");\n  const isObservedDomain =',
  );
  assert.throws(
    () => validateCandidateSource(importCandidate, base),
    /LOCAL_CANDIDATE_DYNAMIC_IMPORT_BLOCKED/,
  );
});

test("candidate policy rejects constructor and builtin-module escape chains", async () => {
  const { base, candidate } = await sources();
  const constructorEscape = candidate.replace(
    "  const isObservedDomain =",
    '  (() => {}).constructor("return process")();\n  const isObservedDomain =',
  );
  assert.throws(
    () => validateCandidateSource(constructorEscape, base),
    /LOCAL_CANDIDATE_(?:NESTED_EXECUTABLE|CALL|PROPERTY)_BLOCKED/,
  );

  const builtinEscape = candidate.replace(
    "  const isObservedDomain =",
    '  process.getBuiltinModule("node:fs").readFileSync("tests/workflow.test.ts");\n  const isObservedDomain =',
  );
  assert.throws(
    () => validateCandidateSource(builtinEscape, base),
    /LOCAL_CANDIDATE_(?:CALL|PROPERTY|IDENTIFIER)_BLOCKED/,
  );

  const aliasEscape = candidate.replace(
    "  const isObservedDomain =",
    '  const hidden = sideEffects["constructor"];\n  const isObservedDomain =',
  );
  assert.throws(
    () => validateCandidateSource(aliasEscape, base),
    /LOCAL_CANDIDATE_COMPUTED_ACCESS_BLOCKED/,
  );
});
