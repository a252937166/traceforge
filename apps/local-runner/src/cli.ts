#!/usr/bin/env node
import { createRequire } from "node:module";
import type { LocalRunnerServer } from "./local-server.js";

const require = createRequire(import.meta.url);
const { assertSupportedNodeVersion } = require("../../../scripts/check-node-version.cjs") as {
  assertSupportedNodeVersion(version?: string): void;
};

// Keep this check before dynamically importing the Runner graph. Older Node 22
// releases must receive a useful error instead of failing while linking
// `node:sqlite` or another runtime-only dependency.
assertSupportedNodeVersion(process.versions.node);

async function main(): Promise<void> {
  const [
    { prepareLocalFixture },
    { openLocalRunnerPage, shouldOpenLocalRunnerPage },
    { TraceForgeLocalActions },
    { startLocalRunnerServer },
    { LocalRunnerSession },
  ] = await Promise.all([
    import("./fixture.js"),
    import("./open-browser.js"),
    import("./runner-actions.js"),
    import("./local-server.js"),
    import("./session.js"),
  ]);
  const fixture = await prepareLocalFixture();
  const actions = new TraceForgeLocalActions(fixture);
  const session = new LocalRunnerSession(actions);
  let server: LocalRunnerServer | null = null;
  let shuttingDown = false;

  const shutdown = async (exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await session.delete().catch(() => undefined);
    await server?.close().catch(() => undefined);
    process.exit(exitCode);
  };

  // Keep both handlers installed while async cleanup runs. Package-manager
  // wrappers and terminals may deliver more than one signal to the foreground
  // process group; a once-listener would let the second signal kill Node before
  // its verifier worktree is removed.
  process.on("SIGINT", () => void shutdown(130));
  process.on("SIGTERM", () => void shutdown(143));

  try {
    server = await startLocalRunnerServer(session);
    process.stdout.write(
      `\nTraceForge Local Runner\n${server.url}\n\nThe session is bound to 127.0.0.1. No Codex writing turn or verifier command runs before confirmation.\n`,
    );
    session.on("change", (snapshot) => {
      const detail = snapshot.errorCode ? ` · ${snapshot.errorCode}` : "";
      process.stdout.write(`[${snapshot.phase}] ${snapshot.title}${detail}\n`);
    });
    void session.initialize().catch(() => undefined);
    if (shouldOpenLocalRunnerPage()) {
      await openLocalRunnerPage(server.url).catch(() => {
        process.stdout.write("The browser did not open automatically. Open the localhost URL above.\n");
      });
    } else {
      process.stdout.write("Automatic browser opening is disabled for this run.\n");
    }
  } catch (error) {
    await shutdown(1);
    throw error;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "LOCAL_RUNNER_START_FAILED";
  process.stderr.write(`TraceForge Local Runner could not start: ${message}\n`);
  process.exitCode = 1;
});
