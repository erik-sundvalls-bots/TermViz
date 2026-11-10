import {
  layoutSugiyama,
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
const PACK_TOP = 16;
const MIN_BAND_GAP = 10;
const BAND_LABEL_PAD = 14;

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

function sugiyamaGapY(maxNodeHeight) {
  return Math.max(20, maxNodeHeight + 10);
}

/** Per-band-only layout (old behaviour) — used only for crossing baseline. */
function layoutPerBandOnly(active, pairs, bandGroups, sortedBands, sizes, bandFor, nodeById, labelFor) {
  const orderById = new Map();
  for (const band of sortedBands) {
    const ids = bandGroups.get(band);
    const inBandPairs = pairs.filter(([p, c]) => {
      const pn = nodeById.get(p);
      const cn = nodeById.get(c);
      return pn && cn && bandFor(pn) === band && bandFor(cn) === band;
    });
    const idSet = new Set(ids);
    const localPairs = inBandPairs.filter(([p, c]) => idSet.has(p) && idSet.has(c));
    const linked = new Set(localPairs.flat());
    const dagPairs = localPairs.map(([p, c]) => [String(p), String(c)]);
    for (const id of ids) if (!linked.has(id)) dagPairs.push([id, id]);
    if (!dagPairs.length) continue;
    const widths = new Map(ids.map((id) => [id, sizes.get(id)?.width ?? 52]));
    const gapY = sugiyamaGapY(24);
    const { dag } = layoutSugiyama(
      dagPairs,
      (n) => [widths.get(String(n.data)) ?? 52, SUGIYAMA_NODE_HEIGHT],
      [SUGIYAMA_GAP_X, gapY],
    );
    for (const dagNode of dag.nodes()) {
      if (typeof dagNode.data === "string") orderById.set(dagNode.data, dagNode.x);
    }
  }
  return orderById;
}

/** Count edge crossings between adjacent rank layers (x order). */
export function countLayeredCrossings(rankById, xById, pairs) {
  const byLayer = new Map();
  for (const [id, rank] of rankById) {
    if (!byLayer.has(rank)) byLayer.set(rank, []);
    byLayer.get(rank).push(id);
  }
  for (const ids of byLayer.values()) {
    ids.sort((a, b) => (xById.get(a) ?? 0) - (xById.get(b) ?? 0));
  }
  const ranks = [...byLayer.keys()].sort((a, b) => a - b);
  let total = 0;
  for (let ri = 0; ri < ranks.length - 1; ri += 1) {
    const r0 = ranks[ri];
    const r1 = ranks[ri + 1];
    const left = new Map(byLayer.get(r0).map((id, i) => [id, i]));
    const right = new Map(byLayer.get(r1).map((id, i) => [id, i]));
    const edges = pairs.filter(([p, c]) => {
      const pr = rankById.get(p);
      const cr = rankById.get(c);
      return (pr === r0 && cr === r1) || (pr === r1 && cr === r0);
    }).map(([p, c]) => {
      const pr = rankById.get(p);
      return pr === r0 ? [p, c] : [c, p];
    });
    for (let i = 0; i < edges.length; i += 1) {
      const [s1, t1] = edges[i];
      const a = left.get(s1);
      const b = right.get(t1);
      if (a === undefined || b === undefined) continue;
      for (let j = i + 1; j < edges.length; j += 1) {
        const [s2, t2] = edges[j];
        const c = left.get(s2);
        const d = right.get(t2);
        if (c === undefined || d === undefined) continue;
        if ((a - c) * (b - d) < 0) total += 1;
      }
    }
  }
  return total;
}

/** Compress dag Y into tight semantic bands sized by sub-layers and node size. */
function packBandsVertically(laid, sortedBands, bandForNode) {
  const byBand = new Map();
  const bandStats = new Map();
  for (const n of laid) {
    const b = bandForNode(n.node);
    if (!byBand.has(b)) byBand.set(b, []);
    byBand.get(b).push(n);
  }
  let yCursor = PACK_TOP;
  for (const band of sortedBands) {
    const nodes = byBand.get(band);
    if (!nodes?.length) continue;
    let minDagY = Infinity;
    let maxDagY = -Infinity;
    let maxNodeH = 0;
    for (const n of nodes) {
      minDagY = Math.min(minDagY, n._dagY);
      maxDagY = Math.max(maxDagY, n._dagY);
      maxNodeH = Math.max(maxNodeH, n.height);
    }
    const subLayers = new Set(nodes.map((n) => n.layer)).size;
    const span = Math.max(1, maxDagY - minDagY);
    const subGap = Math.max(18, maxNodeH + 6);
    const bandContentH = nodes.length === 1
      ? maxNodeH + 6
      : Math.max(maxNodeH + 8, subLayers * subGap);
    const bandTop = yCursor + (nodes.length > 1 ? BAND_LABEL_PAD : 4);
    bandStats.set(band, { minDagY, maxDagY, bandTop, bandContentH, span });

    for (const n of nodes) {
      const t = nodes.length === 1 ? 0.5 : (n._dagY - minDagY) / span;
      n.y = bandTop + t * Math.max(0, bandContentH - n.height) + n.height / 2;
      n.band = band;
    }
    yCursor = bandTop + bandContentH + MIN_BAND_GAP;
  }

  const anchors = laid
    .slice()
    .sort((a, b) => a._dagY - b._dagY)
    .map((n) => ({ dagY: n._dagY, y: n.y }));

  function remapDagY(y) {
    if (!anchors.length) return y;
    if (y <= anchors[0].dagY) return anchors[0].y;
    if (y >= anchors[anchors.length - 1].dagY) return anchors[anchors.length - 1].y;
    for (let i = 0; i < anchors.length - 1; i += 1) {
      const a = anchors[i];
      const b = anchors[i + 1];
      if (y >= a.dagY && y <= b.dagY) {
        const t = b.dagY === a.dagY ? 0.5 : (y - a.dagY) / (b.dagY - a.dagY);
        return a.y + t * (b.y - a.y);
      }
    }
    return y;
  }

  return { bandStats, remapDagY };
}

function transformLinkPoints(points, remapDagY) {
  if (!points?.length) return points;
  return points.map(([x, y]) => [x, remapDagY(y)]);
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
  const { rankById, bandToLayers, numLayers } = buildGlobalRanks(bandGroups, sortedBands, pairs, bandFor, nodeById);

  const widths = new Map();
  for (const node of active) {
    const isConcept = node.type === "concept" || node.type === "expression";
    const w = sizes.get(node.id)?.width ?? 52;
    widths.set(node.id, isConcept ? Math.max(20, w) : w);
  }

  const dagPairs = pairs.map(([p, c]) => [String(p), String(c)]);
  const linked = new Set(dagPairs.flat());
  for (const id of activeIds) if (!linked.has(id)) dagPairs.push([id, id]);

  const maxH = Math.max(...[...sizes.values()].map((s) => s.height), 22);
  const gapY = sugiyamaGapY(maxH);

  const perBandX = layoutPerBandOnly(active, pairs, bandGroups, sortedBands, sizes, bandFor, nodeById, labelFor);
  const crossingsBefore = countLayeredCrossings(rankById, perBandX, pairs);

  const { dag, fallback } = layoutSugiyamaFixedLayers(
    dagPairs,
    rankById,
    (dagNode) => [widths.get(String(dagNode.data)) ?? 52, SUGIYAMA_NODE_HEIGHT],
    [SUGIYAMA_GAP_X, gapY],
  );

  const at = new Map();
  let minX = Infinity;
  for (const dagNode of dag.nodes()) {
    if (typeof dagNode.data !== "string") continue;
    const id = dagNode.data;
    minX = Math.min(minX, dagNode.x);
    at.set(id, { x: dagNode.x, y: dagNode.y });
  }
  const shiftX = 24 - (Number.isFinite(minX) ? minX : 0);

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
    const band = bandFor(node);
    const bandMeta = bandToLayers.get(band);
    const bandIds = bandGroups.get(band) || [];
    let minBandY = Infinity;
    let maxBandY = -Infinity;
    for (const id of bandIds) {
      const p = at.get(id);
      if (!p) continue;
      minBandY = Math.min(minBandY, p.y);
      maxBandY = Math.max(maxBandY, p.y);
    }
    laid.push({
      id: node.id,
      x: pos.x + shiftX,
      y: 0,
      _dagY: pos.y,
      _span: Math.max(1, maxBandY - minBandY),
      band,
      width: size.width,
      height: size.height,
      node,
      structuralDepth: structuralDepth.get(node.id) ?? 0,
      ontologyDepth: ontologyDepth.get(node.id),
      layer: rankById.get(node.id),
    });
  }

  const { remapDagY } = packBandsVertically(laid, sortedBands, bandFor);
  for (const item of laid) laidById.set(item.id, item);

  const globalX = new Map(laid.map((n) => [n.id, n.x]));
  const crossingsAfter = countLayeredCrossings(rankById, globalX, pairs);

  const links = [];
  for (const [parent, child] of pairs) {
    const pts = geometry.get(`${child}|${parent}`);
    if (pts) {
      const transformed = transformLinkPoints(pts, remapDagY);
      links.push({ source: child, target: parent, points: transformed });
      continue;
    }
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
    layoutEngine: "banded-sugiyama-global",
    sugiyamaLinkPath,
    crossings: { perBandOnly: crossingsBefore, global: crossingsAfter, decrossFallback: fallback },
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
