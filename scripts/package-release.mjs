import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = resolve(import.meta.dirname, "..");
const release = resolve(root, ".traceforge/release");
const api = resolve(release, "api");
const web = resolve(release, "web");

const { stdout: dirtyOutput } = await execFileAsync(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  { cwd: root },
);
if (dirtyOutput.trim()) throw new Error("release packaging requires a clean tracked worktree");

await execFileAsync("pnpm", ["build"], {
  cwd: root,
  env: process.env,
  maxBuffer: 16 * 1024 * 1024,
});

await rm(release, { recursive: true, force: true });
await mkdir(api, { recursive: true });
await mkdir(web, { recursive: true });
await cp(resolve(root, "apps/api/dist"), resolve(api, "dist"), { recursive: true });
await cp(resolve(root, "apps/web/dist"), web, { recursive: true });

const { stdout: releaseShaOutput } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
const localRunnerPackage = JSON.parse(await readFile(resolve(root, "apps/local-runner/package.json"), "utf8"));
const localRunnerVersion = String(localRunnerPackage.version ?? "").trim();
if (!/^\d+\.\d+\.\d+$/.test(localRunnerVersion)) throw new Error("local runner package version is invalid");
const localRunnerManifest = await readFile(resolve(root, "apps/local-runner/src/manifest.ts"), "utf8");
if (!localRunnerManifest.includes(`LOCAL_RUNNER_VERSION = "${localRunnerVersion}"`)) {
  throw new Error("local runner package and manifest versions disagree");
}
const releaseIdentity = {
  sha: releaseShaOutput.trim(),
  version: `local-runner-v${localRunnerVersion}`,
  builtAt: new Date().toISOString(),
};
await writeFile(resolve(api, "release.json"), `${JSON.stringify(releaseIdentity, null, 2)}\n`, "utf8");

const packageJson = JSON.parse(await readFile(resolve(root, "apps/api/package.json"), "utf8"));
delete packageJson.devDependencies;
delete packageJson.dependencies["@openai/codex-sdk"];
packageJson.scripts = { start: "node dist/server.js" };
await writeFile(resolve(api, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

// Bind the server install to an exact npm dependency graph. The production
// host intentionally runs `npm ci --omit=dev --ignore-scripts` against this
// generated lock instead of resolving semver ranges during deployment.
await execFileAsync(
  "npm",
  ["install", "--package-lock-only", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: api, env: process.env, maxBuffer: 16 * 1024 * 1024 },
);

console.log(release);
