/** Shape of the artifacts written by scripts/build-locus.mjs. */

export interface Accession {
  id: string;
  name: string;
  country: string;
  lat: number | null;
  lng: number | null;
  group: string | null;
  expression: number | null;
  climate: Record<string, number | null>;
}

export interface Site {
  pos: number;
  ref: string;
  alt: string;
  altFreq: number;
  called: number;
  /** Plants carrying at least one alternate allele. Defined at any frequency. */
  carriers: number;
  /** Allele dosage against log expression - a cis-eQTL test. Null if untestable. */
  exprR: number | null;
  /** The same, computed within ancestry groups. */
  exprRWithin: number | null;
}

export interface Locus {
  gene: string;
  label: string;
  chrom: string;
  start: number;
  end: number;
}

export interface Provenance {
  redistributable: boolean;
  sources: Record<string, { name: string; license: string; cite: string }>;
  omitted?: string;
  warning?: string;
}

/** Accessions grouped into equal-count bands along one environmental axis. */
export interface AxisBands {
  /** Indices into `Artifact.sites`, genomic order, strongest clines on this axis. */
  sites: number[];
  /** `freq[band][n]` - alt allele frequency, indexed against `sites`. */
  freq: (number | null)[][];
  meanAxis: number[];
  /** Mean log10(expression + 1) per band. */
  meanExpr: number[];
  n: number[];
  /** `groups[band]` = [[group, share], ...], commonest first. */
  groups: [string, number][][];
}

export interface Bands {
  count: number;
  axes: Record<string, AxisBands>;
}

export interface Artifact {
  locus: Locus;
  generated: string;
  provenance: Provenance;
  climateVars: string[];
  accessions: Accession[];
  sites: Site[];
  /** Allele dosage correlated with each environmental axis, per site. */
  cline: Record<string, (number | null)[]>;
  /**
   * The same correlations computed inside each ancestry group and averaged by
   * group size. The control the raw cline needs: northern accessions are both
   * related and cold, so a gradient along climate may be relatedness wearing a
   * costume. Survives within groups, more likely adaptation; collapses, it was
   * structure.
   */
  clineWithin: Record<string, (number | null)[]>;
  /**
   * Standardised difference in environment between carriers and non-carriers,
   * per axis, for every site including those too rare to correlate. This is
   * what makes rare variants visible: an allele in eight plants that all grew
   * somewhere cold shows a large shift where `cline` is simply null.
   */
  shift: Record<string, (number | null)[]>;
  /** Admixture group per accession, aligned to `accessions`. */
  ancestry: string[];
  /**
   * Precomputed band aggregates. Present in every artifact, including --public
   * builds: a band frequency averages ~20 accessions, so it is a fact about the
   * data rather than a subset of it. This is what lets a published build render
   * the banded view without carrying genotype calls.
   */
  bands: Bands;
  /**
   * One string per site, one character per accession in `accessions` order:
   * 0 hom-ref, 1 het, 2 hom-alt, . missing.
   *
   * Absent from --public artifacts, because the 1001 Genomes callset carries no
   * explicit redistribution grant. Only the per-accession panel needs it.
   */
  genotypes?: string[];
}

export type Genotype = '0' | '1' | '2' | '.';
