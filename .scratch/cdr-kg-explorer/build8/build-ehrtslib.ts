/** Bundle ehrtslib parse/serialize APIs for the browser (IIFE, global EHRTSlib). Does not modify the ehrtslib checkout.
 * Usage: EHRTSLIB_ROOT=/path/to/ehrtslib-checkout (git tag, e.g. v0.16) deno run -A build-ehrtslib.ts
 * Default root: ../../../ehrtslib-rel. Output: ../lib/ehrtslib-browser.min.js */
import * as esbuild from "https://deno.land/x/esbuild@v0.20.0/mod.js";
import { dirname, fromFileUrl, join, toFileUrl } from "https://deno.land/std@0.210.0/path/mod.ts";
import { denoPlugins } from "https://deno.land/x/esbuild_deno_loader@0.9.0/mod.ts";

const here = dirname(fromFileUrl(import.meta.url));
const libRoot = Deno.env.get("EHRTSLIB_ROOT") || join(here, "..", "..", "..", "ehrtslib-rel");
const configPath = join(libRoot, "deno.json");
const libVersion = JSON.parse(await Deno.readTextFile(configPath)).version || "unknown";
// the entry file imports from ../../../ehrtslib-rel/; point those imports at libRoot and stamp the version
const entrySrc = (await Deno.readTextFile(join(here, "ehrtslib-entry.ts")))
  .replaceAll("../../../ehrtslib-rel/", toFileUrl(libRoot + "/").href)
  .replace(/export const EHRTSlibVersion = "[^"]*";/, `export const EHRTSlibVersion = "${libVersion}";`);
const entryPath = join(libRoot, ".v8-browser-entry.ts");
await Deno.writeTextFile(entryPath, entrySrc);
const entry = toFileUrl(entryPath).href;
const outfile = join(here, "..", "lib", "ehrtslib-browser.min.js");

const jsonAsModulePlugin = {
  name: "json-as-module",
  setup(build: esbuild.PluginBuild) {
    build.onLoad({ filter: /\.json$/ }, async (args) => ({
      contents: `export default ${await Deno.readTextFile(args.path)}`,
      loader: "js",
    }));
  },
};

console.log("bundling ehrtslib from", libRoot);
try {
  await esbuild.build({
    plugins: [jsonAsModulePlugin, ...denoPlugins({ configPath })],
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: "iife",
    globalName: "EHRTSlib",
    target: "es2022",
    platform: "browser",
    minify: true,
    keepNames: true, // V8 tells AOM classes apart by constructor name (e.g. ARCHETYPE_SLOT without includes)
    define: { "process.env.NODE_ENV": '"production"', "import.meta.url": '"https://bundle.invalid/ehrtslib-browser.js"' }, // IIFE has no import.meta; ehrtslib only uses it to skip file: requires
  });
  const st = await Deno.stat(outfile);
  console.log("wrote", outfile, "bytes", st.size);
} catch (e) {
  console.error("bundle failed", e);
  Deno.exit(1);
} finally {
  await Deno.remove(entryPath).catch(() => {});
  esbuild.stop();
}
