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
const OVERVIEW_H = 40;
const BAND_H = 6;
const ROW_H = 1;
const MIN_CELL = 5; // narrow enough that most loci fit every testable site
const MAX_CELL = 40;

export interface Layout {
  width: number;
  height: number;
  cellW: number;
  matrixX: number;
  overviewY: number;
  clineY: number;
  bandsY: number;
  rowsY: number;
  bandH: number;
  rowH: number;
}

export type Hit =
  | { kind: 'overview'; site: number }
  | { kind: 'row'; row: number; col: number | null }
  | { kind: 'band'; band: number; col: number | null }
  | { kind: 'cline'; col: number }
  | null;

export function layout(view: View, available: number): Layout {
  const matrixX = GUTTER + GAP + GUTTER + GAP + ANCESTRY_W + MATRIX_GAP;
  const cols = Math.max(1, view.columns.length);
  const cellW = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor((available - matrixX) / cols)));

  const overviewY = CAPTION_H;
  const clineY = overviewY + OVERVIEW_H + SECTION_GAP + CAPTION_H;
  const bandsY = clineY + CLINE_H + SECTION_GAP + CAPTION_H;
  const bandsH = view.bands.length * BAND_H;
  const rowsY = bandsY + bandsH + SECTION_GAP + CAPTION_H;
  const rowsH = view.hasGenotypes ? view.rows.length * ROW_H : 34;

  return {
    width: matrixX + cellW * cols,
    height: rowsY + rowsH,
    cellW,
    matrixX,
    overviewY,
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
  /** Row index of the focused plant, or null. Together these are a cell cursor. */
  selectedRow: number | null,
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

  // --- every site -----------------------------------------------------------
  //
  // The panel below shows every site a correlation can score; most of the
  // region cannot support one. Those are drawn here anyway, at true genomic
  // position, measured by something that works at any frequency: how far the
  // environment of carriers sits from the environment of everyone else.
  // Nothing in the region is unreachable.

  const overviewX = (pos: number) =>
    L.matrixX + ((pos - view.span[0]) / (view.span[1] - view.span[0] || 1)) * (L.width - L.matrixX);

  const testableCount = view.allSites.filter((s) => s.testable).length;
  caption(
    `All ${view.allSites.length} variable sites · ${testableCount} support a correlation · height is environmental shift of carriers`,
    L.overviewY,
  );

  const maxShift = Math.max(0.5, ...view.allSites.map((s) => Math.abs(s.shift ?? 0)));
  const overviewMid = L.overviewY + OVERVIEW_H / 2;

  ctx.strokeStyle = p.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L.matrixX, overviewMid + 0.5);
  ctx.lineTo(L.width, overviewMid + 0.5);
  ctx.stroke();

  for (const site of view.allSites) {
    if (site.shift === null) continue;
    const h = (Math.abs(site.shift) / maxShift) * (OVERVIEW_H / 2 - 2);
    // Untestable sites are dimmed, never omitted - the distinction is between
    // "measured a different way" and "not there".
    ctx.globalAlpha = site.testable ? 0.85 : 0.4;
    ctx.fillStyle = css(site.shift >= 0 ? p.climWarm : p.climCold);
    ctx.fillRect(overviewX(site.pos), site.shift >= 0 ? overviewMid - h : overviewMid, 1.5, h);
  }
  ctx.globalAlpha = 1;

  // Bracket the slice the panel below is actually showing.
  if (view.columns.length > 0) {
    const first = view.columns[0] as (typeof view.columns)[number];
    const last = view.columns[view.columns.length - 1] as (typeof view.columns)[number];
    ctx.strokeStyle = p.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.strokeRect(
      overviewX(first.site.pos) - 2.5,
      L.overviewY - 2.5,
      overviewX(last.site.pos) - overviewX(first.site.pos) + 5,
      OVERVIEW_H + 5,
    );
    ctx.setLineDash([]);
  }

  // --- cline strength -------------------------------------------------------

  caption(
    view.rankBy === 'cline'
      ? `Cline strength · r against ${axisLabel} · solid = within ancestry groups`
      : 'Expression effect · r against expression of this gene · solid = within ancestry groups',
    L.clineY,
  );

  const maxAbs = Math.max(0.5, ...view.columns.map((c) => Math.abs(c.value)));
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
    bar(c.value, 0.32, 0);
    if (c.valueWithin !== null) bar(c.valueWithin, 1, Math.min(3, Math.floor(w / 4)));
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

  // --- cursor ---------------------------------------------------------------
  // Drawn last, so neither the bands nor the rows paint over it.

  // The focused plant: a full-width rule through the accessions section. One
  // row is a single pixel, so the marker has to overhang to be findable.
  //
  // Drawn in ink over a panel-coloured halo, not in accent. Accent is a hair
  // away from the alternate-allele colour in dark theme, so an accent cursor
  // vanishes exactly where the matrix is most interesting. Same halo trick the
  // expression medians use, and for the same reason: the cursor has to read
  // against every colour the data can put underneath it.
  if (selectedRow !== null && view.hasGenotypes && selectedRow < view.rows.length) {
    const y = Math.round(L.rowsY + selectedRow * L.rowH) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(L.width, y);
    ctx.strokeStyle = p.panel;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1;
    ctx.stroke();

    // A tick in the left margin, so the row is locatable when the matrix is
    // dense and the rule disappears into it.
    ctx.fillStyle = p.ink;
    ctx.fillRect(0, y - 2, 5, 4);
  }


  const selectedCol =
    selected === null ? -1 : view.columns.findIndex((c) => c.siteIndex === selected);

  if (selected !== null) {
    const site = view.allSites[selected];
    if (site) {
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(overviewX(site.pos)) + 0.5, L.overviewY);
      ctx.lineTo(Math.round(overviewX(site.pos)) + 0.5, L.overviewY + OVERVIEW_H);
      ctx.stroke();
    }
  }

  if (selectedCol >= 0) {
    const x = L.matrixX + selectedCol * L.cellW;
    const bottom = view.hasGenotypes
      ? L.rowsY + view.rows.length * L.rowH
      : L.bandsY + view.bands.length * L.bandH;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 0.75, L.clineY - 3.75, L.cellW + 1.5, bottom - L.clineY + 7.5);

    // Where the two meet: the addressed cell.
    if (selectedRow !== null && view.hasGenotypes && selectedRow < view.rows.length) {
      const y = L.rowsY + selectedRow * L.rowH;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1.5, y - 2.5, L.cellW + 3, L.rowH + 5);
    }
  }
}

export function hitTest(view: View, L: Layout, x: number, y: number): Hit {
  const col = x >= L.matrixX
    ? Math.min(view.columns.length - 1, Math.floor((x - L.matrixX) / L.cellW))
    : null;

  if (y >= L.overviewY && y < L.overviewY + OVERVIEW_H) {
    const span = view.span[1] - view.span[0] || 1;
    const pos = view.span[0] + ((x - L.matrixX) / (L.width - L.matrixX)) * span;
    let best = -1;
    let bestD = Infinity;
    for (const site of view.allSites) {
      const d = Math.abs(site.pos - pos);
      if (d < bestD) { bestD = d; best = site.index; }
    }
    // Within a few pixels' worth of sequence, otherwise it is a miss.
    return best >= 0 && bestD < (span / Math.max(1, L.width - L.matrixX)) * 6
      ? { kind: 'overview', site: best }
      : null;
  }

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
