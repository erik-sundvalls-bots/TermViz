/**
 * Least common parents, from Anne Randorff Højen's algorithm in
 * least-common-parent.js (modified by Erik Sundvall).
 *
 * Interest concepts are the focus ids. A common parent sits on the path to
 * the root of at least two of them. For each distinct set of interest
 * concepts, the least common parent is the common parent closest to them.
 * The original script meant to compare those sets, but the equality test
 * compared one array with itself; this keeps the closest parent of each set.
 */

const SNOMED_ROOT = "138875005";

function ancestorSteps(start, parentsOf) {
  const steps = [];
  const seen = new Set([String(start)]);
  const queue = [{ id: String(start), dist: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (current.id === SNOMED_ROOT) continue;
    for (const parent of parentsOf.get(current.id) || []) {
      const id = String(parent);
      if (seen.has(id)) continue;
      seen.add(id);
      const dist = current.dist + 1;
      steps.push({ target: id, dist });
      queue.push({ id, dist });
    }
  }
  return steps;
}

export function leastCommonParents(links, focusIds) {
  const parentsOf = new Map();
  for (const link of links || []) {
    const child = String(link.source?.id ?? link.source);
    const parent = String(link.target?.id ?? link.target);
    const list = parentsOf.get(child) || [];
    if (!list.includes(parent)) list.push(parent);
    parentsOf.set(child, list);
  }
  const focus = [...new Set((focusIds || []).map((id) => String(id)))].filter(Boolean);
  const paths = focus.map((id) => ({ id, parents: ancestorSteps(id, parentsOf) }));
  const common = new Map();
  for (let i = 0; i < paths.length; i += 1) {
    const first = new Map(paths[i].parents.map((step) => [step.target, step.dist]));
    for (let j = i + 1; j < paths.length; j += 1) {
      for (const step of paths[j].parents) {
        if (!first.has(step.target)) continue;
        if (!common.has(step.target)) common.set(step.target, { id: step.target, dist: Infinity, ic: new Set() });
      }
    }
  }
  for (const concept of common.values()) {
    for (const path of paths) {
      const step = path.parents.find((item) => item.target === concept.id);
      if (!step) continue;
      concept.ic.add(path.id);
      concept.dist = Math.min(concept.dist, step.dist);
    }
  }
  const closest = new Map();
  for (const concept of common.values()) {
    if (concept.ic.size < 2 || !Number.isFinite(concept.dist)) continue;
    const key = [...concept.ic].sort().join("|");
    const kept = closest.get(key);
    if (!kept || concept.dist < kept.dist) closest.set(key, { dist: concept.dist, ids: [concept.id] });
    else if (concept.dist === kept.dist) kept.ids.push(concept.id);
  }
  return new Set([...closest.values()].flatMap((row) => row.ids));
}
