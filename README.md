# TermViz

Terminology visualisation for the browser. The original component (2013) drew a SNOMED CT is-a graph with D3 v2 and a template dendrogram underneath it. This tree uses **D3 7.9.2**. `src/termviz-2.js` replaces `termviz.js`, because `d3.layout.force`, `d3.layout.cluster` and `d3.svg.diagonal` no longer exist.

## Mapping bench

[termviz-mapper-test.html](termviz-mapper-test.html) is the International Patient Summary example.

- The lower tree is the CKM operational template `International Patient Summary.opt`, parsed with [ehrtslib](https://github.com/ErikSundvall/ehrtslib) 0.11 (`parseOptXml`). Node labels come from the template’s term definitions. Where the template fixes a runtime name, such as the section title “Problem List”, that name is shown instead.
- SNOMED CT term bindings embedded in the OPT are compared with the archetype fileset exported beside it. ehrtslib 0.11’s `parseOptXml` stores term texts and leaves `ontology.term_bindings` empty, so the OPT bindings are read from the same XML document. Archetype bindings are read with `parseAdl`. Sixteen of the forty ADL files use a cADL construct that parser rejects; for those, the terminology section is parsed on its own behind a stub definition, still through `parseAdl`.
- On this fileset the check is even: **26 SNOMED CT bindings, all present both in the OPT and in the archetypes, none missing, none in conflict.** The bench still applies the rule, and a binding that existed only in an archetype would be marked as added.
- Three nodes that hold a clinical name at runtime, and are not themselves bound, carry five imperfect SNOMED CT guesses each: Medication item, Problem/Diagnosis name, and Procedure name. The guesses are ranked and wrong in ordinary ways (too broad, too narrow, wrong axis).
- Selecting one of those nodes asks the [HL7 Nordic Ontoserver](https://tx-nordics.fhir.org/fhir/r4/) (`CodeSystem/$lookup`, properties `parent` and `inactive`) for every guess and then for each parent, until SNOMED CT Concept `138875005`. Lookups are cached in memory and in `localStorage` under `termviz.snomed.lookup.v1`. The upper pane draws that ancestor closure, with is-a arrows pointing at the parent.

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
