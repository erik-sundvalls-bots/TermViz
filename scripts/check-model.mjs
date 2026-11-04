import fs from "node:fs";
import path from "node:path";
import { parseAdl, parseOptXml } from "../public/vendor/ehrtslib-0.11.0-parser.min.js";
import { buildIpsModel } from "../src/ips-model.js";

const root = path.resolve(import.meta.dirname, "..");
const optXml = fs.readFileSync(
  path.join(root, "public/models/International_Patient_Summary.opt"),
  "utf8",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "public/models/ips-fileset/adl-manifest.json"), "utf8"),
);
const adlEntries = manifest.map((filePath) => ({
  path: filePath,
  text: fs.readFileSync(path.join(root, "public/models/ips-fileset", filePath), "utf8"),
}));

const model = buildIpsModel({ optXml, adlEntries, parseOptXml, parseAdl });
const failed = model.archetypeReports.filter((report) => report.how === "failed");
const stubs = model.archetypeReports.filter((report) => report.how === "terminology-stub");
const direct = model.archetypeReports.filter((report) => report.how === "direct");

console.log("template", model.templateId);
console.log("nodes", model.counts);
console.log("comparison", {
  both: model.comparison.both,
  missingFromOpt: model.comparison.missingFromOpt,
  optOnly: model.comparison.optOnly,
  conflicts: model.comparison.conflicts,
});
console.log("archetypes", { direct: direct.length, stubs: stubs.length, failed: failed.length });
console.log("suggestions", model.suggestions.attached.map((node) => ({
  name: node.name,
  section: node.section,
  nodeId: node.nodeId,
  archetypeId: node.archetypeId,
  n: node.suggestions.length,
})));
console.log("missing targets", model.suggestions.missing);
if (failed.length) {
  for (const report of failed) console.log("FAIL", report.path, report.error.slice(0, 160));
}

const problems = [];
if (model.suggestions.attached.length !== 3) problems.push("expected 3 suggestion nodes");
if (model.suggestions.missing.length) problems.push("unmatched targets");
if (model.comparison.missingFromOpt !== 0) problems.push("unexpected missing bindings");
if (model.comparison.conflicts !== 0) problems.push("binding conflicts");
if (model.comparison.both < 26) problems.push("expected the 26 shared SNOMED bindings");
if (failed.length) problems.push("archetype parse failures");
if (!model.counts.boundNodes) problems.push("no bound nodes on the tree");

const systolic = [];
(function find(node) {
  if (node.name === "Systolic" && node.bindings.length) systolic.push(node.bindings.map((b) => b.code).join(","));
  node.children.forEach(find);
})(model.tree);
console.log("systolic bindings", systolic);
if (!systolic.includes("271649006")) problems.push("systolic binding missing");

if (problems.length) {
  console.error("PROBLEMS", problems);
  process.exit(1);
}
console.log("model check ok");
