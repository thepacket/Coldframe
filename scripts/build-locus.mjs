// Joins one locus across the Coldframe sources into a single artifact.
//
//   usage: node scripts/build-locus.mjs <gene_id> <chrom:start-end> [label] [--public]
//   e.g.   node scripts/build-locus.mjs AT5G10140 5:3170000-3182000 FLC
//
// Sources and their redistribution terms live in data-sources.json. Anything
// marked redistribute:false contributes derived statistics to the artifact but
// never raw per-accession values, so a --public build is safe to ship.
//
// Today that means genotype calls: the 1001 Genomes policy grants no explicit
// redistribution right, so `--public` omits the genotype matrix and keeps the
// per-site statistics computed from it. Allele frequencies and cline
// correlations are facts about the data rather than a subset of it.
//
// The accession id is the join key. Each source spells it differently: bare in
// AraCLIM's `id` column, X-prefixed in the expression matrix (R's make.names on
// numeric headers), bare in the VCF sample columns.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const EXPRESSION_FILE = 'GSE80744_ath1001_tx_norm_2016-04-21-UQ_gNorm_normCounts_k4.tsv.gz';

// Climate variables kept in the artifact. AraCLIM has 200+; these are the ones
// this project actually sorts and colours by.
const CLIMATE_VARS = [
  'Solar_insolation_spring',
  'Solar_insolation_summer',
  'Growing_degree_days',
  'LTemp_day_spring',
  'Ltemp__night_spring', // sic - double underscore in the source file
  'WC2_Average_temperature_spring',
  'WC2_Average_temperature_summer',
  'CRU_Temperature',
  'Aridity_index',
  'SRTM_elevation',
];

// Sites rarer than this are dropped from the cline statistics - a correlation
// carried by a handful of accessions is noise, not a gradient.
const MIN_ALT_FREQ = 0.05;
const MIN_CALLED = 300;

// An ancestry group needs this many called accessions before its within-group
// correlation counts toward the stratified statistic.
const MIN_GROUP = 25;

/** Minimal RFC4180-ish splitter: handles quoted fields, no embedded newlines. */
function splitCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

const num = (v) => {
  if (v === undefined || v === '' || v === 'NA') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * AraCLIM supplies both the roster and the climate table. It carries lng, lat,
 * id, name, country and admixture group alongside the environmental variables,
 * which is why Coldframe doesn't need the 1001 Genomes accession table - one
 * fewer source, and this one is Apache-2.0 rather than unclear.
 */
function loadRosterAndClimate() {
  const lines = readFileSync(join(RAW, 'araclim_climatesd.csv'), 'utf8').split('\n');
  const header = splitCsvLine(lines[0]);
  const col = (n) => {
    const i = header.indexOf(n);
    if (i === -1) throw new Error(`AraCLIM is missing column "${n}"`);
    return i;
  };
  const idx = {
    id: col('id'), name: col('name'), country: col('country'),
    lat: col('lat'), lng: col('lng'), group: col('group'),
  };
  const climateCols = CLIMATE_VARS.map((v) => [v, col(v)]);

  const byId = new Map();
  for (let n = 1; n < lines.length; n++) {
    if (!lines[n].trim()) continue;
    const f = splitCsvLine(lines[n]);
    byId.set(f[idx.id], {
      id: f[idx.id],
      name: f[idx.name],
      country: f[idx.country],
      lat: num(f[idx.lat]),
      lng: num(f[idx.lng]),
      group: f[idx.group] || null,
      climate: Object.fromEntries(climateCols.map(([v, i]) => [v, num(f[i])])),
    });
  }
  return byId;
}

/**
 * One gene's row from the expression matrix. The file is ~26MB gzipped and we
 * want a single row, so find it by string search rather than parsing the table.
 */
function loadExpression(geneId) {
  const text = gunzipSync(readFileSync(join(RAW, EXPRESSION_FILE))).toString('utf8');
  const nl = text.indexOf('\n');
  const ids = text.slice(0, nl).trim().split('\t').slice(1).map((h) => h.replace(/^X/, ''));

  const at = text.indexOf(`\n${geneId}\t`);
  if (at === -1) throw new Error(`gene ${geneId} not found in expression matrix`);
  const end = text.indexOf('\n', at + 1);
  const values = text.slice(at + 1, end === -1 ? undefined : end).trim().split('\t').slice(1);

  const byId = new Map();
  ids.forEach((id, i) => byId.set(id, num(values[i])));
  return byId;
}

/**
 * All-sites VCF from VCFSubset. Keeps only segregating sites and encodes each
 * genotype as one character: 0 hom-ref, 1 het, 2 hom-alt, . missing.
 */
function loadGenotypes(vcfPath) {
  const lines = gunzipSync(readFileSync(vcfPath)).toString('utf8').split('\n');
  const headerIdx = lines.findIndex((l) => l.startsWith('#CHROM'));
  if (headerIdx === -1) throw new Error(`no #CHROM header in ${vcfPath}`);
  const sampleIds = lines[headerIdx].trim().split('\t').slice(9);

  const sites = [];
  const rows = [];
  for (let n = headerIdx + 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line || line[0] === '#') continue;
    const f = line.split('\t');
    if (f[4] === '.' || f[4] === '') continue; // invariant site

    sites.push({ pos: Number(f[1]), ref: f[3], alt: f[4] });
    rows.push(f.slice(9).map(encodeGt));
  }
  return { sampleIds, sites, rows };
}

function encodeGt(field) {
  const gt = field.split(':')[0];
  if (!gt || gt[0] === '.') return '.';
  const a = gt[0], b = gt[2] ?? gt[0];
  if (a === '0' && b === '0') return '0';
  if (a === b) return '2';
  return '1';
}

function pearson(x, y) {
  const n = x.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const u = x[i] - mx, v = y[i] - my;
    cov += u * v; vx += u * u; vy += v * v;
  }
  const d = Math.sqrt(vx * vy);
  return d === 0 ? null : cov / d;
}

const round = (v, p = 4) => (v === null ? null : Number(v.toFixed(p)));

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const publicBuild = args.includes('--public');
const [geneId, region, label] = args.filter((a) => !a.startsWith('--'));

if (!geneId || !region) {
  console.error('usage: node scripts/build-locus.mjs <gene_id> <chrom:start-end> [label] [--public]');
  process.exit(1);
}
const [chrom, span] = region.split(':');
const [start, end] = span.split('-').map(Number);
const name = label ?? geneId;

const sources = JSON.parse(readFileSync(join(ROOT, 'data-sources.json'), 'utf8'));
const roster = loadRosterAndClimate();
const expression = loadExpression(geneId);
const { sampleIds, sites, rows } = loadGenotypes(join(RAW, `${name.toLowerCase()}_664.vcf.gz`));

// Keep accessions present in every source, remembering each one's VCF column so
// genotype strings stay aligned with the roster order.
const kept = [];
sampleIds.forEach((id, col) => {
  const acc = roster.get(id);
  const expr = expression.get(id);
  if (!acc || expr === undefined) return;
  kept.push({ col, ...acc, expression: expr });
});

// Per-site statistics. These are computed from the genotype matrix but are not
// a subset of it, so they ship even when the matrix itself cannot.
const cline = Object.fromEntries([['lat', []], ...CLIMATE_VARS.map((v) => [v, []])]);

/**
 * The same correlations computed inside each ancestry group and averaged,
 * weighted by group size.
 *
 * This is the control the raw cline needs. Northern accessions are both related
 * and cold, so an allele frequency gradient along climate may be relatedness
 * wearing a costume. If the correlation survives within groups it is more
 * likely adaptation; if it collapses, the raw number was population structure.
 *
 * A weighted mean of within-group r, not a formal partial correlation - enough
 * to flag a confound, not enough to publish on.
 */
const clineWithin = Object.fromEntries(Object.keys(cline).map((k) => [k, []]));
const groupOf = kept.map((a) => a.group ?? 'unknown');
const groupNames = [...new Set(groupOf)];
const logExpr = kept.map((a) => (a.expression === null ? null : Math.log10(a.expression + 1)));
const siteStats = rows.map((row, si) => {
  const calls = kept.map(({ col }) => row[col]);
  const dosage = calls.map((c) => (c === '.' ? null : c === '0' ? 0 : c === '1' ? 1 : 2));
  const called = dosage.filter((d) => d !== null).length;
  const altFreq = called === 0 ? 0 : dosage.reduce((s, d) => s + (d ?? 0), 0) / (2 * called);

  const testable = called >= MIN_CALLED && altFreq >= MIN_ALT_FREQ && altFreq <= 1 - MIN_ALT_FREQ;
  for (const axis of Object.keys(cline)) {
    if (!testable) { cline[axis].push(null); clineWithin[axis].push(null); continue; }
    const g = [], e = [];
    kept.forEach((acc, i) => {
      const v = axis === 'lat' ? acc.lat : acc.climate[axis];
      if (dosage[i] !== null && v !== null) { g.push(dosage[i]); e.push(v); }
    });
    cline[axis].push(g.length < MIN_CALLED ? null : round(pearson(g, e)));

    let weighted = 0, weight = 0;
    for (const name of groupNames) {
      const gg = [], ee = [];
      kept.forEach((acc, i) => {
        if (groupOf[i] !== name) return;
        const v = axis === 'lat' ? acc.lat : acc.climate[axis];
        if (dosage[i] !== null && v !== null) { gg.push(dosage[i]); ee.push(v); }
      });
      if (gg.length < MIN_GROUP) continue;
      const r = pearson(gg, ee);
      if (r === null) continue;
      weighted += r * gg.length;
      weight += gg.length;
    }
    clineWithin[axis].push(weight === 0 ? null : round(weighted / weight));
  }

  // Allele dosage against expression - a cis-eQTL test at this site. Cheap to
  // precompute, and without it the signal is only findable by clicking around:
  // the strongest expression effects rarely sit at the strongest climate cline.
  let exprR = null;
  if (testable) {
    const g = [], e = [];
    dosage.forEach((d, i) => {
      if (d !== null && logExpr[i] !== null) { g.push(d); e.push(logExpr[i]); }
    });
    if (g.length >= MIN_CALLED) exprR = round(pearson(g, e));
  }

  return { ...sites[si], altFreq: round(altFreq, 4), called, exprR };
});

// Per-band allele frequencies for the strongest sites on each axis.
//
// These matter for more than convenience. Without them a --public artifact
// could show the cline statistic but not the picture of it, because binning
// needs per-accession calls. A band frequency is an aggregate over ~20
// accessions - a fact about the data, not a subset of it - so precomputing it
// here lets the published build render the view that is the point of the
// project, while the calls themselves stay out.
const BANDS = 32;
const BAND_SITES = 48;

function bandsFor(axis) {
  const ranked = kept
    .map((acc, i) => ({ i, v: axis === 'lat' ? acc.lat : acc.climate[axis] }))
    .filter((o) => o.v !== null)
    .sort((p, q) => p.v - q.v);
  if (ranked.length < BANDS) return null;

  const siteIdx = siteStats
    .map((_, i) => i)
    .filter((i) => cline[axis][i] !== null)
    .sort((a, b) => Math.abs(cline[axis][b]) - Math.abs(cline[axis][a]))
    .slice(0, BAND_SITES)
    .sort((a, b) => siteStats[a].pos - siteStats[b].pos);

  const freq = [], meanAxis = [], meanExpr = [], n = [], groups = [];
  for (let b = 0; b < BANDS; b++) {
    const band = ranked.slice(
      Math.floor((b * ranked.length) / BANDS),
      Math.floor(((b + 1) * ranked.length) / BANDS),
    );
    n.push(band.length);
    meanAxis.push(round(band.reduce((s, o) => s + o.v, 0) / band.length, 3));
    meanExpr.push(round(
      band.reduce((s, o) => s + Math.log10((kept[o.i].expression ?? 0) + 1), 0) / band.length, 3,
    ));

    // Ancestry make-up of the band. If climate bands turn out to be ancestry
    // blocks, the cline and the relatedness are the same axis and the raw
    // correlation is not evidence of adaptation.
    const tally = new Map();
    for (const o of band) {
      const g = groupOf[o.i];
      tally.set(g, (tally.get(g) ?? 0) + 1);
    }
    groups.push(
      [...tally.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => [name, round(count / band.length, 3)]),
    );
    freq.push(siteIdx.map((si) => {
      let sum = 0, called = 0;
      for (const o of band) {
        const ch = rows[si][kept[o.i].col];
        if (ch === '.') continue;
        sum += ch === '0' ? 0 : ch === '1' ? 1 : 2;
        called++;
      }
      return called === 0 ? null : round(sum / (2 * called), 3);
    }));
  }
  return { sites: siteIdx, freq, meanAxis, meanExpr, n, groups };
}

const bands = {
  count: BANDS,
  axes: Object.fromEntries(
    Object.keys(cline).map((axis) => [axis, bandsFor(axis)]).filter(([, v]) => v !== null),
  ),
};

const used = ['araclim', 'gse80744', ...(publicBuild ? [] : ['1001genomes'])];
const restricted = Object.entries(sources)
  .filter(([k, v]) => k !== '_comment' && !v.redistribute)
  .map(([k]) => k);

const artifact = {
  locus: { gene: geneId, label: name, chrom, start, end },
  generated: new Date().toISOString().slice(0, 10),
  provenance: {
    redistributable: publicBuild,
    sources: Object.fromEntries(
      used.map((k) => [k, { name: sources[k].name, license: sources[k].license, cite: sources[k].cite }]),
    ),
    ...(publicBuild
      ? { omitted: `per-accession genotype calls (${restricted.join(', ')}: no explicit redistribution grant)` }
      : { warning: 'contains genotype calls - local use only, do not publish. Rebuild with --public to ship.' }),
  },
  climateVars: CLIMATE_VARS,
  accessions: kept.map(({ col, ...a }) => a),
  sites: siteStats,
  // Correlation of allele dosage with each environmental axis, per site.
  // null where the site is too rare or too poorly called to test.
  cline,
  clineWithin,
  ancestry: kept.map((a) => a.group ?? 'unknown'),
  bands,
  // One string per site, one character per accession, in `accessions` order.
  ...(publicBuild ? {} : { genotypes: rows.map((row) => kept.map(({ col }) => row[col]).join('')) }),
};

mkdirSync(join(ROOT, 'data', 'derived'), { recursive: true });
const out = join(ROOT, 'data', 'derived', `${name.toLowerCase()}${publicBuild ? '.public' : ''}.json`);
writeFileSync(out, JSON.stringify(artifact));

const dropped = sampleIds.length - kept.length;
const strongest = Object.entries(cline)
  .map(([axis, rs]) => {
    let bi = -1;
    rs.forEach((r, i) => { if (r !== null && (bi === -1 || Math.abs(r) > Math.abs(rs[bi]))) bi = i; });
    return bi === -1 ? null : { axis, r: rs[bi], pos: siteStats[bi].pos };
  })
  .filter(Boolean)
  .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];

console.log(`${name} (${geneId})  ${chrom}:${start}-${end}${publicBuild ? '  [public]' : ''}`);
console.log(`  accessions : ${kept.length} joined${dropped ? `, ${dropped} dropped` : ''}`);
console.log(`  sites      : ${siteStats.length} segregating`);
if (strongest) {
  console.log(`  strongest  : r=${strongest.r} vs ${strongest.axis} at ${chrom}:${strongest.pos}`);
}
console.log(`  genotypes  : ${publicBuild ? 'omitted (not redistributable)' : 'included (local only)'}`);
console.log(`  wrote      : ${out}`);
