# Trained model (currently loaded)

**Status: mid-training snapshot — 150 epochs, backup "11".** This is not
necessarily your final model. As you finish the remaining training data and
re-export, just overwrite the two files below with the newer export; no
other changes are needed anywhere else in the site.

The site loads `./model/model.json` at page load (see `ai-ranker-model.js`).
If it's ever missing, the site still works — it just skips scoring and shows
all candidates unranked, labelled "no model loaded."

## Current files

- `model.json` — architecture + weights manifest (renamed from your export's
  `ditherit-ai-ranker.json`; the loader expects the filename `model.json`)
- `ditherit-ai-ranker.weights.bin` — the actual weight values. Left with its
  original export filename since `model.json`'s internal `weightsManifest`
  already points at `./ditherit-ai-ranker.weights.bin` — renaming this file
  would require editing that reference too, so it's simplest left as-is.

Architecture confirmed on import: input `[*, 28]` (matches
`TOTAL_FEATURE_SIZE` in `ai-features.js`) → dense 24 (relu) → dense 12
(relu) → dense 1 (linear), 1,009 total parameters. This matches
`buildModel()` in your trainer exactly.

## Re-exporting after more training

In your Docker-based `ditherit` AI Trainer:

```js
import { exportModelAsDownload } from './utils/aiRankerModel'

await exportModelAsDownload(model)
// downloads: ditherit-ai-ranker.json + ditherit-ai-ranker.weights.bin
```

Then:
1. Rename the new `ditherit-ai-ranker.json` to `model.json`
2. Drop both files into this folder, overwriting the old ones
3. Push to your GitHub Pages repo

No code changes needed — `tf.loadLayersModel('./model/model.json')` resolves
the weights path automatically from whatever `model.json` says.
