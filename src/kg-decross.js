import { mean, median } from "d3-array";

/** Count crossings between consecutive layer rows (parent above child). */
export function countCrossings(layers, pairs) {
  const layerOf = new Map();
  const indexAt = layers.map((layer) => {
    const m = new Map(layer.map((id, i) => [id, i]));
    for (const id of layer) layerOf.set(id, m);
    return m;
  });
  let total = 0;
  for (let li = 0; li < layers.length - 1; li += 1) {
    const top = indexAt[li];
    const bot = indexAt[li + 1];
    const edges = [];
    for (const [p, c] of pairs) {
      if (top.has(p) && bot.has(c)) edges.push([top.get(p), bot.get(c)]);
    }
    for (let i = 0; i < edges.length; i += 1) {
      const [a1, b1] = edges[i];
      for (let j = i + 1; j < edges.length; j += 1) {
        const [a2, b2] = edges[j];
        if ((a1 - a2) * (b1 - b2) < 0) total += 1;
      }
    }
  }
  return total;
}

function layerScore(layer, other, neighborIndex, neighborOf, aggregate) {
  const scores = new Map();
  for (const id of layer) {
    const neigh = neighborOf.get(id) || [];
    const idx = neigh
      .filter((n) => neighborIndex.has(n))
      .map((n) => neighborIndex.get(n));
    scores.set(id, idx.length ? aggregate(idx) : null);
  }
  return scores;
}

function orderByScores(layer, scores) {
  const withIdx = layer.map((id, i) => ({ id, i, s: scores.get(id) }));
  withIdx.sort((a, b) => {
    if (a.s === null && b.s === null) return a.i - b.i;
    if (a.s === null) return 1;
    if (b.s === null) return -1;
    if (a.s === b.s) return a.i - b.i;
    return a.s - b.s;
  });
  return withIdx.map((x) => x.id);
}

function buildNeighborMaps(pairs) {
  const parentsOf = new Map();
  const childrenOf = new Map();
  for (const [p, c] of pairs) {
    if (p === c) continue;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(c);
    if (!parentsOf.has(c)) parentsOf.set(c, []);
    parentsOf.get(c).push(p);
  }
  return { parentsOf, childrenOf };
}

/** Barycenter / median sweeps + adjacent swap hill-climbing (mapper-style). */
export function sweepDecross(layers, pairs, { passes = 56, useMedian = true } = {}) {
  const { parentsOf, childrenOf } = buildNeighborMaps(pairs);
  let best = layers.map((l) => [...l]);
  let bestCross = countCrossings(best, pairs);
  const work = layers.map((l) => [...l]);

  for (let pass = 0; pass < passes; pass += 1) {
    const aggregate = useMedian && pass % 3 === 1 ? median : mean;

    for (let li = 1; li < work.length; li += 1) {
      const upper = new Map(work[li - 1].map((id, i) => [id, i]));
      const scores = layerScore(work[li], work[li - 1], upper, parentsOf, aggregate);
      work[li] = orderByScores(work[li], scores);
    }

    for (let li = work.length - 2; li >= 0; li -= 1) {
      const lower = new Map(work[li + 1].map((id, i) => [id, i]));
      const scores = layerScore(work[li], work[li + 1], lower, childrenOf, aggregate);
      work[li] = orderByScores(work[li], scores);
    }

    for (let li = 0; li < work.length; li += 1) {
      greedySwapLayer(work, li, pairs);
    }

    const c = countCrossings(work, pairs);
    if (c < bestCross) {
      bestCross = c;
      best = work.map((l) => [...l]);
    }
  }

  return { layers: best, crossings: bestCross };
}

function crossingDeltaLayer(layer, pairs, layerIdx, layers, i) {
  const trial = layer.slice();
  [trial[i], trial[i + 1]] = [trial[i + 1], trial[i]];
  const next = layers.map((l, idx) => (idx === layerIdx ? trial : l));
  return countCrossings(next, pairs) - countCrossings(layers, pairs);
}

function greedySwapLayer(layers, layerIdx, pairs) {
  const layer = layers[layerIdx];
  let moved = true;
  let guard = 0;
  while (moved && guard++ < layer.length * 4) {
    moved = false;
    let bestI = -1;
    let bestD = 0;
    for (let i = 0; i < layer.length - 1; i += 1) {
      const d = crossingDeltaLayer(layer, pairs, layerIdx, layers, i);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI >= 0) {
      [layer[bestI], layer[bestI + 1]] = [layer[bestI + 1], layer[bestI]];
      moved = true;
    }
  }
}
