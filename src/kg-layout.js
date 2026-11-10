import { coordQuad, decrossOpt, decrossTwoLayer, graphConnect, layeringLongestPath, sugiyama } from "d3-dag";

/** Lower number = closer to the top of the graph (ontology). */
export const TYPE_RANK = {
  concept: 0,
  expression: 1,
  template: 2,
  section: 3,
  archetype: 4,
  archetype_node: 5,
  patient: 6,
  composition_instance: 7,
  entry_instance: 8,
  element_instance: 9,
};

const UP_EDGE_TYPES = new Set(["is_a", "binding", "instance_of", "coded_as", "unit"]);

/**
 * Parent (layout top) → child (layout bottom) for d3-dag graphConnect.
 */
export function layoutParentChild(edge, nodeById) {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  if (!from || !to) return [edge.to, edge.from];

  const rankFrom = TYPE_RANK[from.type] ?? 50;
  const rankTo = TYPE_RANK[to.type] ?? 50;

  if (rankFrom !== rankTo) {
    return rankFrom < rankTo ? [from.id, to.id] : [to.id, from.id];
  }

  if (UP_EDGE_TYPES.has(edge.type)) return [edge.to, edge.from];
  return [edge.from, edge.to];
}

export function layoutPairs(edges, nodeById) {
  const pairs = edges.map((edge) => layoutParentChild(edge, nodeById));
  const linked = new Set(pairs.flat());
  for (const id of nodeById.keys()) {
    if (!linked.has(id)) pairs.push([id, id]);
  }
  return pairs;
}

export function runSugiyama(pairs, { nodeWidth = 8, nodeHeight = 8, gap = [12, 28] } = {}) {
  const connect = graphConnect().single(true);
  let dag;
  let fallback = false;
  const operators = (decross) => sugiyama()
    .layering(layeringLongestPath())
    .decross(decross)
    .coord(coordQuad())
    .nodeSize([nodeWidth, nodeHeight])
    .gap(gap);

  dag = connect(pairs);
  try {
    operators(decrossOpt())(dag);
  } catch {
    dag = connect(pairs);
    operators(decrossTwoLayer())(dag);
    fallback = true;
  }

  const nodes = [];
  for (const node of dag.nodes()) {
    const { x, y } = node;
    nodes.push({ id: node.data, x, y, layer: node.layer });
  }

  const links = [];
  for (const dagLink of dag.links()) {
    const parent = dagLink.source.data;
    const child = dagLink.target.data;
    if (parent === child) continue;
    links.push({
      source: parent,
      target: child,
      points: dagLink.points.map(([x, y]) => [x, y]),
    });
  }

  return { nodes, links, fallback };
}

/**
 * Build parent→child adjacency from layout pairs (for highlight up/down).
 */
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
