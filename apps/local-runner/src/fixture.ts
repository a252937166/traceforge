import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  GENERATED_CANDIDATE_PATH,
  codexRepairInputEvidence,
  validateCodexRepairInput,
  writeCodexRepairInputFiles,
  type CodexRepairInput,
  type CodexRepairInputEvidence,
} from "../../api/src/codex-adapter.js";
import {
  LOCAL_RUNNER_FIXTURE_TAG,
  LOCAL_RUNNER_MANIFEST,
  LOCAL_RUNNER_RELEASE_TAG,
  validateLocalRunnerManifest,
} from "./manifest.js";
import { sha256Text } from "./fixture-digest.js";

const execFileAsync = promisify(execFile);

function isSameOrInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(path);
}

export function assertDedicatedCodexHome(options: {
  codexHome: string;
  repoRoot: string;
  sessionRoot: string;
  globalCodexHome: string;
}): void {
  const codexHome = resolve(options.codexHome);
  const protectedRoots = [
    resolve(options.repoRoot),
    resolve(options.sessionRoot),
    resolve(options.globalCodexHome),
  ];
  if (protectedRoots.some((root) =>
    isSameOrInside(root, codexHome) || isSameOrInside(codexHome, root)
  )) {
    throw new Error("LOCAL_CODEX_HOME_MUST_BE_DEDICATED");
  }
}

export interface LocalFixture {
  repoRoot: string;
  /** Annotated/lightweight release ref whose peeled commit was verified by the host. */
  releaseTag: typeof LOCAL_RUNNER_RELEASE_TAG;
  /** Full Git SHA of the Local Runner executable checkout. */
  releaseCommit: string;
  sessionRoot: string;
  buildHome: string;
  buildTmp: string;
  verifyHome: string;
  verifyTmp: string;
  writerRoot: string;
  verifierRoot: string;
  codexHome: string;
  verifyCodexHome: string;
  input: CodexRepairInput;
  inputEvidence: CodexRepairInputEvidence;
  baseCandidateSource: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout;
}

async function hasCommit(cwd: string, commit: string): Promise<boolean> {
  return execFileAsync("git", ["cat-file", "-e", `${commit}^{commit}`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  }).then(() => true).catch(() => false);
}

async function ensureFixtureCommit(repoRoot: string): Promise<void> {
  if (await hasCommit(repoRoot, LOCAL_RUNNER_MANIFEST.baseCommit)) return;
  await git(repoRoot, [
    "fetch",
    "--no-tags",
    "--filter=blob:none",
    "origin",
    `refs/tags/${LOCAL_RUNNER_FIXTURE_TAG}:refs/tags/${LOCAL_RUNNER_FIXTURE_TAG}`,
  ]).catch(() => {
    throw new Error("LOCAL_FIXTURE_TAG_FETCH_FAILED");
  });
  const fetchedCommit = (await git(repoRoot, [
    "rev-list",
    "-n",
    "1",
    LOCAL_RUNNER_FIXTURE_TAG,
  ])).trim();
  if (fetchedCommit !== LOCAL_RUNNER_MANIFEST.baseCommit) {
    throw new Error("LOCAL_FIXTURE_TAG_COMMIT_MISMATCH");
  }
  if (!await hasCommit(repoRoot, LOCAL_RUNNER_MANIFEST.baseCommit)) {
    throw new Error("LOCAL_FIXTURE_BASE_COMMIT_MISSING");
  }
}

async function verifyFile(path: string, digest: string): Promise<string> {
  const raw = await readFile(path, "utf8");
  if (sha256Text(raw) !== digest) throw new Error(`LOCAL_FIXTURE_DIGEST_MISMATCH:${path}`);
  return raw;
}

export async function findRepoRoot(start = process.cwd()): Promise<string> {
  return realpath((await git(start, ["rev-parse", "--show-toplevel"])).trim());
}

export async function verifyCheckedOutReleaseCommit(
  repoRoot: string,
  declaredReleaseCommit: string | undefined,
): Promise<string> {
  if (!declaredReleaseCommit) throw new Error("LOCAL_RELEASE_SHA_REQUIRED");
  if (!/^[0-9a-f]{40}$/.test(declaredReleaseCommit)) {
    throw new Error("LOCAL_RELEASE_SHA_INVALID");
  }
  const checkedOutCommit = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
  if (!/^[0-9a-f]{40}$/.test(checkedOutCommit)) {
    throw new Error("LOCAL_CHECKOUT_SHA_INVALID");
  }
  if (checkedOutCommit !== declaredReleaseCommit) {
    throw new Error("LOCAL_RELEASE_SHA_MISMATCH");
  }
  const taggedCommit = await git(repoRoot, [
    "rev-parse",
    "--verify",
    `refs/tags/${LOCAL_RUNNER_RELEASE_TAG}^{commit}`,
  ]).then((value) => value.trim()).catch(() => {
    throw new Error("LOCAL_RELEASE_TAG_UNRESOLVED");
  });
  if (!/^[0-9a-f]{40}$/.test(taggedCommit)) {
    throw new Error("LOCAL_RELEASE_TAG_SHA_INVALID");
  }
  if (taggedCommit !== checkedOutCommit) {
    throw new Error("LOCAL_RELEASE_TAG_COMMIT_MISMATCH");
  }
  return checkedOutCommit;
}

/**
 * Re-checks release custody at the proof boundary. This catches a checkout or
 * release tag that was moved after the local session was prepared.
 */
export async function verifyLocalFixtureReleaseCustody(
  fixture: Pick<LocalFixture, "repoRoot" | "releaseTag" | "releaseCommit">,
): Promise<void> {
  if (fixture.releaseTag !== LOCAL_RUNNER_RELEASE_TAG) {
    throw new Error("LOCAL_RELEASE_TAG_INVALID");
  }
  await verifyCheckedOutReleaseCommit(fixture.repoRoot, fixture.releaseCommit);
}

export async function prepareLocalFixture(
  start = process.cwd(),
  declaredReleaseCommit = process.env.TRACEFORGE_LOCAL_RELEASE_SHA,
): Promise<LocalFixture> {
  validateLocalRunnerManifest(LOCAL_RUNNER_MANIFEST);
  const repoRoot = await findRepoRoot(start);
  const releaseCommit = await verifyCheckedOutReleaseCommit(repoRoot, declaredReleaseCommit);
  await ensureFixtureCommit(repoRoot);
  const evidenceRoot = join(repoRoot, "docs", "evidence", "live-champion-run", "codex");
  const [contractRaw, failedProofsRaw, visibleScenariosRaw] = await Promise.all([
    verifyFile(join(evidenceRoot, "behavior-contract.json"), LOCAL_RUNNER_MANIFEST.contractFileDigest),
    verifyFile(join(evidenceRoot, "failed-proofs.json"), LOCAL_RUNNER_MANIFEST.failedProofsFileDigest),
    verifyFile(join(evidenceRoot, "visible-scenarios.json"), LOCAL_RUNNER_MANIFEST.visibleScenariosFileDigest),
  ]);
  const input: CodexRepairInput = {
    behaviorContract: JSON.parse(contractRaw) as CodexRepairInput["behaviorContract"],
    failedProofs: JSON.parse(failedProofsRaw) as CodexRepairInput["failedProofs"],
    visibleScenarios: JSON.parse(visibleScenariosRaw) as CodexRepairInput["visibleScenarios"],
  };
  validateCodexRepairInput(input);
  const inputEvidence = codexRepairInputEvidence(input);
  if (inputEvidence.digest !== LOCAL_RUNNER_MANIFEST.repairInputDigest) {
    throw new Error("LOCAL_REPAIR_INPUT_DIGEST_MISMATCH");
  }

  const baseCandidateSource = await git(repoRoot, [
    "show",
    `${LOCAL_RUNNER_MANIFEST.baseCommit}:${GENERATED_CANDIDATE_PATH}`,
  ]);
  if (sha256Text(baseCandidateSource) !== LOCAL_RUNNER_MANIFEST.baseCandidateDigest) {
    throw new Error("LOCAL_BASE_CANDIDATE_DIGEST_MISMATCH");
  }

  const sessionRoot = await mkdtemp(join(tmpdir(), "traceforge-local-"));
  await chmod(sessionRoot, 0o700);
  const writerRoot = join(sessionRoot, "writer");
  const verifierRoot = join(sessionRoot, "verifier");
  const buildHome = join(sessionRoot, "build-home");
  const buildTmp = join(sessionRoot, "build-tmp");
  const verifyHome = join(sessionRoot, "verify-home");
  const verifyTmp = join(sessionRoot, "verify-tmp");
  const verifyCodexHome = join(sessionRoot, "verify-codex-home");
  const codexHome = resolve(
    process.env.TRACEFORGE_LOCAL_CODEX_HOME
      ?? join(homedir(), ".traceforge", "local-runner", "codex-home"),
  );
  const globalCodexHome = resolve(homedir(), ".codex");
  const [initialCodexHome, canonicalGlobalCodexHome] = await Promise.all([
    realpath(codexHome).catch(() => codexHome),
    realpath(globalCodexHome).catch(() => globalCodexHome),
  ]);
  try {
    assertDedicatedCodexHome({
      codexHome: initialCodexHome,
      repoRoot,
      sessionRoot,
      globalCodexHome: canonicalGlobalCodexHome,
    });
  } catch (error) {
    await rm(sessionRoot, { recursive: true, force: true });
    throw error;
  }

  let verifierWorktreeAdded = false;
  try {
    await Promise.all([
      mkdir(join(writerRoot, dirname(GENERATED_CANDIDATE_PATH)), { recursive: true, mode: 0o700 }),
      mkdir(buildHome, { recursive: true, mode: 0o700 }),
      mkdir(buildTmp, { recursive: true, mode: 0o700 }),
      mkdir(verifyHome, { recursive: true, mode: 0o700 }),
      mkdir(verifyTmp, { recursive: true, mode: 0o700 }),
      mkdir(verifyCodexHome, { recursive: true, mode: 0o700 }),
      mkdir(codexHome, { recursive: true, mode: 0o700 }),
    ]);
    const canonicalCodexHome = await realpath(codexHome);
    assertDedicatedCodexHome({
      codexHome: canonicalCodexHome,
      repoRoot,
      sessionRoot,
      globalCodexHome: canonicalGlobalCodexHome,
    });
    await writeFile(join(writerRoot, GENERATED_CANDIDATE_PATH), baseCandidateSource, {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeCodexRepairInputFiles(writerRoot, input);
    await git(writerRoot, ["init", "--quiet"]);
    await git(writerRoot, ["add", "--all"]);
    await git(writerRoot, [
      "-c", "user.name=TraceForge Local Runner",
      "-c", "user.email=local-runner@traceforge.invalid",
      "commit", "--quiet", "-m", "bounded writer fixture",
    ]);

    await git(repoRoot, [
      "worktree",
      "add",
      "--detach",
      verifierRoot,
      LOCAL_RUNNER_MANIFEST.baseCommit,
    ]);
    verifierWorktreeAdded = true;

    return {
      repoRoot,
      releaseTag: LOCAL_RUNNER_RELEASE_TAG,
      releaseCommit,
      sessionRoot: await realpath(sessionRoot),
      buildHome: await realpath(buildHome),
      buildTmp: await realpath(buildTmp),
      verifyHome: await realpath(verifyHome),
      verifyTmp: await realpath(verifyTmp),
      writerRoot: await realpath(writerRoot),
      verifierRoot: await realpath(verifierRoot),
      codexHome: canonicalCodexHome,
      verifyCodexHome: await realpath(verifyCodexHome),
      input,
      inputEvidence,
      baseCandidateSource,
    };
  } catch (error) {
    if (verifierWorktreeAdded) {
      await git(repoRoot, ["worktree", "remove", "--force", verifierRoot]).catch(() => "");
    }
    await rm(sessionRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupLocalFixture(fixture: LocalFixture): Promise<void> {
  await git(fixture.repoRoot, ["worktree", "remove", "--force", fixture.verifierRoot]).catch(() => "");
  await rm(fixture.sessionRoot, { recursive: true, force: true });
}
