# V8 build sources (KG explorer prototype)

Sources for `public/prototyping/v8-multilingual-stack-demo.html` (one self-contained file).
Kept here so the build can be redone after a lost workspace.

The scripts expect this layout: `variants/build8/` (this folder) next to `variants/lib/`.

* Runtime SNOMED CT `$lookup` calls in `v8-src.html` (`txLookup`) pass `version=http://snomed.info/sct/45991000052106` (Swedish edition, which also carries international English descriptions).
* `v8-src.html` is the app (HTML, CSS and JS) with four placeholders: `<script>/*D3*/</script>`, `/*DAG*/`, `/*DATA*/` and `/*EHRTSlib*/`.
* `inline-v8.py` fills the placeholders from `../lib/{d3.min.js,d3-dag.min.js,v8-data.js,ehrtslib-v012-browser.min.js}` and writes `../v8-multilingual-stack-demo.html`.
* `extract-libs.py <published.html> [--data]` gets those lib files back from any published V8 HTML. The minified libs are not committed.
* `v8-data.base.js` is the bilingual payload merged from V7 by `merge-v8-data.py`. It covers the ontology, archetypes, templates and the two real example patients.
* `synth/gen-synth.py` reads `v8-data.base.js` and writes `../lib/v8-data.js`. It adds:
  * `D.synth`, compact specs for 30 synthetic IPS patients with a fixed seed. The app expands each spec using Eva's IPS entries as structural templates.
  * the SNOMED CT closure for the new codes, from tx-nordics `$lookup`: Swedish labels from the SE edition, English from the International edition, cached in `synth/sct-cache-synth.json`.
  * ICD-10 chapter, block and code chains, ATC levels and NPU nodes.
  * new precomputed clusters, `sct:cl25` and up. Existing nodes and clusters are left untouched.
* `synth/pool.py` is the clinical pool: problems, medications, labs, procedures, allergies and vaccines.
* `synth/lk.py` and `synth/ex.py` are small helpers for SNOMED CT `$lookup` and `$expand` searches.
* `extract-adl-bindings.py` prints the `ADL_SCT_BINDINGS` constant in `v8-src.html`: SNOMED CT `term_bindings` per archetype at-code from `public/models/ips-fileset/archetypes`. The app maps them onto attribute nodes (and the root for at0000), adds them to the archetype bindings and fetches missing target concepts with `$lookup` (cached in IndexedDB). LOINC bindings are skipped because there is no LOINC band.
* Expanded archetype and template tiles have a per-layer switch, "Endast använda" (default: only attributes with values in the shown patients) or "Alla attribut". The choice is saved with the other settings (`attrMode`).
* `test-v8-attr-bindings.mjs [shot-dir]` checks the blood pressure attribute bindings (links, hover) and the attribute switch.
* `snap8-synth.mjs` and `snap8-synth-dist.mjs` are headless Chrome checks using playwright-core: the default views compared against a baseline, the problem distribution, and screenshots.

Rebuild:

    python3 extract-libs.py ../../public/prototyping/v8-multilingual-stack-demo.html   # once, libs only
    python3 synth/gen-synth.py && python3 inline-v8.py
