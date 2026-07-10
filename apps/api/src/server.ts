import { resolve } from "node:path";
import { createApp } from "./app.js";
import { ArtifactStore } from "./store.js";

const port = Number(process.env.PORT ?? 8787);
const host =
  process.env.HOST ?? (process.env.TRACEFORGE_ENABLE_CODEX === "1" ? "127.0.0.1" : "0.0.0.0");
const dbFile = process.env.TRACEFORGE_DB ?? resolve(process.cwd(), "data/traceforge.sqlite");
const store = new ArtifactStore(dbFile);
const { app } = createApp({ store });

const server = app.listen(port, host, () => {
  console.log(`TraceForge API listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
