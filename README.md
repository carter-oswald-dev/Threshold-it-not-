# Threshold It Not

A static, GitHub-Pages-ready site that runs an uploaded photo through every
dithering algorithm/palette combination worth trying for low-quality toner
printers, then uses your trained AI ranker to pick the best one — while
still letting you browse or download everything.

No build step. No framework. No server. Everything runs in the browser.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup + all styling |
| `app.js` | Wires upload → render → score → the three result views |
| `dither-engine.js` | **Vendored, exact port** of your RgbQuant fork's kernel matrices + color distance, plus Bayer dithering. No dependency on the `rgbquant` npm package. |
| `dither-variants.js` | Palette presets + candidate-list building (ported from `utils/ditherVariants.js`, unchanged) |
| `ai-features.js` | Deterministic feature extraction (ported from `utils/aiFeatures.js`, unchanged) — must stay byte-identical to whatever your trainer uses, since the model's input space depends on it |
| `ai-ranker-model.js` | Loads your exported TF.js model and scores candidates (inference only — no training code in this site) |
| `model/` | Your exported `model.json` + weights — **currently populated** with a mid-training snapshot (150 epochs). See `model/README.md`. |
| `training-backup/` | Raw training-pair export (8,454 pairs) kept for safekeeping — **not loaded by the site**, not needed for it to run. Useful only if you want to resume/retrain from this exact dataset later. |
| `sample/duck.jpg` | Source photo for the live hero preview (an actual undithered source, not a pre-dithered example asset) |

## Why a hand-ported dithering engine instead of the `rgbquant` npm package

Your training data was built against `rgbquant/src/rgbquant.js` — your fork
with 11 error-diffusion kernels (`FloydSteinberg`, `Atkinson`, `Sierra24A`,
`Fan`, `ShiauFan`, `ShiauFan2`, `JarvisJudiceNinke`, `Stucki`, `Burkes`,
`Sierra3`, `Sierra2`) and a perceptual Euclidean color distance (Rec. 709
luma weights: Pr=0.2126, Pg=0.7152, Pb=0.0722).

The public `rgbquant` npm package (v1.1.2) only ships 9 stock kernels and
doesn't include `Sierra24A`, `Fan`, `ShiauFan`, `ShiauFan2`,
`JarvisJudiceNinke`, `Sierra3`, or `Sierra2` — so it would silently produce
different output for 7 of your 11 trained algorithms. `dither-engine.js`
instead ports the exact kernel matrices and distance formula out of your
fork's source (pulled from your training container's
`node_modules/rgbquant/src/rgbquant.js`), without pulling in the rest of
RgbQuant's histogram/palette-building machinery — which isn't needed here
since every candidate is always dithered against an explicit, already-
resolved palette (matching how `ditherRenderer.js` used it).

If dithered output here ever looks visibly different from your Docker
trainer for the same image/settings, that's the first file to diff against
your fork's source again — something may have changed upstream since this
port was made.

## What's ported vs. rebuilt

- **Ported, unchanged behavior:** palette presets, candidate list building,
  feature extraction, Bayer dithering, error-diffusion kernels + color
  distance.
- **Rebuilt for this site:** the UI (single static page instead of a Nuxt
  app), the three export modes (best pick / browse all / download-all ZIP —
  none of which existed in the original `AiDitherRanker.vue`), and
  inference-only model loading (training itself stays in your Docker
  trainer, unchanged).

## Deploying to GitHub Pages

1. Push this folder to a repo (e.g. `threshold-it-not`).
2. Settings → Pages → deploy from the branch, root folder — no build step.
3. `model/` already has weights in it (a 150-epoch snapshot) — the site
   will show ranked results as soon as it's live. When you finish training,
   overwrite `model/model.json` + `model/ditherit-ai-ranker.weights.bin`
   with a fresh export and push again; nothing else changes.
4. Optional: `training-backup/` is ~7MB and isn't used by the site at
   runtime. Fine to keep in the repo for safekeeping, or move it somewhere
   outside the Pages-served folder if you'd rather not ship it to visitors.

## Local testing

Because this uses ES module `<script type="module">` imports, opening
`index.html` directly via `file://` will fail CORS checks in most browsers.
Serve it locally instead:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## The three export modes

1. **Best pick** — downloads the single top-scored candidate.
2. **Browse all** — every candidate as a card, ranked (if a model is
   loaded) or listed (if not), each individually downloadable.
3. **Download all** — one ZIP containing every candidate PNG (filenames
   prefixed with rank) plus `rankings.json` describing each candidate's
   algorithm, settings, and score, for manually comparing print output.

If no model is loaded, all three modes still work — "best pick" just picks
the first candidate in a fixed, clearly-labelled unranked order rather than
pretending to have an opinion it doesn't have yet.
