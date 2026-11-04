/**
 * SNOMED CT lookups against the HL7 Nordic Ontoserver (FHIR R4).
 * Each concept is stored in memory and in localStorage, including its
 * direct is-a parents, so a later selection can climb to the root
 * without asking again.
 */

import bundledClosure from "./snomed-closure.json";

export const SNOMED_SYSTEM = "http://snomed.info/sct";
export const SNOMED_ROOT = "138875005";
export const ONTOSERVER = "https://tx-nordics.fhir.org/fhir/r4";
export const BUNDLED_CONCEPTS = bundledClosure.concepts.length;

export function snomedBrowserUrl(code) {
  const url = new URL("https://browser.ihtsdotools.org/");
  url.searchParams.set("perspective", "full");
  url.searchParams.set("conceptId1", String(code));
  url.searchParams.set("edition", "MAIN");
  return url.toString();
}

const CACHE_KEY = "termviz.snomed.lookup.v1";
const memory = new Map();
const inflight = new Map();

function storage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function loadDisk() {
  const box = storage();
  if (!box) return;
  try {
    const saved = JSON.parse(box.getItem(CACHE_KEY) || "{}");
    for (const [code, record] of Object.entries(saved)) {
      if (!memory.has(code)) memory.set(code, record);
    }
  } catch {
    /* ignore a damaged cache */
  }
}

let persistTimer = 0;
function persistSoon() {
  const box = storage();
  if (!box) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const dump = {};
    for (const [code, record] of memory) dump[code] = record;
    try {
      box.setItem(CACHE_KEY, JSON.stringify(dump));
    } catch {
      /* quota or private mode */
    }
  }, 200);
}

loadDisk();

for (const concept of bundledClosure.concepts) {
  memory.set(String(concept.code), {
    code: String(concept.code),
    display: concept.display || "",
    parents: (concept.parents || []).map(String),
    inactive: Boolean(concept.inactive),
    error: null,
  });
}

function parameterValue(parameter) {
  return parameter.valueString ?? parameter.valueCode ?? parameter.valueBoolean ?? null;
}

export function parseLookup(body) {
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
    if (parts.code === "parent" && !parts.valueCode && parts.value) {
      parents.push(String(parts.value));
    }
    if (parts.code === "inactive") inactive = parts.valueBoolean === true || parts.value === true;
  }
  return {
    display: display ? String(parameterValue(display) || "") : "",
    parents: [...new Set(parents)],
    inactive,
  };
}

export async function lookupConcept(code, { signal } = {}) {
  const key = String(code);
  if (memory.has(key)) return { ...memory.get(key), fromCache: true };
  if (inflight.has(key)) return inflight.get(key);
  const url = new URL(`${ONTOSERVER}/CodeSystem/$lookup`);
  url.searchParams.set("system", SNOMED_SYSTEM);
  url.searchParams.set("code", key);
  url.searchParams.set("property", "parent");
  url.searchParams.append("property", "inactive");
  url.searchParams.set("_format", "json");
  const pending = fetchLookup(key, url, signal);
  inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(key);
  }
}

async function fetchLookup(key, url, signal) {
  const response = await fetch(url, {
    headers: { Accept: "application/fhir+json" },
    signal,
  });
  if (!response.ok) {
    const record = {
      code: key,
      display: "",
      parents: [],
      inactive: false,
      error: `Ontoserver returned ${response.status} for ${key}`,
    };
    memory.set(key, record);
    persistSoon();
    return { ...record, fromCache: false };
  }
  const parsed = parseLookup(await response.json());
  const record = { code: key, ...parsed, error: null };
  memory.set(key, record);
  persistSoon();
  return { ...record, fromCache: false };
}

export function cachedConcept(code) {
  return memory.get(String(code)) || null;
}

export function cacheSize() {
  return memory.size;
}

/**
 * Every suggested concept, plus every ancestor, up to and including the
 * SNOMED CT root. Parents outside the returned set are not drawn.
 */
export async function closureToRoot(codes, { onProgress, signal } = {}) {
  const pending = [...new Set(codes.map(String))];
  if (!pending.includes(SNOMED_ROOT)) pending.push(SNOMED_ROOT);
  const seen = new Set();
  let fetched = 0;
  while (pending.length) {
    const batch = pending.splice(0, 6);
    const records = await Promise.all(
      batch.filter((code) => !seen.has(code)).map(async (code) => {
        seen.add(code);
        const record = await lookupConcept(code, { signal });
        fetched += 1;
        return record;
      }),
    );
    for (const record of records) {
      if (record.code === SNOMED_ROOT) continue;
      for (const parent of record.parents) {
        if (!seen.has(parent)) pending.push(parent);
      }
    }
    onProgress?.({ fetched, cached: memory.size });
  }

  const info = new Map();
  for (const code of seen) {
    const record = memory.get(code);
    if (record) info.set(code, record);
  }

  const children = new Map();
  for (const record of info.values()) {
    for (const parent of record.parents) {
      if (!info.has(parent)) continue;
      if (parent === record.code) continue;
      const list = children.get(parent) || [];
      list.push(record.code);
      children.set(parent, list);
    }
  }

  const depth = new Map();
  if (info.has(SNOMED_ROOT)) {
    const queue = [SNOMED_ROOT];
    depth.set(SNOMED_ROOT, 0);
    while (queue.length) {
      const code = queue.shift();
      for (const child of children.get(code) || []) {
        const next = depth.get(code) + 1;
        if (!depth.has(child) || next < depth.get(child)) {
          depth.set(child, next);
          queue.push(child);
        }
      }
    }
  }
  let orphanDepth = (depth.size ? Math.max(...depth.values()) : 0) + 1;
  for (const code of info.keys()) {
    if (!depth.has(code)) depth.set(code, orphanDepth);
  }

  const nodes = [...info.values()].map((record) => ({
    id: record.code,
    display: record.display || record.code,
    parents: record.parents.filter((parent) => info.has(parent) && parent !== record.code),
    depth: depth.get(record.code) ?? orphanDepth,
    inactive: record.inactive,
    error: record.error,
  }));
  const links = [];
  for (const node of nodes) {
    for (const parent of node.parents) {
      links.push({ source: node.id, target: parent });
    }
  }
  return { nodes, links, root: SNOMED_ROOT };
}
