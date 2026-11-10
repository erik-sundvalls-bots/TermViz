/**
 * FHIR CodeSystem $lookup for knowledge-graph concept nodes (SNOMED, NPU, ICD-10, …).
 */
import { ONTOSERVER, parseLookup, directChildren, lookupConcept, SNOMED_SYSTEM } from "./snomed.js";

const memory = new Map();
const inflight = new Map();

function cacheKey(system, code) {
  return `${system}\0${code}`;
}

export async function lookupTerminology(system, code, { displayLanguage, signal } = {}) {
  const key = cacheKey(system, code);
  if (memory.has(key)) return { ...memory.get(key), fromCache: true };
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
      return { ...record, fromCache: false };
    }
    const parsed = parseLookup(await response.json());
    const record = {
      system,
      code: String(code),
      ...parsed,
      error: null,
    };
    memory.set(key, record);
    return { ...record, fromCache: false };
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
    return { ...record, fromCache: false };
  }
}

export async function expandSnomedParents(code, { signal } = {}) {
  if (String(code).includes(":")) {
    return lookupTerminology(SNOMED_SYSTEM, code, { signal });
  }
  return lookupConcept(code, { signal });
}

export { directChildren, SNOMED_SYSTEM, ONTOSERVER };
