import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

const SCREENSHOT_DIR = "/Users/robertsasu/.gemini/antigravity/brain/a858fb2d-ee8b-4eb3-a54a-82ce6197e699/screenshots";

async function run() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  console.log("Navigating to https://webui-nine-phi.vercel.app...");
  await page.goto("https://webui-nine-phi.vercel.app", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  console.log("Capturing 08_intra_shard_playground_initial.png...");
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "08_intra_shard_playground_initial.png") });

  console.log("Triggering 402 flow in playground...");
  const triggerButton = page.locator("button:has-text('Trigger Autonomous Agent 402 Flow')");
  if (await triggerButton.isVisible()) {
    await triggerButton.click();
    console.log("Waiting for settlement and streaming...");
    await page.waitForTimeout(8000);
  }

  console.log("Capturing 09_intra_shard_playground_settled.png...");
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "09_intra_shard_playground_settled.png") });

  console.log("Navigating to Fleet tab...");
  const fleetTab = page.locator("button:has-text('Autonomous Fleet')");
  if (await fleetTab.isVisible()) {
    await fleetTab.click();
    await page.waitForTimeout(2000);
    console.log("Capturing 10_intra_shard_fleet.png...");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "10_intra_shard_fleet.png") });
  }

  console.log("Running bot 1 in fleet...");
  const runBot0Button = page.locator("button:has-text('Trigger DeFi Step')");
  if (await runBot0Button.isVisible()) {
    await runBot0Button.click();
    await page.waitForTimeout(4000);
    console.log("Capturing 11_intra_shard_fleet_active.png...");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "11_intra_shard_fleet_active.png") });
  }

  await browser.close();
  console.log("Done! Screenshots saved to:", SCREENSHOT_DIR);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
