/**
 * FHIR CodeSystem $lookup for knowledge-graph concept nodes (SNOMED, NPU, ICD-10, …).
 */
import { ONTOSERVER, parseLookup, directChildren, lookupConcept, SNOMED_SYSTEM } from "./snomed.js";

const memory = new Map();
const bundleCache = new Map();
const inflight = new Map();

export function bundledConcept(system, code) {
  return bundleCache.get(cacheKey(system, code)) || null;
}

export function seedTerminologyCache(body) {
  bundleCache.clear();
  const list = body?.concepts || [];
  for (const row of list) {
    if (!row.system || row.code == null) continue;
    const key = cacheKey(row.system, row.code);
    bundleCache.set(key, {
      system: row.system,
      code: String(row.code),
      display: row.display_sv || row.display || row.display_en || "",
      display_sv: row.display_sv || null,
      display_en: row.display_en || row.display || null,
      parents: row.parents || [],
      inactive: Boolean(row.inactive),
      error: null,
      source: "bundle",
    });
  }
}

function cacheKey(system, code) {
  return `${system}\0${code}`;
}

export async function lookupTerminology(system, code, { displayLanguage, signal, live = false } = {}) {
  const key = cacheKey(system, code);
  if (!live && bundleCache.has(key)) {
    return { ...bundleCache.get(key), fromCache: true, fromBundle: true };
  }
  if (memory.has(key)) return { ...memory.get(key), fromCache: true, fromBundle: false };
  if (inflight.has(key)) return inflight.get(key);

  const pending = fetchTerminology(key, system, code, displayLanguage, signal);
  inflight.set(key, pending);
  try {
    return await pending;
  } finally {
    inflight.delete(key);
  }
}

async function fetchTerminology(key, system, code, displayLanguage, signal) {
  if (system === SNOMED_SYSTEM && !String(code).includes(":")) {
    return lookupConcept(code, { signal });
  }

  const url = new URL(`${ONTOSERVER}/CodeSystem/$lookup`);
  url.searchParams.set("system", system);
  url.searchParams.set("code", String(code));
  url.searchParams.set("property", "parent");
  url.searchParams.append("property", "inactive");
  if (displayLanguage) url.searchParams.set("displayLanguage", displayLanguage);
  url.searchParams.set("_format", "json");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/fhir+json" },
      signal,
    });
    if (!response.ok) {
      const record = {
        system,
        code: String(code),
        display: "",
        parents: [],
        inactive: false,
        error: `Ontoserver returned ${response.status}`,
      };
      memory.set(key, record);
      return { ...record, fromCache: false, fromBundle: false, source: "live" };
    }
    const parsed = parseLookup(await response.json());
    const record = {
      system,
      code: String(code),
      ...parsed,
      error: null,
    };
    memory.set(key, record);
    return { ...record, fromCache: false, fromBundle: false, source: "live" };
  } catch (err) {
    const record = {
      system,
      code: String(code),
      display: "",
      parents: [],
      inactive: false,
      error: err instanceof Error ? err.message : "Lookup failed",
    };
    memory.set(key, record);
    return { ...record, fromCache: false, fromBundle: false, source: "live" };
  }
}

export async function expandSnomedParents(code, { signal } = {}) {
  if (String(code).includes(":")) {
    return lookupTerminology(SNOMED_SYSTEM, code, { signal });
  }
  return lookupConcept(code, { signal });
}

export { directChildren, SNOMED_SYSTEM, ONTOSERVER };
