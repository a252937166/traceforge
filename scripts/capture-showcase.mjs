import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "../materials/screenshots");
const url = process.env.TRACEFORGE_SHOWCASE_URL ?? "https://traceforge.axiqo.xyz";
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await desktop.goto(url, { waitUntil: "domcontentloaded" });
  await desktop.getByRole("button", { name: "Run proof" }).click();
  await desktop.getByText("Proof sealed", { exact: true }).last().waitFor({ timeout: 30_000 });
  assert.equal(await desktop.getByText("REFERENCE PATCH", { exact: false }).count(), 1);
  assert.equal(await desktop.getByLabel(/Live runner\. Fresh evidence/).count(), 1);
  await desktop.screenshot({ path: resolve(output, "traceforge-showcase-1920x1080.png") });
  await desktop.screenshot({ path: resolve(output, "traceforge-showcase-full.png"), fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(url, { waitUntil: "domcontentloaded" });
  await mobile.getByRole("button", { name: "Run proof" }).click();
  await mobile.getByText("Proof sealed", { exact: true }).last().waitFor({ timeout: 30_000 });
  const widths = await mobile.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.equal(widths.scroll, widths.client);
  await mobile.screenshot({ path: resolve(output, "traceforge-showcase-mobile.png"), fullPage: true });

  await writeFile(
    resolve(output, "traceforge-showcase-capture.json"),
    `${JSON.stringify({ url, capturedAt: new Date().toISOString(), desktop: "1920x1080", mobile: widths }, null, 2)}\n`,
    "utf8",
  );
  console.log(output);
} finally {
  await browser.close();
}
