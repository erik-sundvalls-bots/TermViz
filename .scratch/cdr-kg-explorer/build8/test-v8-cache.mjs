import { chromium } from "playwright-core";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "../../..");
const proto = join(root, "public/prototyping");

const server = createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  const file = path === "/" ? "v8-multilingual-stack-demo.html" : path.replace(/^\//, "");
  const full = join(proto, file);
  if (!existsSync(full)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const mime = file.endsWith(".json") ? "application/json" : "text/html; charset=utf-8";
  res.writeHead(200, { "Content-Type": mime });
  res.end(readFileSync(full));
});

const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const url = `http://127.0.0.1:${port}/v8-multilingual-stack-demo.html?lang=sv`;

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errs = [];
let lookups = 0;
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource.*404/.test(m.text())) errs.push(m.text());
});
page.on("request", (r) => { if (r.url().includes("CodeSystem/$lookup")) lookups++; });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__v8Tx?.txLookup, { timeout: 60000 });

const sct1 = await page.evaluate(async () => {
  const r = await window.__v8Tx.txLookup("sct", "38341003");
  return { sv: r.sv, en: r.en };
});
const lookupsAfterSct = lookups;

const atc = await page.evaluate(async () => {
  window.V8S.txServers.atc = "https://tx.fhir.org/r4";
  const r = await window.__v8Tx.txLookup("atc", "A02BC01");
  return { sv: r.sv, en: r.en, parents: r.parents?.length || 0 };
});
const lookupsAfterAtc = lookups;

const cacheBefore = await page.evaluate(() => window.__v8Tx.txCacheCount());
const netBeforeRepeat = lookups;
await page.evaluate(() => window.__v8Tx.txLookup("sct", "38341003"));
const netAfterRepeat = lookups;
const cacheAfter = await page.evaluate(() => window.__v8Tx.txCacheCount());

const result = {
  consoleErrors: errs,
  sct1,
  sct383Ok: /högt\s*blodtryck/i.test(sct1.sv || ""),
  atc,
  atcOk: !!(atc.en || atc.sv),
  lookupsAfterSct,
  lookupsAfterAtc,
  cacheEntries: cacheAfter,
  cacheReuseOk: cacheAfter > cacheBefore || (cacheAfter > 0 && netAfterRepeat === netBeforeRepeat),
  repeatLookupNetDelta: netAfterRepeat - netBeforeRepeat,
};
console.log(JSON.stringify(result, null, 2));

await page.screenshot({ path: "/opt/cursor/artifacts/v8-demo-headless.png", fullPage: false });
await browser.close();
server.close();
const ok = !errs.length && result.sct383Ok && result.atcOk && result.cacheReuseOk;
process.exit(ok ? 0 : 1);