/**
 * ai-features.js
 * Ported unchanged from utils/aiFeatures.js — deterministic feature
 * extraction, identical on both the training side (your Docker AI Trainer)
 * and here at inference time, so the trained model's input space matches.
 */
import { ERROR_ALGORITHMS } from './dither-engine.js';

export { ERROR_ALGORITHMS };

export const IMAGE_FEATURE_SIZE = 13;
export const CANDIDATE_FEATURE_SIZE = 2 + ERROR_ALGORITHMS.length + 1 + 1; // = 15
export const TOTAL_FEATURE_SIZE = IMAGE_FEATURE_SIZE + CANDIDATE_FEATURE_SIZE; // = 28

export function extractImageFeatures(imgEl) {
  const SAMPLE = 48;
  const c = document.createElement('canvas');
  c.width = SAMPLE;
  c.height = SAMPLE;
  const ctx = c.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, SAMPLE, SAMPLE);
  const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;

  const naturalW = imgEl.naturalWidth || imgEl.width || SAMPLE;
  const naturalH = imgEl.naturalHeight || imgEl.height || SAMPLE;
  const aspect = naturalW / (naturalW + naturalH);

  const lumas = [];
  const sats = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    lumas.push(luma);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    sats.push(sat);
  }

  const avgLuma = lumas.reduce((a, b) => a + b, 0) / lumas.length;
  const variance = lumas.reduce((a, l) => a + (l - avgLuma) * (l - avgLuma), 0) / lumas.length;
  const stdLuma = Math.sqrt(variance);
  const avgSat = sats.reduce((a, b) => a + b, 0) / sats.length;

  const hist = new Array(8).fill(0);
  lumas.forEach((l) => {
    const bucket = Math.min(7, Math.floor(l * 8));
    hist[bucket]++;
  });
  const histNorm = hist.map((h) => h / lumas.length);

  const grid = [];
  for (let y = 0; y < SAMPLE; y++) {
    const row = [];
    for (let x = 0; x < SAMPLE; x++) {
      row.push(lumas[y * SAMPLE + x]);
    }
    grid.push(row);
  }
  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 1; y < SAMPLE - 1; y++) {
    for (let x = 1; x < SAMPLE - 1; x++) {
      const gx =
        -grid[y - 1][x - 1] + grid[y - 1][x + 1] +
        -2 * grid[y][x - 1] + 2 * grid[y][x + 1] +
        -grid[y + 1][x - 1] + grid[y + 1][x + 1];
      const gy =
        -grid[y - 1][x - 1] - 2 * grid[y - 1][x] - grid[y - 1][x + 1] +
        grid[y + 1][x - 1] + 2 * grid[y + 1][x] + grid[y + 1][x + 1];
      edgeSum += Math.sqrt(gx * gx + gy * gy);
      edgeCount++;
    }
  }
  const edgeDensity = Math.min(1, (edgeSum / edgeCount) / 2);

  return [aspect, avgLuma, stdLuma, ...histNorm, avgSat, edgeDensity];
}

export function extractCandidateFeatures(config) {
  const isError = config.mode === 'Error Diffusion' ? 1 : 0;
  const isBayer = config.mode === 'Bayer (Ordered)' ? 1 : 0;

  const algoOneHot = ERROR_ALGORITHMS.map((a) => (config.algorithm === a ? 1 : 0));
  const serp = config.serpentine ? 1 : 0;
  const colorCount = Math.min(1, (config.paletteColorCount || 8) / 32);

  return [isError, isBayer, ...algoOneHot, serp, colorCount];
}

export function buildFullFeatureVector(imageFeatures, candidateConfig) {
  return [...imageFeatures, ...extractCandidateFeatures(candidateConfig)];
}
