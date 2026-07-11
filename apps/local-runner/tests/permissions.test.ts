import * as TOML from "@iarna/toml";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  TRACEFORGE_BUILD_PROFILE_ID,
  TRACEFORGE_VERIFY_PROFILE_ID,
  buildHardenedAppServerArgs,
  buildHardenedAppServerEnvironment,
  writeCodexPermissionConfig,
} from "../src/permissions.js";

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "traceforge-permissions-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = join(root, "codex-home");
  const workspaceRoot = join(root, "writer");
  const sessionHome = join(root, "home");
  const sessionTmp = join(root, "tmp");
  const store = join(root, "pnpm-store");
  const candidate = "apps/api/src/candidates/generated-return-workflow.ts";
  await Promise.all([
    mkdir(codexHome, { recursive: true }),
    mkdir(join(workspaceRoot, dirname(candidate)), { recursive: true }),
    mkdir(sessionHome, { recursive: true }),
    mkdir(sessionTmp, { recursive: true }),
    mkdir(store, { recursive: true }),
  ]);
  await writeFile(join(workspaceRoot, candidate), "export const candidate = true;\n");
  return { root, codexHome, workspaceRoot, sessionHome, sessionTmp, store, candidate };
}

test("writes an atomic least-privilege permission profile", async (t) => {
  const paths = await fixture(t);
  const config = await writeCodexPermissionConfig({
    ...paths,
    writablePaths: [paths.candidate],
    additionalReadRoots: [paths.store],
    profileId: TRACEFORGE_BUILD_PROFILE_ID,
  });
  const parsed = TOML.parse(await readFile(config.configPath, "utf8")) as Record<string, any>;
  const profile = parsed.permissions[TRACEFORGE_BUILD_PROFILE_ID];
  assert.equal(parsed.default_permissions, TRACEFORGE_BUILD_PROFILE_ID);
  assert.equal(parsed.approval_policy, "never");
  assert.equal(parsed.allow_login_shell, false);
  assert.equal(parsed.history.persistence, "none");
  assert.equal(parsed.analytics.enabled, false);
  assert.equal(profile.workspace_roots[config.workspaceRoot], true);
  assert.equal(profile.filesystem[":root"], "deny");
  assert.equal(profile.filesystem[":minimal"], "read");
  assert.equal(profile.filesystem[":workspace_roots"]["."], "read");
  assert.equal(profile.filesystem[":workspace_roots"][paths.candidate], "write");
  assert.equal(profile.filesystem[config.sessionHome], "write");
  assert.equal(profile.filesystem[config.sessionTmp], "write");
  const canonicalStore = await realpath(paths.store);
  assert.ok(config.additionalReadRoots.includes(canonicalStore));
  assert.equal(profile.filesystem[canonicalStore], "read");
  assert.equal(profile.network.enabled, false);
  assert.equal(config.toolPath.split(":")[0], dirname(process.execPath));
  assert.equal((await stat(config.configPath)).mode & 0o777, 0o600);
  assert.equal((await stat(config.codexHome)).mode & 0o777, 0o700);
});

test("builds a strict app-server launch without inheriting secrets", async (t) => {
  const paths = await fixture(t);
  const config = await writeCodexPermissionConfig({
    ...paths,
    writablePaths: [paths.candidate],
    profileId: TRACEFORGE_VERIFY_PROFILE_ID,
    transportEnvironment: {
      HTTPS_PROXY: "http://127.0.0.1:3128",
      NO_PROXY: "localhost,127.0.0.1",
    },
  });
  const args = buildHardenedAppServerArgs();
  assert.deepEqual(args.slice(0, 3), ["app-server", "--stdio", "--strict-config"]);
  assert.ok(args.includes("plugins"));
  assert.ok(args.includes("hooks"));
  assert.ok(args.includes("computer_use"));

  const env = buildHardenedAppServerEnvironment(config);
  assert.equal(env.CODEX_HOME, config.codexHome);
  assert.equal(env.HOME, config.sessionHome);
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:3128");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
});

test("rejects traversal, globs, symlinks, credential roots, and credentialed proxies", async (t) => {
  const paths = await fixture(t);
  await assert.rejects(
    writeCodexPermissionConfig({ ...paths, writablePaths: ["../escape"] }),
    /WRITE_PATH_OUTSIDE_ROOT/,
  );
  await assert.rejects(
    writeCodexPermissionConfig({ ...paths, writablePaths: ["apps\/**"] }),
    /WRITE_PATH_INVALID/,
  );
  await assert.rejects(
    writeCodexPermissionConfig({
      ...paths,
      writablePaths: [paths.candidate],
      additionalReadRoots: [paths.codexHome],
    }),
    /READ_ROOT_BLOCKED/,
  );
  await assert.rejects(
    writeCodexPermissionConfig({
      ...paths,
      writablePaths: [paths.candidate],
      transportEnvironment: { HTTPS_PROXY: "https://user:pass@example.com" },
    }),
    /TRANSPORT_PROXY_BLOCKED/,
  );
});
