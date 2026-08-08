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
  /** Allele dosage against log expression - a cis-eQTL test. Null if untestable. */
  exprR: number | null;
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
