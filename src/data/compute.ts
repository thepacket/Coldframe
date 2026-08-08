// The statistics, ported line for line from scripts/build-locus.mjs so a
// browser-assembled artifact matches a node-built one exactly. If these two
// implementations ever disagree, the node one is the reference and this one
// is wrong.

import type { Accession, Artifact } from '../types';
import { CLIMATE_VARS, type ParsedVcf, type RosterEntry } from './parse';

// Below these, a Pearson correlation across the panel is not reliable, so
// `cline` and `exprR` are left null. A limit of the statistic, not a verdict
// on the site - `carriers` and `shift` cover every site regardless.
const MIN_ALT_FREQ = 0.05;
const MIN_CALLED = 300;
const MIN_GROUP = 25;

function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i] as number; sy += y[i] as number; }
  const mx = sx / n, my = sy / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const u = (x[i] as number) - mx, v = (y[i] as number) - my;
    cov += u * v; vx += u * u; vy += v * v;
  }
  const d = Math.sqrt(vx * vy);
  return d === 0 ? null : cov / d;
}

const round = (v: number | null, p = 4): number | null =>
  v === null ? null : Number(v.toFixed(p));

export interface LocusDef {
  label: string;
  gene: string;
  region: string;
  title: string;
  note: string;
}

export function computeArtifact(
  def: LocusDef,
  roster: Map<string, RosterEntry>,
  expression: Map<string, number | null>,
  vcf: ParsedVcf,
): Artifact {
  const [chrom, span] = def.region.split(':') as [string, string];
  const [start, end] = span.split('-').map(Number) as [number, number];

  // Accessions present in every source, remembering each one's VCF column so
  // genotype strings stay aligned with the roster order.
  const kept: (Accession & { col: number })[] = [];
  vcf.sampleIds.forEach((id, col) => {
    const acc = roster.get(id);
    const expr = expression.get(id);
    if (!acc || expr === undefined) return;
    kept.push({ col, ...acc, expression: expr });
  });

  const logExpr = kept.map((a) =>
    a.expression === null ? null : Math.log10(a.expression + 1),
  );

  const axes = ['lat', ...CLIMATE_VARS];
  const axisValue = (acc: Accession, axis: string): number | null =>
    axis === 'lat' ? acc.lat : (acc.climate[axis] ?? null);

  const cline: Record<string, (number | null)[]> = Object.fromEntries(axes.map((a) => [a, []]));
  const clineWithin: Record<string, (number | null)[]> = Object.fromEntries(axes.map((a) => [a, []]));
  const shift: Record<string, (number | null)[]> = Object.fromEntries(axes.map((a) => [a, []]));

  const groupOf = kept.map((a) => a.group ?? 'unknown');
  const groupNames = [...new Set(groupOf)];

  // Mean and SD of each axis over the panel, computed once, for `shift`.
  const axisStats = Object.fromEntries(
    axes.map((axis) => {
      const vals = kept.map((a) => axisValue(a, axis)).filter((v): v is number => v !== null);
      const mean = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length || 1));
      return [axis, { mean, sd }];
    }),
  );

  const sites = vcf.rows.map((row, si) => {
    const dosage = kept.map(({ col }) => {
      const ch = row[col];
      return ch === '.' || ch === undefined ? null : ch === '0' ? 0 : ch === '1' ? 1 : 2;
    });
    const called = dosage.filter((d) => d !== null).length;
    const altFreq =
      called === 0 ? 0 : dosage.reduce<number>((s, d) => s + (d ?? 0), 0) / (2 * called);
    const carriers = dosage.filter((d) => d !== null && d > 0).length;

    const testable =
      called >= MIN_CALLED && altFreq >= MIN_ALT_FREQ && altFreq <= 1 - MIN_ALT_FREQ;

    for (const axis of axes) {
      // Shift is computed for every site, testable or not.
      const withA: number[] = [];
      const withoutA: number[] = [];
      kept.forEach((acc, i) => {
        const v = axisValue(acc, axis);
        const d = dosage[i];
        if (d === null || d === undefined || v === null) return;
        (d > 0 ? withA : withoutA).push(v);
      });
      const sd = (axisStats[axis] as { sd: number }).sd;
      if (withA.length === 0 || withoutA.length === 0 || sd === 0) {
        (shift[axis] as (number | null)[]).push(null);
      } else {
        const mA = withA.reduce((s, v) => s + v, 0) / withA.length;
        const mB = withoutA.reduce((s, v) => s + v, 0) / withoutA.length;
        (shift[axis] as (number | null)[]).push(round((mA - mB) / sd, 3));
      }

      if (!testable) {
        (cline[axis] as (number | null)[]).push(null);
        (clineWithin[axis] as (number | null)[]).push(null);
        continue;
      }
      const g: number[] = [];
      const e: number[] = [];
      kept.forEach((acc, i) => {
        const v = axisValue(acc, axis);
        const d = dosage[i];
        if (d !== null && d !== undefined && v !== null) { g.push(d); e.push(v); }
      });
      (cline[axis] as (number | null)[]).push(
        g.length < MIN_CALLED ? null : round(pearson(g, e)),
      );

      let weighted = 0;
      let weight = 0;
      for (const name of groupNames) {
        const gg: number[] = [];
        const ee: number[] = [];
        kept.forEach((acc, i) => {
          if (groupOf[i] !== name) return;
          const v = axisValue(acc, axis);
          const d = dosage[i];
          if (d !== null && d !== undefined && v !== null) { gg.push(d); ee.push(v); }
        });
        if (gg.length < MIN_GROUP) continue;
        const r = pearson(gg, ee);
        if (r === null) continue;
        weighted += r * gg.length;
        weight += gg.length;
      }
      (clineWithin[axis] as (number | null)[]).push(
        weight === 0 ? null : round(weighted / weight),
      );
    }

    // Allele dosage against expression - the cis-eQTL test - plus the same
    // ancestry control the climate cline gets.
    let exprR: number | null = null;
    let exprRWithin: number | null = null;
    if (testable) {
      const g: number[] = [];
      const e: number[] = [];
      dosage.forEach((d, i) => {
        const le = logExpr[i];
        if (d !== null && d !== undefined && le !== null && le !== undefined) {
          g.push(d);
          e.push(le);
        }
      });
      if (g.length >= MIN_CALLED) exprR = round(pearson(g, e));

      let weighted = 0;
      let weight = 0;
      for (const name of groupNames) {
        const gg: number[] = [];
        const ee: number[] = [];
        dosage.forEach((d, i) => {
          if (groupOf[i] !== name) return;
          const le = logExpr[i];
          if (d !== null && d !== undefined && le !== null && le !== undefined) {
            gg.push(d);
            ee.push(le);
          }
        });
        if (gg.length < MIN_GROUP) continue;
        const r = pearson(gg, ee);
        if (r === null) continue;
        weighted += r * gg.length;
        weight += gg.length;
      }
      if (weight > 0) exprRWithin = round(weighted / weight);
    }

    const site = vcf.sites[si] as { pos: number; ref: string; alt: string };
    return {
      ...site,
      altFreq: round(altFreq, 4) as number,
      called,
      carriers,
      exprR,
      exprRWithin,
    };
  });

  return {
    locus: { gene: def.gene, label: def.label, chrom, start, end },
    generated: new Date().toISOString().slice(0, 10),
    provenance: {
      redistributable: false,
      sources: {
        araclim: { name: 'AraCLIM (Arabidopsis CLIMtools)', license: 'Apache-2.0', cite: 'Ferrero-Serrano & Assmann 2019, Nature Communications' },
        gse80744: { name: '1001 Transcriptomes (GEO GSE80744)', license: 'US Government work, public domain', cite: 'Kawakatsu et al. 2016, Cell 166:492-505' },
        '1001genomes': { name: '1001 Genomes, v3.1 callset via VCFSubset', license: 'unclear', cite: '1001 Genomes Consortium 2016, Cell 166:481-491' },
      },
      warning:
        'Assembled live in this browser from the source archives. Contains genotype calls; keep it here rather than republishing it.',
    },
    climateVars: [...CLIMATE_VARS],
    accessions: kept.map(({ col: _col, ...a }) => a),
    sites,
    cline,
    clineWithin,
    shift,
    ancestry: groupOf,
    // Live-computed by the view layer whenever genotypes are present, which in
    // a browser-assembled artifact is always.
    bands: { count: 32, axes: {} },
    genotypes: vcf.rows.map((row) => kept.map(({ col }) => row[col]).join('')),
  };
}
