# Coldframe

A cold frame is a low glass box you put over plants to carry them through winter.

Coldframe is a browser for looking at one genomic locus across a thousand wild
plants at once — sorted by the climate each of them came from. Open a
cold-adaptation gene and the allele frequency gradient appears as a visible
cline, because the accessions are ordered by the world rather than by accession
number.

It is an **interactive hypothesis browser**. It is not an adaptation detector,
and it is not a crop-breeding predictor. What it shows is where an allele sits
in the world, whether it travels with expression, and how much of either
survives an ancestry control — enough to find a question worth asking and state
it precisely, not enough to answer it. Nothing it draws demonstrates selection,
and nothing it computes transfers to a crop. The sections on
[ancestry](#ancestry-and-why-the-raw-clines-overstate) and
[what is hidden](#what-is-hidden) say why in detail.

The question it lets you browse is: **does the allele you carry change how you
respond when the light goes?**

Built on *Arabidopsis thaliana*, whose 1001 Genomes panel is the best natural
experiment in climate adaptation we have — 1,135 accessions collected from Cape
Verde to northern Scandinavia, sequenced, expression-profiled, and geo-referenced.

![Coldframe showing the FRI locus: a map of collection sites coloured by
genotype, expression split by allele, and a matrix of 664 accessions ordered
from coldest to warmest origin](coldframe.png)

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

The full callset is a 19 GB VCF. Nothing ever downloads it — your browser pulls
one region at a time from the VCFSubset API, a few seconds and a few megabytes
each.

### Identifier quirks

The accession id is the join key, spelled differently in each source:

- AraCLIM — bare (`88`), in a column named `id`
- Expression matrix — X-prefixed (`X88`), from R's `make.names` on numeric headers
- VCF — bare, in the `#CHROM` sample columns

Of the 727 accessions with expression data, 63 are absent from AraCLIM's 1,131
geo-referenced accessions, which is where 664 comes from.

## Nothing is packaged

The app ships no data. When you open it, **your browser fetches every source
from its origin archive and computes every statistic locally**:

| Source | Fetched from | Size |
|---|---|---|
| Roster + climate | AraCLIM's repository | 2.3 MB, once |
| Expression | NCBI GEO (GSE80744) | 26 MB, once — nine rows kept, rest discarded |
| Genotypes | 1001 Genomes VCFSubset API | 5–9 MB per locus, on demand |

All three origins send `Access-Control-Allow-Origin: *`. The VCFSubset response
is BGZF, decoded with a small block-walker over `DecompressionStream`; the
statistics are a line-for-line port of `scripts/build-locus.mjs`, and a
browser-assembled locus matches a node-built one to the fourth decimal.
Everything is cached in IndexedDB, so each source is fetched once per browser —
a locus takes a few seconds cold and is instant after.

Coldframe therefore redistributes nothing, which dissolves the licensing
question that shaped every earlier design: there is no `--public` build, no
publish guard, and no view that exists only locally. The deployable app is
three static files totalling ~120 KB, hostable anywhere.

**Live at [coldframe.fly.dev](https://coldframe.fly.dev).** The server holds no
data — a request for any data path gets the app shell back, because there is
nothing else to serve. A courtesy email to the 1001 Genomes group about the API
traffic this sends them is drafted, since each visitor's browser calls their
VCFSubset endpoint directly.

## Running the app

```bash
npm install
npm run dev
```

That is the whole thing — no scripts, no data step, nothing to download first.
The browser assembles each locus from the source archives on first visit and
caches it.

**Adding a gene:** one entry in [loci.json](loci.json) — label, AGI code,
region, and a note on what the gene does. It appears in the app on reload. No
rebuild, because there is nothing to rebuild.

The node pipeline under `scripts/` is optional local tooling, not part of
running the app. It writes the same artifacts to disk for offline work and for
`preview-matrix.mjs`, and it stays the reference implementation that
`src/data/compute.ts` is checked against. Anything it writes lands in `data/`,
which is gitignored and never shipped. The embedded coastline is the one
prebuilt asset: it is committed, and `build-coastline.mjs` regenerates it from
Natural Earth's `ne_110m_land.geojson` if ever needed.

## Deploying to fly.io

The live site is nginx serving the prebuilt `dist/` — three static files, no
data, no backend. Config lives in [fly.toml](fly.toml), the
[Dockerfile](Dockerfile), and [nginx.conf](nginx.conf).

To ship the current code:

```bash
npm run build && fly deploy
```

**Always as a pair.** The build does not run inside the Docker image — the
image just copies `dist/` — so `fly deploy` on its own faithfully ships
whatever is already there, however old. This has bitten once: a deploy that
"succeeded" while production kept the previous behaviour, because `dist/` was
hours stale.

Fly creates two machines by default for redundancy; a tool this size wants
one:

```bash
fly scale count 1 --yes
```

The app idles to zero machines between visits (`min_machines_running = 0` in
fly.toml), so a quiet deployment costs nothing but a cold start on the next
visit.

First-time setup, for a fork deploying its own copy:

```bash
fly auth login
fly apps create <your-app-name>   # then set `app` in fly.toml to match
npm run build && fly deploy
```

Nothing else — no secrets, no volumes, no environment. The server never sees a
genotype; everything the page shows is fetched by the visitor's browser
directly from the source archives, so any static host works the same way if
fly is not to taste.

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

The map draws per-accession calls, which the browser now fetches itself — so
unlike earlier versions there is no build of Coldframe in which this view is
missing.

## Expression by genotype

The panel and the map both show *where* an allele is. This asks whether it does
anything: expression split by what each plant carries at the selected site.

One limit, stated in the interface rather than buried here. GSE80744 measured
rosette leaves once, under ambient conditions — one condition, no cold
treatment, no time course. So this is an association with expression level, a
cis-eQTL test. It is not a response, because nothing was done to these plants.
Answering the question in the tagline properly needs expression measured under
treatment, which this dataset does not contain.

Every dot carries the climate its accession came from. If one allele is also
the cold-origin allele, the confound is the finding, so it is drawn rather than
hidden.

Two loci make the point better than any explanation:

- **CO** has the strongest climate cline in the set (r = −0.54) and essentially
  no expression association (r = −0.04). The allele tracks the world without
  changing how much of the gene is made.
- **FRI** is the reverse. At 4:269,260 the alternate allele carries
  **r = −0.775** against expression — carriers make far less *FRI* — while that
  same site has almost no climate cline (r = −0.02). This is the textbook
  natural variant: broken *FRI* is what turns a winter annual into a
  rapid-cycling plant.

*FLC* is the one where both appear together, which is also what the literature
would predict.

Per-site expression associations are precomputed for every site, and **Rank
sites by → Expression effect** reorders the panel around them.

That control is not a convenience. Ranking by climate gradient buries the
expression story: the strongest eQTL is the 86th strongest cline at *FRI*, the
178th at *CBF* and *PHYB*, the 218th at *CMT2*. Back when the panel was capped
at 48 sites it never appeared at all in five of nine loci.

The expression association carries the same ancestry control as the climate
cline. At *FRI* it holds up far better than any cline in the project —
**−0.775 raw, −0.446 within ancestry groups, 58% kept.**

## Ancestry, and why the raw clines overstate

Northern accessions are both related and cold. So an allele frequency gradient
along a climate axis may be relatedness wearing a costume, and a raw
correlation is not on its own evidence of adaptation.

Coldframe computes every correlation a second time *inside* each admixture
group and averages by group size. The panel draws both: a pale bar for the raw
correlation, a solid bar for the within-ancestry one. The gap between them is
the part that was population structure.

It is a weighted mean of within-group r, not a formal partial correlation —
enough to flag a confound, not enough to publish on.

The confound is also drawn directly. Sorted by climate, the accession strip
shows ancestry as near-solid blocks, and the band strip makes it stark: at
*CO*, the coldest band is 50% Asian and 45% North Swedish, the warmest 43%
Spanish. Climate bands are substantially ancestry bands.

Strongest cline per locus, before and after the control:

| Locus | axis | raw | within ancestry | kept |
|---|---|---|---|---|
| FT | temperature | −0.296 | −0.210 | **71%** |
| CO | spring temperature | −0.537 | −0.218 | 41% |
| CMT2 | spring night temp | −0.428 | −0.164 | 38% |
| FRI | spring night temp | −0.432 | −0.157 | 36% |
| GI | spring night temp | −0.345 | −0.124 | 36% |
| CBF | spring temperature | −0.469 | −0.150 | 32% |
| CRY2 | spring temperature | −0.459 | −0.042 | 9% |
| FLC | spring night temp | −0.434 | −0.040 | 9% |
| PHYB | summer insolation | +0.387 | −0.005 | **1%** |

Read this before trusting any headline number in this repository, including
the ones above it. *PHYB* looked like the tidiest result in the set — a light
receptor whose strongest correlate is light rather than temperature — and it
is almost entirely structure. *FT*, the least eye-catching, is the one that
survives.

This does not undo the [validation](#validation) below, which asks whether the
join produces real structure in the right place. It does undo any reading of
these clines as demonstrated adaptation.

## What is hidden

Coldframe shows a curated slice, not a region. Three filters sit between the
data and the screen, and the panel now states the first two on every render.

**Rare variants get no *correlation*.** Any site where the rarer allele appears
in under 5% of plants, or which is called in fewer than 300, gets a null `cline`
and `exprR`. Across the nine loci that is **9,403 segregating sites, 1,439
testable — 15%**; at *FLC*, 690 of 974 fail on frequency alone.

That is a limit of the statistic, not a verdict on the site, and the two were
conflated here until 2026-08-08. Rare often means young, and young is where
recent adaptation lives — the *FRI* nulls are a family of independent
loss-of-function alleles, several of them rare. So every site also carries
`carriers` and a per-axis `shift`: the standardised difference between the
environment of carriers and everyone else, which works down to a single plant.
At *FRI* that surfaces 163 sites with real environmental structure that no
correlation could reach, including alleles in eight to thirteen plants sitting
1.8 SD warm of the panel mean.

The all-sites strip at the top of the panel draws every one of them at true
genomic position, dimmed where untestable, and any tick is clickable. **Nothing
in the region is unreachable.**

**~~Only 48 sites get the full treatment.~~** There is no longer a cap. The
ranked panel shows every site the chosen statistic can score — 39 at *CO*, 178
at *CBF*, 340 at *CMT2* — and defaults there. The old 48 was a viewport limit
with no statistical justification, held in place by band frequencies being
precomputed for exactly 48 sites. Bands are now computed live from the genotype
matrix, so the constraint is gone.

Which sites appear first still depends on the ranking, and the two rankings
disagree hard enough that the strongest expression effect was unreachable in
five of nine loci until the ranking became switchable.

**Ten environmental measures out of 212.** AraCLIM ships 212 columns;
`CLIMATE_VARS` in `src/data/parse.ts` picks ten, chosen for relevance to cold
and light. So every "strongest gradient" in this
repository means *strongest among those ten*, including the *PHYB* insolation
result — and if the real driver is one of the other 202, Coldframe cannot see
it.

None of these is a bug, and the first is good statistics. But together they
mean the tool answers "what does this curated slice look like" rather than
"what is in this region", and a reader who does not know that will overread
every number here.

## Contributing

Issues are welcome — corrections to the biology especially. Pull requests are
disabled; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

The code is [MIT](LICENSE). Every dependency it plans to use — `@gmod/tabix`,
`@gmod/vcf`, `@gmod/bbi`, `@gmod/gff`, `igv.js`, `gosling.js` — is also MIT.

**The data is not covered by that licence.** Per-source terms live in
[data-sources.json](data-sources.json), which the build script reads to decide
what may be published; attribution is in [NOTICE](NOTICE).

Earlier versions gated redistribution: artifacts split into a shippable part
and a genotype part, a `--public` flag, and a guard that refused to build while
calls were present. That apparatus is gone because the question it managed is
gone — the app now redistributes nothing at all. Genotype calls are fetched by
each visitor's browser directly from the 1001 Genomes VCFSubset API and never
touch this project's servers or repository. The history holds the old design if
anyone needs it.

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
