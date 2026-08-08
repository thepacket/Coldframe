// Expression split by what each plant carries at one site.
//
// This is the question the project is named for, and it comes with a limit
// worth stating plainly. GSE80744 measured rosette leaves once, under ambient
// greenhouse conditions - one condition, not a time course and not a cold
// treatment. So this shows whether an allele is *associated with* expression
// level. It cannot show a response, because nothing was done to these plants.
//
// What partly rescues it: each dot is coloured by the climate the accession
// came from. If every carrier of one allele is also from the cold end, an
// apparent expression effect may be ancestry or environment rather than the
// allele. The confound is drawn rather than hidden.

import type { Accession } from './types';
import { css, mix, type Palette } from './theme';

const LABEL_W = 96;
const PAD_R = 14;
const PAD_T = 16;
const AXIS_H = 22;
const BAND_H = 54;
const DOT_R = 2.7;

const CLASSES = [
  { key: '0', label: 'reference' },
  { key: '1', label: 'heterozygous' },
  { key: '2', label: 'alternate' },
] as const;

export const expressionHeight = PAD_T + BAND_H * CLASSES.length + AXIS_H;

export interface ClassSummary {
  key: string;
  label: string;
  n: number;
  median: number | null;
}

export interface ExpressionResult {
  classes: ClassSummary[];
  /** Allele dosage against log expression. Null if a class is empty. */
  r: number | null;
}

interface Dot {
  x: number;
  y: number;
  climate: number | null;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i] as number; sy += ys[i] as number; }
  const mx = sx / n, my = sy / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const u = (xs[i] as number) - mx, v = (ys[i] as number) - my;
    cov += u * v; vx += u * u; vy += v * v;
  }
  const d = Math.sqrt(vx * vy);
  return d === 0 ? null : cov / d;
}

export function drawExpression(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Palette,
  accessions: Accession[],
  genotypeRow: string | undefined,
  axis: string,
  /** Accession id of the focused plant - ringed, so a map or matrix click shows
   *  where that plant sits in the expression distribution. */
  highlightId?: string | null,
): ExpressionResult {
  ctx.clearRect(0, 0, w, h);

  const plotX = LABEL_W;
  const plotW = w - LABEL_W - PAD_R;

  // Log scale: expression at these loci spans four orders of magnitude.
  const rows = accessions
    .map((a, i) => ({
      accession: a,
      gt: genotypeRow?.[i] ?? '.',
      value: a.expression === null ? null : Math.log10(a.expression + 1),
      climate: axis === 'lat' ? a.lat : (a.climate[axis] ?? null),
    }))
    .filter((r) => r.value !== null && r.gt !== '.');

  const values = rows.map((r) => r.value as number);
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const span = hi - lo || 1;
  const toX = (v: number) => plotX + ((v - lo) / span) * plotW;

  // Climate rank rather than raw value. Raw climate clusters mid-range, so the
  // ramp barely moves - the same trap the expression strip fell into earlier.
  const withClimate = rows
    .filter((r) => r.climate !== null)
    .sort((a, b) => (a.climate as number) - (b.climate as number));
  const climateRank = new Map<string, number>();
  const lastRank = Math.max(1, withClimate.length - 1);
  withClimate.forEach((r, i) => climateRank.set(r.accession.id, i / lastRank));

  ctx.font = '11px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';

  const classes: ClassSummary[] = [];

  CLASSES.forEach((cls, ci) => {
    const bandTop = PAD_T + ci * BAND_H;
    const mid = bandTop + BAND_H / 2;
    const members = rows.filter((r) => r.gt === cls.key);

    ctx.strokeStyle = p.rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX, mid + 0.5);
    ctx.lineTo(plotX + plotW, mid + 0.5);
    ctx.stroke();

    // Beeswarm: bucket by x, stack alternately above and below the line so a
    // dense column reads as a column rather than a blob.
    const buckets = new Map<number, number>();
    const dots: Dot[] = [];
    let focused: Dot | null = null;
    for (const m of members) {
      const x = toX(m.value as number);
      const bucket = Math.round(x / (DOT_R * 1.7));
      const rank = buckets.get(bucket) ?? 0;
      buckets.set(bucket, rank + 1);
      const step = Math.ceil(rank / 2) * (DOT_R * 1.75);
      const offset = rank === 0 ? 0 : rank % 2 === 1 ? -step : step;
      const y = Math.max(bandTop + DOT_R, Math.min(bandTop + BAND_H - DOT_R, mid + offset));
      const dot = { x, y, climate: climateRank.get(m.accession.id) ?? null };
      dots.push(dot);
      if (highlightId && m.accession.id === highlightId) focused = dot;
    }

    for (const dot of dots) {
      ctx.fillStyle =
        dot.climate === null ? css(p.gtMissing) : css(mix(p.climCold, p.climWarm, dot.climate));
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, DOT_R, 0, Math.PI * 2);
      ctx.fill();
    }

    const sorted = members.map((m) => m.value as number).sort((a, b) => a - b);
    const median = sorted.length
      ? (sorted[Math.floor((sorted.length - 1) / 2)] as number)
      : null;

    if (median !== null) {
      const mx = Math.round(toX(median)) + 0.5;
      ctx.lineWidth = 5;
      ctx.strokeStyle = p.panel;
      ctx.beginPath();
      ctx.moveTo(mx, bandTop + 5);
      ctx.lineTo(mx, bandTop + BAND_H - 5);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = p.ink;
      ctx.beginPath();
      ctx.moveTo(mx, bandTop + 6);
      ctx.lineTo(mx, bandTop + BAND_H - 6);
      ctx.stroke();
    }

    // The focused plant, ringed after everything else in its band so the mark
    // survives the swarm. Same treatment as its ring on the map.
    if (focused) {
      ctx.strokeStyle = p.panel;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(focused.x, focused.y, DOT_R + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    ctx.fillStyle = p.inkSoft;
    ctx.textAlign = 'right';
    ctx.fillText(cls.label, LABEL_W - 26, mid - 6);
    ctx.fillStyle = p.muted;
    ctx.fillText(`${members.length}`, LABEL_W - 26, mid + 9);

    ctx.fillStyle = css(cls.key === '0' ? p.gtRef : cls.key === '1' ? p.gtHet : p.gtAlt);
    ctx.beginPath();
    ctx.arc(LABEL_W - 14, mid, 4.5, 0, Math.PI * 2);
    ctx.fill();

    classes.push({
      key: cls.key,
      label: cls.label,
      n: members.length,
      median: median === null ? null : 10 ** median - 1,
    });
  });

  // Axis: decade ticks, since the scale is log.
  const axisY = PAD_T + BAND_H * CLASSES.length + 4;
  ctx.strokeStyle = p.rule;
  ctx.lineWidth = 1;
  ctx.fillStyle = p.muted;
  ctx.textAlign = 'center';
  for (let decade = Math.ceil(lo); decade <= Math.floor(hi); decade++) {
    const x = toX(decade);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, axisY);
    ctx.lineTo(x + 0.5, axisY + 4);
    ctx.stroke();
    ctx.fillText((10 ** decade).toLocaleString(), x, axisY + 13);
  }
  ctx.textAlign = 'left';
  ctx.fillText('expression, log scale', plotX, axisY + 13);

  const dosage = rows.map((r) => (r.gt === '0' ? 0 : r.gt === '1' ? 1 : 2));
  return { classes, r: pearson(dosage, values) };
}
