# Template knowledge-graph examples

These JSON files feed the **CDR Catalyst knowledge graph** page (`ips-kg-demo.html`).

## Load path

1. Fetch [`manifest.json`](manifest.json) (`schema`: `template-kg-examples-manifest/v1`).
2. For each entry in `examples`, fetch `data/kg-examples/<path>` via `publicUrl()` (same pattern as `models/…` on the mapping bench).

## Add a new example

1. Author a file that validates against [`schema/template-kg-example.schema.json`](schema/template-kg-example.schema.json) (`template-kg-example/v1`). It must include `nodes[]`, `edges[]`, and `template` metadata. Keep clinical identifiers and verification status from your sources — do not invent SNOMED, NPU, or ICD codes.
2. Place the file under this directory, e.g. `my-template/my-kg-example.json`.
3. Append an object to `manifest.json` → `examples`:

```json
{
  "id": "my-template",
  "title": "Human title shown in the example picker",
  "path": "my-template/my-kg-example.json",
  "schema": "template-kg-example/v1",
  "generated_at": "2026-11-10T12:00:00+00:00"
}
```

4. Run `npm run dev` and open `/ips-kg-demo.html`; pick the new entry in **Example**.

The bundled International Patient Summary graph (`international-patient-summary/ips-kg-example.json`) was built from the CDR Catalyst verification package (254 nodes, 423 typed edges).
