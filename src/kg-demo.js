import * as d3 from "d3";
import { publicUrl } from "./ips-model.js";
import {
  adjacencyFromPairs,
  collectDownstream,
  collectUpstream,
  layoutPairs,
  runSugiyama,
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

const NODE_FILL = {
  concept: "#7eb8da",
  expression: "#5a9fd4",
  template: "#5ba865",
  section: "#8cc38c",
  archetype: "#9b7bb8",
  archetype_node: "#c4b0d9",
  patient: "#e8a87c",
  composition_instance: "#d4826a",
  entry_instance: "#e09b7a",
  element_instance: "#efb08f",
};

const LAYER_LABELS = [
  { types: ["concept", "expression"], label: "Terminology & expressions" },
  { types: ["template"], label: "Template" },
  { types: ["section"], label: "Sections" },
  { types: ["archetype"], label: "Archetypes" },
  { types: ["archetype_node"], label: "Archetype nodes" },
  { types: ["patient", "composition_instance", "entry_instance", "element_instance"], label: "Patients & instances" },
];

const state = {
  raw: null,
  nodeById: new Map(),
  positions: new Map(),
  layoutLinks: [],
  pairs: [],
  adjacency: null,
  selectedId: null,
  highlight: null,
  patientFilter: "both",
  layerFilters: new Set(LAYER_LABELS.map((_, i) => i)),
  ontologyFilter: "all",
  search: "",
  layoutFallback: false,
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

async function loadManifest() {
  const response = await fetch(publicUrl("data/kg-examples/manifest.json"));
  if (!response.ok) throw new Error(`Could not load manifest (${response.status})`);
  return response.json();
}

async function loadExample(entry) {
  const response = await fetch(publicUrl(`data/kg-examples/${entry.path}`));
  if (!response.ok) throw new Error(`Could not load ${entry.path} (${response.status})`);
  return response.json();
}

function instanceOwnedByPatient(nodeId) {
  if (nodeId.startsWith("inst:eva-") || nodeId.startsWith("elem:eva-") || nodeId === "composition:eva-holmgren-ips-20260315" || nodeId === "patient:eva-holmgren") return "eva";
  if (nodeId.startsWith("inst:lars-") || nodeId.startsWith("elem:lars-") || nodeId === "composition:lars-nystrom-ips-20260402" || nodeId === "patient:lars-nystrom") return "lars";
  return null;
}

function nodeLabel(node) {
  if (node.display_sv || node.display) return node.display_sv || node.display;
  if (node.name) return node.name;
  if (node.path) return node.path.split("/").pop() || node.path;
  if (node.code) return String(node.code);
  const short = node.id.split(":").slice(1).join(":");
  return short.length > 42 ? `${short.slice(0, 40)}…` : short;
}

function nodeMatchesSearch(node, query) {
  if (!query) return true;
  const hay = [
    node.id,
    node.display,
    node.display_sv,
    node.display_en,
    node.name,
    node.path,
    node.code,
    node.rm_type,
    node.archetype_id,
    node.verification,
    node.ontology,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(query);
}

function layerIndexForNode(node) {
  return LAYER_LABELS.findIndex((band) => band.types.includes(node.type));
}

function nodePassesFilters(node) {
  const li = layerIndexForNode(node);
  if (li >= 0 && !state.layerFilters.has(li)) return false;
  if (state.ontologyFilter !== "all" && (node.type === "concept" || node.type === "expression")) {
    if ((node.ontology || "sct") !== state.ontologyFilter) return false;
  }
  const owner = instanceOwnedByPatient(node.id);
  if (owner && state.patientFilter !== "both" && owner !== state.patientFilter) return false;
  if (!nodeMatchesSearch(node, state.search)) return false;
  return true;
}

function visibleNodeSet() {
  const visible = new Set();
  for (const node of state.raw.nodes) {
    if (nodePassesFilters(node)) visible.add(node.id);
  }
  return visible;
}

function badgeHtml(verification) {
  if (!verification) return "";
  const cls = VERIFICATION_CLASS[verification] || "v-prop";
  return `<span class="kg-badge ${cls}" title="${verification}">${verification}</span>`;
}

function layoutGraph() {
  const visible = visibleNodeSet();
  const edges = state.raw.edges.filter((e) => visible.has(e.from) && visible.has(e.to));
  state.pairs = layoutPairs(edges, state.nodeById);
  state.adjacency = adjacencyFromPairs(state.pairs);

  const labelMax = 48;
  const { nodes: laid, links, fallback } = runSugiyama(state.pairs, {
    nodeWidth: labelMax,
    nodeHeight: 10,
    gap: [14, 32],
  });
  state.layoutFallback = fallback;
  state.layoutLinks = links;

  state.positions = new Map();
  for (const n of laid) {
    const raw = state.nodeById.get(n.id);
    state.positions.set(n.id, { ...n, node: raw });
  }
}

function sugiyamaPath(points) {
  if (!points || points.length < 2) return "";
  return d3.line().curve(d3.curveBumpY)(points.slice().reverse());
}

function render() {
  layoutGraph();
  const visible = visibleNodeSet();

  const nodes = [...state.positions.values()].filter((n) => visible.has(n.id));
  const nodeIds = new Set(nodes.map((n) => n.id));

  const highlight = state.highlight || (state.selectedId ? new Set([state.selectedId]) : null);

  const linkSel = gLinks.selectAll("path").data(
    state.layoutLinks.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target)),
    (d) => `${d.source}|${d.target}`,
  );
  linkSel.exit().remove();
  linkSel
    .enter()
    .append("path")
    .attr("class", "kg-link")
    .merge(linkSel)
    .attr("d", (d) => sugiyamaPath(d.points))
    .classed("is-hl", (d) => highlight && highlight.has(d.source) && highlight.has(d.target))
    .classed("is-dim", (d) => highlight && !(highlight.has(d.source) && highlight.has(d.target)));

  const shape = (node) => (node.type === "concept" || node.type === "expression" ? "circle" : "rect");

  const nodeJoin = gNodes.selectAll("g.kg-node").data(nodes, (d) => d.id);
  nodeJoin.exit().remove();
  const enter = nodeJoin.enter().append("g").attr("class", "kg-node");
  enter.each(function each(d) {
    const g = d3.select(this);
    const raw = d.node;
    if (shape(raw) === "circle") {
      g.append("circle").attr("r", 5);
    } else {
      g.append("rect").attr("width", 8).attr("height", 8).attr("x", -4).attr("y", -4).attr("rx", 1);
    }
  });

  enter
    .merge(nodeJoin)
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .classed("is-hl", (d) => highlight && highlight.has(d.id))
    .classed("is-dim", (d) => highlight && !highlight.has(d.id))
    .classed("is-shared", (d) => {
      if (state.patientFilter === "both") return false;
      const t = d.node.type;
      return t !== "patient" && t !== "composition_instance" && t !== "entry_instance" && t !== "element_instance";
    })
    .each(function paint(d) {
      const kind = shape(d.node);
      d3.select(this).select(kind).attr("fill", NODE_FILL[d.node.type] || "#ccc");
    });

  drawLayerBands(nodes);
  updateStatus(nodes.length);
}

function drawLayerBands(nodes) {
  if (!nodes.length) {
    gBands.selectAll("*").remove();
    return;
  }
  const xs = nodes.map((n) => n.x);
  const minX = Math.min(...xs) - 80;
  const maxX = Math.max(...xs) + 80;
  const byLayer = new Map();
  for (const n of nodes) {
    const y = Math.round(n.y);
    if (!byLayer.has(y)) byLayer.set(y, []);
    byLayer.get(y).push(n);
  }
  const layers = [...byLayer.entries()].sort((a, b) => a[0] - b[0]);
  const bands = layers.map(([y, list], index) => ({
    y: y - 18,
    height: 36,
    label: LAYER_LABELS[layerIndexForNode(list[0].node)]?.label || `Layer ${index}`,
    index,
  }));

  const sel = gBands.selectAll("g").data(bands, (d) => d.index);
  sel.exit().remove();
  const ent = sel.enter().append("g");
  ent.append("rect").attr("class", "kg-layer-band");
  ent.append("text").attr("class", "kg-label").attr("text-anchor", "start");
  ent
    .merge(sel)
    .each(function update(d) {
      d3.select(this).select("rect")
        .attr("x", minX)
        .attr("y", d.y)
        .attr("width", maxX - minX)
        .attr("height", d.height);
      d3.select(this).select("text")
        .attr("x", minX + 6)
        .attr("y", d.y + 12)
        .text(d.label);
    });
}

function updateStatus(visibleCount) {
  const total = state.raw?.nodes?.length ?? 0;
  const fallback = state.layoutFallback ? " (decross two-layer fallback)" : "";
  statusEl.textContent = `${visibleCount} / ${total} nodes visible · Sugiyama layered layout${fallback}`;
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
    node.display_en && ["Display (en)", node.display_en],
    node.display && !node.display_sv && ["Display", node.display],
    node.code && ["Code", node.code],
    node.system && ["System", node.system],
    node.path && ["Path", node.path],
    node.rm_type && ["RM type", node.rm_type],
    node.archetype_id && ["Archetype", node.archetype_id],
    node.ontology && ["Ontology", node.ontology],
  ].filter(Boolean);

  let lookupBlock = "";
  if (node.type === "concept" && node.system && node.code) {
    lookupBlock = '<p class="kg-error" id="kgLookupStatus">Loading terminology…</p><dl id="kgLookupBody"></dl>';
    if (node.system.includes("snomed")) {
      lookupBlock += '<button type="button" class="kg-btn" id="kgExpandParents">Expand is-a parents (server)</button> ';
      lookupBlock += '<button type="button" class="kg-btn" id="kgListChildren">List SNOMED children</button>';
    }
  }

  detailEl.innerHTML = `
    <h2>${badgeHtml(node.verification)} ${nodeLabel(node)}</h2>
  <dl class="kg-detail">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
  ${lookupBlock}
  `;

  if (node.type === "concept" && node.system && node.code) {
    const status = document.getElementById("kgLookupStatus");
    const body = document.getElementById("kgLookupBody");
  try {
    const lang = node.display_sv ? "sv" : undefined;
    const record = await lookupTerminology(node.system, node.code, { displayLanguage: lang });
      if (record.error) {
        status.textContent = record.error;
        status.className = "kg-error";
      } else {
        status.textContent = record.fromCache ? "From cache / bundled." : "Live Ontoserver lookup.";
        status.className = "";
        body.innerHTML = `
          <dt>Lookup display</dt><dd>${record.display || "—"}</dd>
          <dt>Parents</dt><dd>${(record.parents || []).join(", ") || "—"}</dd>
          <dt>Inactive</dt><dd>${record.inactive ? "yes" : "no"}</dd>
        `;
      }
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : "Lookup failed";
      status.className = "kg-error";
    }

    document.getElementById("kgExpandParents")?.addEventListener("click", async () => {
      const parents = [];
      for (const p of node.parents || []) {
        const r = await expandSnomedParents(p);
        parents.push(`${p}: ${r.display || r.error || "?"}`);
      }
      body.innerHTML += `<dt>Graph parents expanded</dt><dd>${parents.join("<br>") || "—"}</dd>`;
    });

    document.getElementById("kgListChildren")?.addEventListener("click", async () => {
      try {
        const kids = await directChildren(node.code);
        body.innerHTML += `<dt>Children (server)</dt><dd>${kids.slice(0, 40).map((k) => `${k.code}: ${k.display}`).join("<br>") || "—"}${kids.length > 40 ? `<br>…and ${kids.length - 40} more` : ""}</dd>`;
      } catch (err) {
        body.innerHTML += `<dt>Children</dt><dd class="kg-error">${err.message}</dd>`;
      }
    });
  }
}

function showTooltip(event, node) {
  const lines = [
    nodeLabel(node),
    node.id,
    node.verification && `verification: ${node.verification}`,
    node.path,
    node.code && `code: ${node.code}`,
    node.rm_type && `rm: ${node.rm_type}`,
  ].filter(Boolean);
  tooltip.textContent = lines.join("\n");
  tooltip.classList.add("is-on");
  tooltip.style.left = `${event.clientX + 12}px`;
  tooltip.style.top = `${event.clientY + 12}px`;
}

function hideTooltip() {
  tooltip.classList.remove("is-on");
}

function fitGraph() {
  const nodes = [...state.positions.values()];
  if (!nodes.length) return;
  const pad = 40;
  const x0 = Math.min(...nodes.map((n) => n.x)) - pad;
  const x1 = Math.max(...nodes.map((n) => n.x)) + pad;
  const y0 = Math.min(...nodes.map((n) => n.y)) - pad;
  const y1 = Math.max(...nodes.map((n) => n.y)) + pad;
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  const scale = Math.min(0.95, 0.9 / Math.max((x1 - x0) / width, (y1 - y0) / height));
  const tx = width / 2 - (scale * (x0 + x1)) / 2;
  const ty = height / 2 - (scale * (y0 + y1)) / 2;
  svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function wireControls(manifest, selectEl) {
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

  document.querySelectorAll("[data-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      const idx = Number(input.dataset.layer);
      if (input.checked) state.layerFilters.add(idx);
      else state.layerFilters.delete(idx);
      render();
    });
  });

  document.getElementById("kgFit").addEventListener("click", fitGraph);
  document.getElementById("kgClearSel").addEventListener("click", () => selectNode(null));
}

async function bootExample(entry) {
  const data = await loadExample(entry);
  state.raw = data;
  state.nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  state.selectedId = null;
  state.highlight = null;
  render();
  renderDetail(null);
  requestAnimationFrame(() => fitGraph());
}

function initSvg() {
  const viewport = document.getElementById("kgViewport");
  svg = d3.select("#kgSvg");
  tooltip = document.getElementById("kgTooltip");
  detailEl = document.getElementById("kgDetail");
  statusEl = document.getElementById("kgStatus");

  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  zoom = d3.zoom().scaleExtent([0.02, 8]).on("zoom", (event) => {
    gRoot.attr("transform", event.transform);
  });
  svg.call(zoom);

  gRoot = svg.append("g");
  gBands = gRoot.append("g").attr("class", "kg-bands");
  gLinks = gRoot.append("g").attr("class", "kg-links");
  gNodes = gRoot.append("g").attr("class", "kg-nodes");

  gNodes
    .on("mouseover", function onOver(event) {
      const d = d3.select(this).datum();
      if (d) showTooltip(event, d.node);
    })
    .on("mousemove", (event) => {
      tooltip.style.left = `${event.clientX + 12}px`;
      tooltip.style.top = `${event.clientY + 12}px`;
    })
    .on("mouseout", hideTooltip)
    .on("click", function onClick(event) {
      event.stopPropagation();
      const d = d3.select(this).datum();
      if (d) selectNode(d.id);
    });

  svg.on("click", () => selectNode(null));

  document.getElementById("kgZoomIn").addEventListener("click", () => svg.transition().call(zoom.scaleBy, 1.3));
  document.getElementById("kgZoomOut").addEventListener("click", () => svg.transition().call(zoom.scaleBy, 0.75));
}

async function main() {
  initSvg();
  const manifest = await loadManifest();
  const selectEl = document.getElementById("kgExample");
  wireControls(manifest, selectEl);
  const first = manifest.examples[0];
  if (first) {
    selectEl.value = first.id;
    await bootExample(first);
  }
}

main().catch((err) => {
  const el = document.getElementById("kgError");
  el.hidden = false;
  el.textContent = err instanceof Error ? err.message : String(err);
});
