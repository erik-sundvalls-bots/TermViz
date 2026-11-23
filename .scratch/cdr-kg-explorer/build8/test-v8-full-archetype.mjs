// Headless check for two V8 behaviours:
// 1. hovering a node emphasises its path but keeps the other (thin) links visible (no fade-out);
// 2. "Alla attribut" replaces the OPT-derived archetype tree with the full archetype (ADL) from the archetype library,
//    cached in IndexedDB (cdr-v8-adl-cache), incl. its SNOMED CT term bindings; plus a browser-side probe of the
//    CKM REST API (CORS) and the openEHR CKM-mirror on GitHub.
// Usage: node test-v8-full-archetype.mjs [screenshot-dir]
import { chromium } from "playwright-core";
import { createServer } from "http";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const pub = join(__dir, "../../..", "public"); // serves /prototyping/... and /models/... like gh-pages
const shots = process.argv[2] || null;
if (shots) mkdirSync(shots, { recursive: true });
const served = [];
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]);
  const full = join(pub, path.replace(/^\//, ""));
  if (path.includes("..") || !existsSync(full)) { res.writeHead(404); res.end(); return; }
  served.push(path);
  res.writeHead(200, { "Content-Type": full.endsWith(".json") ? "application/json" : full.endsWith(".adl") ? "text/plain; charset=utf-8" : "text/html; charset=utf-8" });
  res.end(readFileSync(full));
});
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.5 })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|CORS policy/.test(m.text())) errs.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/prototyping/v8-multilingual-stack-demo.html?lang=sv`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__state && window.__v8Arch, { timeout: 60000 });
await page.evaluate(async () => { localStorage.removeItem("cdr-v8-settings"); await window.__v8Arch.adlCacheClearAll(); });
const settle = (ms = 1300) => page.waitForTimeout(ms);
const BP = "openEHR-EHR-OBSERVATION.blood_pressure.v2";
const st = () => page.evaluate(() => window.__state);
const out = { hover: {}, sources: {}, full: {}, errors: errs };

// ---------- 1. hover keeps other links ----------
await page.evaluate((a) => { window.V8S.expArch.add(a); window.V8render(); }, BP); await settle();
const beforeMin = await page.evaluate(() => Math.min(...[...document.querySelectorAll("path.lk")].filter((p) => +p.getAttribute("stroke-opacity") > 0).map((el) => +getComputedStyle(el).opacity)));
await page.evaluate((bp) => { const g = d3.selectAll("g.box.arch").filter((d) => d.id === bp + "|/data[at0001]/events[at0006]/data[at0003]/items[at0004]").node();
  g.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, clientX: 400, clientY: 400 })); }, BP);
await page.waitForTimeout(500); // let the .12 s opacity transition finish
const hov = await page.evaluate((bp) => {
  const op = (el) => +getComputedStyle(el).opacity;
  const lk = [...document.querySelectorAll("path.lk")].filter((p) => +p.getAttribute("stroke-opacity") > 0);
  const hi = lk.filter((p) => p.classList.contains("hi")), other = lk.filter((p) => !p.classList.contains("hi"));
  const nodeOps = [...document.querySelectorAll("g.box.dimmable:not(.hi)")].slice(0, 50).map(op);
  return { links: lk.length, hi: hi.length, other: other.length, otherMinOpacity: Math.min(...other.map(op)), hiMinOpacity: Math.min(...hi.map(op)), unrelatedNodeOpacity: nodeOps[0] };
}, BP);
hov.beforeMin = beforeMin; out.hover = hov;
if (shots) {
  await page.evaluate(() => { document.getElementById("tip").style.display = "none"; });
  const clip = await page.evaluate(() => { const r = document.getElementById("v").getBoundingClientRect(), m = d3.selectAll("g.band").filter((d) => d.id === "band-mid").node().getBoundingClientRect(); return { x: 0, y: r.y + scrollY, width: 1600, height: m.y + m.height - r.y + 10 }; });
  await page.screenshot({ path: join(shots, "v8-hover-keeps-links.png"), fullPage: true, clip });
}
await page.evaluate((bp) => { d3.selectAll("g.box.arch").filter((d) => d.id === bp + "|/data[at0001]/events[at0006]/data[at0003]/items[at0004]").node().dispatchEvent(new MouseEvent("mouseleave")); }, BP);

// ---------- source probe from the browser (CORS) ----------
out.sources = await page.evaluate(async (aid) => {
  const A = window.__v8Arch, r = {};
  for (const src of [{ kind: "ckm", base: "https://ckm.openehr.org/ckm", label: "ckm" }, { kind: "tree", base: "https://raw.githubusercontent.com/openEHR/CKM-mirror/master/local/archetypes/", label: "mirror" }, { kind: "tree", base: "../models/ips-fileset/archetypes/", label: "bundled" }]) {
    try { const x = await A.fetchFromSource(src, aid); r[src.label] = { ok: true, url: x.url, bytes: x.text.length }; } catch (e) { r[src.label] = { ok: false, err: String(e.message || e) }; } }
  return r;
}, BP);

// ---------- 2. used vs all on blood pressure ----------
const bpTiles = () => page.evaluate((bp) => d3.selectAll("g.box.arch").data().filter((d) => d.id.startsWith(bp + "|") && d.id !== bp + "|/").map((d) => (typeof d.n?.name === "object" ? d.n.name.en : d.n?.name) || d.id), BP);
out.full.used = await bpTiles();
await page.locator("g.attr-tog[data-layer=arch] g.opt[data-v=all]").click();
await page.waitForFunction((bp) => window.__state.archFull?.[bp]?.state === "ok" || window.__state.archFull?.[bp]?.state === "err", BP, { timeout: 60000 });
await settle(1600);
let s = await st();
out.full.state = s.archFull[BP];
out.full.all = await bpTiles();
out.full.parser = (await st()).archFull[BP]?.parser || null; // ehrtslib parseAdl, built-in scanner only as fallback
out.full.bindings = await page.evaluate((bp) => window.V8data().archetypes.find((a) => a.id === bp).bindings.map((b) => b[0].split("|")[1] + " -> " + b[1]), BP);
await page.waitForTimeout(2500); // binding target lookups (cuff size 246153002)
s = await st();
out.full.cuffLink = s.acLinks.filter((l) => l.a.includes("at0013")).map((l) => l.b);
out.full.cached = await page.evaluate(async (bp) => { const c = await window.__v8Arch.adlCacheGet(bp); return c ? { src: c.src, bytes: c.text.length } : null; }, BP);
if (shots) {
  const clip = await page.evaluate((bp) => { const n = d3.selectAll("g.box.arch").filter((d) => d.id === bp + "|/").node().getBoundingClientRect(); return { x: Math.max(0, n.x - 20), y: n.y + scrollY - 30, width: Math.min(1600 - Math.max(0, n.x - 20), n.width + 40), height: n.height + 50 }; }, BP);
  await page.screenshot({ path: join(shots, "v8-bp-alla-attribut-full-archetype.png"), fullPage: true, clip });
  const mid = await page.evaluate(() => { const r = d3.selectAll("g.band").filter((d) => d.id === "band-mid").node().getBoundingClientRect(); return { x: 0, y: r.y + scrollY - 4, width: 1600, height: r.height + 8 }; });
  await page.screenshot({ path: join(shots, "v8-arch-layer-alla-attribut.png"), fullPage: true, clip: mid });
}
// back to "Endast använda": only systolic/diastolic again
await page.locator("g.attr-tog[data-layer=arch] g.opt[data-v=used]").click(); await settle();
out.full.usedAgain = await bpTiles();
// reload: served from IndexedDB cache, no new fetch of the ADL
served.length = 0;
await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.__state && window.__v8Arch);
await page.evaluate((a) => { window.V8S.expArch.add(a); window.V8S.attrMode = { ...window.V8S.attrMode, arch: "all" }; window.V8render(); }, BP);
await page.waitForFunction((bp) => window.__state.archFull?.[bp]?.state === "ok", BP, { timeout: 30000 }); await settle();
out.full.afterReload = { state: (await st()).archFull[BP], adlRequests: served.filter((p) => p.endsWith(".adl")).length, tiles: (await bpTiles()).length };
await page.evaluate(async () => { localStorage.removeItem("cdr-v8-settings"); await window.__v8Arch.adlCacheClearAll(); });

const want = ["Mean arterial pressure", "Pulse pressure", "Comment", "Position", "Cuff size", "Location of measurement", "Method"];
out.full.missing = want.filter((w) => !out.full.all.includes(w));
const ok = hov.hi > 0 && hov.other > 0 && hov.otherMinOpacity >= 0.8 && hov.hiMinOpacity === 1 &&
  out.full.used.length === 2 && out.full.state.state === "ok" && /^ehrtslib 0\.1[6-9]/.test(out.full.parser || "") && out.full.missing.length === 0 && out.full.all.length > 15 &&
  out.full.bindings.some((b) => b.includes("at0013") && b.includes("246153002")) && out.full.cached && out.full.usedAgain.length === 2 &&
  out.full.afterReload.state.cached === true && out.full.afterReload.adlRequests === 0 && errs.length === 0;
out.ok = ok;
console.log(JSON.stringify(out, null, 2));
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
