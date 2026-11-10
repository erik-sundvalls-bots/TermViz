import { readFileSync, writeFileSync } from "node:fs";

const path = "public/data/kg-examples/international-patient-summary/ips-kg-example.json";
const data = JSON.parse(readFileSync(path, "utf8"));

function replaceId(s) {
  return s.replace(/concept:icd10:S52\.1/g, "concept:icd10:S52.5");
}

const s525Node = {
  id: "concept:icd10:S52.5",
  type: "concept",
  ontology: "icd10",
  system: "http://hl7.org/fhir/sid/icd-10",
  version: "2019-covid-expanded",
  code: "S52.5",
  display: "Fracture of lower end of radius",
  is_group: false,
  parents: ["S52"],
  notes:
    "WHO ICD-10 on the Ontoserver (ICD-10-SE not available). Paired at instance level with Eva's post-coordinated SNOMED radius fracture expression.",
  verification: "verified-by-FHIR",
};

const z880 = {
  id: "concept:icd10:Z88.0",
  type: "concept",
  ontology: "icd10",
  system: "http://hl7.org/fhir/sid/icd-10",
  version: "2019-covid-expanded",
  code: "Z88.0",
  display: "Personal history of allergy to penicillin",
  is_group: false,
  parents: ["Z88"],
  notes: "WHO ICD-10; instance-level pairing alongside SNOMED for Eva's penicillin allergy (template has no ICD value set on adverse_reaction_risk).",
  verification: "verified-by-FHIR",
};

const z910 = {
  id: "concept:icd10:Z91.0",
  type: "concept",
  ontology: "icd10",
  system: "http://hl7.org/fhir/sid/icd-10",
  version: "2019-covid-expanded",
  code: "Z91.0",
  display: "Personal history of allergy, other than to drugs and biological substances",
  is_group: false,
  parents: ["Z91"],
  notes: "WHO ICD-10; instance-level pairing alongside SNOMED for Lars's peanut allergy.",
  verification: "verified-by-FHIR",
};

const idx525 = data.nodes.findIndex((n) => n.id === "concept:icd10:S52.1");
if (idx525 >= 0) data.nodes[idx525] = s525Node;
else data.nodes.push(s525Node);

for (const id of ["concept:icd10:Z88.0", "concept:icd10:Z91.0"]) {
  if (!data.nodes.some((n) => n.id === id)) {
    data.nodes.push(id === "concept:icd10:Z88.0" ? z880 : z910);
  }
}

data.edges = data.edges
  .filter((e) => !(e.from === "concept:icd10:S52.1" && e.to === "concept:icd10:S52" && e.type === "is_a"))
  .map((e) => ({
    ...e,
    from: replaceId(e.from),
    to: replaceId(e.to),
  }));

if (!data.edges.some((e) => e.from === "concept:icd10:S52.5" && e.to === "concept:icd10:S52")) {
  data.edges.push({
    from: "concept:icd10:S52.5",
    to: "concept:icd10:S52",
    type: "is_a",
    verification: "verified-by-FHIR",
  });
}

const newCoded = [
  { from: "inst:eva-allergy-penicillin", to: "concept:icd10:Z88.0" },
  { from: "inst:lars-allergy-peanut", to: "concept:icd10:Z91.0" },
];
for (const edge of newCoded) {
  if (!data.edges.some((e) => e.from === edge.from && e.to === edge.to && e.type === "coded_as")) {
    data.edges.push({ ...edge, type: "coded_as", verification: "verified-by-FHIR" });
  }
}

const icdNote =
  "The IPS template does not fix ICD value sets (problem_diagnosis at0002 is DV_TEXT). Fictitious instances therefore pair SNOMED CT with WHO ICD-10 codes verified on the Nordic Ontoserver (http://hl7.org/fhir/sid/icd-10, 2019-covid-expanded); ICD-10-SE is not on the server. Eva: S52.5, I10, Z88.0; Lars: E11.9, I10 (shared), Z91.0.";
if (!data.problems.some((p) => p.includes("DV_TEXT"))) data.problems.splice(8, 0, icdNote);

data.counts.nodes = data.nodes.length;
data.counts.edges = data.edges.length;
data.counts.by_node_type.concept = data.nodes.filter((n) => n.type === "concept").length;
data.counts.by_edge_type.coded_as = data.edges.filter((e) => e.type === "coded_as").length;
data.counts.by_edge_type.is_a = data.edges.filter((e) => e.type === "is_a").length;
data.counts.by_verification["verified-by-FHIR"] = [
  ...data.nodes,
  ...data.edges,
].filter((x) => x.verification === "verified-by-FHIR").length;

data.generated_at = "2026-11-10T19:05:00+01:00";

writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
console.log("nodes", data.counts.nodes, "edges", data.counts.edges, "coded_as", data.counts.by_edge_type.coded_as);
