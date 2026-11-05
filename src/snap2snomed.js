/**
 * Snap2SNOMED map import/export rows.
 * https://docs.snomed.org/snomed-ct-user-guides/snap2snomed-user-guide/how-to-.../2.3-import-an-existing-map-file
 *
 * source_code, source_display, target_code, target_display, relationship_type
 * relationship_type is one of TARGET_EQUIVALENT, TARGET_BROADER, TARGET_NARROWER, TARGET_INEXACT.
 */

export const RELATIONSHIPS = {
  TARGET_EQUIVALENT: {
    kind: "equivalent",
    title: "TARGET_EQUIVALENT",
    hint: "Target is equivalent to source",
  },
  TARGET_BROADER: {
    kind: "broader",
    title: "TARGET_BROADER",
    hint: "Target is broader than source",
  },
  TARGET_NARROWER: {
    kind: "narrower",
    title: "TARGET_NARROWER",
    hint: "Target is narrower than source",
  },
  TARGET_INEXACT: {
    kind: "inexact",
    title: "TARGET_INEXACT",
    hint: "Target is inexact to source",
  },
};

export function relationshipText(type) {
  const known = RELATIONSHIPS[type];
  if (!known) return type || "Relationship";
  return `${known.title} — ${known.hint}`;
}

function splitCsv(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === "\"" && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else if (char === "\"") quoted = false;
      else current += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") {
      out.push(current);
      current = "";
    } else current += char;
  }
  out.push(current);
  return out;
}

export function parseSnapMap(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const header = splitCsv(lines[0]).map((cell) => cell.trim());
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line);
    const relationship = (cells[index.relationship_type] || "").trim();
    const code = (cells[index.target_code] || "").trim();
    const sourceCode = (cells[index.source_code] || "").trim();
    if (!sourceCode || !code || !relationship) continue;
    rows.push({
      sourceCode,
      sourceDisplay: (cells[index.source_display] || "").trim(),
      code,
      display: (cells[index.target_display] || "").trim(),
      relationship,
    });
  }
  return rows;
}

function parseSourcePath(source) {
  const parts = String(source).split("/").filter(Boolean);
  const steps = [];
  for (const part of parts.slice(1)) {
    const match = part.match(/\[(at\d+)\]/i);
    if (match) steps.push(match[1]);
  }
  return { archetypeId: parts[0] || "", steps };
}

function sameArchetype(left, right) {
  return String(left || "").trim() === String(right || "").trim();
}

function pathMatches(node, ancestors, sourceCode) {
  const spec = parseSourcePath(sourceCode);
  if (!spec.archetypeId || !spec.steps.length) return false;
  if (!sameArchetype(node.archetypeId, spec.archetypeId)) return false;
  const chain = [];
  for (const item of ancestors) {
    if (sameArchetype(item.archetypeId, spec.archetypeId) && item.nodeId) chain.push(item.nodeId);
  }
  if (node.nodeId) chain.push(node.nodeId);
  let matchedNode = false;
  let index = 0;
  for (const code of spec.steps) {
    const at = chain.indexOf(code, index);
    if (at >= 0) {
      matchedNode = at === chain.length - 1;
      index = at + 1;
      continue;
    }
    if (matchedNode && (node.valueCodes || []).includes(code)) continue;
    return false;
  }
  return matchedNode;
}

export function attachSnapMap(root, rows) {
  const flat = [];
  (function walk(node, ancestors, section) {
    if (!node) return;
    const here = node.rmType === "SECTION" ? node.name : section;
    node.section = here;
    flat.push({ node, ancestors });
    for (const child of node.children || []) walk(child, ancestors.concat(node), here);
  })(root, [], null);

  const groups = new Map();
  for (const row of rows || []) {
    const list = groups.get(row.sourceCode) || [];
    list.push(row);
    groups.set(row.sourceCode, list);
  }

  const attached = [];
  const missing = [];
  for (const [sourceCode, list] of groups) {
    const hits = flat.filter(({ node, ancestors }) => pathMatches(node, ancestors, sourceCode));
    const display = list[0]?.sourceDisplay;
    const named = display ? hits.filter(({ node }) => node.name === display) : [];
    const chosen = named.length ? named : hits;
    if (!chosen.length) {
      missing.push(sourceCode);
      continue;
    }
    const suggestions = list.map((row) => ({
      code: row.code,
      display: row.display,
      relationship: row.relationship,
      reason: relationshipText(row.relationship),
      sourceCode: row.sourceCode,
      sourceDisplay: row.sourceDisplay,
    }));
    for (const { node } of chosen) {
      node.suggestions = (node.suggestions || []).concat(suggestions.map((item) => ({ ...item })));
      node.suggestionSetId = node.suggestionSetId || sourceCode;
      if (!attached.includes(node)) attached.push(node);
    }
  }
  return { attached, missing };
}
