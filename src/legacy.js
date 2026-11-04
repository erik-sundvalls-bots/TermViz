import graph from "./sample-graph.json";
import template from "./sample-template.json";
import { D3_VERSION, renderForceGraph, renderTemplateTree } from "./termviz-2.js";

const nodes = [];
const seen = new Set();
for (const node of graph.nodes) {
  const id = String(node.id).trim();
  if (seen.has(id)) continue;
  seen.add(id);
  nodes.push({ id, name: node.term });
}
const links = graph.links
  .map((link) => ({ source: String(link.source).trim(), target: String(link.target).trim() }))
  .filter((link) => seen.has(link.source) && seen.has(link.target));

function adapt(node, path) {
  const id = path;
  return {
    id,
    name: node.name,
    nodeId: node.sctid ? String(node.sctid) : null,
    rmType: node.children ? "branch" : "leaf",
    bindings: node.sctid ? [{ code: String(node.sctid), status: "both" }] : [],
    children: (node.children || []).map((child, index) => adapt(child, `${path}/${index}`)),
    open: true,
  };
}

const tree = adapt(template, "templates");
const forceSvg = document.querySelector("#forceSvg");
const treeSvg = document.querySelector("#treeSvg");
document.querySelector("#d3version").textContent = D3_VERSION;

renderForceGraph(forceSvg, { nodes, links });
renderTemplateTree(treeSvg, tree);

document.querySelector("#lcp").addEventListener("click", () => {
  const focus = ["281233007", "91689009", "59820001"];
  const decorated = nodes.map((node) => ({ ...node, cp: false, lcp: false }));
  const linkArray = links.map((link) => ({ source: link.source, target: link.target }));
  if (typeof lcpDecorator !== "function") return;
  lcpDecorator(linkArray, decorated, focus);
  const marked = decorated.map((node) => ({
    ...node,
    mark: [
      focus.includes(node.id) ? "is-focus" : "",
      node.lcp ? "is-lcp" : "",
      node.cp && !node.lcp ? "is-cp" : "",
    ].filter(Boolean).join(" "),
  }));
  renderForceGraph(forceSvg, { nodes: marked, links });
});
