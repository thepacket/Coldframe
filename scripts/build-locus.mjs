// Joins one locus across the four Coldframe sources into a single artifact.
//
//   usage: node scripts/build-locus.mjs <gene_id> <chrom:start-end> [label]
//   e.g.   node scripts/build-locus.mjs AT5G10140 5:3170000-3182000 FLC
//
// Sources (all under data/raw, see scripts/fetch-raw.sh):
//   accessions_1001g.csv  - id, name, country, lat/lng, admixture group
//   araclim_climatesd.csv - 200+ geo-climate variables per accession
//   GSE80744_*.tsv.gz     - normalised expression, one column per accession
//   <locus>.vcf.gz        - all-sites VCF from the VCFSubset API
//
// The accession id is the join key everywhere, but each source spells it
// differently: bare in the 1001G csv, bare in AraCLIM's `id` column, and
// X-prefixed in the expression matrix (R's make.names on numeric headers).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');

// Climate variables kept in the artifact. The full AraCLIM table has 200+;
// these are the ones this project actually sorts and colours by.
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

/** 1001G accession table. Headerless; column order is positional. */
function loadAccessions() {
  const text = readFileSync(join(RAW, 'accessions_1001g.csv'), 'utf8');
  const byId = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const f = splitCsvLine(line);
    byId.set(f[0], {
      id: f[0],
      name: f[2],
      country: f[3],
      lat: num(f[5]),
      lng: num(f[6]),
      group: f[10] || null,
    });
  }
  return byId;
}

/** AraCLIM wide table, keyed by its `id` column. */
function loadClimate() {
  const lines = readFileSync(join(RAW, 'araclim_climatesd.csv'), 'utf8').split('\n');
  const header = splitCsvLine(lines[0]);
  const idCol = header.indexOf('id');
  const cols = CLIMATE_VARS.map((v) => {
    const i = header.indexOf(v);
    if (i === -1) throw new Error(`AraCLIM is missing column "${v}"`);
    return [v, i];
  });

  const byId = new Map();
  for (let n = 1; n < lines.length; n++) {
    if (!lines[n].trim()) continue;
    const f = splitCsvLine(lines[n]);
    byId.set(f[idCol], Object.fromEntries(cols.map(([v, i]) => [v, num(f[i])])));
  }
  return byId;
}

/**
 * One gene's row from the expression matrix. The file is ~26MB gzipped and we
 * want a single row, so scan line-by-line rather than parsing the whole table.
 */
function loadExpression(geneId) {
  const text = gunzipSync(readFileSync(join(RAW, expressionFile()))).toString('utf8');
  const nl = text.indexOf('\n');
  // Header starts with `gene_id`, then one X-prefixed accession id per column.
  const ids = text.slice(0, nl).trim().split('\t').slice(1).map((h) => h.replace(/^X/, ''));

  const needle = `\n${geneId}\t`;
  const at = text.indexOf(needle);
  if (at === -1) throw new Error(`gene ${geneId} not found in expression matrix`);
  const end = text.indexOf('\n', at + 1);
  const values = text.slice(at + 1, end === -1 ? undefined : end).trim().split('\t').slice(1);

  const byId = new Map();
  ids.forEach((id, i) => byId.set(id, num(values[i])));
  return byId;
}

function expressionFile() {
  return 'GSE80744_ath1001_tx_norm_2016-04-21-UQ_gNorm_normCounts_k4.tsv.gz';
}

/**
 * All-sites VCF from VCFSubset. Keeps only segregating sites (ALT !== '.') and
 * encodes each genotype as one character: 0 hom-ref, 1 het, 2 hom-alt, . missing.
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

// ---------------------------------------------------------------------------

const [geneId, region, label] = process.argv.slice(2);
if (!geneId || !region) {
  console.error('usage: node scripts/build-locus.mjs <gene_id> <chrom:start-end> [label]');
  process.exit(1);
}
const [chrom, span] = region.split(':');
const [start, end] = span.split('-').map(Number);
const name = label ?? geneId;

const accessions = loadAccessions();
const climate = loadClimate();
const expression = loadExpression(geneId);
const { sampleIds, sites, rows } = loadGenotypes(join(RAW, `${name.toLowerCase()}_664.vcf.gz`));

// Keep only accessions present in all four sources, and remember each one's
// column index in the VCF so genotype strings stay aligned with the roster.
const kept = [];
sampleIds.forEach((id, col) => {
  const acc = accessions.get(id);
  const clim = climate.get(id);
  const expr = expression.get(id);
  if (!acc || !clim || expr === undefined) return;
  kept.push({ col, ...acc, expression: expr, climate: clim });
});

const artifact = {
  locus: { gene: geneId, label: name, chrom, start, end },
  generated: new Date().toISOString().slice(0, 10),
  climateVars: CLIMATE_VARS,
  accessions: kept.map(({ col, ...a }) => a),
  sites,
  // One string per site, one character per accession, in `accessions` order.
  genotypes: rows.map((row) => kept.map(({ col }) => row[col]).join('')),
};

mkdirSync(join(ROOT, 'data', 'derived'), { recursive: true });
const out = join(ROOT, 'data', 'derived', `${name.toLowerCase()}.json`);
writeFileSync(out, JSON.stringify(artifact));

const dropped = sampleIds.length - kept.length;
console.log(`${name} (${geneId})  ${chrom}:${start}-${end}`);
console.log(`  accessions : ${kept.length} joined${dropped ? `, ${dropped} dropped` : ''}`);
console.log(`  sites      : ${sites.length} segregating`);
console.log(`  wrote      : ${out}`);
