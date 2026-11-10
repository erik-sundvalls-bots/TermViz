import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:44731/ips-kg-demo.html";
const out = "/opt/cursor/artifacts";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelectorAll(".kg-node").length > 5, { timeout: 120000 });
await page.waitForTimeout(400);

await page.click("#kgFit");
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/kg-demo-full-fit.png` });

await page.selectOption("#kgPresetSelect", "pedagogical-five");
await page.waitForTimeout(400);
await page.check("#kgCherryFocus");
await page.waitForTimeout(700);
await page.click("#kgFit");
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/kg-demo-cherry-five-fit.png` });

const archLabel = page.locator("text.kg-node-label").filter({ hasText: /blood pressure/i }).first();
await archLabel.waitFor({ timeout: 15000 });
const box = await archLabel.boundingBox();
if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
else await archLabel.hover();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/kg-demo-archetype-hover.png` });

await browser.close();
console.log("saved screenshots to", out);
