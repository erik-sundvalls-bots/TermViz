# PRD: CDR Catalyst knowledge-graph explorer, split-view edition

<!-- Spec for the feature `cdr-kg-explorer`, kept in the local-markdown issue-tracker layout (`.scratch/<feature>/spec.md`) used by the engineering agent skills. Implementation tickets can go in `.scratch/cdr-kg-explorer/issues/NN-<slug>.md`. -->

Status: draft v4, 2026-11-16. Owner: Erik Sundvall. Target design: **V8 multilingual collapsible stack**, a single page with a Swedish/English switch on top of the V7 interaction. Replaces draft v3 (same day), which still named V7 as the target. Built piece by piece in small PRs on top of TermViz PR #2. Replaces draft v1 (2026-11-11), which was also the basis for PR #2.

## 1. Why
The single banded Sugiyama graph of TermViz PR #1 became a hairball. PR #2 restarted from a copy of `termviz-mapper-test.html` (calm look, split view, root on top, one root per ontology). The layout study (V1–V7) showed that the views can stay readable at every scale if every layer can be collapsed and links follow what is visible. V8 is the agreed target: the V7 interaction in one multilingual prototype, with the patient filter driving the terminology subset.

## 2. Target design (V8)
One page, three layers stacked from top to bottom:

1. **Terminologies (top).** The locked Sugiyama DAG of PR #2, with one root per code system: SNOMED CT, ICD-10, ATC and NPU. The SNOMED CT is-a closure is folded: used codes, the root, its children and branch points are kept, and the other intermediate concepts are grouped into clickable **"+n" clusters**. Intermediate labels are hidden by default and appear on hover, along a traced path, or with a global switch.
2. **Design time (middle).** Reusable **archetypes** sit in a row above the **templates** that use them. Clicking a pill opens it as a content-sized treemap built from the OPT: clusters, elements with value types, slots and term-binding dots.
3. **Instances (bottom).** Patients, compositions, sections, entries and elements are drawn as **cascaded treemaps** (Lü & Fogarty). Tiles are sized by their text, with no extra whitespace. Any card can be shrunk to a blob that shows an element count.

Cross-cutting behaviour:
- **Collapse and expand in every layer:** DAG clusters, archetype and template treemaps, and instance cards. There are also "Collapse everything" and "Expand all" buttons.
- **Link aggregation.** Each link is defined at the finest level (instance element → archetype element → concept, instance → template, template → archetype, and DAG is-a). It is drawn to the nearest visible node on each side. If an end is collapsed, there is one solid bundled link whose width and badge show the count. If both ends are expanded, the link becomes a dotted element-level link.
- **Hover path highlighting.** Hovering any node highlights its full chain, for example a value → its archetype element → the bound concept → the code system root.
- **Realistic element-level example data** on real IPS template paths: two fictitious patients (Eva Holmgren, Lars Nyström), plus an optional cohort of 30 synthetic patients that starts collapsed. All example data is clearly labelled.
- **Patient filter drives the terminology subset.** The top DAG shows only the codes used by the currently selected patients’ instance data, plus the ancestors, branch points and clusters needed to keep the is-a graph readable. The kept set is recomputed at runtime from the bundled closure (and from any codes fetched live). Every visible “used” concept must be coded in the selected instances, and every instance code must appear in the DAG. Patient-filter changes animate.
- **Tight tiles:** cards are packed with an order-preserving skyline packer, with no weights and no padding beyond the cascade offset.
- **Offline cache:** a bundled cache holds the OPT tree, the instances and the terminology closure, with Swedish and English terms (tx-nordics SE edition and International). A build script creates it. The server is used only for "Add children/siblings" and live refresh, and the UI shows whether data is cached or live.
- **Cherry-picking:** clicking instance or template nodes picks them, and the top pane can then show only their codes and ancestors. Named pick lists are saved in the URL hash, with presets in the manifest.
- **Language:** one multilingual prototype. Swedish is the default (`?lang=sv`; open question 4, whether to follow the browser, is still unanswered). An SV/EN toggle in the header (and again in Settings) swaps UI strings, terminology displays, archetype/template/element names and instance values where both exist. The choice is persisted in the URL (`?lang=sv|en`) and in localStorage, and must not reset expand/collapse state. Label-width changes animate with the ordinary layout transitions.
- Keep the PR #2 / mapper look: fonts, curves, zoom controls, concept popover, pin and label switches, and loading feedback that names any failing URL.
- **Smooth transitions.** Most big graph changes — cluster expand/collapse, Sugiyama re-layouts, archetype or template expand-to-treemap, instance treemap collapse or expand, and patient-filter changes — must animate with object constancy: keyed joins on stable ids, about 900 ms, easeCubicInOut. Nodes, cluster pills and hulls tween from their old positions to the new ones; edges morph; entering items fade in from the expanded cluster's or parent card's previous position; exiting items shrink into the collapsed position. If the user clicks mid-transition, the next animation starts from the in-flight positions. A Settings cogwheel (⚙) offers Animations: Follow system (default, respects `prefers-reduced-motion`), Always on, or Off, and shows the current system reduce-motion state. The page also has a FHIR terminology-server URL (default `https://tx-nordics.fhir.org/fhir/r4`) used for live `$lookup` of codes missing from the offline cache, with a status line and a cache fallback when offline. Uploads are accepted for archetypes (`.adl`, JSON), templates (`.opt` XML, web template JSON) and EHR instance data (canonical JSON/XML or FLAT JSON). Instance data is uploaded by directory (`webkitdirectory`): one sub-directory per patient, and the directory name is the patient label. Uploaded files are stored in the browser in IndexedDB (localStorage is only about 5 MB). Parsing uses the Apache-2.0 ehrtslib library in the browser. Each setting has “reset to default”, and “Reset all to factory settings” also clears stored uploads, after a confirm.
- **Treemap styling.** Tiles keep the tight content-fitted sizing. The look is inspired by the [Observable cascaded treemap](https://observablehq.com/@d3/cascaded-treemap): thin strokes (about 0.5–1 px, or fill steps with no stroke), square corners (no rounded rects on treemap tiles), and a slightly tighter default cascade offset (3 px) and header padding so the packing stays compact and less cluttered.
- **Link de-emphasis and z-order.** Is-a links inside the top terminology DAG (SNOMED CT, ICD-10, ATC, NPU) stay opaque, in a solid mid-grey, and narrow (about 0.75–1 px) until highlighted, when they become thicker and use the highlight colour. Only the cross-layer links (instance → archetype → concept, bundled and dotted) stay faint while idle (about 0.12–0.2 opacity, thinner). Layer order: expanded treemap tiles sit underneath the cross-layer arcs so you can see where the dotted arcs land on their sub-tiles; collapsed pills and the top DAG nodes sit above those arcs; labels sit on top. Treemap labels do not use a paper-coloured halo (it smears light text on dark tiles); they use a tight backing in the tile colour, or a contrast-aware halo, so small labels stay crisp when arcs cross them. Hover or selection restores the highlighted path to full strength.

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
- Expanding or collapsing a large SNOMED CT cluster, a treemap, or a patient filter animates over about 900 ms so existing nodes can be followed to their new positions (unless the user prefers reduced motion).

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
- V8 target (multilingual): https://erik-sundvalls-bots.github.io/TermViz/prototyping/v8-multilingual-stack-demo.html
- V7 (kept): https://erik-sundvalls-bots.github.io/TermViz/prototyping/v7-collapsible-stack-demo.html (English: `v7-collapsible-stack-demo-en.html`)
- Earlier variants: `v1-three-bands.html`, `v2-template-icicle.html`, `v3-archetype-hub.html`, `v4-patient-timeline.html` (static mockups), `v5-nested-treemap-demo.html`, `v6-cascaded-stack-demo.html` (interactive), all under the same prototyping/ URL.
- The source files are in this repo under [`public/prototyping/`](../../public/prototyping/) (start with [`index.html`](../../public/prototyping/index.html) and [`v7-collapsible-stack-demo.html`](../../public/prototyping/v7-collapsible-stack-demo.html)). The V8 (and V7) demos open with only Lars Nyström shown.
