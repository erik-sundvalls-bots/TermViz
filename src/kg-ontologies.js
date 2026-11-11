import { SNOMED_ROOT, SNOMED_SYSTEM } from "./snomed.js";

export const ONTOLOGY_ORDER = ["sct", "icd10", "atc", "npu"];

export const ONTOLOGIES = {
  sct: {
    id: "sct",
    label: "SNOMED CT",
    system: SNOMED_SYSTEM,
    root: SNOMED_ROOT,
    color: "#1d4e89",
    hatch: { angle: 0, dash: null },
    browser: (code) => `https://browser.ihtsdotools.org/?perspective=full&conceptId1=${code}&edition=MAIN`,
  },
  icd10: {
    id: "icd10",
    label: "WHO ICD-10",
    system: "http://hl7.org/fhir/sid/icd-10",
    root: "WHO-ICD-10",
    color: "#0f6e6b",
    hatch: { angle: 60, dash: "2.2 1.4" },
    browser: (code) => `https://icd.who.int/browse10/2019/en#/${encodeURIComponent(code)}`,
  },
  atc: {
    id: "atc",
    label: "ATC",
    system: "http://www.whocc.no/atc",
    root: null,
    color: "#c46b1a",
    hatch: { angle: -30, dash: "1.6 2" },
    browser: (code) => `https://fass.se/health/atc/${encodeURIComponent(code)}`,
  },
  npu: {
    id: "npu",
    label: "NPU",
    system: "http://npu-terminology.org",
    root: "NPU",
    color: "#6b3a6b",
    hatch: { angle: 90, dash: "1.2 1.6" },
    browser: () => "https://npu-terminology.org/",
  },
};

export function ontologyForSystem(system) {
  const match = Object.values(ONTOLOGIES).find((row) => row.system === system);
  return match?.id || null;
}

export function classifyCode(code, system) {
  if (system) return ontologyForSystem(system) || "sct";
  const text = String(code);
  if (/^\d+$/.test(text)) return "sct";
  if (/^NPU/i.test(text)) return "npu";
  return "sct";
}

export function conceptBrowserUrl(node) {
  const ontology = ONTOLOGIES[node.ontology] || ONTOLOGIES.sct;
  return ontology.browser(node.id);
}

/** ATC has three anatomical main-group roots in the IPS demo (A, C, J). */
export function ontologyDisplayRoots(ontologyId) {
  if (ontologyId === "atc") return ["A", "C", "J"];
  const meta = ONTOLOGIES[ontologyId];
  return meta?.root ? [meta.root] : [];
}
