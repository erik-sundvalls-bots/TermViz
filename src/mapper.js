import { D3_VERSION, renderAncestorDag, renderTemplateTree } from "./termviz-2.js";
import { loadIpsModel } from "./ips-model.js";
import { cacheSize, cachedConcept, closureToRoot } from "./snomed.js";

const snomedSvg = document.querySelector("#snomedSvg");
const treeSvg = document.querySelector("#treeSvg");
const snomedEmpty = document.querySelector("#snomedEmpty");
const snomedCaption = document.querySelector("#snomedCaption");
const stats = document.querySelector("#stats");
const detail = document.querySelector("#detail");
const search = document.querySelector("#search");
const errorBox = document.querySelector("#error");
const filterButtons = [...document.querySelectorAll("[data-filter]")];

const state = {
  model: null,
  filter: "suggestions",
  query: "",
  selectedId: null,
  snomedToken: 0,
  focusCode: null,
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

function selectedNode() {
  if (!state.selectedId) return null;
  let found = null;
  (function walk(node) {
    if (node.id === state.selectedId) found = node;
    node.children?.forEach(walk);
  })(state.model.tree);
  return found;
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

function renderDetail() {
  const node = selectedNode();
  if (!node) {
    detail.innerHTML = `
      <h3>Three open elements</h3>
      <p class="reason">The pretend mapper left five SNOMED CT guesses on Medication item, Problem/Diagnosis name, and Procedure name. They are the amber nodes. Select one and the upper tree climbs each guess to the SNOMED CT root.</p>
      <p class="reason">Teal nodes already carry a SNOMED CT term binding from the template. The fileset check found no binding that the archetypes had and the OPT had dropped.</p>`;
    return;
  }
  const meta = [
    node.rmType,
    node.nodeId,
    node.section ? `in ${node.section}` : "",
    node.archetypeId || "",
  ].filter(Boolean).map(escapeHtml).join(" · ");
  const guesses = (node.suggestions || []).map((item) => {
    const known = cachedConcept(item.code);
    const term = known?.display || "term not loaded yet";
    return `<article class="guess">
      <div class="guess-head">
        <button class="term" type="button" data-code="${item.code}">${item.rank}. ${escapeHtml(term)}</button>
        <code>${item.code}</code>
      </div>
      <div class="score" aria-label="score ${item.score}"><span style="width:${Math.round(item.score * 100)}%"></span></div>
      <p class="reason">${escapeHtml(item.reason)}</p>
    </article>`;
  }).join("");
  const bindings = [...(node.bindings || []), ...(node.valueBindings || [])].map((binding) => {
    const [label, kind] = statusLabel(binding.status);
    const name = binding.label ? `${escapeHtml(binding.label)} · ` : "";
    return `<div class="binding">
      <div>${name}<code>${escapeHtml(binding.code)}</code><div><span class="tag ${kind}">${escapeHtml(label)}</span></div></div>
      <button class="text-button" type="button" data-binding="${escapeHtml(binding.code)}" data-label="${escapeHtml(binding.label || node.name)}">Show</button>
    </div>`;
  }).join("");
  const scope = node.isArchetypeRoot && node.scopeBindings?.length
    ? `<h3 style="font-size:18px;margin-top:18px">Terminology on this archetype</h3>
       <p class="reason">${node.scopeBindings.length} SNOMED CT term binding${node.scopeBindings.length === 1 ? "" : "s"} travel with ${escapeHtml(node.archetypeId)}. Ones whose at-code is not in this template slot stay listed here rather than as extra tree nodes.</p>
       ${node.scopeBindings.map((binding) => {
         const [label, kind] = statusLabel(binding.status);
         return `<div class="binding"><div>${escapeHtml(binding.label)} <code>${escapeHtml(binding.atCode)}</code> → <code>${escapeHtml(binding.code)}</code><div><span class="tag ${kind}">${escapeHtml(label)}</span></div></div>
           <button class="text-button" type="button" data-binding="${escapeHtml(binding.code)}" data-label="${escapeHtml(binding.label)}">Show</button></div>`;
       }).join("")}`
    : "";
  detail.innerHTML = `<h3>${escapeHtml(node.name)}</h3><p class="meta">${meta}</p>${guesses}${bindings}${scope}`;
  detail.querySelectorAll("[data-code]").forEach((button) => {
    button.addEventListener("click", () => focusSuggestion(node, button.dataset.code));
  });
  detail.querySelectorAll("[data-binding]").forEach((button) => {
    button.addEventListener("click", () => showBinding(button.dataset.binding, button.dataset.label));
  });
}

function renderTree() {
  const tree = displayTree();
  renderTemplateTree(treeSvg, tree, {
    selectedId: state.selectedId,
    onSelect: (node) => selectNode(node),
    onToggle: state.filter === "all" && !state.query
      ? (node) => {
          node.open = !node.open;
          renderTree();
        }
      : null,
  });
  if (state.selectedId) {
    const target = treeSvg.querySelector(`[data-id="${CSS.escape(state.selectedId)}"]`);
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
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

async function drawClosure(codes, suggestions, focusCode, caption) {
  const token = ++state.snomedToken;
  state.lastDraw = { codes, suggestions, focusCode, caption };
  snomedCaption.textContent = caption;
  snomedEmpty.hidden = true;
  try {
    const graph = await closureToRoot(codes, {
      onProgress: ({ cached }) => {
        if (token === state.snomedToken) {
          snomedCaption.textContent = `${caption} Cache holds ${cached} concepts.`;
        }
      },
    });
    if (token !== state.snomedToken) return;
    const misses = graph.nodes.filter((node) => node.error).length;
    snomedCaption.textContent = misses
      ? `${graph.nodes.length} concepts in the ancestor closure. ${misses} lookups failed.`
      : `${graph.nodes.length} concepts, from the guesses up to SNOMED CT Concept. ${cacheSize()} cached.`;
    state.lastGraph = graph;
    state.lastSuggestions = suggestions;
    renderAncestorDag(snomedSvg, graph, {
      suggestions,
      selectedCode: focusCode,
      onSelect: (node) => {
        state.focusCode = node.id;
        renderAncestorDag(snomedSvg, graph, { suggestions, selectedCode: node.id });
      },
    });
    renderDetail();
  } catch (error) {
    if (token !== state.snomedToken) return;
    snomedCaption.textContent = "The terminology server did not answer.";
    errorBox.hidden = false;
    errorBox.textContent = error instanceof Error ? error.message : String(error);
  }
}

function selectNode(node) {
  state.selectedId = node.id;
  state.focusCode = null;
  renderTree();
  renderDetail();
  if (node.suggestions?.length) {
    showSuggestions(node, null);
    return;
  }
  state.snomedToken += 1;
  snomedSvg.replaceChildren();
  snomedEmpty.hidden = false;
  snomedCaption.textContent = hasBinding(node) || node.scopeBindings?.length
    ? "This node has published term bindings. Use Show to climb one code, or pick an amber suggestion."
    : "This node has no mapping suggestions. Pick an amber node to draw the SNOMED CT tree.";
}

function showSuggestions(node, code) {
  state.focusCode = code;
  const label = code
    ? `Suggestion ${node.suggestions.find((item) => item.code === code)?.rank || ""} held in the closure.`
    : `Five guesses for ${node.name}, and every is-a parent up to the root.`;
  drawClosure(node.suggestions.map((item) => item.code), node.suggestions, code, label);
}

function focusSuggestion(node, code) {
  showSuggestions(node, code);
}

function showBinding(code, label) {
  drawClosure([code], [{ code, rank: 1, score: 1 }], code, `${label || "Binding"} ${code}, climbed to the SNOMED CT root.`);
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

async function prefetch() {
  const codes = [];
  (function walk(node) {
    for (const item of node.suggestions || []) codes.push(item.code);
    node.children.forEach(walk);
  })(state.model.tree);
  if (!state.selectedId) {
    snomedCaption.textContent = "Caching ancestor chains from the Nordic Ontoserver…";
  }
  try {
    await closureToRoot(codes);
    if (!state.selectedId) {
      snomedCaption.textContent = `Cached ${cacheSize()} SNOMED CT concepts. Select an amber node to draw its five climbs.`;
    }
    renderDetail();
  } catch (error) {
    snomedCaption.textContent = "Could not prefetch from the terminology server. Selecting a node will try again.";
    errorBox.hidden = false;
    errorBox.textContent = error instanceof Error ? error.message : String(error);
  }
}

wireFilters();
snomedCaption.textContent = "Reading the International Patient Summary…";

loadIpsModel().then((model) => {
  state.model = model;
  markOpen(model.tree);
  renderStats();
  renderTree();
  renderDetail();
  const first = model.suggestions.attached[0];
  if (first) selectNode(first);
  prefetch();
}).catch((error) => {
  errorBox.hidden = false;
  errorBox.textContent = error instanceof Error ? error.message : String(error);
  snomedCaption.textContent = "The template could not be read.";
});

window.addEventListener("resize", () => {
  if (!state.model) return;
  renderTree();
  if (state.lastGraph) {
    renderAncestorDag(snomedSvg, state.lastGraph, {
      suggestions: state.lastSuggestions || [],
      selectedCode: state.focusCode,
    });
  }
});
