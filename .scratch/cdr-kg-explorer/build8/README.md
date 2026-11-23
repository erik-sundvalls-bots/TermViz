# V8 build sources (KG explorer prototype)

Sources for `public/prototyping/v8-multilingual-stack-demo.html` (one self-contained file).
Kept here so the build can be redone after a lost workspace.

The scripts expect this layout: `variants/build8/` (this folder) next to `variants/lib/`.

* Runtime SNOMED CT `$lookup` calls in `v8-src.html` (`txLookup`) pass `version=http://snomed.info/sct/45991000052106` (Swedish edition, which also carries international English descriptions).
* `v8-src.html` is the app (HTML, CSS and JS) with four placeholders: `<script>/*D3*/</script>`, `/*DAG*/`, `/*DATA*/` and `/*EHRTSlib*/`.
* `inline-v8.py` fills the placeholders from `../lib/{d3.min.js,d3-dag.min.js,v8-data.js,ehrtslib-browser.min.js}` and writes `../v8-multilingual-stack-demo.html`.
* `build-ehrtslib.ts` bundles ehrtslib (IIFE, global `EHRTSlib`, `keepNames`) from a checkout of a release tag into `../lib/ehrtslib-browser.min.js`, using the exports in `ehrtslib-entry.ts`. Current: **v0.16.0** (`git clone --depth 1 --branch v0.16 https://github.com/ErikSundvall/ehrtslib.git`, then `EHRTSLIB_ROOT=<checkout> deno run -A build-ehrtslib.ts`). The official ESM bundles are at https://eriksundvall.github.io/ehrtslib/lib/v0.16/.
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
* "Alla attribut" on the archetype layer shows the **full archetype**. The bundled archetype trees come from the IPS OPT (only the nodes the template constrains, e.g. blood pressure = systolic + diastolic), so expanding an archetype in that mode fetches its ADL from the archetype library, parses it with ehrtslib `parseAdl` (`aomParts` maps the AOM to the tile tree; the built-in ADL 1.4 scanner `adlDefinitionFrames` is only a fallback if ehrtslib throws, and the console says which parser ran; the tooltip shows it too) and swaps in a tree with the same node ids (`aid|/rel-path`) plus State/Protocol groups and slots. Its SNOMED CT term bindings are merged into the binding links.
  * Setting "Arketypbibliotek" (`archRepo` in `cdr-v8-settings`): a CKM-mirror base URL, a GitHub repo URL (turned into raw.githubusercontent.com, default path `local/archetypes/`), a URL pattern with `{id}` or `{path}` (e.g. `entry/observation/<id>.adl`), or a CKM server URL ending in `/ckm` (REST: `/rest/v1/archetypes/citeable-identifier/{id}` then `/rest/v1/archetypes/{cid}/adl`).
  * Empty = automatic: `../models/ips-fileset/archetypes/` (same origin, the IPS file set), then `https://raw.githubusercontent.com/openEHR/CKM-mirror/master/local/archetypes/` (CORS `*`), then the CKM REST API. ckm.openehr.org sends no `Access-Control-Allow-Origin` header (checked 2026-11-23), so the CKM API only works from a browser through a CORS proxy.
  * Fetched ADL is cached in IndexedDB `cdr-v8-adl-cache`, store `adl`, key `archetypeId|archRepo`, with the lookup cache TTL (default 60 days).
* Hover: the traced path is emphasised (thicker, darker links and node outlines); links that are not on the path stay drawn at 85 % opacity instead of fading out.
* `test-v8-full-archetype.mjs [shot-dir]` serves `public/` (so `../models` resolves), checks that hovering keeps the other links visible, probes the archetype sources from the browser, and checks the full blood pressure archetype in "Alla attribut" (tiles, cuff size binding, cache reuse after reload).
* `test-v8-adl-parsers.mjs` compares the ehrtslib and built-in trees (ids, kinds, names, data types, slot patterns, order, SNOMED CT bindings) on all bundled IPS archetypes plus blood_pressure.v2 from the CKM-mirror.
* Paint order: `bindBoxGroup` calls `selection.order()` after each join, so a container is always painted under its tiles (an opened pill used to be appended after its children and hid their shading).
* Layout: containers with bigger subtrees get slightly larger sibling gaps (+0..3 px) and inner margin (+0..2 px, the cascade overhang stays >= 1 px); the gap between top-level tiles grows from 15 to at most 24 px with the largest opened subtree. Everything is re-laid out on each render (also after a full archetype arrives).
* `test-v8-shading.mjs [shot-dir] [prefix]` opens archetypes/templates in several orders, mid-transition, with language and Only used/All attributes switches, and checks that every opened tile has a filled, stroked card under its children and that top-level subtrees (per band) and nested siblings do not overlap.
* `test-v8-no-patients.mjs [shot-dir]` checks the toolbar (cascade-offset slider now in the settings menu, persisted; SV|EN as one touching group) and the patient toggles (Eva, Lars, +30 synthetic as independent on/off buttons in one square-cornered group): every combination including all off, the empty instance layer with its hint, no used attributes in Only used, bindings still shown, the selection surviving a reload, and migration of older persisted settings (v3 / `patient: both|none|name`).
* `test-v8-attr-bindings.mjs [shot-dir]` checks the blood pressure attribute bindings (links, hover) and the attribute switch.
* `snap8-synth.mjs` and `snap8-synth-dist.mjs` are headless Chrome checks using playwright-core: the default views compared against a baseline, the problem distribution, and screenshots.

Rebuild:

    python3 extract-libs.py ../../public/prototyping/v8-multilingual-stack-demo.html   # once, libs only
    python3 synth/gen-synth.py && python3 inline-v8.py
