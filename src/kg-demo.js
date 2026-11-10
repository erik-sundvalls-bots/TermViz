import * as d3 from "d3";
import { publicUrl } from "./ips-model.js";
import {
  adjacencyFromPairs,
  bandIndexForNode,
  collectDownstream,
  collectUpstream,
  runBandedLayout,
} from "./kg-layout.js";
import { sugiyamaLinkPath } from "./sugiyama-dag.js";
import {
  applyUrlFocus,
  buildChildrenMap,
  buildParentMap,
  collectAncestors,
  decodeFocusHash,
  decodeFocusQuery,
  isInstanceNode,
  loadSavedLists,
  persistSavedLists,
} from "./kg-focus.js";
import { createLoadReporter, fetchWithProgress } from "./kg-load-progress.js";
import { directChildren, expandSnomedParents, lookupTerminology } from "./kg-terminology.js";

let loadReporter = null;

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

const PATIENT_FILL = { eva: "#c45c4a", lars: "#2f6fad" };

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
  exampleId: null,
  nodeById: new Map(),
  parentMap: null,
  childMap: null,
  layout: null,
  pairs: [],
  adjacency: null,
  selectedId: null,
  highlight: null,
  hoverId: null,
  hoverSet: null,
  patientFilter: "both",
  ontologyFilter: "all",
  search: "",
  collapseArchetypeNodes: true,
  collapseOntologyBelow: 1,
  sharedNodes: new Set(),
  showLabels: true,
  pickMode: true,
  cherryFocus: false,
  cherryPicks: new Set(),
  savedLists: loadSavedLists(),
  focusPresets: [],
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
let pickListEl;

function shortLabel(node) {
  const text = node.display_sv || node.display || node.name;
  if (text) return text.length > 28 ? `${text.slice(0, 26)}…` : text;
  if (node.code) return String(node.code);
  if (node.path) {
    const leaf = node.path.split("/").pop() || "";
    return leaf.length > 28 ? `${leaf.slice(0, 26)}…` : leaf;
  }
  const id = node.id.split(":").slice(1).join(":");
  return id.length > 26 ? `${id.slice(0, 24)}…` : id;
}

function instanceOwnedByPatient(nodeId) {
  if (nodeId.includes("eva-holmgren") || nodeId.startsWith("inst:eva-")) return "eva";
  if (nodeId.includes("lars-nystrom") || nodeId.startsWith("inst:lars-")) return "lars";
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
    node.id, node.display, node.display_sv, node.name,
    node.path, node.code, node.rm_type, node.verification, node.ontology,
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

function focusAncestorSet() {
  if (!state.cherryFocus || state.cherryPicks.size === 0) return null;
  return collectAncestors(state.cherryPicks, state.parentMap);
}

function computeSharedNodes() {
  const touched = { eva: new Set(), lars: new Set() };
  for (const edge of state.raw.edges) {
    const p1 = instanceOwnedByPatient(edge.from);
    const p2 = instanceOwnedByPatient(edge.to);
    if (p1 && (edge.type === "instance_of" || edge.type === "coded_as" || edge.type === "contains")) {
      touched[p1].add(edge.to);
    }
    if (p2 && (edge.type === "instance_of" || edge.type === "coded_as")) touched[p2].add(edge.from);
  }
  state.sharedNodes = new Set([...touched.eva].filter((id) => touched.lars.has(id) && !instanceOwnedByPatient(id)));
}

function layoutGraph() {
  let nodes = state.raw.nodes.filter(passesUiFilters);
  const focusSet = focusAncestorSet();
  if (focusSet) nodes = nodes.filter((n) => focusSet.has(n.id));

  const ids = new Set(nodes.map((n) => n.id));
  const edges = state.raw.edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  const collapseNodes = focusSet ? false : state.collapseArchetypeNodes;
  const collapseOntology = focusSet ? 9 : state.collapseOntologyBelow;

  state.layout = runBandedLayout({
    nodes,
    edges,
    nodeById: state.nodeById,
    labelFor: shortLabel,
    collapseOntologyBelow: collapseOntology,
    collapseArchetypeNodes: collapseNodes,
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

function activeDimSet() {
  if (state.hoverSet) return state.hoverSet;
  if (state.highlight) return state.highlight;
  return null;
}

function labelVisible(d) {
  if (state.showLabels) return true;
  if (!state.hoverSet) return false;
  return state.hoverSet.has(d.id);
}

function linkPath(points) {
  if (!points || points.length < 2) return "";
  if (points.length >= 3) return sugiyamaLinkPath(points);
  return d3.line().curve(d3.curveBumpY)(points.slice().reverse());
}

function renderPickList() {
  if (!pickListEl) return;
  const items = [...state.cherryPicks].map((id) => {
    const n = state.nodeById.get(id);
    const label = n ? shortLabel(n) : id;
    return `<li><button type="button" class="kg-pick-remove" data-id="${id}" aria-label="Remove">×</button> <span>${label}</span><code>${id}</code></li>`;
  });
  pickListEl.innerHTML = items.length
    ? `<ul class="kg-pick-ul">${items.join("")}</ul>`
    : "<p class='kg-muted'>Click patient instance nodes to add picks.</p>";
  pickListEl.querySelectorAll(".kg-pick-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.cherryPicks.delete(btn.dataset.id);
      applyUrlFocus(state.cherryPicks);
      renderPickList();
      render();
      if (state.cherryFocus) fitGraph("readable");
    });
  });
}

function render() {
  layoutGraph();
  const nodes = state.layout.nodes;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const dim = activeDimSet();

  gLinks
    .selectAll("path")
    .data(state.layout.links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target)), (d) => `${d.source}|${d.target}`)
    .join("path")
    .attr("class", "kg-link")
    .attr("d", (d) => linkPath(d.points))
    .classed("is-hl", (d) => dim && dim.has(d.source) && dim.has(d.target))
    .classed("is-dim", (d) => dim && !(dim.has(d.source) && dim.has(d.target)))
    .classed("is-shared-link", (d) => state.sharedNodes.has(d.source) && state.sharedNodes.has(d.target));

  const join = gNodes.selectAll("g.kg-node").data(nodes, (d) => d.id);
  join.exit().remove();
  const enter = join.enter().append("g").attr("class", "kg-node");
  enter.append("rect").attr("class", "kg-shape kg-pill").attr("rx", 4);
  enter.append("circle").attr("class", "kg-shape kg-dot");
  enter.append("text").attr("class", "kg-node-label");

  const merged = enter.merge(join);
  merged
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .classed("is-hl", (d) => dim && dim.has(d.id))
    .classed("is-dim", (d) => dim && !dim.has(d.id))
    .classed("is-shared", (d) => state.sharedNodes.has(d.id))
    .classed("is-picked", (d) => state.cherryPicks.has(d.id))
    .classed("is-hover", (d) => state.hoverId === d.id)
    .each(function paint(d) {
      const g = d3.select(this);
      const node = d.node;
      const isConcept = node.type === "concept" || node.type === "expression";
      const pill = g.select(".kg-pill");
      const dot = g.select(".kg-dot");
      const label = g.select(".kg-node-label");
      const show = labelVisible(d);
      label
        .classed("is-off", !show)
        .attr("opacity", show ? 1 : 0);
      if (isConcept) {
        pill.attr("width", 0).attr("height", 0);
        dot
          .attr("r", 9)
          .attr("fill", nodeFill(node))
          .attr("stroke", state.sharedNodes.has(d.id) ? "#0b4f4d" : "#1c2430");
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
          .attr("stroke", state.sharedNodes.has(d.id) ? "#0b4f4d" : state.cherryPicks.has(d.id) ? "#b45309" : "#1c2430")
          .attr("stroke-width", state.sharedNodes.has(d.id) || state.cherryPicks.has(d.id) ? 2.4 : 1);
        label.attr("x", 0).attr("y", 4).attr("text-anchor", "middle").text(shortLabel(node));
      }
    });

  drawBandGuides(nodes);
  updateStatus(nodes.length);
  renderPickList();
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
  gBands
    .selectAll("g")
    .data([...bands.values()].sort((a, b) => a.band - b.band), (d) => d.band)
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
  const bits = [];
  if (state.cherryFocus) bits.push(`focus ${state.cherryPicks.size} picks`);
  if (!state.showLabels) bits.push("labels hidden");
  statusEl.textContent = `${visibleCount} / ${total} nodes${bits.length ? ` · ${bits.join(" · ")}` : ""}`;
}

function setHover(id) {
  if (!id) {
    state.hoverId = null;
    state.hoverSet = null;
    render();
    hideTooltip();
    return;
  }
  state.hoverId = id;
  const parents = state.adjacency?.parents.get(id) || new Set();
  const children = state.adjacency?.children.get(id) || new Set();
  state.hoverSet = new Set([id, ...parents, ...children]);
  render();
  const node = state.nodeById.get(id);
  if (node) showTooltipLast(node);
}

function toggleCherryPick(id) {
  if (state.cherryPicks.has(id)) state.cherryPicks.delete(id);
  else state.cherryPicks.add(id);
  applyUrlFocus(state.cherryPicks);
  render();
  if (state.cherryFocus) fitGraph("readable");
}

function clearCherryPicks() {
  state.cherryPicks.clear();
  applyUrlFocus(state.cherryPicks);
  render();
}

function loadCherryIds(ids) {
  state.cherryPicks = new Set(ids.filter((id) => state.nodeById.has(id)));
  applyUrlFocus(state.cherryPicks);
  renderPickList();
  render();
  if (state.cherryFocus) fitGraph("readable");
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
  state.hoverSet = null;
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

let lastTooltipEvent = null;
function showTooltipLast(node) {
  if (!lastTooltipEvent || !node) return;
  tooltip.textContent = [nodeLabel(node), node.id, node.verification].filter(Boolean).join("\n");
  tooltip.classList.add("is-on");
  tooltip.style.left = `${lastTooltipEvent.clientX + 12}px`;
  tooltip.style.top = `${lastTooltipEvent.clientY + 12}px`;
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
      loadReporter?.start("terminology", "Terminology lookup", `${node.system} ${node.code}`);
      const record = await lookupTerminology(node.system, node.code, { displayLanguage: node.display_sv ? "sv" : undefined });
      loadReporter?.done("terminology", record.error ? "lookup returned error" : record.display || "OK");
      status.textContent = record.error || (record.fromCache ? "From cache." : "Live Ontoserver lookup.");
      if (!record.error) {
        body.innerHTML = `<dt>Display</dt><dd>${record.display || "—"}</dd><dt>Parents</dt><dd>${(record.parents || []).join(", ") || "—"}</dd>`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      loadReporter?.fail("terminology", msg, `${node.system} ${node.code}`);
      status.textContent = msg;
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
  let scale = mode === "overview" ? Math.min(scaleX, scaleY) : Math.min(scaleX, Math.max(0.62, scaleY));
  scale = Math.min(2.8, Math.max(0.45, scale));
  const tx = width / 2 - scale * ((x0 + x1) / 2);
  const ty = height * 0.5 - scale * ((y0 + y1) / 2);
  svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

async function loadManifest() {
  const url = publicUrl("data/kg-examples/manifest.json");
  const response = await fetchWithProgress(url, {
    reporter: loadReporter,
    stepId: "manifest",
    title: "Manifest",
    timeoutMs: 20000,
  });
  return response.json();
}

async function loadExample(entry) {
  const url = publicUrl(`data/kg-examples/${entry.path}`);
  const response = await fetchWithProgress(url, {
    reporter: loadReporter,
    stepId: "example",
    title: "Example graph JSON",
    timeoutMs: 60000,
  });
  return response.json();
}

async function loadSchema(schemaPath) {
  if (!schemaPath) return null;
  const clean = String(schemaPath).replace(/^\.\//, "").replace(/^\//, "");
  const url = publicUrl(`data/kg-examples/${clean}`);
  const response = await fetchWithProgress(url, {
    reporter: loadReporter,
    stepId: "schema",
    title: "JSON schema",
    timeoutMs: 20000,
  });
  return response.json();
}

function exportPicksJson() {
  const blob = new Blob([JSON.stringify({ example_id: state.exampleId, node_ids: [...state.cherryPicks] }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `kg-focus-${state.exampleId || "export"}.json`;
  a.click();
}

function importPicksJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const body = JSON.parse(String(reader.result));
      loadCherryIds(body.node_ids || []);
    } catch {
      alert("Could not parse JSON");
    }
  };
  reader.readAsText(file);
}

function wireCherryControls() {
  pickListEl = document.getElementById("kgPickList");
  document.getElementById("kgPickMode").addEventListener("click", (ev) => {
    state.pickMode = !state.pickMode;
    ev.currentTarget.classList.toggle("is-on", state.pickMode);
  });
  document.getElementById("kgCherryFocus").addEventListener("change", (ev) => {
    state.cherryFocus = ev.target.checked;
    render();
    fitGraph(state.cherryFocus ? "readable" : "overview");
  });
  document.getElementById("kgClearPicks").addEventListener("click", clearCherryPicks);
  document.getElementById("kgShowLabels").addEventListener("click", (ev) => {
    state.showLabels = !state.showLabels;
    ev.currentTarget.classList.toggle("is-on", state.showLabels);
    ev.currentTarget.textContent = state.showLabels ? "Labels on" : "Labels off";
    render();
  });
  document.getElementById("kgExportPicks").addEventListener("click", exportPicksJson);
  document.getElementById("kgImportPicks").addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (file) importPicksJson(file);
    ev.target.value = "";
  });
  document.getElementById("kgSaveList").addEventListener("click", () => {
    const name = document.getElementById("kgSaveName").value.trim();
    if (!name) return;
    state.savedLists.named[name] = { example_id: state.exampleId, node_ids: [...state.cherryPicks] };
    persistSavedLists(state.savedLists);
    refreshSavedSelect();
  });
  document.getElementById("kgLoadSaved").addEventListener("click", () => {
    const name = document.getElementById("kgSavedSelect").value;
    const entry = state.savedLists.named[name];
    if (entry) loadCherryIds(entry.node_ids || []);
  });
  document.getElementById("kgPresetSelect").addEventListener("change", (ev) => {
    const id = ev.target.value;
    const preset = state.focusPresets.find((p) => p.id === id);
    if (preset) loadCherryIds(preset.node_ids);
  });
}

function refreshSavedSelect() {
  const sel = document.getElementById("kgSavedSelect");
  sel.innerHTML = Object.keys(state.savedLists.named)
    .sort()
    .map((n) => `<option value="${n}">${n}</option>`)
    .join("");
}

function refreshPresetSelect() {
  const sel = document.getElementById("kgPresetSelect");
  sel.innerHTML = `<option value="">Suggested presets…</option>${state.focusPresets
    .map((p) => `<option value="${p.id}">${p.title}</option>`)
    .join("")}`;
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
  wireCherryControls();
}

async function bootExample(entry) {
  if (entry.schema === "template-kg-example/v1") {
    await loadSchema("schema/template-kg-example.schema.json");
  }
  state.raw = await loadExample(entry);
  state.exampleId = entry.id;
  state.nodeById = new Map(state.raw.nodes.map((n) => [n.id, n]));
  state.focusPresets = state.raw.focus_presets || [];
  state.parentMap = buildParentMap(state.raw.nodes, state.raw.edges, state.nodeById);
  state.childMap = buildChildrenMap(state.parentMap);
  computeSharedNodes();
  state.selectedId = null;
  state.highlight = null;
  state.hoverSet = null;

  const fromHash = decodeFocusHash(window.location.hash);
  const fromQuery = decodeFocusQuery(window.location.search);
  const initial = fromHash || fromQuery;
  if (initial?.length) state.cherryPicks = new Set(initial.filter((id) => state.nodeById.has(id)));
  else state.cherryPicks = new Set();

  refreshPresetSelect();
  refreshSavedSelect();
  loadReporter?.start("layout", "Layered layout", "Computing bands and positions…");
  render();
  const cx = state.layout?.crossings;
  const cxNote = cx ? ` · crossings ${cx.perBandOnly}→${cx.global}` : "";
  loadReporter?.done("layout", `${state.layout?.nodes?.length ?? 0} nodes${cxNote}`);
  renderDetail(null);
  requestAnimationFrame(() => fitGraph("readable"));
  loadReporter?.finish();
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
      lastTooltipEvent = event;
      const d = d3.select(this).datum();
      setHover(d.id);
    })
    .on("mousemove", (event) => {
      lastTooltipEvent = event;
      if (state.hoverId) showTooltipLast(state.nodeById.get(state.hoverId));
    })
    .on("mouseout", () => setHover(null))
    .on("click", function c(event) {
      event.stopPropagation();
      const d = d3.select(this).datum();
      const node = d.node;
      if (state.pickMode && isInstanceNode(node)) {
        toggleCherryPick(d.id);
        return;
      }
      selectNode(d.id);
    });

  svg.on("click", () => {
    selectNode(null);
    setHover(null);
  });

  document.getElementById("kgZoomIn").addEventListener("click", () => svg.transition().call(zoom.scaleBy, 1.25));
  document.getElementById("kgZoomOut").addEventListener("click", () => svg.transition().call(zoom.scaleBy, 0.8));
}

function reportFatal(err) {
  const el = document.getElementById("kgError");
  el.hidden = false;
  const msg = err instanceof Error ? err.message : String(err);
  el.textContent = msg;
  loadReporter?.fail("fatal", msg, err?.url || document.location.href);
}

async function main() {
  loadReporter = createLoadReporter(document.getElementById("kgAside"));
  window.addEventListener("error", (ev) => reportFatal(ev.error || ev.message));
  window.addEventListener("unhandledrejection", (ev) => reportFatal(ev.reason));

  initSvg();
  const manifest = await loadManifest();
  wireControls(manifest);
  const first = manifest.examples[0];
  if (first) {
    document.getElementById("kgExample").value = first.id;
    await bootExample(first);
  }
}

main().catch(reportFatal);
