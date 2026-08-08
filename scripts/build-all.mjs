// Builds every locus in loci.json and writes the index the app reads on load.
//
//   usage: node scripts/build-all.mjs [--public]
//
// Flags pass straight through to build-locus.mjs, so --public here produces a
// wholly publishable data/derived.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED = join(ROOT, 'data', 'derived');

const publicBuild = process.argv.includes('--public');
const suffix = publicBuild ? '.public' : '';
const loci = JSON.parse(readFileSync(join(ROOT, 'loci.json'), 'utf8'));

const entries = [];
const skipped = [];

for (const locus of loci) {
  const vcf = join(ROOT, 'data', 'raw', `${locus.label.toLowerCase()}_664.vcf.gz`);
  if (!existsSync(vcf)) {
    skipped.push(`${locus.label} (no VCF - rerun ./scripts/fetch-raw.sh)`);
    continue;
  }

  const args = ['scripts/build-locus.mjs', locus.gene, locus.region, locus.label];
  if (publicBuild) args.push('--public');
  execFileSync('node', args, { cwd: ROOT, stdio: 'inherit' });

  const file = `${locus.label.toLowerCase()}${suffix}.json`;
  const artifact = JSON.parse(readFileSync(join(DERIVED, file), 'utf8'));

  // Strongest association anywhere in the locus, across every axis. This is
  // what the picker shows, so a locus advertises its own best story.
  let best = null;
  for (const [axis, rs] of Object.entries(artifact.cline)) {
    rs.forEach((r, i) => {
      if (r !== null && (best === null || Math.abs(r) > Math.abs(best.r))) {
        best = { axis, r, pos: artifact.sites[i].pos };
      }
    });
  }

  entries.push({
    label: locus.label,
    gene: locus.gene,
    title: locus.title,
    note: locus.note,
    file,
    chrom: artifact.locus.chrom,
    start: artifact.locus.start,
    end: artifact.locus.end,
    accessions: artifact.accessions.length,
    sites: artifact.sites.length,
    best,
  });
}

// Loudest locus first - open on something worth looking at.
entries.sort((a, b) => Math.abs(b.best?.r ?? 0) - Math.abs(a.best?.r ?? 0));

writeFileSync(
  join(DERIVED, 'index.json'),
  JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    redistributable: publicBuild,
    loci: entries,
  }),
);

console.log(`\nindex.json  ${entries.length} loci${publicBuild ? ' [public]' : ''}`);
for (const e of entries) {
  const b = e.best;
  console.log(`  ${e.label.padEnd(5)} ${String(e.sites).padStart(5)} sites   ${b ? `r=${b.r.toFixed(3)} vs ${b.axis}` : 'no testable sites'}`);
}
for (const s of skipped) console.log(`  skipped: ${s}`);
