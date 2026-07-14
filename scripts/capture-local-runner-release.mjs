import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXPECTED_TESTS = 15;
const EXPECTED_BOUNDARY_CHECKS = 1;
const EXPECTED_HOST_GATES = EXPECTED_TESTS + EXPECTED_BOUNDARY_CHECKS;
const EXPECTED_SCENARIOS = 7;
const EXPECTED_ASSERTIONS = 35;
const ALLOWED_CANDIDATE_PATH = "apps/api/src/candidates/generated-return-workflow.ts";
const STOCKOUT_SCENARIO_ID = "counterexample-vip-damaged-no-sellable";
const RUN_TIMEOUT_MS = 20 * 60_000;

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function validateExpectedVersion(value) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error("TRACEFORGE_LOCAL_EXPECTED_VERSION_INVALID");
  }
  return value;
}

function validateExpectedTag(value) {
  if (!/^local-runner-v[0-9A-Za-z.-]+$/.test(value)) {
    throw new Error("TRACEFORGE_LOCAL_EXPECTED_TAG_INVALID");
  }
  return value;
}

function validateReleaseSha(value) {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("TRACEFORGE_LOCAL_RELEASE_SHA_INVALID");
  return value;
}

function validateBootstrapUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TRACEFORGE_LOCAL_BOOTSTRAP_URL_INVALID");
  }
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || !/^\/session\/[A-Za-z0-9_-]{20,}$/.test(url.pathname)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("TRACEFORGE_LOCAL_BOOTSTRAP_URL_INVALID");
  }
  return url;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function sha256Digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function sha256Text(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function exists(path) {
  return access(path).then(() => true).catch(() => false);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createEvidenceStaging(targetDir) {
  const parent = dirname(targetDir);
  if (parent === targetDir) throw new Error("TRACEFORGE_LOCAL_EVIDENCE_DIR_INVALID");
  await mkdir(parent, { recursive: true });
  try {
    const info = await lstat(targetDir);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("TRACEFORGE_LOCAL_EVIDENCE_DIR_INVALID");
    }
    if ((await readdir(targetDir)).length !== 0) {
      throw new Error("TRACEFORGE_LOCAL_EVIDENCE_DIR_NOT_EMPTY");
    }
    // Remove only the already-validated empty directory. The target remains
    // absent until the complete staging directory is atomically published.
    await rmdir(targetDir);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return mkdtemp(join(parent, `.${basename(targetDir)}.staging-`));
}

async function pageFetch(page, path, type) {
  const response = await page.evaluate(async ({ requestPath, responseType }) => {
    const result = await fetch(requestPath, { credentials: "same-origin" });
    const body = responseType === "json" ? await result.json() : await result.text();
    return { ok: result.ok, status: result.status, body };
  }, { requestPath: path, responseType: type });
  if (!response.ok) throw new Error(`LOCAL_CAPTURE_FETCH_FAILED:${path}:${response.status}`);
  return response.body;
}

async function registeredWorktrees(cloneDir) {
  const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
    cwd: cloneDir,
    encoding: "utf8",
  });
  return stdout.split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)));
}

async function discoverCleanupScope(cloneDir) {
  const worktrees = await registeredWorktrees(cloneDir);
  const verifierPaths = worktrees.filter((worktree) => {
    const parent = dirname(worktree);
    return basename(worktree) === "verifier"
      && basename(parent).startsWith("traceforge-local-");
  });
  if (verifierPaths.length !== 1) {
    throw new Error("LOCAL_CAPTURE_VERIFIER_SCOPE_INVALID");
  }
  const verifierRoot = verifierPaths[0];
  const sessionRoot = dirname(verifierRoot);
  const verifierGitFile = await readFile(join(verifierRoot, ".git"), "utf8");
  const gitDirMatch = verifierGitFile.match(/^gitdir: (.+)$/m);
  if (!gitDirMatch) throw new Error("LOCAL_CAPTURE_VERIFIER_GITDIR_INVALID");
  const verifierGitDir = resolve(verifierRoot, gitDirMatch[1]);
  return { sessionRoot, verifierRoot, verifierGitDir };
}

async function waitForServerClose(origin, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await fetch(`${origin}/api/state`, { signal: AbortSignal.timeout(1_000) })
      .then(() => true)
      .catch(() => false);
    if (!open) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  return false;
}

if (process.env.TRACEFORGE_LOCAL_NO_BROWSER !== "1") {
  throw new Error("TRACEFORGE_LOCAL_NO_BROWSER_REQUIRED");
}
const expectedRunnerVersion = validateExpectedVersion(
  requiredEnvironment("TRACEFORGE_LOCAL_EXPECTED_VERSION"),
);
const expectedReleaseTag = validateExpectedTag(
  requiredEnvironment("TRACEFORGE_LOCAL_EXPECTED_TAG"),
);
if (expectedReleaseTag !== `local-runner-v${expectedRunnerVersion}`) {
  throw new Error("TRACEFORGE_LOCAL_EXPECTED_RELEASE_MISMATCH");
}
const bootstrapUrl = validateBootstrapUrl(requiredEnvironment("TRACEFORGE_LOCAL_BOOTSTRAP_URL"));
const evidenceDir = resolve(requiredEnvironment("TRACEFORGE_LOCAL_EVIDENCE_DIR"));
const expectedReleaseSha = validateReleaseSha(requiredEnvironment("TRACEFORGE_LOCAL_RELEASE_SHA"));
const repositoryRoot = resolve(import.meta.dirname, "..");
const cloneDir = resolve(process.env.TRACEFORGE_LOCAL_CLONE_DIR ?? repositoryRoot);
const cloneHead = await execFileAsync("git", ["rev-parse", "HEAD"], {
  cwd: cloneDir,
  encoding: "utf8",
}).then(({ stdout }) => stdout.trim()).catch(() => {
  throw new Error("LOCAL_CAPTURE_CLONE_HEAD_UNAVAILABLE");
});
if (cloneHead !== expectedReleaseSha) throw new Error("LOCAL_CAPTURE_CLONE_RELEASE_MISMATCH");

const requireFromClone = createRequire(join(cloneDir, "package.json"));
const { chromium } = requireFromClone("@playwright/test");
const manifestModule = await import(pathToFileURL(join(cloneDir, "apps/local-runner/src/manifest.ts")).href);
const manifest = manifestModule.LOCAL_RUNNER_MANIFEST;
if (manifest.runnerVersion !== expectedRunnerVersion) {
  throw new Error("LOCAL_CAPTURE_MANIFEST_VERSION_MISMATCH");
}
if (manifest.releaseTag !== expectedReleaseTag) {
  throw new Error("LOCAL_CAPTURE_MANIFEST_TAG_MISMATCH");
}

const stagingDir = await createEvidenceStaging(evidenceDir);
const pageErrors = [];
let browser = null;
let context = null;
let page = null;
let cleanupScope = null;
let deleteRequested = false;
let deletedObserved = false;
let runCompleted = false;
let primaryError = null;

try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.on("pageerror", () => pageErrors.push("PAGE_ERROR"));

  // The one-time bootstrap capability is consumed exactly once and is never
  // copied into diagnostics. Navigation failures are deliberately opaque.
  try {
    await page.goto(bootstrapUrl.href, { waitUntil: "domcontentloaded" });
  } catch {
    throw new Error("LOCAL_CAPTURE_NAVIGATION_FAILED");
  }
  const startButton = page.getByRole("button", { name: "Start local build" });
  await startButton.waitFor({ state: "visible", timeout: 120_000 });

  const preflightState = await pageFetch(page, "/api/state", "json");
  assert.equal(preflightState.phase, "ready");
  assert.equal(preflightState.localReleaseCommit, expectedReleaseSha);
  assert.equal(preflightState.model, manifest.model);
  const noCodexTurnBeforeStart = !preflightState.threadId
    && !preflightState.result
    && preflightState.provenance?.codex === "waiting"
    && preflightState.provenance?.verifier === "waiting"
    && preflightState.provenance?.proof === "waiting";
  assert.equal(noCodexTurnBeforeStart, true);

  await writeJson(join(stagingDir, "preflight.json"), {
    capturedAt: new Date().toISOString(),
    runnerVersion: manifest.runnerVersion,
    releaseTag: manifest.releaseTag,
    releaseCommit: expectedReleaseSha,
    fixtureTag: manifest.fixtureTag,
    fixtureBaseCommit: manifest.baseCommit,
    repairInputDigest: manifest.repairInputDigest,
    codexVersion: preflightState.codexVersion,
    signedIn: true,
    model: manifest.model,
    modelAvailable: true,
    phase: preflightState.phase,
    loopbackOnly: true,
    noCodexTurnBeforeStart,
  });

  await startButton.click();
  // The release clone's own git registry is the only cleanup authority. A
  // capture is invalid unless it identifies exactly one verifier worktree.
  cleanupScope = await discoverCleanupScope(cloneDir);
  await page.waitForFunction(
    () => ["passed", "failed"].includes(document.querySelector("#phase")?.textContent?.trim() ?? ""),
    undefined,
    { timeout: RUN_TIMEOUT_MS },
  );

  const terminalState = await pageFetch(page, "/api/state", "json");
  if (terminalState.phase !== "passed") throw new Error("LOCAL_CAPTURE_RUN_FAILED");
  const proof = await pageFetch(page, "/api/proof", "json");
  const diff = await pageFetch(page, "/api/diff", "text");
  assert.equal(proof.status, "PASSED");
  assert.equal(proof.runner.version, expectedRunnerVersion);
  assert.equal(proof.runner.releaseTag, expectedReleaseTag);
  assert.equal(proof.runner.releaseCommit, expectedReleaseSha);
  assert.equal(proof.verification.tests.discovered, EXPECTED_TESTS);
  assert.equal(proof.verification.tests.passed, EXPECTED_TESTS);
  assert.equal(proof.verification.tests.failed, 0);
  assert.equal(proof.verification.tests.skipped, 0);
  assert.equal(proof.verification.tests.candidateSafeTotal, EXPECTED_TESTS);
  assert.deepEqual(proof.verification.evidenceBoundary, {
    status: "PASSED",
    inputCondition: "SELLABLE",
    supportedCondition: "DAMAGED",
    failureCode: "OUTSIDE_EVIDENCE_BOUNDARY",
    failureMessage: "input is outside the evidence-bounded DAMAGED-only contract",
    resultReturned: false,
    sideEffectsCount: 0,
  });
  assert.deepEqual(proof.verification.hostGates, {
    passed: EXPECTED_HOST_GATES,
    total: EXPECTED_HOST_GATES,
    focusedTests: EXPECTED_TESTS,
    evidenceBoundaryChecks: EXPECTED_BOUNDARY_CHECKS,
  });
  assert.deepEqual(
    proof.verification.commands.map(({ name }) => name),
    ["install", "apiTests", "boundaryProbe", "generatedSuite"],
  );
  assert.equal(terminalState.result.testsPassed, EXPECTED_HOST_GATES);
  assert.equal(terminalState.result.testsTotal, EXPECTED_HOST_GATES);
  assert.equal(proof.verification.suite.summary.total, EXPECTED_SCENARIOS);
  assert.equal(proof.verification.suite.summary.passed, EXPECTED_SCENARIOS);
  assert.equal(proof.verification.suite.summary.failed, 0);
  assert.equal(proof.verification.suiteValidation.passed, true);
  assert.deepEqual(proof.candidate.changedFiles, [ALLOWED_CANDIDATE_PATH]);
  assert.equal(sha256Text(diff), proof.candidate.diffDigest);

  const runs = proof.verification.suite.runs;
  const assertionCount = runs.reduce((total, run) => total + run.assertionCount, 0);
  const mismatchCount = runs.reduce((total, run) => total + run.mismatchCount, 0);
  assert.equal(assertionCount, EXPECTED_ASSERTIONS);
  assert.equal(mismatchCount, 0);
  const stockout = runs.find(({ scenarioId }) => scenarioId === STOCKOUT_SCENARIO_ID);
  assert.ok(stockout, "stockout scenario must be executed");
  assert.equal(stockout.status, "PASSED");
  assert.equal(stockout.assertionCount, 5);
  assert.equal(stockout.mismatchCount, 0);
  assert.equal(pageErrors.length, 0);

  const { digest, ...proofBody } = proof;
  const independentProofDigestValid = digest === sha256Digest(proofBody);
  assert.equal(independentProofDigestValid, true);
  let cloneProofVerifierValid = null;
  try {
    const localRepair = await import(pathToFileURL(join(cloneDir, "apps/local-runner/src/local-repair.ts")).href);
    cloneProofVerifierValid = localRepair.verifyLocalProofDigest(proof, expectedReleaseSha);
    assert.equal(cloneProofVerifierValid, true);
  } catch (error) {
    if (cloneProofVerifierValid === false) throw error;
  }

  await writeJson(join(stagingDir, "proof.json"), proof);
  await writeFile(join(stagingDir, "candidate.diff"), diff, "utf8");
  const screenshot = await page.screenshot({
    type: "png",
    fullPage: true,
    scale: "device",
    animations: "disabled",
    caret: "hide",
  });
  await writeFile(join(stagingDir, "screenshot.png"), screenshot);
  await writeJson(join(stagingDir, "run-summary.json"), {
    capturedAt: new Date().toISOString(),
    releaseTag: proof.runner.releaseTag,
    releaseCommit: proof.runner.releaseCommit,
    runnerVersion: proof.runner.version,
    route: "headless Playwright clicked Start local build on the loopback UI",
    terminalPhase: terminalState.phase,
    pageErrors,
    proofId: proof.proofId,
    proofDigest: proof.digest,
    proofDigestValid: independentProofDigestValid && cloneProofVerifierValid !== false,
    proofDigestVerifier: cloneProofVerifierValid === true ? "clone-local-repair" : "independent-canonical-sha256",
    diffDigest: proof.candidate.diffDigest,
    model: proof.codex.model,
    threadId: proof.codex.threadId,
    turnId: proof.codex.turnId,
    tokenUsage: proof.codex.usage,
    tests: proof.verification.tests,
    evidenceBoundary: proof.verification.evidenceBoundary,
    hostGates: proof.verification.hostGates,
    scenarios: proof.verification.suite.summary,
    assertions: assertionCount,
    mismatches: mismatchCount,
    stockoutScenario: { scenarioId: stockout.scenarioId, status: stockout.status, assertions: stockout.assertionCount },
    changedFiles: proof.candidate.changedFiles,
  });
  runCompleted = true;
} catch (error) {
  const message = error instanceof Error ? error.message : "LOCAL_CAPTURE_FAILED";
  primaryError = message.includes(bootstrapUrl.href) || message.includes(bootstrapUrl.pathname)
    ? new Error("LOCAL_CAPTURE_BROWSER_FAILED")
    : error instanceof Error ? error : new Error("LOCAL_CAPTURE_FAILED");
} finally {
  try {
    const phase = await page?.locator("#phase").textContent().catch(() => "");
    if (phase?.trim() === "deleted") {
      deletedObserved = true;
    } else if (page) {
      const deleteButton = page.getByRole("button", { name: /delete session/i });
      if (await deleteButton.isVisible().catch(() => false)) {
        deleteRequested = true;
        await deleteButton.click();
        await page.waitForFunction(
          () => document.querySelector("#phase")?.textContent?.trim() === "deleted",
          undefined,
          { timeout: 15_000 },
        );
        deletedObserved = true;
      }
    }
  } catch {
    deletedObserved = false;
  }
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);

  const loopbackServerClosed = await waitForServerClose(bootstrapUrl.origin);
  const sessionRootDeleted = cleanupScope ? !await exists(cleanupScope.sessionRoot) : false;
  const writerRootDeleted = cleanupScope ? !await exists(join(cleanupScope.sessionRoot, "writer")) : false;
  const verifierRootDeleted = cleanupScope ? !await exists(join(cleanupScope.sessionRoot, "verifier")) : false;
  const verifierWorktreeRemoved = cleanupScope?.verifierGitDir
    ? !await exists(cleanupScope.verifierGitDir)
    : false;
  const verifierWorktreeUnregistered = cleanupScope
    ? await registeredWorktrees(cloneDir)
      .then((worktrees) => !worktrees.includes(cleanupScope.verifierRoot))
      .catch(() => false)
    : false;
  const codexHome = resolve(
    process.env.TRACEFORGE_LOCAL_CODEX_HOME
      ?? join(homedir(), ".traceforge", "local-runner", "codex-home"),
  );
  const codexHomeLockReleased = !await exists(join(codexHome, ".traceforge-runner.lock"));
  const cleanup = {
    checkedAt: new Date().toISOString(),
    sessionPhase: deletedObserved ? "deleted" : "cleanup-unconfirmed",
    deleteRequested,
    sessionRootDeleted,
    writerRootDeleted,
    verifierRootDeleted,
    verifierWorktreeRemoved,
    verifierWorktreeUnregistered,
    codexHomeLockReleased,
    loopbackServerClosed,
  };
  try {
    await writeJson(join(stagingDir, "cleanup.json"), cleanup);
  } catch {
    primaryError ??= new Error("LOCAL_CAPTURE_CLEANUP_EVIDENCE_FAILED");
  }
  const cleanupPassed = Object.values(cleanup)
    .every((value) => typeof value !== "boolean" || value);
  if (!runCompleted || !cleanupScope || !cleanupPassed) {
    primaryError ??= new Error("LOCAL_CAPTURE_CLEANUP_INCOMPLETE");
  }
}

if (primaryError) {
  await rm(stagingDir, { recursive: true, force: true });
  throw primaryError;
}
try {
  await rename(stagingDir, evidenceDir);
} catch {
  await rm(stagingDir, { recursive: true, force: true });
  throw new Error("LOCAL_CAPTURE_EVIDENCE_PUBLISH_FAILED");
}
process.stdout.write(`${evidenceDir}\n`);
