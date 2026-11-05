/**
 * Load the International Patient Summary operational template with ehrtslib,
 * then compare SNOMED CT term bindings with the CKM archetype fileset.
 *
 * ehrtslib 0.11 parseOptXml builds the constraint tree and the per-archetype
 * term texts, and it assigns ontology.term_bindings to {}. The bindings that
 * Ocean wrote into the OPT XML are therefore read from that XML and matched
 * to nodes by archetype id + at-code. Archetype terminology is read with
 * parseAdl. Where a definition section uses cADL that ehrtslib 0.11 rejects,
 * the terminology section is parsed on its own, behind a stub definition,
 * so the term bindings are still taken from the library.
 */

import { attachSnapMap, parseSnapMap } from "./snap2snomed.js";

const CLINICAL_RM = new Set([
  "COMPOSITION",
  "SECTION",
  "OBSERVATION",
  "EVALUATION",
  "INSTRUCTION",
  "ACTION",
  "ADMIN_ENTRY",
  "CLUSTER",
  "ELEMENT",
  "ITEM_TREE",
  "ITEM_LIST",
  "ITEM_TABLE",
  "HISTORY",
  "EVENT",
  "POINT_EVENT",
  "INTERVAL_EVENT",
  "ISM_TRANSITION",
  "ACTIVITY",
  "FOLDER",
]);

export function normArchetypeId(id) {
  if (!id) return "";
  return String(id).trim().replace(/\.v(\d+)(?:\.\d+)*$/, ".v$1");
}

function asStrings(list) {
  if (list == null) return [];
  const values = Array.isArray(list) ? list : [list];
  const out = [];
  for (const value of values) {
    if (typeof value === "string" && value.trim()) out.push(value.trim());
    else if (value && typeof value.value === "string" && value.value.trim()) {
      out.push(value.value.trim());
    }
  }
  return out;
}

function collectStringLists(node, out) {
  if (!node || typeof node !== "object") return;
  for (const value of asStrings(node.list)) out.push(value);
  if (node.item) {
    for (const value of asStrings(node.item.list)) out.push(value);
  }
  for (const attribute of node.attributes || []) {
    for (const child of attribute.children || []) collectStringLists(child, out);
  }
}

function fixedName(obj) {
  const nameAttribute = (obj.attributes || []).find(
    (attribute) => attribute.rm_attribute_name === "name",
  );
  if (!nameAttribute) return null;
  const lists = [];
  for (const child of nameAttribute.children || []) collectStringLists(child, lists);
  return lists.length === 1 ? lists[0] : null;
}

function termText(termDefs, scope, nodeId) {
  if (!scope || !nodeId || !termDefs) return null;
  const table = termDefs[scope] || termDefs[normArchetypeId(scope)];
  if (!table) return null;
  const language = table.en || table.EN || Object.values(table)[0];
  const entry = language?.[nodeId];
  return entry?.text || null;
}

function parseBindingTarget(raw) {
  let text = String(raw ?? "").trim();
  if (text.startsWith("<") && text.endsWith(">")) text = text.slice(1, -1).trim();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1).trim();
  const phrase = text.match(/^([^:\]]+?)::(.+)$/);
  if (phrase) {
    const versioned = phrase[1].match(/^(.*?)\(([^)]+)\)$/);
    return {
      terminology: versioned ? versioned[1] : phrase[1],
      release: versioned ? versioned[2] : null,
      code: phrase[2].trim(),
    };
  }
  const iri = text.match(/\/id\/(\d+)\s*$/);
  if (iri) return { terminology: "SNOMED-CT", release: null, code: iri[1] };
  if (/^\d+$/.test(text)) return { terminology: "SNOMED-CT", release: null, code: text };
  return null;
}

function isSnomed(name) {
  return /snomed/i.test(name || "");
}

/**
 * SNOMED CT term bindings embedded in an ADL 1.4 OPT, keyed by normalised
 * archetype id then at-code. A stack keeps each binding with the archetype
 * root that contains it, including roots nested inside other roots.
 */
export function extractOptSnomedBindings(xml) {
  const out = {};
  const stack = [{ name: "#root", arch: null, ownArch: null }];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = re.exec(xml))) {
    if (match[4] != null) {
      const frame = stack[stack.length - 1];
      if (frame) frame.text = (frame.text || "") + match[4];
      continue;
    }
    const closing = match[1] === "/";
    const name = match[2].includes(":") ? match[2].split(":").pop() : match[2];
    const rest = match[3] || "";
    const selfClosing = /\/\s*$/.test(rest);
    if (!closing) {
      const parent = stack[stack.length - 1];
      const frame = {
        name,
        arch: parent.ownArch || parent.arch || null,
        ownArch: null,
        text: "",
        code: /(?:^|\s)code="([^"]+)"/.exec(rest)?.[1] || null,
        terminology: /terminology="([^"]+)"/.exec(rest)?.[1] || null,
      };
      if (!selfClosing) stack.push(frame);
      continue;
    }
    const frame = stack.pop();
    const parent = stack[stack.length - 1];
    if (!frame || !parent) continue;
    if (frame.name === "value" && parent.name === "archetype_id") {
      const owner = stack[stack.length - 2];
      if (owner && frame.text.trim()) owner.ownArch = frame.text.trim();
    }
    if (frame.name === "code_string") {
      const items = [...stack].reverse().find((entry) => entry.name === "items" && entry.code);
      const binding = [...stack].reverse().find((entry) => entry.name === "term_bindings");
      const code = frame.text.trim();
      if (items && binding && isSnomed(binding.terminology) && code && !isSnomed(code)) {
        const archetypeId = normArchetypeId(binding.arch);
        if (!archetypeId) continue;
        const bag = out[archetypeId] || (out[archetypeId] = {});
        bag[items.code] = {
          code,
          terminology: binding.terminology,
          release: null,
        };
      }
    }
  }
  return out;
}

function archetypeIdFromHeader(text) {
  const match = text.match(/archetype\s*\([^)]*\)\s*[\r\n]+\s*(openEHR-\S+)/);
  return match ? match[1].trim() : null;
}

function extractAdlSection(text, section) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^${section}\\b`).test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (
      /^(language|description|definition|ontology|terminology|rules|annotations|rm_overlay|revision_history)\b/.test(
        lines[i],
      )
    ) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function rmFromArchetypeId(id) {
  if (id.includes("-OBSERVATION.")) return "OBSERVATION";
  if (id.includes("-EVALUATION.")) return "EVALUATION";
  if (id.includes("-ACTION.")) return "ACTION";
  if (id.includes("-INSTRUCTION.")) return "INSTRUCTION";
  if (id.includes("-SECTION.")) return "SECTION";
  if (id.includes("-COMPOSITION.")) return "COMPOSITION";
  return "CLUSTER";
}

function snomedBindingsFromArchetype(archetype) {
  const bag = {};
  const bindings = archetype?.ontology?.term_bindings;
  if (!bindings || typeof bindings !== "object") return bag;
  for (const [terminology, entries] of Object.entries(bindings)) {
    if (!isSnomed(terminology) || !entries || typeof entries !== "object") continue;
    for (const [atCode, raw] of Object.entries(entries)) {
      const parsed = parseBindingTarget(raw);
      if (!parsed || !isSnomed(parsed.terminology) && !isSnomed(terminology)) continue;
      if (!parsed.code) continue;
      bag[atCode] = {
        code: parsed.code,
        terminology: parsed.terminology || terminology,
        release: parsed.release,
      };
    }
  }
  return bag;
}

function prepareAdl(text) {
  return text.replace(/^\uFEFF/, "").replace(/;\s*uid=[0-9a-fA-F-]+/g, "");
}

export function readArchetypeSnomedBindings(adlEntries, parseAdl) {
  const bindings = {};
  const reports = [];
  for (const entry of adlEntries) {
    const text = prepareAdl(entry.text);
    const headerId = archetypeIdFromHeader(text);
    let parsed = null;
    let how = "direct";
    try {
      parsed = parseAdl(text);
    } catch (directError) {
      const onto = extractAdlSection(text, "ontology") || extractAdlSection(text, "terminology");
      if (!headerId || !onto) {
        reports.push({
          path: entry.path,
          how: "failed",
          error: directError instanceof Error ? directError.message : String(directError),
        });
        continue;
      }
      const rm = rmFromArchetypeId(headerId);
      const stub = `archetype (adl_version=1.4)\n\t${headerId}\n\ndefinition\n\t${rm}[at0000] matches {*}\n\n${onto}\n`;
      try {
        parsed = parseAdl(stub);
        how = "terminology-stub";
      } catch (stubError) {
        reports.push({
          path: entry.path,
          how: "failed",
          error: stubError instanceof Error ? stubError.message : String(stubError),
        });
        continue;
      }
    }
    const id = normArchetypeId(parsed.archetype?.archetype_id?.value || headerId);
    const snomed = snomedBindingsFromArchetype(parsed.archetype);
    if (Object.keys(snomed).length) bindings[id] = snomed;
    reports.push({ path: entry.path, how, id, snomedCount: Object.keys(snomed).length });
  }
  return { bindings, reports };
}

export function compareBindings(optBindings, archetypeBindings) {
  const rows = [];
  const archetypeIds = new Set([
    ...Object.keys(optBindings),
    ...Object.keys(archetypeBindings),
  ]);
  for (const archetypeId of archetypeIds) {
    const optBag = optBindings[archetypeId] || {};
    const archBag = archetypeBindings[archetypeId] || {};
    const codes = new Set([...Object.keys(optBag), ...Object.keys(archBag)]);
    for (const atCode of codes) {
      const opt = optBag[atCode] || null;
      const arch = archBag[atCode] || null;
      let status = "opt-only";
      if (opt && arch && opt.code === arch.code) status = "both";
      else if (!opt && arch) status = "missing-from-opt";
      else if (opt && arch && opt.code !== arch.code) status = "conflict";
      rows.push({ archetypeId, atCode, opt, arch, status });
    }
  }
  return {
    rows,
    both: rows.filter((row) => row.status === "both").length,
    missingFromOpt: rows.filter((row) => row.status === "missing-from-opt").length,
    optOnly: rows.filter((row) => row.status === "opt-only").length,
    conflicts: rows.filter((row) => row.status === "conflict").length,
  };
}

function bindingListFor(archetypeId, nodeId, comparison) {
  if (!archetypeId || !nodeId) return [];
  const key = normArchetypeId(archetypeId);
  return comparison.rows
    .filter((row) => row.archetypeId === key && row.atCode === nodeId)
    .map((row) => ({
      code: (row.arch || row.opt).code,
      terminology: (row.arch || row.opt).terminology || "SNOMED-CT",
      release: row.arch?.release || row.opt?.release || null,
      status: row.status,
      optCode: row.opt?.code || null,
      archetypeCode: row.arch?.code || null,
    }));
}

function buildClinicalTree(definition, termDefs) {
  let serial = 0;
  function walk(obj, ctx) {
    if (!obj || typeof obj !== "object") return [];
    const nodeId = obj.node_id || "";
    const rmType = obj.rm_type_name || "";
    const archetypeRef = obj.archetype_ref || null;
    const scope = archetypeRef || obj.term_archetype_scope || ctx.scope;
    const archetypeId = archetypeRef || ctx.archetypeId || null;
    const rename = fixedName(obj);
    const text = termText(termDefs, scope, nodeId) || termText(termDefs, archetypeId, nodeId);
    const clinical = CLINICAL_RM.has(rmType);
    const id = clinical
      ? `${ctx.path}/${rmType}:${nodeId || "anon"}:${serial++}`
      : null;
    const next = {
      scope: scope || ctx.scope,
      archetypeId: archetypeId || ctx.archetypeId,
      path: id || ctx.path,
    };
    const children = [];
    for (const attribute of obj.attributes || []) {
      for (const child of attribute.children || []) {
        children.push(...walk(child, next));
      }
    }
    if (!clinical) return children;
    return [{
      id,
      name: rename || text || rmType,
      rmType,
      nodeId: nodeId || null,
      archetypeId: next.archetypeId,
      isArchetypeRoot: Boolean(archetypeRef),
      path: id,
      renamedByTemplate: Boolean(rename),
      children,
      valueCodes: [...new Set(codesUnder(obj, []))],
      bindings: [],
      valueBindings: [],
      scopeBindings: [],
      suggestions: null,
    }];
  }
  const roots = walk(definition, { scope: null, archetypeId: null, path: "" });
  return roots[0] || null;
}

function codesUnder(obj, out = []) {
  const raw = obj?.code_list;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const value of values) {
    if (typeof value === "string" && /^at\d+/i.test(value)) out.push(value);
  }
  for (const attribute of obj?.attributes || []) {
    for (const child of attribute.children || []) {
      if (CLINICAL_RM.has(child.rm_type_name)) continue;
      codesUnder(child, out);
    }
  }
  return out;
}

function attachBindingLists(node, comparison, termDefs) {
  node.bindings = bindingListFor(node.archetypeId, node.nodeId, comparison);
  const valueCodes = [];
  // Value-set members live on CODE_PHRASE nodes under this element, not as
  // their own clinical nodes. Surface those SNOMED bindings here.
  // The constraint object is not retained on the display node, so value
  // bindings are filled by the walker below via node.valueCodes.
  for (const atCode of node.valueCodes || []) {
    for (const binding of bindingListFor(node.archetypeId, atCode, comparison)) {
      valueCodes.push({
        ...binding,
        atCode,
        label: termText(termDefs, node.archetypeId, atCode) || atCode,
      });
    }
  }
  node.valueBindings = valueCodes;
  if (node.isArchetypeRoot) {
    const key = normArchetypeId(node.archetypeId);
    node.scopeBindings = comparison.rows
      .filter((row) => row.archetypeId === key)
      .map((row) => ({
        atCode: row.atCode,
        code: (row.arch || row.opt).code,
        terminology: (row.arch || row.opt).terminology || "SNOMED-CT",
        release: row.arch?.release || null,
        status: row.status,
        label: termText(termDefs, node.archetypeId, row.atCode) || row.atCode,
      }));
  }
  for (const child of node.children) attachBindingLists(child, comparison, termDefs);
}

export function buildIpsModel({ optXml, adlEntries, parseOptXml, parseAdl, mapRows = [] }) {
  const { operationalTemplate, warnings } = parseOptXml(optXml);
  const termDefs = operationalTemplate.archetype_term_definitions || {};
  const tree = buildClinicalTree(operationalTemplate.definition, termDefs);
  if (!tree) throw new Error("ehrtslib parsed the OPT, but the definition tree was empty.");
  const optBindings = extractOptSnomedBindings(optXml);
  const archetypes = readArchetypeSnomedBindings(adlEntries, parseAdl);
  const comparison = compareBindings(optBindings, archetypes.bindings);
  attachBindingLists(tree, comparison, termDefs);
  const suggestions = attachSnapMap(tree, mapRows);
  const counts = { nodes: 0, boundNodes: 0, enrichedNodes: 0 };
  (function tally(node) {
    counts.nodes += 1;
    if (node.bindings.length || node.valueBindings.length) counts.boundNodes += 1;
    if (node.bindings.some((binding) => binding.status === "missing-from-opt")) {
      counts.enrichedNodes += 1;
    }
    node.children.forEach(tally);
  })(tree);
  return {
    templateId: templateIdentity(operationalTemplate, "International Patient Summary"),
    language: operationalTemplate.original_language || "en",
    warnings: warnings || [],
    tree,
    comparison,
    archetypeReports: archetypes.reports,
    suggestions,
    counts,
    optBindingArchetypes: Object.keys(optBindings).length,
    archetypeBindingArchetypes: Object.keys(archetypes.bindings).length,
  };
}

function templateIdentity(opt, fallback) {
  const raw = opt?.template_id?.value || opt?.template_id || opt?.archetype_id?.value || fallback || "Template";
  return String(raw);
}

function mergeBindingBags(base, extra) {
  const out = { ...base };
  for (const [archetypeId, bag] of Object.entries(extra || {})) {
    out[archetypeId] = { ...(out[archetypeId] || {}), ...bag };
  }
  return out;
}

function harvestOptBindings(root) {
  const bags = {};
  const seen = new WeakSet();
  function visit(value, archetypeId) {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    const id = normArchetypeId(value.archetype_id?.value || value.archetype_ref || archetypeId || "");
    const bindings = value.term_bindings || value.ontology?.term_bindings;
    if (bindings && id) {
      const snomed = snomedBindingsFromArchetype({ ontology: { term_bindings: bindings } });
      if (Object.keys(snomed).length) bags[id] = { ...(bags[id] || {}), ...snomed };
    }
    const nested = Array.isArray(value) ? value : Object.values(value);
    for (const child of nested) visit(child, id);
  }
  visit(root, "");
  return bags;
}

export function buildTemplateModel({
  operationalTemplate,
  sourceText = "",
  adlEntries = [],
  parseAdl,
  warnings = [],
  sourceName,
  mapRows = [],
}) {
  const termDefs = operationalTemplate.archetype_term_definitions || {};
  const tree = buildClinicalTree(operationalTemplate.definition, termDefs);
  if (!tree) throw new Error("ehrtslib parsed the template, but the definition tree was empty.");
  const fromXml = sourceText.includes("<") ? extractOptSnomedBindings(sourceText) : {};
  const optBindings = mergeBindingBags(fromXml, harvestOptBindings(operationalTemplate));
  const archetypes = adlEntries.length && parseAdl
    ? readArchetypeSnomedBindings(adlEntries, parseAdl)
    : { bindings: {}, reports: [] };
  const comparison = compareBindings(optBindings, archetypes.bindings);
  attachBindingLists(tree, comparison, termDefs);
  const suggestions = attachSnapMap(tree, mapRows);
  const counts = { nodes: 0, boundNodes: 0, enrichedNodes: 0 };
  (function tally(node) {
    counts.nodes += 1;
    if (node.bindings.length || node.valueBindings.length) counts.boundNodes += 1;
    if (node.bindings.some((binding) => binding.status === "missing-from-opt")) counts.enrichedNodes += 1;
    node.children.forEach(tally);
  })(tree);
  return {
    templateId: templateIdentity(operationalTemplate, sourceName),
    language: operationalTemplate.original_language || "en",
    warnings: warnings || [],
    tree,
    comparison,
    archetypeReports: archetypes.reports,
    suggestions,
    counts,
    optBindingArchetypes: Object.keys(optBindings).length,
    archetypeBindingArchetypes: Object.keys(archetypes.bindings).length,
  };
}

let ehrtsPromise;

export function loadEhrts() {
  if (!ehrtsPromise) {
    ehrtsPromise = (async () => {
      const bundle = await fetch(publicUrl("vendor/ehrtslib-0.11.0-parser.min.js"));
      if (!bundle.ok) throw new Error(`Could not load the ehrtslib parser (${bundle.status}).`);
      const source = await bundle.text();
      const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      return import(/* @vite-ignore */ blobUrl);
    })();
  }
  return ehrtsPromise;
}

export async function loadTemplateFromText(text, { name } = {}) {
  const ehr = await loadEhrts();
  const parsed = ehr.parseTemplateInput(text);
  let operationalTemplate = parsed.operationalTemplate;
  let warnings = [...(parsed.warnings || [])];
  if (!operationalTemplate) {
    const workspace = new ehr.TemplateWorkspace();
    workspace.addFile(name || "template", text);
    const resolved = workspace.resolveOperational();
    operationalTemplate = resolved?.operationalTemplate;
    warnings = [...warnings, ...(resolved?.warnings || [])];
  }
  if (!operationalTemplate) {
    throw new Error(warnings.find(Boolean) || "ehrtslib could not read this template. OPT, OET, web template JSON, and ADL are accepted. An ADL template that is not already operational needs its archetype fileset.");
  }
  return buildTemplateModel({
    operationalTemplate,
    sourceText: text,
    parseAdl: ehr.parseAdl,
    warnings,
    sourceName: name,
    mapRows: await loadDemoMap(),
  });
}

export async function loadTemplateFromUrl(url) {
  const target = String(url || "").trim();
  if (!target) throw new Error("Enter a template URL.");
  const ehr = await loadEhrts();
  if (/github\.com|githubusercontent\.com/i.test(target)) {
    const closure = await ehr.loadGitHubTemplateClosure(target);
    const workspace = new ehr.TemplateWorkspace();
    const adlEntries = [];
    for (const entry of closure.entries) {
      workspace.addFile(entry.path, entry.content);
      if (/\.adls?$/i.test(entry.path)) adlEntries.push({ path: entry.path, text: entry.content });
    }
    workspace.setGenerationRootPath(closure.rootPath);
    const resolved = workspace.resolveOperational();
    if (!resolved?.operationalTemplate) {
      throw new Error(closure.warnings?.[0] || "ehrtslib could not build an operational template from that GitHub file.");
    }
    const root = closure.entries.find((entry) => entry.path === closure.rootPath);
    return buildTemplateModel({
      operationalTemplate: resolved.operationalTemplate,
      sourceText: root?.content || "",
      adlEntries,
      parseAdl: ehr.parseAdl,
      warnings: [...(resolved.warnings || []), ...(closure.warnings || [])],
      sourceName: target,
      mapRows: await loadDemoMap(),
    });
  }
  let response;
  try {
    response = await fetch(target);
  } catch {
    throw new Error("The browser could not fetch that URL. Upload the file, or use a host that allows cross-origin requests.");
  }
  if (!response.ok) throw new Error(`Could not fetch the template (${response.status}).`);
  const text = await response.text();
  const name = target.split("/").pop()?.split("?")[0] || target;
  return loadTemplateFromText(text, { name });
}

function publicUrl(path) {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}${String(path).replace(/^\/+/, "")}`;
}

export async function loadIpsModel() {
  const ehr = await loadEhrts();
  const optResponse = await fetch(publicUrl("models/International_Patient_Summary.opt"));
  if (!optResponse.ok) throw new Error(`Could not fetch the OPT (${optResponse.status}).`);
  const optXml = await optResponse.text();
  const manifestResponse = await fetch(publicUrl("models/ips-fileset/adl-manifest.json"));
  if (!manifestResponse.ok) {
    throw new Error(`Could not fetch the archetype manifest (${manifestResponse.status}).`);
  }
  const paths = await manifestResponse.json();
  const adlEntries = await Promise.all(
    paths.map(async (filePath) => {
      const response = await fetch(publicUrl(`models/ips-fileset/${filePath}`));
      if (!response.ok) throw new Error(`Could not fetch ${filePath} (${response.status}).`);
      return { path: filePath, text: await response.text() };
    }),
  );
  return buildIpsModel({
    optXml,
    adlEntries,
    parseOptXml: ehr.parseOptXml,
    parseAdl: ehr.parseAdl,
    mapRows: await loadDemoMap(),
  });
}

let demoMapPromise;

export function loadDemoMap() {
  if (!demoMapPromise) {
    demoMapPromise = (async () => {
      const response = await fetch(publicUrl("maps/ips-snap2snomed.csv"));
      if (!response.ok) throw new Error(`Could not fetch the Snap2SNOMED map (${response.status}).`);
      return parseSnapMap(await response.text());
    })();
  }
  return demoMapPromise;
}
