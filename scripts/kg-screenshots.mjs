import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:44731/ips-kg-demo.html";
const out = "/opt/cursor/artifacts";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector("#kgStatus");
await page.waitForTimeout(900);

await page.click("#kgOverview");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/kg-demo-full.png` });

await page.selectOption("#kgPresetSelect", "pedagogical-five");
await page.waitForTimeout(400);
await page.check("#kgCherryFocus");
await page.waitForTimeout(700);
await page.click("#kgFit");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/kg-demo-cherry-five.png` });

await page.click("#kgShowLabels");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/kg-demo-labels-hidden.png` });

await page.click("#kgShowLabels");
await page.locator(".kg-node .kg-dot").first().hover();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/kg-demo-hover.png` });

await browser.close();
console.log("saved screenshots");
