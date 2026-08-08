#!/usr/bin/env bash
# Fetches the source data Coldframe builds on. Everything lands in data/raw,
# which is disposable - rerun this to rebuild it. Total ~30MB, plus one
# VCF per locus.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p data/raw
cd data/raw

# Accession roster: id, name, country, lat/lng, admixture group. 1135 rows,
# headerless. The `query` parameter is required or the API returns 400.
echo "accessions..."
curl -sS --max-time 60 -o accessions_1001g.csv \
  "https://tools.1001genomes.org/api/accessions.csv?query=SELECT%20*%20FROM%20tg_accessions"

# AraCLIM: 200+ geo-climate variables for the 1131 geo-referenced accessions.
echo "climate..."
curl -sSL --max-time 120 -o araclim_climatesd.csv \
  "https://raw.githubusercontent.com/CLIMtools/AraCLIM/master/data/shiny%20climatesd.csv"
curl -sSL --max-time 60 -o araclim_datadescription.csv \
  "https://raw.githubusercontent.com/CLIMtools/AraCLIM/master/data/datadescription.csv"

# 1001 Transcriptomes, rosette leaf, normalised counts. 727 accessions.
echo "expression (26MB)..."
curl -sSL --max-time 600 -O \
  "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE80nnn/GSE80744/suppl/GSE80744_ath1001_tx_norm_2016-04-21-UQ_gNorm_normCounts_k4.tsv.gz"

# The 664 accessions carried by all three sources above. Derived rather than
# downloaded, so the locus pulls below request exactly the joinable set.
echo "resolving the joinable accession set..."
gzcat GSE80744_*.tsv.gz | head -1 | tr '\t' '\n' | tail -n +2 | sed 's/^X//' | sort -u > .expr_ids
cut -d, -f1 accessions_1001g.csv | tr -d '"' | sort -u > .acc_ids
awk -F, 'NR>1{gsub(/"/,"",$3); print $3}' araclim_climatesd.csv | sort -u > .clim_ids
comm -12 .expr_ids .acc_ids | comm -12 - .clim_ids | sort -n > accessions_664.txt
rm -f .expr_ids .acc_ids .clim_ids
echo "  $(wc -l < accessions_664.txt) accessions in all three sources"

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
fetch_locus FLC 5:3170000-3182000   # AT5G10140, vernalization
