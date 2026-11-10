# TermViz

Terminology visualisation for the browser. The original component (2013) drew a SNOMED CT is-a graph with D3 v2 and a template dendrogram underneath it. This tree uses **D3 7.9.2**. `src/termviz-2.js` replaces `termviz.js`, because `d3.layout.force`, `d3.layout.cluster` and `d3.svg.diagonal` no longer exist.

## Mapping bench

[termviz-mapper-test.html](termviz-mapper-test.html) is the International Patient Summary example.

- The lower tree is the CKM operational template `International Patient Summary.opt`, parsed with [ehrtslib](https://github.com/ErikSundvall/ehrtslib) 0.11 (`parseOptXml`). Node labels come from the template’s term definitions. Where the template fixes a runtime name, such as the section title “Problem List”, that name is shown instead. When a leaf’s SNOMED bindings or map rows come from its value list, every value in that list is drawn under the leaf, including values that have no mapping of their own.
- SNOMED CT term bindings embedded in the OPT are compared with the archetype fileset exported beside it. ehrtslib 0.11’s `parseOptXml` stores term texts and leaves `ontology.term_bindings` empty, so the OPT bindings are read from the same XML document. Archetype bindings are read with `parseAdl`. Sixteen of the forty ADL files use a cADL construct that parser rejects; for those, the terminology section is parsed on its own behind a stub definition, still through `parseAdl`.
- On this fileset the check is even: **26 SNOMED CT bindings, all present both in the OPT and in the archetypes, none missing, none in conflict.** The bench still applies the rule, and a binding that existed only in an archetype would be marked as added.
- Mapping candidates start from the Snap2SNOMED map in `public/maps/ips-snap2snomed-extended.csv`. The earlier candidate file stays at `public/maps/ips-snap2snomed.csv`. Both use `source_code`, `source_display`, `target_code`, `target_display`, `relationship_type`. Each openEHR path is matched to the template node, including a value code such as `value[at0005]`. A row’s relationship is one of `TARGET_EQUIVALENT`, `TARGET_BROADER`, `TARGET_NARROWER`, or `TARGET_INEXACT`, drawn as a glyph. Hovering the glyph shows the full code and its meaning. Load mapping suggestions opens another map the same way as Load template. On each suggestion the relationship menu, OK, and Dismiss sit on the same line as the term. The relationship control is a dropdown: the glyph, the name, and a caret sit in the button, and the list shows the same glyph beside each choice. Each suggestion group has Add from graph. That arms the pointer; the next concept clicked in the SNOMED graph is inserted at the top of that group, as an equivalent, and the pointer returns to normal. Press the button again or Escape to cancel. OK accepts the row and switches it on. Dismiss takes that row out of the graph and the downloaded file, and the group switch ignores dismissed rows so the rest of the group can still be turned off or on together. Pressing the active button again clears it: clearing Dismiss switches that row back on in every copy of the path whose group is still on, and clearing OK leaves the switches as they are. The same source and target stay in step when a path is used twice.
- Several of those nodes can be switched on at once. Each keeps one colour. The suggestion list sits in the upper pane. The graph itself is a force-directed is-a graph (SNOMED CT is not a tree). Only the suggested or bound concept is coloured; ancestors stay in the graph in white. A concept claimed by two or more colours is drawn as a pie of those colours, with a dark outline. Sugiyama is the layout that opens. Tangled tree lays the same concepts out from the root on the left, with a slightly larger label on every concept and tighter columns and rows so more of the tree fits in the pane. Its links stay neutral until a concept is hovered, and then the whole path up to the root and down through every descendant is drawn bolder, in the parent and child colours, on top of the other curves. Sugiyama lays them from the root at the top, with longest-path layering, optimal crossing reduction, and quadratic coordinates. Its edges have no arrowheads. Each rank is only as wide as its labels: a label wraps once it reaches about ninety pixels, and a concept with no resting label keeps a disk-sized slot. Turning always-show label on makes room for that text on its rank; the other concepts keep their order and only slide apart. Its labels and hover follow the force graph: the suggested and bound concepts, the root, and the first level stay labelled, and a hover lights only the immediate parents and children, with those edges drawn bolder on top. Least common parents of the concepts that are switched on, from the original path-to-root algorithm, also have Always show label turned on. A graph too large for the optimal ordering falls back to two-layer ordering, and the caption says so. Rotate tree turns the template dendrogram 90 degrees clockwise on each click, through root at the bottom, left, top, and right. Suggestions whose target is inactive, or missing from the terminology server, are left out. Every disk is the same size. Unpinned is-a links stay within 140px. Hovering lights the concept, its children, and its parents, and shows those names. With a mouse the concept popup opens on click. A long press still opens it on a touch screen. The popup lists that concept’s SNOMED CT descriptions and synonyms. The bundled demo already carries them, so opening one of those concepts does not call the terminology server. From that popup, Add children and Add siblings ask the terminology server for the concepts directly under the selected one, or beside it. Five or fewer are added straight away. A longer answer widens the popup into a checklist. The template filter is Mapping suggestions, Template bindings, or Whole template + suggestions, and the search field sits inside the active one so it only matches that subset. In the Sugiyama layout, a hover name that would cover another label slides that rank open, and the rank closes again when the pointer leaves. The SNOMED CT root starts in the middle, and its children start pinned on a circle around it. The concept popup can unpin them. There is no downward pull. The burst control next to the zoom buttons pushes unpinned concepts outward for a moment. A dashed line in the template node’s colour runs from each sidebar row to its concepts. Sliding the list away hides those lines. Hovering a template node still highlights its sidebar row and the SNOMED CT concepts that row points at. Concept ids and terms stay in the sidebar as underlined links to the [SNOMED CT browser](https://browser.ihtsdotools.org/). Labels stay horizontal in all four directions.
- The graph starts from `src/snomed-closure.json`, the ancestor closure of the International Patient Summary guesses and bindings up to SNOMED CT Concept `138875005`, fetched once from the [HL7 Nordic Ontoserver](https://tx-nordics.fhir.org/fhir/r4/). `npm run fetch-snomed` rebuilds that file. Opening the default demo does not call the terminology server. A later template adds the concepts and paths to root that it binds, in memory and in `localStorage` under `termviz.snomed.lookup.v1`. Previously cached concepts stay.
- The template bar shows the template in use, which starts as the International Patient Summary. **Load template** opens a dialog. The [Ehrtslib](https://github.com/ErikSundvall/ehrtslib) TypeScript library reads an openEHR template in any of the formats OPT, OET, web template JSON, or ADL file. A GitHub file URL to a `*.t.json` template from Archetype Designer also pulls the archetype dependencies/closure. The dialog stays open, with progress or the error, until the template has loaded or the attempt has failed. The search field inside the active filter refits the lower tree as the text changes. Hovering a sidebar category heading lights the dashed lines of every row under that heading.

SNOMED CT content is shown under the affiliate licence terms that apply to you. The Nordic server used here is a public HL7 terminology endpoint; it is not a bulk extract of SNOMED CT.

## GitHub Pages

The fork publishes a static build at [erik-sundvalls-bots.github.io/TermViz](https://erik-sundvalls-bots.github.io/TermViz/). `npm run pages` builds with `base` `/TermViz/` and copies the 2013 scripts the legacy page still loads. That output is the `gh-pages` branch.

## Run

```bash
npm install
npm run dev
```

The dev server listens on port **44731**. Open the mapping bench at `/termviz-mapper-test.html`.

`npm run check` rebuilds the template model in Node and checks the three suggestion targets, the systolic binding `271649006`, and the 26 shared SNOMED bindings.

## Other pages

- `/` — short index
- `/termviz-test-1.html` — the original cardiovascular sample, redrawn with the D3 7 force layout, and the least-common-parent highlight
- `/legacy/termviz-test-1-d3v2.html` — the 2013 page, still on D3 v2
- `AAUtemplateConverter.html` — the CSV-to-tree helper, now calling `d3.csvParse` from D3 7.9.2

## Citing the original work

TermViz is based on mostly publicly funded research and is free to use for any purpose (MIT licensed) with the exception of SNOMED CT examples, which stay under SNOMED CT’s own licence.

1. Interactive Visualization and Navigation of Complex Terminology Systems, Exemplified by SNOMED CT. Sundvall E, Nyström M, Petersson H, Åhlfeldt H. Proceedings of MIE 2006, p. 851–856. [urn:nbn:se:liu:diva-38011](https://urn.kb.se/resolve?urn=urn:nbn:se:liu:diva-38011)
2. Methods and applications for visualization of SNOMED CT concept sets. Anne Randorff Højen, Erik Sundvall, Kirstine Rosenbeck Gøeg. [doi:10.4338/ACI-2013-09-RA-0071](https://doi.org/10.4338/ACI-2013-09-RA-0071)
3. Visualizing sets of SNOMED CT concepts to support consistent terminology implementation and reuse of clinical data. Anne Randorff Højen, Erik Sundvall, Kirstine Rosenbeck Gøeg. Medinfo 2013. [doi:10.3233/978-1-61499-289-9-1160](https://doi.org/10.3233/978-1-61499-289-9-1160)

Further context is in chapter 3.1 of Erik Sundvall’s thesis, [urn:nbn:se:liu:diva-87693](http://urn.kb.se/resolve?urn=urn:nbn:se:liu:diva-87693).

## Licence

MIT. Copyright (C) 2013 Erik Sundvall & Anne Randorff Rasmussen. The 2026 mapping bench is part of the same project.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

D3 is ISC, copyright Mike Bostock. ehrtslib is Apache-2.0, copyright Erik Sundvall. The vendored parser bundle is `public/vendor/ehrtslib-0.11.0-parser.min.js`. The patient-summary template and archetypes are the CKM export of template 1013.26.376 and are included so the bench runs without fetching CKM.
