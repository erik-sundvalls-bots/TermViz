import { chromium } from "playwright";

const url =
  process.argv[2] ||
  "http://127.0.0.1:44731/cdr-kg-explorer.html";
const outDir = process.argv[3] || "/opt/cursor/artifacts";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

let failedRequest = null;
page.on("response", (res) => {
  if (res.status() === 404 && res.url().includes("cdr-kg")) failedRequest = res.url();
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(
  () => document.querySelectorAll("#snomedSvg .force-node").length > 8,
  { timeout: 180000 },
).catch(async () => {
  const err = await page.$eval("#error", (el) => el.textContent).catch(() => "");
  throw new Error(err || "Terminology graph did not render in time.");
});

const errEl = await page.$("#error:not([hidden])");
if (errEl) {
  const msg = await errEl.textContent();
  throw new Error(`Page error: ${msg}`);
}
if (failedRequest) throw new Error(`404 or failed asset: ${failedRequest}`);

const nodes = await page.locator("#snomedSvg .force-node").count();
if (nodes < 8) throw new Error(`Expected terminology nodes, saw ${nodes}`);

await page.screenshot({ path: `${outDir}/cdr-kg-default.png`, fullPage: false });

await page.click('#snomedViewport [data-zoom="fit"]');
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/cdr-kg-terminologies.png`, fullPage: false });

await page.evaluate(() => {
  const bench = document.querySelector("#bench");
  if (bench) bench.style.gridTemplateRows = "22% 6px 1fr";
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/cdr-kg-tree-root-top.png`, fullPage: false });

await browser.close();
console.log(`OK — ${nodes} terminology nodes — screenshots in ${outDir}`);
