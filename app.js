import { renderVariant } from './dither-engine.js';
import {
  PRESET_PALETTES,
  buildVariants,
  resolvePaletteRgb,
  resolvePaletteName,
} from './dither-variants.js';
import { extractImageFeatures, extractCandidateFeatures } from './ai-features.js';
import { loadModel, predictScores } from './ai-ranker-model.js';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const pressBed = $('pressBed');
const fileInput = $('fileInput');
const sourcePreview = $('sourcePreview');
const sourceThumb = $('sourceThumb');
const sourceFilename = $('sourceFilename');
const sourceDims = $('sourceDims');
const btnClear = $('btnClear');

const paletteSelect = $('paletteSelect');
const modeSelect = $('modeSelect');
const serpentineSelect = $('serpentineSelect');

const btnRun = $('btnRun');
const modelStatus = $('modelStatus');
const modelStatusText = $('modelStatusText');
const specModelState = $('specModelState');
const specCandidates = $('specCandidates');

const errorBanner = $('errorBanner');
const progressWrap = $('progressWrap');
const progressFill = $('progressFill');
const progressText = $('progressText');
const progressCount = $('progressCount');

const results = $('results');
const rankGrid = $('rankGrid');
const allCount = $('allCount');
const btnDownloadZip = $('btnDownloadZip');

const bestImg = $('bestImg');
const bestAlgoName = $('bestAlgoName');
const bestMode = $('bestMode');
const bestSerp = $('bestSerp');
const bestPalette = $('bestPalette');
const bestScore = $('bestScore');
const bestRank = $('bestRank');
const bestDownload = $('bestDownload');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let sourceImg = null;      // loaded <img>
let sourceFile = null;     // File
let rankerModel = null;    // tf.LayersModel or null
let lastResults = [];      // sorted results from most recent run

// ---------------------------------------------------------------------------
// Palette dropdown
// ---------------------------------------------------------------------------
PRESET_PALETTES.forEach((p) => {
  const opt = document.createElement('option');
  opt.value = p.value;
  opt.textContent = p.name;
  paletteSelect.appendChild(opt);
});

// ---------------------------------------------------------------------------
// Model load (inference only — see README for how to export your trained model)
// ---------------------------------------------------------------------------
(async function initModel() {
  rankerModel = await loadModel('./model/model.json');
  if (rankerModel) {
    modelStatus.classList.add('ready');
    modelStatusText.textContent = 'Model loaded — ready to rank';
    specModelState.textContent = 'loaded';
  } else {
    modelStatus.classList.add('missing');
    modelStatusText.textContent =
      'No trained model found at ./model/ — showing unranked results only';
    specModelState.textContent = 'not found';
  }
})();

// ---------------------------------------------------------------------------
// Upload handling
// ---------------------------------------------------------------------------
pressBed.addEventListener('click', (e) => {
  // label+input already handles the click-to-open; avoid double firing
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) loadSourceFile(file);
});

['dragover', 'dragenter'].forEach((evt) => {
  pressBed.addEventListener(evt, (e) => {
    e.preventDefault();
    pressBed.classList.add('drag-over');
  });
});
['dragleave', 'dragend'].forEach((evt) => {
  pressBed.addEventListener(evt, () => pressBed.classList.remove('drag-over'));
});
pressBed.addEventListener('drop', (e) => {
  e.preventDefault();
  pressBed.classList.remove('drag-over');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadSourceFile(file);
});

btnClear.addEventListener('click', () => {
  sourceImg = null;
  sourceFile = null;
  fileInput.value = '';
  sourcePreview.classList.remove('visible');
  btnRun.disabled = true;
  results.classList.remove('visible');
  hideError();
});

function loadSourceFile(file) {
  hideError();
  if (!/^image\/(png|jpeg)$/.test(file.type)) {
    showError('Please choose a PNG or JPG image.');
    return;
  }
  sourceFile = file;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    sourceImg = img;
    sourceThumb.src = url;
    sourceFilename.textContent = file.name;
    sourceDims.textContent = `${img.naturalWidth} × ${img.naturalHeight}px · ${formatBytes(file.size)}`;
    sourcePreview.classList.add('visible');
    btnRun.disabled = false;
    results.classList.remove('visible');
  };
  img.onerror = () => {
    showError('Could not read that image file.');
  };
  img.src = url;
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('visible');
}
function hideError() {
  errorBanner.classList.remove('visible');
  errorBanner.textContent = '';
}

// ---------------------------------------------------------------------------
// Run: render every variant, score with the model, populate results
// ---------------------------------------------------------------------------
btnRun.addEventListener('click', async () => {
  if (!sourceImg) return;
  hideError();
  btnRun.disabled = true;
  progressWrap.classList.add('visible');
  results.classList.remove('visible');

  try {
    const mode = modeSelect.value;
    const serpRaw = serpentineSelect.value;
    const serpentineOpt = serpRaw === 'both' ? 'both' : serpRaw === 'true';

    const variants = buildVariants(mode, serpentineOpt);
    specCandidates.textContent = `${variants.length} per image`;

    const paletteKey = paletteSelect.value;
    const paletteRgb = resolvePaletteRgb(paletteKey);
    const paletteName = resolvePaletteName(paletteKey);
    const paletteColorCount = paletteRgb ? paletteRgb.length : 8;

    // Render all variants, yielding to the browser between each.
    const rendered = [];
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      await new Promise((r) => setTimeout(r, 0));
      const { dataUrl } = renderVariant(sourceImg, v.config, paletteRgb);
      rendered.push({
        ...v,
        config: { ...v.config, paletteColorCount },
        dataUrl,
      });
      updateProgress(i + 1, variants.length, 'Rendering variants…');
    }

    // Score with the model, if loaded.
    let scored;
    if (rankerModel) {
      updateProgress(variants.length, variants.length, 'Scoring with AI model…');
      const imageFeatures = extractImageFeatures(sourceImg);
      const candidateFeatureList = rendered.map((r) => extractCandidateFeatures(r.config));
      const scores = predictScores(rankerModel, imageFeatures, candidateFeatureList);
      scored = rendered
        .map((r, i) => ({ ...r, score: scores[i] }))
        .sort((a, b) => b.score - a.score);
    } else {
      // No model: keep a stable, labelled order without claiming a ranking.
      scored = rendered.map((r) => ({ ...r, score: null }));
    }

    lastResults = scored;
    populateResults(scored, paletteName);
    progressWrap.classList.remove('visible');
    results.classList.add('visible');
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    progressWrap.classList.remove('visible');
    showError('Something went wrong while processing that image. Try a smaller file or a different format.');
  } finally {
    btnRun.disabled = false;
  }
});

function updateProgress(done, total, label) {
  progressText.textContent = label;
  progressCount.textContent = `${done} / ${total}`;
  progressFill.style.width = `${Math.round((done / total) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Populate the three result tabs
// ---------------------------------------------------------------------------
function populateResults(scored, paletteName) {
  const hasScores = scored[0] && scored[0].score !== null;

  // --- Best pick tab ---
  const top = scored[0];
  bestImg.src = top.dataUrl;
  bestAlgoName.textContent = top.label;
  bestMode.textContent = top.config.mode;
  bestSerp.textContent = top.config.mode === 'Error Diffusion'
    ? (top.config.serpentine ? 'On' : 'Off')
    : '—';
  bestPalette.textContent = paletteName;
  bestScore.textContent = hasScores ? top.score.toFixed(3) : 'No model loaded';
  bestRank.textContent = hasScores ? `#1 of ${scored.length}` : `1 of ${scored.length} (unranked)`;
  bestDownload.href = top.dataUrl;
  bestDownload.download = downloadFilenameFor(top.label, 1);

  // --- Browse all tab ---
  rankGrid.innerHTML = '';
  scored.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'rank-card' + (i === 0 ? ' is-top' : '');

    const imgWrap = document.createElement('div');
    imgWrap.className = 'rank-img';
    const img = document.createElement('img');
    img.src = r.dataUrl;
    img.alt = r.label;
    imgWrap.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'rank-meta';
    meta.innerHTML = `
      <div class="rank-order">${hasScores ? '#' + (i + 1) : '—'}</div>
      <div class="rank-label">${r.label}${hasScores ? ` <span style="color:var(--starved)">· ${r.score.toFixed(3)}</span>` : ''}</div>
    `;
    const dl = document.createElement('a');
    dl.className = 'rank-dl';
    dl.href = r.dataUrl;
    dl.download = downloadFilenameFor(r.label, i + 1);
    dl.textContent = 'Download';
    meta.appendChild(dl);

    card.appendChild(imgWrap);
    card.appendChild(meta);
    rankGrid.appendChild(card);
  });

  // --- Download all tab ---
  allCount.textContent = scored.length;
}

function downloadFilenameFor(label, rank) {
  const safe = label.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const base = sourceFile ? sourceFile.name.replace(/\.[^.]+$/, '') : 'image';
  return `${String(rank).padStart(2, '0')}_${base}_${safe}.png`;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
document.querySelectorAll('[data-goto-tab]').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.gotoTab));
});
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
}

// ---------------------------------------------------------------------------
// Download all as ZIP
// ---------------------------------------------------------------------------
btnDownloadZip.addEventListener('click', async () => {
  if (!lastResults.length) return;
  const originalLabel = btnDownloadZip.textContent;
  btnDownloadZip.disabled = true;
  btnDownloadZip.textContent = 'Zipping…';

  try {
    const zip = new JSZip();
    const hasScores = lastResults[0] && lastResults[0].score !== null;
    const manifest = [];

    lastResults.forEach((r, i) => {
      const rank = i + 1;
      const filename = downloadFilenameFor(r.label, rank);
      const base64 = r.dataUrl.split(',')[1];
      zip.file(filename, base64, { base64: true });
      manifest.push({
        rank,
        filename,
        label: r.label,
        mode: r.config.mode,
        algorithm: r.config.algorithm || null,
        serpentine: r.config.mode === 'Error Diffusion' ? !!r.config.serpentine : null,
        paletteColorCount: r.config.paletteColorCount,
        score: hasScores ? r.score : null,
      });
    });

    zip.file('rankings.json', JSON.stringify({
      generatedAt: new Date().toISOString(),
      sourceFile: sourceFile ? sourceFile.name : null,
      ranked: hasScores,
      candidates: manifest,
    }, null, 2));

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = sourceFile ? sourceFile.name.replace(/\.[^.]+$/, '') : 'image';
    a.href = url;
    a.download = `${base}_dither_candidates.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    console.error(err);
    showError('Could not build the ZIP file. Try again, or download individual images from "Browse all".');
  } finally {
    btnDownloadZip.disabled = false;
    btnDownloadZip.textContent = originalLabel;
  }
});

// ---------------------------------------------------------------------------
// "Try this example" — loads the before/after sample straight into the tool
// so visitors can run the real pipeline on the photo shown above, rather
// than just looking at a static picture of what the tool does.
// ---------------------------------------------------------------------------
const tryExampleBtn = $('tryExampleBtn');
if (tryExampleBtn) {
  tryExampleBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('./sample/before.jpg');
      const blob = await res.blob();
      const file = new File([blob], 'eclipse-example.jpg', { type: 'image/jpeg' });
      loadSourceFile(file);
      document.getElementById('pressBed').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      console.error(err);
      showError('Could not load the example photo. Try uploading your own instead.');
    }
  });
}

// ---------------------------------------------------------------------------
// About link — simple inline explainer, no navigation away from the tool.
// ---------------------------------------------------------------------------
$('aboutLink').addEventListener('click', (e) => {
  e.preventDefault();
  alert(
    'Every candidate is scored by a small neural network trained on manual ' +
    'side-by-side picks (bracket-elimination style: this one vs. that one, ' +
    'repeated thousands of times). It never sees your actual photo pixels — ' +
    'only small numeric features (brightness, contrast, edge density, etc.) ' +
    'extracted from it in your browser, plus which algorithm/settings each ' +
    'candidate used. Nothing is uploaded anywhere; the model file is loaded ' +
    'once and runs entirely on your device.'
  );
});
