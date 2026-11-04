import * as d3 from "d3";
import { D3_VERSION, NODE_COLORS, renderSnomedForce, renderTemplateTree } from "./termviz-2.js";
import { loadIpsModel } from "./ips-model.js";
import { BUNDLED_CONCEPTS, cachedConcept, closureToRoot, snomedBrowserUrl } from "./snomed.js";

const snomedSvg = document.querySelector("#snomedSvg");
const treeSvg = document.querySelector("#treeSvg");
const snomedEmpty = document.querySelector("#snomedEmpty");
const snomedCaption = document.querySelector("#snomedCaption");
const stats = document.querySelector("#stats");
const detail = document.querySelector("#detail");
const search = document.querySelector("#search");
const errorBox = document.querySelector("#error");
const filterButtons = [...document.querySelectorAll("[data-filter]")];

const linkOverlay = document.querySelector("#linkOverlay");

const state = {
  model: null,
  filter: "suggestions",
  query: "",
  focusId: null,
  activeIds: new Set(),
  colors: new Map(),
  colorIndex: 0,
  extraCodes: new Map(),
  snomedToken: 0,
  graph: null,
  hot: null,
};

function chip(text) {
  const span = document.createElement("span");
  span.className = "chip";
  span.innerHTML = text;
  return span;
}

function hasBinding(node) {
  return Boolean(node.bindings?.length || node.valueBindings?.length);
}

function project(node, predicate) {
  const children = node.children.map((child) => project(child, predicate)).filter(Boolean);
  if (predicate(node) || children.length) return { ...node, children, open: true };
  return null;
}

function markOpen(node, depth = 0) {
  let below = false;
  for (const child of node.children) {
    if (markOpen(child, depth + 1)) below = true;
  }
  node.open = depth < 2 || below;
  return Boolean(node.suggestions?.length) || below;
}

function displayTree() {
  const root = state.model.tree;
  const query = state.query.trim().toLowerCase();
  if (query) {
    return project(root, (node) => {
      const hay = [
        node.name,
        node.nodeId,
        node.rmType,
        node.archetypeId,
        node.section,
        ...(node.bindings || []).map((binding) => binding.code),
        ...(node.suggestions || []).map((item) => item.code),
      ].join(" ").toLowerCase();
      return hay.includes(query);
    }) || { ...root, children: [], open: true, name: "No matches" };
  }
  if (state.filter === "suggestions") {
    return project(root, (node) => Boolean(node.suggestions?.length));
  }
  if (state.filter === "bindings") {
    return project(root, (node) => hasBinding(node) || node.scopeBindings?.length);
  }
  return root;
}

function findNode(id) {
  if (!id) return null;
  let found = null;
  (function walk(node) {
    if (node.id === id) found = node;
    node.children?.forEach(walk);
  })(state.model.tree);
  return found;
}

function activeNodes() {
  return [...state.activeIds].map((id) => findNode(id)).filter(Boolean);
}

function colorFor(id) {
  if (!state.colors.has(id)) {
    state.colors.set(id, NODE_COLORS[state.colorIndex % NODE_COLORS.length]);
    state.colorIndex += 1;
  }
  return state.colors.get(id);
}

function codeLink(code) {
  const href = escapeHtml(snomedBrowserUrl(code));
  return `<a class="code-link" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(code)}</a>`;
}

function termLink(code, text) {
  const href = escapeHtml(snomedBrowserUrl(code));
  return `<a class="term" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusLabel(status) {
  if (status === "both") return ["In the OPT and the archetype", "both"];
  if (status === "missing-from-opt") return ["Added from the archetype", "added"];
  if (status === "opt-only") return ["Only in the OPT", "opt"];
  if (status === "conflict") return ["OPT and archetype disagree", "added"];
  return [status || "", ""];
}

function termFor(code, fallback) {
  const known = cachedConcept(code);
  if (known?.display && known.display !== String(code)) return known.display;
  return fallback || "Unnamed concept";
}

function bindingRows(node, rows) {
  return rows.map((binding) => {
    const [label, kind] = statusLabel(binding.status);
    const name = binding.label ? `${escapeHtml(binding.label)} · ` : "";
    const at = binding.atCode ? `<span class="at-code">${escapeHtml(binding.atCode)}</span> → ` : "";
    return `<div class="binding">
      <div>${name}${at}${codeLink(binding.code)}<div><span class="tag ${kind}">${escapeHtml(label)}</span></div></div>
      <button class="text-button" type="button" data-binding="${escapeHtml(binding.code)}" data-node="${escapeHtml(node.id)}" data-label="${escapeHtml(binding.label || node.name)}">Show</button>
    </div>`;
  }).join("");
}

function guessArticle(node, { code, rank, score, reason, term }) {
  const color = colorFor(node.id);
  const head = rank
    ? `${rank}. ${termLink(code, term)}`
    : termLink(code, term);
  const bar = Number.isFinite(score)
    ? `<div class="score" aria-label="score ${score}"><span style="width:${Math.round(score * 100)}%"></span></div>`
    : "";
  return `<article class="guess" data-code="${escapeHtml(code)}" data-color="${escapeHtml(color)}">
    <span class="guess-anchor" aria-hidden="true"></span>
    <div class="guess-head">${head}${codeLink(code)}</div>
    ${bar}
    <p class="reason">${escapeHtml(reason)}</p>
  </article>`;
}

function nodePanel(node, switchedOn) {
  const meta = [
    node.rmType,
    node.nodeId,
    node.section ? `in ${node.section}` : "",
    node.archetypeId || "",
  ].filter(Boolean).map(escapeHtml).join(" · ");
  const color = switchedOn ? colorFor(node.id) : "";
  const extras = new Set((state.extraCodes.get(node.id) || []).map(String));
  for (const item of node.suggestions || []) extras.delete(String(item.code));
  const guesses = switchedOn
    ? (node.suggestions || []).map((item) => guessArticle(node, {
        code: item.code,
        rank: item.rank,
        score: item.score,
        reason: item.reason,
        term: termFor(item.code),
      })).join("")
    : "";
  const extraRows = switchedOn
    ? [...extras].map((code) => guessArticle(node, {
        code,
        reason: "Published term binding, included in this node’s colour.",
        term: termFor(code),
      })).join("")
    : "";
  const bindings = bindingRows(node, [...(node.bindings || []), ...(node.valueBindings || [])]);
  const scope = node.isArchetypeRoot && node.scopeBindings?.length
    ? `<h3 class="scope-title">Terminology on this archetype</h3>
       <p class="reason">${node.scopeBindings.length} SNOMED CT term binding${node.scopeBindings.length === 1 ? "" : "s"} travel with ${escapeHtml(node.archetypeId)}. Ones whose at-code is not in this template slot stay listed here rather than as extra tree nodes.</p>
       ${bindingRows(node, node.scopeBindings)}`
    : "";
  const title = switchedOn
    ? `<h3><i class="group-dot" aria-hidden="true"></i>${escapeHtml(node.name)}</h3>`
    : `<h3>${escapeHtml(node.name)}</h3>`;
  return `<section class="node-group"${color ? ` style="--node-color:${escapeHtml(color)}"` : ""}>${title}<p class="meta">${meta}</p>${guesses}${extraRows}${bindings}${scope}</section>`;
}

function renderDetail() {
  const actives = activeNodes();
  const focus = findNode(state.focusId);
  if (!actives.length && !focus) {
    detail.innerHTML = `
      <h3>Three open elements</h3>
      <p class="reason">The pretend mapper left five SNOMED CT guesses on Medication item, Problem/Diagnosis name, and Procedure name. They are the amber nodes. Switch one or more on. Each keeps its own colour, and a dashed line of that colour runs from the guess to the concept.</p>
      <p class="reason">The concept id sits beside the term and opens that concept in the SNOMED CT browser. It is not drawn on the graph.</p>
      <p class="reason">Teal nodes already carry a SNOMED CT term binding from the template. The fileset check found no binding that the archetypes had and the OPT had dropped.</p>`;
    return;
  }
  const parts = [];
  if (focus && !state.activeIds.has(focus.id)) parts.push(nodePanel(focus, false));
  for (const node of actives) parts.push(nodePanel(node, true));
  detail.innerHTML = parts.join("");
  drawSuggestionLines();
}

function renderTree() {
  const tree = displayTree();
  renderTemplateTree(treeSvg, tree, {
    selectedId: state.focusId,
    activeIds: state.activeIds,
    colorFor: (data) => (state.activeIds.has(data.id) ? colorFor(data.id) : null),
    onSelect: (node) => toggleNode(node),
    onToggle: state.filter === "all" && !state.query
      ? (node) => {
          node.open = !node.open;
          renderTree();
        }
      : null,
  });
  if (state.focusId) {
    const target = treeSvg.querySelector(`[data-id="${CSS.escape(state.focusId)}"]`);
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  drawSuggestionLines();
}

function renderStats() {
  const { comparison, archetypeReports, counts } = state.model;
  const stubs = archetypeReports.filter((report) => report.how === "terminology-stub").length;
  const direct = archetypeReports.filter((report) => report.how === "direct").length;
  stats.replaceChildren(
    chip(`<strong>${counts.nodes}</strong> template nodes`),
    chip(`<strong>${comparison.both}</strong> SNOMED bindings in OPT and archetypes`),
    chip(`<strong>${comparison.missingFromOpt}</strong> filled in from archetypes`),
    chip(`ehrtslib 0.11 · ${direct} ADL direct, ${stubs} terminology-only`),
    chip(`D3 ${D3_VERSION}`),
  );
}

function canSwitch(node) {
  return Boolean(node.suggestions?.length || state.extraCodes.get(node.id)?.length);
}

function toggleNode(node) {
  if (canSwitch(node)) {
    if (state.activeIds.has(node.id)) {
      state.activeIds.delete(node.id);
      state.focusId = state.focusId === node.id ? [...state.activeIds].at(-1) || null : state.focusId;
    } else {
      colorFor(node.id);
      state.activeIds.add(node.id);
      state.focusId = node.id;
    }
  } else {
    state.focusId = node.id;
  }
  renderTree();
  renderDetail();
  refreshGraph();
}

function ancestorsOf(code, parents) {
  const seen = new Set();
  const stack = [String(code)];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const parent of parents.get(current) || []) stack.push(parent);
  }
  return seen;
}

function annotate(graph) {
  const parents = new Map();
  const children = new Map();
  for (const link of graph.links || []) {
    const child = String(link.source?.id ?? link.source);
    const parent = String(link.target?.id ?? link.target);
    parents.set(child, [...(parents.get(child) || []), parent]);
    children.set(parent, [...(children.get(parent) || []), child]);
  }
  const owners = new Map();
  const suggestionOf = new Map();
  for (const node of activeNodes()) {
    const direct = new Set([
      ...(node.suggestions || []).map((item) => String(item.code)),
      ...(state.extraCodes.get(node.id) || []).map(String),
    ]);
    const closure = new Set();
    for (const code of direct) {
      for (const id of ancestorsOf(code, parents)) closure.add(id);
      const list = suggestionOf.get(code) || [];
      list.push({ color: colorFor(node.id) });
      suggestionOf.set(code, list);
    }
    for (const id of closure) {
      const set = owners.get(id) || new Set();
      set.add(node.id);
      owners.set(id, set);
    }
  }
  for (const item of graph.nodes) {
    const id = String(item.id);
    const share = owners.get(id)?.size || 0;
    const guesses = suggestionOf.get(id) || [];
    const shared = share >= 2;
    const childShared = (children.get(id) || []).some((child) => (owners.get(child)?.size || 0) >= 2);
    item.suggestion = guesses.length > 0;
    item.commonality = share;
    item.cp = shared;
    item.lcp = shared && !childShared;
    item.name = item.display && item.display !== id ? item.display : "";
    item.fillOpacity = 1;
    if (shared) {
      item.fill = "#ffffff";
      item.stroke = "#1c2430";
    } else if (guesses.length === 1) {
      item.fill = guesses[0].color;
      item.stroke = guesses[0].color;
    } else {
      item.fill = "#ffffff";
      item.stroke = "#4682b4";
    }
  }
  return graph;
}

async function refreshGraph() {
  const token = ++state.snomedToken;
  const codes = [];
  for (const node of activeNodes()) {
    for (const item of node.suggestions || []) codes.push(String(item.code));
    for (const code of state.extraCodes.get(node.id) || []) codes.push(String(code));
  }
  const unique = [...new Set(codes)];
  if (!unique.length) {
    state.graph = null;
    renderSnomedForce(snomedSvg, { nodes: [], links: [] });
    snomedEmpty.hidden = false;
    snomedCaption.textContent = state.focusId
      ? "This node is not switched on. Switch on an amber node to draw its guesses."
      : "Switch on an amber template node. Concept ids stay in the list.";
    drawSuggestionLines();
    return;
  }
  snomedEmpty.hidden = true;
  try {
    const graph = await closureToRoot(unique);
    if (token !== state.snomedToken) return;
    annotate(graph);
    state.graph = graph;
    const shared = graph.nodes.filter((node) => node.cp).length;
    const misses = graph.nodes.filter((node) => node.error).length;
    snomedCaption.textContent = misses
      ? `${graph.nodes.length} concepts in the is-a graph. ${misses} lookups failed.`
      : `${graph.nodes.length} concepts in the is-a graph.${shared ? ` ${shared} shared by more than one switched-on template node.` : ""} From the saved subset of ${BUNDLED_CONCEPTS} concepts.`;
    renderSnomedForce(snomedSvg, graph, { onTick: drawSuggestionLines });
    drawSuggestionLines();
  } catch (error) {
    if (token !== state.snomedToken) return;
    snomedCaption.textContent = "The terminology server did not answer.";
    errorBox.hidden = false;
    errorBox.textContent = error instanceof Error ? error.message : String(error);
  }
}

function showBinding(node, code, label) {
  colorFor(node.id);
  state.activeIds.add(node.id);
  state.focusId = node.id;
  const suggested = (node.suggestions || []).some((item) => String(item.code) === String(code));
  if (!suggested) {
    const extras = new Set((state.extraCodes.get(node.id) || []).map(String));
    extras.add(String(code));
    state.extraCodes.set(node.id, [...extras]);
  }
  renderTree();
  renderDetail();
  refreshGraph();
}

function lineKey(code, color) {
  return `${code}:${color}`;
}

function lineIsHot(item) {
  if (!state.hot) return false;
  if (state.hot.type === "code") return item.code === state.hot.code;
  return item.key === state.hot.key;
}

function drawSuggestionLines() {
  if (!linkOverlay) return;
  const overlay = d3.select(linkOverlay);
  const width = window.innerWidth;
  const height = window.innerHeight;
  overlay.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  const lines = [];
  for (const guess of detail.querySelectorAll(".guess")) {
    const code = guess.dataset.code;
    const color = guess.dataset.color || "#c46b1a";
    const anchor = guess.querySelector(".guess-anchor") || guess;
    const circle = snomedSvg.querySelector(`[data-id="${CSS.escape(code)}"] .node-disk, [data-id="${CSS.escape(code)}"] circle`);
    if (!circle) continue;
    const from = anchor.getBoundingClientRect();
    const to = circle.getBoundingClientRect();
    if (to.width === 0 && to.height === 0) continue;
    lines.push({
      key: lineKey(code, color),
      code,
      x1: from.left + from.width / 2,
      y1: from.top + from.height / 2,
      x2: to.left + to.width / 2,
      y2: to.top + to.height / 2,
      color,
    });
  }
  const group = overlay.selectAll("g.dash").data(lines, (item) => item.key).join("g").attr("class", "dash");
  group.selectAll("line.dash-hit")
    .data((item) => [item])
    .join("line")
    .attr("class", "dash-hit")
    .attr("data-key", (item) => item.key)
    .attr("x1", (item) => item.x1)
    .attr("y1", (item) => item.y1)
    .attr("x2", (item) => item.x2)
    .attr("y2", (item) => item.y2)
    .attr("stroke", (item) => item.color)
    .attr("stroke-opacity", 0)
    .attr("stroke-width", 14)
    .attr("pointer-events", "stroke")
    .on("mouseover", (event, item) => {
      state.hot = { type: "key", key: item.key };
      paintDash();
    })
    .on("mouseout", (event, item) => {
      if (state.hot?.type === "key" && state.hot.key === item.key) {
        state.hot = null;
        paintDash();
      }
    });
  group.selectAll("line.dash-link")
    .data((item) => [item])
    .join("line")
    .attr("class", "dash-link")
    .attr("pointer-events", "none")
    .attr("x1", (item) => item.x1)
    .attr("y1", (item) => item.y1)
    .attr("x2", (item) => item.x2)
    .attr("y2", (item) => item.y2)
    .attr("stroke", (item) => item.color)
    .attr("stroke-dasharray", "7 5")
    .attr("stroke-linecap", "round");
  paintDash();
}

function paintDash() {
  d3.select(linkOverlay).selectAll("line.dash-link").each(function paint(item) {
    const on = lineIsHot(item);
    d3.select(this)
      .attr("stroke-opacity", on ? 0.9 : 0.16)
      .attr("stroke-width", on ? 2.4 : 1.25);
  });
}

function pinConcept(code, on) {
  const node = code ? snomedSvg.querySelector(`[data-id="${CSS.escape(code)}"]`) : null;
  node?.classList.toggle("is-pinned", on);
}

function wireFilters() {
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      state.query = "";
      search.value = "";
      filterButtons.forEach((other) => other.classList.toggle("is-on", other === button));
      renderTree();
    });
  });
  search.addEventListener("input", () => {
    state.query = search.value;
    renderTree();
  });
}

function wireDetail() {
  detail.addEventListener("click", (event) => {
    const button = event.target.closest("[data-binding]");
    if (!button || !detail.contains(button)) return;
    const node = findNode(button.dataset.node);
    if (node) showBinding(node, button.dataset.binding, button.dataset.label);
  });
  detail.addEventListener("mouseover", (event) => {
    const guess = event.target.closest?.(".guess");
    if (!guess || !detail.contains(guess)) return;
    pinConcept(guess.dataset.code, true);
    state.hot = { type: "key", key: lineKey(guess.dataset.code, guess.dataset.color || "#c46b1a") };
    paintDash();
  });
  detail.addEventListener("mouseout", (event) => {
    const guess = event.target.closest?.(".guess");
    if (!guess) return;
    const next = event.relatedTarget?.closest?.(".guess");
    if (next === guess) return;
    pinConcept(guess.dataset.code, false);
    const key = lineKey(guess.dataset.code, guess.dataset.color || "#c46b1a");
    if (state.hot?.type === "key" && state.hot.key === key) {
      state.hot = null;
      paintDash();
    }
  });
  snomedSvg.addEventListener("mouseover", (event) => {
    const node = event.target.closest?.(".force-node");
    if (!node || !snomedSvg.contains(node)) return;
    state.hot = { type: "code", code: node.dataset.id };
    paintDash();
  });
  snomedSvg.addEventListener("mouseout", (event) => {
    const node = event.target.closest?.(".force-node");
    if (!node) return;
    const next = event.relatedTarget?.closest?.(".force-node");
    if (next === node) return;
    if (state.hot?.type === "code" && state.hot.code === node.dataset.id) {
      state.hot = null;
      paintDash();
    }
  });
  detail.addEventListener("scroll", drawSuggestionLines, { passive: true });
}

wireFilters();
wireDetail();
for (const element of [document.querySelector("#snomedViewport"), document.querySelector("#treeViewport")]) {
  element?.addEventListener("scroll", drawSuggestionLines, { passive: true });
}
window.addEventListener("scroll", drawSuggestionLines, { passive: true });
snomedCaption.textContent = "Reading the International Patient Summary…";

loadIpsModel().then((model) => {
  state.model = model;
  markOpen(model.tree);
  renderStats();
  const first = model.suggestions.attached[0];
  if (first) {
    colorFor(first.id);
    state.activeIds.add(first.id);
    state.focusId = first.id;
  }
  renderTree();
  renderDetail();
  refreshGraph();
}).catch((error) => {
  errorBox.hidden = false;
  errorBox.textContent = error instanceof Error ? error.message : String(error);
  snomedCaption.textContent = "The template could not be read.";
});

window.addEventListener("resize", () => {
  if (!state.model) return;
  renderTree();
  if (state.graph) {
    renderSnomedForce(snomedSvg, state.graph, { onTick: drawSuggestionLines });
  } else {
    drawSuggestionLines();
  }
});
