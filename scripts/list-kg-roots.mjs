import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:44731/cdr-kg-explorer.html";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url);
await page.waitForFunction(
  () => document.querySelectorAll("#snomedSvg .force-node").length > 8,
  { timeout: 180000 },
);
const data = await page.locator("#snomedSvg g.force-node").evaluateAll((nodes) =>
  nodes.map((n) => ({
    id: n.getAttribute("data-id"),
    root: n.classList.contains("is-root"),
    transform: n.getAttribute("transform"),
  })),
);
console.log(
  "roots",
  data.filter((n) => n.root).map((n) => `${n.id} @ ${n.transform}`),
);
await browser.close();
