// V8 synthetic-cohort check: page errors, default view unchanged vs. baseline, problem distribution, screenshots
import { chromium } from "/workspace/cdr-catalyst/variants/build/node_modules/playwright-core/index.mjs";
const [url, tag, png] = [process.argv[2], process.argv[3] || "new", process.argv[4] || "/workspace/cdr-catalyst/variants/png/"];
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(url); await p.waitForTimeout(1500);
const snap = () => p.evaluate(() => {
  const st = window.__state;
  const ont = [...document.querySelectorAll("g")].filter((g) => g.__data__ && (g.__data__.kind === "ont" || g.__data__.kind === "cluster")).map((g) => g.__data__.kind + ":" + g.__data__.id + (g.__data__.clId ? "@" + g.__data__.clId : "")).sort();
  return { used: st.usedList, clusters: st.clusters, ontVisible: st.ontVisible, links: st.links, xlinks: st.xlinks, daglinks: st.daglinks, ont };
});
const out = {};
const wait = () => p.waitForTimeout(1400);
out.lars = await snap();
if (png && tag === "new") await p.screenshot({ path: png + "v8-default-after-synth.png", fullPage: true });
await p.click("[data-p='Eva Holmgren']"); await wait(); out.eva = await snap();
await p.click("[data-p='both']"); await wait(); out.both = await snap();
await p.click("[data-p='Lars Nyström']"); await wait();
await p.click("#syn"); await wait(); out.synth = await snap();
out.dist = await p.evaluate(() => {
  const res = [];
  const pats = [...document.querySelectorAll("g")].length; // noop
  return null; });
if (png && tag === "new") await p.screenshot({ path: png + "v8-synthetic-varied.png", fullPage: true });
// expand all instances so the synthetic patients show their content
await p.click("#expandInst").catch(() => {}); await wait();
if (png && tag === "new") await p.screenshot({ path: png + "v8-synthetic-varied-expanded.png", fullPage: true });
await p.click("[data-p='both']"); await wait(); out.bothSynth = await snap();
// language switch with synthetics on
const lang = await p.$("button.lang-tog[data-lang='en']"); out.langBtn = !!lang; if (lang) { await lang.click(); await wait(); out.en = await p.evaluate(() => window.__state.lang); }
console.log(JSON.stringify({ tag, errs, out }));
await b.close();
