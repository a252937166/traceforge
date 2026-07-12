import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "../materials/screenshots/submission");
const url = process.env.TRACEFORGE_SHOWCASE_URL ?? "https://traceforge.axiqo.xyz";

const entryViewport = { width: 1440, height: 900 };
const entryScale = 2;
const entryPixels = {
  width: entryViewport.width * entryScale,
  height: entryViewport.height * entryScale,
};

const desktopViewport = { width: 1915, height: 1291 };
const desktopScale = 2;
const desktopPixels = {
  width: desktopViewport.width * desktopScale,
  height: desktopViewport.height * desktopScale,
};

const mobileViewport = { width: 390, height: 844 };
const mobileScale = 3;
const mobilePixels = {
  width: mobileViewport.width * mobileScale,
  height: mobileViewport.height * mobileScale,
};

// Matches the DPR 2 viewport from the original drawer-overlap report.
const tabletViewport = { width: 764, height: 843 };
const tabletScale = 2;
const tabletPixels = {
  width: tabletViewport.width * tabletScale,
  height: tabletViewport.height * tabletScale,
};

await mkdir(output, { recursive: true });

function pngDimensions(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function capture(page, filename, expected) {
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({
    type: "png",
    scale: "device",
    animations: "disabled",
    caret: "hide",
  });
  assert.deepEqual(pngDimensions(png), expected, `${filename} must be captured at native device pixels`);
  await writeFile(resolve(output, filename), png);
}

async function captureFullPage(page, filename, expectedWidth) {
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({
    type: "png",
    scale: "device",
    animations: "disabled",
    caret: "hide",
    fullPage: true,
  });
  const dimensions = pngDimensions(png);
  assert.equal(dimensions.width, expectedWidth, `${filename} must retain native device width`);
  await writeFile(resolve(output, filename), png);
  return dimensions;
}

async function scrollTo(page, top) {
  await page.evaluate((nextTop) => window.scrollTo({ top: Math.max(0, nextTop), behavior: "instant" }), top);
  await page.waitForTimeout(100);
}

async function absoluteTop(page, selector) {
  return page.locator(selector).evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
}

async function runRecordedMigration(page) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Inspect a completed proof", exact: true }).click();
  await page.getByText("PASSED · 7/7 scenarios", { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText("proof ready", { exact: true }).waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);

  assert.equal(await page.getByText("[object Object]", { exact: true }).count(), 0);
  const artifacts = page.locator("details.proof-detail").filter({ hasText: "Evidence artifacts" });
  await artifacts.locator("summary").click();
  assert.equal(await page.locator(".artifact-list a").count(), 5);
  assert.match(await page.locator(".run-header p").innerText(), /No model call is made during replay/i);
  return page.locator(".run-header .run-identity").innerText();
}

async function openRawEvents(page) {
  const details = page.locator("details.proof-detail").filter({ hasText: "Raw run events" });
  if (!(await details.getAttribute("open"))) await details.locator("summary").click();
}

async function closeEvidenceDrawer(page) {
  const close = page.getByRole("button", { name: "Close evidence drawer" });
  await close.click();
  await close.waitFor({ state: "hidden" });
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--force-color-profile=srgb"],
});

try {
  const entryContext = await browser.newContext({
    viewport: entryViewport,
    deviceScaleFactor: entryScale,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const entry = await entryContext.newPage();
  await entry.goto(url, { waitUntil: "networkidle" });
  await entry.getByRole("button", { name: "Run Codex locally", exact: true }).waitFor();
  const entryLayout = await entry.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.equal(entryLayout.scroll, entryLayout.client);
  await capture(entry, "00-traceforge-judge-entry-2880x1800.png", entryPixels);
  await entryContext.close();

  const desktopContext = await browser.newContext({
    viewport: desktopViewport,
    deviceScaleFactor: desktopScale,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const desktop = await desktopContext.newPage();
  const desktopRun = await runRecordedMigration(desktop);

  await scrollTo(desktop, 0);
  await capture(desktop, "01-traceforge-cover-3830x2582.png", desktopPixels);

  const proofSummaryTop = await absoluteTop(desktop, ".run-workspace");
  await scrollTo(desktop, proofSummaryTop - 80);
  await capture(desktop, "02-traceforge-evidence-3830x2582.png", desktopPixels);

  await openRawEvents(desktop);
  await desktop.getByRole("button", { name: /Candidate 02 built by Codex/ }).click();
  await scrollTo(desktop, proofSummaryTop - 80);
  await capture(desktop, "03-traceforge-codex-build-3830x2582.png", desktopPixels);

  await closeEvidenceDrawer(desktop);
  await desktop.getByRole("button", { name: /Independent verifier decided/ }).click();
  await scrollTo(desktop, proofSummaryTop - 80);
  await capture(desktop, "04-traceforge-verifier-proof-3830x2582.png", desktopPixels);

  await closeEvidenceDrawer(desktop);
  const artifactTop = await absoluteTop(desktop, ".artifact-dock");
  await scrollTo(desktop, artifactTop - 320);
  await capture(desktop, "05-traceforge-proof-bundle-3830x2582.png", desktopPixels);
  const desktopFullPage = await captureFullPage(
    desktop,
    "traceforge-desktop-full-page-retina.png",
    desktopPixels.width,
  );
  await desktopContext.close();

  const mobileContext = await browser.newContext({
    viewport: mobileViewport,
    deviceScaleFactor: mobileScale,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(url, { waitUntil: "networkidle" });
  await mobile.getByRole("button", { name: "Run Codex locally", exact: true }).waitFor();
  const mobileEntryLayout = await mobile.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.equal(mobileEntryLayout.scroll, mobileEntryLayout.client);
  await capture(mobile, "00-traceforge-mobile-judge-entry-1170x2532.png", mobilePixels);
  const mobileRun = await runRecordedMigration(mobile);
  const widths = await mobile.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.equal(widths.scroll, widths.client);

  await scrollTo(mobile, 0);
  await capture(mobile, "06-traceforge-mobile-cover-1170x2532.png", mobilePixels);

  const mobileProofTop = await absoluteTop(mobile, ".run-workspace");
  await scrollTo(mobile, mobileProofTop - 90);
  await capture(mobile, "07-traceforge-mobile-evidence-1170x2532.png", mobilePixels);

  await openRawEvents(mobile);
  await mobile.getByRole("button", { name: /Independent verifier decided/ }).click();
  await capture(mobile, "08-traceforge-mobile-verifier-1170x2532.png", mobilePixels);

  await closeEvidenceDrawer(mobile);
  const candidateDetails = mobile.locator("details.proof-detail").filter({ hasText: "Candidate history" });
  if (!(await candidateDetails.getAttribute("open"))) await candidateDetails.locator("summary").click();
  const mobileCandidateTop = await absoluteTop(mobile, ".candidate-panel");
  await scrollTo(mobile, mobileCandidateTop - 180);
  await capture(mobile, "09-traceforge-mobile-build-proof-1170x2532.png", mobilePixels);
  const mobileFullPage = await captureFullPage(
    mobile,
    "10-traceforge-mobile-full-page-retina.png",
    mobilePixels.width,
  );
  await mobileContext.close();

  const tabletContext = await browser.newContext({
    viewport: tabletViewport,
    deviceScaleFactor: tabletScale,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const tablet = await tabletContext.newPage();
  const tabletRun = await runRecordedMigration(tablet);
  await openRawEvents(tablet);
  await tablet.getByRole("button", { name: /Independent verifier decided/ }).click();
  await capture(
    tablet,
    "11-traceforge-tablet-evidence-1528x1686.png",
    tabletPixels,
  );
  await closeEvidenceDrawer(tablet);
  await tabletContext.close();

  await writeFile(
    resolve(output, "capture-manifest.json"),
    `${JSON.stringify({
      url,
      capturedAt: new Date().toISOString(),
      mode: "recorded-replay",
      encoding: "direct-png",
      entry: {
        viewport: entryViewport,
        deviceScaleFactor: entryScale,
        pixels: entryPixels,
        layout: entryLayout,
      },
      desktop: {
        run: desktopRun,
        viewport: desktopViewport,
        deviceScaleFactor: desktopScale,
        pixels: desktopPixels,
        fullPage: desktopFullPage,
      },
      mobile: {
        run: mobileRun,
        viewport: mobileViewport,
        deviceScaleFactor: mobileScale,
        pixels: mobilePixels,
        fullPage: mobileFullPage,
        layout: widths,
        entryLayout: mobileEntryLayout,
      },
      tablet: {
        run: tabletRun,
        viewport: tabletViewport,
        deviceScaleFactor: tabletScale,
        pixels: tabletPixels,
        regression: "original evidence-drawer overlap viewport",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  console.log(output);
} finally {
  await browser.close();
}
