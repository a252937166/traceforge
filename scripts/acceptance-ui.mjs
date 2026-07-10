import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  acquireApi,
  freePort,
  normalizeBaseUrl,
  releaseApi,
  requestJson,
  root,
  startProcess,
  stopProcess,
  waitForUrl,
  writeArtifact,
} from "./acceptance-migration-lib.mjs";

const execFileAsync = promisify(execFile);
const webDist = resolve(root, "apps/web/dist");

async function listFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(path));
    else output.push(path);
  }
  return output;
}

async function buildAndReadStaticContract() {
  const { stdout, stderr } = await execFileAsync(
    "pnpm",
    ["--filter", "@traceforge/web", "build"],
    { cwd: root, env: process.env, maxBuffer: 8 * 1024 * 1024 },
  );
  const files = await listFiles(webDist);
  const htmlFiles = files.filter((file) => file.endsWith(".html"));
  const scriptFiles = files.filter((file) => file.endsWith(".js"));
  const styleFiles = files.filter((file) => file.endsWith(".css"));
  assert.ok(htmlFiles.length >= 1, "web build must emit HTML");
  assert.ok(scriptFiles.length >= 1, "web build must emit JavaScript");
  assert.ok(styleFiles.length >= 1, "web build must emit CSS");

  const html = (await Promise.all(htmlFiles.map((file) => readFile(file, "utf8")))).join("\n");
  const scripts = (await Promise.all(scriptFiles.map((file) => readFile(file, "utf8")))).join("\n");
  const styles = (await Promise.all(styleFiles.map((file) => readFile(file, "utf8")))).join("\n");

  assert.match(html, /<[^>]+ id="root"[^>]*><\/[^>]+>/);
  for (const token of [
    "TRACEFORGE",
    "MIGRATION LOOM",
    "Recorded replay",
    "Deterministic proof",
    "Rules must survive a counterexample",
    "Download the evidence",
    "Start migration",
    "live-ai",
    "recorded-replay",
    "deterministic-only",
    "/api/migrations",
    "EventSource",
  ]) {
    assert.ok(scripts.includes(token), `web bundle is missing ${token}`);
  }
  for (const token of ["migration-workbench", "stage-rail", "focus-visible", "prefers-reduced-motion"]) {
    assert.ok(styles.includes(token), `web stylesheet is missing ${token}`);
  }

  return {
    files: files.map((file) => file.slice(webDist.length + 1)),
    bytes: Buffer.byteLength(html) + Buffer.byteLength(scripts) + Buffer.byteLength(styles),
    buildLog: `${stdout}${stderr}`.trim().split("\n").slice(-8),
  };
}

const staticContract = await buildAndReadStaticContract();
let api;
let web;
let webBase;
try {
  if (process.env.WEB_BASE) {
    webBase = normalizeBaseUrl(process.env.WEB_BASE);
    await waitForUrl(webBase);
  } else {
    api = await acquireApi();
    const webPort = await freePort();
    webBase = `http://127.0.0.1:${webPort}`;
    web = startProcess(
      "pnpm",
      ["--filter", "@traceforge/web", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
      { env: { VITE_API_TARGET: api.baseUrl } },
    );
    await waitForUrl(webBase);
  }

  const response = await fetch(webBase);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const html = await response.text();
  assert.match(html, /id="root"/);
  assert.match(html, /TraceForge/i);

  const apiBase = process.env.API_BASE
    ? normalizeBaseUrl(process.env.API_BASE)
    : api?.baseUrl ?? webBase;
  const health = await requestJson(`${apiBase}/api/health`);
  assert.equal(health.response.status, 200);
  assert.equal(health.body.status, "ok");
  assert.equal(health.body.service, "traceforge-api");

  const artifact = await writeArtifact("migration-ui-contract.json", {
    webBase,
    apiBase,
    externalWeb: Boolean(process.env.WEB_BASE),
    externalApi: Boolean(process.env.API_BASE),
    http: {
      status: response.status,
      contentType: response.headers.get("content-type"),
      healthStatus: health.body.status,
    },
    staticContract,
    browserAutomation: false,
  });
  console.log("ACCEPTANCE UI PASS (HTTP + production bundle contract; browser automation intentionally separate)");
  console.log(`web=${webBase} api=${apiBase} artifact=${artifact}`);
} catch (error) {
  const webLogs = web?.logs?.join("") ?? "";
  throw new Error(`${error.message}${webLogs ? `\nWEB LOGS:\n${webLogs}` : ""}`);
} finally {
  if (web) await stopProcess(web);
  if (api) await releaseApi(api);
}
