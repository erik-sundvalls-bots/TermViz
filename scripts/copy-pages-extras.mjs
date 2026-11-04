import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");

for (const name of ["least-common-parent.js", "termviz.js"]) {
  fs.copyFileSync(path.join(root, name), path.join(dist, name));
}
fs.writeFileSync(path.join(dist, ".nojekyll"), "");
