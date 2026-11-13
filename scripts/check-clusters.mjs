import assert from "node:assert/strict";
import { foldSnomedClusters } from "../src/termviz-2.js";

function chain() {
  const nodes = ["R", "A", "B", "C", "D", "F"].map((id) => ({
    id,
    name: id,
    suggestion: id === "F",
    sliceFills: id === "F" ? ["#8dd3c7"] : [],
  }));
  const links = [
    ["A", "R"],
    ["B", "A"],
    ["C", "B"],
    ["D", "C"],
    ["F", "D"],
  ].map(([source, target]) => ({ source, target }));
  return { nodes, links };
}

const folded = foldSnomedClusters(chain().nodes, chain().links, { clustering: true });
const ids = folded.nodes.map((node) => node.id);
assert.ok(ids.includes("R") && ids.includes("A") && ids.includes("D") && ids.includes("F"), "kept nodes stay");
assert.ok(!ids.includes("B") && !ids.includes("C"), "intermediate chain is folded");
const cluster = folded.nodes.find((node) => node.kind === "cluster");
assert.equal(cluster.members.join(","), "B,C");
assert.equal(cluster.name, "+2");
assert.ok(folded.links.some((link) => link.source === cluster.id && link.target === "A"));
assert.ok(folded.links.some((link) => link.source === "D" && link.target === cluster.id));
assert.equal(folded.hulls.length, 0);

const open = foldSnomedClusters(chain().nodes, chain().links, { clustering: true, expanded: new Set([cluster.id]) });
assert.ok(open.nodes.some((node) => node.id === "B" && node.clusterId === cluster.id));
assert.ok(open.nodes.some((node) => node.id === "C" && node.clusterColor));
assert.equal(open.hulls.length, 1);
assert.deepEqual(open.hulls[0].members, ["B", "C"]);
assert.equal(open.nodes.find((node) => node.kind === "cluster"), undefined);

const branchNodes = ["R", "A", "B", "F", "G"].map((id) => ({
  id,
  name: id,
  suggestion: id === "F" || id === "G",
  sliceFills: id === "F" || id === "G" ? ["#8dd3c7"] : [],
}));
const branchLinks = [
  ["A", "R"],
  ["B", "A"],
  ["F", "B"],
  ["G", "B"],
].map(([source, target]) => ({ source, target }));
const branched = foldSnomedClusters(branchNodes, branchLinks, { clustering: true });
assert.ok(branched.nodes.every((node) => node.kind !== "cluster"), "a branch point is not folded away");
assert.ok(branched.nodes.some((node) => node.id === "B"));

const off = foldSnomedClusters(chain().nodes, chain().links, { clustering: false });
assert.equal(off.nodes.length, 6);
assert.equal(off.hulls.length, 0);

console.log("cluster checks passed");
