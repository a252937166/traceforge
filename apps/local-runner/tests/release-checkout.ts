import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { promisify } from "node:util";
import { LOCAL_RUNNER_RELEASE_TAG } from "../src/manifest.js";

const execFileAsync = promisify(execFile);

export async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  })).stdout.trim();
}

/**
 * Gives fixture/integration tests their own release-tagged Git repository.
 * Production code still has no bypass: its checkout must contain the real,
 * correctly peeled LOCAL_RUNNER_RELEASE_TAG.
 */
export async function createReleaseTaggedCheckout(t: TestContext): Promise<{
  repoRoot: string;
  releaseCommit: string;
}> {
  const sourceRoot = await gitOutput(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "traceforge-release-checkout-test-"));
  const repoRoot = join(temporaryRoot, "repo");
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  await execFileAsync("git", ["clone", "--quiet", "--no-local", "--no-tags", sourceRoot, repoRoot], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const releaseCommit = await gitOutput(repoRoot, ["rev-parse", "HEAD"]);
  await gitOutput(repoRoot, [
    "-c", "user.name=TraceForge Tests",
    "-c", "user.email=tests@traceforge.invalid",
    "tag", "--annotate", LOCAL_RUNNER_RELEASE_TAG,
    "--message", "isolated Local Runner release custody test",
    releaseCommit,
  ]);
  return { repoRoot, releaseCommit };
}
