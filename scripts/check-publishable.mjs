// Guards `npm run build`. Vite copies everything in data/derived into dist/,
// so an artifact carrying genotype calls would be published by accident.
//
// data-sources.json marks the 1001 Genomes callset as not redistributable;
// build-locus.mjs honours that with --public, and this makes sure a stray
// local artifact can't undo it.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED = join(ROOT, 'data', 'derived');

if (!existsSync(DERIVED)) {
  console.error('no data/derived - run ./scripts/fetch-raw.sh and build a locus first');
  process.exit(1);
}

const offenders = [];
let publishable = 0;

for (const file of readdirSync(DERIVED)) {
  if (!file.endsWith('.json')) continue;
  const artifact = JSON.parse(readFileSync(join(DERIVED, file), 'utf8'));
  if (artifact.genotypes || artifact.provenance?.redistributable === false) {
    offenders.push(file);
  } else {
    publishable++;
  }
}

if (offenders.length > 0) {
  console.error('Refusing to build: data/derived holds artifacts that must not be published.\n');
  for (const f of offenders) console.error(`  ${f}  (contains per-accession genotype calls)`);
  console.error('\nThe 1001 Genomes callset carries no explicit redistribution grant');
  console.error('(see data-sources.json). Rebuild these with --public, e.g.\n');
  console.error('  node scripts/build-locus.mjs AT5G10140 5:3170000-3182000 FLC --public\n');
  console.error('then remove the local-only copies from data/derived.');
  process.exit(1);
}

if (publishable === 0) {
  console.error('no publishable artifacts in data/derived - build one with --public');
  process.exit(1);
}

console.log(`check-publishable: ${publishable} artifact(s) cleared for publication`);
