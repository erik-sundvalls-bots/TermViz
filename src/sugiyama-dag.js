import * as d3 from "d3";
import { coordQuad, decrossOpt, decrossTwoLayer, graphConnect, layeringLongestPath, sugiyama } from "d3-dag";

/** d3-dag layering: assign each node a fixed rank (layer index). */
export function layeringFromRanks(rankById) {
  function layering(dag, _sep) {
    let height = 0;
    for (const node of dag.nodes()) {
      const r = rankById.get(String(node.data)) ?? 0;
      node.y = r;
      height = Math.max(height, r);
    }
    return height;
  }
  layering.d3dagBuiltin = true;
  return layering;
}

/** Shared with termviz-mapper-test SNOMED Sugiyama layout (free layering). */
export function layoutSugiyama(pairs, nodeSize, gap) {
  const connect = graphConnect().single(true);
  const operators = (decross) => sugiyama()
    .layering(layeringLongestPath())
    .decross(decross)
    .coord(coordQuad())
    .nodeSize(nodeSize)
    .gap(gap);
  const dag = connect(pairs);
  try {
    operators(decrossOpt())(dag);
    return { dag, fallback: false };
  } catch {
    const retry = connect(pairs);
    operators(decrossTwoLayer())(retry);
    return { dag: retry, fallback: true };
  }
}

/**
 * Full-graph Sugiyama with prescribed layer ranks (semantic bands + sub-layers).
 * Decrossing and coordinate assignment run globally across all layers.
 */
export function layoutSugiyamaFixedLayers(pairs, rankById, nodeSize, gap) {
  const connect = graphConnect().single(true);
  const layering = layeringFromRanks(rankById);
  const operators = (decross) => sugiyama()
    .layering(layering)
    .decross(decross)
    .coord(coordQuad())
    .nodeSize(nodeSize)
    .gap(gap);
  const dag = connect(pairs);
  try {
    operators(decrossOpt())(dag);
    return { dag, fallback: false };
  } catch {
    const retry = connect(pairs);
    operators(decrossTwoLayer())(retry);
    return { dag: retry, fallback: true };
  }
}

export function sugiyamaLinkPath(points) {
  if (!points || points.length < 2) return "";
  return d3.line().curve(d3.curveBumpY)(points.slice().reverse());
}

export const SUGIYAMA_GAP_X = 8;
export const SUGIYAMA_NODE_HEIGHT = 16;
export const SUGIYAMA_RADIUS = 8;
