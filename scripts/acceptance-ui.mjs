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
    "Replay a verified run",
    "Host-only proof",
    "Rules must survive a counterexample",
    "Download the evidence",
    "Run the verified migration",
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
    const recordedMode = page.getByRole("radio", { name: /Replay a verified run/ });
    const liveMode = page.getByRole("radio", { name: /New live AI run/ });
    const judgeCta = page.getByRole("button", { name: "Run the verified migration", exact: true });
    assert.equal(await recordedMode.isChecked(), true, "the public judge demo must be selected by default");
    assert.equal(await liveMode.isDisabled(), true, "the unsecured public deployment must keep fresh Live AI locked");
    assert.equal(await judgeCta.isEnabled(), true, "the judge demo CTA must be immediately actionable");
    const desktopCtaBox = await judgeCta.boundingBox();
    assert.ok(desktopCtaBox, "the judge demo CTA must be rendered");
    assert.ok(
      desktopCtaBox.y + desktopCtaBox.height <= 900,
      "the judge demo CTA must remain in the 1440x900 first viewport",
    );
    const initialDisclosure = await page.locator(".mode-disclosure").innerText();
    assert.match(initialDisclosure, /recorded AI, fresh proof/i);
    assert.match(initialDisclosure, /No model call is claimed during replay/i);
    assert.equal(
      await page.getByRole("link", { name: /Inspect the authenticated live-run evidence/ }).count(),
      1,
      "the public demo must link to its source live-run evidence",
    );

    await judgeCta.click();
    await page.waitForFunction(
      () => window.__traceforgeAcceptance.transportStates.includes("SSE live"),
      undefined,
      { timeout: 10_000 },
    );
    await page.getByText("PASSED · 6/6 scenarios", { exact: true }).waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => window.__traceforgeAcceptance.terminalRendered);
    await page.waitForTimeout(250);

    const trace = await page.evaluate(() => window.__traceforgeAcceptance);

    assert.ok(trace.transportStates.includes("SSE live"), "transport must visibly enter SSE live while the migration is running");
    assert.ok(
      trace.inferActiveRenderedBeforeTerminal,
      "Infer must render active before Migration completed appears",
    );
    assert.ok(
      trace.hypothesisRenderedBeforeTerminal,
      "a hypothesis must render before Migration completed appears",
    );
    assert.equal(pollingRequests.length, 0, "a healthy SSE run must not issue the JSON polling fallback");
    assert.equal(trace.transportStates.includes("recovering"), false, "transport must never render polling recovery on a healthy run");
    assert.equal(pageErrors.length, 0, `browser emitted page errors: ${pageErrors.join("; ")}`);
    assert.equal(sseResponse?.status, 200, "browser SSE request must return HTTP 200");
    assert.match(sseResponse?.contentType ?? "", /text\/event-stream/);

    const eventCountLabel = await page.locator(".event-console .section-heading small").textContent();
    const eventCount = Number.parseInt(eventCountLabel ?? "0", 10);
    assert.ok(eventCount >= 25, "browser must incrementally receive the complete server event ledger");
    const completedDisclosure = await page.locator(".mode-disclosure").innerText();
    assert.match(completedDisclosure, /authenticated model work was recorded/i);
    assert.match(completedDisclosure, /issues a fresh proof/i);
    assert.match(completedDisclosure, /No model call is made during replay/i);

    await page.setViewportSize({ width: 764, height: 843 });
    const evidenceTrigger = page.getByRole("button", { name: /Candidate 02 built by Codex/ });
    await evidenceTrigger.click();
    const evidenceDialog = page.locator("dialog.evidence-dialog");
    await evidenceDialog.waitFor({ state: "visible" });
    const drawerClosedState = await evidenceDialog.evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      const topElement = document.elementFromPoint(window.innerWidth - 12, 32);
      const raw = dialog.querySelector("details.evidence-raw");
      return {
        modal: dialog.matches(":modal"),
        left: rect.left,
        right: rect.right,
        width: rect.width,
        viewportWidth: window.innerWidth,
        topElementInsideDialog: Boolean(topElement?.closest("dialog.evidence-dialog")),
        stageRailOnTop: Boolean(topElement?.closest(".stage-rail")),
        rawOpen: raw?.hasAttribute("open") ?? null,
        htmlLocked: document.documentElement.classList.contains("evidence-modal-open"),
      };
    });
    assert.equal(drawerClosedState.modal, true, "evidence drawer must enter the native modal top layer");
    assert.ok(Math.abs(drawerClosedState.left) <= 0.5, "tablet evidence drawer must start at the viewport edge");
    assert.ok(
      Math.abs(drawerClosedState.right - drawerClosedState.viewportWidth) <= 0.5,
      "tablet evidence drawer must end at the viewport edge",
    );
    assert.equal(drawerClosedState.topElementInsideDialog, true, "modal drawer must own the top visual layer");
    assert.equal(drawerClosedState.stageRailOnTop, false, "sticky stage rail must never cross the modal drawer");
    assert.equal(drawerClosedState.rawOpen, false, "raw event JSON must be collapsed by default");
    assert.equal(drawerClosedState.htmlLocked, true, "the document must lock background scrolling while evidence is open");

    await evidenceDialog.locator("summary").click();
    const rawLayout = await evidenceDialog.evaluate((dialog) => {
      const pre = dialog.querySelector(".evidence-raw pre");
      const content = dialog.querySelector(".evidence-dialog-content");
      return {
        rawOpen: dialog.querySelector("details.evidence-raw")?.hasAttribute("open") ?? false,
        preClientWidth: pre?.clientWidth ?? 0,
        preScrollWidth: pre?.scrollWidth ?? 0,
        dialogClientWidth: dialog.clientWidth,
        dialogScrollWidth: dialog.scrollWidth,
        contentClientHeight: content?.clientHeight ?? 0,
        contentScrollHeight: content?.scrollHeight ?? 0,
      };
    });
    assert.equal(rawLayout.rawOpen, true, "raw event JSON must expand on request");
    assert.ok(rawLayout.preClientWidth > 0, "expanded raw payload must have a measurable content width");
    assert.ok(
      rawLayout.preScrollWidth <= rawLayout.preClientWidth,
      "long raw JSON values must wrap without horizontal scrolling",
    );
    assert.ok(
      rawLayout.dialogScrollWidth <= rawLayout.dialogClientWidth,
      "evidence drawer must not have horizontal overflow",
    );
    assert.ok(
      rawLayout.contentScrollHeight > rawLayout.contentClientHeight,
      "a complex evidence payload must scroll inside the drawer rather than extending the page",
    );

    const scrolledLayout = await evidenceDialog.evaluate((dialog) => {
      const content = dialog.querySelector(".evidence-dialog-content");
      const header = dialog.querySelector(".evidence-dialog-shell > header");
      const close = dialog.querySelector('button[aria-label="Close evidence drawer"]');
      if (content) content.scrollTop = content.scrollHeight;
      const dialogRect = dialog.getBoundingClientRect();
      const headerRect = header?.getBoundingClientRect();
      const closeRect = close?.getBoundingClientRect();
      const closeTarget = closeRect
        ? document.elementFromPoint(closeRect.left + closeRect.width / 2, closeRect.top + closeRect.height / 2)
        : null;
      return {
        contentScrollTop: content?.scrollTop ?? 0,
        headerTop: headerRect?.top ?? -1,
        dialogTop: dialogRect.top,
        closeButtonOwnsPoint: Boolean(closeTarget?.closest('button[aria-label="Close evidence drawer"]')),
      };
    });
    assert.ok(scrolledLayout.contentScrollTop > 0, "complex raw evidence must be vertically scrollable");
    assert.ok(
      Math.abs(scrolledLayout.headerTop - scrolledLayout.dialogTop) <= 0.5,
      "the evidence header must remain fixed while raw evidence scrolls",
    );
    assert.equal(scrolledLayout.closeButtonOwnsPoint, true, "the close control must stay clickable after scrolling raw evidence");

    await evidenceDialog.getByRole("button", { name: "Close evidence drawer" }).click();
    await evidenceDialog.waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() => document.documentElement.classList.contains("evidence-modal-open")),
      false,
      "closing evidence must unlock the document",
    );
    assert.equal(await evidenceTrigger.evaluate((button) => document.activeElement === button), true, "close must restore focus to the event trigger");

    await evidenceTrigger.click();
    await evidenceDialog.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await evidenceDialog.waitFor({ state: "hidden" });
    assert.equal(await evidenceTrigger.evaluate((button) => document.activeElement === button), true, "Escape must restore focus to the event trigger");

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
    });
    await mobile.goto(webBase, { waitUntil: "networkidle" });
    const mobileRecordedMode = mobile.getByRole("radio", { name: /Replay a verified run/ });
    const mobileLiveMode = mobile.getByRole("radio", { name: /New live AI run/ });
    const mobileJudgeCta = mobile.getByRole("button", { name: "Run the verified migration", exact: true });
    assert.equal(await mobileRecordedMode.isChecked(), true, "mobile must default to the actionable judge demo");
    assert.equal(await mobileLiveMode.isDisabled(), true, "mobile must keep the unsecured Live AI trigger locked");
    const mobileCtaBox = await mobileJudgeCta.boundingBox();
    assert.ok(mobileCtaBox, "mobile judge CTA must be rendered");
    assert.ok(
      mobileCtaBox.y + mobileCtaBox.height <= 844,
      "mobile judge CTA must remain in the 390x844 first viewport",
    );
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
      initialExperience: {
        selectedMode: await recordedMode.getAttribute("value"),
        liveAiLocked: await liveMode.isDisabled(),
        desktopCtaBox,
        mobileCtaBox,
        evidenceLinkVisible: true,
      },
      evidenceDrawer: {
        viewport: { width: 764, height: 843 },
        closedState: drawerClosedState,
        expandedRawLayout: rawLayout,
        scrolledRawLayout: scrolledLayout,
        closeRestoredFocus: true,
        escapeRestoredFocus: true,
      },
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
