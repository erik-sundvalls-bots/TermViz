
/** Lower index = higher on screen (ontology at top). */
export const TYPE_BAND = {
  concept: null,
  expression: null,
  template: 10,
  section: 11,
  archetype: 12,
  archetype_node: 13,
  patient: 14,
  composition_instance: 15,
  entry_instance: 16,
  element_instance: 17,
};

export const BAND_META = [
  { id: "ontology-0", label: "Ontology — top concepts", match: (n, d) => (n.type === "concept" || n.type === "expression") && d === 0 },
  { id: "ontology-1", label: "Ontology — mid concepts", match: (n, d) => (n.type === "concept" || n.type === "expression") && d === 1 },
  { id: "ontology-2", label: "Ontology — lower concepts", match: (n, d) => (n.type === "concept" || n.type === "expression") && d >= 2 },
  { id: "template", label: "openEHR template", types: ["template"] },
  { id: "section", label: "Template sections", types: ["section"] },
  { id: "archetype", label: "Archetypes", types: ["archetype"] },
  { id: "archetype_node", label: "Archetype nodes (paths / RM types)", types: ["archetype_node"] },
  { id: "instance", label: "Patients & composition instances", types: ["patient", "composition_instance", "entry_instance", "element_instance"] },
];

const UP_EDGE_TYPES = new Set(["is_a", "binding", "instance_of", "coded_as", "unit"]);
const RANKSEP = 118;
const NODESEP = 22;

export function ontologyDepths(nodes, edges) {
  const concepts = new Set(
    nodes.filter((n) => n.type === "concept" || n.type === "expression").map((n) => n.id),
  );
  const children = new Map();
  for (const edge of edges) {
    if (edge.type !== "is_a") continue;
    if (!concepts.has(edge.from) || !concepts.has(edge.to)) continue;
    if (!children.has(edge.to)) children.set(edge.to, []);
    children.get(edge.to).push(edge.from);
  }
  const roots = [...concepts].filter((id) => {
    const parents = edges.filter((e) => e.type === "is_a" && e.from === id);
    return parents.length === 0;
  });
  const depth = new Map(roots.map((r) => [r, 0]));
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift();
    const dep = depth.get(id) ?? 0;
    for (const child of children.get(id) || []) {
      const next = dep + 1;
      if (!depth.has(child) || depth.get(child) > next) {
        depth.set(child, next);
        queue.push(child);
      }
    }
  }
  for (const id of concepts) if (!depth.has(id)) depth.set(id, 0);
  return depth;
}

export function bandIndexForNode(node, ontologyDepth) {
  if (node.type === "concept" || node.type === "expression") {
    const d = ontologyDepth.get(node.id) ?? 0;
    return Math.min(d, 2);
  }
  return TYPE_BAND[node.type] ?? 18;
}

function layoutEdgeDirection(edge, nodeById, bandFor) {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  if (!from || !to) return [edge.from, edge.to];

  const bf = bandFor(from);
  const bt = bandFor(to);
  if (bf !== bt) return bf < bt ? [from.id, to.id] : [to.id, from.id];
  if (UP_EDGE_TYPES.has(edge.type)) return [edge.to, edge.from];
  return [edge.from, edge.to];
}

/**
 * Horizontal ordering within each band via repeated barycenter sweeps on the DAG.
 */
function orderWithinBands(bandGroups, children, parents) {
  const order = new Map();
  for (const [band, ids] of bandGroups) {
    order.set(band, ids.slice().sort((a, b) => a.localeCompare(b)));
  }
  const bands = [...bandGroups.keys()].sort((a, b) => a - b);
  for (let pass = 0; pass < 24; pass += 1) {
    for (const band of bands) {
      const ids = order.get(band);
      const scores = new Map(ids.map((id) => [id, 0]));
      let hits = 0;
      for (const id of ids) {
        const neighbours = [...(parents.get(id) || []), ...(children.get(id) || [])];
        if (!neighbours.length) continue;
        let sum = 0;
        let count = 0;
        for (const n of neighbours) {
          for (const b of bands) {
            const list = order.get(b);
            const idx = list.indexOf(n);
            if (idx >= 0) {
              sum += idx;
              count += 1;
            }
          }
        }
        if (count) {
          scores.set(id, sum / count);
          hits += 1;
        }
      }
      if (!hits) continue;
      ids.sort((a, b) => {
        const sa = scores.get(a);
        const sb = scores.get(b);
        if (sa === sb) return a.localeCompare(b);
        return sa - sb;
      });
    }
  }
  return order;
}

export function measureNodeSize(label, { fontSize = 11, padding = 14, min = 52, max = 168 } = {}) {
  const len = Math.min(label.length, 28);
  const width = Math.max(min, Math.min(max, padding + len * (fontSize * 0.55)));
  return { width, height: 26 };
}

export function runBandedLayout({
  nodes,
  edges,
  nodeById,
  labelFor,
  collapseOntologyBelow = 1,
  collapseArchetypeNodes = true,
}) {
  const ontologyDepth = ontologyDepths(nodes, edges);
  const bandFor = (node) => bandIndexForNode(node, ontologyDepth);

  const active = nodes.filter((node) => {
    if (collapseArchetypeNodes && node.type === "archetype_node") return false;
    if (node.type === "concept" || node.type === "expression") {
      const d = ontologyDepth.get(node.id) ?? 0;
      if (collapseOntologyBelow !== false && d > collapseOntologyBelow) return false;
    }
    return true;
  });
  const activeIds = new Set(active.map((n) => n.id));
  const activeEdges = edges.filter((e) => activeIds.has(e.from) && activeIds.has(e.to));

  const pairs = [];
  const children = new Map();
  const parents = new Map();
  for (const edge of activeEdges) {
    const [src, tgt] = layoutEdgeDirection(edge, nodeById, bandFor);
    if (src === tgt) continue;
    pairs.push([src, tgt]);
    if (!children.has(src)) children.set(src, new Set());
    children.get(src).add(tgt);
    if (!parents.has(tgt)) parents.set(tgt, new Set());
    parents.get(tgt).add(src);
  }

  const bandGroups = new Map();
  for (const node of active) {
    const b = bandFor(node);
    if (!bandGroups.has(b)) bandGroups.set(b, []);
    bandGroups.get(b).push(node.id);
  }
  const order = orderWithinBands(bandGroups, children, parents);

  const sizes = new Map();
  for (const node of active) {
    sizes.set(node.id, measureNodeSize(labelFor(node)));
  }

  const laid = [];
  const pos = new Map();
  const bands = [...bandGroups.keys()].sort((a, b) => a - b);
  for (const band of bands) {
    const ids = order.get(band);
    let xCursor = 0;
    const row = [];
    for (const id of ids) {
      const size = sizes.get(id);
      const node = nodeById.get(id);
      const x = xCursor + size.width / 2;
      const y = band * RANKSEP + 40;
      row.push({ id, x, y, band, width: size.width, height: size.height, node });
      xCursor += size.width + NODESEP;
    }
    const shift = xCursor / 2;
    for (const item of row) {
      item.x -= shift;
      laid.push(item);
      pos.set(item.id, item);
    }
  }

  const links = [];
  for (const [src, tgt] of pairs) {
    const a = pos.get(src);
    const b = pos.get(tgt);
    if (!a || !b) continue;
    const x1 = a.x;
    const y1 = a.y + a.height / 2;
    const x2 = b.x;
    const y2 = b.y - b.height / 2;
    const mid = (y1 + y2) / 2;
    links.push({
      source: src,
      target: tgt,
      points: [
        [x1, y1],
        [x1, mid],
        [x2, mid],
        [x2, y2],
      ],
    });
  }

  const bandRanges = new Map();
  for (const n of laid) {
    const b = n.band;
    const top = n.y - n.height / 2;
    const bottom = n.y + n.height / 2;
  const prev = bandRanges.get(b);
    if (!prev) bandRanges.set(b, { minY: top, maxY: bottom, band: b });
    else {
      prev.minY = Math.min(prev.minY, top);
      prev.maxY = Math.max(prev.maxY, bottom);
    }
  }

  return {
    nodes: laid,
    links,
    bandRanges,
    ontologyDepth,
    layoutEngine: "banded-barycenter",
    collapsed: { archetypeNodes: collapseArchetypeNodes, ontologyDepthMax: collapseOntologyBelow },
  };
}

export function adjacencyFromPairs(pairs) {
  const children = new Map();
  const parents = new Map();
  for (const [parent, child] of pairs) {
    if (parent === child) continue;
    if (!children.has(parent)) children.set(parent, new Set());
    children.get(parent).add(child);
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child).add(parent);
  }
  return { children, parents };
}

export function layoutPairsFromEdges(edges, nodeById) {
  const bandFor = (node) => bandIndexForNode(node, new Map());
  return edges.map((edge) => layoutEdgeDirection(edge, nodeById, bandFor));
}

export function collectUpstream(id, parents) {
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const p of parents.get(current) || []) stack.push(p);
  }
  return seen;
}

export function collectDownstream(id, children) {
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const c of children.get(current) || []) stack.push(c);
  }
  return seen;
}
