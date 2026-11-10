import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:44731/ips-kg-demo.html";
const out = "/opt/cursor/artifacts";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector("#kgStatus");
await page.waitForTimeout(800);

await page.click("#kgOverview");
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/kg-demo-overview.png` });

await page.click("#kgFit");
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/kg-demo-full.png` });

await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".kg-node")];
  const pick = nodes.find((el) => el.querySelector(".kg-dot")) || nodes[0];
  pick?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/kg-demo-highlight.png` });

await page.click('[data-patient="lars"]');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/kg-demo-patient-toggle.png` });

await browser.close();
console.log("saved screenshots to", out);
