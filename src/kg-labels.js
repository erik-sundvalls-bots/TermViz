/** Clinical short label for archetype nodes (no version suffix). */
export function archetypeClinicalLabel(node) {
  if (node.concept_text) return node.concept_text;
  const aid = node.archetype_id || node.id?.replace(/^arch:/, "") || "";
  const parts = aid.split(".");
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const penult = parts[parts.length - 2];
    if (/^v\d+$/i.test(last)) return penult.replace(/_/g, " ");
    if (/^v\d+$/i.test(penult) && parts.length >= 3) {
      return parts[parts.length - 3].replace(/_/g, " ");
    }
    return last.replace(/_/g, " ");
  }
  return aid.replace(/_/g, " ");
}

export function conceptShortLabel(node, max = 22) {
  const text = node.display_sv || node.display || node.display_en || String(node.code || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function graphShortLabel(node) {
  if (node.type === "archetype") return archetypeClinicalLabel(node);
  if (node.type === "concept" || node.type === "expression") return conceptShortLabel(node);
  if (node.display_sv || node.display || node.name) {
    const t = node.display_sv || node.display || node.name;
    return t.length > 24 ? `${t.slice(0, 22)}…` : t;
  }
  if (node.code) return String(node.code);
  return node.id.length > 26 ? `${node.id.slice(0, 24)}…` : node.id;
}

export function nodeTooltipLines(node) {
  const lines = [];
  if (node.type === "archetype") {
    lines.push(archetypeClinicalLabel(node));
    if (node.archetype_id) lines.push(node.archetype_id);
    if (node.rm_type) lines.push(`RM type: ${node.rm_type}`);
    if (node.uid) lines.push(`UID: ${node.uid}`);
  } else if (node.type === "concept" || node.type === "expression") {
    const full = node.display_sv || node.display || node.display_en;
    if (full) lines.push(full);
    if (node.code) lines.push(`${node.system || ""} ${node.code}`.trim());
  } else {
    lines.push(node.display_sv || node.display || node.name || node.id);
  }
  if (node.verification) lines.push(node.verification);
  return lines.filter(Boolean);
}
