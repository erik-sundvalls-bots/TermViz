/** Bundle ehrtslib v0.12 parse/serialize APIs for the browser. Does not modify the ehrtslib repo. */
import * as esbuild from "https://deno.land/x/esbuild@v0.20.0/mod.js";
import { dirname, fromFileUrl, join, toFileUrl } from "https://deno.land/std@0.210.0/path/mod.ts";
import { denoPlugins } from "https://deno.land/x/esbuild_deno_loader@0.9.0/mod.ts";

const here = dirname(fromFileUrl(import.meta.url));
const libRoot = join(here, "..", "..", "..", "ehrtslib-rel");
const configPath = join(libRoot, "deno.json");
const entry = toFileUrl(join(here, "ehrtslib-entry.ts")).href;
const outfile = join(here, "..", "lib", "ehrtslib-v012-browser.min.js");

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
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const st = await Deno.stat(outfile);
  console.log("wrote", outfile, "bytes", st.size);
} catch (e) {
  console.error("bundle failed", e);
  Deno.exit(1);
} finally {
  esbuild.stop();
}
