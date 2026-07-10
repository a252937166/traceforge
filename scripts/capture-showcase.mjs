import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "../materials/screenshots");
const url = process.env.TRACEFORGE_SHOWCASE_URL ?? "https://traceforge.axiqo.xyz";
await mkdir(output, { recursive: true });

async function runRecordedMigration(page) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const recorded = page.getByRole("radio", { name: /Recorded replay/ });
  if (!(await recorded.isChecked())) await recorded.click();
  await page.getByRole("button", { name: "Start migration" }).click();
  await page.getByText("PASSED · 6/6 scenarios", { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText("closed", { exact: true }).waitFor({ timeout: 30_000 });

  assert.equal(await recorded.isChecked(), true);
  assert.equal(await page.getByText("[object Object]", { exact: true }).count(), 0);
  assert.equal(await page.locator(".artifact-list a").count(), 5);
  assert.match(await page.locator(".mode-disclosure").innerText(), /not live/i);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await runRecordedMigration(desktop);
  await desktop.screenshot({ path: resolve(output, "traceforge-champion-1920x1080.png") });
  await desktop.screenshot({ path: resolve(output, "traceforge-champion-full.png"), fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await runRecordedMigration(mobile);
  const widths = await mobile.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.equal(widths.scroll, widths.client);
  await mobile.screenshot({ path: resolve(output, "traceforge-champion-mobile-full.png"), fullPage: true });

  await writeFile(
    resolve(output, "traceforge-champion-capture.json"),
    `${JSON.stringify({
      url,
      capturedAt: new Date().toISOString(),
      mode: "recorded-replay",
      desktop: "1920x1080",
      mobile: widths,
    }, null, 2)}\n`,
    "utf8",
  );
  console.log(output);
} finally {
  await browser.close();
}
