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
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*404/.test(m.text())) errs.push(m.text()); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.V8data && Object.keys(window.V8S?.patient ? 1 : 1), { timeout: 60000 });
await page.waitForTimeout(2500);

const expected = {
  "S52.1": "Fraktur på övre delen av radius",
  N40: "Prostataförstoring",
  "N18.9": "Kronisk njursvikt, ospecificerad",
  "K21.9": "Gastroesofageal refluxsjukdom utan esofagit",
  "G47.3": "Sömnapnésyndrom",
};

const labels = await page.evaluate((exp) => {
  const nodes = window.V8data().ont.nodes;
  const out = {};
  for (const code of Object.keys(exp)) {
    const n = nodes.find((x) => x.sys === "icd10" && x.code === code);
    out[code] = n?.sv || null;
  }
  return out;
}, expected);

const ok = Object.entries(expected).every(([k, v]) => labels[k] === v);
const result = { labels, expected, ok, consoleErrors: errs };
console.log(JSON.stringify(result, null, 2));

await page.click("#syn");
await page.waitForTimeout(2000);
await page.screenshot({ path: "/opt/cursor/artifacts/v8-icd10-se-subset.png", fullPage: true });

await browser.close();
server.close();
process.exit(ok && !errs.length ? 0 : 1);