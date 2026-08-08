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

Status: **early, but real.** Nine loci, a map, and a linked panel. No gene
models yet, and no way to bring your own region.

## Why not IGV or JBrowse

This isn't a track browser and doesn't try to be one. Those tools show you a
locus in one genome very well. Coldframe shows you one locus across many
genomes, ordered by environment — which is a matrix, not a track. Different
picture, different question.

## The data

Joined on the accession id. **664 accessions** carry every layer.

| Layer | Source | Terms |
|---|---|---|
| Roster + climate | [AraCLIM](https://github.com/CLIMtools/AraCLIM) | Apache-2.0 |
| Expression | [GEO GSE80744](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE80744) | public domain |
| Annotation | [Ensembl Plants](https://plants.ensembl.org/) TAIR10 | unrestricted |
| Genotypes | [VCFSubset API](https://tools.1001genomes.org/vcfsubset/) | **unclear — not redistributed** |

Everything is on TAIR10, so there is no assembly reconciliation to do.

AraCLIM supplies the roster as well as the climate variables — id, name, country,
lat/lng, admixture group — so Coldframe doesn't need the 1001 Genomes accession
table. One fewer source, and this one has terms in writing.

Annotation comes from Ensembl Plants rather than TAIR (whose terms depend on
which release folder a file happens to sit in, undocumented) or NCBI RefSeq
(whose chromosomes are named `NC_003070.9` rather than `1`–`5`, which our VCFs
use).

The full callset is a 19 GB VCF. Coldframe never downloads it — loci are pulled
region-by-region from the VCFSubset API, a few seconds and a few megabytes each.

### Identifier quirks

The accession id is the join key, spelled differently in each source:

- AraCLIM — bare (`88`), in a column named `id`
- Expression matrix — X-prefixed (`X88`), from R's `make.names` on numeric headers
- VCF — bare, in the `#CHROM` sample columns

Of the 727 accessions with expression data, 63 are absent from AraCLIM's 1,131
geo-referenced accessions, which is where 664 comes from.

## Usage

```bash
./scripts/fetch-raw.sh          # ~40s, ~100MB into data/raw
node scripts/build-all.mjs      # every locus in loci.json, plus index.json
```

Each locus writes `data/derived/<label>.json` — the roster with climate and
expression, the segregating sites with allele frequencies, per-site
environmental correlations, band aggregates, and a genotype string per site
(one character per accession, aligned to the roster).

Add `--public` for shippable artifacts, which omit the genotype matrix. See
[Licence](#licence). `build-locus.mjs` builds a single locus if you want one:

```bash
node scripts/build-locus.mjs AT5G10140 5:3170000-3182000 FLC
```

Curated loci live in [loci.json](loci.json) — gene, region, and a note on what
the gene does. Add an entry, rerun both scripts, and it appears in the app.

`data/` is disposable and regenerable; don't commit it.

The embedded coastline is prebuilt and committed. To regenerate it, download
Natural Earth `ne_110m_land.geojson` and run `node scripts/build-coastline.mjs`.

## Running the app

```bash
npm install
npm run dev
```

Vite serves `data/derived` directly, so the app picks up whichever artifact is
there — the full one locally, the `--public` one otherwise. Without genotypes
the banded panel still works; the per-accession panel says so and stands down.

`npm run build` refuses to run while a non-publishable artifact is sitting in
`data/derived`, because Vite would copy it into `dist/`. Build with `--public`
and remove the local copy first.

## The panel

Three sections, sharing one set of columns — the sites with the strongest
clines on the chosen axis, laid out in genomic order.

- **Cline strength** — correlation per site. Warm bars mean the alternate
  allele gets commoner as the axis rises; cool bars, the reverse.
- **Climate bands** — accessions in 32 equal-count groups, each cell the
  alternate allele frequency of that group. The overview, where the cline reads
  at a glance.
- **Accessions** — one row per plant, coldest at the top. The detail, where
  haplotype structure and individual plants survive.

Both left-hand strips carry the same two variables throughout: the ordering
axis, and expression of the gene. Expression is ranked rather than scaled —
at FLC it spans 2 to 25,609, and any linear or log ramp collapses to one
colour.

Showing all 974 segregating sites was tried and abandoned: at one pixel per
site the informative columns vanish under rare variants. Site selection isn't
an optimisation here, it's load-bearing.

## The map

The panel sorts accessions by climate, which is an abstraction of a cline. The
map is the cline itself: every plant at the place it was collected, coloured by
what it carries at one site. Click any column in the panel to move the map to
that site.

Land comes from Natural Earth, embedded at build time — no tile server, no
third-party request, works offline.

Two things it deliberately leaves out. North American accessions are not drawn:
*Arabidopsis* there is introduced, carrying European genotypes without having
had time to adapt locally, so plotting them beside the native range invites a
wrong reading. They are counted instead. And the southern edge drops exactly
one accession — Cvi-0, from Cape Verde at 15°N — because framing for it would
spend 40% of the map on empty ocean and Sahara.

The map needs per-accession calls, so it does not appear in a `--public` build.
That is the sharpest cost of the licensing position, and the best argument for
getting the terms confirmed.

## Contributing

Issues are welcome — corrections to the biology especially. Pull requests are
disabled; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

The code is [MIT](LICENSE). Every dependency it plans to use — `@gmod/tabix`,
`@gmod/vcf`, `@gmod/bbi`, `@gmod/gff`, `igv.js`, `gosling.js` — is also MIT.

**The data is not covered by that licence.** Per-source terms live in
[data-sources.json](data-sources.json), which the build script reads to decide
what may be published; attribution is in [NOTICE](NOTICE).

The plan is to ship precomputed loci as a static bundle, which is redistribution.
Three of the four sources permit it with attribution. The fourth doesn't say.

The 1001 Genomes policy is a Fort Lauderdale-style pre-publication clause — no
whole-genome-scale analysis published ahead of the consortium — which the 2016
*Cell* paper discharges in substance. A 12 kb locus is also a vanishing fraction
of a 19 GB callset. So redistributing it is *probably* fine. But "probably"
shouldn't be load-bearing in a public repository.

So the design doesn't decide. It makes the decision cheap:

- Artifacts split into a part that always ships and a part that's gated.
  Per-accession genotype calls are gated; everything else ships.
- `--public` omits the gated part. What remains includes per-site allele
  frequencies and environmental correlations computed *from* the calls — facts
  about the data rather than a subset of it.
- Anyone can reconstruct the full artifact locally by running
  `scripts/fetch-raw.sh`, which pulls genotypes from the source API directly.
- If the terms are ever confirmed in writing, dropping `--public` is the entire
  change.

For FLC that costs 1.0 MB → 412 KB and loses none of the science: 142 testable
sites survive with their clines intact.

This is a good-faith reading of published terms, not legal advice.

## Validation

The join is checked by whether it produces biology rather than by row counts.
At FLC — the vernalization gene, where the literature describes a latitudinal
cline — the strongest association across 974 segregating sites is **5:3,181,243
correlating with spring night temperature at r = −0.43**, with **5:3,177,289
(A>C) at r = 0.42 against raw latitude**. Both fall in the locus, and
temperature outperforming latitude is the right way round: latitude is a proxy,
night temperature is closer to the mechanism.

Accessions span 15.1°N to 68.8°N — Cape Verde to northern Scandinavia. Shuffled
identifiers would not exceed roughly r = 0.15.
