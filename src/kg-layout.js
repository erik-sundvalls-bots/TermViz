import { countCrossings, sweepDecross } from "./kg-decross.js";
import { assignRowCoordinates, targetRowWidth, wrapLayersToRows } from "./kg-wrap.js";
import { sugiyamaLinkPath, SUGIYAMA_GAP_X, SUGIYAMA_RADIUS } from "./sugiyama-dag.js";

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
const ROW_GAP = 14;
const LABEL_FONT_PX = 11;

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
  const roots = [...concepts].filter((id) => !edges.some((e) => e.type === "is_a" && e.from === id));
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

export function structuralDepths(nodes, edges) {
  const structural = new Set(
    nodes.filter((n) => n.type !== "concept" && n.type !== "expression").map((n) => n.id),
  );
  const childOf = new Map();
  const structEdges = new Set(["contains", "section_of", "uses_archetype"]);
  for (const edge of edges) {
    if (!structEdges.has(edge.type)) continue;
    if (!structural.has(edge.from) || !structural.has(edge.to)) continue;
    if (!childOf.has(edge.from)) childOf.set(edge.from, []);
    childOf.get(edge.from).push(edge.to);
  }
  const roots = [...structural].filter(
    (id) =>
      !edges.some(
        (e) =>
          structEdges.has(e.type) && e.to === id && structural.has(e.from),
      ),
  );
  const depth = new Map(roots.map((r) => [r, 0]));
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift();
    const dep = depth.get(id) ?? 0;
    for (const child of childOf.get(id) || []) {
      const next = dep + 1;
      if (!depth.has(child) || depth.get(child) > next) {
        depth.set(child, next);
        queue.push(child);
      }
    }
  }
  for (const id of structural) if (!depth.has(id)) depth.set(id, 0);
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

export function measureNodeSize(label, { fontSize = 11, padding = 12, min = 44, max = 148, isConcept = false } = {}) {
  if (isConcept) return { width: SUGIYAMA_RADIUS * 2 + 4, height: 20 };
  const len = Math.min(String(label).length, 32);
  const width = Math.max(min, Math.min(max, padding + len * (fontSize * 0.52)));
  return { width, height: 22 };
}

function measureSizes(active, labelFor) {
  const sizes = new Map();
  for (const node of active) {
    const isConcept = node.type === "concept" || node.type === "expression";
    sizes.set(node.id, measureNodeSize(labelFor(node), { isConcept }));
  }
  return sizes;
}

/** Longest-path sub-layer indices within one semantic band (parent above child). */
function intraBandSublayers(ids, inBandPairs) {
  const children = new Map();
  const childSet = new Set();
  for (const [parent, child] of inBandPairs) {
    if (parent === child) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
    childSet.add(child);
  }
  const roots = ids.filter((id) => !childSet.has(id));
  const depth = new Map(roots.map((r) => [r, 0]));
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift();
    const dep = depth.get(id) ?? 0;
    for (const ch of children.get(id) || []) {
      const next = dep + 1;
      if (!depth.has(ch) || depth.get(ch) < next) {
        depth.set(ch, next);
        queue.push(ch);
      }
    }
  }
  for (const id of ids) if (!depth.has(id)) depth.set(id, 0);
  return depth;
}

function buildGlobalRanks(bandGroups, sortedBands, pairs, bandFor, nodeById) {
  const rankById = new Map();
  const bandToLayers = new Map();
  let layerBase = 0;
  for (const band of sortedBands) {
    const ids = bandGroups.get(band);
    const inBandPairs = pairs.filter(([p, c]) => {
      const pn = nodeById.get(p);
      const cn = nodeById.get(c);
      return pn && cn && bandFor(pn) === band && bandFor(cn) === band;
    });
    const sub = intraBandSublayers(ids, inBandPairs);
    const maxSub = ids.length ? Math.max(...ids.map((id) => sub.get(id) ?? 0)) : 0;
    const layerCount = maxSub + 1;
    bandToLayers.set(band, { base: layerBase, count: layerCount, sub });
    for (const id of ids) {
      rankById.set(id, layerBase + (sub.get(id) ?? 0));
    }
    layerBase += layerCount;
  }
  return { rankById, bandToLayers, numLayers: layerBase };
}

function layersFromRanks(rankById, activeIds) {
  const byRank = new Map();
  for (const id of activeIds) {
    const r = rankById.get(id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(id);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  return ranks.map((r) => byRank.get(r).sort((a, b) => a.localeCompare(b)));
}

function interBandLinkPoints(a, b) {
  const x1 = a.x;
  const y1 = a.y + a.height / 2;
  const x2 = b.x;
  const y2 = b.y - b.height / 2;
  const mid = (y1 + y2) / 2;
  return [
    [x1, y1],
    [x1, mid],
    [x2, mid],
    [x2, y2],
  ];
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
  const structuralDepth = structuralDepths(nodes, edges);
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
  for (const edge of activeEdges) {
    const [parent, child] = layoutEdgeDirection(edge, nodeById, bandFor);
    if (parent === child) continue;
  const key = `${parent}|${child}`;
    if (!pairs.some(([p, c]) => p === parent && c === child)) pairs.push([parent, child]);
  }

  const bandGroups = new Map();
  for (const node of active) {
    const b = bandFor(node);
    if (!bandGroups.has(b)) bandGroups.set(b, []);
    bandGroups.get(b).push(node.id);
  }

  const sizes = measureSizes(active, labelFor);
  const sortedBands = [...bandGroups.keys()].sort((a, b) => a - b);
  const { rankById, numLayers } = buildGlobalRanks(bandGroups, sortedBands, pairs, bandFor, nodeById);

  const sizeById = sizes;
  const baseLayers = layersFromRanks(rankById, activeIds);
  const crossingsNaive = countCrossings(baseLayers, pairs);

  const pass1 = sweepDecross(baseLayers, pairs, { passes: 56 });
  const rowWidth = targetRowWidth(sizeById, numLayers, { aspect: 1.0, min: 400, max: 620 });
  const wrapped = wrapLayersToRows(pass1.layers, sizeById, rowWidth, SUGIYAMA_GAP_X + 4);
  const pass2 = sweepDecross(wrapped, pairs, { passes: 40 });

  const rankMeta = new Map(
    [...activeIds].map((id) => [
      id,
      { layer: rankById.get(id), band: bandFor(nodeById.get(id)) },
    ]),
  );
  const { placed } = assignRowCoordinates(pass2.layers, sizeById, rankMeta, {
    gapX: SUGIYAMA_GAP_X + 4,
    rowGap: ROW_GAP,
    startY: 20,
  });

  const laid = [];
  const laidById = new Map();
  for (const node of active) {
    const p = placed.get(node.id);
    if (!p) continue;
    const band = bandFor(node);
    const item = {
      ...p,
      band,
      node,
      structuralDepth: structuralDepth.get(node.id) ?? 0,
      ontologyDepth: ontologyDepth.get(node.id),
      layer: rankById.get(node.id),
    };
    laid.push(item);
    laidById.set(node.id, item);
  }

  const links = [];
  for (const [parent, child] of pairs) {
    const a = laidById.get(parent);
    const b = laidById.get(child);
    if (a && b) links.push({ source: child, target: parent, points: interBandLinkPoints(a, b) });
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
    structuralDepth,
    layoutEngine: "banded-sugiyama-wrapped",
    sugiyamaLinkPath,
    layoutMeta: { rowWidth, virtualLayers: pass2.layers.length, baseLayers: baseLayers.length },
    crossings: {
      naive: crossingsNaive,
      afterPass1: pass1.crossings,
      afterWrapPass2: pass2.crossings,
    },
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
