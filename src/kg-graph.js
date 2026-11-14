import { SNOMED_ROOT, closureToRoot } from "./snomed.js";
import { ONTOLOGIES, ONTOLOGY_ORDER, classifyCode, ontologyDisplayRoots, ontologyForSystem } from "./kg-ontologies.js";
import { bundledConcept, seedTerminologyCache } from "./kg-terminology.js";

let cacheReady = false;

export async function loadCdrTerminologyCache() {
  if (cacheReady) return true;
  const base = import.meta.env.BASE_URL || "/";
  const response = await fetch(`${base}data/cdr-kg/terminology-cache.json`);
  if (!response.ok) throw new Error("The bundled terminology cache could not be loaded.");
  seedTerminologyCache(await response.json());
  cacheReady = true;
  return true;
}

/**
 * IPS demo codes that should appear once terminologies load (step 1: hierarchies only).
 */
export const DEMO_TERMINOLOGY_CODES = [
  { code: "S52.5", system: ONTOLOGIES.icd10.system },
  { code: "I10", system: ONTOLOGIES.icd10.system },
  { code: "E11.9", system: ONTOLOGIES.icd10.system },
  { code: "364090009", system: ONTOLOGIES.sct.system },
  { code: "NPU02319", system: ONTOLOGIES.npu.system },
  { code: "NPU27300", system: ONTOLOGIES.npu.system },
  { code: "A10BA02", system: ONTOLOGIES.atc.system },
  { code: "C07AB03", system: ONTOLOGIES.atc.system },
  { code: "J07BB", system: ONTOLOGIES.atc.system },
];

function gatherBundled(system, code, seen) {
  const pending = [String(code)];
  const records = new Map();
  while (pending.length) {
    const at = pending.pop();
    if (seen.has(at)) continue;
    seen.add(at);
    const row = bundledConcept(system, at);
    if (!row) continue;
    records.set(at, row);
    for (const parent of row.parents || []) {
      if (!seen.has(parent)) pending.push(parent);
    }
  }
  const ontology = ontologyForSystem(system) || classifyCode(code, system);
  for (const root of ontologyDisplayRoots(ontology)) {
    if (seen.has(root)) continue;
    const extra = bundledConcept(system, root);
    if (extra) {
      seen.add(root);
      records.set(root, extra);
    }
  }
  return records;
}

function mergeRecord(map, record, ontology) {
  const id = String(record.code);
  const existing = map.get(id);
  const parents = (record.parents || []).filter((parent) => parent !== id);
  if (!existing) {
    map.set(id, {
      id,
      display: record.display_sv || record.display || record.display_en || id,
      parents,
      ontology,
      inactive: Boolean(record.inactive),
      error: record.error,
      system: record.system,
    });
    return;
  }
  existing.display ||= record.display_sv || record.display || record.display_en || id;
  existing.parents = [...new Set([...existing.parents, ...parents])];
}

function buildBundledGraph(selections, enabled) {
  const byId = new Map();
  const seen = new Set();
  for (const { code, system } of selections) {
    const ontology = classifyCode(code, system);
    if (!enabled.has(ontology)) continue;
    const records = gatherBundled(system || ONTOLOGIES[ontology]?.system, code, seen);
    for (const record of records.values()) mergeRecord(byId, record, ontology);
  }
  for (const ontology of ONTOLOGY_ORDER) {
    if (!enabled.has(ontology)) continue;
    if (ontology === "sct") continue;
    for (const root of ontologyDisplayRoots(ontology)) {
      const meta = ONTOLOGIES[ontology];
      const record = bundledConcept(meta.system, root);
      if (record) mergeRecord(byId, record, ontology);
    }
  }
  const nodes = [...byId.values()];
  const links = [];
  for (const node of nodes) {
    for (const parent of node.parents) {
      if (!byId.has(parent)) continue;
      links.push({ source: node.id, target: parent });
    }
  }
  for (const node of nodes) {
    const roots = ontologyDisplayRoots(node.ontology);
    node.isOntologyRoot = roots.includes(node.id);
    if (node.id === SNOMED_ROOT) node.isOntologyRoot = true;
  }
  return { nodes, links };
}

function mergeGraphs(parts) {
  const byId = new Map();
  const links = [];
  for (const part of parts) {
    for (const node of part.nodes || []) {
      const id = String(node.id);
      const existing = byId.get(id);
      if (!existing) byId.set(id, { ...node });
      else {
        existing.suggestion ||= node.suggestion;
        existing.cp ||= node.cp;
        existing.lcp ||= node.lcp;
        existing.sources = [...(existing.sources || []), ...(node.sources || [])];
        existing.fill ||= node.fill;
        existing.stroke ||= node.stroke;
        existing.sliceFills = node.sliceFills || existing.sliceFills;
        existing.commonality = Math.max(existing.commonality || 0, node.commonality || 0);
      }
    }
    for (const link of part.links || []) links.push(link);
  }
  return { nodes: [...byId.values()], links };
}

function snomedSelections(codes) {
  return [...new Set(codes.map(String))].filter((code) => classifyCode(code) === "sct");
}

function otherSelections(codes) {
  const out = [];
  const seen = new Set();
  for (const item of codes) {
    const code = typeof item === "string" ? item : item.code;
    const system = typeof item === "string" ? null : item.system;
    const ontology = classifyCode(code, system);
    if (ontology === "sct") continue;
    const key = `${system || ontology}\0${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: String(code), system: system || ONTOLOGIES[ontology]?.system });
  }
  return out;
}

export async function buildExplorerGraph(codes, { enabledOntologies, signal } = {}) {
  const enabled = enabledOntologies || new Set(ONTOLOGY_ORDER);
  const snomed = snomedSelections(codes);
  const bundled = otherSelections([...codes, ...DEMO_TERMINOLOGY_CODES]);
  const parts = [];
  if (enabled.has("sct") && snomed.length) {
    const graph = await closureToRoot(snomed, { signal });
    for (const node of graph.nodes) {
      node.ontology = "sct";
      if (node.id === SNOMED_ROOT) node.isOntologyRoot = true;
    }
    parts.push(graph);
  }
  const extra = buildBundledGraph(bundled, enabled);
  if (extra.nodes.length) parts.push(extra);
  const merged = mergeGraphs(parts);
  merged.root = SNOMED_ROOT;
  return merged;
}
