// Headless regression check: opened archetype/template tiles keep their nested shading.
// Every visible tile (leaf or container) of an opened archetype/template must, after transitions settle, have a card rect with a
// fill, non-zero fill opacity and a stroke, sit where its label is, and be painted before (under) its descendants: a container
// painted after its children covers them with its opaque card, leaving only the labels (the bug Erik saw on the live V8).
// Scenarios: open one after another (later-ordered first), reopen during a running transition, Only used <-> All attributes
// (full archetype load), language switch, mouse clicks while a transition runs.
// Layout: subtree extents of top-level tiles (per band) and of nested siblings must not overlap.
// Usage: node test-v8-shading.mjs [screenshot-dir] [screenshot-prefix]
import { chromium } from "playwright-core";
import { createServer } from "http";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const pub = process.env.V8_PUBLIC || join(__dir, "../../..", "public");
const shots = process.argv[2] || null, prefix = process.argv[3] || "v8-shading-after";
if (shots) mkdirSync(shots, { recursive: true });
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]), full = join(pub, path.replace(/^\//, ""));
  if (path.includes("..") || !existsSync(full)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": full.endsWith(".json") ? "application/json" : full.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" });
  res.end(readFileSync(full));
});
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.25 })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|CORS policy/.test(m.text())) errs.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/prototyping/v8-multilingual-stack-demo.html?lang=en`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__state && window.__v8Arch, { timeout: 60000 });
await page.evaluate(async () => { localStorage.removeItem("cdr-v8-settings"); await window.__v8Arch.adlCacheClearAll(); window.V8S.attrMode = { arch: "used", tpl: "used" }; });
await page.waitForTimeout(2500);
const SETTLE = 1500; // 900 ms layout transition + margin
const BP = "openEHR-EHR-OBSERVATION.blood_pressure.v2", MED = "openEHR-EHR-ACTION.medication.v1";
const ev = (f, a) => page.evaluate(f, a);
const render = (f, a) => ev(f, a);
const check = () => page.evaluate(() => {
  const bad = [], exp = [...document.querySelectorAll("g.exp g.box")], idx = new Map(), byId = new Map();
  exp.forEach((g, i) => { const d = g.__data__; if (d) { idx.set(d.id, i); byId.set(d.id, g); } });
  let n = 0;
  for (const lab of document.querySelectorAll("g.elabs g.elab")) {
    const d = lab.__data__; if (!d || (d.kind !== "arch" && d.kind !== "tpl")) continue; n++;
    const g = byId.get(d.id); if (!g) { bad.push(["no tile", d.id]); continue; }
    const r = g.querySelector("rect.card"), cs = getComputedStyle(r), f = r.getAttribute("fill"), s = r.getAttribute("stroke");
    const op = +getComputedStyle(g).opacity, fop = +cs.fillOpacity, sw = +r.getAttribute("stroke-width");
    if (!(op > 0.95) || !f || f === "none" || !(fop > 0) || !s || s === "none" || !(sw > 0)) bad.push(["paint", d.id, op, f, fop, s, sw]);
    const rb = r.getBoundingClientRect(), lb = lab.getBoundingClientRect();
    if (Math.abs(rb.x - lb.x) > 3 || Math.abs(rb.y - lb.y) > 3) bad.push(["position", d.id]);
    // painted under every descendant: walk up the parent chain
    let p = d.parentId;
    while (p && idx.has(p)) { if (idx.get(p) > idx.get(d.id)) { bad.push(["covered by", p, d.id]); break; } p = byId.get(p).__data__.parentId; }
  }
  // layout overlap: subtree extents (card of a tile plus all its descendants' cards) of top-level tiles, and of nested siblings
  const items = [...document.querySelectorAll("g.exp g.box, g.col g.box")].map((g) => g.__data__).filter((d) => d && (d.kind === "arch" || d.kind === "tpl"));
  const kids = new Map(); for (const d of items) if (d.parentId) { if (!kids.has(d.parentId)) kids.set(d.parentId, []); kids.get(d.parentId).push(d); }
  const ext = new Map(), extent = (d) => { if (ext.has(d.id)) return ext.get(d.id); let e = { x0: d.x, y0: d.y, x1: d.x + d.w, y1: d.y + d.h };
    for (const k of kids.get(d.id) || []) { const c = extent(k); e = { x0: Math.min(e.x0, c.x0), y0: Math.min(e.y0, c.y0), x1: Math.max(e.x1, c.x1), y1: Math.max(e.y1, c.y1) }; } ext.set(d.id, e); return e; };
  const hit = (a, b) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
  const overlaps = [], groups = [["top", items.filter((d) => !d.parentId)]].concat([...kids.entries()]);
  for (const [pid, list] of groups) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (pid === "top" && list[i].kind !== list[j].kind) continue; // archetype and template rows are separate bands
    if (hit(extent(list[i]), extent(list[j]))) overlaps.push([pid === "top" ? "top-level" : "siblings", list[i].id.slice(-50), list[j].id.slice(-50)]); }
  const opened = items.filter((d) => !d.parentId && !d.blob && (kids.get(d.id) || []).length).length;
  return { tiles: n, opened, bad: bad.length + overlaps.length, overlaps: overlaps.length, sample: bad.concat(overlaps).slice(0, 3) };
});
const out = { scenarios: {}, errors: errs };
const run = async (name, steps, shot) => {
  for (const s of steps) await s();
  await page.waitForTimeout(SETTLE);
  out.scenarios[name] = await check();
  if (shots && shot) {
    await page.evaluate(() => { document.getElementById("tip").style.display = "none"; });
    const clip = await page.evaluate(() => { const r = d3.selectAll("g.band").filter((d) => d.id === "band-mid").node().getBoundingClientRect(); return { x: 0, y: r.y + scrollY - 4, width: 1600, height: r.height + 8 }; });
    await page.screenshot({ path: join(shots, `${prefix}-${shot}.png`), fullPage: true, clip });
  }
};
const reset = () => render(() => { V8S.expArch.clear(); V8S.expTpl.clear(); V8S.attrMode = { arch: "used", tpl: "used" }; V8render(); });
const wait = (ms) => () => page.waitForTimeout(ms);
// 1. templates opened one after another, the later-ordered one first (Annual diabetes review, then IPS, then Emergency visit)
await run("templates one by one", [() => render(() => { V8S.expTpl.add("tpl:dm"); V8render(); }), wait(SETTLE),
  () => render(() => { V8S.expTpl.add("tpl:ips"); V8render(); }), wait(SETTLE), () => render(() => { V8S.expTpl.add("tpl:akut"); V8render(); })], "templates");
// 2. archetypes one by one, then All attributes (full blood pressure archetype loads asynchronously)
await run("archetypes one by one + all", [() => render((m) => { V8S.expArch.add(m); V8render(); }, MED), wait(SETTLE),
  () => render((b) => { V8S.expArch.add(b); V8render(); }, BP), wait(300),
  () => page.locator("g.attr-tog[data-layer=arch] g.opt[data-v=all]").click(),
  () => page.waitForFunction((bp) => ["ok", "err"].includes(window.__state.archFull?.[bp]?.state), BP, { timeout: 60000 })], "archetypes-all");
// 3. language switch with everything open
await run("language sv", [() => page.locator(".bar [data-lang=sv]").click()]);
await run("language en", [() => page.locator(".bar [data-lang=en]").click()]);
// 4. collapse and reopen while the exit transition is still running
await run("reopen mid-transition", [() => render((b) => { V8S.expArch.delete(b); V8S.expTpl.delete("tpl:ips"); V8render(); }, BP), wait(250),
  () => render((b) => { V8S.expArch.add(b); V8S.expTpl.add("tpl:ips"); V8render(); }, BP)], "reopen");
// 5. toggle Only used / All attributes rapidly on both layers
await run("toggle used/all", [() => page.locator("g.attr-tog[data-layer=tpl] g.opt[data-v=all]").click(), wait(200),
  () => page.locator("g.attr-tog[data-layer=arch] g.opt[data-v=used]").click(), wait(200),
  () => page.locator("g.attr-tog[data-layer=arch] g.opt[data-v=all]").click(), wait(100),
  () => page.locator("g.attr-tog[data-layer=tpl] g.opt[data-v=used]").click()]);
// 5b. everything open, All attributes on both layers (largest subtrees, full archetypes)
await run("all open, all attributes", [() => render(() => { for (const a of V8data().archetypes) V8S.expArch.add(a.id); for (const t of V8data().templates) V8S.expTpl.add(t.id); V8S.attrMode = { arch: "all", tpl: "all" }; V8render(); }),
  () => page.waitForFunction(() => Object.values(window.__state.archFull || {}).length >= window.V8data().archetypes.length && Object.values(window.__state.archFull).every((x) => x.state !== "loading"), null, { timeout: 90000 })], "all-open");
// 6. real mouse clicks on collapsed pills while a transition runs
await reset(); await page.waitForTimeout(SETTLE);
const clickPill = async (id) => { const b = await page.evaluate((i) => { const g = d3.selectAll("g.col g.box").filter((d) => d.id === i).node(); if (!g) return null; const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id); if (b) await page.mouse.click(b.x, b.y); };
const tplRoot = (t) => page.evaluate((t) => window.V8data().templates.find((x) => x.id === t).tree.id, t);
const dmRoot = await tplRoot("tpl:dm"), ipsRoot = await tplRoot("tpl:ips"), akutRoot = await tplRoot("tpl:akut");
await run("mouse clicks mid-transition", [() => clickPill(dmRoot), wait(400), () => clickPill(MED + "|/"), wait(300), () => clickPill(akutRoot), wait(200), () => clickPill(BP + "|/"), wait(SETTLE), () => clickPill(ipsRoot)], "clicks");
await reset();
await page.evaluate(async () => { localStorage.removeItem("cdr-v8-settings"); await window.__v8Arch.adlCacheClearAll(); });
const ok = Object.values(out.scenarios).every((s) => s.tiles > 0 && s.bad === 0) && errs.length === 0;
out.ok = ok;
console.log(JSON.stringify(out, null, 2));
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
