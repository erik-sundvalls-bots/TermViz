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

export function renderTemplateTree(svgSelection, rootData, { selectedId, onSelect, onToggle } = {}) {
  const svg = d3.select(svgSelection);
  clear(svg);
  if (!rootData) {
    svg.attr("width", "100%").attr("height", "100%");
    return;
  }
  const root = d3.hierarchy(rootData, (node) => (node.open === false ? null : node.children));
  const layout = d3.tree().nodeSize([28, 272]);
  layout(root);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y1 = 0;
  root.each((node) => {
    if (node.x < x0) x0 = node.x;
    if (node.x > x1) x1 = node.x;
    if (node.y > y1) y1 = node.y;
  });
  const height = Math.max(180, x1 - x0 + 56);
  const width = y1 + 300;
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  const plot = svg.append("g").attr("transform", `translate(36,${24 - x0})`);
  const diagonal = d3.linkHorizontal().x((point) => point.y).y((point) => point.x);

  plot.append("g")
    .selectAll("path")
    .data(root.links())
    .join("path")
    .attr("class", "tree-link")
    .attr("d", diagonal);

  const node = plot.append("g")
    .selectAll("g")
    .data(root.descendants())
    .join("g")
    .attr("class", (item) => {
      const data = item.data;
      const classes = ["tpl-node", `rm-${data.rmType || "other"}`];
      if (data.id === selectedId) classes.push("is-selected");
      if (data.suggestions?.length) classes.push("has-suggestions");
      const bound = [...(data.bindings || []), ...(data.valueBindings || [])];
      if (bound.some((binding) => binding.status === "missing-from-opt")) {
        classes.push("has-enriched");
      } else if (bound.length) classes.push("has-binding");
      return classes.join(" ");
    })
    .attr("data-id", (item) => item.data.id)
    .attr("transform", (item) => `translate(${item.y},${item.x})`);

  node.append("title").text((item) => {
    const data = item.data;
    return [
      data.name,
      data.rmType,
      data.nodeId || "",
      data.archetypeId || "",
      data.section ? `Section: ${data.section}` : "",
    ].filter(Boolean).join("\n");
  });

  node.filter((item) => onToggle && item.data.children?.length)
    .append("text")
    .attr("class", "tree-toggle")
    .attr("x", -16)
    .attr("dy", "0.35em")
    .attr("text-anchor", "middle")
    .text((item) => (item.children ? "−" : "+"))
    .on("click", (event, item) => {
      event.stopPropagation();
      onToggle?.(item.data);
    });

  node.append("circle").attr("r", (item) => item.data.suggestions?.length ? 7 : 4.5);

  node.append("text")
    .attr("class", "tree-label")
    .attr("x", 12)
    .attr("dy", "0.35em")
    .text((item) => {
      const name = item.data.name || "";
      const clipped = name.length > 34 ? `${name.slice(0, 33)}…` : name;
      return item.data.suggestions?.length ? `${clipped}  ·  5 maps` : clipped;
    });

  node.on("click", (event, item) => {
    event.stopPropagation();
    onSelect?.(item.data);
  });

  const selected = root.descendants().find((item) => item.data.id === selectedId);
  return { width, height, selected };
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
