import * as d3 from "d3";
import { publicUrl } from "./ips-model.js";
import {
  adjacencyFromPairs,
  bandIndexForNode,
  collectDownstream,
  collectUpstream,
  runBandedLayout,
} from "./kg-layout.js";
import { directChildren, expandSnomedParents, lookupTerminology } from "./kg-terminology.js";

const VERIFICATION_CLASS = {
  "verified-by-connector": "v-connector",
  "verified-by-FHIR": "v-fhir",
  "verified-by-fileset": "v-fileset",
  "sourced-from-FASS": "v-fass",
  "listed-not-resolvable": "v-list",
  "absent-from-server": "v-list",
  "proposed/unverified": "v-prop",
};

const TYPE_FILL = {
  concept: "#7eb8da",
  expression: "#5a9fd4",
  template: "#4a9a58",
  section: "#79b87d",
  archetype: "#8f72ad",
  archetype_node: "#b8a0ce",
  patient: "#888",
  composition_instance: "#666",
  entry_instance: "#888",
  element_instance: "#888",
};

const PATIENT_FILL = {
  eva: "#c45c4a",
  lars: "#2f6fad",
};

const BAND_LABELS = new Map([
  [0, "Ontology concepts (is-a roots)"],
  [1, "Ontology concepts"],
  [2, "Ontology concepts (leaf / detailed)"],
  [10, "openEHR template"],
  [11, "Template sections"],
  [12, "Archetypes"],
  [13, "Archetype nodes"],
  [14, "Patients"],
  [15, "Composition instances"],
  [16, "Entry instances"],
  [17, "Element values"],
]);

const state = {
  raw: null,
  nodeById: new Map(),
  layout: null,
  pairs: [],
  adjacency: null,
  selectedId: null,
  highlight: null,
  patientFilter: "both",
  ontologyFilter: "all",
  search: "",
  collapseArchetypeNodes: true,
  collapseOntologyBelow: 1,
  sharedNodes: new Set(),
};

let svg;
let gRoot;
let gBands;
let gLinks;
let gNodes;
let zoom;
let tooltip;
let detailEl;
let statusEl;

function shortLabel(node) {
  const text = node.display_sv || node.display || node.name;
  if (text) return text.length > 24 ? `${text.slice(0, 22)}…` : text;
  if (node.code) return String(node.code);
  if (node.path) {
    const leaf = node.path.split("/").pop() || "";
    return leaf.length > 24 ? `${leaf.slice(0, 22)}…` : leaf;
  }
  const id = node.id.split(":").slice(1).join(":");
  return id.length > 22 ? `${id.slice(0, 20)}…` : id;
}

function instanceOwnedByPatient(nodeId) {
  if (nodeId.includes("eva-holmgren") || nodeId.startsWith("inst:eva-") || nodeId.startsWith("elem:eva-")) return "eva";
  if (nodeId.includes("lars-nystrom") || nodeId.startsWith("inst:lars-") || nodeId.startsWith("elem:lars-")) return "lars";
  return null;
}

function nodeFill(node) {
  const owner = instanceOwnedByPatient(node.id);
  if (owner && (node.type === "patient" || node.type.includes("instance"))) {
    return PATIENT_FILL[owner];
  }
  return TYPE_FILL[node.type] || "#aaa";
}

function nodeMatchesSearch(node, query) {
  if (!query) return true;
  const hay = [
    node.id, node.display, node.display_sv, node.display_en, node.name,
    node.path, node.code, node.rm_type, node.archetype_id, node.verification, node.ontology,
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(query);
}

function passesUiFilters(node) {
  if (state.ontologyFilter !== "all" && (node.type === "concept" || node.type === "expression")) {
    if ((node.ontology || "sct") !== state.ontologyFilter) return false;
  }
  const owner = instanceOwnedByPatient(node.id);
  if (owner && state.patientFilter !== "both" && owner !== state.patientFilter) return false;
  if (!nodeMatchesSearch(node, state.search)) return false;
  return true;
}

function computeSharedNodes() {
  const touched = { eva: new Set(), lars: new Set() };
  for (const edge of state.raw.edges) {
    const o1 = instanceOwnedByPatient(edge.from);
    const o2 = instanceOwnedByPatient(edge.to);
    if (o1) touched[o1].add(edge.to === edge.from ? edge.from : edge.to);
    if (o2) touched[o2].add(edge.from);
    if (o1 && !o2) touched[o1].add(edge.from);
    if (o2 && !o1) touched[o2].add(edge.to);
  }
  const shared = new Set();
  for (const id of touched.eva) {
    if (touched.lars.has(id) && !instanceOwnedByPatient(id)) shared.add(id);
  }
  // Model nodes used by both patients via instance_of / coded_as
  for (const edge of state.raw.edges) {
    const isInst = edge.from.startsWith("inst:") || edge.from.startsWith("composition:");
    if (!isInst) continue;
    const p = instanceOwnedByPatient(edge.from);
    if (!p) continue;
    if (edge.type === "instance_of" || edge.type === "coded_as" || edge.type === "contains") {
      touched[p].add(edge.to);
    }
  }
  for (const id of touched.eva) {
    if (touched.lars.has(id) && !instanceOwnedByPatient(id)) shared.add(id);
  }
  state.sharedNodes = shared;
}

function layoutGraph() {
  const nodes = state.raw.nodes.filter(passesUiFilters);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = state.raw.edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  state.layout = runBandedLayout({
    nodes,
    edges,
    nodeById: state.nodeById,
    labelFor: shortLabel,
    collapseOntologyBelow: state.collapseOntologyBelow,
    collapseArchetypeNodes: state.collapseArchetypeNodes,
  });

  state.pairs = edges.map((e) => {
    const from = state.nodeById.get(e.from);
    const to = state.nodeById.get(e.to);
    const depth = state.layout.ontologyDepth;
    const bandFor = (n) => bandIndexForNode(n, depth);
    const bf = bandFor(from);
    const bt = bandFor(to);
    if (bf !== bt) return bf < bt ? [from.id, to.id] : [to.id, from.id];
    const UP = new Set(["is_a", "binding", "instance_of", "coded_as", "unit"]);
    return UP.has(e.type) ? [e.to, e.from] : [e.from, e.to];
  });
  state.adjacency = adjacencyFromPairs(state.pairs);
}

function linkPath(points) {
  if (!points || points.length < 2) return "";
  return d3.line()(points);
}

function render() {
  layoutGraph();
  const nodes = state.layout.nodes;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const highlight = state.highlight;

  gLinks
    .selectAll("path")
    .data(state.layout.links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target)), (d) => `${d.source}|${d.target}`)
    .join("path")
    .attr("class", "kg-link")
    .attr("d", (d) => linkPath(d.points))
    .classed("is-hl", (d) => highlight && highlight.has(d.source) && highlight.has(d.target))
    .classed("is-dim", (d) => highlight && !(highlight.has(d.source) && highlight.has(d.target)))
    .classed("is-shared-link", (d) => state.sharedNodes.has(d.source) && state.sharedNodes.has(d.target));

  const join = gNodes.selectAll("g.kg-node").data(nodes, (d) => d.id);
  join.exit().remove();
  const enter = join
    .enter()
    .append("g")
    .attr("class", "kg-node");
  enter.append("rect").attr("class", "kg-shape kg-pill").attr("rx", 4);
  enter.append("circle").attr("class", "kg-shape kg-dot").attr("r", 0);
  enter.append("text").attr("class", "kg-node-label");

  const merged = enter.merge(join);
  merged
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .classed("is-hl", (d) => highlight && highlight.has(d.id))
    .classed("is-dim", (d) => highlight && !highlight.has(d.id))
    .classed("is-shared", (d) => state.sharedNodes.has(d.id))
    .each(function paint(d) {
      const g = d3.select(this);
      const node = d.node;
      const isConcept = node.type === "concept" || node.type === "expression";
      const pill = g.select(".kg-pill");
      const dot = g.select(".kg-dot");
      const label = g.select(".kg-node-label");
      if (isConcept) {
        pill.attr("width", 0).attr("height", 0);
        dot.attr("r", 9).attr("fill", nodeFill(node)).attr("stroke", state.sharedNodes.has(d.id) ? "#0b4f4d" : "#1c2430");
        label.attr("x", 13).attr("y", 4).attr("text-anchor", "start").text(shortLabel(node));
      } else {
        dot.attr("r", 0);
        const w = d.width;
        const h = d.height;
        pill
          .attr("x", -w / 2)
          .attr("y", -h / 2)
          .attr("width", w)
          .attr("height", h)
          .attr("fill", nodeFill(node))
          .attr("stroke", state.sharedNodes.has(d.id) ? "#0b4f4d" : "#1c2430")
          .attr("stroke-width", state.sharedNodes.has(d.id) ? 2 : 1);
        label.attr("x", 0).attr("y", 4).attr("text-anchor", "middle").text(shortLabel(node));
      }
    });

  drawBandGuides(nodes);
  updateStatus(nodes.length);
}

function drawBandGuides(nodes) {
  if (!nodes.length) {
    gBands.selectAll("*").remove();
    return;
  }
  const xs = nodes.flatMap((n) => [n.x - n.width / 2, n.x + n.width / 2]);
  const minX = Math.min(...xs) - 120;
  const maxX = Math.max(...xs) + 120;
  const bands = new Map();
  for (const n of nodes) {
    const b = n.band;
    if (!bands.has(b)) bands.set(b, { band: b, y0: n.y, y1: n.y });
    const row = bands.get(b);
    row.y0 = Math.min(row.y0, n.y - n.height);
    row.y1 = Math.max(row.y1, n.y + n.height);
  }
  const data = [...bands.values()].sort((a, b) => a.band - b.band);
  gBands
    .selectAll("g")
    .data(data, (d) => d.band)
    .join("g")
    .each(function draw(row) {
      const g = d3.select(this);
      const y = row.y0 - 18;
      const h = row.y1 - row.y0 + 36;
      g.selectAll("rect").data([0]).join("rect").attr("class", "kg-layer-band").attr("x", minX).attr("y", y).attr("width", maxX - minX).attr("height", h);
      g.selectAll("text").data([0]).join("text")
        .attr("class", "kg-band-label")
        .attr("x", minX + 8)
        .attr("y", y + 16)
        .text(BAND_LABELS.get(row.band) || `Band ${row.band}`);
    });
}

function updateStatus(visibleCount) {
  const total = state.raw?.nodes?.length ?? 0;
  const collapsed = [];
  if (state.collapseArchetypeNodes) collapsed.push("archetype nodes hidden");
  if (state.collapseOntologyBelow < 9) collapsed.push(`ontology is-a depth ≤ ${state.collapseOntologyBelow}`);
  statusEl.textContent = `${visibleCount} / ${total} nodes · banded Sugiyama-style layout${collapsed.length ? ` (${collapsed.join("; ")})` : ""}`;
}

function selectNode(id) {
  state.selectedId = id;
  if (!id || !state.adjacency) {
    state.highlight = null;
    render();
    renderDetail(null);
    return;
  }
  const up = collectUpstream(id, state.adjacency.parents);
  const down = collectDownstream(id, state.adjacency.children);
  state.highlight = new Set([...up, ...down]);
  render();
  renderDetail(state.nodeById.get(id));
}

function badgeHtml(verification) {
  if (!verification) return "";
  const cls = VERIFICATION_CLASS[verification] || "v-prop";
  return `<span class="kg-badge ${cls}" title="${verification}">${verification}</span>`;
}

function nodeLabel(node) {
  return node.display_sv || node.display || node.name || node.id;
}

async function renderDetail(node) {
  if (!node) {
    detailEl.innerHTML = "<p>Select a node to inspect bindings, paths, and live terminology.</p>";
    return;
  }
  const rows = [
    ["ID", node.id],
    ["Type", node.type],
    ["Verification", badgeHtml(node.verification)],
    node.display_sv && ["Display (sv)", node.display_sv],
    node.code && ["Code", node.code],
    node.path && ["Path", node.path],
    node.rm_type && ["RM type", node.rm_type],
  ].filter(Boolean);

  let lookupBlock = "";
  if (node.type === "concept" && node.system && node.code) {
    lookupBlock = '<p id="kgLookupStatus">Loading terminology…</p><dl id="kgLookupBody" class="kg-detail"></dl>';
    if (node.system.includes("snomed")) {
      lookupBlock += '<p><button type="button" class="kg-btn" id="kgExpandParents">Expand is-a parents</button> <button type="button" class="kg-btn" id="kgListChildren">List children</button></p>';
    }
  }

  detailEl.innerHTML = `<h2>${badgeHtml(node.verification)} ${nodeLabel(node)}</h2><dl class="kg-detail">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>${lookupBlock}`;

  if (node.type === "concept" && node.system && node.code) {
    const status = document.getElementById("kgLookupStatus");
    const body = document.getElementById("kgLookupBody");
    try {
      const record = await lookupTerminology(node.system, node.code, { displayLanguage: node.display_sv ? "sv" : undefined });
      status.textContent = record.error || (record.fromCache ? "From cache." : "Live Ontoserver lookup.");
      if (!record.error) {
        body.innerHTML = `<dt>Display</dt><dd>${record.display || "—"}</dd><dt>Parents</dt><dd>${(record.parents || []).join(", ") || "—"}</dd>`;
      }
    } catch (err) {
      status.textContent = err.message;
      status.className = "kg-error";
    }
    document.getElementById("kgExpandParents")?.addEventListener("click", async () => {
      for (const p of node.parents || []) {
        const r = await expandSnomedParents(p);
        body.innerHTML += `<dt>Parent ${p}</dt><dd>${r.display || r.error}</dd>`;
      }
    });
    document.getElementById("kgListChildren")?.addEventListener("click", async () => {
      try {
        const kids = await directChildren(node.code);
        body.innerHTML += `<dt>Children</dt><dd>${kids.slice(0, 30).map((k) => `${k.code}: ${k.display}`).join("<br>")}</dd>`;
      } catch (err) {
        body.innerHTML += `<dd class="kg-error">${err.message}</dd>`;
      }
    });
  }
}

function showTooltip(event, node) {
  tooltip.textContent = [nodeLabel(node), node.id, node.verification, node.path, node.code && `code: ${node.code}`].filter(Boolean).join("\n");
  tooltip.classList.add("is-on");
  tooltip.style.left = `${event.clientX + 12}px`;
  tooltip.style.top = `${event.clientY + 12}px`;
}

function hideTooltip() {
  tooltip.classList.remove("is-on");
}

function fitGraph(mode = "readable") {
  const nodes = state.layout?.nodes || [];
  if (!nodes.length) return;
  const padX = 48;
  const padY = 56;
  const x0 = Math.min(...nodes.map((n) => n.x - n.width / 2)) - padX;
  const x1 = Math.max(...nodes.map((n) => n.x + n.width / 2)) + padX;
  const y0 = Math.min(...nodes.map((n) => n.y - n.height)) - padY;
  const y1 = Math.max(...nodes.map((n) => n.y + n.height)) + padY;
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  const scaleX = (width * 0.96) / (x1 - x0);
  const scaleY = (height * 0.92) / (y1 - y0);
  let scale = mode === "overview" ? Math.min(scaleX, scaleY) : Math.min(scaleX, Math.max(0.42, scaleY));
  scale = Math.min(2.2, Math.max(0.35, scale));
  const tx = width / 2 - scale * ((x0 + x1) / 2);
  const ty = mode === "overview" ? height * 0.05 - scale * y0 : Math.max(24, height * 0.08) - scale * y0;
  svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

async function loadManifest() {
  const response = await fetch(publicUrl("data/kg-examples/manifest.json"));
  if (!response.ok) throw new Error(`Could not load manifest (${response.status})`);
  return response.json();
}

async function loadExample(entry) {
  const response = await fetch(publicUrl(`data/kg-examples/${entry.path}`));
  if (!response.ok) throw new Error(`Could not load example (${response.status})`);
  return response.json();
}

function wireControls(manifest) {
  const selectEl = document.getElementById("kgExample");
  for (const ex of manifest.examples) {
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = ex.title;
    selectEl.appendChild(opt);
  }
  selectEl.addEventListener("change", async () => {
    const entry = manifest.examples.find((e) => e.id === selectEl.value);
    if (entry) await bootExample(entry);
  });
  document.querySelectorAll("[data-patient]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-patient]").forEach((b) => b.classList.remove("is-on"));
      btn.classList.add("is-on");
      state.patientFilter = btn.dataset.patient;
      state.highlight = null;
      render();
    });
  });
  document.getElementById("kgSearch").addEventListener("input", (ev) => {
    state.search = ev.target.value.trim().toLowerCase();
    render();
  });
  document.getElementById("kgOntology").addEventListener("change", (ev) => {
    state.ontologyFilter = ev.target.value;
    render();
  });
  document.getElementById("kgCollapseNodes").addEventListener("change", (ev) => {
    state.collapseArchetypeNodes = ev.target.checked;
    render();
    fitGraph();
  });
  document.getElementById("kgCollapseOntology").addEventListener("change", (ev) => {
    state.collapseOntologyBelow = ev.target.checked ? 1 : 9;
    render();
    fitGraph();
  });
  document.getElementById("kgFit").addEventListener("click", () => fitGraph("readable"));
  document.getElementById("kgOverview").addEventListener("click", () => fitGraph("overview"));
  document.getElementById("kgClearSel").addEventListener("click", () => selectNode(null));
}

async function bootExample(entry) {
  state.raw = await loadExample(entry);
  state.nodeById = new Map(state.raw.nodes.map((n) => [n.id, n]));
  computeSharedNodes();
  state.selectedId = null;
  state.highlight = null;
  render();
  renderDetail(null);
  requestAnimationFrame(() => fitGraph("readable"));
}

function initSvg() {
  svg = d3.select("#kgSvg");
  tooltip = document.getElementById("kgTooltip");
  detailEl = document.getElementById("kgDetail");
  statusEl = document.getElementById("kgStatus");
  zoom = d3.zoom().scaleExtent([0.08, 4]).on("zoom", (event) => gRoot.attr("transform", event.transform));
  svg.call(zoom);
  gRoot = svg.append("g");
  gBands = gRoot.append("g");
  gLinks = gRoot.append("g");
  gNodes = gRoot.append("g").attr("class", "kg-nodes");
  gNodes
    .on("mouseover", function h(event) {
      showTooltip(event, d3.select(this).datum().node);
    })
    .on("mousemove", (event) => {
      tooltip.style.left = `${event.clientX + 12}px`;
      tooltip.style.top = `${event.clientY + 12}px`;
    })
    .on("mouseout", hideTooltip)
    .on("click", function c(event) {
      event.stopPropagation();
      selectNode(d3.select(this).datum().id);
    });
  svg.on("click", () => selectNode(null));
  document.getElementById("kgZoomIn").addEventListener("click", () => svg.transition().call(zoom.scaleBy, 1.25));
  document.getElementById("kgZoomOut").addEventListener("click", () => svg.transition().call(zoom.scaleBy, 0.8));
}

async function main() {
  initSvg();
  const manifest = await loadManifest();
  wireControls(manifest);
  const first = manifest.examples[0];
  if (first) {
    document.getElementById("kgExample").value = first.id;
    await bootExample(first);
  }
}

main().catch((err) => {
  const el = document.getElementById("kgError");
  el.hidden = false;
  el.textContent = err instanceof Error ? err.message : String(err);
});
