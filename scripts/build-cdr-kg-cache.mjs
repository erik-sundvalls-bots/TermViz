import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = execSync(
  "git show origin/cursor/ips-kg-layered-graph-122b:public/data/kg-examples/international-patient-summary/terminology-cache.json",
  { cwd: root, encoding: "utf8" },
);
const body = JSON.parse(raw);
const concepts = [...body.concepts];

const byKey = new Map(concepts.map((row) => [`${row.system}\0${row.code}`, row]));

function setParents(system, code, parents) {
  const row = byKey.get(`${system}\0${code}`);
  if (row) row.parents = parents;
}

/** WHO ICD-10 chapter → block → code (IPS demo subset). */
const icd = "http://hl7.org/fhir/sid/icd-10";
concepts.push(
  {
    system: icd,
    code: "WHO-ICD-10",
    ontology: "icd10",
    display: "WHO ICD-10",
    display_en: "International Classification of Diseases, 10th Revision",
    parents: [],
    inactive: false,
  },
  {
    system: icd,
    code: "CH04",
    ontology: "icd10",
    display: "Chapter IV — Endocrine, nutritional and metabolic diseases (E00–E90)",
    display_en: "Chapter IV — Endocrine, nutritional and metabolic diseases (E00–E90)",
    parents: ["WHO-ICD-10"],
    inactive: false,
  },
  {
    system: icd,
    code: "CH09",
    ontology: "icd10",
    display: "Chapter IX — Diseases of the circulatory system (I00–I99)",
    display_en: "Chapter IX — Diseases of the circulatory system (I00–I99)",
    parents: ["WHO-ICD-10"],
    inactive: false,
  },
  {
    system: icd,
    code: "CH19",
    ontology: "icd10",
    display: "Chapter XIX — Injury, poisoning and certain other consequences (S00–T98)",
    display_en: "Chapter XIX — Injury, poisoning and certain other consequences (S00–T98)",
    parents: ["WHO-ICD-10"],
    inactive: false,
  },
);

setParents(icd, "E10-E14", ["CH04"]);
setParents(icd, "E11", ["E10-E14"]);
setParents(icd, "E11.9", ["E11"]);
setParents(icd, "I10-I15", ["CH09"]);
setParents(icd, "I10", ["I10-I15"]);
setParents(icd, "S50-S59", ["CH19"]);
setParents(icd, "S52", ["S50-S59"]);

/** ATC anatomical group → substance (Swedish FASS names). */
const atc = "http://www.whocc.no/atc";
setParents(atc, "A10", ["A"]);
setParents(atc, "A10B", ["A10"]);
setParents(atc, "A10BA", ["A10B"]);
setParents(atc, "A10BA02", ["A10BA"]);
setParents(atc, "C07", ["C"]);
setParents(atc, "C07A", ["C07"]);
setParents(atc, "C07AB", ["C07A"]);
setParents(atc, "C07AB03", ["C07AB"]);
setParents(atc, "J07", ["J"]);
setParents(atc, "J07BB", ["J07"]);

/** NPU flat catalog with a single visible root for the pane. */
const npu = "http://npu-terminology.org";
concepts.push({
  system: npu,
  code: "NPU",
  ontology: "npu",
  display: "NPU — Nomenclature for Properties and Units",
  display_en: "NPU — Nomenclature for Properties and Units",
  parents: [],
  inactive: false,
});
setParents(npu, "NPU02319", ["NPU"]);
setParents(npu, "NPU27300", ["NPU"]);

const out = {
  schema: "cdr-kg-terminology/v1",
  example_id: "international-patient-summary",
  generated_at: new Date().toISOString(),
  concepts,
};

const dest = path.join(root, "public/data/cdr-kg/terminology-cache.json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${concepts.length} concepts to ${dest}`);
