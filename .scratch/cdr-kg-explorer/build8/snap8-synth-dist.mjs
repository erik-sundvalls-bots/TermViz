// Expand the 30 synthetic patients and read the Problem List of each from the rendered instance layer
import { chromium } from "/workspace/cdr-catalyst/variants/build/node_modules/playwright-core/index.mjs";
const url = process.argv[2], png = "/workspace/cdr-catalyst/variants/png/";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(url); await p.waitForTimeout(1200);
await p.click("#syn"); await p.waitForTimeout(1500);
const clickBox = (id) => p.evaluate((id) => { const el = [...document.querySelectorAll("g.box")].find((e) => e.__data__ && e.__data__.id === id); if (!el) return false; el.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; }, id);
for (const i of [13, 18, 2, 26]) { console.error("expand", i, await clickBox(`syn${i}:pat`)); await p.waitForTimeout(1300); }
await p.screenshot({ path: png + "v8-synthetic-varied-expanded.png", fullPage: true });
for (let i = 1; i <= 30; i++) if (![13, 18, 2, 26].includes(i)) { await clickBox(`syn${i}:pat`); await p.waitForTimeout(150); }
await p.waitForTimeout(1500);
const dist = await p.evaluate(() => {
  const L = (v) => (v && typeof v === "object" ? v.sv : v);
  const boxes = [...document.querySelectorAll("g.box")].map((e) => e.__data__).filter((d) => d && d.kind === "inst" && d.n && d.id.startsWith("syn"));
  const res = {};
  for (const d of boxes) if (d.n.k === "element" && d.n.name === "Problem/Diagnosis name") { const pid = d.id.split(":")[0]; (res[pid] = res[pid] || []).push(L(d.n.value) + " [" + (d.n.codes || []).join(" ") + "]"); }
  return { res, st: { used: window.__state.used, ontVisible: window.__state.ontVisible } };
});
await p.click("#lang-en, [data-lang='en']").catch(() => {});
console.log(JSON.stringify({ errs, dist }));
await b.close();
