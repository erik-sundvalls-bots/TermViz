import { chromium } from "playwright";

const url =
  process.argv[2] ||
  "https://erik-sundvalls-bots.github.io/TermViz/previews/pr-1/ips-kg-demo.html";
const out = process.argv[3] || "/opt/cursor/artifacts/preview-pr-1-ips-kg.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

let failedRequest = null;
page.on("requestfailed", (req) => {
  if (req.url().includes("/assets/ipsKg")) failedRequest = req.url();
});
page.on("response", (res) => {
  if (res.status() === 404 && res.url().includes("ipsKg")) failedRequest = res.url();
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(
  () => document.querySelectorAll(".kg-node").length > 5,
  { timeout: 120000 },
);

const errEl = await page.$("#kgError:not([hidden])");
if (errEl) {
  const msg = await errEl.textContent();
  throw new Error(`Page error: ${msg}`);
}
if (failedRequest) throw new Error(`404 or failed asset: ${failedRequest}`);

const nodes = await page.locator(".kg-node").count();
if (nodes < 5) throw new Error(`Expected graph nodes, saw ${nodes}`);

await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log(`OK — ${nodes} nodes — saved ${out}`);
