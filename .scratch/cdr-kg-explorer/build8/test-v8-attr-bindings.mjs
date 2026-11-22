// Headless check: archetype attribute term bindings reach the terminology DAG, and the per-layer
// "Endast använda" / "Alla attribut" switch changes the attribute tiles of opened archetypes/templates.
// Usage: node test-v8-attr-bindings.mjs [screenshot-dir]
import { chromium } from "playwright-core";
import { createServer } from "http";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const proto = join(__dir, "../../..", "public/prototyping");
const shots = process.argv[2] || null;
if (shots) mkdirSync(shots, { recursive: true });
const server = createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  const full = join(proto, path === "/" ? "v8-multilingual-stack-demo.html" : path.replace(/^\//, ""));
  if (!existsSync(full)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": full.endsWith(".json") ? "application/json" : "text/html; charset=utf-8" });
  res.end(readFileSync(full));
});
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.5 })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*404/.test(m.text())) errs.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/v8-multilingual-stack-demo.html?lang=sv`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__state && window.__v8Tx, { timeout: 60000 });
await page.evaluate(() => window.__v8Tx.refreshBindingTargets());
const settle = () => page.waitForTimeout(1300); // 900 ms layout transition + margin
const BP = "openEHR-EHR-OBSERVATION.blood_pressure.v2";
const SYS = BP + "|/data[at0001]/events[at0006]/data[at0003]/items[at0004]", DIA = BP + "|/data[at0001]/events[at0006]/data[at0003]/items[at0005]";
const st = () => page.evaluate(() => window.__state);
const has = (s, a, b) => s.acLinks.some((l) => l.a === a && l.b === b);
const out = { defaults: null, collapsed: {}, expanded: {}, hover: {}, toggle: {}, errors: errs };

let s = await st();
out.defaults = s.attrMode;
out.collapsed.bpRootToSnomed = s.acLinks.filter((l) => l.a === BP + "|/").map((l) => l.b);
// open blood pressure; Lars has systolic/diastolic values, so they show in "Endast använda" too
await page.evaluate((a) => { window.V8S.expArch.add(a); window.V8render(); }, BP); await settle();
s = await st();
out.expanded.systolic = has(s, SYS, "sct:271649006");
out.expanded.diastolic = has(s, DIA, "sct:271650006");
out.expanded.root = has(s, BP + "|/", "sct:364090009");
out.expanded.bpLinks = s.acLinks.filter((l) => l.a.startsWith(BP)).map((l) => `${l.a.split("|")[1]} -> ${l.b}`);
// hover systolic tile: its binding link and the SNOMED ancestors must highlight
const hov = await page.evaluate((id) => {
  const g = d3.selectAll("g.box.arch").filter((d) => d.id === id).node();
  g.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, clientX: 400, clientY: 400 }));
  const hi = d3.selectAll("path.lk.hi").data();
  return { hiLinks: hi.length, hiAc: hi.filter((l) => l.fam === "ac").map((l) => l.a.split("|")[1] + " -> " + l.b), hiDag: hi.filter((l) => l.dag).length,
    snomedHi: d3.selectAll("g.ontn.hi").data().map((d) => d.id) };
}, SYS);
out.hover = hov;
if (shots) {
  const box = await page.evaluate((id) => { const r = d3.selectAll("g.box.arch").filter((d) => d.id === id).node().getBoundingClientRect(); return { x: r.x, y: r.y + scrollY }; }, SYS);
  await page.evaluate(() => { document.getElementById("tip").style.display = "none"; });
  const top = await page.evaluate(() => document.getElementById("v").getBoundingClientRect().y + scrollY);
  await page.screenshot({ path: join(shots, "v8-bp-attribute-bindings-hover.png"), fullPage: true, clip: { x: 0, y: top, width: 1600, height: box.y - top + 90 } });
}
await page.evaluate(() => { const g = d3.selectAll("g.box.arch").filter((d) => d.id.endsWith("items[at0004]")).node(); g.dispatchEvent(new MouseEvent("mouseleave")); });
// body temperature: binding from the ADL (sct:386725007) added at runtime
out.expanded.bodyTempBinding = await page.evaluate(() => window.V8data().archetypes.find((a) => a.id.includes("body_temperature")).bindings);
s = await st();
out.expanded.bodyTempLink = s.acLinks.filter((l) => l.a.includes("body_temperature")).map((l) => l.a.split("|")[1] + " -> " + l.b);

// toggle: open IPS template + medication cluster archetype, compare attribute tile counts via the in-SVG switch
await page.evaluate(() => { window.V8S.expArch.delete("openEHR-EHR-OBSERVATION.blood_pressure.v2"); window.V8S.expTpl.add("tpl:dm"); window.V8S.expArch.add("openEHR-EHR-CLUSTER.timing_daily.v1"); window.V8render(); }); await settle();
const clickOpt = async (layer, v) => { await page.locator(`g.attr-tog[data-layer=${layer}] g.opt[data-v=${v}]`).click(); await settle(); };
s = await st(); out.toggle.used = { mode: s.attrMode, midEls: s.midEls };
const midClip = () => page.evaluate(() => { const r = d3.selectAll("g.band").filter((d) => d.id === "band-mid").node().getBoundingClientRect(); return { x: 0, y: r.y + scrollY - 4, width: 1600, height: r.height + 8 }; });
if (shots) await page.screenshot({ path: join(shots, "v8-template-endast-anvanda.png"), fullPage: true, clip: await midClip() });
await clickOpt("tpl", "all"); await clickOpt("arch", "all");
s = await st(); out.toggle.all = { mode: s.attrMode, midEls: s.midEls };
if (shots) await page.screenshot({ path: join(shots, "v8-template-alla-attribut.png"), fullPage: true, clip: await midClip() });
out.toggle.persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("cdr-v8-settings")).attrMode);
// all-mode archetype: unused binding-less attributes visible; reload keeps the choice
await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.__state);
out.toggle.afterReload = (await st()).attrMode;
await page.evaluate(() => { localStorage.removeItem("cdr-v8-settings"); });

const ok = out.defaults.arch === "used" && out.defaults.tpl === "used" && out.collapsed.bpRootToSnomed.length >= 3 && out.expanded.systolic && out.expanded.diastolic && out.expanded.root &&
  out.hover.hiAc.some((x) => x.includes("at0004") && x.includes("271649006")) && out.hover.snomedHi.includes("sct:271649006") &&
  out.toggle.all.midEls.tpl > out.toggle.used.midEls.tpl && out.toggle.all.midEls.arch > out.toggle.used.midEls.arch &&
  out.toggle.persisted.tpl === "all" && out.toggle.afterReload.tpl === "all" && errs.length === 0;
out.ok = ok;
console.log(JSON.stringify(out, null, 2));
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
