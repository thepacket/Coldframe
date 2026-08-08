/** Canvas colours come from the stylesheet so the two themes stay in one place. */

export interface Palette {
  ink: string;
  inkSoft: string;
  muted: string;
  rule: string;
  panel: string;
  accent: string;
  gtRef: RGB;
  gtHet: RGB;
  gtAlt: RGB;
  gtMissing: RGB;
  land: RGB;
  climCold: RGB;
  climWarm: RGB;
  exprLo: RGB;
  exprHi: RGB;
}

export type RGB = readonly [number, number, number];

function parseHex(hex: string): RGB {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const raw = (name: string) => s.getPropertyValue(name).trim();
  const rgb = (name: string) => parseHex(raw(name));
  return {
    ink: raw('--ink'),
    inkSoft: raw('--ink-soft'),
    muted: raw('--muted'),
    rule: raw('--rule'),
    panel: raw('--panel'),
    accent: raw('--accent'),
    gtRef: rgb('--gt-ref'),
    gtHet: rgb('--gt-het'),
    gtAlt: rgb('--gt-alt'),
    gtMissing: rgb('--gt-missing'),
    land: rgb('--land'),
    climCold: rgb('--clim-cold'),
    climWarm: rgb('--clim-warm'),
    exprLo: rgb('--expr-lo'),
    exprHi: rgb('--expr-hi'),
  };
}

export const css = (c: RGB) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}
