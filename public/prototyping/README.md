# Prototyping: CDR KG explorer layout variants

Design prototypes (V1–V7) for showing openEHR composition instances, templates and
archetypes under the terminology pane of the TermViz split view. V7 is the target design.

- Published at https://erik-sundvalls-bots.github.io/TermViz/prototyping/
- `index.html` lists all versions; `variants-overview.html` compares them.
- V1–V4 are static mockups (PNG + notes). V5, V6, V7 and V7 English are single-file,
  offline demos with D3 (and d3-dag) inlined.
- `img/` holds colour-reduced copies of the mockup and demo screenshots.

All data is example data: Eva Holmgren and Lars Nyström are fictitious, encounters and
templates marked * are invented, and "Syntetisk nn" / "Synthetic nn" patients are synthetic.

These files are standalone and are not part of the TermViz app build; Vite copies
`public/` into `dist/` as is, so `npm run pages` serves them under `prototyping/`.
