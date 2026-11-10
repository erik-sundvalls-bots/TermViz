/**
 * TermViz rendering for D3 7.
 * The 2013 termviz.js speaks the D3 v2 layout API (d3.layout.force,
 * d3.layout.cluster, d3.svg.diagonal). Those calls were removed, so this
 * module is the replacement: a force-directed is-a graph, a layered
 * ancestor DAG, and a collapsible template tree.
 */

import * as d3 from "d3";
import { coordQuad, decrossOpt, decrossTwoLayer, graphConnect, layeringLongestPath, sugiyama } from "d3-dag";

export const D3_VERSION = "7.9.2";

const RANK_COLORS = ["#0f6e6b", "#1d4e89", "#c46b1a", "#8a4b2f", "#6b3a6b"];

/**
 * ColorBrewer Set3, 12 qualitative classes (Cynthia Brewer).
 * One colour per switched-on template node, not per SNOMED guess.
 * Mapping-suggestion categories also get a hatch; the angle and dash differ per class.
 */
export const NODE_COLORS = ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd", "#ccebc5", "#ffed6f"];

export const CATEGORY_HATCHES = [
  { angle: 45, dash: null },
  { angle: 135, dash: null },
  { angle: 90, dash: "1.2 1.6" },
  { angle: 0, dash: "2.2 1.4" },
  { angle: 30, dash: null },
  { angle: 60, dash: "1.6 2" },
  { angle: -30, dash: null },
  { angle: 75, dash: "2.4 1.2" },
  { angle: 15, dash: null },
  { angle: -60, dash: "1 1.8" },
  { angle: 105, dash: null },
  { angle: -15, dash: "3 1.6" },
];

function mixHex(hex, amount) {
  const n = Number.parseInt(String(hex).slice(1), 16);
  const mix = (channel) => Math.max(0, Math.min(255, Math.round(channel * amount)));
  return `#${[mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function inkOf(hex) {
  return mixHex(hex, 0.55);
}

/** A deeper tint of the category colour, still clearly that colour rather than black. */
export function hatchInk(hex) {
  return mixHex(hex, 0.76);
}

export function categoryPatternId(svgId, index) {
  return `${svgId}-cat-${index % NODE_COLORS.length}`;
}

export function installCategoryPatterns(svgSelection) {
  const svg = d3.select(svgSelection);
  const rootId = svg.attr("id") || "fig";
  const defs = svg.append("defs").attr("class", "category-patterns");
  NODE_COLORS.forEach((color, index) => {
    const hatch = CATEGORY_HATCHES[index];
    const pattern = defs.append("pattern")
      .attr("id", categoryPatternId(rootId, index))
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", 8)
      .attr("height", 8)
      .attr("patternTransform", `rotate(${hatch.angle})`);
    pattern.append("rect").attr("width", 8).attr("height", 8).attr("fill", color);
    const line = pattern.append("line")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", 8)
      .attr("stroke", hatchInk(color))
      .attr("stroke-width", 1.05);
    if (hatch.dash) line.attr("stroke-dasharray", hatch.dash);
  });
}

function zoomLayer(svg) {
  const layer = svg.append("g").attr("class", "zoom-layer");
  layer.attr("transform", d3.zoomTransform(svg.node()));
  return layer;
}

/**
 * Pinch, ctrl/cmd + wheel, and drag-to-pan. Plain wheel pans.
 * Buttons call zoomGraph().
 */
export function graphZoom(svgSelection) {
  const svg = d3.select(svgSelection);
  const node = svg.node();
  if (!node) return null;
  if (node.__termvizZoom) return node.__termvizZoom;
  const zoom = d3.zoom()
    .scaleExtent([0.2, 8])
    .filter((event) => {
      if (event.type === "wheel") return event.ctrlKey || event.metaKey;
      const target = event.target;
      if (typeof target?.closest === "function" && target.closest(".force-node, .tpl-node")) return false;
      return !event.button;
    })
    .on("zoom", (event) => {
      svg.select("g.zoom-layer").attr("transform", event.transform);
      node.dispatchEvent(new CustomEvent("termviz-view", { bubbles: true }));
    });
  svg.call(zoom);
  svg.on("wheel.pan", (event) => {
    if (event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    svg.call(zoom.translateBy, -event.deltaX, -event.deltaY);
  });
  node.__termvizZoom = zoom;
  node.style.touchAction = "none";
  return zoom;
}

export function zoomGraph(svgSelection, mode) {
  const svg = d3.select(svgSelection);
  const zoom = graphZoom(svgSelection);
  if (!zoom) return;
  const node = svg.node();
  const play = (duration, apply) => {
    svg.transition().duration(duration).call(apply).on("end.termviz", () => {
      node?.dispatchEvent(new CustomEvent("termviz-view", { bubbles: true }));
    });
  };
  if (mode === "in") {
    play(180, (selection) => selection.call(zoom.scaleBy, 1.35));
    return;
  }
  if (mode === "out") {
    play(180, (selection) => selection.call(zoom.scaleBy, 1 / 1.35));
    return;
  }
  if (mode === "one") {
    play(220, (selection) => selection.call(zoom.transform, d3.zoomIdentity));
    return;
  }
  const layer = svg.select("g.zoom-layer").node();
  const host = svg.node();
  if (!layer || !host) return;
  const bounds = layer.getBBox();
  const width = host.clientWidth || host.viewBox?.baseVal?.width || 0;
  const height = host.clientHeight || host.viewBox?.baseVal?.height || 0;
  if (!bounds.width || !bounds.height || !width || !height) return;
  const pad = 28;
  const k = Math.max(0.2, Math.min(8, Math.min((width - pad * 2) / bounds.width, (height - pad * 2) / bounds.height)));
  const tx = (width - bounds.width * k) / 2 - bounds.x * k;
  const ty = (height - bounds.height * k) / 2 - bounds.y * k;
  play(280, (selection) => selection.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k)));
}

const REST_CHARGE = -160;

export function burstGraph(svgSelection) {
  const node = svgSelection instanceof Element ? svgSelection : svgSelection?.node?.();
  const simulation = node?.__termvizSimulation;
  if (!simulation) return;
  const charge = simulation.force("charge");
  if (!charge) return;
  window.clearTimeout(node.__termvizBurst);
  charge.strength(REST_CHARGE * 7);
  simulation.alpha(0.85).restart();
  node.__termvizBurst = window.setTimeout(() => {
    if (node.__termvizSimulation !== simulation) return;
    charge.strength(REST_CHARGE);
    simulation.alpha(0.35).restart();
  }, 800);
}

function clear(svg) {
  const node = svg.node();
  if (node?.__termvizSimulation) {
    node.__termvizSimulation.stop();
    node.__termvizSimulation = null;
  }
  svg.selectAll("*").remove();
}

function sizeOf(svg) {
  const node = svg.node();
  const box = node.getBoundingClientRect();
  const width = Math.max(320, box.width || node.clientWidth || 640);
  const height = Math.max(220, box.height || node.clientHeight || 360);
  return { width, height };
}

function visibleName(item) {
  const name = item.name || item.display || "";
  if (!name || name === String(item.id)) return "Unnamed concept";
  return name;
}

function wrapLabel(name, limit = 28) {
  if (!name) return [""];
  if (name.length <= limit) return [name];
  const middle = name.lastIndexOf(" ", Math.ceil(name.length / 2));
  const split = middle > 8 ? middle : name.indexOf(" ");
  if (split <= 0) return [name.slice(0, limit - 1) + "…"];
  const second = name.slice(split + 1);
  return [name.slice(0, split), second.length > limit ? second.slice(0, limit - 1) + "…" : second];
}

export function renderAncestorDag(svgSelection, graph, { suggestions = [], selectedCode, onSelect } = {}) {
  const svg = d3.select(svgSelection);
  clear(svg);
  const { width } = sizeOf(svg);
  if (!graph?.nodes?.length) {
    svg.attr("viewBox", null).attr("width", "100%").attr("height", "100%");
    return;
  }

  const ranks = new Map(suggestions.map((item) => [String(item.code), item]));
  const nodes = graph.nodes.map((node) => ({ ...node, parents: [...node.parents] }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depths = [...new Set(nodes.map((node) => node.depth))].sort((a, b) => a - b);
  const layers = d3.group(nodes, (node) => node.depth);
  for (const layer of layers.values()) {
    layer.sort((a, b) => a.display.localeCompare(b.display) || a.id.localeCompare(b.id));
  }
  for (let pass = 0; pass < 4; pass++) {
    for (const depth of depths) {
      const layer = layers.get(depth);
      layer.sort((a, b) => {
        const key = (node) => {
          if (!node.parents.length) return layer.indexOf(node);
          const values = node.parents
            .map((id) => byId.get(id))
            .filter(Boolean)
            .map((parent) => layers.get(parent.depth).indexOf(parent));
          return values.length ? d3.mean(values) : 0;
        };
        return key(a) - key(b) || a.id.localeCompare(b.id);
      });
    }
  }

  const column = 158;
  const row = 86;
  const widest = Math.max(...[...layers.values()].map((layer) => layer.length));
  const innerWidth = Math.max(width - 24, widest * column);
  for (const depth of depths) {
    const layer = layers.get(depth);
    const gap = innerWidth / (layer.length + 1);
    layer.forEach((node, index) => {
      node.x = gap * (index + 1);
      node.y = 36 + depth * row;
    });
  }
  const height = 36 + (depths.at(-1) + 1) * row + 28;
  svg.attr("width", innerWidth + 8).attr("height", height).attr("viewBox", `0 0 ${innerWidth + 8} ${height}`);

  const defs = svg.append("defs");
  defs.append("marker")
    .attr("id", "isa-arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 14)
    .attr("refY", 0)
    .attr("markerWidth", 7)
    .attr("markerHeight", 7)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("class", "dag-arrow");

  const curve = d3.linkVertical().x((point) => point.x).y((point) => point.y);
  const link = svg.append("g")
    .attr("fill", "none")
    .selectAll("path")
    .data(graph.links)
    .join("path")
    .attr("class", "dag-link")
    .attr("marker-end", "url(#isa-arrow)")
    .attr("d", (item) => {
      const source = byId.get(item.source);
      const target = byId.get(item.target);
      if (!source || !target) return null;
      return curve({ source, target });
    });

  const node = svg.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", (item) => {
      const classes = ["dag-node"];
      if (item.id === "138875005") classes.push("is-root");
      if (ranks.has(item.id)) classes.push("is-suggestion");
      if (item.id === selectedCode) classes.push("is-selected");
      if (item.inactive) classes.push("is-inactive");
      return classes.join(" ");
    })
    .attr("transform", (item) => `translate(${item.x},${item.y})`)
    .on("click", (event, item) => {
      event.stopPropagation();
      onSelect?.(item);
    });

  node.append("title").text((item) => {
    const guess = ranks.get(item.id);
    const lines = [`${item.display}`, item.id];
    if (guess) lines.push(`Suggestion ${guess.rank}, score ${guess.score.toFixed(2)}`);
    return lines.join("\n");
  });

  node.append("circle")
    .attr("r", (item) => ranks.has(item.id) ? 15 : item.id === "138875005" ? 8 : 6)
    .attr("fill", (item) => {
      const guess = ranks.get(item.id);
      return guess ? RANK_COLORS[(guess.rank - 1) % RANK_COLORS.length] : "#fff";
    });

  node.filter((item) => ranks.has(item.id))
    .append("text")
    .attr("class", "dag-rank")
    .attr("dy", "0.35em")
    .attr("text-anchor", "middle")
    .text((item) => ranks.get(item.id).rank);

  node.each(function drawLabel(item) {
    const lines = wrapLabel(item.display, ranks.has(item.id) ? 26 : 22);
    const label = d3.select(this).append("text").attr("class", "dag-label").attr("text-anchor", "middle");
    lines.forEach((line, index) => {
      label.append("tspan")
        .attr("x", 0)
        .attr("dy", index === 0 ? 22 : 13)
        .text(line);
    });
    d3.select(this).append("text")
      .attr("class", "dag-code")
      .attr("text-anchor", "middle")
      .attr("dy", 22 + lines.length * 13)
      .text(item.id);
  });

  return { link, node, width: innerWidth, height };
}

/**
 * Dendrogram. It opens with the root at the bottom, the same way the 2013
 * cluster layout drew it (`treeHeight - d.y`). Rotate tree turns that
 * arrangement 90 degrees at a time. Labels stay horizontal.
 */
const TREE_LABEL_FONT = "600 11px \"Source Sans 3\", \"Segoe UI\", sans-serif";
let labelMeasure;

function treeLabel(name) {
  const text = name || "";
  return text.length > 20 ? `${text.slice(0, 19)}…` : text;
}

function treeLabelWidth(text) {
  if (!labelMeasure && typeof document !== "undefined") {
    labelMeasure = document.createElement("canvas").getContext("2d");
  }
  if (!labelMeasure) return Math.max(16, text.length * 6);
  labelMeasure.font = TREE_LABEL_FONT;
  return Math.max(16, labelMeasure.measureText(text).width);
}

function layoutSideways(root, rootAt) {
  d3.cluster().nodeSize([22, 1]).separation(() => 1)(root);
  const maxDepth = root.height;
  const widest = Array.from({ length: maxDepth + 1 }, () => 36);
  root.each((node) => {
    widest[node.depth] = Math.max(widest[node.depth], node.labelWidth);
  });
  const xAt = [];
  let cursor = 18;
  if (rootAt === "right") {
    for (let depth = maxDepth; depth >= 0; depth -= 1) {
      xAt[depth] = cursor + widest[depth];
      cursor = xAt[depth] + 30;
    }
  } else {
    for (let depth = 0; depth <= maxDepth; depth += 1) {
      xAt[depth] = cursor;
      cursor += widest[depth] + 30;
    }
  }
  let minBreadth = Infinity;
  root.each((node) => { minBreadth = Math.min(minBreadth, node.x); });
  const leavesFirst = rootAt === "right";
  return {
    xOf: (node) => xAt[node.depth],
    yOf: (node) => 16 + (node.x - minBreadth),
    labelAnchor: leavesFirst ? "end" : "start",
    labelX: leavesFirst ? -12 : 12,
    labelDy: "0.32em",
    toggleX: leavesFirst ? 14 : -14,
    diagonal: d3.linkHorizontal().x((point) => point.x).y((point) => point.y),
  };
}

function layoutUpright(root, rootAt) {
  const labelGap = 6;
  const depthGap = 34;
  d3.cluster().nodeSize([1, depthGap]).separation((a, b) => (a.labelWidth + b.labelWidth) / 2 + labelGap)(root);
  const depths = d3.groups(root.descendants(), (node) => node.depth)
    .sort((a, b) => b[0] - a[0]);
  function shiftSubtree(node, delta) {
    node.each((item) => {
      item.x += delta;
    });
  }
  function extent(node) {
    let min = node.x - node.labelWidth / 2;
    let max = node.x + node.labelWidth / 2;
    node.each((item) => {
      min = Math.min(min, item.x - item.labelWidth / 2);
      max = Math.max(max, item.x + item.labelWidth / 2);
    });
    return [min, max];
  }
  for (const [, row] of depths) {
    row.sort((a, b) => a.x - b.x);
    for (const node of row) {
      if (!node.children?.length) continue;
      const xs = node.children.map((child) => child.x);
      node.x = (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    let edge = -Infinity;
    for (const node of row) {
      const [min] = extent(node);
      if (min < edge + labelGap) shiftSubtree(node, edge + labelGap - min);
      edge = extent(node)[1];
    }
  }
  let x0 = Infinity;
  let y1 = 0;
  root.each((node) => {
    x0 = Math.min(x0, node.x - node.labelWidth / 2);
    if (node.y > y1) y1 = node.y;
  });
  const padTop = 16;
  const padX = 8;
  const rootAtBottom = rootAt === "bottom";
  return {
    xOf: (node) => node.x + (padX - x0),
    yOf: (node) => (rootAtBottom ? padTop + (y1 - node.y) : padTop + node.y),
    labelAnchor: "middle",
    labelX: 0,
    labelDy: rootAtBottom ? -13 : 16,
    toggleX: -14,
    diagonal: d3.linkVertical().x((point) => point.x).y((point) => point.y),
  };
}

export function renderTemplateTree(svgSelection, rootData, { selectedId, activeIds, colorFor, onSelect, onToggle, onHover, direction = "bottom", side = false } = {}) {
  const svg = d3.select(svgSelection);
  clear(svg);
  graphZoom(svgSelection);
  installCategoryPatterns(svgSelection);
  if (!rootData) {
    svg.attr("width", "100%").attr("height", "100%");
    return;
  }
  const root = d3.hierarchy(rootData, (node) => (node.open === false ? null : node.children));
  root.each((node) => {
    node.label = treeLabel(node.data.name || "");
    node.labelWidth = treeLabelWidth(node.label);
  });
  // Clockwise from the opening view: root at the bottom, then the left, the
  // top, then the right. Labels stay horizontal in every direction.
  const facing = ["bottom", "left", "top", "right"].includes(direction)
    ? direction
    : (side ? "right" : "bottom");
  const placed = facing === "left" || facing === "right"
    ? layoutSideways(root, facing)
    : layoutUpright(root, facing);
  const { xOf, yOf, labelAnchor, labelX, labelDy, toggleX, diagonal } = placed;
  const host = svg.node()?.parentElement;
  const viewW = Math.max(280, host?.clientWidth || 640);
  const viewH = Math.max(140, host?.clientHeight || 320);
  svg.attr("width", viewW).attr("height", viewH).attr("viewBox", `0 0 ${viewW} ${viewH}`);
  const plot = zoomLayer(svg).append("g");
  const active = activeIds instanceof Set ? activeIds : new Set(activeIds || []);

  plot.append("g")
    .selectAll("path")
    .data(root.links())
    .join("path")
    .attr("class", "tree-link")
    .attr("d", (link) => diagonal({
      source: { x: xOf(link.source), y: yOf(link.source) },
      target: { x: xOf(link.target), y: yOf(link.target) },
    }));

  const node = plot.append("g")
    .selectAll("g")
    .data(root.descendants())
    .join("g")
    .attr("class", (item) => {
      const data = item.data;
      const classes = ["tpl-node", `rm-${data.rmType || "other"}`];
      if (data.id === selectedId) classes.push("is-selected");
      if (active.has(data.id)) classes.push("is-on");
      if (data.valueListItem) classes.push("is-value");
      if (data.valueMapped) classes.push("is-mapped");
      if (data.suggestions?.length) classes.push("has-suggestions");
      const bound = [...(data.bindings || []), ...(data.valueBindings || []), ...(data.scopeBindings || [])];
      if (bound.some((binding) => binding.status === "missing-from-opt")) {
        classes.push("has-enriched");
      } else if (bound.length) classes.push("has-binding");
      return classes.join(" ");
    })
    .attr("data-id", (item) => item.data.id)
    .attr("transform", (item) => `translate(${xOf(item)},${yOf(item)})`);

  node.append("title").text((item) => item.data.name || "");

  node.filter((item) => onToggle && item.data.children?.length)
    .append("text")
    .attr("class", "tree-toggle")
    .attr("x", toggleX)
    .attr("dy", "0.35em")
    .attr("text-anchor", "middle")
    .text((item) => (item.children ? "−" : "+"))
    .on("click", (event, item) => {
      event.stopPropagation();
      onToggle?.(item.data);
    });

  node.append("circle")
    .attr("r", (item) => {
      if (item.data.suggestions?.length) return 8;
      if (active.has(item.data.id)) return 6.5;
      return 4.2;
    })
    .each(function paint(item) {
      const paint = colorFor?.(item.data);
      if (!paint) return;
      const color = typeof paint === "string" ? paint : paint.color;
      const fill = typeof paint === "string" ? paint : (paint.fill || color);
      const stroke = typeof paint === "string" ? inkOf(paint) : (paint.stroke || inkOf(color));
      d3.select(this).style("fill", fill).style("stroke", stroke);
    });

  for (const kind of ["shadow", "ink"]) {
    node.append("text")
      .attr("class", `tree-label ${kind}`)
      .attr("text-anchor", labelAnchor)
      .attr("x", labelX)
      .attr("dy", labelDy)
      .text((item) => item.label);
  }
  node.append("circle")
    .attr("class", "node-hit")
    .attr("r", (item) => {
      if (item.data.suggestions?.length) return 8;
      if (active.has(item.data.id)) return 6.5;
      return 4.2;
    });

  node.on("click", (event, item) => {
    event.stopPropagation();
    onSelect?.(item.data);
  });
  node.on("mouseenter", (event, item) => onHover?.(item.data, true));
  node.on("mouseleave", (event, item) => onHover?.(item.data, false));

  const selected = root.descendants().find((item) => item.data.id === selectedId);
  return { width: viewW, height: viewH, selected };
}

/**
 * Force-directed is-a graph, in the 2013 style: SNOMED is a DAG, labels
 * stay quiet until hover or until a concept is shared, and hovering a
 * node pushes its parents and children apart.
 */
export function renderSnomedForce(svgSelection, graph, { onTick, onSelect, onLinger, pins, released, onPinMove, labels, labelHidden } = {}) {
  const svg = d3.select(svgSelection);
  clear(svg);
  svg.classed("is-tangled", false);
  svg.classed("is-sugiyama", false);
  graphZoom(svgSelection);
  installCategoryPatterns(svgSelection);
  const host = svg.node()?.parentElement;
  const width = Math.max(320, host?.clientWidth || 640);
  const height = Math.max(260, host?.clientHeight || 360);
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  const nodes = (graph?.nodes || []).map((node) => ({ ...node, hoover_doi: 0, incoming: [], outgoing: [] }));
  if (!nodes.length) {
    onTick?.();
    return null;
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const links = (graph.links || [])
    .map((link) => ({
      source: byId.get(String(link.source)),
      target: byId.get(String(link.target)),
      hoover_doi: 0,
    }))
    .filter((link) => link.source && link.target);
  for (const link of links) {
    link.target.incoming.push(link);
    link.source.outgoing.push(link);
  }

  const defs = svg.append("defs");
  defs.append("marker")
    .attr("id", "snomed-isa")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 14)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5Z")
    .attr("class", "force-arrow");

  const layer = zoomLayer(svg);
  const link = layer.append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "force-link")
    .attr("marker-end", "url(#snomed-isa)");

  const pinOf = pins instanceof Map ? pins : new Map();
  const releasedSet = released instanceof Set ? released : new Set();
  const labelSet = labels instanceof Set ? labels : new Set();
  const labelOff = labelHidden instanceof Set ? labelHidden : new Set();
    const rootY = height / 2;
    const arcRadius = Math.min(200, Math.max(120, Math.min(width, height) * 0.32));

  const tops = nodes.filter((item) => item.outgoing.length === 0);
  const topSet = new Set(tops);
  const firstLevel = nodes
    .filter((item) => !topSet.has(item) && item.outgoing.some((edge) => topSet.has(edge.target)))
    .sort((a, b) => visibleName(a).localeCompare(visibleName(b)));

  function place(item, x, y, { pinned, auto, fixed }) {
    item.fx = x;
    item.fy = y;
    item.x = x;
    item.y = y;
    item.userPinned = pinned;
    item.autoPin = auto;
    item.layoutFixed = fixed;
    if (fixed) {
      item.homeX = x;
      item.homeY = y;
    }
    if (pinned) onPinMove?.(item);
  }

  tops.forEach((item, index) => {
    const id = String(item.id);
    const pin = pinOf.get(id);
    if (releasedSet.has(id)) return;
    if (pin && !pin.auto) {
      place(item, pin.x, pin.y, { pinned: true, auto: false, fixed: false });
      return;
    }
    place(item, width / 2 + (index - (tops.length - 1) / 2) * 100, rootY, { pinned: false, auto: false, fixed: true });
  });

  const elasticByParent = new Map();
  for (const item of firstLevel) {
    const id = String(item.id);
    if (releasedSet.has(id)) continue;
    const pin = pinOf.get(id);
    if (pin && !pin.auto) {
      place(item, pin.x, pin.y, { pinned: true, auto: false, fixed: false });
      continue;
    }
    const parent = item.outgoing.find((edge) => topSet.has(edge.target))?.target;
    const list = elasticByParent.get(parent) || [];
    list.push(item);
    elasticByParent.set(parent, list);
  }
  for (const [parent, children] of elasticByParent) {
    const cx = parent?.x ?? width / 2;
    const cy = parent?.y ?? rootY;
    const room = Math.min(cx - 28, width - cx - 28, height - cy - 40);
    const radius = Math.min(arcRadius, Math.max(110, room));
    const count = children.length;
    children.forEach((item, index) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
      place(
        item,
        cx + radius * Math.cos(angle),
        cy + radius * Math.sin(angle),
        { pinned: true, auto: true, fixed: false },
      );
    });
  }

  for (const item of nodes) {
    if (item.userPinned || item.layoutFixed) continue;
    const id = String(item.id);
    const pin = pinOf.get(id);
    if (!pin || pin.auto || releasedSet.has(id)) continue;
    place(item, pin.x, pin.y, { pinned: true, auto: false, fixed: false });
  }

  for (const item of [...tops, ...firstLevel]) {
    const id = String(item.id);
    if (labelOff.has(id)) item.showLabel = false;
    else {
      labelSet.add(id);
      item.showLabel = true;
    }
  }
  for (const item of nodes) {
    const id = String(item.id);
    if (labelOff.has(id)) {
      item.showLabel = false;
      item.labelOff = true;
    } else if (labelSet.has(id)) item.showLabel = true;
  }

  const node = layer.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", (item) => {
      const classes = ["force-node"];
      if (item.suggestion) classes.push("is-suggestion");
      if (item.cp) classes.push("is-cp");
      if (item.lcp) classes.push("is-lcp");
      if (item.inactive) classes.push("is-inactive");
      if (item.userPinned) classes.push("is-user-pinned");
      if (item.showLabel) classes.push("is-labeled");
      if (item.labelOff) classes.push("is-label-off");
      return classes.join(" ");
    })
    .attr("data-id", (item) => item.id);

  const sliceArc = d3.arc().innerRadius(0).outerRadius(8);
  node.each(function paint(item) {
    const host = d3.select(this);
    const slices = item.sliceFills || [];
    if (slices.length > 1) {
      const pie = d3.pie().sort(null).value(() => 1)(slices);
      host.append("g")
        .attr("class", "node-slices")
        .selectAll("path")
        .data(pie)
        .join("path")
        .attr("d", sliceArc)
        .style("fill", (slice) => slice.data);
    }
    host.append("circle")
      .attr("class", "node-disk")
      .attr("r", 8)
      .attr("fill-opacity", item.fillOpacity ?? 1)
      .attr("stroke-width", slices.length > 1 ? 2.5 : 1.6)
      .style("fill", slices.length > 1 ? "none" : (item.fill || "#ffffff"))
      .style("stroke", item.stroke || "#4682b4");
  });
  node.append("circle")
    .attr("class", "pin-dot")
    .attr("r", 2.3);

  node.each(function label(item) {
    const lines = wrapLabel(visibleName(item), 24);
    const group = d3.select(this);
    for (const kind of ["shadow", "ink"]) {
      const text = group.append("text").attr("class", `force-label ${kind}`).attr("text-anchor", "middle");
      lines.forEach((line, index) => {
        text.append("tspan").attr("x", 0).attr("dy", index === 0 ? -14 : 13).text(line);
      });
    }
  });
  node.append("circle")
    .attr("class", "node-hit")
    .attr("r", 8);

  let hoverHold = null;
  function releaseHoverHold() {
    const item = hoverHold;
    if (!item) return;
    hoverHold = null;
    if (item.dragging || item.userPinned || item.layoutFixed) return;
    item.fx = item.hoverFx ?? null;
    item.fy = item.hoverFy ?? null;
  }
  function holdHover(item) {
    if (!item || item.userPinned || item.layoutFixed) return;
    hoverHold = item;
    item.hoverFx = item.fx ?? null;
    item.hoverFy = item.fy ?? null;
    item.fx = item.x;
    item.fy = item.y;
  }

  function paintHover(activeNode, activeLink) {
    releaseHoverHold();
    node.classed("is-active", false).classed("is-incoming", false).classed("is-outgoing", false);
    link.classed("is-active", false).classed("is-incoming", false).classed("is-outgoing", false);
    if (activeNode) {
      node.filter((item) => item === activeNode).classed("is-active", true);
      for (const edge of activeNode.incoming) {
        link.filter((item) => item === edge).classed("is-incoming", true);
        node.filter((item) => item === edge.source).classed("is-incoming", true);
      }
      for (const edge of activeNode.outgoing) {
        link.filter((item) => item === edge).classed("is-outgoing", true);
        node.filter((item) => item === edge.target).classed("is-outgoing", true);
      }
      holdHover(activeNode);
    }
    if (activeLink) {
      link.filter((item) => item === activeLink).classed("is-active", true);
      node.filter((item) => item === activeLink.source).classed("is-incoming", true);
      node.filter((item) => item === activeLink.target).classed("is-outgoing", true);
    }
  }

  let lingerTimer = 0;
  let lingerItem = null;
  let lingerPoint = null;
  function clearLinger() {
    window.clearTimeout(lingerTimer);
    lingerTimer = 0;
    lingerItem = null;
    lingerPoint = null;
  }
  function armLinger(item, point) {
    if (lingerItem === item && lingerTimer) return;
    window.clearTimeout(lingerTimer);
    lingerItem = item;
    lingerPoint = point;
    lingerTimer = window.setTimeout(() => {
      lingerTimer = 0;
      onLinger?.(item);
    }, 1000);
  }

  node
    .on("mouseover", (event, item) => paintHover(item, null))
    .on("mouseout", (event) => {
      if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
      paintHover(null, null);
    })
    .on("pointerdown", (event, item) => {
      if (event.pointerType !== "touch") return;
      armLinger(item, { x: event.clientX, y: event.clientY });
    })
    .on("pointermove", (event) => {
      if (!lingerPoint || !lingerTimer) return;
      if (Math.hypot(event.clientX - lingerPoint.x, event.clientY - lingerPoint.y) > 8) clearLinger();
    })
    .on("pointerup", () => clearLinger())
    .on("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      clearLinger();
    })
    .on("pointercancel", () => clearLinger())
    .on("contextmenu", (event) => event.preventDefault())
    .on("click", (event, item) => {
      event.stopPropagation();
      onSelect?.(item);
    })
    .call(d3.drag()
      .on("start", (event, item) => {
        clearLinger();
        if (!event.active) simulation.alphaTarget(0.3).restart();
        item.dragging = true;
        item.fx = item.x;
        item.fy = item.y;
        item.dragOrigin = { x: item.x, y: item.y };
      })
      .on("drag", (event, item) => {
        item.fx = event.x;
        item.fy = event.y;
      })
      .on("end", (event, item) => {
        if (!event.active) simulation.alphaTarget(0);
        item.dragging = false;
        if (hoverHold === item) hoverHold = null;
        const moved = Math.hypot((item.x ?? 0) - (item.dragOrigin?.x ?? item.x), (item.y ?? 0) - (item.dragOrigin?.y ?? item.y)) > 4;
        if (item.userPinned) {
          if (moved) item.autoPin = false;
          onPinMove?.(item);
        } else if (item.layoutFixed) {
          item.fx = item.homeX;
          item.fy = item.homeY;
        } else {
          item.fx = null;
          item.fy = null;
        }
      }));

  link
    .on("mouseover", (event, item) => paintHover(null, item))
    .on("mouseout", () => paintHover(null, null));

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).distance((edge) => (edge.target.layoutFixed ? 80 : 52)).strength(0.85))
    .force("charge", d3.forceManyBody().strength(REST_CHARGE))
    .force("x", d3.forceX(width / 2).strength((item) => (item.layoutFixed || item.userPinned ? 0 : 0.04)))
    .force("y", d3.forceY(height / 2).strength(0))
    .force("collide", d3.forceCollide(18))
    .force("cap", () => {
      const maxLength = 140;
      for (const edge of links) {
        const a = edge.source;
        const b = edge.target;
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const dist = Math.hypot(dx, dy) || 1;
        if (dist <= maxLength) continue;
        const aLocked = a.fx != null && a.fy != null;
        const bLocked = b.fx != null && b.fy != null;
        if (aLocked && bLocked) continue;
        const extra = dist - maxLength;
        const ux = dx / dist;
        const uy = dy / dist;
        if (!aLocked && !bLocked) {
          a.x += ux * extra / 2;
          a.y += uy * extra / 2;
          b.x -= ux * extra / 2;
          b.y -= uy * extra / 2;
        } else if (aLocked) {
          b.x -= ux * extra;
          b.y -= uy * extra;
        } else {
          a.x += ux * extra;
          a.y += uy * extra;
        }
      }
    })
    .on("tick", () => {
      link
        .attr("x1", (item) => item.source.x)
        .attr("y1", (item) => item.source.y)
        .attr("x2", (item) => item.target.x)
        .attr("y2", (item) => item.target.y);
      node.attr("transform", (item) => `translate(${item.x},${item.y})`);
      onTick?.();
    });
  svg.node().__termvizSimulation = simulation;
  return { simulation };
}

/**
 * Left-to-right tangled tree for a DAG. The curve routing follows
 * Matteo Abrate's tangled-tree layout (MIT), as published by Takanori Fujiwara.
 */
function constructTangleLayout(levels, {
  nodeWidth = 168,
  nodeHeight = 36,
  padding = 18,
  bundleWidth = 16,
  metroD = 5,
  minFamilyHeight = 18,
  c = 16,
} = {}) {
  const bigc = nodeWidth + c;
  levels.forEach((level, index) => level.forEach((node) => { node.level = index; }));
  const nodes = levels.flat();
  const nodesIndex = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    node.parents = (node.parents || []).map((id) => nodesIndex.get(id)).filter(Boolean);
  }

  for (const [index, level] of levels.entries()) {
    const bundles = new Map();
    for (const node of level) {
      if (!node.parents.length) continue;
      const id = node.parents.map((parent) => parent.id).sort().join("-X-");
      let bundle = bundles.get(id);
      if (!bundle) {
        bundle = {
          id,
          parents: node.parents.slice(),
          level: index,
          span: index - Math.min(...node.parents.map((parent) => parent.level)),
        };
        bundles.set(id, bundle);
      }
      node.bundle = bundle;
    }
    level.bundles = [...bundles.values()];
    level.bundles.forEach((bundle, bundleIndex) => { bundle.i = bundleIndex; });
  }

  const links = [];
  for (const node of nodes) {
    for (const parent of node.parents) {
      links.push({ source: node, bundle: node.bundle, target: parent });
    }
  }
  const bundles = levels.flatMap((level) => level.bundles);
  for (const bundle of bundles) {
    for (const parent of bundle.parents) {
      parent.bundlesIndex = parent.bundlesIndex || {};
      parent.bundlesIndex[bundle.id] = parent.bundlesIndex[bundle.id] || [];
      parent.bundlesIndex[bundle.id].push(bundle);
    }
  }
  for (const node of nodes) {
    node.bundles = Object.values(node.bundlesIndex || {});
    node.bundles.sort((a, b) => d3.descending(d3.max(a, (bundle) => bundle.span), d3.max(b, (bundle) => bundle.span)));
    node.bundles.forEach((bundle, index) => { bundle.i = index; });
    node.height = Math.max(0, node.bundles.length - 1) * metroD;
  }
  for (const link of links) {
    link.bundle.links = link.bundle.links || [];
    link.bundle.links.push(link);
  }

  let xOffset = padding;
  let yOffset = padding;
  for (const level of levels) {
    xOffset += level.bundles.length * bundleWidth;
    for (const node of level) {
      node.x = node.level * nodeWidth + xOffset;
      node.y = nodeHeight + yOffset + node.height / 2;
      yOffset += nodeHeight + node.height + (node.extra || 0);
    }
  }

  let totalLength = 0;
  for (const level of levels) {
    for (const bundle of level.bundles) {
      bundle.x = d3.max(bundle.parents, (parent) => parent.x) + nodeWidth + (level.bundles.length - 1 - bundle.i) * bundleWidth;
      bundle.y = totalLength * nodeHeight;
    }
    totalLength += level.length;
  }

  for (const link of links) {
    const group = link.target.bundlesIndex[link.bundle.id];
    link.xt = link.target.x;
    link.yt = link.target.y + group.i * metroD - (link.target.bundles.length * metroD) / 2 + metroD / 2;
    link.xb = link.bundle.x;
    link.yb = link.bundle.y;
    link.xs = link.source.x;
    link.ys = link.source.y;
  }

  let yNegativeOffset = 0;
  for (const level of levels) {
    const slack = d3.min(level.bundles, (bundle) => d3.min(bundle.links, (link) => link.ys - 2 * c - (link.yt + c)));
    yNegativeOffset += -minFamilyHeight + (slack || 0);
    for (const node of level) node.y -= yNegativeOffset;
  }
  for (const link of links) {
    const group = link.target.bundlesIndex[link.bundle.id];
    link.yt = link.target.y + group.i * metroD - (link.target.bundles.length * metroD) / 2 + metroD / 2;
    link.ys = link.source.y;
    link.c1 = link.source.level - link.target.level > 1
      ? Math.max(8, Math.min(bigc, link.xb - link.xt, link.yb - link.yt) - c)
      : c;
    link.c2 = c;
  }

  const minX = d3.min(nodes, (node) => node.x) ?? padding;
  const minY = d3.min(nodes, (node) => node.y) ?? padding;
  const dx = padding - minX;
  const dy = padding - minY;
  for (const node of nodes) {
    node.x += dx;
    node.y += dy;
  }
  for (const link of links) {
    link.xt += dx;
    link.yt += dy;
    link.xb += dx;
    link.yb += dy;
    link.xs += dx;
    link.ys += dy;
  }
  return { nodes, links };
}

function tanglePath(link) {
  const { xt, yt, xb, yb, xs, ys, c1, c2 } = link;
  return `M${xs} ${ys} L${xb + c2} ${ys} A${c2} ${c2} 90 0 1 ${xb} ${ys - c2} L${xb} ${yt + c1} A${c1} ${c1} 90 0 0 ${xb - c1} ${yt} L${xt} ${yt}`;
}

export function renderSnomedTangled(svgSelection, graph, { onSelect, onLinger, labelHidden } = {}) {
  const svg = d3.select(svgSelection);
  clear(svg);
  svg.classed("is-tangled", true);
  svg.classed("is-sugiyama", false);
  graphZoom(svgSelection);
  installCategoryPatterns(svgSelection);
  const host = svg.node()?.parentElement;
  const width = Math.max(320, host?.clientWidth || 640);
  const height = Math.max(260, host?.clientHeight || 360);
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  const nodes = (graph?.nodes || []).map((node) => ({ ...node, incoming: [], outgoing: [] }));
  if (!nodes.length) return null;
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const links = (graph.links || [])
    .map((link) => ({
      source: byId.get(String(link.source?.id ?? link.source)),
      target: byId.get(String(link.target?.id ?? link.target)),
    }))
    .filter((link) => link.source && link.target);
  for (const link of links) {
    link.target.incoming.push(link);
    link.source.outgoing.push(link);
  }

  const depthOf = new Map();
  function depth(id, seen) {
    if (depthOf.has(id)) return depthOf.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = (byId.get(id)?.outgoing || []).map((edge) => String(edge.target.id));
    const value = parents.length ? 1 + Math.max(...parents.map((parent) => depth(parent, seen))) : 0;
    depthOf.set(id, value);
    return value;
  }
  for (const node of nodes) depth(String(node.id), new Set());
  const levelCount = Math.max(0, ...depthOf.values()) + 1;
  const levels = Array.from({ length: levelCount }, () => []);
  const ordered = [...nodes].sort((a, b) => visibleName(a).localeCompare(visibleName(b)) || String(a.id).localeCompare(String(b.id)));
  for (const node of ordered) {
    levels[depthOf.get(String(node.id))].push({
      id: String(node.id),
      parents: node.outgoing.map((edge) => String(edge.target.id)),
    });
  }
  const tangleColumn = 142;
  const measurer = labelMeasurer(svg.node());
  const tangleLabelMax = tangleColumn - 28;
  const labelBox = new Map(nodes.map((node) => {
    const measure = (text) => measurer.measure(text, {
      fontSize: "13px",
      fontWeight: node.lcp ? "700" : "400",
    });
    const lines = wrapToWidth(visibleName(node), tangleLabelMax, measure);
    const width = Math.max(...lines.map((line) => measure(line)), 0);
    const count = lines.length;
    const last = count <= 1 ? 4 : -7 + 14 * (count - 1);
    return [String(node.id), {
      lines: count,
      width,
      above: count <= 1 ? 11 : 22,
      below: last + 8,
    }];
  }));
  for (const level of levels) {
    for (const entry of level) {
      const box = labelBox.get(entry.id);
      entry.extra = Math.max(0, (box?.below || 0) + (box?.above || 0) - 22);
    }
  }
  const layout = constructTangleLayout(levels, {
    nodeWidth: tangleColumn,
    nodeHeight: 22,
    padding: 10,
    bundleWidth: 12,
    metroD: 4,
    minFamilyHeight: 10,
    c: 11,
  });
  const placed = new Map(layout.nodes.map((node) => [node.id, node]));
  const stacked = [...layout.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  const push = new Map();
  const overlapsX = (a, b) => {
    const aw = labelBox.get(a.id)?.width || 0;
    const bw = labelBox.get(b.id)?.width || 0;
    const aLeft = a.x - 7;
    const aRight = a.x + 12 + aw;
    const bLeft = b.x - 7;
    const bRight = b.x + 12 + bw;
    return aLeft < bRight + 3 && bLeft < aRight + 3;
  };
  for (const node of stacked) {
    let y = node.y;
    for (const earlier of stacked) {
      if (earlier === node) break;
      const py = earlier.y + (push.get(earlier.id) || 0);
      if (y - py > 48 || !overlapsX(earlier, node)) continue;
      const need = (labelBox.get(earlier.id)?.below || 11) + (labelBox.get(node.id)?.above || 11) + 3;
      if (y < py + need) y = py + need;
    }
    push.set(node.id, y - node.y);
  }
  for (const node of layout.nodes) node.y += push.get(node.id) || 0;
  for (const link of layout.links) {
    link.ys += push.get(link.source.id) || 0;
    link.yt += push.get(link.target.id) || 0;
  }
  for (const node of nodes) {
    const at = placed.get(String(node.id));
    node.x = at?.x ?? 0;
    node.y = at?.y ?? 0;
  }
  const geometry = new Map(layout.links.map((link) => [`${link.source.id}|${link.target.id}`, link]));
  for (const link of links) link.geom = geometry.get(`${link.source.id}|${link.target.id}`);

  const labelOff = labelHidden instanceof Set ? labelHidden : new Set();
  for (const item of nodes) {
    const id = String(item.id);
    if (labelOff.has(id)) {
      item.showLabel = false;
      item.labelOff = true;
    } else item.showLabel = true;
  }

  const defs = svg.append("defs");
  defs.append("marker")
    .attr("id", "snomed-isa")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 12)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5Z")
    .attr("class", "force-arrow");

  const layer = zoomLayer(svg);
  const drawn = links.filter((link) => link.geom);
  const linkWrap = layer.append("g")
    .attr("class", "tangle-links")
    .selectAll("g")
    .data(drawn)
    .join("g");
  linkWrap.append("path")
    .attr("class", "tangle-halo")
    .attr("d", (item) => tanglePath(item.geom));
  const link = linkWrap.append("path")
    .attr("class", "force-link tangle-link")
    .attr("marker-end", "url(#snomed-isa)")
    .attr("d", (item) => tanglePath(item.geom));

  const radius = 7;
  const node = layer.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", (item) => {
      const classes = ["force-node"];
      if (item.suggestion) classes.push("is-suggestion");
      if (item.cp) classes.push("is-cp");
      if (item.lcp) classes.push("is-lcp");
      if (item.inactive) classes.push("is-inactive");
      if (item.showLabel) classes.push("is-labeled");
      if (item.labelOff) classes.push("is-label-off");
      return classes.join(" ");
    })
    .attr("data-id", (item) => item.id)
    .attr("transform", (item) => `translate(${item.x},${item.y})`);

  const sliceArc = d3.arc().innerRadius(0).outerRadius(radius);
  node.each(function paint(item) {
    const host = d3.select(this);
    const slices = item.sliceFills || [];
    if (slices.length > 1) {
      const pie = d3.pie().sort(null).value(() => 1)(slices);
      host.append("g")
        .attr("class", "node-slices")
        .selectAll("path")
        .data(pie)
        .join("path")
        .attr("d", sliceArc)
        .style("fill", (slice) => slice.data);
    }
    host.append("circle")
      .attr("class", "node-disk")
      .attr("r", radius)
      .style("fill", slices.length > 1 ? "none" : (item.fill || "#ffffff"))
      .style("stroke", item.stroke || "#4682b4");
  });
  node.each(function label(item) {
    const lines = wrapToWidth(visibleName(item), tangleLabelMax, (text) => measurer.measure(text, { fontSize: "13px" }));
    const group = d3.select(this);
    for (const kind of ["shadow", "ink"]) {
      const text = group.append("text").attr("class", `force-label ${kind}`).attr("text-anchor", "start");
      lines.forEach((line, index) => {
        const dy = lines.length === 1 ? "0.32em" : (index === 0 ? -7 : 14);
        text.append("tspan").attr("x", radius + 5).attr("dy", dy).text(line);
      });
    }
  });
  measurer.remove();
  node.append("circle").attr("class", "node-hit").attr("r", radius + 2);

  function walk(start, direction, nodesOut, linksOut) {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const current = stack.pop();
      const edges = direction === "up" ? current.outgoing : current.incoming;
      for (const edge of edges || []) {
        linksOut.add(edge);
        const next = direction === "up" ? edge.target : edge.source;
        if (!next || seen.has(next)) continue;
        seen.add(next);
        nodesOut.add(next);
        stack.push(next);
      }
    }
  }

  function paintHover(activeNode, activeLink) {
    node.classed("is-active", false).classed("is-incoming", false).classed("is-outgoing", false);
    link.classed("is-active", false).classed("is-incoming", false).classed("is-outgoing", false).classed("is-bold", false);
    linkWrap.classed("is-raised", false);
    const upNodes = new Set();
    const downNodes = new Set();
    const upLinks = new Set();
    const downLinks = new Set();
    if (activeNode) {
      node.filter((item) => item === activeNode).classed("is-active", true);
      walk(activeNode, "up", upNodes, upLinks);
      walk(activeNode, "down", downNodes, downLinks);
    } else if (activeLink) {
      upLinks.add(activeLink);
      if (activeLink.target) walk(activeLink.target, "up", upNodes, upLinks);
      if (activeLink.source) walk(activeLink.source, "down", downNodes, downLinks);
      upNodes.add(activeLink.target);
      downNodes.add(activeLink.source);
    }
    node.filter((item) => upNodes.has(item)).classed("is-outgoing", true);
    node.filter((item) => downNodes.has(item)).classed("is-incoming", true);
    link.filter((item) => upLinks.has(item)).classed("is-outgoing", true).classed("is-bold", true);
    link.filter((item) => downLinks.has(item)).classed("is-incoming", true).classed("is-bold", true);
    const raised = new Set([...upLinks, ...downLinks]);
    linkWrap.classed("is-raised", (item) => raised.has(item));
    const host = linkWrap.node()?.parentNode;
    if (host) {
      linkWrap.each(function restore() { host.appendChild(this); });
      linkWrap.filter((item) => raised.has(item)).each(function raise() { host.appendChild(this); });
    }
  }

  let lingerTimer = 0;
  let lingerItem = null;
  let lingerPoint = null;
  function clearLinger() {
    window.clearTimeout(lingerTimer);
    lingerTimer = 0;
    lingerItem = null;
    lingerPoint = null;
  }
  function armLinger(item, point) {
    if (lingerItem === item && lingerTimer) return;
    window.clearTimeout(lingerTimer);
    lingerItem = item;
    lingerPoint = point;
    lingerTimer = window.setTimeout(() => {
      lingerTimer = 0;
      onLinger?.(item);
    }, 1000);
  }

  node
    .on("mouseover", (event, item) => paintHover(item, null))
    .on("mouseout", (event) => {
      if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
      paintHover(null, null);
    })
    .on("pointerdown", (event, item) => {
      if (event.pointerType !== "touch") return;
      armLinger(item, { x: event.clientX, y: event.clientY });
    })
    .on("pointermove", (event) => {
      if (!lingerPoint || !lingerTimer) return;
      if (Math.hypot(event.clientX - lingerPoint.x, event.clientY - lingerPoint.y) > 8) clearLinger();
    })
    .on("pointerup", () => clearLinger())
    .on("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      clearLinger();
    })
    .on("pointercancel", () => clearLinger())
    .on("contextmenu", (event) => event.preventDefault())
    .on("click", (event, item) => {
      event.stopPropagation();
      onSelect?.(item);
    });
  link
    .on("mouseover", (event, item) => paintHover(null, item))
    .on("mouseout", () => paintHover(null, null));
  return null;
}

const SUGIYAMA_LABEL_MAX = 92;
const SUGIYAMA_LINE = 13;
const SUGIYAMA_DISK = 20;

function wrapToWidth(name, maxWidth, measure) {
  const words = String(name || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next) > maxWidth) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

function labelMeasurer(svgNode) {
  const probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
  probe.style.display = "inline";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  const font = getComputedStyle(svgNode).fontFamily;
  svgNode.appendChild(probe);
  return {
    measure(text, { lcp = false, fontSize, fontWeight } = {}) {
      probe.style.fontFamily = font;
      probe.style.fontSize = fontSize || (lcp ? "13px" : "11px");
      probe.style.fontWeight = fontWeight || (lcp ? "700" : "400");
      probe.textContent = text;
      return probe.getComputedTextLength();
    },
    remove() {
      probe.remove();
    },
  };
}

function layoutSugiyama(pairs, nodeSize, gap) {
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

function sugiyamaPath(points) {
  if (!points || points.length < 2) return "";
  return d3.line().curve(d3.curveBumpY)(points.slice().reverse());
}

let sugiyamaMemory = null;

function sugiyamaIds(nodes) {
  return nodes.map((node) => String(node.id)).sort().join("|");
}

function rememberSugiyama(nodes, links, maxLines) {
  sugiyamaMemory = {
    ids: sugiyamaIds(nodes),
    pos: new Map(nodes.map((node) => [String(node.id), { x: node.x, y: node.y }])),
    width: new Map(nodes.map((node) => [String(node.id), node.layoutWidth ?? SUGIYAMA_DISK])),
    maxLines,
    points: new Map(links.filter((link) => link.points).map((link) => [
      `${link.source.id}|${link.target.id}`,
      link.points.map((point) => [...point]),
    ])),
  };
}

/**
 * Keep the current order and only open or close space for a label.
 * The concept that changed stays put. Neighbours on its rank slide
 * just far enough for the new width, half to each side.
 */
function adjustSugiyama(nodes, links, maxLines) {
  const memory = sugiyamaMemory;
  const ranks = new Map();
  for (const node of nodes) {
    const at = memory.pos.get(String(node.id));
    node.x = at.x;
    node.y = at.y;
    const key = Math.round(at.y);
    const rank = ranks.get(key) || [];
    rank.push(node);
    ranks.set(key, rank);
  }
  const dx = new Map(nodes.map((node) => [String(node.id), 0]));
  const dy = new Map(nodes.map((node) => [String(node.id), 0]));
  for (const node of nodes) {
    const id = String(node.id);
    const extra = (node.layoutWidth ?? SUGIYAMA_DISK) - (memory.width.get(id) ?? SUGIYAMA_DISK);
    if (Math.abs(extra) < 0.5) continue;
    const origin = memory.pos.get(id);
    const half = extra / 2;
    for (const other of ranks.get(Math.round(origin.y)) || []) {
      if (other === node) continue;
      const otherId = String(other.id);
      const side = memory.pos.get(otherId).x < origin.x ? -half : half;
      dx.set(otherId, dx.get(otherId) + side);
    }
  }
  const lineDelta = (maxLines - memory.maxLines) * SUGIYAMA_LINE;
  if (lineDelta) {
    const rankYs = [...ranks.keys()].sort((a, b) => a - b);
    const rankIndex = new Map(rankYs.map((y, index) => [y, index]));
    for (const node of nodes) {
      const index = rankIndex.get(Math.round(memory.pos.get(String(node.id)).y)) || 0;
      dy.set(String(node.id), lineDelta * (index + 1));
    }
  }
  let moved = false;
  for (const node of nodes) {
    const id = String(node.id);
    node.x = memory.pos.get(id).x + dx.get(id);
    node.y = memory.pos.get(id).y + dy.get(id);
    if (Math.abs(dx.get(id)) > 0.5 || Math.abs(dy.get(id)) > 0.5) moved = true;
  }
  for (const link of links) {
    const key = `${link.source.id}|${link.target.id}`;
    const oldPoints = memory.points.get(key);
    if (!oldPoints?.length) continue;
    const parentId = String(link.target.id);
    const childId = String(link.source.id);
    const y0 = oldPoints[0][1];
    const y1 = oldPoints[oldPoints.length - 1][1];
    const span = y1 - y0 || 1;
    link.points = oldPoints.map(([x, y]) => {
      const t = (y - y0) / span;
      return [
        x + (dx.get(parentId) || 0) * (1 - t) + (dx.get(childId) || 0) * t,
        y + (dy.get(parentId) || 0) * (1 - t) + (dy.get(childId) || 0) * t,
      ];
    });
  }
  return { moved };
}

/**
 * Top-to-bottom Sugiyama layout (d3-dag): longest-path layering, optimal
 * decrossing, quadratic coordinates. Edges point at the parent, as in the
 * force graph. Optimal decrossing refuses a graph it judges too large; that
 * case falls back to two-layer decrossing and the caller is told.
 */
export function renderSnomedDag(svgSelection, graph, { onSelect, onLinger, labels, labelHidden, preserve = false, onFrame } = {}) {
  const livePos = new Map();
  const livePath = new Map();
  d3.select(svgSelection).selectAll(".force-node").each(function read(datum) {
    if (!datum?.id) return;
    const match = /translate\(([-\d.]+),([-\d.]+)\)/.exec(this.getAttribute("transform") || "");
    if (match) livePos.set(String(datum.id), { x: Number(match[1]), y: Number(match[2]) });
  });
  d3.select(svgSelection).selectAll(".sugi-link").each(function read(datum) {
    if (!datum?.source || !datum?.target) return;
    livePath.set(`${datum.source.id}|${datum.target.id}`, this.getAttribute("d") || "");
  });
  const svg = d3.select(svgSelection);
  clear(svg);
  svg.classed("is-tangled", false);
  svg.classed("is-sugiyama", true);
  graphZoom(svgSelection);
  installCategoryPatterns(svgSelection);
  const host = svg.node()?.parentElement;
  const width = Math.max(320, host?.clientWidth || 640);
  const height = Math.max(260, host?.clientHeight || 360);
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  const nodes = (graph?.nodes || []).map((node) => ({ ...node, incoming: [], outgoing: [] }));
  if (!nodes.length) return null;
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const links = (graph.links || [])
    .map((link) => ({
      source: byId.get(String(link.source?.id ?? link.source)),
      target: byId.get(String(link.target?.id ?? link.target)),
    }))
    .filter((link) => link.source && link.target);
  for (const link of links) {
    link.target.incoming.push(link);
    link.source.outgoing.push(link);
  }

  const pairs = links.map((link) => [String(link.target.id), String(link.source.id)]);
  const linked = new Set(pairs.flat());
  for (const node of nodes) {
    const id = String(node.id);
    if (!linked.has(id)) pairs.push([id, id]);
  }

  const labelSet = labels instanceof Set ? labels : new Set();
  const labelOff = labelHidden instanceof Set ? labelHidden : new Set();
  const tops = nodes.filter((item) => item.outgoing.length === 0);
  const topSet = new Set(tops);
  const firstLevel = nodes.filter((item) => !topSet.has(item) && item.outgoing.some((edge) => topSet.has(edge.target)));
  for (const item of [...tops, ...firstLevel]) {
    const id = String(item.id);
    if (labelOff.has(id)) item.showLabel = false;
    else {
      labelSet.add(id);
      item.showLabel = true;
    }
  }
  for (const item of nodes) {
    const id = String(item.id);
    if (labelOff.has(id)) {
      item.showLabel = false;
      item.labelOff = true;
    } else if (labelSet.has(id)) item.showLabel = true;
  }

  const measurer = labelMeasurer(svg.node());
  const widths = new Map();
  let maxLines = 1;
  for (const item of nodes) {
    const measure = (text) => measurer.measure(text, { lcp: Boolean(item.lcp) });
    const lines = wrapToWidth(visibleName(item), SUGIYAMA_LABEL_MAX, measure);
    item.labelLines = lines;
    item.lineCount = lines.length;
    const textWidth = Math.max(...lines.map((line) => measure(line)));
    item.textWidth = Math.max(SUGIYAMA_DISK, Math.ceil(textWidth + 4));
    const shown = !item.labelOff && (item.showLabel || item.suggestion || item.cp);
    item.layoutWidth = shown ? item.textWidth : SUGIYAMA_DISK;
    if (!shown) continue;
    widths.set(String(item.id), item.layoutWidth);
    maxLines = Math.max(maxLines, lines.length);
  }
  measurer.remove();
  const radius = 8;
  const sameGraph = preserve && sugiyamaMemory && sugiyamaMemory.ids === sugiyamaIds(nodes);
  let fallback = false;
  let gentle = false;
  if (sameGraph) {
    gentle = adjustSugiyama(nodes, links, maxLines).moved;
  } else {
    const above = radius + 4 + (maxLines - 1) * SUGIYAMA_LINE + 11;
    const gapY = Math.max(28, above - radius + 10);
    const laid = layoutSugiyama(
      pairs,
      (dagNode) => [widths.get(String(dagNode.data)) ?? SUGIYAMA_DISK, 16],
      [8, gapY],
    );
    fallback = laid.fallback;
    const { dag } = laid;
    let minX = Infinity;
    let minY = Infinity;
    for (const dagNode of dag.nodes()) {
      if (typeof dagNode.data !== "string") continue;
      minX = Math.min(minX, dagNode.x);
      minY = Math.min(minY, dagNode.y);
    }
    const shiftX = 16 - (Number.isFinite(minX) ? minX : 0);
    const shiftY = above - (Number.isFinite(minY) ? minY : 0);
    const placed = new Map([...dag.nodes()].map((dagNode) => [String(dagNode.data), dagNode]));
    for (const node of nodes) {
      const at = placed.get(String(node.id));
      node.x = (at?.x ?? 0) + shiftX;
      node.y = (at?.y ?? 0) + shiftY;
    }
    const geometry = new Map();
    for (const dagLink of dag.links()) {
      const parent = String(dagLink.source.data);
      const child = String(dagLink.target.data);
      if (parent === child) continue;
      geometry.set(`${child}|${parent}`, dagLink.points.map(([x, y]) => [x + shiftX, y + shiftY]));
    }
    for (const link of links) link.points = geometry.get(`${link.source.id}|${link.target.id}`);
  }
  const fromPos = new Map(sugiyamaMemory ? [...sugiyamaMemory.pos] : []);
  for (const [id, at] of livePos) fromPos.set(id, at);
  rememberSugiyama(nodes, links, maxLines);

  const layer = zoomLayer(svg);
  const drawn = links.filter((link) => link.points);
  const linkWrap = layer.append("g")
    .attr("class", "sugi-links")
    .selectAll("g")
    .data(drawn)
    .join("g");
  linkWrap.append("path")
    .attr("class", "tangle-halo")
    .attr("d", (item) => sugiyamaPath(item.points));
  const link = linkWrap.append("path")
    .attr("class", "force-link sugi-link")
    .attr("d", (item) => sugiyamaPath(item.points));

  const node = layer.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", (item) => {
      const classes = ["force-node"];
      if (item.suggestion) classes.push("is-suggestion");
      if (item.cp) classes.push("is-cp");
      if (item.lcp) classes.push("is-lcp");
      if (item.inactive) classes.push("is-inactive");
      if (item.showLabel) classes.push("is-labeled");
      if (item.labelOff) classes.push("is-label-off");
      return classes.join(" ");
    })
    .attr("data-id", (item) => item.id)
    .attr("transform", (item) => `translate(${item.x},${item.y})`);

  const sliceArc = d3.arc().innerRadius(0).outerRadius(radius);
  node.each(function paint(item) {
    const hostNode = d3.select(this);
    const slices = item.sliceFills || [];
    if (slices.length > 1) {
      const pie = d3.pie().sort(null).value(() => 1)(slices);
      hostNode.append("g")
        .attr("class", "node-slices")
        .selectAll("path")
        .data(pie)
        .join("path")
        .attr("d", sliceArc)
        .style("fill", (slice) => slice.data);
    }
    hostNode.append("circle")
      .attr("class", "node-disk")
      .attr("r", radius)
      .style("fill", slices.length > 1 ? "none" : (item.fill || "#ffffff"))
      .style("stroke", item.stroke || "#4682b4");
  });
  node.each(function label(item) {
    const lines = item.labelLines || [visibleName(item)];
    const first = -(radius + 4) - (lines.length - 1) * SUGIYAMA_LINE;
    const group = d3.select(this);
    for (const kind of ["shadow", "ink"]) {
      const text = group.append("text").attr("class", `force-label ${kind}`).attr("text-anchor", "middle");
      lines.forEach((line, index) => {
        text.append("tspan").attr("x", 0).attr("dy", index === 0 ? first : SUGIYAMA_LINE).text(line);
      });
    }
  });
  node.append("circle").attr("class", "node-hit").attr("r", radius);

  if (gentle) {
    const curves = linkWrap.selectAll("path");
    node.attr("transform", (item) => {
      const at = fromPos.get(String(item.id)) || item;
      return `translate(${at.x},${at.y})`;
    });
    curves.attr("d", (item) => livePath.get(`${item.source.id}|${item.target.id}`) || sugiyamaPath(item.points));
    const place = new Map();
    for (const item of nodes) {
      const at = fromPos.get(String(item.id)) || item;
      place.set(String(item.id), {
        x: d3.interpolateNumber(at.x, item.x),
        y: d3.interpolateNumber(at.y, item.y),
      });
    }
    const draw = new Map();
    for (const item of drawn) {
      const key = `${item.source.id}|${item.target.id}`;
      draw.set(key, d3.interpolateString(livePath.get(key) || sugiyamaPath(item.points), sugiyamaPath(item.points)));
    }
    layer.transition("sugiyama-constancy").duration(420).ease(d3.easeCubicOut)
      .tween("slide", () => (t) => {
        node.attr("transform", (item) => {
          const at = place.get(String(item.id));
          return `translate(${at.x(t)},${at.y(t)})`;
        });
        curves.attr("d", (item) => draw.get(`${item.source.id}|${item.target.id}`)?.(t) || sugiyamaPath(item.points));
        onFrame?.();
      });
  }

  const restPos = new Map(nodes.map((item) => [String(item.id), { x: item.x, y: item.y }]));
  const restWidth = new Map(nodes.map((item) => [String(item.id), item.layoutWidth ?? SUGIYAMA_DISK]));
  const restPoints = new Map(drawn.map((item) => [
    `${item.source.id}|${item.target.id}`,
    (item.points || []).map((point) => [...point]),
  ]));

  function showsHoverLabel(item, targets) {
    if (targets.has(item)) return true;
    if (item.labelOff) return false;
    return Boolean(item.showLabel || item.suggestion || item.cp);
  }

  function hoverTargets(activeNode, activeLink) {
    const targets = new Set();
    if (activeNode) {
      targets.add(activeNode);
      for (const edge of activeNode.incoming || []) if (edge.source) targets.add(edge.source);
      for (const edge of activeNode.outgoing || []) if (edge.target) targets.add(edge.target);
    } else if (activeLink) {
      if (activeLink.source) targets.add(activeLink.source);
      if (activeLink.target) targets.add(activeLink.target);
    }
    return targets;
  }

  function spreadHover(targets) {
    const dx = new Map(nodes.map((item) => [String(item.id), 0]));
    const dy = new Map(nodes.map((item) => [String(item.id), 0]));
    const ranks = new Map();
    for (const item of nodes) {
      const y = Math.round(restPos.get(String(item.id)).y);
      const rank = ranks.get(y) || [];
      rank.push(item);
      ranks.set(y, rank);
    }
    let collide = false;
    for (const rank of ranks.values()) {
      const ordered = rank.slice().sort((a, b) => restPos.get(String(a.id)).x - restPos.get(String(b.id)).x);
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const left = ordered[index];
        const right = ordered[index + 1];
        const half = (entry) => (showsHoverLabel(entry, targets) ? (entry.textWidth ?? SUGIYAMA_DISK) : radius * 2) / 2;
        const gap = restPos.get(String(right.id)).x - restPos.get(String(left.id)).x;
        if (gap < half(left) + half(right) + 4) collide = true;
      }
    }
    let drop = 0;
    let pivot = Infinity;
    for (const item of nodes) {
      if (!showsHoverLabel(item, targets)) continue;
      const at = restPos.get(String(item.id));
      const top = at.y - (radius + 4) - ((item.lineCount || 1) - 1) * SUGIYAMA_LINE;
      for (const other of nodes) {
        const oy = restPos.get(String(other.id)).y;
        if (oy >= at.y - 2) continue;
        const need = oy + radius + 4 - top;
        if (need > drop) {
          drop = need;
          pivot = Math.min(pivot, at.y);
          collide = true;
        }
      }
    }
    if (!collide) return { pos: restPos, points: restPoints };
    for (const item of nodes) {
      if (!showsHoverLabel(item, targets)) continue;
      const id = String(item.id);
      const extra = (item.textWidth ?? SUGIYAMA_DISK) - (restWidth.get(id) ?? SUGIYAMA_DISK);
      if (extra < 0.5) continue;
      const origin = restPos.get(id);
      const half = extra / 2;
      for (const other of ranks.get(Math.round(origin.y)) || []) {
        if (other === item) continue;
        const otherId = String(other.id);
        const side = restPos.get(otherId).x < origin.x ? -half : half;
        dx.set(otherId, (dx.get(otherId) || 0) + side);
      }
    }
    if (drop > 0.5) {
      for (const item of nodes) {
        const id = String(item.id);
        if (restPos.get(id).y >= pivot - 0.5) dy.set(id, drop);
      }
    }
    const pos = new Map();
    for (const item of nodes) {
      const id = String(item.id);
      const at = restPos.get(id);
      pos.set(id, { x: at.x + (dx.get(id) || 0), y: at.y + (dy.get(id) || 0) });
    }
    const points = new Map();
    for (const [key, oldPoints] of restPoints) {
      const [childId, parentId] = key.split("|");
      if (!oldPoints?.length) {
        points.set(key, oldPoints);
        continue;
      }
      const y0 = oldPoints[0][1];
      const y1 = oldPoints[oldPoints.length - 1][1];
      const span = y1 - y0 || 1;
      points.set(key, oldPoints.map(([x, y]) => {
        const t = (y - y0) / span;
        return [
          x + (dx.get(parentId) || 0) * (1 - t) + (dx.get(childId) || 0) * t,
          y + (dy.get(parentId) || 0) * (1 - t) + (dy.get(childId) || 0) * t,
        ];
      }));
    }
    return { pos, points };
  }

  function nearly(a, b) {
    return Math.abs(a - b) < 0.6;
  }

  function fitHoverLabels(activeNode, activeLink) {
    const plan = spreadHover(hoverTargets(activeNode, activeLink));
    let settled = true;
    node.each(function read(item) {
      const match = /translate\(([-\d.]+),([-\d.]+)\)/.exec(this.getAttribute("transform") || "");
      const at = plan.pos.get(String(item.id));
      if (!match || !at || !nearly(Number(match[1]), at.x) || !nearly(Number(match[2]), at.y)) settled = false;
    });
    if (settled) return;
    const from = new Map();
    node.each(function read(item) {
      const match = /translate\(([-\d.]+),([-\d.]+)\)/.exec(this.getAttribute("transform") || "");
      from.set(String(item.id), match
        ? { x: Number(match[1]), y: Number(match[2]) }
        : restPos.get(String(item.id)));
    });
    const pathFrom = new Map();
    const halo = linkWrap.select("path.tangle-halo");
    link.each(function read(item) {
      pathFrom.set(`${item.source.id}|${item.target.id}`, this.getAttribute("d") || "");
    });
    halo.each(function read(item) {
      const key = `${item.source.id}|${item.target.id}`;
      if (!pathFrom.get(key)) pathFrom.set(key, this.getAttribute("d") || "");
    });
    const place = new Map();
    for (const item of nodes) {
      const id = String(item.id);
      const start = from.get(id);
      const end = plan.pos.get(id);
      place.set(id, {
        x: d3.interpolateNumber(start.x, end.x),
        y: d3.interpolateNumber(start.y, end.y),
      });
    }
    const draw = new Map();
    for (const item of drawn) {
      const key = `${item.source.id}|${item.target.id}`;
      const end = sugiyamaPath(plan.points.get(key) || item.points);
      draw.set(key, d3.interpolateString(pathFrom.get(key) || end, end));
    }
    layer.interrupt("sugiyama-constancy");
    layer.transition("sugiyama-hover").duration(200).ease(d3.easeCubicOut)
      .tween("slide", () => (t) => {
        node.attr("transform", (item) => {
          const at = place.get(String(item.id));
          return `translate(${at.x(t)},${at.y(t)})`;
        });
        const at = (item) => draw.get(`${item.source.id}|${item.target.id}`)?.(t) || sugiyamaPath(item.points);
        halo.attr("d", at);
        link.attr("d", at);
        onFrame?.();
      });
  }

  function paintHover(activeNode, activeLink) {
    node.classed("is-active", false).classed("is-incoming", false).classed("is-outgoing", false);
    link.classed("is-active", false).classed("is-incoming", false).classed("is-outgoing", false).classed("is-bold", false);
    linkWrap.classed("is-raised", false);
    const raised = new Set();
    if (activeNode) {
      node.filter((item) => item === activeNode).classed("is-active", true);
      for (const edge of activeNode.incoming) {
        raised.add(edge);
        link.filter((item) => item === edge).classed("is-incoming", true).classed("is-bold", true);
        node.filter((item) => item === edge.source).classed("is-incoming", true);
      }
      for (const edge of activeNode.outgoing) {
        raised.add(edge);
        link.filter((item) => item === edge).classed("is-outgoing", true).classed("is-bold", true);
        node.filter((item) => item === edge.target).classed("is-outgoing", true);
      }
    } else if (activeLink) {
      raised.add(activeLink);
      link.filter((item) => item === activeLink).classed("is-active", true).classed("is-bold", true);
      node.filter((item) => item === activeLink.source).classed("is-incoming", true);
      node.filter((item) => item === activeLink.target).classed("is-outgoing", true);
    }
    linkWrap.classed("is-raised", (item) => raised.has(item));
    const hostNode = linkWrap.node()?.parentNode;
    if (hostNode) {
      linkWrap.each(function restore() { hostNode.appendChild(this); });
      linkWrap.filter((item) => raised.has(item)).each(function raise() { hostNode.appendChild(this); });
    }
    fitHoverLabels(activeNode, activeLink);
  }

  let lingerTimer = 0;
  let lingerItem = null;
  let lingerPoint = null;
  function clearLinger() {
    window.clearTimeout(lingerTimer);
    lingerTimer = 0;
    lingerItem = null;
    lingerPoint = null;
  }
  function armLinger(item, point) {
    if (lingerItem === item && lingerTimer) return;
    window.clearTimeout(lingerTimer);
    lingerItem = item;
    lingerPoint = point;
    lingerTimer = window.setTimeout(() => {
      lingerTimer = 0;
      onLinger?.(item);
    }, 1000);
  }

  node
    .on("mouseover", (event, item) => paintHover(item, null))
    .on("mouseout", (event) => {
      if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
      paintHover(null, null);
    })
    .on("pointerdown", (event, item) => {
      if (event.pointerType !== "touch") return;
      armLinger(item, { x: event.clientX, y: event.clientY });
    })
    .on("pointermove", (event) => {
      if (!lingerPoint || !lingerTimer) return;
      if (Math.hypot(event.clientX - lingerPoint.x, event.clientY - lingerPoint.y) > 8) clearLinger();
    })
    .on("pointerup", () => clearLinger())
    .on("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      clearLinger();
    })
    .on("pointercancel", () => clearLinger())
    .on("contextmenu", (event) => event.preventDefault())
    .on("click", (event, item) => {
      event.stopPropagation();
      onSelect?.(item);
    });
  link
    .on("mouseover", (event, item) => paintHover(null, item))
    .on("mouseout", () => paintHover(null, null));
  return fallback ? "two-layer order (graph too large for optimal)" : null;
}

export function renderForceGraph(svgSelection, data, { onSelect } = {}) {
  const svg = d3.select(svgSelection);
  clear(svg);
  const { width, height } = sizeOf(svg);
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  const nodes = data.nodes.map((node) => ({ ...node }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const links = data.links
    .map((link) => ({
      source: byId.get(String(link.source).trim()),
      target: byId.get(String(link.target).trim()),
    }))
    .filter((link) => link.source && link.target);

  const defs = svg.append("defs");
  defs.append("marker")
    .attr("id", "force-arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 18)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#8d97a3");

  const link = svg.append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "force-link")
    .attr("marker-end", "url(#force-arrow)");

  const node = svg.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", (item) => `force-node${item.mark ? ` ${item.mark}` : ""}`)
    .call(d3.drag()
      .on("start", (event, item) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        item.fx = item.x;
        item.fy = item.y;
      })
      .on("drag", (event, item) => {
        item.fx = event.x;
        item.fy = event.y;
      })
      .on("end", (event, item) => {
        if (!event.active) simulation.alphaTarget(0);
        item.fx = null;
        item.fy = null;
      }))
    .on("click", (event, item) => onSelect?.(item));

  node.append("circle").attr("r", 11);
  node.append("text")
    .attr("class", "force-label")
    .attr("text-anchor", "middle")
    .attr("dy", -16)
    .text((item) => item.name);

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).distance(54).strength(0.85))
    .force("charge", d3.forceManyBody().strength(-180))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide(18))
    .on("tick", () => {
      link
        .attr("x1", (item) => item.source.x)
        .attr("y1", (item) => item.source.y)
        .attr("x2", (item) => item.target.x)
        .attr("y2", (item) => item.target.y);
      node.attr("transform", (item) => `translate(${item.x},${item.y})`);
    });
  svg.node().__termvizSimulation = simulation;
  return { simulation };
}

export { RANK_COLORS };
