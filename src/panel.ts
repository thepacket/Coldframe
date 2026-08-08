// Canvas rendering and hit testing. Layout is computed once and shared by both
// so what you point at is what you saw.

import { ancestryColor } from './ancestry';
import type { View } from './model';
import { type Palette, type RGB, css, mix } from './theme';

const GUTTER = 15; // climate strip, expression strip
const ANCESTRY_W = 26; // wider: it carries a stacked composition, not one value
const GAP = 4;
const MATRIX_GAP = 14;
const CAPTION_H = 22;
const SECTION_GAP = 20;
const CLINE_H = 44;
const BAND_H = 6;
const ROW_H = 1;
const MIN_CELL = 9;
const MAX_CELL = 40;

export interface Layout {
  width: number;
  height: number;
  cellW: number;
  matrixX: number;
  clineY: number;
  bandsY: number;
  rowsY: number;
  bandH: number;
  rowH: number;
}

export type Hit =
  | { kind: 'row'; row: number; col: number | null }
  | { kind: 'band'; band: number; col: number | null }
  | { kind: 'cline'; col: number }
  | null;

export function layout(view: View, available: number): Layout {
  const matrixX = GUTTER + GAP + GUTTER + GAP + ANCESTRY_W + MATRIX_GAP;
  const cols = Math.max(1, view.columns.length);
  const cellW = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor((available - matrixX) / cols)));

  const clineY = CAPTION_H;
  const bandsY = clineY + CLINE_H + SECTION_GAP + CAPTION_H;
  const bandsH = view.bands.length * BAND_H;
  const rowsY = bandsY + bandsH + SECTION_GAP + CAPTION_H;
  const rowsH = view.hasGenotypes ? view.rows.length * ROW_H : 34;

  return {
    width: matrixX + cellW * cols,
    height: rowsY + rowsH,
    cellW,
    matrixX,
    clineY,
    bandsY,
    rowsY,
    bandH: BAND_H,
    rowH: ROW_H,
  };
}

const genotypeColor = (ch: string, p: Palette): RGB =>
  ch === '0' ? p.gtRef : ch === '2' ? p.gtAlt : ch === '1' ? p.gtHet : p.gtMissing;

export function draw(
  ctx: CanvasRenderingContext2D,
  view: View,
  L: Layout,
  p: Palette,
  genotypes: string[] | undefined,
  axisLabel: string,
  /** Site index driving the map, outlined here so the two views stay tied. */
  selected: number | null,
) {
  ctx.clearRect(0, 0, L.width, L.height);

  const caption = (text: string, y: number) => {
    ctx.fillStyle = p.muted;
    ctx.font = '600 9.5px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text.toUpperCase(), 0, y - 8);
  };

  const [aLo, aHi] = view.axisRange;
  const aSpan = aHi - aLo || 1;
  const climateColor = (v: number) => mix(p.climCold, p.climWarm, (v - aLo) / aSpan);
  const exprColor = (t: number) => mix(p.exprLo, p.exprHi, t);

  // --- cline strength -------------------------------------------------------

  caption(`Cline strength · r against ${axisLabel} · solid = within ancestry groups`, L.clineY);

  const maxAbs = Math.max(0.5, ...view.columns.map((c) => Math.abs(c.r)));
  const mid = L.clineY + CLINE_H / 2;

  ctx.strokeStyle = p.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L.matrixX, mid + 0.5);
  ctx.lineTo(L.width, mid + 0.5);
  ctx.stroke();

  // Two bars per site. The pale one is the raw correlation; the solid one is
  // the same correlation computed within ancestry groups. The gap between them
  // is how much of the cline is relatedness rather than adaptation.
  view.columns.forEach((c, i) => {
    const x = L.matrixX + i * L.cellW + 1;
    const w = Math.max(1, L.cellW - 2);
    const bar = (r: number, alpha: number, inset: number) => {
      const h = (Math.abs(r) / maxAbs) * (CLINE_H / 2 - 3);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = css(r >= 0 ? p.climWarm : p.climCold);
      ctx.fillRect(x + inset, r >= 0 ? mid - h : mid, Math.max(1, w - inset * 2), h);
      ctx.globalAlpha = 1;
    };
    bar(c.r, 0.32, 0);
    if (c.rWithin !== null) bar(c.rWithin, 1, Math.min(3, Math.floor(w / 4)));
  });

  // --- climate bands --------------------------------------------------------

  caption(
    `Climate bands · alt allele frequency · ${view.bands.length} equal groups · third strip is ancestry`,
    L.bandsY,
  );

  view.bands.forEach((band, b) => {
    const y = L.bandsY + b * L.bandH;
    ctx.fillStyle = css(climateColor(band.meanAxis));
    ctx.fillRect(0, y, GUTTER, L.bandH);
    ctx.fillStyle = css(exprColor(band.exprRank));
    ctx.fillRect(GUTTER + GAP, y, GUTTER, L.bandH);

    let ax = GUTTER + GAP + GUTTER + GAP;
    for (const [group, share] of band.groups) {
      const gw = share * ANCESTRY_W;
      ctx.fillStyle = ancestryColor(group);
      ctx.fillRect(ax, y, Math.ceil(gw), L.bandH);
      ax += gw;
    }

    band.freq.forEach((f, i) => {
      ctx.fillStyle = css(f === null ? p.gtMissing : mix(p.gtRef, p.gtAlt, f));
      ctx.fillRect(L.matrixX + i * L.cellW, y, L.cellW, L.bandH);
    });
  });

  // --- accessions -----------------------------------------------------------

  if (!view.hasGenotypes || !genotypes) {
    caption('Accessions', L.rowsY);
    ctx.fillStyle = p.muted;
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      'Per-accession genotypes are not included in the published build.',
      0,
      L.rowsY + 14,
    );
  } else {
    caption(
      `Accessions · ${view.rows.length} plants, coldest first${view.omitted ? ` · ${view.omitted} without a value` : ''}`,
      L.rowsY,
    );

    view.rows.forEach((row, y0) => {
      const y = L.rowsY + y0 * L.rowH;
      ctx.fillStyle = css(climateColor(row.axisValue));
      ctx.fillRect(0, y, GUTTER, L.rowH);
      ctx.fillStyle = css(exprColor(row.exprRank));
      ctx.fillRect(GUTTER + GAP, y, GUTTER, L.rowH);
      ctx.fillStyle = ancestryColor(row.ancestry);
      ctx.fillRect(GUTTER + GAP + GUTTER + GAP, y, ANCESTRY_W, L.rowH);

      view.columns.forEach((c, i) => {
        const ch = genotypes[c.siteIndex]?.[row.gtIndex] ?? '.';
        ctx.fillStyle = css(genotypeColor(ch, p));
        ctx.fillRect(L.matrixX + i * L.cellW, y, L.cellW, L.rowH);
      });
    });
  }

  // --- selected column ------------------------------------------------------
  // Drawn last, so neither the bands nor the rows paint over the outline.

  const selectedCol =
    selected === null ? -1 : view.columns.findIndex((c) => c.siteIndex === selected);

  if (selectedCol >= 0) {
    const x = L.matrixX + selectedCol * L.cellW;
    const bottom = view.hasGenotypes
      ? L.rowsY + view.rows.length * L.rowH
      : L.bandsY + view.bands.length * L.bandH;
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 0.75, L.clineY - 3.75, L.cellW + 1.5, bottom - L.clineY + 7.5);
  }
}

export function hitTest(view: View, L: Layout, x: number, y: number): Hit {
  const col = x >= L.matrixX
    ? Math.min(view.columns.length - 1, Math.floor((x - L.matrixX) / L.cellW))
    : null;

  if (y >= L.clineY && y < L.clineY + CLINE_H) {
    return col === null ? null : { kind: 'cline', col };
  }

  const bandsEnd = L.bandsY + view.bands.length * L.bandH;
  if (y >= L.bandsY && y < bandsEnd) {
    return { kind: 'band', band: Math.floor((y - L.bandsY) / L.bandH), col };
  }

  const rowsEnd = L.rowsY + view.rows.length * L.rowH;
  if (view.hasGenotypes && y >= L.rowsY && y < rowsEnd) {
    return { kind: 'row', row: Math.floor((y - L.rowsY) / L.rowH), col };
  }

  return null;
}
