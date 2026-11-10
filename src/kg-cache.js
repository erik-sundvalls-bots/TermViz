import { publicUrl } from "./ips-model.js";
import { seedTerminologyCache } from "./kg-terminology.js";

let loadedExampleId = null;

export async function loadExampleTerminologyCache(example) {
  if (!example?.id) return null;
  const base = String(example.path).replace(/\/[^/]+$/, "");
  const url = publicUrl(`data/kg-examples/${base}/terminology-cache.json`);
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const body = await response.json();
    seedTerminologyCache(body);
    loadedExampleId = example.id;
    return body;
  } catch {
    return null;
  }
}

export function exampleCacheLoaded(id) {
  return loadedExampleId === id;
}
