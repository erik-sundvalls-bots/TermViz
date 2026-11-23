// Headless check: the full-archetype tree from ehrtslib parseAdl (via aomParts) matches the built-in ADL 1.4 scanner on every
// bundled IPS archetype (public/models/ips-fileset) plus blood_pressure.v2 from the openEHR CKM-mirror. Prints the differences.
// Usage: node test-v8-adl-parsers.mjs
import { chromium } from "playwright-core";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const pub = join(__dir, "../../..", "public");
const files = JSON.parse(readFileSync(join(pub, "models/ips-fileset/adl-manifest.json"), "utf8"));
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url || "/").split("?")[0]), full = join(pub, path.replace(/^\//, ""));
  if (path.includes("..") || !existsSync(full)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": full.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" }); res.end(readFileSync(full));
});
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await (await browser.newContext()).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${port}/prototyping/v8-multilingual-stack-demo.html?lang=en`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__state && window.__v8Arch, { timeout: 60000 });
const urls = files.map((f) => "../models/ips-fileset/" + f).concat(["https://raw.githubusercontent.com/openEHR/CKM-mirror/master/local/archetypes/entry/observation/openEHR-EHR-OBSERVATION.blood_pressure.v2.adl"]);
const res = await page.evaluate(async (urls) => {
  const A = window.__v8Arch, lib = window.EHRTSlib, out = [];
  const flat = (r) => { const m = new Map(); (function w(n, d) { m.set(n.id, { k: n.k, d, name: JSON.stringify(n.name), vt: (n.vt || []).slice().sort().join(","), pat: n.pattern || "", ref: n.ref || "" }); (n.children || []).forEach((c) => w(c, d + 1)); })(r.tree, 0); return m; };
  for (const url of urls) {
    const text = await (await fetch(url)).text(), aid = (text.match(/\n\s*(openEHR-[\w.-]+\.v\d+)/) || [])[1];
    const prev = window.V8data().archetypes.find((a) => a.id === aid)?.optTree || window.V8data().archetypes.find((a) => a.id === aid)?.tree || null;
    const row = { file: url.split("/").pop(), aid };
    let e = null; try { e = A.adlFullTree(text, aid, prev, A.aomParts(lib.parseAdl(text))); } catch (x) { row.ehrtsError = String(x.message || x).slice(0, 200); }
    const c = A.adlFullTree(text, aid, prev);
    row.attrs = { ehrtslib: e?.nAttr ?? null, builtin: c?.nAttr ?? null };
    if (e && c) { const fe = flat(e), fc = flat(c), diffs = [];
      for (const [id, v] of fc) { const w = fe.get(id); if (!w) diffs.push("only built-in: " + id.split("|")[1]); else for (const k of Object.keys(v)) if (v[k] !== w[k]) diffs.push(`${k} differs at ${id.split("|")[1]}: built-in ${v[k]} / ehrtslib ${w[k]}`); }
      for (const id of fe.keys()) if (!fc.has(id)) diffs.push("only ehrtslib: " + id.split("|")[1]);
      const be = JSON.stringify(e.adlBindings), bc = JSON.stringify(c.adlBindings); if (be !== bc) diffs.push(`bindings: built-in ${bc} / ehrtslib ${be}`);
      const oe = [...fe.keys()].join("\n"), oc = [...fc.keys()].join("\n"); if (oe !== oc && fe.size === fc.size) diffs.push("same nodes, different order");
      row.diffs = diffs; }
    out.push(row);
  }
  return { version: lib.EHRTSlibVersion, out };
}, urls);
const failed = res.out.filter((r) => r.ehrtsError);
const differing = res.out.filter((r) => r.diffs && r.diffs.length);
console.log(JSON.stringify({ ehrtslib: res.version, files: res.out.length, ehrtsFailures: failed, differing, errors: errs }, null, 2));
await browser.close(); server.close();
process.exit(failed.length === 0 && errs.length === 0 && res.out.every((r) => r.attrs.ehrtslib > 0 || r.attrs.builtin === 0) ? 0 : 1);
