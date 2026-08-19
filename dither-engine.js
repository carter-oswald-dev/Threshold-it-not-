/**
 * dither-engine.js
 * ------------------
 * Standalone, dependency-free dithering engine for "Threshold It Not".
 *
 * The error-diffusion kernel matrices and color-distance formula below are
 * ported EXACTLY from the RgbQuant.js fork used to train the ranking model
 * (rgbquant/src/rgbquant.js, pulled from the training Docker container),
 * so output here is pixel-identical to what the model learned from.
 *
 * This file intentionally does NOT reimplement RgbQuant's histogram /
 * palette-building machinery (`sample()`/`reduce()`'s auto-palette pass) —
 * every candidate here is always dithered against an explicit, already-
 * resolved palette, exactly how ditherRenderer.js used it upstream.
 */

// ---- 1. Kernel matrices (verbatim from the fork) --------------------------
// Each entry: [weight, dx, dy]
const KERNELS = {
  FloydSteinberg: [
    [7 / 16, 1, 0],
    [3 / 16, -1, 1],
    [5 / 16, 0, 1],
    [1 / 16, 1, 1],
  ],
  Atkinson: [
    [1 / 8, 1, 0],
    [1 / 8, 2, 0],
    [1 / 8, -1, 1],
    [1 / 8, 0, 1],
    [1 / 8, 1, 1],
    [1 / 8, 0, 2],
  ],
  Sierra24A: [
    [2 / 4, 1, 0],
    [1 / 4, -1, 1],
    [1 / 4, 0, 1],
  ],
  Fan: [
    [7 / 16, 1, 0],
    [1 / 16, -2, 1],
    [3 / 16, -1, 1],
    [5 / 16, 0, 1],
  ],
  ShiauFan: [
    [4 / 8, 1, 0],
    [1 / 8, -2, 1],
    [1 / 8, -1, 1],
    [2 / 8, 0, 1],
  ],
  ShiauFan2: [
    [8 / 16, 1, 0],
    [1 / 16, -3, 1],
    [1 / 16, -2, 1],
    [2 / 16, -1, 1],
    [4 / 16, 0, 1],
  ],
  JarvisJudiceNinke: [
    [7 / 48, 1, 0],
    [5 / 48, 2, 0],
    [3 / 48, -2, 1],
    [5 / 48, -1, 1],
    [7 / 48, 0, 1],
    [5 / 48, 1, 1],
    [3 / 48, 2, 1],
    [1 / 48, -2, 2],
    [3 / 48, -1, 2],
    [5 / 48, 0, 2],
    [3 / 48, 1, 2],
    [1 / 48, 2, 2],
  ],
  Stucki: [
    [8 / 42, 1, 0],
    [4 / 42, 2, 0],
    [2 / 42, -2, 1],
    [4 / 42, -1, 1],
    [8 / 42, 0, 1],
    [4 / 42, 1, 1],
    [2 / 42, 2, 1],
    [1 / 42, -2, 2],
    [2 / 42, -1, 2],
    [4 / 42, 0, 2],
    [2 / 42, 1, 2],
    [1 / 42, 2, 2],
  ],
  Burkes: [
    [8 / 32, 1, 0],
    [4 / 32, 2, 0],
    [2 / 32, -2, 1],
    [4 / 32, -1, 1],
    [8 / 32, 0, 1],
    [4 / 32, 1, 1],
    [2 / 32, 2, 1],
  ],
  Sierra3: [
    [5 / 32, 1, 0],
    [3 / 32, 2, 0],
    [2 / 32, -2, 1],
    [4 / 32, -1, 1],
    [5 / 32, 0, 1],
    [4 / 32, 1, 1],
    [2 / 32, 2, 1],
    [2 / 32, -1, 2],
    [3 / 32, 0, 2],
    [2 / 32, 1, 2],
  ],
  Sierra2: [
    [4 / 16, 1, 0],
    [3 / 16, 2, 0],
    [1 / 16, -2, 1],
    [2 / 16, -1, 1],
    [3 / 16, 0, 1],
    [2 / 16, 1, 1],
    [1 / 16, 2, 1],
  ],
};

export const ERROR_ALGORITHMS = Object.keys(KERNELS);

// ---- 2. Perceptual Euclidean color distance (Rec. 709 weights, verbatim) --
const Pr = 0.2126, Pg = 0.7152, Pb = 0.0722;
const EUCL_MAX = Math.sqrt(Pr * 255 * 255 + Pg * 255 * 255 + Pb * 255 * 255);

function colorDist(rgb0, rgb1) {
  const rd = rgb1[0] - rgb0[0];
  const gd = rgb1[1] - rgb0[1];
  const bd = rgb1[2] - rgb0[2];
  return Math.sqrt(Pr * rd * rd + Pg * gd * gd + Pb * bd * bd) / EUCL_MAX;
}

// Finds the closest palette entry to [r,g,b]. palette: array of [r,g,b].
function nearestColor(rgb, palette) {
  let min = Infinity;
  let best = palette[0];
  for (let i = 0; i < palette.length; i++) {
    const d = colorDist(rgb, palette[i]);
    if (d < min) {
      min = d;
      best = palette[i];
    }
  }
  return best;
}

// ---- 3. Error-diffusion dithering (ported line-for-line from the fork) ----
// ctx: 2D canvas context to write to (already sized to image)
// imageData: source ImageData (RGBA)
// palette: array of [r,g,b]
// kernelName: one of ERROR_ALGORITHMS
// serpentine: boolean
export function errorDiffusionDither(ctx, imageData, palette, kernelName, serpentine) {
  const ds = KERNELS[kernelName];
  if (!ds) throw new Error('Unknown dithering kernel: ' + kernelName);

  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data; // Uint8ClampedArray, RGBA

  // Track original alpha=0 pixels so we can restore transparency after.
  const transparentIdx = [];
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] === 0) transparentIdx.push(p);
  }

  // Work in a float buffer so error accumulation doesn't clip each step.
  const buf = new Float32Array(data.length);
  buf.set(data);

  let dir = serpentine ? -1 : 1;

  for (let y = 0; y < height; y++) {
    if (serpentine) dir *= -1;

    const rowStart = dir === 1 ? 0 : width - 1;
    const rowEnd = dir === 1 ? width : -1;

    for (let x = rowStart; x !== rowEnd; x += dir) {
      const idx = (y * width + x) * 4;

      const r1 = buf[idx], g1 = buf[idx + 1], b1 = buf[idx + 2];
      const [r2, g2, b2] = nearestColor([r1, g1, b1], palette);

      buf[idx] = r2;
      buf[idx + 1] = g2;
      buf[idx + 2] = b2;
      // alpha left as-is (opaque pixels stay opaque; handled at the end for transparents)

      const er = r1 - r2, eg = g1 - g2, eb = b1 - b2;

      const kStart = dir === 1 ? 0 : ds.length - 1;
      const kEnd = dir === 1 ? ds.length : -1;

      for (let k = kStart; k !== kEnd; k += dir) {
        const weight = ds[k][0];
        const dx = ds[k][1] * dir;
        const dy = ds[k][2];

        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = (ny * width + nx) * 4;
          buf[nIdx] = Math.max(0, Math.min(255, buf[nIdx] + er * weight));
          buf[nIdx + 1] = Math.max(0, Math.min(255, buf[nIdx + 1] + eg * weight));
          buf[nIdx + 2] = Math.max(0, Math.min(255, buf[nIdx + 2] + eb * weight));
        }
      }
    }
  }

  const out = new Uint8ClampedArray(buf.length);
  out.set(buf);
  // Restore original alpha channel (source alpha, not the float-diffused one)
  for (let p = 3; p < out.length; p += 4) out[p] = data[p];
  // Re-blank originally transparent pixels entirely (matches fork behaviour)
  for (const p of transparentIdx) {
    out[p] = 0; out[p + 1] = 0; out[p + 2] = 0; out[p + 3] = 0;
  }

  const outImageData = new ImageData(out, width, height);
  ctx.putImageData(outImageData, 0, 0);
  return outImageData;
}

// ---- 4. Bayer (ordered) dithering, ported from utils/dithering.js ---------
const BAYER_THRESHOLD_MAP = [
  [15, 135, 45, 165],
  [195, 75, 225, 105],
  [60, 180, 30, 150],
  [240, 120, 210, 90],
];

export function bayerDither(ctx, imageData, palette) {
  const w = imageData.width;
  const data = imageData.data;
  const len = data.length;

  for (let p = 0; p <= len - 4; p += 4) {
    const pxIndex = p / 4;
    const x = pxIndex % w;
    const y = Math.floor(pxIndex / w);
    const threshold = BAYER_THRESHOLD_MAP[x % 4][y % 4];

    const r = Math.floor((data[p] + threshold) / 2);
    const g = Math.floor((data[p + 1] + threshold) / 2);
    const b = Math.floor((data[p + 2] + threshold) / 2);

    const [cr, cg, cb] = nearestColor([r, g, b], palette);
    data[p] = cr;
    data[p + 1] = cg;
    data[p + 2] = cb;
    // alpha untouched
  }

  ctx.putImageData(imageData, 0, 0);
  return imageData;
}

// ---- 5. Palette auto-sampling (ported from ditherRenderer.js) -------------
export function autoSamplePalette(img) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, 16, 16);
  const data = ctx.getImageData(0, 0, 16, 16).data;
  const colors = [];
  for (let i = 0; i < data.length; i += 64) {
    colors.push([data[i], data[i + 1], data[i + 2]]);
  }
  return colors.slice(0, 16);
}

// ---- 6. Top-level render: renders one candidate config against an <img> ---
// variantConfig: { mode: 'Error Diffusion'|'Bayer (Ordered)', algorithm, serpentine }
// paletteRgb: array of [r,g,b], or null to auto-sample from the image
export function renderVariant(img, variantConfig, paletteRgb) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  const palette = paletteRgb && paletteRgb.length ? paletteRgb : autoSamplePalette(img);

  try {
    const imageData = ctx.getImageData(0, 0, w, h);
    if (variantConfig.mode === 'Bayer (Ordered)') {
      bayerDither(ctx, imageData, palette);
    } else {
      errorDiffusionDither(ctx, imageData, palette, variantConfig.algorithm, !!variantConfig.serpentine);
    }
  } catch (err) {
    // fall through — canvas keeps the plain drawImage copy if dithering failed
    console.error('Dither render failed for', variantConfig, err);
  }

  return { canvas, dataUrl: canvas.toDataURL('image/png') };
}
