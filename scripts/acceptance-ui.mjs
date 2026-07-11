import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
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

async function runIncrementalBrowserAcceptance(webBase) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pollingRequests = [];
  const pageErrors = [];
  let sseResponse;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/events") && url.searchParams.get("format") === "json") {
      pollingRequests.push(request.url());
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.endsWith("/events") && url.searchParams.get("format") !== "json") {
      sseResponse = {
        status: response.status(),
        contentType: response.headers()["content-type"],
      };
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    const trace = {
      transportStates: [],
      terminalRendered: false,
      inferActiveRenderedBeforeTerminal: false,
      hypothesisRenderedBeforeTerminal: false,
    };
    window.__traceforgeAcceptance = trace;

    const sampleDom = () => {
      const transport = document.querySelector(".transport")?.textContent?.trim();
      if (transport && trace.transportStates.at(-1) !== transport) {
        trace.transportStates.push(transport);
      }
      const terminalRenderedNow = [...document.querySelectorAll(".event-console strong")]
        .some((element) => element.textContent?.trim() === "Migration completed");
      if (!trace.terminalRendered && !terminalRenderedNow) {
        const infer = [...document.querySelectorAll(".stage-rail li")]
          .find((element) => element.querySelector("strong")?.textContent?.trim().toLowerCase() === "infer");
        if (infer?.classList.contains("stage-active")) {
          trace.inferActiveRenderedBeforeTerminal = true;
        }
        if (document.querySelector(".hypothesis")) {
          trace.hypothesisRenderedBeforeTerminal = true;
        }
      }
      if (terminalRenderedNow) trace.terminalRendered = true;
    };
    new MutationObserver(sampleDom).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "aria-current"],
    });
    document.addEventListener("DOMContentLoaded", sampleDom, { once: true });
  });

  try {
    await page.goto(webBase, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Start migration", exact: true }).click();
    await page.waitForFunction(
      () => window.__traceforgeAcceptance.transportStates.includes("sse"),
      undefined,
      { timeout: 10_000 },
    );
    await page.getByText("PASSED · 6/6 scenarios", { exact: true }).waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => window.__traceforgeAcceptance.terminalRendered);
    await page.waitForTimeout(250);

    const trace = await page.evaluate(() => window.__traceforgeAcceptance);

    assert.ok(trace.transportStates.includes("sse"), "transport must enter sse while the migration is running");
    assert.ok(
      trace.inferActiveRenderedBeforeTerminal,
      "Infer must render active before Migration completed appears",
    );
    assert.ok(
      trace.hypothesisRenderedBeforeTerminal,
      "a hypothesis must render before Migration completed appears",
    );
    assert.equal(pollingRequests.length, 0, "a healthy SSE run must not issue the JSON polling fallback");
    assert.equal(trace.transportStates.includes("polling"), false, "transport must never render polling on a healthy run");
    assert.equal(pageErrors.length, 0, `browser emitted page errors: ${pageErrors.join("; ")}`);
    assert.equal(sseResponse?.status, 200, "browser SSE request must return HTTP 200");
    assert.match(sseResponse?.contentType ?? "", /text\/event-stream/);

    const eventCountLabel = await page.locator(".event-console .section-heading small").textContent();
    const eventCount = Number.parseInt(eventCountLabel ?? "0", 10);
    assert.ok(eventCount >= 25, "browser must incrementally receive the complete server event ledger");

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
    });
    await mobile.goto(webBase, { waitUntil: "networkidle" });
    const mobileStageRail = await mobile.locator(".stage-rail").evaluate((rail) => {
      const railRect = rail.getBoundingClientRect();
      const items = [...rail.querySelectorAll("li")].map((item) => {
        const rect = item.getBoundingClientRect();
        return {
          label: item.querySelector("strong")?.textContent?.trim(),
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      });
      return {
        clientWidth: rail.clientWidth,
        scrollWidth: rail.scrollWidth,
        railLeft: railRect.left,
        railRight: railRect.right,
        items,
      };
    });
    assert.equal(mobileStageRail.items.length, 5, "mobile stage rail must render all five stages");
    assert.equal(
      mobileStageRail.scrollWidth,
      mobileStageRail.clientWidth,
      "mobile stage rail must not hide stages behind an internal horizontal scroller",
    );
    for (const item of mobileStageRail.items) {
      assert.ok(item.label, "every mobile stage must keep a visible label");
      assert.ok(item.width > 0, `mobile stage ${item.label} must have positive width`);
      assert.ok(
        item.left >= mobileStageRail.railLeft - 0.5 && item.right <= mobileStageRail.railRight + 0.5,
        `mobile stage ${item.label} must remain inside the visible rail`,
      );
    }
    await mobile.close();

    return {
      engine: "playwright-chromium",
      transportStates: trace.transportStates,
      sseResponse,
      eventCount,
      inferActiveRenderedBeforeTerminal: trace.inferActiveRenderedBeforeTerminal,
      hypothesisRenderedBeforeTerminal: trace.hypothesisRenderedBeforeTerminal,
      pollingFallbackRequests: pollingRequests,
      finalProof: await page.getByText("PASSED · 6/6 scenarios", { exact: true }).textContent(),
      mobileStageRail,
    };
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      trace: window.__traceforgeAcceptance,
      body: document.body.innerText.slice(0, 4_000),
    })).catch(() => ({ trace: undefined, body: "page unavailable" }));
    throw new Error(
      `${error.message}\nBROWSER TRACE:\n${JSON.stringify(diagnostics.trace, null, 2)}`
      + `\nPOLLING REQUESTS:\n${JSON.stringify(pollingRequests, null, 2)}`
      + `\nPAGE ERRORS:\n${JSON.stringify(pageErrors, null, 2)}`
      + `\nBODY:\n${diagnostics.body}`,
    );
  } finally {
    await browser.close();
  }
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
    const webPort = await freePort();
    webBase = `http://127.0.0.1:${webPort}`;
    api = await acquireApi({
      TRACEFORGE_REPLAY_EVENT_DELAY_MS: "25",
      TRACEFORGE_ALLOWED_ORIGINS: webBase,
    });
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

  const browserAutomation = await runIncrementalBrowserAcceptance(webBase);

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
    browserAutomation,
  });
  console.log("ACCEPTANCE UI PASS (production bundle + incremental Playwright SSE contract)");
  console.log(`web=${webBase} api=${apiBase} artifact=${artifact}`);
} catch (error) {
  const webLogs = web?.logs?.join("") ?? "";
  throw new Error(`${error.message}${webLogs ? `\nWEB LOGS:\n${webLogs}` : ""}`);
} finally {
  if (web) await stopProcess(web);
  if (api) await releaseApi(api);
}
