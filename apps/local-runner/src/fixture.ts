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
import { LOCAL_RUNNER_MANIFEST, validateLocalRunnerManifest } from "./manifest.js";
import { sha256Text } from "./fixture-digest.js";

const execFileAsync = promisify(execFile);

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path !== "" && path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(path);
}

export interface LocalFixture {
  repoRoot: string;
  sessionRoot: string;
  sessionHome: string;
  sessionTmp: string;
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

async function verifyFile(path: string, digest: string): Promise<string> {
  const raw = await readFile(path, "utf8");
  if (sha256Text(raw) !== digest) throw new Error(`LOCAL_FIXTURE_DIGEST_MISMATCH:${path}`);
  return raw;
}

export async function findRepoRoot(start = process.cwd()): Promise<string> {
  return realpath((await git(start, ["rev-parse", "--show-toplevel"])).trim());
}

export async function prepareLocalFixture(start = process.cwd()): Promise<LocalFixture> {
  validateLocalRunnerManifest(LOCAL_RUNNER_MANIFEST);
  const repoRoot = await findRepoRoot(start);
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
  const sessionHome = join(sessionRoot, "home");
  const sessionTmp = join(sessionRoot, "tmp");
  const verifyCodexHome = join(sessionRoot, "verify-codex-home");
  const codexHome = resolve(
    process.env.TRACEFORGE_LOCAL_CODEX_HOME
      ?? join(homedir(), ".traceforge", "local-runner", "codex-home"),
  );
  const globalCodexHome = resolve(homedir(), ".codex");
  if (
    codexHome === globalCodexHome
    || isInside(repoRoot, codexHome)
    || isInside(sessionRoot, codexHome)
  ) {
    await rm(sessionRoot, { recursive: true, force: true });
    throw new Error("LOCAL_CODEX_HOME_MUST_BE_DEDICATED");
  }

  let verifierWorktreeAdded = false;
  try {
    await Promise.all([
      mkdir(join(writerRoot, dirname(GENERATED_CANDIDATE_PATH)), { recursive: true, mode: 0o700 }),
      mkdir(sessionHome, { recursive: true, mode: 0o700 }),
      mkdir(sessionTmp, { recursive: true, mode: 0o700 }),
      mkdir(verifyCodexHome, { recursive: true, mode: 0o700 }),
      mkdir(codexHome, { recursive: true, mode: 0o700 }),
    ]);
    const canonicalCodexHome = await realpath(codexHome);
    if (
      canonicalCodexHome === globalCodexHome
      || isInside(repoRoot, canonicalCodexHome)
      || isInside(sessionRoot, canonicalCodexHome)
    ) {
      throw new Error("LOCAL_CODEX_HOME_MUST_BE_DEDICATED");
    }
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
      sessionRoot: await realpath(sessionRoot),
      sessionHome: await realpath(sessionHome),
      sessionTmp: await realpath(sessionTmp),
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
