/**
 * A deliberately imperfect SNOMED CT mapper.
 * Five ranked guesses for three IPS nodes that hold a clinical name at runtime
 * and are not themselves bound to a single SNOMED concept.
 * Codes were checked against the HL7 Nordic Ontoserver (International Edition).
 */

export const SUGGESTION_TARGETS = [
  {
    id: "problem-diagnosis-name",
    section: "Problem List",
    nodeId: "at0002",
    name: "Problem/Diagnosis name",
    archetypeIncludes: "problem_diagnosis",
    suggestions: [
      {
        rank: 1,
        code: "439401001",
        score: 0.81,
        reason:
          "The label says diagnosis, and this concept is Diagnosis. It codes the condition itself, not the element that records a name.",
      },
      {
        rank: 2,
        code: "404684003",
        score: 0.62,
        reason:
          "Clinical finding is the neighbourhood of “problem”. It is also the parent of almost every finding, so it does not identify this element.",
      },
      {
        rank: 3,
        code: "64572001",
        score: 0.55,
        reason:
          "Disease is too narrow. A problem list also holds symptoms, social problems and diagnoses that are not yet established.",
      },
      {
        rank: 4,
        code: "282291009",
        score: 0.41,
        reason:
          "“Diagnosis interpretation” matched the word diagnosis, then landed in observable entity instead of clinical finding.",
      },
      {
        rank: 5,
        code: "418799008",
        score: 0.27,
        reason:
          "Finding reported by subject or history provider confuses a problem-list entry with something the patient reported.",
      },
    ],
  },
  {
    id: "procedure-name",
    section: "History of Procedures",
    nodeId: "at0002",
    name: "Procedure name",
    archetypeIncludes: "ACTION.procedure",
    suggestions: [
      {
        rank: 1,
        code: "71388002",
        score: 0.84,
        reason:
          "Procedure is the obvious lexical hit. It is the root of the procedure hierarchy, so it is right only as a broad type.",
      },
      {
        rank: 2,
        code: "129125009",
        score: 0.48,
        reason:
          "Procedure with explicit context is what a history list often records. The mapper promoted it because the section is a history, not because the element says so.",
      },
      {
        rank: 3,
        code: "387713003",
        score: 0.44,
        reason:
          "Surgical procedure is a common guess and too narrow. This element also holds endoscopies, biopsies and other non-surgical procedures.",
      },
      {
        rank: 4,
        code: "363679005",
        score: 0.33,
        reason:
          "Imaging was pulled in by a weak association with “examination”. Most procedure-history entries are not imaging.",
      },
      {
        rank: 5,
        code: "14734007",
        score: 0.22,
        reason:
          "Administrative procedure matched “history of procedures” as if the procedure were paperwork. It is the wrong branch.",
      },
    ],
  },
  {
    id: "medication-item",
    section: "Medication Summary",
    nodeId: "at0020",
    name: "Medication item",
    archetypeIncludes: "medication",
    suggestions: [
      {
        rank: 1,
        code: "763158003",
        score: 0.77,
        reason:
          "Medicinal product is a solid candidate for a medication line. The mapper still cannot tell product from pack or from dose form.",
      },
      {
        rank: 2,
        code: "410942007",
        score: 0.7,
        reason:
          "Drug or medicament is the broader clinical phrase. Useful, and easy to confuse with the product concepts underneath it.",
      },
      {
        rank: 3,
        code: "373873005",
        score: 0.58,
        reason:
          "Pharmaceutical / biologic product is wider still, and it mixes medicinal products with other biologic products.",
      },
      {
        rank: 4,
        code: "781405001",
        score: 0.36,
        reason:
          "Medicinal product package is one step too specific. A medication statement is not always a particular pack.",
      },
      {
        rank: 5,
        code: "105590001",
        score: 0.24,
        reason:
          "Substance is the usual mix-up between a chemical substance and a medicinal product. Related, and the wrong axis for this element.",
      },
    ],
  },
];

export function attachSuggestions(root) {
  const pending = new Map(SUGGESTION_TARGETS.map((target) => [target.id, target]));
  const attached = [];

  function visit(node, section) {
    const here = node.rmType === "SECTION" ? node.name : section;
    node.section = here;
    if (pending.size) {
      for (const target of pending.values()) {
        const archetype = node.archetypeId || "";
        if (
          node.nodeId === target.nodeId &&
          node.name === target.name &&
          here === target.section &&
          archetype.includes(target.archetypeIncludes)
        ) {
          node.suggestions = target.suggestions.map((item) => ({ ...item }));
          node.suggestionSetId = target.id;
          attached.push(node);
          pending.delete(target.id);
          break;
        }
      }
    }
    for (const child of node.children) visit(child, here);
  }

  visit(root, null);
  return {
    attached,
    missing: [...pending.values()].map((target) => target.id),
  };
}
