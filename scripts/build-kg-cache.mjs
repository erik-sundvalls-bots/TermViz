#!/usr/bin/env node
/**
 * Build terminology-cache.json for a template-kg-example.
 * Default: embed displays/parents already on graph concept nodes (offline-safe).
 * Optional: --fetch refreshes from Nordic Ontoserver (requires network).
 *
 * Usage:
 *   node scripts/build-kg-cache.mjs international-patient-summary
 *   node scripts/build-kg-cache.mjs international-patient-summary --fetch
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const ONTOSERVER = process.env.ONTOSERVER || "https://tx-nordics.fhir.org/fhir/r4";
const exampleId = process.argv[2] || "international-patient-summary";
const doFetch = process.argv.includes("--fetch");

const examplePath = path.join(root, "public/data/kg-examples", exampleId, "ips-kg-example.json");
const outPath = path.join(root, "public/data/kg-examples", exampleId, "terminology-cache.json");

const example = JSON.parse(fs.readFileSync(examplePath, "utf8"));
const concepts = new Map();

for (const node of example.nodes || []) {
  if (node.type !== "concept" && node.type !== "expression") continue;
  if (!node.system || node.code == null) continue;
  const key = `${node.system}\0${node.code}`;
  concepts.set(key, {
    system: node.system,
    code: String(node.code),
    ontology: node.ontology || null,
    display: node.display_sv || node.display || node.display_en || "",
    display_sv: node.display_sv || null,
    display_en: node.display_en || node.display || null,
    parents: [...(node.parents || [])],
    inactive: Boolean(node.inactive),
  });
}

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
    const parts = Object.fromEntries((parameter.part || []).map((part) => [part.name, parameterValue(part)]));
    if (parts.code === "parent" && parts.valueCode) parents.push(String(parts.valueCode));
    if (parts.code === "inactive") inactive = parts.valueBoolean === true || parts.value === true;
  }
  return {
    display: display ? String(parameterValue(display) || "") : "",
    parents: [...new Set(parents)],
    inactive,
  };
}

async function fetchLookup(system, code) {
  const url = new URL(`${ONTOSERVER}/CodeSystem/$lookup`);
  url.searchParams.set("system", system);
  url.searchParams.set("code", code);
  url.searchParams.set("property", "parent");
  url.searchParams.append("property", "inactive");
  url.searchParams.set("displayLanguage", "sv");
  url.searchParams.set("_format", "json");
  const response = await fetch(url, { headers: { Accept: "application/fhir+json" } });
  if (!response.ok) return null;
  return parseLookup(await response.json());
}

if (doFetch) {
  for (const row of concepts.values()) {
    try {
      const live = await fetchLookup(row.system, row.code);
      if (live) {
        row.display_sv = live.display || row.display_sv;
        row.display = row.display_sv || row.display || live.display;
        row.parents = live.parents.length ? live.parents : row.parents;
        row.inactive = live.inactive;
      }
    } catch {
      /* keep embedded */
    }
  }
  const parentCodes = new Set();
  for (const row of concepts.values()) for (const p of row.parents) parentCodes.add(p);
  for (const p of parentCodes) {
    const key = `http://snomed.info/sct\0${p}`;
    if (concepts.has(key)) continue;
    try {
      const live = await fetchLookup("http://snomed.info/sct", p);
      if (live) {
        concepts.set(key, {
          system: "http://snomed.info/sct",
          code: String(p),
          ontology: "sct",
          display: live.display,
          display_sv: live.display,
          display_en: live.display,
          parents: live.parents,
          inactive: live.inactive,
        });
      }
    } catch {
      /* optional parent stub */
    }
  }
}

const out = {
  schema: "template-kg-terminology-cache/v1",
  example_id: exampleId,
  generated_at: new Date().toISOString(),
  ontoserver: doFetch ? ONTOSERVER : null,
  concepts: [...concepts.values()].sort((a, b) => `${a.system}:${a.code}`.localeCompare(`${b.system}:${b.code}`)),
};

fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${out.concepts.length} concepts → ${outPath}`);
