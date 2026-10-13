# TasteDraft — split source

`split/` is the editable source of the single-file prototype. `node build.mjs` rebuilds `../dist/TasteDraft.dc.html`.

The original bundle, before these fixes, is `../reference/Main.original.dc.html`. The cover-image variant before the fixes is `../reference/Main.with-images.dc.html`. The rebuild is no longer byte-identical to either file.

| File | What it is | Edit? |
|---|---|---|
| template.html | Markup with `{{bindings}}`, `sc-if` / `sc-for`, 3 phases and 5 modals. Placeholders `@@FONTS_CSS@@` `@@STYLES_CSS@@` `@@SCRIPT_JS@@` | yes |
| styles.css | App CSS | yes |
| fonts.css | IBM Plex Sans Thai `@font-face` | rarely |
| mock-data.js | `DEFAULT_IDEA`, `AGES`, `POS`, `CITIES` | yes |
| evidence.js | Sample evidence tables and `provideEvidence(brief)` | yes |
| engine.js | Weights, `deriveSubs()`, `ledgerPoints()`, evidence-strength display | yes |
| view-model.js | Local brief → the API result shape (`buildLocalResult`) | yes |
| api.js | `apiBase` client. No `apiBase` means no `fetch` | yes |
| logic.js | `class Component extends DCLogic` | yes |
| check-engine.mjs | Node check that the default brief is still 71 → 82 and that inputs move the score | yes |
| shell.html | Bundler bootstrap. Placeholders `@@MANIFEST@@`, `@@TEMPLATE@@` | no |
| runtime.manifest.json | Compressed runtime. Do not load it into an AI context | no |

The runtime scripts are concatenated, in order, with no imports: `mock-data.js`, `evidence.js`, `engine.js`, `view-model.js`, `api.js`, `logic.js`.

Fits, frictions, proposals, signals, and districts are rendered from that result shape. Image credits are not in the UI; see `../docs/IMAGE_SOURCES.md`.

`apiBase` is a string prop (empty by default). `?apiBase=` overrides it when the file is served over HTTP. The artifact sandbox that opens `.dc.html` may block `fetch`; serve the built file with a normal web server so the client can reach the API. An empty `apiBase` keeps the local engine and does not call the network.

```bash
node build.mjs                  # ../dist/TasteDraft.dc.html
node build.mjs out.dc.html
node check-engine.mjs
```

Placeholder tokens must not appear anywhere except where `build.mjs` replaces them.
