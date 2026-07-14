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
    "Run Codex locally",
    "Inspect a completed proof",
    "Replay a verified run",
    "Host-only proof",
    "local-runner-v0.1.10",
    "d9b0d853acc7cab36eba859a778763c231e37325",
    "16 host gates + 7 scenarios + 35 assertions",
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
  for (const token of ["traceforge-page", "landing-hero", "stage-rail", "proof-outcome", "run-wizard", "focus-visible", "prefers-reduced-motion"]) {
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
      currentActivityUpdatedBeforeTerminal: false,
    };
    window.__traceforgeAcceptance = trace;

    const sampleDom = () => {
      const transport = [...document.querySelectorAll(".current-activity dl > div")]
        .find((entry) => entry.querySelector("dt")?.textContent?.trim() === "Transport")
        ?.querySelector("dd")?.textContent?.trim();
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
        const currentActivity = document.querySelector(".current-activity h3")?.textContent?.trim();
        if (currentActivity && !currentActivity.startsWith("Waiting for")) trace.currentActivityUpdatedBeforeTerminal = true;
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
    const recordedMode = page.locator('input[name="execution-mode"][value="recorded-replay"]');
    const localRunnerCta = page.getByRole("button", { name: "Run Codex locally", exact: true });
    const judgeCta = page.getByRole("button", { name: "Inspect a completed proof", exact: true });
    assert.equal(await recordedMode.isChecked(), true, "the advanced public replay mode must be selected by default");
    const selectedMode = await recordedMode.getAttribute("value");
    assert.equal(
      await page.getByRole("radio", { name: /New live AI run/ }).count(),
      0,
      "the public deployment must not expose an unusable fresh Live AI radio",
    );
    assert.equal(await localRunnerCta.isEnabled(), true, "the advanced Local Runner CTA must be actionable");
    assert.equal(await judgeCta.isEnabled(), true, "the primary completed-proof CTA must be immediately actionable");
    assert.equal(await page.locator(".landing-hero .action-primary").count(), 1, "the first screen must have one primary action");
    assert.equal(await judgeCta.getAttribute("class"), "action-primary", "the zero-install judge path must own the primary treatment");
    assert.equal(await localRunnerCta.getAttribute("class"), "action-link", "the setup-heavy Local Runner must remain secondary");
    assert.equal(await page.locator(".stage-rail").count(), 0, "idle landing must not render an empty stage rail");
    assert.equal(await page.locator(".provenance-strip").count(), 0, "idle landing must not render an empty provenance grid");
    const releaseEvidence = page.getByRole("region", { name: "Release evidence" });
    await releaseEvidence.waitFor({ state: "visible" });
    assert.match(await releaseEvidence.innerText(), /Production[\s\S]+Pinned runner[\s\S]+Real local run[\s\S]+Source run[\s\S]+Deployment/i);
    assert.match(await releaseEvidence.innerText(), /v0\.1\.10/);
    assert.equal(
      await releaseEvidence.getByRole("link", { name: /Real local run/ }).getAttribute("href"),
      "https://github.com/a252937166/traceforge/tree/343fbbb5ddad828c18b0f618893c50a6cb1d50a1/docs/evidence/local-runner-v0.1.10",
    );
    const desktopCtaBox = await judgeCta.boundingBox();
    assert.ok(desktopCtaBox, "the judge demo CTA must be rendered");
    assert.ok(
      desktopCtaBox.y + desktopCtaBox.height <= 900,
      "the judge demo CTA must remain in the 1440x900 first viewport",
    );
    assert.match(await page.locator(".hero-assurance").innerText(), /No local files, Codex credentials, generated source, or session history/);
    assert.equal(await page.getByRole("list", { name: "Trust boundaries" }).locator("li").count(), 3);

    await localRunnerCta.click();
    const runnerDialog = page.getByRole("dialog", { name: "Start a bounded proof run." });
    await runnerDialog.waitFor({ state: "visible" });
    assert.match(await runnerDialog.innerText(), /fixed damaged-returns demo/i);
    assert.match(await runnerDialog.innerText(), /does not browse or modify your own project/i);
    assert.match(await runnerDialog.innerText(), /Codex CLI 0\.144\.1/);
    assert.match(await runnerDialog.innerText(), /local-runner-v0\.1\.10/);
    assert.match(await runnerDialog.innerText(), /d9b0d853acc7cab36eba859a778763c231e37325/);
    assert.match(await runnerDialog.innerText(), /no binary checksum claim/i);
    assert.equal(await runnerDialog.getByRole("button", { name: "Copy command" }).count(), 1);
    await runnerDialog.getByRole("button", { name: "Next: review local scope" }).click();
    assert.match(await runnerDialog.innerText(), /Handoff to localhost/);
    assert.match(await runnerDialog.innerText(), /No pairing, heartbeat, file browser, or approval state/);
    assert.match(await runnerDialog.innerText(), /One candidate file/);
    await runnerDialog.getByRole("button", { name: "Next: see proof output" }).click();
    assert.match(await runnerDialog.innerText(), /16 host gates \+ 7 scenarios \+ 35 assertions/);
    assert.match(await runnerDialog.innerText(), /does not claim a Runner signature or trusted timestamp/i);
    await runnerDialog.getByRole("button", { name: "Close Local Runner guide" }).click();
    await runnerDialog.waitFor({ state: "hidden" });

    await judgeCta.click();
    await page.waitForFunction(
      () => window.__traceforgeAcceptance.transportStates.includes("SSE live"),
      undefined,
      { timeout: 10_000 },
    );
    await page.getByText("PASSED · 7/7 scenarios", { exact: true }).waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => window.__traceforgeAcceptance.terminalRendered);
    await page.waitForTimeout(250);

    const trace = await page.evaluate(() => window.__traceforgeAcceptance);

    assert.ok(trace.transportStates.includes("SSE live"), "transport must visibly enter SSE live while the migration is running");
    assert.ok(
      trace.inferActiveRenderedBeforeTerminal,
      "Infer must render active before Migration completed appears",
    );
    assert.ok(
      trace.currentActivityUpdatedBeforeTerminal,
      "the focused current-activity card must update before the terminal event",
    );
    assert.equal(pollingRequests.length, 0, "a healthy SSE run must not issue the JSON polling fallback");
    assert.equal(trace.transportStates.includes("recovering"), false, "transport must never render polling recovery on a healthy run");
    assert.equal(pageErrors.length, 0, `browser emitted page errors: ${pageErrors.join("; ")}`);
    assert.equal(sseResponse?.status, 200, "browser SSE request must return HTTP 200");
    assert.match(sseResponse?.contentType ?? "", /text\/event-stream/);

    const rawEventsDetails = page.locator("details.proof-detail").filter({ hasText: "Raw run events" });
    await rawEventsDetails.locator("summary").click();
    const eventCountLabel = await rawEventsDetails.locator(".event-console .section-heading small").textContent();
    const eventCount = Number.parseInt(eventCountLabel ?? "0", 10);
    assert.ok(eventCount >= 25, "browser must incrementally receive the complete server event ledger");
    const completedDisclosure = await page.locator(".run-header p").innerText();
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
    const mobileRecordedMode = mobile.locator('input[name="execution-mode"][value="recorded-replay"]');
    const mobileLocalRunnerCta = mobile.getByRole("button", { name: "Run Codex locally", exact: true });
    const mobileJudgeCta = mobile.getByRole("button", { name: "Inspect a completed proof", exact: true });
    assert.equal(await mobileRecordedMode.isChecked(), true, "mobile advanced options must default to replay");
    assert.equal(
      await mobile.getByRole("radio", { name: /New live AI run/ }).count(),
      0,
      "mobile must not render an unusable fresh Live AI radio",
    );
    assert.equal(await mobileLocalRunnerCta.isEnabled(), true, "mobile must expose the advanced Local Runner launcher");
    assert.equal(await mobile.locator(".stage-rail").count(), 0, "mobile idle landing must not render empty stages");
    const mobileCtaBox = await mobileJudgeCta.boundingBox();
    assert.ok(mobileCtaBox, "mobile zero-install primary CTA must be rendered");
    assert.ok(
      mobileCtaBox.y + mobileCtaBox.height <= 844,
      "mobile primary CTA must remain in the 390x844 first viewport",
    );
    const mobileInitialWidth = await mobile.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.equal(mobileInitialWidth.scroll, mobileInitialWidth.client, "mobile landing must not overflow horizontally");
    await mobileJudgeCta.click();
    await mobile.getByText("PASSED · 7/7 scenarios", { exact: true }).waitFor({ timeout: 30_000 });
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
        minLabelFontSize: Math.min(...[...rail.querySelectorAll("small")].map((label) => Number.parseFloat(getComputedStyle(label).fontSize))),
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
    assert.ok(mobileStageRail.minLabelFontSize >= 11, "mobile stage status text must remain at least 11px");
    await mobile.close();

    return {
      engine: "playwright-chromium",
      transportStates: trace.transportStates,
      sseResponse,
      eventCount,
      inferActiveRenderedBeforeTerminal: trace.inferActiveRenderedBeforeTerminal,
      currentActivityUpdatedBeforeTerminal: trace.currentActivityUpdatedBeforeTerminal,
      pollingFallbackRequests: pollingRequests,
      finalProof: await page.getByText("PASSED · 7/7 scenarios", { exact: true }).textContent(),
      initialExperience: {
        selectedMode,
        publicFreshLiveAiTriggerAbsent: true,
        localRunnerAvailable: await localRunnerCta.isEnabled(),
        desktopCtaBox,
        mobileCtaBox,
        evidenceLinkVisible: true,
        releaseEvidence: await releaseEvidence.innerText(),
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
  if (process.env.WEB_BASE) {
    assert.match(response.headers.get("cache-control") ?? "", /no-cache.*no-store.*must-revalidate/i);
  }

  const apiBase = process.env.API_BASE
    ? normalizeBaseUrl(process.env.API_BASE)
    : api?.baseUrl ?? webBase;
  const health = await requestJson(`${apiBase}/api/health`);
  assert.equal(health.response.status, 200);
  assert.equal(health.body.status, "ok");
  assert.equal(health.body.service, "traceforge-api");
  assert.match(health.body.release?.sha ?? "", /^[a-f0-9]{40}$/);
  assert.equal(health.body.release?.version, "traceforge-v0.1.10");

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
