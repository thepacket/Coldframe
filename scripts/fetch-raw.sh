#!/usr/bin/env bash
# Fetches the source data Coldframe builds on. Everything lands in data/raw,
# which is disposable - rerun this to rebuild it. Total ~30MB, plus one
# VCF per locus.
# No pipefail on purpose: reading a header with `gzcat ... | head -1` leaves
# gzcat killed by SIGPIPE, which pipefail treats as failure and set -e acts on.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/data/raw"
cd "$ROOT/data/raw"

# AraCLIM: 200+ geo-climate variables for the 1131 geo-referenced accessions,
# plus the roster itself - id, name, country, lat/lng, admixture group. That
# overlap is why Coldframe doesn't pull the 1001 Genomes accession table: one
# fewer source, and this one is Apache-2.0 rather than unclear. See
# data-sources.json.
echo "roster + climate..."
curl -sSL --max-time 120 -o araclim_climatesd.csv \
  "https://raw.githubusercontent.com/CLIMtools/AraCLIM/master/data/shiny%20climatesd.csv"
curl -sSL --max-time 60 -o araclim_datadescription.csv \
  "https://raw.githubusercontent.com/CLIMtools/AraCLIM/master/data/datadescription.csv"

# 1001 Transcriptomes, rosette leaf, normalised counts. 727 accessions.
echo "expression (26MB)..."
curl -sSL --max-time 600 -O \
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE80nnn/GSE80744/suppl/GSE80744_ath1001_tx_norm_2016-04-21-UQ_gNorm_normCounts_k4.tsv.gz"

# The accessions carried by both sources above. Derived rather than downloaded,
# so the locus pulls below request exactly the joinable set. The expression
# matrix spells ids X-prefixed (R's make.names on numeric headers); AraCLIM
# spells them bare.
echo "resolving the joinable accession set..."
gzcat GSE80744_*.tsv.gz | head -1 | tr '\t' '\n' | tail -n +2 | sed 's/^X//' | sort -u > .expr_ids
awk -F, 'NR>1{gsub(/"/,"",$3); print $3}' araclim_climatesd.csv | sort -u > .clim_ids
comm -12 .expr_ids .clim_ids | sort -n > accessions_664.txt
rm -f .expr_ids .clim_ids
echo "  $(wc -l < accessions_664.txt) accessions in both sources"

# Per-locus genotypes from the VCFSubset API.
#
# Two things to know about this endpoint. Regions keep the colon but drop any
# "Chr" prefix: 5:3170000-3182000. And it returns an ALL-SITES VCF - every base
# in the window, invariant ones included - so a 12kb window is ~8MB gzipped for
# 664 accessions and filters down to ~1000 segregating sites. Roughly 5s each.
fetch_locus() {
  local label="$1" region="$2"
  local out="$(echo "$label" | tr '[:upper:]' '[:lower:]')_664.vcf.gz"
  [ -s "$out" ] && { echo "  $label (cached)"; return; }
  echo "  $label $region"
  curl -sS --max-time 900 -X POST "https://tools.1001genomes.org/api/v1/vcfsubset/" \
    --data-urlencode "strains=$(paste -sd, accessions_664.txt)" \
    --data-urlencode "regions=${region}" \
    --data-urlencode "type=fullgenome" \
    --data-urlencode "format=vcf.gz" \
    -o "$out"
}

echo "loci..."
while read -r label region; do
  fetch_locus "$label" "$region"
done < <(node -e '
  const loci = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const l of loci) console.log(l.label, l.region);
' "$ROOT/loci.json")

# Gene models for the locus strip. Ensembl Plants rather than TAIR (terms depend
# on an undocumented release folder) or NCBI RefSeq (chromosomes named
# NC_003070.9, not 1-5). Concatenated gzip streams read fine as one file.
if [ ! -s ensembl_genes.gff3.gz ]; then
  echo "gene models..."
  for c in 1 2 3 4 5; do
    curl -sSL --max-time 300 \
      "https://ftp.ebi.ac.uk/ensemblgenomes/pub/plants/current/gff3/arabidopsis_thaliana/Arabidopsis_thaliana.TAIR10.63.chromosome.${c}.gff3.gz" \
      >> ensembl_genes.gff3.gz
  done
fi
