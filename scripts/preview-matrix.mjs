// Diagnostic render, not part of the app. Answers one question before any UI
// work starts: sorted by environment, is the cline actually visible, or is it
// only measurable?
//
//   usage: node scripts/preview-matrix.mjs [locus] [climate_var]
//   e.g.   node scripts/preview-matrix.mjs flc Ltemp__night_spring
//
// Writes two PNGs to data/preview:
//   <locus>-position.png  sites in genomic order - the honest view
//   <locus>-ranked.png    sites ordered by cline strength - is there a signal
//
// One pixel per cell, so nothing is lost to sub-pixel aliasing. At 664
// accessions that is a 664px tall image, which is roughly the height the real
// panel will be.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const COLOR = {
  bg: [250, 248, 245],
  ref: [232, 226, 217], // pale sand
  het: [154, 171, 142], // sage
  alt: [47, 72, 88], // deep slate
  missing: [244, 241, 237],
  gap: [250, 248, 245],
};

const GUTTER = 14; // width of each annotation strip
const GAP = 3;

const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

// --- minimal PNG encoder (RGB8, filter 0) ----------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // 10-12: compression, filter, interlace - all zero

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- render ----------------------------------------------------------------

const [locusName = 'flc', axis = 'Ltemp__night_spring'] = process.argv.slice(2);
const d = JSON.parse(readFileSync(join(ROOT, 'data', 'derived', `${locusName}.json`), 'utf8'));

if (!d.genotypes) {
  console.error(`${locusName}.json has no genotype matrix - build it without --public`);
  process.exit(1);
}
if (!(axis in d.cline)) {
  console.error(`unknown axis "${axis}". available: ${Object.keys(d.cline).join(', ')}`);
  process.exit(1);
}

const axisValue = (a) => (axis === 'lat' ? a.lat : a.climate[axis]);

// Accessions ordered by the environment they came from. Anything missing the
// axis value sinks to the bottom rather than being dropped, so the row count
// still matches the panel.
const order = d.accessions
  .map((a, i) => ({ i, v: axisValue(a), expr: a.expression }))
  .sort((p, q) => (p.v === null) - (q.v === null) || p.v - q.v);

const vals = order.map((o) => o.v).filter((v) => v !== null);
const [vMin, vMax] = [Math.min(...vals), Math.max(...vals)];
const logExpr = order.map((o) => Math.log10((o.expr ?? 0) + 1));
const [eMin, eMax] = [Math.min(...logExpr), Math.max(...logExpr)];

const byStrength = d.sites
  .map((_, i) => i)
  .sort((a, b) => Math.abs(d.cline[axis][b] ?? 0) - Math.abs(d.cline[axis][a] ?? 0));

const siteOrders = {
  position: [d.sites.map((_, i) => i), 1],
  ranked: [byStrength, 1],
  // What a real panel would actually show: the informative sites, given room.
  focus: [byStrength.filter((i) => d.cline[axis][i] !== null).slice(0, 24), 30],
};

mkdirSync(join(ROOT, 'data', 'preview'), { recursive: true });

for (const [variant, [siteOrder, cellW]] of Object.entries(siteOrders)) {
  const width = GUTTER + GAP + GUTTER + GAP + siteOrder.length * cellW;
  const height = order.length;
  const rgb = Buffer.alloc(width * height * 3);

  const put = (x, y, c) => {
    const o = (y * width + x) * 3;
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  };

  order.forEach((row, y) => {
    // Strip 1: the sort axis itself - cold at the top, warm at the bottom.
    const t = row.v === null ? null : clamp01((row.v - vMin) / (vMax - vMin));
    const climateColor = t === null ? COLOR.missing : lerp([49, 88, 128], [200, 106, 63], t);
    for (let x = 0; x < GUTTER; x++) put(x, y, climateColor);
    for (let x = GUTTER; x < GUTTER + GAP; x++) put(x, y, COLOR.gap);

    // Strip 2: expression of this gene in this accession, log scaled.
    const e = clamp01((logExpr[y] - eMin) / (eMax - eMin));
    const exprColor = lerp([238, 240, 235], [38, 70, 52], e);
    const x0 = GUTTER + GAP;
    for (let x = x0; x < x0 + GUTTER; x++) put(x, y, exprColor);
    for (let x = x0 + GUTTER; x < x0 + GUTTER + GAP; x++) put(x, y, COLOR.gap);

    // The matrix.
    const gx = x0 + GUTTER + GAP;
    const gtRow = row.i;
    siteOrder.forEach((si, col) => {
      const ch = d.genotypes[si][gtRow];
      const c = ch === '0' ? COLOR.ref : ch === '2' ? COLOR.alt : ch === '1' ? COLOR.het : COLOR.missing;
      for (let dx = 0; dx < cellW; dx++) put(gx + col * cellW + dx, y, c);
    });
  });

  const out = join(ROOT, 'data', 'preview', `${locusName}-${variant}.png`);
  writeFileSync(out, encodePng(width, height, rgb));
  console.log(`${variant.padEnd(9)} ${width}x${height}  ${out}`);
}

// Aggregated variant: accessions binned into equal-count climate bands, each
// cell the alt allele frequency of that band. Trades individual accessions for
// a continuous surface - the test of whether a smooth cline is recoverable at
// all, or whether haplotype structure dominates at every scale.
{
  const BINS = 48;
  const BIN_H = 13;
  const sites = siteOrders.focus[0];
  const cellW = 30;
  const ranked = order.filter((o) => o.v !== null);

  const width = GUTTER + GAP + GUTTER + GAP + sites.length * cellW;
  const height = BINS * BIN_H;
  const rgb = Buffer.alloc(width * height * 3);
  const put = (x, y, c) => {
    const o = (y * width + x) * 3;
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  };

  for (let b = 0; b < BINS; b++) {
    const lo = Math.floor((b * ranked.length) / BINS);
    const hi = Math.floor(((b + 1) * ranked.length) / BINS);
    const band = ranked.slice(lo, hi);

    const meanV = band.reduce((s, o) => s + o.v, 0) / band.length;
    const climateColor = lerp([49, 88, 128], [200, 106, 63], clamp01((meanV - vMin) / (vMax - vMin)));
    const meanE = band.reduce((s, o) => s + Math.log10((o.expr ?? 0) + 1), 0) / band.length;
    const exprColor = lerp([238, 240, 235], [38, 70, 52], clamp01((meanE - eMin) / (eMax - eMin)));

    const freqs = sites.map((si) => {
      let sum = 0, n = 0;
      for (const o of band) {
        const ch = d.genotypes[si][o.i];
        if (ch === '.') continue;
        sum += ch === '0' ? 0 : ch === '1' ? 1 : 2;
        n++;
      }
      return n === 0 ? null : sum / (2 * n);
    });

    for (let dy = 0; dy < BIN_H; dy++) {
      const y = b * BIN_H + dy;
      for (let x = 0; x < GUTTER; x++) put(x, y, climateColor);
      for (let x = GUTTER; x < GUTTER + GAP; x++) put(x, y, COLOR.gap);
      const x0 = GUTTER + GAP;
      for (let x = x0; x < x0 + GUTTER; x++) put(x, y, exprColor);
      for (let x = x0 + GUTTER; x < x0 + GUTTER + GAP; x++) put(x, y, COLOR.gap);

      const gx = x0 + GUTTER + GAP;
      freqs.forEach((f, col) => {
        const c = f === null ? COLOR.missing : lerp(COLOR.ref, COLOR.alt, f);
        for (let dx = 0; dx < cellW; dx++) put(gx + col * cellW + dx, y, c);
      });
    }
  }

  const out = join(ROOT, 'data', 'preview', `${locusName}-binned.png`);
  writeFileSync(out, encodePng(width, height, rgb));
  console.log(`binned    ${width}x${height}  ${out}`);
}

const rs = d.cline[axis].filter((r) => r !== null).map(Math.abs);
console.log(`\nsorted by ${axis}  (${vMin.toFixed(1)} to ${vMax.toFixed(1)})`);
console.log(`${order.length} accessions, ${d.sites.length} sites, ${rs.length} testable`);
console.log(`strongest |r| = ${Math.max(...rs).toFixed(3)}`);
