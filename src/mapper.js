import * as d3 from "d3";
import { NODE_COLORS, renderSnomedForce, renderTemplateTree, zoomGraph } from "./termviz-2.js";
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
  muted: new Map(),
  pins: new Map(),
  released: new Set(),
  popId: null,
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

function project(node, predicate, hide) {
  const children = [];
  for (const child of node.children || []) {
    const projected = project(child, predicate, hide);
    if (!projected) continue;
    if (hide?.(projected)) children.push(...(projected.children || []));
    else children.push(projected);
  }
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

function nodeHay(node) {
  return [
    node.name,
    node.nodeId,
    node.section,
    ...(node.bindings || []).map((binding) => binding.code),
    ...(node.suggestions || []).map((item) => `${item.code} ${termFor(item.code)}`),
  ].join(" ").toLowerCase();
}

function isSuggestionNode(node) {
  return Boolean(node.suggestions?.length);
}

function isBindingNode(node) {
  return hasBinding(node) || Boolean(node.scopeBindings?.length);
}

function narrowedTree(root) {
  if (state.filter === "suggestions") {
    return project(
      root,
      isSuggestionNode,
      (node) => isBindingNode(node) && !isSuggestionNode(node),
    ) || { ...root, children: [], open: true, name: "No matches" };
  }
  if (state.filter === "bindings") {
    return project(
      root,
      isBindingNode,
      (node) => isSuggestionNode(node) && !isBindingNode(node),
    ) || { ...root, children: [], open: true, name: "No matches" };
  }
  return root;
}

function displayTree() {
  const base = narrowedTree(state.model.tree);
  const query = state.query.trim().toLowerCase();
  if (!query) return base;
  return project(base, (node) => nodeHay(node).includes(query)) || { ...base, children: [], open: true, name: "No matches" };
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

function termFor(code, fallback) {
  const known = cachedConcept(code);
  if (known?.display && known.display !== String(code)) return known.display;
  return fallback || "Unnamed concept";
}

function codeOn(node, code) {
  if (!state.activeIds.has(node.id)) return false;
  return !state.muted.get(node.id)?.has(String(code));
}

function bindingEntries(node) {
  const seen = new Set();
  const rows = [];
  for (const binding of [...(node.bindings || []), ...(node.valueBindings || []), ...(node.scopeBindings || [])]) {
    const code = String(binding.code || "");
    if (!code || seen.has(code)) continue;
    seen.add(code);
    rows.push(binding);
  }
  return rows;
}

function bindingOn(node, code) {
  return (state.extraCodes.get(node.id) || []).map(String).includes(String(code));
}

function bindingNodes() {
  const nodes = [];
  (function walk(node, ancestors) {
    if (bindingEntries(node).length) nodes.push({ node, ancestors });
    for (const child of node.children || []) walk(child, ancestors.concat(node.name));
  })(state.model.tree, []);
  return nodes;
}

function bindingContext(entry, all) {
  const same = all.filter((item) => item.node.name === entry.node.name);
  if (same.length < 2) return entry.node.name;
  for (let index = entry.ancestors.length - 1; index >= 0; index -= 1) {
    const contexts = same.map((item) => item.ancestors[index] || "");
    if (new Set(contexts).size > 1) return `${entry.node.name} · ${entry.ancestors[index]}`;
  }
  return entry.node.name;
}

function bindingsAreAllOn() {
  const nodes = bindingNodes();
  return nodes.length > 0 && nodes.every(({ node }) => {
    const codes = bindingEntries(node);
    return codes.every((binding) => bindingOn(node, binding.code));
  });
}

function selectAllBindings() {
  for (const { node } of bindingNodes()) {
    colorFor(node.id);
    state.extraCodes.set(node.id, bindingEntries(node).map((binding) => String(binding.code)));
  }
}

function paintedIds() {
  const ids = new Set(state.activeIds);
  for (const [id, codes] of state.extraCodes) {
    if (codes?.length) ids.add(id);
  }
  return ids;
}

function codesFor(node) {
  const codes = [];
  for (const item of node.suggestions || []) {
    if (codeOn(node, item.code)) codes.push(String(item.code));
  }
  for (const code of state.extraCodes.get(node.id) || []) codes.push(String(code));
  return [...new Set(codes)];
}

function contributingNodes() {
  const ids = new Set();
  for (const node of state.model?.suggestions?.attached || []) {
    if ((node.suggestions || []).some((item) => codeOn(node, item.code))) ids.add(node.id);
  }
  for (const [id, codes] of state.extraCodes) {
    if (codes?.length) ids.add(id);
  }
  return [...ids].map((id) => findNode(id)).filter(Boolean);
}

function categoryState(node) {
  const codes = (node.suggestions || []).map((item) => String(item.code));
  if (!codes.length) return "false";
  const on = codes.filter((code) => codeOn(node, code)).length;
  if (on === 0) return "false";
  if (on === codes.length) return "true";
  return "mixed";
}

function masterState() {
  const states = (state.model?.suggestions?.attached || []).map(categoryState);
  if (!states.length || states.every((item) => item === "false")) return "false";
  if (states.every((item) => item === "true")) return "true";
  return "mixed";
}

function switchHtml(attrs, checked) {
  return `<button class="switch" type="button" role="switch" aria-checked="${checked}" ${attrs}></button>`;
}

function guessRow(node, item) {
  const on = codeOn(node, item.code);
  const color = colorFor(node.id);
  const term = termFor(item.code);
  const pct = Number.isFinite(item.score) ? Math.round(item.score * 100) : "";
  return `<article class="guess${on ? "" : " is-off"}" data-node-id="${escapeHtml(node.id)}" data-code="${escapeHtml(item.code)}" data-color="${escapeHtml(color)}" title="${escapeHtml(item.reason || "")}">
    <span class="guess-anchor" aria-hidden="true"></span>
    ${switchHtml(`data-row="${escapeHtml(item.code)}" data-node="${escapeHtml(node.id)}" aria-label="Include ${escapeHtml(term)}"`, on ? "true" : "false")}
    <span class="rank">${item.rank ?? ""}</span>
    ${termLink(item.code, term)}
    ${codeLink(item.code)}
    <span class="pct">${pct === "" ? "" : pct}</span>
  </article>`;
}

function nodeBlock(node) {
  const color = colorFor(node.id);
  const checked = categoryState(node);
  const rows = (node.suggestions || []).map((item) => guessRow(node, item)).join("");
  return `<section class="side-block" data-node-id="${escapeHtml(node.id)}" style="--node-color:${escapeHtml(color)}">
    <header class="cat-head">
      ${switchHtml(`data-cat="node" data-node="${escapeHtml(node.id)}" aria-label="Show ${escapeHtml(node.name)}"`, checked)}
      <span class="cat-name">${escapeHtml(node.name)}</span>
    </header>
    ${rows}
  </section>`;
}

function bindNodeState(node) {
  const codes = bindingEntries(node);
  if (!codes.length) return "false";
  const on = codes.filter((binding) => bindingOn(node, binding.code)).length;
  if (on === 0) return "false";
  if (on === codes.length) return "true";
  return "mixed";
}

function bindingMasterState() {
  const nodes = bindingNodes();
  if (!nodes.length || nodes.every(({ node }) => bindNodeState(node) === "false")) return "false";
  if (nodes.every(({ node }) => bindNodeState(node) === "true")) return "true";
  return "mixed";
}

function bindRow(entry, all) {
  const node = entry.node;
  const checked = bindNodeState(node);
  const on = checked !== "false";
  const color = colorFor(node.id);
  const codes = bindingEntries(node).filter((binding) => bindingOn(node, binding.code)).map((binding) => String(binding.code));
  const label = bindingContext(entry, all);
  const where = entry.ancestors.concat(node.name).join(" / ");
  return `<article class="bind-row${on ? "" : " is-off"}" data-node-id="${escapeHtml(node.id)}" data-codes="${escapeHtml(codes.join(" "))}" data-color="${escapeHtml(color)}" title="${escapeHtml(where)}" style="--node-color:${escapeHtml(color)}">
    <span class="guess-anchor" aria-hidden="true"></span>
    ${switchHtml(`data-bind-cat="1" data-node="${escapeHtml(node.id)}" aria-label="Show ${escapeHtml(label)}"`, checked)}
    <span class="name">${escapeHtml(label)}</span>
  </article>`;
}

function renderDetail() {
  const suggestions = state.model?.suggestions?.attached || [];
  const master = masterState();
  const blocks = suggestions.map(nodeBlock).join("");
  const bound = state.model ? bindingNodes() : [];
  const bindingChecked = bindingMasterState();
  const bindingRows = bound.map((entry) => bindRow(entry, bound)).join("");
  const showSuggestions = state.filter !== "bindings";
  const showBindings = state.filter !== "suggestions";
  const suggestionsHtml = `<div class="side-main">
        <header class="cat-head master">
          ${switchHtml(`data-cat="all" aria-label="Show all mapping suggestions"`, master)}
          <span class="cat-name">Mapping suggestions</span>
        </header>
        <div class="side-indent">${blocks}</div>
      </div>`;
  const bindingsHtml = `<aside class="side-bind">
        <header class="cat-head">
          ${switchHtml(`data-cat="bindings" aria-label="Show all template bindings"`, bindingChecked)}
          <span class="cat-name">Template bindings</span>
        </header>
        <div class="side-indent">${bindingRows}</div>
      </aside>`;
  const single = showSuggestions === showBindings ? "" : " is-single";
  detail.innerHTML = `<p class="side-kicker">Filtered nodes</p>
    <div class="side-split${single}">
      ${showSuggestions ? suggestionsHtml : ""}
      ${showBindings ? bindingsHtml : ""}
    </div>`;
  drawSuggestionLines();
}

function renderTree() {
  renderTemplateTree(treeSvg, displayTree(), {
    selectedId: state.focusId,
    activeIds: paintedIds(),
    colorFor: (data) => (nodePainted(data) ? colorFor(data.id) : null),
    onSelect: onTreeSelect,
    onHover: (data, on) => pairHighlight(data.id, on),
    onToggle: state.filter === "all" && !state.query
      ? (node) => {
          node.open = !node.open;
          renderTree();
        }
      : null,
  });
  drawSuggestionLines();
}

function nodePainted(data) {
  return state.activeIds.has(data.id) || Boolean(state.extraCodes.get(data.id)?.length);
}

function countLabel(count, singular, plural) {
  return chip(`<strong>${count}</strong> ${count === 1 ? singular : plural}`);
}

function renderStats() {
  const { comparison, counts, suggestions } = state.model;
  const guesses = (suggestions?.attached || []).reduce((sum, node) => sum + (node.suggestions?.length || 0), 0);
  stats.replaceChildren(
    countLabel(BUNDLED_CONCEPTS, "SNOMED CT node cached", "SNOMED CT nodes cached"),
    countLabel(counts.nodes, "template node", "template nodes"),
    countLabel(comparison.both, "template binding", "template bindings"),
    countLabel(guesses, "mapping suggestion", "mapping suggestions"),
  );
}

function refreshAll() {
  renderTree();
  renderDetail();
  refreshGraph();
}

function setCategory(node, on) {
  if (on) {
    colorFor(node.id);
    state.activeIds.add(node.id);
    state.muted.delete(node.id);
  } else {
    state.activeIds.delete(node.id);
    state.muted.delete(node.id);
  }
}

function toggleCategory(node) {
  setCategory(node, categoryState(node) !== "true");
  state.focusId = node.id;
  refreshAll();
}

function toggleMaster() {
  const on = masterState() !== "true";
  for (const node of state.model.suggestions.attached) setCategory(node, on);
  refreshAll();
}

function toggleCode(node, code) {
  const key = String(code);
  const codes = (node.suggestions || []).map((item) => String(item.code));
  const muted = new Set(state.muted.get(node.id) || []);
  if (!codeOn(node, key)) {
    colorFor(node.id);
    state.activeIds.add(node.id);
    if (muted.size === 0 && !state.muted.has(node.id) && codes.some((item) => item !== key)) {
      state.muted.set(node.id, new Set(codes.filter((item) => item !== key)));
    } else {
      muted.delete(key);
      if (muted.size === 0) state.muted.delete(node.id);
      else state.muted.set(node.id, muted);
    }
  } else {
    muted.add(key);
    if (codes.every((item) => muted.has(item))) {
      state.activeIds.delete(node.id);
      state.muted.delete(node.id);
    } else {
      state.activeIds.add(node.id);
      state.muted.set(node.id, muted);
    }
  }
  state.focusId = node.id;
  refreshAll();
}

function setBinding(node, code, on) {
  const extras = new Set((state.extraCodes.get(node.id) || []).map(String));
  if (on) extras.add(String(code));
  else extras.delete(String(code));
  if (extras.size) {
    colorFor(node.id);
    state.extraCodes.set(node.id, [...extras]);
  } else state.extraCodes.delete(node.id);
  state.focusId = node.id;
  refreshAll();
}

function toggleAllBindings(node) {
  const rows = bindingEntries(node);
  const allOn = rows.length > 0 && rows.every((binding) => bindingOn(node, binding.code));
  if (allOn) state.extraCodes.delete(node.id);
  else {
    colorFor(node.id);
    state.extraCodes.set(node.id, rows.map((binding) => String(binding.code)));
  }
  state.focusId = node.id;
  refreshAll();
}

function toggleBindingMaster() {
  if (bindingMasterState() === "true") {
    for (const { node } of bindingNodes()) state.extraCodes.delete(node.id);
  } else selectAllBindings();
  refreshAll();
}

function onTreeSelect(node) {
  state.focusId = node.id;
  if (node.suggestions?.length) {
    toggleCategory(node);
    return;
  }
  if (bindingEntries(node).length) {
    toggleAllBindings(node);
    return;
  }
  renderTree();
  renderDetail();
}

function pairHighlight(id, on) {
  treeSvg.querySelectorAll(".is-pair").forEach((element) => element.classList.remove("is-pair"));
  detail.querySelectorAll(".is-pair").forEach((element) => element.classList.remove("is-pair"));
  if (!on || !id) return;
  const treeNode = treeSvg.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const side = detail.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
  treeNode?.classList.add("is-pair");
  side?.classList.add("is-pair");
  const treePort = document.querySelector("#treeViewport");
  if (treeNode && treePort) {
    const box = treeNode.getBoundingClientRect();
    const view = treePort.getBoundingClientRect();
    if (box.top < view.top || box.bottom > view.bottom || box.left < view.left || box.right > view.right) {
      treeNode.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  if (side) {
    const box = side.getBoundingClientRect();
    const view = detail.getBoundingClientRect();
    if (box.top < view.top || box.bottom > view.bottom) side.scrollIntoView({ block: "nearest" });
  }
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
  for (const node of contributingNodes()) {
    const direct = new Set(codesFor(node));
    const closure = new Set();
    for (const code of direct) {
      for (const id of ancestorsOf(code, parents)) closure.add(id);
      const suggestion = (node.suggestions || []).find((item) => String(item.code) === code);
      const list = suggestionOf.get(code) || [];
      list.push({
        color: colorFor(node.id),
        templateName: node.name,
        rank: suggestion?.rank ?? null,
        score: suggestion?.score ?? null,
        reason: suggestion?.reason || "",
      });
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
    item.sources = guesses;
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

function forceOptions() {
  return {
    onTick: () => {
      drawSuggestionLines();
      placePop();
    },
    onSelect: (item) => openPop(item),
    pins: state.pins,
    released: state.released,
    onPinMove: (item) => {
      const id = String(item.id);
      state.released.delete(id);
      state.pins.set(id, { x: item.x, y: item.y, auto: Boolean(item.autoPin) });
    },
  };
}

async function refreshGraph() {
  const token = ++state.snomedToken;
  const unique = [...new Set(contributingNodes().flatMap(codesFor))];
  if (!unique.length) {
    state.graph = null;
    renderSnomedForce(snomedSvg, { nodes: [], links: [] }, forceOptions());
    snomedEmpty.hidden = false;
    snomedCaption.textContent = "Nothing switched on.";
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
      ? `${graph.nodes.length} concepts · ${misses} lookups failed`
      : `${graph.nodes.length} concepts${shared ? ` · ${shared} shared` : ""}`;
    const reopen = state.popId;
    renderSnomedForce(snomedSvg, graph, forceOptions());
    if (reopen) {
      const el = snomedSvg.querySelector(`[data-id="${CSS.escape(reopen)}"]`);
      if (el) openPop(d3.select(el).datum());
    }
    drawSuggestionLines();
  } catch (error) {
    if (token !== state.snomedToken) return;
    snomedCaption.textContent = "The terminology server did not answer.";
    errorBox.hidden = false;
    errorBox.textContent = error instanceof Error ? error.message : String(error);
  }
}

function conceptLabel(item) {
  return item?.name || item?.display || "Unnamed concept";
}

function openPop(item) {
  if (!item) return;
  state.popId = String(item.id);
  const pop = document.querySelector("#conceptPop");
  document.querySelector("#popTitle").textContent = conceptLabel(item);
  document.querySelector("#popCode").innerHTML = codeLink(item.id);
  const parents = (item.outgoing || []).map((edge) => conceptLabel(edge.target)).filter(Boolean);
  const children = (item.incoming || []).map((edge) => conceptLabel(edge.source)).filter(Boolean);
  const facts = [];
  if (item.inactive) facts.push(["Status", "Inactive"]);
  if (Number.isFinite(item.depth)) facts.push(["From root", String(item.depth)]);
  facts.push(["Parents", parents.join(", ") || "SNOMED CT root"]);
  if (children.length) facts.push(["Children here", children.slice(0, 8).join(", ")]);
  if (item.commonality > 1) facts.push(["Shared by", `${item.commonality} template nodes`]);
  document.querySelector("#popFacts").innerHTML = facts.map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd>`).join("");
  document.querySelector("#popSources").innerHTML = (item.sources || []).map((source) => {
    const head = source.rank ? `${source.rank}. ${source.templateName}` : source.templateName;
    const score = Number.isFinite(source.score) ? ` · ${Math.round(source.score * 100)}%` : "";
    return `<p><strong>${escapeHtml(`${head}${score}`)}</strong>${source.reason ? ` ${escapeHtml(source.reason)}` : ""}</p>`;
  }).join("");
  document.querySelector("#popPin").setAttribute("aria-checked", item.userPinned ? "true" : "false");
  pop.hidden = false;
  placePop();
}

function placePop() {
  const pop = document.querySelector("#conceptPop");
  if (!pop || pop.hidden || !state.popId) return;
  const circle = snomedSvg.querySelector(`[data-id="${CSS.escape(state.popId)}"] .node-disk`);
  if (!circle) {
    pop.hidden = true;
    return;
  }
  const anchor = circle.getBoundingClientRect();
  const margin = 8;
  const width = pop.offsetWidth || 260;
  const height = pop.offsetHeight || 180;
  let left = anchor.right + margin;
  let top = anchor.top - 8;
  if (left + width > window.innerWidth - margin) left = anchor.left - width - margin;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - height - margin);
  if (left < margin) left = margin;
  if (top < margin) top = margin;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function closePop() {
  const pop = document.querySelector("#conceptPop");
  if (pop) pop.hidden = true;
  state.popId = null;
}

function setUserPin(item, on) {
  const id = String(item.id);
  const el = snomedSvg.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (on) {
    state.released.delete(id);
    item.userPinned = true;
    item.autoPin = false;
    item.layoutFixed = false;
    item.fx = item.x;
    item.fy = item.y;
    state.pins.set(id, { x: item.x, y: item.y, auto: false });
    el?.classList.add("is-user-pinned");
  } else {
    state.pins.delete(id);
    state.released.add(id);
    item.userPinned = false;
    item.autoPin = false;
    item.layoutFixed = false;
    item.fx = null;
    item.fy = null;
    el?.classList.remove("is-user-pinned");
  }
  document.querySelector("#popPin")?.setAttribute("aria-checked", on ? "true" : "false");
  snomedSvg.__termvizSimulation?.alpha(0.5).restart();
}

function lineIsHot(item) {
  if (!state.hot) return false;
  if (state.hot.type === "code") return item.code === state.hot.code;
  if (state.hot.type === "node") return item.nodeId === state.hot.nodeId;
  return item.key === state.hot.key;
}

function syncCues(rows) {
  const cueUp = document.querySelector("#cueUp");
  const cueDown = document.querySelector("#cueDown");
  const port = detail.getBoundingClientRect();
  let above = detail.scrollTop > 2;
  let below = detail.scrollTop + detail.clientHeight < detail.scrollHeight - 2;
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    if (box.bottom < port.top + 1) above = true;
    if (box.top > port.bottom - 1) below = true;
  }
  cueUp.hidden = !above;
  cueDown.hidden = !below;
}

function rowPoint(row) {
  const port = detail.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  if (box.bottom < port.top + 1) {
    const cue = document.querySelector("#cueUp").getBoundingClientRect();
    return { x: cue.left + cue.width / 2, y: cue.top + cue.height / 2 };
  }
  if (box.top > port.bottom - 1) {
    const cue = document.querySelector("#cueDown").getBoundingClientRect();
    return { x: cue.left + cue.width / 2, y: cue.top + cue.height / 2 };
  }
  const anchor = row.querySelector(".guess-anchor") || row;
  const from = anchor.getBoundingClientRect();
  return { x: from.left + from.width / 2, y: from.top + from.height / 2 };
}

function drawSuggestionLines() {
  if (!linkOverlay) return;
  const rows = [...detail.querySelectorAll(".guess:not(.is-off), .bind-row:not(.is-off)")];
  syncCues(rows);
  const overlay = d3.select(linkOverlay);
  const width = window.innerWidth;
  const height = window.innerHeight;
  overlay.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
  const lines = [];
  for (const row of rows) {
    const color = row.dataset.color || "#1c2430";
    const nodeId = row.dataset.nodeId || "";
    const codes = (row.dataset.codes || row.dataset.code || "").split(/\s+/).filter(Boolean);
    const from = rowPoint(row);
    for (const code of codes) {
      const circle = snomedSvg.querySelector(`[data-id="${CSS.escape(code)}"] .node-disk`);
      if (!circle) continue;
      const to = circle.getBoundingClientRect();
      if (to.width === 0 && to.height === 0) continue;
      lines.push({
        key: `${nodeId}:${code}`,
        nodeId,
        code,
        color,
        x1: from.x,
        y1: from.y,
        x2: to.left + to.width / 2,
        y2: to.top + to.height / 2,
      });
    }
  }
  const group = overlay.selectAll("g.dash").data(lines, (item) => item.key).join("g").attr("class", "dash");
  group.selectAll("line.dash-hit")
    .data((item) => [item])
    .join("line")
    .attr("class", "dash-hit")
    .attr("x1", (item) => item.x1)
    .attr("y1", (item) => item.y1)
    .attr("x2", (item) => item.x2)
    .attr("y2", (item) => item.y2)
    .attr("stroke", (item) => item.color)
    .attr("stroke-opacity", 0)
    .attr("stroke-width", 14)
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

function relayout() {
  if (!state.model) return;
  renderTree();
  if (state.graph) renderSnomedForce(snomedSvg, state.graph, forceOptions());
  else drawSuggestionLines();
  placePop();
}

function wireChrome() {
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      filterButtons.forEach((other) => other.classList.toggle("is-on", other === button));
      if (state.model && state.filter === "suggestions" && masterState() !== "true") {
        for (const node of state.model.suggestions.attached) setCategory(node, true);
        refreshAll();
        return;
      }
      if (state.model && state.filter === "bindings" && !bindingsAreAllOn()) {
        selectAllBindings();
        refreshAll();
        return;
      }
      renderTree();
      renderDetail();
    });
  });
  document.querySelector("#findButton")?.addEventListener("click", () => search.focus());
  for (const viewport of [document.querySelector("#snomedViewport"), document.querySelector("#treeViewport")]) {
    viewport?.querySelectorAll("[data-zoom]").forEach((button) => {
      button.addEventListener("click", () => {
        const svg = viewport.querySelector("svg");
        if (svg) zoomGraph(svg, button.dataset.zoom);
      });
    });
  }
  search.addEventListener("input", () => {
    state.query = search.value;
    renderTree();
  });
  detail.addEventListener("click", (event) => {
    const button = event.target.closest(".switch");
    if (!button || !detail.contains(button)) return;
    event.preventDefault();
    const node = findNode(button.dataset.node);
    if (button.dataset.cat === "all") toggleMaster();
    else if (button.dataset.cat === "bindings") toggleBindingMaster();
    else if (button.dataset.cat === "node" && node) toggleCategory(node);
    else if (button.dataset.row && node) toggleCode(node, button.dataset.row);
    else if (button.dataset.bindCat && node) toggleAllBindings(node);
    else if (button.dataset.binding && node) setBinding(node, button.dataset.binding, button.getAttribute("aria-checked") !== "true");
  });
  detail.addEventListener("mouseover", (event) => {
    const block = event.target.closest?.("[data-node-id]");
    if (block?.dataset.nodeId) pairHighlight(block.dataset.nodeId, true);
    const guess = event.target.closest?.(".guess, .bind-row");
    if (!guess || !detail.contains(guess)) return;
    const codes = (guess.dataset.codes || guess.dataset.code || "").split(/\s+/).filter(Boolean);
    for (const code of codes) pinConcept(code, true);
    state.hot = guess.classList.contains("bind-row")
      ? { type: "node", nodeId: guess.dataset.nodeId }
      : { type: "key", key: `${guess.dataset.nodeId || ""}:${guess.dataset.code}` };
    paintDash();
  });
  detail.addEventListener("mouseout", (event) => {
    const block = event.target.closest?.("[data-node-id]");
    const nextBlock = event.relatedTarget?.closest?.("[data-node-id]");
    if (block && nextBlock !== block) pairHighlight(block.dataset.nodeId, false);
    const guess = event.target.closest?.(".guess, .bind-row");
    if (!guess) return;
    const next = event.relatedTarget?.closest?.(".guess, .bind-row");
    if (next === guess) return;
    const codes = (guess.dataset.codes || guess.dataset.code || "").split(/\s+/).filter(Boolean);
    for (const code of codes) pinConcept(code, false);
    state.hot = null;
    paintDash();
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
  document.querySelector("#cueUp").addEventListener("click", () => {
    detail.scrollBy({ top: -Math.max(48, detail.clientHeight * 0.75), behavior: "smooth" });
  });
  document.querySelector("#cueDown").addEventListener("click", () => {
    detail.scrollBy({ top: Math.max(48, detail.clientHeight * 0.75), behavior: "smooth" });
  });
  document.querySelector("#popClose").addEventListener("click", closePop);
  document.querySelector("#popPin").addEventListener("click", () => {
    const el = state.popId && snomedSvg.querySelector(`[data-id="${CSS.escape(state.popId)}"]`);
    const item = el ? d3.select(el).datum() : null;
    if (item) setUserPin(item, !item.userPinned);
  });
  document.querySelector("#snomedViewport").addEventListener("click", (event) => {
    if (event.target === snomedSvg || event.target.id === "snomedViewport") closePop();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePop();
  });
  const bench = document.querySelector("#bench");
  const topPane = document.querySelector("#snomedPane");
  const splitter = document.querySelector("#splitter");
  let dragging = false;
  function applySplit(percent) {
    const clamped = Math.min(82, Math.max(18, percent));
    topPane.style.flex = `0 0 ${clamped}%`;
    splitter.setAttribute("aria-valuenow", String(Math.round(clamped)));
  }
  function splitFromPointer(event) {
    const rect = bench.getBoundingClientRect();
    applySplit(((event.clientY - rect.top) / rect.height) * 100);
  }
  splitter.addEventListener("pointerdown", (event) => {
    dragging = true;
    splitter.setPointerCapture(event.pointerId);
    splitFromPointer(event);
  });
  splitter.addEventListener("pointermove", (event) => {
    if (dragging) splitFromPointer(event);
  });
  function endSplit() {
    if (!dragging) return;
    dragging = false;
    relayout();
  }
  splitter.addEventListener("pointerup", endSplit);
  splitter.addEventListener("pointercancel", endSplit);
  splitter.addEventListener("dblclick", () => {
    applySplit(60);
    relayout();
  });
  splitter.addEventListener("keydown", (event) => {
    const now = Number(splitter.getAttribute("aria-valuenow")) || 60;
    if (event.key === "ArrowUp") applySplit(now - 4);
    if (event.key === "ArrowDown") applySplit(now + 4);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") relayout();
  });
}

wireChrome();
for (const element of [document.querySelector("#snomedViewport"), document.querySelector("#treeViewport")]) {
  element?.addEventListener("scroll", drawSuggestionLines, { passive: true });
}
snomedCaption.textContent = "Reading the International Patient Summary…";

loadIpsModel().then((model) => {
  state.model = model;
  markOpen(model.tree);
  renderStats();
  for (const node of model.suggestions.attached) setCategory(node, true);
  selectAllBindings();
  state.focusId = model.suggestions.attached[0]?.id ?? null;
  renderTree();
  renderDetail();
  refreshGraph();
}).catch((error) => {
  errorBox.hidden = false;
  errorBox.textContent = error instanceof Error ? error.message : String(error);
  snomedCaption.textContent = "The template could not be read.";
});

window.addEventListener("resize", () => relayout());
