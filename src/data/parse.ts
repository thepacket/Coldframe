// Parsers for the three live sources, ported from scripts/build-locus.mjs so
// a browser-assembled artifact matches a node-built one number for number.

export const CLIMATE_VARS = [
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
] as const;

export interface RosterEntry {
  id: string;
  name: string;
  country: string;
  lat: number | null;
  lng: number | null;
  group: string | null;
  climate: Record<string, number | null>;
}

export interface ParsedVcf {
  sampleIds: string[];
  sites: { pos: number; ref: string; alt: string }[];
  /** One string per site, one char per sample: 0 hom-ref, 1 het, 2 hom-alt, . missing. */
  rows: string[];
}

/** Minimal RFC4180-ish splitter: handles quoted fields, no embedded newlines. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === '' || v === 'NA') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** AraCLIM: roster and climate in one table, keyed by bare accession id. */
export function parseAraclim(text: string): Map<string, RosterEntry> {
  const lines = text.split('\n');
  const header = splitCsvLine(lines[0] ?? '');
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`AraCLIM is missing column "${name}"`);
    return i;
  };
  const idx = {
    id: col('id'), name: col('name'), country: col('country'),
    lat: col('lat'), lng: col('lng'), group: col('group'),
  };
  const climateCols = CLIMATE_VARS.map((v) => [v, col(v)] as const);

  const byId = new Map<string, RosterEntry>();
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line || !line.trim()) continue;
    const f = splitCsvLine(line);
    const id = f[idx.id];
    if (!id) continue;
    byId.set(id, {
      id,
      name: f[idx.name] ?? '',
      country: f[idx.country] ?? '',
      lat: num(f[idx.lat]),
      lng: num(f[idx.lng]),
      group: f[idx.group] || null,
      climate: Object.fromEntries(climateCols.map(([v, i]) => [v, num(f[i])])),
    });
  }
  return byId;
}

/**
 * Pulls the header ids and the rows for `genes` out of the expression matrix
 * in one pass, so the 130MB decompressed text can be dropped immediately.
 * Row lookup is by string search rather than a full parse - same trick as the
 * node build, for the same reason.
 */
export function extractExpression(
  text: string,
  genes: string[],
): { ids: string[]; rows: Record<string, string> } {
  const nl = text.indexOf('\n');
  const ids = text.slice(0, nl).trim().split('\t').slice(1).map((h) => h.replace(/^X/, ''));

  const rows: Record<string, string> = {};
  for (const gene of genes) {
    const at = text.indexOf(`\n${gene}\t`);
    if (at === -1) continue; // surfaced later as "gene not in matrix"
    const end = text.indexOf('\n', at + 1);
    rows[gene] = text.slice(at + 1, end === -1 ? undefined : end).trim();
  }
  return { ids, rows };
}

/** One stored expression row into a per-accession map. */
export function expressionMap(ids: string[], row: string): Map<string, number | null> {
  const values = row.split('\t').slice(1);
  const byId = new Map<string, number | null>();
  ids.forEach((id, i) => byId.set(id, num(values[i])));
  return byId;
}

function encodeGt(field: string): string {
  const gt = field.split(':')[0];
  if (!gt || gt[0] === '.') return '.';
  const a = gt[0];
  const b = gt[2] ?? a;
  if (a === '0' && b === '0') return '0';
  if (a === b) return '2';
  return '1';
}

/** All-sites VCF text: keep segregating sites only. */
export function parseVcf(text: string): ParsedVcf {
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) => l.startsWith('#CHROM'));
  if (headerIdx === -1) throw new Error('no #CHROM header in VCF response');
  const sampleIds = (lines[headerIdx] as string).trim().split('\t').slice(9);

  const sites: ParsedVcf['sites'] = [];
  const rows: string[] = [];
  for (let n = headerIdx + 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line || line[0] === '#') continue;
    const f = line.split('\t');
    if (f[4] === '.' || f[4] === '' || f[4] === undefined) continue;

    sites.push({ pos: Number(f[1]), ref: f[3] as string, alt: f[4] });
    rows.push(f.slice(9).map(encodeGt).join(''));
  }
  return { sampleIds, sites, rows };
}
