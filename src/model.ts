// Turns an artifact plus the current controls into everything the panel draws.
// No canvas here, no DOM - just the arrangement.

import type { Artifact, Accession, AxisBands, Site } from './types';

export interface Row {
  accession: Accession;
  /** Value on the current ordering axis. */
  axisValue: number;
  /** Position of this accession's expression within the locus, 0-1. */
  exprRank: number;
  /** Column index into `Artifact.genotypes[site]`. */
  gtIndex: number;
  ancestry: string;
}

export type RankBy = 'cline' | 'expression';

export interface Column {
  site: Site;
  siteIndex: number;
  /** Correlation with the current axis. Null when ranking by expression. */
  r: number | null;
  /** The same correlation computed within ancestry groups. */
  rWithin: number | null;
  /** Whichever metric the columns were ranked by, and its ancestry control. */
  value: number;
  valueWithin: number | null;
}

export interface Band {
  meanAxis: number;
  /** Mean expression rank of the band's accessions, 0-1. */
  exprRank: number;
  n: number;
  /** Alt allele frequency per column, aligned to `columns`. */
  freq: (number | null)[];
  /** Ancestry make-up, commonest first. */
  groups: [string, number][];
}

/** Every segregating site in the region, for the overview strip. */
export interface OverviewSite {
  index: number;
  pos: number;
  shift: number | null;
  carriers: number;
  /** Whether a correlation could be computed here at all. */
  testable: boolean;
}

export interface View {
  axis: string;
  rankBy: RankBy;
  allSites: OverviewSite[];
  /** Region bounds, for placing overview ticks at true genomic position. */
  span: [number, number];
  columns: Column[];
  /** Empty when the artifact carries no genotypes (a --public build). */
  rows: Row[];
  bands: Band[];
  axisRange: [number, number];
  /** Accessions dropped for want of a value on this axis. */
  omitted: number;
  hasGenotypes: boolean;
}

/** Equal-count climate bands. Matches what build-locus.mjs precomputes. */
const BAND_COUNT = 32;

interface Ordered {
  accession: Accession;
  gtIndex: number;
  axisValue: number;
}

/**
 * Bands computed from the genotype matrix, for any number of columns.
 *
 * Roughly bands x columns x plants multiplications - about 30ms at 340
 * columns, which is fine for a control change and acceptable while dragging.
 */
function liveBands(
  genotypes: string[],
  ordered: Ordered[],
  columns: Column[],
  ranks: Map<string, number>,
  ancestry: string[],
  bandCount: number,
): Band[] {
  const bands: Band[] = [];
  for (let b = 0; b < bandCount; b++) {
    const members = ordered.slice(
      Math.floor((b * ordered.length) / bandCount),
      Math.floor(((b + 1) * ordered.length) / bandCount),
    );
    if (members.length === 0) continue;

    const tally = new Map<string, number>();
    for (const m of members) {
      const g = ancestry[m.gtIndex] ?? 'unknown';
      tally.set(g, (tally.get(g) ?? 0) + 1);
    }

    bands.push({
      meanAxis: members.reduce((s, m) => s + m.axisValue, 0) / members.length,
      exprRank:
        members.reduce((s, m) => s + (ranks.get(m.accession.id) ?? 0), 0) / members.length,
      n: members.length,
      groups: [...tally.entries()]
        .sort((x, y) => y[1] - x[1])
        .map(([name, count]) => [name, count / members.length] as [string, number]),
      freq: columns.map((c) => {
        const row = genotypes[c.siteIndex];
        if (!row) return null;
        let sum = 0;
        let called = 0;
        for (const m of members) {
          const ch = row[m.gtIndex];
          if (ch === undefined || ch === '.') continue;
          sum += ch === '0' ? 0 : ch === '1' ? 1 : 2;
          called++;
        }
        return called === 0 ? null : sum / (2 * called);
      }),
    });
  }
  return bands;
}

/** Fallback for --public builds, limited to the sites the artifact covers. */
function precomputedBands(axisBands: AxisBands | undefined, columns: Column[]): Band[] {
  if (!axisBands) return [];
  const slot = new Map(axisBands.sites.map((si, n) => [si, n]));
  const exprValues = axisBands.meanExpr;
  const [eLo, eHi] = [Math.min(...exprValues), Math.max(...exprValues)];
  const eSpan = eHi - eLo || 1;

  return axisBands.freq.map((row, b) => ({
    meanAxis: axisBands.meanAxis[b] as number,
    exprRank: ((exprValues[b] as number) - eLo) / eSpan,
    n: axisBands.n[b] as number,
    groups: axisBands.groups?.[b] ?? [],
    freq: columns.map((c) => {
      const n = slot.get(c.siteIndex);
      return n === undefined ? null : (row[n] ?? null);
    }),
  }));
}

const axisValueOf = (a: Accession, axis: string): number | null =>
  axis === 'lat' ? a.lat : (a.climate[axis] ?? null);

/**
 * Expression is heavily skewed - at FLC it spans 2 to 25,609 - so a linear or
 * even log ramp leaves almost every accession the same colour. Ranking spreads
 * them across the full scale, which is what the strip is for. Raw values stay
 * available in the tooltip.
 */
function expressionRanks(accessions: Accession[]): Map<string, number> {
  const withValue = accessions
    .filter((a) => a.expression !== null)
    .sort((p, q) => (p.expression as number) - (q.expression as number));
  const ranks = new Map<string, number>();
  const last = Math.max(1, withValue.length - 1);
  withValue.forEach((a, i) => ranks.set(a.id, i / last));
  return ranks;
}

export function buildView(
  artifact: Artifact,
  axis: string,
  siteCount: number,
  rankBy: RankBy = 'cline',
): View {
  const cline = artifact.cline[axis] ?? [];
  const axisBands = artifact.bands.axes[axis];

  // Ranking picks which sites appear; position arranges them. Two rankings are
  // offered because they disagree: at FRI the strongest expression effect is
  // the 86th strongest climate cline, so without this it is unreachable.
  const metric = (i: number): number | null =>
    rankBy === 'cline' ? (cline[i] ?? null) : ((artifact.sites[i] as Site).exprR ?? null);

  const chosen = artifact.sites
    .map((_, i) => i)
    .filter((i) => metric(i) !== null)
    .sort((a, b) => Math.abs(metric(b) as number) - Math.abs(metric(a) as number))
    .slice(0, siteCount);

  const columns: Column[] = chosen
    .sort((a, b) => (artifact.sites[a] as Site).pos - (artifact.sites[b] as Site).pos)
    .map((i) => {
      const site = artifact.sites[i] as Site;
      return {
        site,
        siteIndex: i,
        r: cline[i] ?? null,
        rWithin: artifact.clineWithin?.[axis]?.[i] ?? null,
        value: metric(i) as number,
        valueWithin:
          rankBy === 'cline' ? (artifact.clineWithin?.[axis]?.[i] ?? null) : site.exprRWithin,
      };
    });

  const ranks = expressionRanks(artifact.accessions);
  const ordered = artifact.accessions
    .map((accession, gtIndex) => ({ accession, gtIndex, axisValue: axisValueOf(accession, axis) }))
    .filter((o): o is { accession: Accession; gtIndex: number; axisValue: number } => o.axisValue !== null)
    .sort((p, q) => p.axisValue - q.axisValue);

  const rows: Row[] = artifact.genotypes
    ? ordered.map((o) => ({
        ...o,
        exprRank: ranks.get(o.accession.id) ?? 0,
        ancestry: artifact.ancestry?.[o.gtIndex] ?? 'unknown',
      }))
    : [];

  // Bands two ways.
  //
  // With genotypes in hand we compute them live, which frees the panel from the
  // artifact's 48-site precompute and lets every testable site be shown. A
  // --public build has no genotypes, so it falls back to the precomputed table
  // and is limited to the sites that table covers.
  const bands: Band[] = artifact.genotypes
    ? liveBands(artifact.genotypes, ordered, columns, ranks, artifact.ancestry ?? [], BAND_COUNT)
    : precomputedBands(axisBands, columns);

  const shifts = artifact.shift?.[axis] ?? [];
  const allSites: OverviewSite[] = artifact.sites.map((site, i) => ({
    index: i,
    pos: site.pos,
    shift: shifts[i] ?? null,
    carriers: site.carriers ?? 0,
    testable: cline[i] !== null && cline[i] !== undefined,
  }));

  const values = ordered.map((o) => o.axisValue);
  const axisRange: [number, number] = values.length
    ? [Math.min(...values), Math.max(...values)]
    : [0, 1];

  return {
    axis,
    rankBy,
    allSites,
    span: [artifact.locus.start, artifact.locus.end],
    columns,
    rows,
    bands,
    axisRange,
    omitted: artifact.accessions.length - ordered.length,
    hasGenotypes: Boolean(artifact.genotypes),
  };
}

/** `Ltemp__night_spring` reads badly in a dropdown. */
export function humanise(name: string): string {
  if (name === 'lat') return 'Latitude';
  return name
    .replace(/_{2,}/g, '_')
    .replace(/^WC2_/, '')
    .replace(/^CRU_/, '')
    .replace(/^SRTM_/, '')
    .replace(/^LTemp_/i, 'Land temperature ')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}
