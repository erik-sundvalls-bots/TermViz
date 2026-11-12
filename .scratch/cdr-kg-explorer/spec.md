# PRD: CDR Catalyst knowledge-graph explorer, split-view edition

<!-- Spec for the feature `cdr-kg-explorer`, kept in the local-markdown issue-tracker layout (`.scratch/<feature>/spec.md`) used by the engineering agent skills. Implementation tickets can go in `.scratch/cdr-kg-explorer/issues/NN-<slug>.md`. -->

Status: draft v2, 2026-11-12. Owner: Erik Sundvall. Target design: **V7 collapsible stack**, built piece by piece in small PRs on top of TermViz PR #2. Replaces draft v1 (2026-11-11), which was also the basis for PR #2.

## 1. Why
The single banded Sugiyama graph of TermViz PR #1 became a hairball. PR #2 restarted from a copy of `termviz-mapper-test.html` (calm look, split view, root on top, one root per ontology). The layout study (V1–V7) showed that the views can stay readable at every scale if every layer can be collapsed and links follow what is visible. V7 is the agreed target.

## 2. Target design (V7)
One page, three layers stacked from top to bottom:

1. **Terminologies (top).** The locked Sugiyama DAG of PR #2, with one root per code system: SNOMED CT, ICD-10, ATC and NPU. The SNOMED CT is-a closure is folded: used codes, the root, its children and branch points are kept, and the other intermediate concepts are grouped into clickable **"+n" clusters**. Intermediate labels are hidden by default and appear on hover, along a traced path, or with a global switch.
2. **Design time (middle).** Reusable **archetypes** sit in a row above the **templates** that use them. Clicking a pill opens it as a content-sized treemap built from the OPT: clusters, elements with value types, slots and term-binding dots.
3. **Instances (bottom).** Patients, compositions, sections, entries and elements are drawn as **cascaded treemaps** (Lü & Fogarty). Tiles are sized by their text, with no extra whitespace. Any card can be shrunk to a blob that shows an element count.

Cross-cutting behaviour:
- **Collapse and expand in every layer:** DAG clusters, archetype and template treemaps, and instance cards. There are also "Collapse everything" and "Expand all" buttons.
- **Link aggregation.** Each link is defined at the finest level (instance element → archetype element → concept, instance → template, template → archetype, and DAG is-a). It is drawn to the nearest visible node on each side. If an end is collapsed, there is one solid bundled link whose width and badge show the count. If both ends are expanded, the link becomes a dotted element-level link.
- **Hover path highlighting.** Hovering any node highlights its full chain, for example a value → its archetype element → the bound concept → the code system root.
- **Realistic element-level example data** on real IPS template paths: two fictitious patients (Eva Holmgren, Lars Nyström), plus an optional cohort of 30 synthetic patients that starts collapsed. All example data is clearly labelled.
- **Tight tiles:** cards are packed with an order-preserving skyline packer, with no weights and no padding beyond the cascade offset.
- **Offline cache:** a bundled cache holds the OPT tree, the instances and the terminology closure, with Swedish and English terms (tx-nordics SE edition and International). A build script creates it. The server is used only for "Add children/siblings" and live refresh, and the UI shows whether data is cached or live.
- **Cherry-picking:** clicking instance or template nodes picks them, and the top pane can then show only their codes and ancestors. Named pick lists are saved in the URL hash, with presets in the manifest.
- **Language:** Swedish terms by default and an English switch. The English prototype shows the target content.
- Keep the PR #2 / mapper look: fonts, curves, zoom controls, concept popover, pin and label switches, and loading feedback that names any failing URL.

## 3. Roadmap: small PRs on top of PR #2
Each step is its own PR, stacked on the previous one. Each must be previewable on its own under `/TermViz/previews/pr-<n>/` and keep the earlier steps working.

| Step | PR content | Preview shows |
|---|---|---|
| 0 | **PR #2** (exists): mapper copy, root on top, one root per ontology | Split view with the IPS template and codes |
| 1 | Data and offline cache: OPT → template tree, element-level example instances, terminology closure (sv + en), build script, cached/live badge | The same view loading fully offline |
| 2 | Top DAG folding: "+n" clusters (click to expand), hidden intermediate labels, label switch | A readable SNOMED CT closure |
| 3 | Middle layer: archetype row above template row; template → archetype and archetype → concept links, bundled with counts | The design layer under the DAG |
| 4 | Bottom layer: content-sized cascaded instance treemaps, Both / Eva / Lars, instance → archetype and instance → template links | All three layers, static |
| 5 | Collapse and expand in all layers, plus the link aggregation rule (bundled ↔ dotted) and "Collapse everything / Expand all" | V7 interaction |
| 6 | Hover path highlighting across layers | Tracing a value to its root |
| 7 | Cherry-pick lists in the URL hash, synthetic cohort toggle, sv/en switch | Teaching presets |

Steps 2 and 3 can be done in parallel. Each PR should stay at about one agent session.

## 4. Out of scope
- Editing the shared Google Doc.
- Value-set expansion beyond the coded lists in the template.
- ICD-10-SE and KVÅ.
- Server-side persistence.
- Real patient data.

## 5. Success criteria
- At first load, with no access to the terminology server, the page shows the IPS template, both patients and their codes within 2 seconds.
- With everything collapsed, the page fits one screen. Expanding one archetype or one patient keeps the other positions stable.
- Picking 5 instance nodes gives a readable top pane of at most about 40 visible nodes, with no overlapping labels at Fit.
- There are no visual regressions against PR #2 / `termviz-mapper-test.html`. Every step deploys to its PR preview.

## 6. Decisions taken (from v1 open questions)
1. Instances get their own bottom layer, not an extra level of the template tree.
2. ICD-10, ATC and NPU share the top pane with SNOMED CT, each with its own root.
3. The work builds on PR #2. PR #1 is kept for reference.

## 7. Open questions
1. **SNOMED CT depth folding:** is clustering enough, or should very deep chains (for example the 32-concept anatomy chain) also be folded to a fixed depth?
2. **Archetype slots:** when an archetype or template is opened, show all 52 slots of the IPS template, or only those used by the instances (with a "show all" switch)?
3. **Example data:** update `ips-kg-example.json` to match the prototype by replacing influenza vaccine 46233009 (our own proposal, inactive in the SE edition) with 1181000221105, and settling Eva's fracture code as ICD-10 S52.1 (not S52.5 as in earlier notes)?
4. **Default language:** should the page start in Swedish (as now) or follow the browser?

## 8. Prototypes (example data only)
- Index: https://erik-sundvalls-bots.github.io/TermViz/prototyping/
- Overview and comparison: https://erik-sundvalls-bots.github.io/TermViz/prototyping/variants-overview.html
- V7 target: https://erik-sundvalls-bots.github.io/TermViz/prototyping/v7-collapsible-stack-demo.html (English: `v7-collapsible-stack-demo-en.html`)
- Earlier variants: `v1-three-bands.html`, `v2-template-icicle.html`, `v3-archetype-hub.html`, `v4-patient-timeline.html` (static mockups), `v5-nested-treemap-demo.html`, `v6-cascaded-stack-demo.html` (interactive), all under the same prototyping/ URL.
- The source files are in this repo under [`public/prototyping/`](../../public/prototyping/) (start with [`index.html`](../../public/prototyping/index.html) and [`v7-collapsible-stack-demo.html`](../../public/prototyping/v7-collapsible-stack-demo.html)). The V7 demos open with only Lars Nyström shown.
