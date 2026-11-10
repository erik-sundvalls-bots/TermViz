import { bandIndexForNode, ontologyDepths } from "./kg-layout.js";

export const INSTANCE_TYPES = new Set([
  "patient",
  "composition_instance",
  "entry_instance",
  "element_instance",
]);

const UP_EDGE_TYPES = new Set(["is_a", "binding", "instance_of", "coded_as", "unit"]);

export function isInstanceNode(node) {
  return node && INSTANCE_TYPES.has(node.type);
}

export function buildParentMap(nodes, edges, nodeById) {
  const ontologyDepth = ontologyDepths(nodes, edges);
  const bandFor = (node) => bandIndexForNode(node, ontologyDepth);
  const parents = new Map();

  const addParent = (parent, child) => {
    if (parent === child) return;
    if (!parents.has(child)) parents.set(child, new Set());
    parents.get(child).add(parent);
  };

  for (const edge of edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;

    const bf = bandFor(from);
    const bt = bandFor(to);
    if (bf !== bt) {
      if (bf < bt) addParent(from.id, to.id);
      else addParent(to.id, from.id);
      continue;
    }
    if (UP_EDGE_TYPES.has(edge.type)) addParent(edge.to, edge.from);
    else if (edge.type === "contains") {
      if (isInstanceNode(from) && !isInstanceNode(to)) addParent(to.id, from.id);
      else if (isInstanceNode(to) && !isInstanceNode(from)) addParent(from.id, to.id);
      else addParent(edge.from, edge.to);
    } else if (edge.type === "has_node" || edge.type === "slot") {
      addParent(edge.from, edge.to);
    } else {
      addParent(edge.to, edge.from);
    }
  }
  return parents;
}

export function collectAncestors(seedIds, parents) {
  const seen = new Set(seedIds);
  const queue = [...seedIds];
  while (queue.length) {
    const id = queue.shift();
    for (const parent of parents.get(id) || []) {
      if (!seen.has(parent)) {
        seen.add(parent);
        queue.push(parent);
      }
    }
  }
  return seen;
}

export function buildChildrenMap(parents) {
  const children = new Map();
  for (const [child, ps] of parents) {
    for (const parent of ps) {
      if (!children.has(parent)) children.set(parent, new Set());
      children.get(parent).add(child);
    }
  }
  return children;
}

const STORAGE_KEY = "termviz.kg.cherry.v1";

export function loadSavedLists() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { named: {} };
  } catch {
    return { named: {} };
  }
}

export function persistSavedLists(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode */
  }
}

export function encodeFocusHash(ids) {
  const compact = [...ids].sort().join(",");
  if (!compact) return "";
  return `#focus=${encodeURIComponent(compact)}`;
}

export function decodeFocusHash(hash) {
  const match = /^#focus=(.+)$/.exec(hash || "");
  if (!match) return null;
  try {
    return decodeURIComponent(match[1])
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function encodeFocusQuery(ids) {
  const payload = { v: 1, ids: [...ids].sort() };
  return `focus=${encodeURIComponent(btoa(JSON.stringify(payload)))}`;
}

export function decodeFocusQuery(search) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("focus");
  if (!raw) return null;
  try {
    const body = JSON.parse(atob(decodeURIComponent(raw)));
    return Array.isArray(body.ids) ? body.ids : null;
  } catch {
    return null;
  }
}

export function applyUrlFocus(ids) {
  const url = new URL(window.location.href);
  if (ids.length) {
    url.hash = `focus=${encodeURIComponent([...ids].sort().join(","))}`;
  } else {
    url.hash = "";
  }
  history.replaceState(null, "", url.toString());
}
