/**
 * TermViz rendering for D3 7.
 * The 2013 termviz.js speaks the D3 v2 layout API (d3.layout.force,
 * d3.layout.cluster, d3.svg.diagonal). Those calls were removed, so this
 * module is the replacement: a force-directed is-a graph, a layered
 * ancestor DAG, and a collapsible template tree.
 */

import * as d3 from "d3";

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
  if (mode === "in") {
    svg.transition().duration(180).call(zoom.scaleBy, 1.35);
    return;
  }
  if (mode === "out") {
    svg.transition().duration(180).call(zoom.scaleBy, 1 / 1.35);
    return;
  }
  if (mode === "one") {
    svg.transition().duration(220).call(zoom.transform, d3.zoomIdentity);
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
  svg.transition().duration(280).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
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
 * Dendrogram with the root at the bottom, the same way the 2013 cluster
 * layout drew it (`treeHeight - d.y`). Leaves line up along the top.
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

export function renderTemplateTree(svgSelection, rootData, { selectedId, activeIds, colorFor, onSelect, onToggle, onHover } = {}) {
  const svg = d3.select(svgSelection);
  clear(svg);
  graphZoom(svgSelection);
  installCategoryPatterns(svgSelection);
  if (!rootData) {
    svg.attr("width", "100%").attr("height", "100%");
    return;
  }
  const root = d3.hierarchy(rootData, (node) => (node.open === false ? null : node.children));
  const labelGap = 6;
  const depthGap = 34;
  root.each((node) => {
    node.label = treeLabel(node.data.name || "");
    node.labelWidth = treeLabelWidth(node.label);
  });
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
  let x1 = -Infinity;
  let y1 = 0;
  root.each((node) => {
    x0 = Math.min(x0, node.x - node.labelWidth / 2);
    x1 = Math.max(x1, node.x + node.labelWidth / 2);
    if (node.y > y1) y1 = node.y;
  });
  const padTop = 16;
  const padBottom = 14;
  const padX = 8;
  const host = svg.node()?.parentElement;
  const viewW = Math.max(280, host?.clientWidth || 640);
  const viewH = Math.max(140, host?.clientHeight || 320);
  svg.attr("width", viewW).attr("height", viewH).attr("viewBox", `0 0 ${viewW} ${viewH}`);
  const yOf = (node) => padTop + (y1 - node.y);
  const plot = zoomLayer(svg).append("g").attr("transform", `translate(${padX - x0},0)`);
  const diagonal = d3.linkVertical().x((point) => point.x).y((point) => point.y);
  const active = activeIds instanceof Set ? activeIds : new Set(activeIds || []);

  plot.append("g")
    .selectAll("path")
    .data(root.links())
    .join("path")
    .attr("class", "tree-link")
    .attr("d", (link) => diagonal({
      source: { x: link.source.x, y: yOf(link.source) },
      target: { x: link.target.x, y: yOf(link.target) },
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
      if (data.suggestions?.length) classes.push("has-suggestions");
      const bound = [...(data.bindings || []), ...(data.valueBindings || []), ...(data.scopeBindings || [])];
      if (bound.some((binding) => binding.status === "missing-from-opt")) {
        classes.push("has-enriched");
      } else if (bound.length) classes.push("has-binding");
      return classes.join(" ");
    })
    .attr("data-id", (item) => item.data.id)
    .attr("transform", (item) => `translate(${item.x},${yOf(item)})`);

  node.append("title").text((item) => item.data.name || "");

  node.filter((item) => onToggle && item.data.children?.length)
    .append("text")
    .attr("class", "tree-toggle")
    .attr("x", -14)
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
      .attr("text-anchor", "middle")
      .attr("dy", -13)
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
  node.on("mouseover", (event, item) => onHover?.(item.data, true));
  node.on("mouseout", (event, item) => onHover?.(item.data, false));

  const selected = root.descendants().find((item) => item.data.id === selectedId);
  return { width: viewW, height: viewH, selected };
}

/**
 * Force-directed is-a graph, in the 2013 style: SNOMED is a DAG, labels
 * stay quiet until hover or until a concept is shared, and hovering a
 * node pushes its parents and children apart.
 */
export function renderSnomedForce(svgSelection, graph, { onTick, onSelect, pins, released, onPinMove, labels, labelHidden } = {}) {
  const svg = d3.select(svgSelection);
  clear(svg);
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
    .attr("refX", 18)
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
  const rootY = 32;
  const rowY = Math.max(108, Math.min(156, Math.round(height * 0.2)));

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

  const elastic = [];
  for (const item of firstLevel) {
    const id = String(item.id);
    if (releasedSet.has(id)) continue;
    const pin = pinOf.get(id);
    if (pin && !pin.auto) {
      place(item, pin.x, pin.y, { pinned: true, auto: false, fixed: false });
    } else elastic.push(item);
  }
  elastic.forEach((item, index) => {
    const x = width * (index + 1) / (elastic.length + 1);
    place(item, x, rowY, { pinned: true, auto: true, fixed: false });
  });

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

  node.append("circle")
    .attr("class", "node-disk")
    .attr("r", (item) => (item.lcp ? 16 : item.cp ? 13 : item.suggestion ? 11 : 8))
    .attr("fill-opacity", (item) => item.fillOpacity ?? 1)
    .attr("stroke-width", (item) => (item.lcp ? 3.4 : item.cp ? 2.5 : 1.6))
    .each(function paint(item) {
      d3.select(this)
        .style("fill", item.fill || "#ffffff")
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
        text.append("tspan").attr("x", 0).attr("dy", index === 0 ? -18 : 13).text(line);
      });
    }
  });
  node.append("circle")
    .attr("class", "node-hit")
    .attr("r", (item) => (item.lcp ? 16 : item.cp ? 13 : item.suggestion ? 11 : 8));

  function paintHover(activeNode, activeLink) {
    nodes.forEach((item) => {
      item.hoover_doi = 0;
    });
    links.forEach((item) => {
      item.hoover_doi = 0;
    });
    node.classed("is-active", false).classed("is-incoming", false).classed("is-outgoing", false);
    link.classed("is-active", false).classed("is-incoming", false).classed("is-outgoing", false);
    if (activeNode) {
      activeNode.hoover_doi = 3;
      node.filter((item) => item === activeNode).classed("is-active", true);
      for (const edge of activeNode.incoming) {
        edge.hoover_doi = 1;
        edge.source.hoover_doi = Math.max(edge.source.hoover_doi, 1);
        link.filter((item) => item === edge).classed("is-incoming", true);
        node.filter((item) => item === edge.source).classed("is-incoming", true);
      }
      for (const edge of activeNode.outgoing) {
        edge.hoover_doi = 1;
        edge.target.hoover_doi = Math.max(edge.target.hoover_doi, 1);
        link.filter((item) => item === edge).classed("is-outgoing", true);
        node.filter((item) => item === edge.target).classed("is-outgoing", true);
      }
    }
    if (activeLink) {
      activeLink.hoover_doi = 1;
      link.filter((item) => item === activeLink).classed("is-active", true);
      node.filter((item) => item === activeLink.source).classed("is-incoming", true);
      node.filter((item) => item === activeLink.target).classed("is-outgoing", true);
      activeLink.source.hoover_doi = Math.max(activeLink.source.hoover_doi, 1);
      activeLink.target.hoover_doi = Math.max(activeLink.target.hoover_doi, 1);
    }
    simulation.alpha(0.35).restart();
  }

  node
    .on("mouseover", (event, item) => paintHover(item, null))
    .on("mouseout", () => paintHover(null, null))
    .on("click", (event, item) => {
      event.stopPropagation();
      onSelect?.(item);
    })
    .call(d3.drag()
      .on("start", (event, item) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
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
    .force("link", d3.forceLink(links).distance((edge) => {
      const base = 52 + (edge.hoover_doi || 0) * 22;
      return edge.target.layoutFixed ? base + 28 : base;
    }).strength(0.85))
    .force("charge", d3.forceManyBody().strength((item) => -160 + (item.hoover_doi || 0) * -240))
    .force("x", d3.forceX(width / 2).strength((item) => (item.layoutFixed || item.userPinned ? 0 : 0.04)))
    .force("y", d3.forceY(height * 0.62).strength((item) => (item.layoutFixed || item.userPinned ? 0 : 0.05)))
    .force("collide", d3.forceCollide(18))
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
