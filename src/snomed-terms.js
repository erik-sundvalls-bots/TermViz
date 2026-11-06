const KIND_ORDER = ["Fully specified name", "Preferred term", "Synonym", "Definition"];

export function descriptionKind(use) {
  const text = String(use || "");
  if (/fully specified/i.test(text)) return "Fully specified name";
  if (/definition/i.test(text)) return "Definition";
  if (/synonym/i.test(text)) return "Synonym";
  if (/preferred/i.test(text) || /^display$/i.test(text)) return "Preferred term";
  return text || "Term";
}

/** Distinct SNOMED CT descriptions. The same term in two dialects is kept once. */
export function descriptionsFromDesignations(designations) {
  const best = new Map();
  for (const item of designations || []) {
    const term = String(item.value ?? item.term ?? "").trim();
    if (!term) continue;
    const kind = descriptionKind(item.use?.display || item.use?.code || item.kind || "");
    const rank = KIND_ORDER.indexOf(kind);
    const nextRank = rank === -1 ? KIND_ORDER.length : rank;
    const key = term.toLocaleLowerCase();
    const current = best.get(key);
    if (!current || nextRank < current.rank) best.set(key, { kind, term, rank: nextRank });
  }
  return [...best.values()]
    .sort((a, b) => a.rank - b.rank || a.term.localeCompare(b.term))
    .map(({ kind, term }) => ({ kind, term }));
}
