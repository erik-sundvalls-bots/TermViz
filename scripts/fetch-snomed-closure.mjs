import fs from "node:fs";
import path from "node:path";
import { parseAdl, parseOptXml } from "../public/vendor/ehrtslib-0.11.0-parser.min.js";
import { buildIpsModel } from "../src/ips-model.js";
import { parseSnapMap } from "../src/snap2snomed.js";

const rootDir = path.resolve(import.meta.dirname, "..");
const ONTOSERVER = "https://tx-nordics.fhir.org/fhir/r4";
const SYSTEM = "http://snomed.info/sct";
const SNOMED_ROOT = "138875005";

function parameterValue(parameter) {
  return parameter.valueString ?? parameter.valueCode ?? parameter.valueBoolean ?? null;
}

function parseLookup(body) {
  const parameters = body?.parameter || [];
  const display = parameters.find((item) => item.name === "display");
  const parents = [];
  let inactive = false;
  for (const parameter of parameters) {
    if (parameter.name !== "property") continue;
    const parts = Object.fromEntries(
      (parameter.part || []).map((part) => [part.name, parameterValue(part)]),
    );
    if (parts.code === "parent" && parts.valueCode) parents.push(String(parts.valueCode));
    if (parts.code === "parent" && !parts.valueCode && parts.value) parents.push(String(parts.value));
    if (parts.code === "inactive") inactive = parts.valueBoolean === true || parts.value === true;
  }
  return {
    display: display ? String(parameterValue(display) || "") : "",
    parents: [...new Set(parents)],
    inactive,
  };
}

async function lookup(code) {
  const url = new URL(`${ONTOSERVER}/CodeSystem/$lookup`);
  url.searchParams.set("system", SYSTEM);
  url.searchParams.set("code", code);
  url.searchParams.set("property", "parent");
  url.searchParams.append("property", "inactive");
  url.searchParams.set("_format", "json");
  const response = await fetch(url, { headers: { Accept: "application/fhir+json" } });
  if (response.status === 404) {
    const known = mapRows.find((row) => row.code === code);
    return { code, display: known?.display || "", parents: [], inactive: false };
  }
  if (!response.ok) throw new Error(`Ontoserver ${response.status} for ${code}`);
  return { code, ...parseLookup(await response.json()) };
}

const optXml = fs.readFileSync(path.join(rootDir, "public/models/International_Patient_Summary.opt"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "public/models/ips-fileset/adl-manifest.json"), "utf8"));
const adlEntries = manifest.map((filePath) => ({
  path: filePath,
  text: fs.readFileSync(path.join(rootDir, "public/models/ips-fileset", filePath), "utf8"),
}));
const mapRows = parseSnapMap(fs.readFileSync(path.join(rootDir, "public/maps/ips-snap2snomed.csv"), "utf8"));
const model = buildIpsModel({ optXml, adlEntries, parseOptXml, parseAdl, mapRows });

const seeds = new Set(mapRows.map((row) => row.code));
(function walk(node) {
  for (const binding of [...(node.bindings || []), ...(node.valueBindings || []), ...(node.scopeBindings || [])]) {
    if (binding.code) seeds.add(String(binding.code));
  }
  for (const child of node.children || []) walk(child);
})(model.tree);

const concepts = new Map();
const previousPath = path.join(rootDir, "src/snomed-closure.json");
if (fs.existsSync(previousPath)) {
  const previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));
  for (const concept of previous.concepts || []) {
    concepts.set(String(concept.code), {
      code: String(concept.code),
      display: concept.display || "",
      parents: (concept.parents || []).map(String),
      inactive: Boolean(concept.inactive),
    });
  }
  for (const code of previous.seeds || []) seeds.add(String(code));
}
const pending = [...seeds, SNOMED_ROOT];
while (pending.length) {
  const batch = pending.splice(0, 6);
  const records = await Promise.all(batch.filter((code) => !concepts.has(code)).map(async (code) => {
    concepts.set(code, null);
    const record = await lookup(code);
    return record;
  }));
  for (const record of records) {
    concepts.set(record.code, record);
    if (record.code === SNOMED_ROOT) continue;
    for (const parent of record.parents) {
      if (!concepts.has(parent)) pending.push(parent);
    }
  }
  process.stderr.write(`concepts ${[...concepts.values()].filter(Boolean).length}\n`);
}

const list = [...concepts.values()].filter(Boolean).sort((a, b) => a.code.localeCompare(b.code));
const missing = list.filter((item) => !item.display);
if (missing.length) {
  console.error("missing displays", missing.map((item) => item.code));
  process.exit(1);
}
const payload = {
  source: ONTOSERVER,
  system: SYSTEM,
  root: SNOMED_ROOT,
  edition: "http://snomed.info/sct/900000000000207008",
  seeds: [...seeds].sort(),
  concepts: list.map((item) => ({
    code: item.code,
    display: item.display,
    parents: item.parents,
    inactive: item.inactive,
  })),
};
const out = path.join(rootDir, "src/snomed-closure.json");
fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`wrote ${list.length} concepts from ${seeds.size} seeds to ${out}`);
