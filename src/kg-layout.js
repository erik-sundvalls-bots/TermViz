import { countCrossings, sweepDecross } from "./kg-decross.js";
import {
  heavyDecross,
  layoutSugiyamaFixedLayers,
  sugiyamaLinkPath,
  SUGIYAMA_GAP_X,
  SUGIYAMA_NODE_HEIGHT,
  SUGIYAMA_RADIUS,
} from "./sugiyama-dag.js";

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
const MIN_BAND_GAP = 8;
const BAND_LABEL_PAD = 10;

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
    (id) => !edges.some((e) => structEdges.has(e.type) && e.to === id && structural.has(e.from)),
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

export function measureNodeSize(label, { node, showLabels = true, fontSize = 11, padding = 10, min = 40, max = 160 } = {}) {
  const isConcept = node?.type === "concept" || node?.type === "expression";
  const radius = SUGIYAMA_RADIUS;
  if (isConcept) {
    if (!showLabels) return { width: radius * 2 + 6, height: radius * 2 + 4 };
    const len = Math.min(String(label).length, 24);
    return { width: radius * 2 + 10 + len * (fontSize * 0.52), height: radius * 2 + 4 };
  }
  const len = Math.min(String(label).length, 28);
  const width = Math.max(min, Math.min(max, padding + len * (fontSize * 0.52)));
  return { width, height: 22 };
}

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
    for (const id of ids) rankById.set(id, layerBase + (sub.get(id) ?? 0));
    layerBase += layerCount;
  }
  return { rankById, numLayers: layerBase };
}

function layersFromRanks(rankById, activeIds) {
  const byRank = new Map();
  for (const id of activeIds) {
    const r = rankById.get(id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(id);
  }
  return [...byRank.keys()].sort((a, b) => a - b).map((r) => byRank.get(r).sort((a, b) => a.localeCompare(b)));
}

function packBandsTight(laid, sortedBands, bandForNode) {
  const byBand = new Map();
  for (const n of laid) {
    const b = bandForNode(n.node);
    if (!byBand.has(b)) byBand.set(b, []);
    byBand.get(b).push(n);
  }
  let yCursor = 16;
  for (const band of sortedBands) {
    const nodes = byBand.get(band);
    if (!nodes?.length) continue;
    let minY = Math.min(...nodes.map((n) => n._dagY));
    let maxY = Math.max(...nodes.map((n) => n._dagY));
    const span = Math.max(1, maxY - minY);
    const bandTop = yCursor + BAND_LABEL_PAD;
    const contentH = Math.max(...nodes.map((n) => n.height)) + span * 0.6 + 8;
    for (const n of nodes) {
      const t = (n._dagY - minY) / span;
      n.y = bandTop + t * Math.max(8, contentH - n.height) + n.height / 2;
      n.band = band;
    }
    yCursor = bandTop + contentH + MIN_BAND_GAP;
  }
}

function interBandLinkPoints(a, b) {
  const x1 = a.x;
  const y1 = a.y + (a.layoutRadius ?? a.height / 2);
  const x2 = b.x;
  const y2 = b.y - (b.layoutRadius ?? b.height / 2);
  const mid = (y1 + y2) / 2;
  return [[x1, y1], [x1, mid], [x2, mid], [x2, y2]];
}

export function runBandedLayout({
  nodes,
  edges,
  nodeById,
  labelFor,
  collapseOntologyBelow = 1,
  collapseArchetypeNodes = true,
  showLabels = true,
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
    if (!pairs.some(([p, c]) => p === parent && c === child)) pairs.push([parent, child]);
  }

  const bandGroups = new Map();
  for (const node of active) {
    const b = bandFor(node);
    if (!bandGroups.has(b)) bandGroups.set(b, []);
    bandGroups.get(b).push(node.id);
  }

  const sizes = new Map();
  for (const node of active) {
    sizes.set(node.id, measureNodeSize(labelFor(node), { node, showLabels }));
  }

  const sortedBands = [...bandGroups.keys()].sort((a, b) => a - b);
  const { rankById, numLayers } = buildGlobalRanks(bandGroups, sortedBands, pairs, bandFor, nodeById);

  const baseLayers = layersFromRanks(rankById, activeIds);
  const crossingsNaive = countCrossings(baseLayers, pairs);
  const swept = sweepDecross(baseLayers, pairs, { passes: 56 });

  const dagPairs = pairs.map(([p, c]) => [String(p), String(c)]);
  const linked = new Set(dagPairs.flat());
  for (const id of activeIds) if (!linked.has(id)) dagPairs.push([id, id]);

  const gapY = Math.max(26, SUGIYAMA_NODE_HEIGHT + 14);
  const gapX = SUGIYAMA_GAP_X + (showLabels ? 10 : 4);
  const { dag, fallback } = layoutSugiyamaFixedLayers(
    dagPairs,
    rankById,
    (dn) => {
      const id = String(dn.data);
      const s = sizes.get(id) ?? { width: 52, height: 22 };
      return [s.width, SUGIYAMA_NODE_HEIGHT];
    },
    [gapX, gapY],
    { compact: true },
  );

  let minX = Infinity;
  const at = new Map();
  for (const dagNode of dag.nodes()) {
    if (typeof dagNode.data !== "string") continue;
    minX = Math.min(minX, dagNode.x);
    at.set(dagNode.data, { x: dagNode.x, y: dagNode.y });
  }
  const shiftX = 20 - (Number.isFinite(minX) ? minX : 0);

  const geometry = new Map();
  for (const dagLink of dag.links()) {
    const parent = String(dagLink.source.data);
    const child = String(dagLink.target.data);
    if (parent === child) continue;
    geometry.set(`${child}|${parent}`, dagLink.points?.map(([x, y]) => [x + shiftX, y]) ?? null);
  }

  const laid = [];
  const laidById = new Map();
  for (const node of active) {
    const pos = at.get(node.id);
    if (!pos) continue;
    const size = sizes.get(node.id);
    const isConcept = node.type === "concept" || node.type === "expression";
    const item = {
      id: node.id,
      x: pos.x + shiftX,
      y: 0,
      _dagY: pos.y,
      band: bandFor(node),
      width: size.width,
      height: size.height,
      layoutRadius: isConcept ? SUGIYAMA_RADIUS : size.height / 2,
      isConcept,
      node,
      structuralDepth: structuralDepth.get(node.id) ?? 0,
      ontologyDepth: ontologyDepth.get(node.id),
      layer: rankById.get(node.id),
      labelLines: [labelFor(node)],
    };
    laid.push(item);
    laidById.set(node.id, item);
  }

  packBandsTight(laid, sortedBands, bandFor);

  const anchors = laid.slice().sort((a, b) => a._dagY - b._dagY);
  const remapY = (y) => {
    if (!anchors.length) return y;
    if (y <= anchors[0]._dagY) return anchors[0].y;
    if (y >= anchors[anchors.length - 1]._dagY) return anchors[anchors.length - 1].y;
    for (let i = 0; i < anchors.length - 1; i += 1) {
      const a = anchors[i];
      const b = anchors[i + 1];
      if (y >= a._dagY && y <= b._dagY) {
        const t = b._dagY === a._dagY ? 0.5 : (y - a._dagY) / (b._dagY - a._dagY);
        return a.y + t * (b.y - a.y);
      }
    }
    return y;
  };

  const links = [];
  for (const [parent, child] of pairs) {
    const pts = geometry.get(`${child}|${parent}`);
    if (pts) {
      links.push({
        source: child,
        target: parent,
        points: pts.map(([x, yy]) => [x, remapY(yy)]),
      });
      continue;
    }
    const a = laidById.get(parent);
    const b = laidById.get(child);
    if (a && b) links.push({ source: child, target: parent, points: interBandLinkPoints(a, b) });
  }

  const layersAfter = layersFromRanks(rankById, activeIds);
  for (const layer of layersAfter) {
    layer.sort((a, b) => (laidById.get(a)?.x ?? 0) - (laidById.get(b)?.x ?? 0));
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
    layoutEngine: "banded-sugiyama-natural",
    sugiyamaLinkPath,
    crossings: {
      naive: crossingsNaive,
      afterSweeps: swept.crossings,
      afterDag: countCrossings(layersAfter, pairs),
    },
    decrossFallback: fallback,
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
