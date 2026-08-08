// Assembles a locus artifact entirely in the browser.
//
// Nothing is packaged with the app: the roster and climate come from AraCLIM's
// repository, expression from NCBI GEO, genotypes from the 1001 Genomes
// VCFSubset API - all fetched from origin servers that send
// Access-Control-Allow-Origin: *. Everything is cached in IndexedDB, so each
// source is fetched once per browser, not once per visit.

import { gunzipText } from './bgzf';
import { computeArtifact, type LocusDef } from './compute';
import { idbGet, idbPut } from './idb';
import { expressionMap, extractExpression, parseAraclim, parseVcf } from './parse';
import type { Artifact } from '../types';

// Bump when the artifact shape or the statistics change, so stale caches
// rebuild instead of feeding old numbers to new code.
const SCHEMA = 'v1';

const ARACLIM_URL =
  'https://raw.githubusercontent.com/CLIMtools/AraCLIM/master/data/shiny%20climatesd.csv';
const EXPRESSION_URL =
  'https://ftp.ncbi.nlm.nih.gov/geo/series/GSE80nnn/GSE80744/suppl/GSE80744_ath1001_tx_norm_2016-04-21-UQ_gNorm_normCounts_k4.tsv.gz';
const VCFSUBSET_URL = 'https://tools.1001genomes.org/api/v1/vcfsubset/';

export type Report = (message: string) => void;

async function fetchWithProgress(
  url: string,
  report: Report,
  what: string,
  init?: RequestInit,
): Promise<ArrayBuffer> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${what}: ${res.status} from ${new URL(url).host}`);
  if (!res.body) return res.arrayBuffer();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    report(`${what} — ${(received / 1048576).toFixed(1)} MB`);
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out.buffer;
}

async function getRosterText(report: Report): Promise<string> {
  const cached = await idbGet<string>(`araclim:${SCHEMA}`);
  if (cached) return cached;
  const buf = await fetchWithProgress(ARACLIM_URL, report, 'Fetching climate & roster (AraCLIM)');
  const text = new TextDecoder().decode(buf);
  await idbPut(`araclim:${SCHEMA}`, text);
  return text;
}

interface ExpressionCache {
  ids: string[];
  rows: Record<string, string>;
}

/**
 * The expression matrix is 26MB compressed and ~130MB as text, of which nine
 * rows matter. It is fetched once, the needed rows extracted, and the rest
 * discarded - the cache holds a few hundred KB, not the matrix.
 */
async function getExpression(genes: string[], report: Report): Promise<ExpressionCache> {
  const cached = await idbGet<ExpressionCache>(`expr:${SCHEMA}`);
  if (cached && genes.every((g) => g in cached.rows)) return cached;

  const buf = await fetchWithProgress(
    EXPRESSION_URL, report, 'Fetching expression matrix (NCBI GEO, one-time)',
  );
  report('Decompressing expression matrix…');
  const text = await gunzipText(buf);
  const extracted = extractExpression(text, genes);
  await idbPut(`expr:${SCHEMA}`, extracted);
  return extracted;
}

export async function getArtifact(
  def: LocusDef,
  allGenes: string[],
  report: Report,
): Promise<Artifact> {
  const cacheKey = `artifact:${def.label}:${SCHEMA}`;
  const cached = await idbGet<Artifact>(cacheKey);
  if (cached) return cached;

  const rosterText = await getRosterText(report);
  const roster = parseAraclim(rosterText);
  const expr = await getExpression(allGenes, report);

  const row = expr.rows[def.gene];
  if (!row) throw new Error(`${def.gene} is not in the expression matrix`);
  const expression = expressionMap(expr.ids, row);

  // The joinable accession set: everything with both climate and expression,
  // sorted numerically. Same derivation as scripts/fetch-raw.sh.
  const strains = expr.ids
    .filter((id) => roster.has(id))
    .sort((a, b) => Number(a) - Number(b));

  report(`Fetching genotypes for ${def.label} (1001 Genomes)…`);
  const body = new URLSearchParams({
    strains: strains.join(','),
    regions: def.region,
    type: 'fullgenome',
    format: 'vcf.gz',
  });
  // URLSearchParams gives application/x-www-form-urlencoded - a "simple"
  // request, which matters because the endpoint 404s CORS preflights.
  const buf = await fetchWithProgress(
    VCFSUBSET_URL, report, `Fetching genotypes for ${def.label}`, { method: 'POST', body },
  );

  report(`Decompressing and parsing ${def.label}…`);
  const vcf = parseVcf(await gunzipText(buf));

  report(`Computing statistics for ${def.label}…`);
  // Yield once so the status line above actually paints before the long
  // synchronous compute.
  await new Promise((r) => setTimeout(r, 30));
  const artifact = computeArtifact(def, roster, expression, vcf);

  await idbPut(cacheKey, artifact);
  return artifact;
}
