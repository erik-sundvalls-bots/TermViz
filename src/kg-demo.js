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
import { loadExampleTerminologyCache } from "./kg-cache.js";
import { graphShortLabel, nodeTooltipLines, archetypeClinicalLabel } from "./kg-labels.js";
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
  return graphShortLabel(node);
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
    showLabels: state.showLabels,
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

  const linkData = state.layout.links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target));
  const linkJoin = gLinks.selectAll("g.kg-link-wrap").data(linkData, (d) => `${d.source}|${d.target}`);
  linkJoin.exit().remove();
  const linkEnter = linkJoin.enter().append("g").attr("class", "kg-link-wrap");
  linkEnter.append("path").attr("class", "tangle-halo");
  linkEnter.append("path").attr("class", "force-link sugi-link");
  linkEnter
    .merge(linkJoin)
    .classed("is-hl", (d) => dim && dim.has(d.source) && dim.has(d.target))
    .classed("is-dim", (d) => dim && !(dim.has(d.source) && dim.has(d.target)))
    .classed("is-shared-link", (d) => state.sharedNodes.has(d.source) && state.sharedNodes.has(d.target))
    .each(function drawLink(d) {
      const g = d3.select(this);
      const p = linkPath(d.points);
      g.select(".tangle-halo").attr("d", p);
      g.select(".sugi-link").attr("d", p);
    });

  const join = gNodes.selectAll("g.force-node").data(nodes, (d) => d.id);
  join.exit().remove();
  const enter = join.enter().append("g").attr("class", "force-node kg-node");
  enter.append("circle").attr("class", "node-disk");
  enter.append("circle").attr("class", "node-hit");
  enter.append("text").attr("class", "force-label shadow");
  enter.append("text").attr("class", "force-label ink kg-node-label");

  const merged = enter.merge(join);
  merged
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .classed("is-hl", (d) => dim && dim.has(d.id))
    .classed("is-dim", (d) => dim && !dim.has(d.id))
    .classed("is-shared", (d) => state.sharedNodes.has(d.id))
    .classed("is-picked", (d) => state.cherryPicks.has(d.id))
    .classed("is-hover", (d) => state.hoverId === d.id)
    .classed("is-labeled", (d) => labelVisible(d))
  .each(function paint(d) {
      const g = d3.select(this);
      const node = d.node;
      const r = d.layoutRadius || 9;
      const stroke = state.sharedNodes.has(d.id) ? "#0b4f4d" : state.cherryPicks.has(d.id) ? "#b45309" : "#0f6e6b";
      g.select(".node-disk")
        .attr("r", d.isConcept ? r : Math.max(7, Math.min(10, r)))
        .attr("fill", nodeFill(node))
        .attr("stroke", stroke)
        .attr("stroke-width", state.sharedNodes.has(d.id) || state.cherryPicks.has(d.id) ? 2.2 : 1.6);
      g.select(".node-hit").attr("r", Math.max(r, 12));
      const show = labelVisible(d);
      const text = shortLabel(node);
      const lx = d.isConcept ? r + 5 : 0;
      const anchor = d.isConcept ? "start" : "middle";
      for (const sel of [g.select(".shadow"), g.select(".kg-node-label")]) {
        sel
          .classed("is-off", !show)
          .attr("opacity", show ? 1 : 0)
          .attr("x", lx)
          .attr("y", 4)
          .attr("text-anchor", anchor)
          .text(text);
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
      g.selectAll("rect")
        .data([0])
        .join("rect")
        .attr("class", "kg-layer-band")
        .attr("x", minX)
        .attr("y", y)
        .attr("width", maxX - minX)
        .attr("height", h)
        .attr("rx", 22)
        .attr("ry", 22);
      g.selectAll("text")
        .data([0])
        .join("text")
        .attr("class", "kg-band-label")
        .attr("x", minX + 12)
        .attr("y", y + 15)
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
  if (node.type === "archetype") return archetypeClinicalLabel(node);
  return node.display_sv || node.display || node.name || node.id;
}

let lastTooltipEvent = null;
function showTooltipLast(node) {
  if (!lastTooltipEvent || !node) return;
  tooltip.textContent = nodeTooltipLines(node).join("\n");
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
    node.archetype_id && ["Archetype", node.archetype_id],
    node.rm_type && ["RM type", node.rm_type],
    node.concept_text && ["Concept", node.concept_text],
    node.display_sv && ["Display (sv)", node.display_sv],
    node.code && ["Code", node.code],
    node.path && ["Path", node.path],
  ].filter(Boolean);

  let lookupBlock = "";
  if (node.type === "concept" && node.system && node.code) {
    lookupBlock =
      '<p id="kgLookupStatus">Loading terminology (bundled cache)…</p><dl id="kgLookupBody" class="kg-detail"></dl><button type="button" class="kg-btn" id="kgLiveLookup">Refresh live from Ontoserver</button>';
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
      const record = await lookupTerminology(node.system, node.code, {
        displayLanguage: node.display_sv ? "sv" : undefined,
      });
      loadReporter?.done("terminology", record.error ? "lookup returned error" : record.display || "OK");
      status.textContent = record.error
        || (record.fromBundle ? "Bundled cache (offline)." : record.fromCache ? "Session cache." : "Live Ontoserver lookup.");
      if (!record.error) {
        body.innerHTML = `<dt>Display</dt><dd>${record.display || "—"}</dd><dt>Parents</dt><dd>${(record.parents || []).join(", ") || "—"}</dd>`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      loadReporter?.fail("terminology", msg, `${node.system} ${node.code}`);
      status.textContent = msg;
      status.className = "kg-error";
    }
    document.getElementById("kgLiveLookup")?.addEventListener("click", async () => {
      const record = await lookupTerminology(node.system, node.code, {
        displayLanguage: node.display_sv ? "sv" : undefined,
        live: true,
      });
      status.textContent = record.error ? record.error : "Live Ontoserver lookup.";
      if (!record.error) {
        body.innerHTML = `<dt>Display</dt><dd>${record.display || "—"}</dd><dt>Parents</dt><dd>${(record.parents || []).join(", ") || "—"}</dd>`;
      }
    });
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

const MIN_LABEL_SCALE = 10 / 11;

function fitGraph(mode = "readable") {
  const nodes = state.layout?.nodes || [];
  if (!nodes.length) return;
  const padX = 40;
  const padY = 36;
  const x0 = Math.min(...nodes.map((n) => n.x - n.width / 2)) - padX;
  const x1 = Math.max(...nodes.map((n) => n.x + n.width / 2)) + padX;
  const y0 = Math.min(...nodes.map((n) => n.y - n.height / 2)) - padY;
  const y1 = Math.max(...nodes.map((n) => n.y + n.height / 2)) + padY;
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  const graphW = x1 - x0;
  const graphH = y1 - y0;
  const scaleX = (width * 0.94) / graphW;
  const scaleY = (height * 0.94) / graphH;
  let scale;
  if (mode === "overview") {
    scale = Math.min(scaleX, scaleY);
  } else {
    scale = Math.max(scaleX, MIN_LABEL_SCALE);
    const maxFit = Math.min(scaleX, scaleY * 1.15);
    if (scale > maxFit) scale = maxFit;
  }
  scale = Math.min(2.6, Math.max(MIN_LABEL_SCALE, scale));
  const tx = width / 2 - scale * ((x0 + x1) / 2);
  const ty = mode === "overview"
    ? height / 2 - scale * ((y0 + y1) / 2)
    : padY - scale * y0;
  svg.classed("kg-fit-read", mode === "readable");
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
  loadReporter?.start("cache", "Terminology cache", `${entry.id}/terminology-cache.json`);
  await loadExampleTerminologyCache(entry);
  loadReporter?.done("cache", "bundled concepts for offline render");
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
  const cxNote = cx
    ? ` · crossings ${cx.naive}→${cx.afterSweeps}→${cx.afterDag}`
    : "";
  loadReporter?.done("layout", `${state.layout?.nodes?.length ?? 0} nodes${cxNote}`);
  renderDetail(null);
  requestAnimationFrame(() => fitGraph("readable"));
  loadReporter?.finish();
}

function initSvg() {
  svg = d3.select("#kgSvg");
  svg.classed("is-sugiyama", true);
  document.getElementById("kgViewport")?.classList.add("is-sugiyama");
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
