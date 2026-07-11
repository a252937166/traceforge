import assert from "node:assert/strict";
import test from "node:test";
import { spawnAppServer } from "../src/app-server-client.js";
import { cleanupLocalFixture, prepareLocalFixture } from "../src/fixture.js";
import {
  TRACEFORGE_BUILD_PROFILE_ID,
  buildHardenedAppServerArgs,
  buildHardenedAppServerEnvironment,
  writeCodexPermissionConfig,
} from "../src/permissions.js";
import { resolveLocalCodexExecutable } from "../src/runner-actions.js";

test(
  "real Codex App Server loads the pinned permission profile without global auth",
  { skip: process.env.TRACEFORGE_REAL_CODEX !== "1" },
  async (t) => {
    const fixture = await prepareLocalFixture();
    t.after(() => cleanupLocalFixture(fixture));
    const config = await writeCodexPermissionConfig({
      codexHome: fixture.verifyCodexHome,
      workspaceRoot: fixture.writerRoot,
      sessionHome: fixture.buildHome,
      sessionTmp: fixture.buildTmp,
      writablePaths: ["apps/api/src/candidates/generated-return-workflow.ts"],
      profileId: TRACEFORGE_BUILD_PROFILE_ID,
      credentialStore: "file",
    });
    const client = await spawnAppServer({
      executable: await resolveLocalCodexExecutable(
        process.env.TRACEFORGE_CODEX_BIN ?? "codex",
        process.env,
      ),
      args: buildHardenedAppServerArgs(),
      cwd: fixture.writerRoot,
      env: buildHardenedAppServerEnvironment(config),
      expectedPermissionProfile: TRACEFORGE_BUILD_PROFILE_ID,
      workspaceRoot: fixture.writerRoot,
      requestTimeoutMs: 15_000,
    });
    t.after(() => client.close());

    const account = await client.readAccount();
    assert.equal(account.account, null);
    const configRead = await client.request<{ config: Record<string, unknown> }>(
      "config/read",
      { cwd: fixture.writerRoot, includeLayers: false },
    );
    assert.equal(configRead.config.default_permissions, TRACEFORGE_BUILD_PROFILE_ID);
  },
);
