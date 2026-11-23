// Headless check: patient selection = independent on/off toggles (Eva, Lars, +30 synthetic) in one tight button group.
// Any combination incl. all off (= no patients): instance layer empty with a hint, "Only used" shows no used attributes,
// SNOMED/ICD/ATC/NPU bands still show the archetype/template bindings, selection survives a reload, old persisted formats migrate.
// Also: cascade-offset slider moved to the settings menu, SV|EN as one touching button group.
// Usage: node test-v8-no-patients.mjs [screenshot-dir]
import { chromium } from "playwright-core";
import { createServer } from "http";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const pub = process.env.V8_PUBLIC || join(__dir, "../../..", "public");
const shots = process.argv[2] || null;
if (shots) mkdirSync(shots, { recursive: true });
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]), full = join(pub, path.replace(/^\//, ""));
  if (path.includes("..") || !existsSync(full)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": full.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" });
  res.end(readFileSync(full));
});
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.25 })).newPage();
const errs = [], fails = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|CORS policy/.test(m.text())) errs.push(m.text()); });
const URL0 = `http://127.0.0.1:${port}/prototyping/v8-multilingual-stack-demo.html`;
const SETTLE = 1500;
const ok = (c, msg) => { console.log((c ? "ok   " : "FAIL ") + msg); if (!c) fails.push(msg); };
const load = async (lang = "sv") => {
  await page.goto(`${URL0}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__state && window.V8S, { timeout: 60000 });
  await page.waitForTimeout(SETTLE);
};
const st = () => page.evaluate(() => ({ ...window.__state, btns: [...document.querySelectorAll("#patBtns button")].map((b) => ({ t: b.textContent.trim(), on: b.classList.contains("on"), pressed: b.getAttribute("aria-pressed") })), hint: [...document.querySelectorAll(".band-hint")].map((t) => t.textContent) }));
const click = async (sel) => { await page.click(sel); await page.waitForTimeout(SETTLE); };
const setStore = (obj) => page.evaluate((o) => { if (o) localStorage.setItem("cdr-v8-settings", JSON.stringify(o)); else localStorage.removeItem("cdr-v8-settings"); }, obj);

// 1. fresh default: Lars on, Eva off, synthetic off; no Both/None buttons
await load(); await setStore(null); await load();
let s = await st();
ok(s.btns.length === 3, `3 toggles in the group: ${s.btns.map((b) => b.t).join(" | ")}`);
ok(!s.btns.some((b) => /^(✓ )?(Båda|Both|Inga|None)$/.test(b.t)), "no Both/None buttons");
ok(JSON.stringify(s.shownPatients) === JSON.stringify(["Lars Nyström"]), `default shows Lars only: ${s.shownPatients}`);
ok(s.btns.map((b) => b.pressed).join() === "false,true,false", `aria-pressed Eva/Lars/syn = ${s.btns.map((b) => b.pressed)}`);

// 2. tight group geometry and V8 style
const geo = await page.evaluate(() => [...document.querySelectorAll("#patBtns button")].map((b) => { const r = b.getBoundingClientRect(), cs = getComputedStyle(b); return { l: r.left, r: r.right, t: r.top, rad: cs.borderTopLeftRadius, bw: cs.borderTopWidth }; }));
ok(geo.every((g, i) => i === 0 || Math.abs(g.l - geo[i - 1].r) <= 0.5), `buttons touch: ${geo.map((g) => g.l.toFixed(1) + "-" + g.r.toFixed(1)).join(" ")}`);
ok(geo.every((g) => g.t === geo[0].t), "same row");
ok(geo.every((g) => g.rad === "0px" && parseFloat(g.bw) <= 1), `square corners, thin borders: ${geo.map((g) => g.rad + "/" + g.bw)}`);

// 3. combinations
await click("#patBtns [data-p='Eva Holmgren']"); s = await st();
ok(s.shownPatients.length === 2, `Eva + Lars: ${s.shownPatients}`);
await click("#patBtns [data-p='Lars Nyström']"); s = await st();
ok(JSON.stringify(s.shownPatients) === JSON.stringify(["Eva Holmgren"]), `Eva only: ${s.shownPatients}`);
await click("#syn"); s = await st();
ok(s.shownPatients.length === 31 && s.shownPatients.includes("Eva Holmgren"), `Eva + 30 synthetic: ${s.shownPatients.length}`);
await click("#patBtns [data-p='Eva Holmgren']"); s = await st();
ok(s.shownPatients.length === 30 && !s.shownPatients.includes("Eva Holmgren"), `synthetic only: ${s.shownPatients.length}`);
await click("#syn"); s = await st();

// 4. all off = no patients
ok(s.shownPatients.length === 0 && s.instTiles === 0, `all off: ${s.shownPatients.length} patients, ${s.instTiles} instance tiles`);
ok(s.btns.every((b) => !b.on && b.pressed === "false"), "all toggles show off");
ok(s.hint.length === 1 && /Inga patienter valda/.test(s.hint[0]), `hint: ${s.hint[0]}`);
ok(s.ontVisible > 0 && s.xlinks > 0, `terminology bands still show bindings: ontVisible ${s.ontVisible}, xlinks ${s.xlinks}`);
await page.evaluate(() => { V8S.expArch.add("openEHR-EHR-OBSERVATION.blood_pressure.v2"); V8S.expTpl.add("tpl:ips"); V8S.attrMode = { arch: "used", tpl: "used" }; V8render(); });
await page.waitForTimeout(SETTLE); s = await st();
ok(s.midEls.arch === 0 && s.midEls.tpl === 0, `Only used with no patients: ${s.midEls.arch} archetype / ${s.midEls.tpl} template elements`);
await page.evaluate(() => { V8S.attrMode = { arch: "used", tpl: "all" }; V8render(); });
await page.waitForTimeout(SETTLE); s = await st();
ok(s.midEls.tpl > 0, `All attributes still shows the template model: ${s.midEls.tpl} elements`);
if (shots) await page.screenshot({ path: join(shots, "v8-no-patients-sv.png"), fullPage: true });
await page.evaluate(() => { V8S.expArch.clear(); V8S.expTpl.clear(); V8S.attrMode = { arch: "used", tpl: "used" }; V8render(); });

// 5. reload keeps the empty selection; English labels
await load("en"); s = await st();
ok(s.shownPatients.length === 0 && s.btns.every((b) => !b.on), `empty selection survives reload: ${JSON.stringify(s.patSel)}`);
ok(s.btns.map((b) => b.t).join("|") === "Eva|Lars|+ 30 synthetic" && /No patients selected/.test(s.hint[0] || ""), `en labels: ${s.btns.map((b) => b.t)} / ${s.hint[0]}`);
if (shots) { await page.locator(".bar").first().screenshot({ path: join(shots, "v8-patient-toggles-en-off.png") }); }
await click("#patBtns [data-p='Eva Holmgren']"); await click("#syn");
if (shots) { await page.locator(".bar").first().screenshot({ path: join(shots, "v8-patient-toggles-en-eva-syn.png") }); }
await load("en"); s = await st();
ok(s.shownPatients.length === 31 && s.btns.map((b) => b.on).join() === "true,false,true", `Eva + synthetic survives reload: ${s.btns.map((b) => b.on)}`);

// 6. migration of older persisted formats
for (const [store, want, label] of [
  [{ v: 3, lang: "sv", anim: "on" }, ["Lars Nyström"], "v3 without selection -> default Lars"],
  [{ v: 3, patient: "both" }, ["Eva Holmgren", "Lars Nyström"], "old 'both' -> Eva + Lars"],
  [{ v: 3, patient: "none", synthetic: true }, [], "old 'none' -> no patients"],
  [{ v: 3, patient: "Eva Holmgren", synthetic: true }, ["Eva Holmgren", "+30"], "old single patient + synthetic"],
  [{ v: 4, patSel: "garbage" }, ["Lars Nyström"], "broken v4 -> default"],
]) {
  await setStore(store); await load(); s = await st();
  const got = s.shownPatients.filter((k) => !/^(Syntetisk|Synthetic)/.test(k)).concat(s.shownPatients.length > 30 || (s.shownPatients.length === 30 && want.includes("+30")) ? ["+30"] : []);
  ok(JSON.stringify(got) === JSON.stringify(want), `${label}: ${JSON.stringify(got)}`);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cdr-v8-settings") || "{}"));
  void saved;
}
// 7. toolbar: no cascade slider; SV|EN one touching group; slider lives in the settings menu (function, value, persistence, sv/en)
await setStore(null); await load("sv");
const bar = await page.evaluate(() => {
  const b = document.querySelector(".bar"), g = [...b.querySelectorAll(".lang-group > button")];
  const r = g.map((x) => { const q = x.getBoundingClientRect(), cs = getComputedStyle(x); return { l: q.left, r: q.right, t: q.top, rad: cs.borderTopLeftRadius, bw: cs.borderTopWidth, on: x.classList.contains("on"), bg: cs.backgroundColor }; });
  return { offInBar: !!b.querySelector("#off, input[type=range]"), cascadeText: /Kaskad|Cascade/.test(b.textContent), lang: r, offInSettings: !!document.querySelector("#settings #off") };
});
ok(!bar.offInBar && !bar.cascadeText, "cascade slider gone from the toolbar");
ok(bar.offInSettings, "cascade slider is in the settings menu");
ok(bar.lang.length === 2 && Math.abs(bar.lang[1].l - bar.lang[0].r) <= 0.5 && bar.lang[0].t === bar.lang[1].t, `SV|EN touch: ${bar.lang.map((g) => g.l.toFixed(1) + "-" + g.r.toFixed(1)).join(" ")}`);
ok(bar.lang.every((g) => g.rad === "0px" && parseFloat(g.bw) <= 1), `SV|EN square, thin: ${bar.lang.map((g) => g.rad + "/" + g.bw)}`);
ok(bar.lang[0].on && !bar.lang[1].on && bar.lang[0].bg !== bar.lang[1].bg, "SV active and visibly different");
if (shots) await page.locator(".bar").first().screenshot({ path: join(shots, "v8-toolbar-sv.png") });
await page.click("#settingsBtn"); await page.waitForTimeout(300);
const leg = () => page.evaluate(() => [...document.querySelectorAll("#settings legend")].map((l) => l.textContent).find((t) => /Kaskad|Cascade/.test(t)));
ok((await leg()) === "Kaskadavstånd", `sv legend: ${await leg()}`);
await page.locator("#off").fill("6"); await page.waitForTimeout(SETTLE);
s = await page.evaluate(() => ({ off: V8S.off, txt: document.getElementById("offv").textContent, saved: JSON.parse(localStorage.getItem("cdr-v8-settings") || "{}").off }));
ok(s.off === 6 && s.txt === "6" && s.saved === 6, `slider sets offset 6 (shown ${s.txt}, saved ${s.saved})`);
if (shots) await page.screenshot({ path: join(shots, "v8-settings-cascade-sv.png"), clip: await page.locator("#settings").boundingBox().then((b) => ({ x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: Math.min(b.height, 1000) + 16 })) });
await load("en");
s = await page.evaluate(() => ({ off: V8S.off, val: document.getElementById("off").value, txt: document.getElementById("offv").textContent }));
ok(s.off === 6 && s.val === "6" && s.txt === "6", `offset survives reload: ${JSON.stringify(s)}`);
await page.click("#settingsBtn"); await page.waitForTimeout(300);
ok((await leg()) === "Cascade offset", `en legend: ${await leg()}`);
if (shots) await page.screenshot({ path: join(shots, "v8-settings-cascade-en.png"), clip: await page.locator("#settings").boundingBox().then((b) => ({ x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: Math.min(b.height, 1000) + 16 })) });
await page.click("#reset-off"); await page.waitForTimeout(SETTLE);
s = await page.evaluate(() => ({ off: V8S.off, txt: document.getElementById("offv").textContent }));
ok(s.off === 3 && s.txt === "3", `reset to default 3: ${JSON.stringify(s)}`);
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
ok(await page.evaluate(() => document.getElementById("settings").hidden), "settings menu closes with Escape");
await page.evaluate(() => scrollTo(0, 0)); await page.click("#settingsBtn"); await page.waitForTimeout(300);
const gear = await page.evaluate(() => { const b = document.getElementById("settingsBtn").getBoundingClientRect(), p = document.getElementById("settings").getBoundingClientRect(); return { below: p.top >= b.bottom, top: p.top, gear: b.bottom }; });
ok(gear.below, `settings menu opens below the gear (${gear.top.toFixed(0)} >= ${gear.gear.toFixed(0)})`);
await page.click("#settingsBtn"); await page.waitForTimeout(300);
ok(await page.evaluate(() => document.getElementById("settings").hidden), "gear click closes the menu again");
await page.evaluate(() => scrollTo(0, 0));
if (shots) await page.locator(".bar").first().screenshot({ path: join(shots, "v8-toolbar-en.png") });
await setStore(null);
ok(errs.length === 0, `no page errors${errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""}`);
await browser.close(); server.close();
console.log(fails.length ? `${fails.length} FAILED` : "all ok");
process.exit(fails.length ? 1 : 0);
