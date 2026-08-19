/**
 * dither-variants.js
 * Ported from utils/ditherVariants.js — palette presets and candidate list
 * building, unchanged so the AI model's training data (built from your
 * tournament picks) matches the candidate set this site scores against.
 */
import { ERROR_ALGORITHMS } from './dither-engine.js';

export { ERROR_ALGORITHMS };

export const PRESET_PALETTES = [
  { name: 'Original (auto)', value: 'original' },
  { name: 'Black & White', value: 'blackwhite' },
  { name: 'CMYK', value: 'cmyk' },
  { name: 'Game Boy', value: 'gameboy' },
  { name: 'Red Monochrome', value: 'redmono' },
  { name: 'Blue & Yellow', value: 'blueyellow' },
  { name: 'Green Monochrome', value: 'greenmono' },
  { name: 'Red', value: 'red' },
  { name: 'Black White Red', value: 'bwr' },
  { name: 'Purple & Green', value: 'purplegreen' },
];

export const PALETTE_COLORS = {
  original: null,
  blackwhite: [['#ffffff'], ['#000000']],
  cmyk: [['#000000'], ['#ffff00'], ['#00FFFF'], ['#FF00FF'], ['#FFFFFF']],
  gameboy: [['#CADC9F'], ['#0F380F'], ['#306230'], ['#8BAC0F'], ['#9BBC0F']],
  redmono: [['#ffe3db'], ['#4f1403']],
  blueyellow: [['#134E87'], ['#FFF585']],
  greenmono: [['#eeffdb'], ['#1d3801']],
  red: [['#ffffff'], ['#f46842'], ['#aa2f0d'], ['#000000']],
  bwr: [['#FFFFFF'], ['#000000'], ['#FF0000']],
  purplegreen: [['#76C066'], ['#AD2BBB']],
};

export function hexToRgb(hex) {
  const result = /^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : null;
}

// Builds the full candidate list for a given mode/serpentine choice.
// mode: 'error' | 'bayer' | 'both'
// serpentineOpt: true | false | 'both' (only relevant for error diffusion)
export function buildVariants(mode = 'both', serpentineOpt = 'both') {
  const variants = [];
  if (mode === 'error' || mode === 'both') {
    const serpOptions = serpentineOpt === 'both' ? [false, true] : [serpentineOpt];
    ERROR_ALGORITHMS.forEach((algo) => {
      serpOptions.forEach((serp) => {
        variants.push({
          id: 'err_' + algo + '_' + (serp ? 'serp' : 'noserp'),
          label: algo + (serp ? ' (serpentine)' : ''),
          config: { mode: 'Error Diffusion', algorithm: algo, serpentine: serp },
        });
      });
    });
  }
  if (mode === 'bayer' || mode === 'both') {
    variants.push({
      id: 'bayer',
      label: 'Bayer (Ordered)',
      config: { mode: 'Bayer (Ordered)' },
    });
  }
  return variants;
}

export function resolvePaletteRgb(paletteKey) {
  if (paletteKey === 'original' || !paletteKey) return null;
  const hexColors = PALETTE_COLORS[paletteKey];
  if (!hexColors) return null;
  return hexColors.map((c) => hexToRgb(Array.isArray(c) ? c[0] : c)).filter(Boolean);
}

export function resolvePaletteName(paletteKey) {
  return PRESET_PALETTES.find((p) => p.value === paletteKey)?.name || 'Original';
}
