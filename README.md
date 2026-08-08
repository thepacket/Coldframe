# Coldframe

A cold frame is a low glass box you put over plants to carry them through winter.

Coldframe is a browser for looking at one genomic locus across a thousand wild
plants at once — sorted by the climate each of them came from. Open a
cold-adaptation gene and the allele frequency gradient appears as a visible
cline, because the accessions are ordered by the world rather than by accession
number.

It asks one question: **does the allele you carry change how you respond when the
light goes?**

Built on *Arabidopsis thaliana*, whose 1001 Genomes panel is the best natural
experiment in climate adaptation we have — 1,135 accessions collected from Cape
Verde to northern Scandinavia, sequenced, expression-profiled, and geo-referenced.

Status: **early.** The data layer joins and validates; there is no interface yet.

## Why not IGV or JBrowse

This isn't a track browser and doesn't try to be one. Those tools show you a
locus in one genome very well. Coldframe shows you one locus across many
genomes, ordered by environment — which is a matrix, not a track. Different
picture, different question.

## The data

Four sources, joined on the accession id. **664 accessions** carry all four.

| Layer | Source | Notes |
|---|---|---|
| Accessions | 1001 Genomes `tg_accessions` | 1,135 rows: name, country, lat/lng, admixture group |
| Climate | [AraCLIM](https://github.com/CLIMtools/AraCLIM) | 200+ geo-climate variables for 1,131 geo-referenced accessions |
| Expression | [GEO GSE80744](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE80744) | 1001 Transcriptomes, rosette leaf, 727 accessions |
| Genotypes | [VCFSubset API](https://tools.1001genomes.org/vcfsubset/) | per-locus slices of the 1001 Genomes v3.1 callset |

Everything is on TAIR10, so there is no assembly reconciliation to do.

The full callset is a 19 GB VCF. Coldframe never downloads it — loci are pulled
region-by-region from the VCFSubset API, a few seconds and a few megabytes each.

### Identifier quirks

The accession id is the join key, spelled differently in each source:

- 1001G accessions csv — bare (`88`), headerless, positional columns
- AraCLIM — bare, in a column named `id`
- Expression matrix — X-prefixed (`X88`), from R's `make.names` on numeric headers
- VCF — bare, in the `#CHROM` sample columns

Of the 727 accessions with expression data, 62 are absent from the 1,135-accession
genome panel and one more from AraCLIM, which is where 664 comes from.

## Usage

```bash
./scripts/fetch-raw.sh
node scripts/build-locus.mjs AT5G10140 5:3170000-3182000 FLC
```

Writes `data/derived/flc.json` — the roster with climate and expression, the
segregating sites, and a genotype string per site (one character per accession,
aligned to the roster).

`data/` is disposable and regenerable; don't commit it.

## Validation

The join is checked by whether it produces biology rather than by row counts. At
FLC — the vernalization gene, where the literature describes a latitudinal
cline — the strongest site is **5:3,177,289 (A>C), correlating with latitude at
r = 0.42** across 664 accessions. That position falls inside the gene. Shuffled
identifiers would not exceed roughly r = 0.15.
