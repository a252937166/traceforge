import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import {
  artifactDir,
  freePort,
  startApi,
  startProcess,
  stopProcess,
  waitForUrl,
  writeArtifact,
} from "./acceptance-lib.mjs";

const webPort = await freePort();
const webOrigin = `http://127.0.0.1:${webPort}`;
const api = await startApi({ TRACEFORGE_ALLOWED_ORIGINS: webOrigin });
const web = startProcess(
  "pnpm",
  ["--filter", "@traceforge/web", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
  { env: { VITE_API_TARGET: api.baseUrl } },
);

let browser;
try {
  await waitForUrl(webOrigin);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  const pageErrors = [];
  const unexpectedResponses = [];
  const runRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/")) {
      runRequests.push({ url: response.url(), status: response.status(), method: response.request().method() });
    }
    const expectedRepairUnavailable =
      response.url().includes("/api/adapters/codex/repair") && response.status() === 501;
    const expectedMissingFavicon = response.url().endsWith("/favicon.ico") && response.status() === 404;
    if (response.status() >= 400 && !expectedRepairUnavailable && !expectedMissingFavicon) {
      unexpectedResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.goto(webOrigin, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Run proof" }).click();
  await page.getByText("Proof sealed", { exact: true }).last().waitFor({ timeout: 30_000 });

  await assert.doesNotReject(() => page.getByLabel(/Live runner\. Fresh evidence/).waitFor());
  await assert.doesNotReject(() => page.getByText("Zero differences remain", { exact: true }).waitFor());
  await assert.doesNotReject(() => page.getByText("D-01 FOUND", { exact: true }).waitFor());
  await assert.doesNotReject(() => page.getByText("VERIFIED", { exact: true }).waitFor());
  await assert.doesNotReject(() => page.getByText("REFERENCE PATCH", { exact: false }).waitFor());
  assert.equal(await page.getByText("SAMPLE DATA", { exact: true }).count(), 0);
  assert.equal(pageErrors.length, 0, `uncaught browser errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual(unexpectedResponses, [], "unexpected browser HTTP failures");

  const expectedNetwork = [
    ["/api/demo/run", 201],
    ["/api/adapters/codex/repair", 501],
    ["/api/demo/run", 201],
  ];
  for (const [path, status] of expectedNetwork) {
    assert.ok(
      runRequests.some((item) => item.url.includes(path) && item.status === status),
      `missing real browser response ${path} ${status}`,
    );
  }

  const runId = (await page.locator(".run-metadata dd").first().textContent())?.trim();
  const proofId = (await page.locator(".run-metadata dd").nth(1).textContent())?.trim();
  assert.match(runId ?? "", /^run_/);
  assert.match(proofId ?? "", /^proof_/);

  const screenshot = `${artifactDir}/ui-live-proof.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  const artifact = await writeArtifact("ui-live-proof.json", {
    origin: webOrigin,
    api: api.baseUrl,
    runId,
    proofId,
    network: runRequests,
    consoleErrors,
    pageErrors,
    unexpectedResponses,
    screenshot,
  });
  console.log("ACCEPTANCE UI PASS (real Chrome + live API; no network mocks)");
  console.log(`run=${runId} proof=${proofId} artifact=${artifact}`);
} catch (error) {
  throw new Error(`${error.message}\nWEB LOGS:\n${web.logs.join("")}\nAPI LOGS:\n${api.child.logs.join("")}`);
} finally {
  if (browser) await browser.close();
  await stopProcess(web);
  await stopProcess(api.child);
}
